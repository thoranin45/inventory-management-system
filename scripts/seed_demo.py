"""DEMO / QA ONLY — seed a demo dataset into a FRESH, disposable demo database.

What it creates
  * demo users  wc_admin / wc_wh  (passwords from the environment). Users are
    only ever CREATED: an existing user is never modified (no password reset).
  * a WEST store warehouse + location (warehouses have no create endpoint).
  * products + batches + stock covering healthy / low / expired / near-expiry
    stock, batch-tracked and non-batch. ALL stock enters through the public
    ledgered workflows (POST /batches, POST /stock/in) with Idempotency-Keys —
    the script never writes stock_balances, stock_transactions or movements.
  * Sales / Purchase-Order / Transfer lifecycles driven through the PUBLIC
    FastAPI. Every call's HTTP status is checked; any 4xx/5xx/transport error
    aborts the run (V1-H5: nothing is best-effort any more). Idempotent writes
    (batches, stock-in, PO/transfer receive, sales return) carry run-scoped
    keys and are retried with the SAME key after a lost response.
  * the sales return is verified to have applied exactly once (receipt,
    SALE_RETURN transaction, movement, stock) and to replay unchanged.
  * a final REQUIRED-STATE check (demo conditions + ledger consistency via
    scripts/check_inventory_consistency.py); a miss prints `FAIL:` lines and
    exits non-zero.

Safety guards (all must pass or the script refuses and exits non-zero)
  * SEED_CONFIRM=1
  * an EXPLICIT database target — DATABASE_URL or SEED_DATABASE_URL. There is
    NO fallback to app.core.config.settings.
  * a name containing "prod"/"production"/"live" is always refused; a name
    that does not look like demo/qa/test needs
    SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION=1.
  * DEMO_ADMIN_PASSWORD and DEMO_WH_PASSWORD present and not placeholders.
  * DEMO_API set (stock can only be created through the API).
  * the database must be FRESH: at the expected Alembic head, no users or
    business rows of any kind, and only the migration-provisioned storage
    (MAIN/DEFAULT, __TRANSIT__/__TRANSIT__). Checked under a table lock in the
    same transaction that creates the first user. A re-run therefore refuses:
    re-seed only into a newly created database/volume.

Run (inside the api container, WORKDIR /app):
  SEED_CONFIRM=1 DEMO_ADMIN_PASSWORD=... DEMO_WH_PASSWORD=... \
  DATABASE_URL=postgresql+psycopg2://inventory_demo:...@db:5432/inventory_demo \
  DEMO_API=http://api:8081/api/v1 \
      python scripts/seed_demo.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from decimal import Decimal

# Runnable as `python scripts/seed_demo.py` from the repo root / container
# WORKDIR — put the repo root (this file's parent's parent) on sys.path so
# `import app` resolves regardless of the current working directory.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

ADMIN_USER, WH_USER = "wc_admin", "wc_wh"
NEAR_DAYS = 90  # matches app.core.config.settings.near_expiry_days default


class SeedError(RuntimeError):
    """A seed step failed; the run aborts and exits non-zero."""


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #

def _die(msg: str, code: int = 2) -> None:
    print(f"seed_demo: REFUSING — {msg}", file=sys.stderr)
    raise SystemExit(code)


@dataclass(frozen=True)
class SeedConfig:
    db_url: str
    db_name: str
    admin_pw: str
    wh_pw: str
    api: str


def check_guards() -> SeedConfig:
    if os.environ.get("SEED_CONFIRM") != "1":
        _die("set SEED_CONFIRM=1 to run this DEMO/QA-only script")

    db_url = os.environ.get("SEED_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        _die("set SEED_DATABASE_URL (or DATABASE_URL) to an EXPLICIT demo database "
             "— there is no settings fallback")

    db_name = db_url.rsplit("/", 1)[-1].split("?", 1)[0].lower()
    if any(bad in db_name for bad in ("prod", "production", "live")):
        _die(f"target database name {db_name!r} looks like production")
    if not any(ok in db_name for ok in ("demo", "qa", "test")):
        if os.environ.get("SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION") != "1":
            _die(f"target database name {db_name!r} does not look like a demo/test "
                 "DB; set SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION=1 to override")

    admin_pw = os.environ.get("DEMO_ADMIN_PASSWORD", "")
    wh_pw = os.environ.get("DEMO_WH_PASSWORD", "")
    for name, value in (("DEMO_ADMIN_PASSWORD", admin_pw), ("DEMO_WH_PASSWORD", wh_pw)):
        if len(value) < 8 or "CHANGE_ME" in value:
            _die(f"{name} is missing or a placeholder (need >= 8 real characters)")
        if len(value.encode("utf-8")) > 72:  # the API's bcrypt limit (UserRegister)
            _die(f"{name} exceeds 72 UTF-8 bytes")

    api = os.environ.get("DEMO_API", "").rstrip("/")  # e.g. http://api:8081/api/v1
    if not api:
        _die("set DEMO_API (e.g. http://api:8081/api/v1) — all stock is created "
             "through the ledgered API, never written directly")
    return SeedConfig(db_url, db_name, admin_pw, wh_pw, api)


# Rows the migrations themselves provision; anything else means "not fresh".
MIGRATION_STORAGE = {("MAIN", "DEFAULT"), ("__TRANSIT__", "__TRANSIT__")}
FRESH_EMPTY_TABLES = (
    "users", "products", "categories", "brands", "units", "product_unit_conversions",
    "customers", "suppliers", "product_batches", "stock_balances", "stock_transactions",
    "inventory_movements", "sales_orders", "purchase_orders", "inventory_transfers",
    "purchase_order_receipts", "inventory_transfer_receipts", "sales_return_receipts",
    "stock_operation_receipts", "stock_adjustment_requests", "audit_logs",
)


def freshness_problems(scalar, rows, expected_head: str, expected_db: str) -> list[str]:
    """Evidence that the target is a freshly migrated, never-used database.

    ``scalar(sql)`` / ``rows(sql)`` run read-only SQL. Returns the reasons the
    target is NOT fresh (empty list = fresh)."""
    problems = []
    actual_db = scalar("SELECT current_database()")
    if actual_db != expected_db:
        problems.append(f"connected database {actual_db!r} is not the configured {expected_db!r}")
    head = scalar("SELECT version_num FROM alembic_version")
    if head != expected_head:
        problems.append(f"alembic revision {head!r} is not the expected head {expected_head!r}")
    for table in FRESH_EMPTY_TABLES:
        count = scalar(f"SELECT count(*) FROM {table}")
        if count:
            problems.append(f"{table} already has {count} row(s)")
    storage = {tuple(r) for r in rows(
        "SELECT w.warehouse_code, l.location_code FROM warehouses w "
        "LEFT JOIN warehouse_locations l ON l.warehouse_id = w.id")}
    if storage != MIGRATION_STORAGE:
        problems.append(f"warehouses/locations {sorted(storage, key=str)} are not exactly the "
                        f"migration-provisioned {sorted(MIGRATION_STORAGE)}")
    return problems


# --------------------------------------------------------------------------- #
# Bootstrap: the only direct DB writes (no stock, no ledger rows)
# --------------------------------------------------------------------------- #

def create_user_once(session, username: str, password: str, role: str, hasher) -> None:
    """Create a demo user; NEVER modify an existing one (no password reset)."""
    from app.models import User

    if session.query(User).filter(User.username == username).first() is not None:
        raise SeedError(f"user {username!r} already exists — refusing to modify it; "
                        "seed only into a fresh demo database")
    session.add(User(username=username, password_hash=hasher(password), role=role, is_active=True))
    session.flush()
    print(f"  user {username!r}: created role={role}")


@dataclass(frozen=True)
class Storage:
    main_wh: int
    main_loc: int
    west_wh: int
    west_loc: int


def bootstrap(session_factory, cfg: SeedConfig, expected_head: str, hasher) -> Storage:
    """In ONE transaction: lock, prove the DB is fresh, create the admin and the
    WEST store. A concurrent or repeated seed blocks, then fails freshness."""
    from sqlalchemy import text
    from app.models import Warehouse, WarehouseLocation

    with session_factory() as s, s.begin():
        s.execute(text("LOCK TABLE users, warehouses, warehouse_locations IN EXCLUSIVE MODE"))
        problems = freshness_problems(
            lambda sql: s.execute(text(sql)).scalar(),
            lambda sql: s.execute(text(sql)).all(),
            expected_head, cfg.db_name)
        if problems:
            raise SeedError("target is not a fresh demo database:\n    - " + "\n    - ".join(problems))
        create_user_once(s, ADMIN_USER, cfg.admin_pw, "ADMIN", hasher)  # as /auth/register stores it
        main = s.query(Warehouse).filter_by(warehouse_code="MAIN").one()
        main_loc = s.query(WarehouseLocation).filter_by(warehouse_id=main.id, location_code="DEFAULT").one()
        west = Warehouse(warehouse_code="WEST", warehouse_name="West Regional Store",
                         warehouse_type="STORE", is_active=True)
        s.add(west)
        s.flush()
        west_loc = WarehouseLocation(warehouse_id=west.id, location_code="DEFAULT",
                                     location_name="Default Location", location_type="STORAGE",
                                     is_active=True)
        s.add(west_loc)
        s.flush()
        print(f"  warehouse WEST: created id={west.id}")
        return Storage(main.id, main_loc.id, west.id, west_loc.id)


# --------------------------------------------------------------------------- #
# Checked API client
# --------------------------------------------------------------------------- #
RETRYABLE = {0, 502, 503, 504}  # transport failure / gateway: response may be lost


def urllib_transport(method, url, headers, data, timeout=20):
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:300]}
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        return 0, {"error": type(e).__name__}


class Api:
    def __init__(self, base: str, run_id: str, transport=urllib_transport, sleep=time.sleep):
        self.base = base
        self.root = base[: -len("/api/v1")] if base.endswith("/api/v1") else base
        self.run_id = run_id
        self.transport = transport
        self.sleep = sleep

    def key(self, scope: str) -> str:
        """Deterministic within a run: the same intent always gets the same key."""
        return f"seed-{self.run_id}-{scope}"

    def call(self, method, path, token=None, body=None, *, idem=None, expect=(200, 201),
             root=False, retries=0, form=None):
        url = (self.root if root else self.base) + path
        headers = {}
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["content-type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode() if body is not None else None
            if body is not None:
                headers["content-type"] = "application/json"
        if idem:
            headers["Idempotency-Key"] = idem
        if token:
            headers["authorization"] = "Bearer " + token
        # Only a keyed (idempotent) request may be retried: the server replays
        # it instead of applying it twice. Anything else fails closed.
        attempts = 1 + (retries if idem else 0)
        for attempt in range(1, attempts + 1):
            status, payload = self.transport(method, url, headers, data)
            if status in expect:
                return payload
            if status in RETRYABLE and attempt < attempts:
                print(f"  ~ {method} {path}: status {status}, retrying with the same Idempotency-Key")
                self.sleep(min(2 * attempt, 5))
                continue
            detail = "" if form is not None else f": {str(payload)[:300]}"
            raise SeedError(f"{method} {path} -> HTTP {status} (expected {sorted(expect)}){detail}")
        raise SeedError(f"{method} {path}: no response")  # pragma: no cover

    def token(self, username: str, password: str) -> str:
        payload = self.call("POST", "/auth/token", expect=(200,),
                            form={"username": username, "password": password, "grant_type": "password"})
        token = (payload or {}).get("access_token")
        if not token:
            raise SeedError(f"login for {username!r} returned no access token")
        return token

    def wait_ready(self, tries=30):
        for _ in range(tries):
            status, body = self.transport("GET", self.root + "/ready", {}, None)
            if status == 200 and (body or {}).get("status") == "ready":
                print(f"\napi /ready ok (migration={(body or {}).get('migration')})")
                return
            self.sleep(2)
        raise SeedError("api /ready never returned ready — run the migrate profile first")


def _data(payload, *path):
    node = (payload or {}).get("data")
    for part in path:
        node = (node or {}).get(part) if isinstance(node, dict) else None
    return node


def _require(value, what):
    if value in (None, "", [], {}):
        raise SeedError(f"response is missing {what}")
    return value


# --------------------------------------------------------------------------- #
# Products and ledgered opening stock
# --------------------------------------------------------------------------- #
PRODUCTS = {
    # key: (sku, barcode, name, price, min, safety, max, track_batch, track_expiry)
    "coffee": ("WH-COFFEE-1KG", "885000000001", "Arabica Whole Bean 1kg", "210.00", "400", "0", "3000", True, True),
    "milk": ("WH-MILK-UHT-1L", "885000000002", "UHT Milk 1L", "42.00", "300", "0", "2000", True, True),
    "sugar": ("WH-SUGAR-25KG", "885000000009", "Refined Sugar Sack 25kg", "640.00", "80", "0", "400", False, False),
    "flour": ("WH-FLOUR-1KG", "885000000004", "All-Purpose Flour 1kg", "24.50", "600", "0", "5000", False, False),
    "salt": ("WH-SALT-500G", "885000000003", "Sea Salt 500g", "30.00", "150", "0", "1500", False, False),
    "tea": ("WH-TEA-200G", "885000000008", "Green Tea 200g", "78.00", "120", "40", "1200", True, True),
}

# (product, lot, expiry offset in days from today, quantity)
OPENING_BATCHES = (
    ("coffee", "LOT-CF-NEAR", 41, "1780.000"),     # near-expiry
    ("milk", "LOT-MK-EXPIRED", -9, "140.000"),     # expired
    ("milk", "LOT-MK-NEAR", 25, "760.000"),        # near-expiry
    ("tea", "LOT-TEA-OK", 220, "600.000"),         # healthy batch
    ("tea", "LOT-TEA-NEAR", 18, "440.000"),        # near-expiry
)
# (product, warehouse "MAIN"/"WEST", quantity) — non-batch stock-in
OPENING_STOCK = (
    ("sugar", "MAIN", "62.000"),     # LOW: below minimum 80
    ("flour", "MAIN", "2990.000"),   # healthy
    ("salt", "MAIN", "1100.000"),    # healthy
    ("salt", "WEST", "300.000"),     # WEST stock for transfers
)


def seed_products(api: Api, admin_token: str, session_factory) -> dict[str, dict]:
    """Create products through the API (stock_qty is always 0 there), then set the
    reorder thresholds — master data with no create/update endpoint — directly."""
    from app.models import Product

    products = {}
    for key, (sku, barcode, name, price, mn, sf, mx, batch, expiry) in PRODUCTS.items():
        payload = api.call("POST", "/products", admin_token, {
            "sku": sku, "barcode": barcode, "product_name": name, "price": price,
            "track_batch": batch, "track_expiry": expiry}, expect=(201,))
        products[key] = {"id": _require(_data(payload, "id"), f"product id for {sku}"),
                         "sku": sku, "barcode": barcode, "track_batch": batch}
    with session_factory() as s, s.begin():
        for key, (_, _, _, _, mn, sf, mx, _, _) in PRODUCTS.items():
            row = s.get(Product, products[key]["id"])
            row.minimum_stock, row.safety_stock, row.maximum_stock = Decimal(mn), Decimal(sf), Decimal(mx)
    print(f"  products: {', '.join(p['sku'] for p in products.values())}")
    return products


def seed_inventory(api: Api, wh_token: str, products, storage: Storage, today: dt.date) -> None:
    """Opening stock ONLY via the ledgered POST /batches and POST /stock/in, each
    with a run-scoped Idempotency-Key and lost-response retry."""
    for key, lot, offset, qty in OPENING_BATCHES:
        expiry = today + dt.timedelta(days=offset)
        payload = api.call("POST", "/batches", wh_token, {
            "product_id": products[key]["id"], "lot_no": lot, "quantity": qty,
            "mfg_date": (expiry - dt.timedelta(days=180)).isoformat(),
            "expiry_date": expiry.isoformat()},
            idem=api.key(f"batch-{lot}"), retries=2, expect=(201,))
        _require(_data(payload, "batch", "id"), f"batch id for {lot}")
        print(f"  batch {lot}: +{qty} exp={expiry}")
    for key, where, qty in OPENING_STOCK:
        wh, loc = ((storage.main_wh, storage.main_loc) if where == "MAIN"
                   else (storage.west_wh, storage.west_loc))
        payload = api.call("POST", "/stock/in", wh_token, {
            "product_id": products[key]["id"], "warehouse_id": wh, "location_id": loc,
            "quantity": qty, "remark": "Demo opening stock"},
            idem=api.key(f"stock-in-{key}-{where}"), retries=2, expect=(200,))
        _require(_data(payload, "current_stock"), f"stock-in result for {key}@{where}")
        print(f"  stock-in {products[key]['sku']} @{where}: +{qty}")


# --------------------------------------------------------------------------- #
# Lifecycles
# --------------------------------------------------------------------------- #

def seed_reference(api: Api, admin_token: str) -> dict:
    cust = api.call("POST", "/customers", admin_token,
                    {"customer_name": "DEMO Retail Partner", "phone": "+66 2 000 0000"}, expect=(201,))
    sup = api.call("POST", "/suppliers", admin_token,
                   {"supplier_name": "DEMO Wholesale Supply", "contact_name": "Somchai P."}, expect=(201,))
    api.call("POST", "/categories", admin_token, {"category_name": "DEMO Beverages"}, expect=(201,))
    return {"customer_id": _require(_data(cust, "id"), "customer id"),
            "supplier_id": _require(_data(sup, "id"), "supplier id")}


def seed_pos(api: Api, admin_token, wh_token, ref, product) -> dict:
    pid = product["id"]

    def make_po(qty):
        payload = api.call("POST", "/purchase-orders", admin_token, {
            "supplier_id": ref["supplier_id"],
            "items": [{"product_id": pid, "quantity": f"{qty}.000", "unit_price": "1.00"}]}, expect=(201,))
        return _require(_data(payload, "id"), "purchase order id")

    def receive(po_id, qty, scope):
        api.call("POST", f"/purchase-orders/{po_id}/confirm", admin_token)
        api.call("POST", f"/purchase-orders/{po_id}/receive", wh_token,
                 {"items": [{"product_id": pid, "quantity": f"{qty}.000"}]},
                 idem=api.key(f"po-{po_id}-{scope}"), retries=2)

    pos = {"draft": make_po(4), "partial": make_po(4)}
    receive(pos["partial"], 1, "partial")
    pos["received"] = make_po(2)
    receive(pos["received"], 2, "full")
    pos["cancelled"] = make_po(3)
    api.call("POST", f"/purchase-orders/{pos['cancelled']}/cancel", admin_token)
    print(f"  POs: {pos}")
    return pos


def return_probe_factory(session_factory):
    """Read-only DB evidence for one order's return: stock, receipts, ledger rows."""
    from sqlalchemy import text

    def probe(sales_order_id: int, product_id: int) -> dict:
        with session_factory() as s:
            q = lambda sql: s.execute(text(sql), {"so": sales_order_id, "p": product_id}).scalar()
            return {
                "on_hand": Decimal(q(
                    "SELECT coalesce(sum(b.on_hand_qty), 0) FROM stock_balances b "
                    "JOIN warehouses w ON w.id = b.warehouse_id "
                    "WHERE b.product_id = :p AND w.warehouse_type <> 'TRANSIT'")),
                "receipts": q("SELECT count(*) FROM sales_return_receipts WHERE sales_order_id = :so"),
                "transactions": q("SELECT count(*) FROM stock_transactions "
                                  "WHERE product_id = :p AND transaction_type = 'SALE_RETURN'"),
                "movements": q("SELECT count(*) FROM inventory_movements "
                               "WHERE movement_type = 'SALES_RETURN' AND reference_id = :so "
                               "AND product_id = :p"),
            }
    return probe


def seed_return(api: Api, wh_token: str, sales_order_id: int, product_id: int,
                quantity: str, probe) -> dict:
    """V1-H5: one keyed sales return, retried with the same key after a lost
    response, then proven to have applied exactly once and to replay unchanged."""
    path = f"/sales-orders/{sales_order_id}/return"
    body = {"items": [{"product_id": product_id, "quantity": quantity, "reason": "demo return"}]}
    key = api.key(f"so-{sales_order_id}-return")
    before = probe(sales_order_id, product_id)

    first = api.call("POST", path, wh_token, body, idem=key, retries=2, expect=(200,))
    items = _data(first, "returned_items") or []
    if (len(items) != 1 or items[0].get("product_id") != product_id
            or Decimal(str(items[0].get("returned_quantity"))) != Decimal(quantity)):
        raise SeedError(f"sales return response is incomplete or wrong: {str(first)[:300]}")

    replay = api.call("POST", path, wh_token, body, idem=key, expect=(200,))
    if _data(replay) != _data(first):
        raise SeedError("sales return replay differs from the original response")

    after = probe(sales_order_id, product_id)
    expected = {"on_hand": before["on_hand"] + Decimal(quantity),
                "receipts": before["receipts"] + 1,
                "transactions": before["transactions"] + 1,
                "movements": before["movements"] + 1}
    if after != expected:
        raise SeedError(f"sales return did not apply exactly once: before={before} "
                        f"after={after} expected={expected}")
    print(f"  return SO {sales_order_id}: +{quantity} applied once, replay identical (key {key})")
    return _data(first)


def seed_sos(api: Api, admin_token, wh_token, ref, product, probe) -> dict:
    pid, barcode = product["id"], product["barcode"]

    def make_so(qty):
        payload = api.call("POST", "/sales-orders/", admin_token, {
            "customer_id": ref["customer_id"],
            "items": [{"product_id": pid, "quantity": f"{qty}.000", "unit_price": "1.00"}]})
        return _require(_data(payload, "sales_order_id"), "sales order id")

    def to_ready(sid):
        api.call("POST", f"/sales-orders/{sid}/confirm", admin_token)
        api.call("POST", f"/sales-orders/{sid}/start-picking", wh_token)
        detail = api.call("GET", f"/sales-orders/{sid}", wh_token, expect=(200,))
        allocs = [{"allocation_id": a["id"], "quantity": a["quantity"]}
                  for it in (_data(detail, "items") or [])
                  for a in it.get("fulfillment_allocations", [])]
        _require(allocs, f"fulfillment allocations for sales order {sid}")
        for a in allocs:
            api.call("POST", f"/sales-orders/{sid}/scan-pick", wh_token,
                     {"barcode": barcode, "quantity": a["quantity"], "allocation_id": a["allocation_id"]})
        api.call("POST", f"/sales-orders/{sid}/complete-picking", wh_token, {"allocations": allocs})
        for a in allocs:
            api.call("POST", f"/sales-orders/{sid}/scan-pack", wh_token,
                     {"barcode": barcode, "quantity": a["quantity"], "allocation_id": a["allocation_id"]})
        api.call("POST", f"/sales-orders/{sid}/complete-packing", wh_token, {"allocations": allocs})

    sos = {"draft": make_so(2), "confirmed": make_so(2)}
    api.call("POST", f"/sales-orders/{sos['confirmed']}/confirm", admin_token)
    sos["picking"] = make_so(2)
    api.call("POST", f"/sales-orders/{sos['picking']}/confirm", admin_token)
    api.call("POST", f"/sales-orders/{sos['picking']}/start-picking", wh_token)
    sos["ready"] = make_so(2)
    to_ready(sos["ready"])
    sos["shipped"] = make_so(2)
    to_ready(sos["shipped"])
    api.call("POST", f"/sales-orders/{sos['shipped']}/ship", wh_token)
    sos["completed"] = make_so(2)
    to_ready(sos["completed"])
    api.call("POST", f"/sales-orders/{sos['completed']}/ship", wh_token)
    seed_return(api, wh_token, sos["completed"], pid, "1.000", probe)
    api.call("POST", f"/sales-orders/{sos['completed']}/complete", admin_token)
    sos["cancelled"] = make_so(1)
    api.call("PUT", f"/sales-orders/{sos['cancelled']}/cancel", wh_token)
    print(f"  SOs: {sos}")
    return sos


def seed_transfers(api: Api, wh_token, product, storage: Storage) -> dict:
    item = {"product_id": product["id"], "from_location_id": storage.main_loc,
            "to_location_id": storage.west_loc, "quantity": "3.000"}
    body = {"source_warehouse_id": storage.main_wh, "destination_warehouse_id": storage.west_wh,
            "items": [item]}

    def create():
        payload = api.call("POST", "/inventory-transfers", wh_token, body, expect=(201,))
        return _require((payload or {}).get("id"), "transfer id"), \
            _require(((payload or {}).get("items") or [{}])[0].get("id"), "transfer item id")

    made = {"draft": create()[0]}
    tid, _ = create()
    api.call("POST", f"/inventory-transfers/{tid}/dispatch", wh_token)
    made["in_transit"] = tid
    for label, qty in (("partially_received", "1.000"), ("completed", "3.000")):
        tid, tiid = create()
        api.call("POST", f"/inventory-transfers/{tid}/dispatch", wh_token)
        api.call("POST", f"/inventory-transfers/{tid}/receive", wh_token,
                 {"items": [{"transfer_item_id": tiid, "quantity": qty}]},
                 idem=api.key(f"tr-{tid}-{label}"), retries=2)
        made[label] = tid
    print(f"  transfers: {made}")
    return made


# --------------------------------------------------------------------------- #
# REQUIRED-STATE verification
# --------------------------------------------------------------------------- #

def verify_static(session_factory, today: dt.date) -> list[str]:
    """Data conditions the demo depends on, checked straight from the DB."""
    from sqlalchemy import func
    from app import models

    fails: list[str] = []
    with session_factory() as s:
        U, P, B, SB = models.User, models.Product, models.ProductBatch, models.StockBalance
        d0, d90 = today, today + dt.timedelta(days=NEAR_DAYS)

        for uname, role in ((ADMIN_USER, "admin"), (WH_USER, "warehouse")):
            u = s.query(U).filter(U.username == uname).first()
            if not u:
                fails.append(f"user {uname!r} missing")
            elif (getattr(u, "role", None) or "").lower() != role:
                fails.append(f"user {uname!r} role is {getattr(u,'role',None)!r}, expected {role!r}")
            elif not u.is_active:
                fails.append(f"user {uname!r} is not active")

        avail = SB.on_hand_qty - SB.reserved_qty

        def _cnt(q):
            return s.query(func.count()).select_from(SB).outerjoin(
                B, B.id == SB.batch_id).filter(q).scalar() or 0

        if not _cnt((avail > 0) & ((SB.batch_id.is_(None)) |
                                   (B.expiry_date.is_(None)) | (B.expiry_date > d90))):
            fails.append(f"no healthy stock (available > 0, not expiring within {NEAR_DAYS}d)")
        if not _cnt((B.expiry_date.isnot(None)) & (B.expiry_date < d0) & (SB.on_hand_qty > 0)):
            fails.append("no expired stock on hand")
        if not _cnt((B.expiry_date >= d0) & (B.expiry_date <= d90) & (SB.on_hand_qty > 0)):
            fails.append(f"no near-expiry stock on hand (<= {NEAR_DAYS}d)")
        if not _cnt(SB.reserved_qty > 0):
            fails.append("no reserved stock")

        low = s.query(func.count()).select_from(P).filter(
            P.minimum_stock > 0, P.stock_qty < P.minimum_stock).scalar() or 0
        if not low:
            fails.append("no low stock (product with stock_qty < minimum_stock)")

        for flag, label in ((P.track_batch.is_(True), "batch-tracked"),
                            (P.track_expiry.is_(True), "expiry-tracked"),
                            (P.track_batch.is_(False), "non-batch")):
            if not (s.query(func.count()).select_from(P).filter(flag).scalar() or 0):
                fails.append(f"no {label} product")
    return fails


def verify_lifecycle(api: Api, token: str, session_factory) -> list[str]:
    """Order / PO / transfer status coverage (public API) + movement/audit rows."""
    from sqlalchemy import func
    from app import models

    fails: list[str] = []
    with session_factory() as s:
        if not (s.query(func.count()).select_from(models.InventoryMovement).scalar() or 0):
            fails.append("no inventory movement rows (movement report would be empty)")
        if not (s.query(func.count()).select_from(models.AuditLog).scalar() or 0):
            fails.append("no audit-log rows")

    def _statuses(path):
        d = api.call("GET", path, token, expect=(200,))
        rows = d if isinstance(d, list) else ((d or {}).get("data") or {}).get("items") or []
        return {str(r.get("status", "")).upper() for r in rows}

    so = _statuses("/sales-orders/?page_size=100")
    for need in (("DRAFT",), ("CONFIRMED", "PICKING", "PACKING"),
                 ("READY_TO_SHIP", "SHIPPED"), ("COMPLETED",), ("CANCELLED",)):
        if not (so & set(need)):
            fails.append(f"no sales order in state {' / '.join(need)} (have: {sorted(so)})")

    po = _statuses("/purchase-orders?page_size=100")
    for need in ("DRAFT", "PARTIALLY_RECEIVED", "RECEIVED"):
        if need not in po:
            fails.append(f"no purchase order in state {need} (have: {sorted(po)})")

    tr = _statuses("/inventory-transfers?page_size=100")
    for need in (("DRAFT",), ("IN_TRANSIT", "PARTIALLY_RECEIVED"), ("COMPLETED",)):
        if not (tr & set(need)):
            fails.append(f"no transfer in state {' / '.join(need)} (have: {sorted(tr)})")
    return fails


# Diagnostic checks whose MISSING_EVIDENCE means stock exists without ledger
# evidence (e.g. a balance written directly). Any UNRESOLVED finding always fails.
STRICT_EVIDENCE_CHECKS = {
    "products_aggregate", "batches_aggregate", "movement_closing_balance",
    "transit_outstanding_reconciliation", "legacy_transfer_history_distinct",
}


def ledger_failures(findings: list[dict]) -> list[str]:
    fails = []
    for f in findings:
        if f["classification"] == "UNRESOLVED" or (
                f["classification"] == "MISSING_EVIDENCE" and f["check"] in STRICT_EVIDENCE_CHECKS):
            evidence = {k: v for k, v in f.items() if k not in ("check", "classification")}
            fails.append(f"ledger {f['check']} {f['classification']}: {str(evidence)[:200]}")
    return fails


def _finish(fails: list[str], mode: str) -> None:
    if fails:
        print(f"\nREQUIRED DEMO STATE CHECK: FAIL ({mode})")
        for f in fails:
            print(f"  FAIL: {f}")
        raise SystemExit(1)
    print(f"\nREQUIRED DEMO STATE CHECK: PASS ({mode})")


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

def main() -> int:
    cfg = check_guards()
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url
    from sqlalchemy.orm import sessionmaker

    from app.core.db_revision import EXPECTED_ALEMBIC_HEAD
    from app.core.security import hash_password
    from scripts.check_inventory_consistency import diagnose_inventory

    run_id = uuid.uuid4().hex[:12]
    today = dt.date.today()
    target = make_url(cfg.db_url)
    print("=" * 72)
    print("  seed_demo — DEMO / QA ONLY")
    print(f"  database : {cfg.db_name}  ({target.host}:{target.port})")
    print(f"  api      : {cfg.api}")
    print(f"  run id   : {run_id}")
    print(f"  when     : {dt.datetime.now(dt.timezone.utc).isoformat()}")
    print("=" * 72)

    engine = create_engine(target, hide_parameters=True)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    api = Api(cfg.api, run_id)
    try:
        api.wait_ready()
        print("\nbootstrap (fresh-database proof, admin user, WEST store):")
        storage = bootstrap(Session, cfg, EXPECTED_ALEMBIC_HEAD, hash_password)
        # The API accepting the user just written to cfg.db_url proves the API
        # serves this same (previously empty) database.
        A = api.token(ADMIN_USER, cfg.admin_pw)
        api.call("POST", "/auth/register", A,
                 {"username": WH_USER, "password": cfg.wh_pw, "role": "warehouse"}, expect=(201,))
        print(f"  user {WH_USER!r}: created role=warehouse (via API)")
        W = api.token(WH_USER, cfg.wh_pw)

        print("products + ledgered opening stock:")
        products = seed_products(api, A, Session)
        seed_inventory(api, W, products, storage, today)

        print("\nlifecycles:")
        ref = seed_reference(api, A)
        seed_pos(api, A, W, ref, products["flour"])
        seed_sos(api, A, W, ref, products["flour"], return_probe_factory(Session))
        seed_transfers(api, W, products["salt"], storage)

        _verify_static = lambda: verify_static(Session, today)
        _verify_lifecycle = lambda token: verify_lifecycle(api, token, Session)
        _verify_ledger = lambda: ledger_failures(diagnose_inventory(engine, today=today))
        # REQUIRED-STATE gate — a miss here exits non-zero.
        _finish(_verify_static() + _verify_lifecycle(A) + _verify_ledger(), "full")
    except SeedError as exc:
        print(f"\nseed_demo: FAILED — {exc}", file=sys.stderr)
        print("The database is now partially seeded; discard it (new volume) before retrying.",
              file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print("\nseed_demo: done. Open the app — Products / Stock / Sales / Purchase "
          "Orders / Transfers / Reports / Audit all have demo data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
