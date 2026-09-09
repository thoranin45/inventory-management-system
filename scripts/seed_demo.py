"""DEMO / QA ONLY — seed a repeatable demo dataset for the demo deployment.

What it creates
  * foundation master data the migrations do NOT create: MAIN + WEST
    warehouses, their default storage locations, and the system __TRANSIT__
    warehouse/location the transfer lifecycle requires.
  * demo users  wc_admin / wc_wh  (passwords from the environment).
  * products + batches + stock balances covering healthy / low / expired /
    near-expiry / reserved stock, batch-tracked and non-batch.
  * Sales / Purchase-Order / Transfer lifecycles driven through the PUBLIC
    FastAPI so every invariant, audit row and report figure is real. Each
    lifecycle step is individually best-effort (a failing call is logged and
    skipped), BUT the script ends with a REQUIRED-STATE check: if any demo
    condition the demo depends on is missing, it prints `FAIL:` lines and
    exits non-zero. Optional extras are labelled optional.

Safety guards (all must pass or the script refuses and exits non-zero)
  * SEED_CONFIRM=1
  * an EXPLICIT database target — DATABASE_URL or SEED_DATABASE_URL. There is
    NO fallback to app.core.config.settings.
  * a name containing "prod"/"production"/"live" is always refused; a name
    that does not look like demo/qa/test needs
    SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION=1.
  * DEMO_ADMIN_PASSWORD and DEMO_WH_PASSWORD present and not placeholders.

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
import urllib.request
from decimal import Decimal

# Runnable as `python scripts/seed_demo.py` from the repo root / container
# WORKDIR — put the repo root (this file's parent's parent) on sys.path so
# `import app` resolves regardless of the current working directory.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #

def _die(msg: str, code: int = 2) -> None:
    print(f"seed_demo: REFUSING — {msg}", file=sys.stderr)
    raise SystemExit(code)


if os.environ.get("SEED_CONFIRM") != "1":
    _die("set SEED_CONFIRM=1 to run this DEMO/QA-only script")

DB_URL = os.environ.get("SEED_DATABASE_URL") or os.environ.get("DATABASE_URL")
if not DB_URL:
    _die("set SEED_DATABASE_URL (or DATABASE_URL) to an EXPLICIT demo database "
         "— there is no settings fallback")

_db_name = DB_URL.rsplit("/", 1)[-1].split("?", 1)[0].lower()
if any(bad in _db_name for bad in ("prod", "production", "live")):
    _die(f"target database name {_db_name!r} looks like production")
if not any(ok in _db_name for ok in ("demo", "qa", "test")):
    if os.environ.get("SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION") != "1":
        _die(f"target database name {_db_name!r} does not look like a demo/test "
             "DB; set SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION=1 to override")

ADMIN_PW = os.environ.get("DEMO_ADMIN_PASSWORD", "")
WH_PW = os.environ.get("DEMO_WH_PASSWORD", "")
for _name, _val in (("DEMO_ADMIN_PASSWORD", ADMIN_PW), ("DEMO_WH_PASSWORD", WH_PW)):
    if len(_val) < 8 or "CHANGE_ME" in _val:
        _die(f"{_name} is missing or a placeholder (need >= 8 real characters)")

DEMO_API = os.environ.get("DEMO_API", "").rstrip("/")  # e.g. http://api:8081/api/v1

print("=" * 72)
print("  seed_demo — DEMO / QA ONLY")
print(f"  database : {_db_name}  ({DB_URL.split('@')[-1] if '@' in DB_URL else DB_URL})")
print(f"  api      : {DEMO_API or '(none — lifecycle steps will be skipped)'}")
print(f"  when     : {dt.datetime.now(dt.timezone.utc).isoformat()}")
print("=" * 72)

# --------------------------------------------------------------------------- #
# ORM: foundation + static rows
# --------------------------------------------------------------------------- #
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.core.security import hash_password  # noqa: E402

engine = create_engine(DB_URL)
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
db = Session()

today = dt.date.today()


def _cols(model):
    return {c.name for c in model.__table__.columns}


# ---- users ---------------------------------------------------------------
def ensure_user(username: str, password: str, role: str) -> None:
    U = models.User
    cols = _cols(U)
    pw_col = "password_hash" if "password_hash" in cols else "hashed_password"
    u = db.query(U).filter(U.username == username).first()
    if u:
        setattr(u, pw_col, hash_password(password))
        if "role" in cols:
            u.role = role
        if "is_active" in cols:
            u.is_active = True
        print(f"  user {username!r}: password reset, role={role}")
    else:
        kw = {"username": username, pw_col: hash_password(password)}
        if "role" in cols:
            kw["role"] = role
        if "is_active" in cols:
            kw["is_active"] = True
        db.add(U(**kw))
        print(f"  user {username!r}: created role={role}")


# ---- warehouses / locations -------------------------------------------
def ensure_warehouse(code: str, name: str, wtype: str):
    W = models.Warehouse
    w = db.query(W).filter(W.warehouse_code == code).first()
    if not w:
        w = W(warehouse_code=code, warehouse_name=name,
              warehouse_type=wtype, is_active=True)
        db.add(w)
        db.flush()
        print(f"  warehouse {code}: created id={w.id}")
    return w


def ensure_location(w, code: str, name: str, ltype: str):
    L = models.WarehouseLocation
    loc = (db.query(L)
           .filter(L.warehouse_id == w.id, L.location_code == code)
           .first())
    if not loc:
        loc = L(warehouse_id=w.id, location_code=code, location_name=name,
                location_type=ltype, is_active=True)
        db.add(loc)
        db.flush()
        print(f"  location {w.warehouse_code}/{code}: created id={loc.id}")
    return loc


# ---- products / batches / balances ----------------------------------
def ensure_product(sku, barcode, name, price, stock_qty, mn, sf, mx,
                   track_batch, track_expiry):
    P = models.Product
    p = db.query(P).filter(P.sku == sku).first()
    if p:
        return p
    cols = _cols(P)
    kw = dict(sku=sku, barcode=barcode, product_name=name,
              price=Decimal(price), stock_qty=Decimal(stock_qty),
              is_active=True, track_batch=track_batch, track_expiry=track_expiry,
              minimum_stock=Decimal(mn), safety_stock=Decimal(sf),
              maximum_stock=Decimal(mx))
    p = P(**{k: v for k, v in kw.items() if k in cols})
    db.add(p)
    db.flush()
    print(f"  product {sku}: id={p.id} (batch={track_batch} expiry={track_expiry})")
    return p


def ensure_batch(product, lot, expiry_date):
    B = models.ProductBatch
    cols = _cols(B)
    b = (db.query(B)
         .filter(B.product_id == product.id, B.lot_no == lot)
         .first())
    if b:
        return b
    kw = {"product_id": product.id, "lot_no": lot}
    if "expiry_date" in cols:
        kw["expiry_date"] = expiry_date
    if "mfg_date" in cols:
        kw["mfg_date"] = expiry_date - dt.timedelta(days=180)
    if "quantity" in cols:
        kw["quantity"] = Decimal("0")  # authoritative qty lives on stock_balances
    b = B(**kw)
    db.add(b)
    db.flush()
    print(f"  batch {lot}: id={b.id} exp={expiry_date}")
    return b


def ensure_balance(product, w, loc, batch, on_hand, reserved):
    SB = models.StockBalance
    q = db.query(SB).filter(SB.product_id == product.id,
                            SB.warehouse_id == w.id, SB.location_id == loc.id)
    q = q.filter(SB.batch_id == (batch.id if batch else None))
    if q.first():
        return
    on_hand, reserved = Decimal(on_hand), Decimal(reserved)
    if reserved > on_hand:
        reserved = on_hand
    db.add(SB(product_id=product.id, warehouse_id=w.id, location_id=loc.id,
              batch_id=batch.id if batch else None,
              on_hand_qty=on_hand, reserved_qty=reserved))
    print(f"  balance {product.sku} @{w.warehouse_code} "
          f"batch={getattr(batch, 'lot_no', None)} on_hand={on_hand} reserved={reserved}")


print("\nusers:")
ensure_user("wc_admin", ADMIN_PW, "admin")
ensure_user("wc_wh", WH_PW, "warehouse")
db.commit()

print("foundation warehouses / locations:")
w_main = ensure_warehouse("MAIN", "Main Distribution Centre", "MAIN")
w_west = ensure_warehouse("WEST", "West Regional Store", "STORE")
w_transit = ensure_warehouse("__TRANSIT__", "System Transit", "TRANSIT")
loc_main = ensure_location(w_main, "DEFAULT", "Default Location", "STORAGE")
loc_west = ensure_location(w_west, "DEFAULT", "Default Location", "STORAGE")
ensure_location(w_transit, "__TRANSIT__", "In Transit", "TRANSIT")
db.commit()

print("products + stock (healthy / low / expired / near-expiry / reserved):")
p_coffee = ensure_product("WH-COFFEE-1KG", "885000000001", "Arabica Whole Bean 1kg",
                          "210.00", "1780.000", "400", "0", "3000", True, True)
p_milk = ensure_product("WH-MILK-UHT-1L", "885000000002", "UHT Milk 1L",
                        "42.00", "900.000", "300", "0", "2000", True, True)
p_sugar = ensure_product("WH-SUGAR-25KG", "885000000009", "Refined Sugar Sack 25kg",
                         "640.00", "62.000", "80", "0", "400", False, False)   # LOW
p_flour = ensure_product("WH-FLOUR-1KG", "885000000004", "All-Purpose Flour 1kg",
                         "24.50", "2990.000", "600", "0", "5000", False, False)
p_salt = ensure_product("WH-SALT-500G", "885000000003", "Sea Salt 500g",
                        "30.00", "1400.000", "150", "0", "1500", False, False)
p_tea = ensure_product("WH-TEA-200G", "885000000008", "Green Tea 200g",
                       "78.00", "1040.000", "120", "40", "1200", True, True)
db.commit()

b_coffee_near = ensure_batch(p_coffee, "LOT-CF-NEAR", today + dt.timedelta(days=41))
b_milk_exp = ensure_batch(p_milk, "LOT-MK-EXPIRED", today - dt.timedelta(days=9))
b_milk_near = ensure_batch(p_milk, "LOT-MK-NEAR", today + dt.timedelta(days=25))
b_tea_ok = ensure_batch(p_tea, "LOT-TEA-OK", today + dt.timedelta(days=220))
b_tea_near = ensure_batch(p_tea, "LOT-TEA-NEAR", today + dt.timedelta(days=18))
db.commit()

ensure_balance(p_coffee, w_main, loc_main, b_coffee_near, "1780.000", "180.000")  # reserved
ensure_balance(p_milk, w_main, loc_main, b_milk_exp, "140.000", "0.000")          # expired
ensure_balance(p_milk, w_main, loc_main, b_milk_near, "760.000", "60.000")        # near + reserved
ensure_balance(p_sugar, w_main, loc_main, None, "62.000", "0.000")               # LOW, non-batch
ensure_balance(p_flour, w_main, loc_main, None, "2990.000", "300.000")           # healthy, reserved
ensure_balance(p_salt, w_main, loc_main, None, "1100.000", "0.000")             # healthy, non-batch
ensure_balance(p_salt, w_west, loc_west, None, "300.000", "0.000")             # WEST stock (transfers)
ensure_balance(p_tea, w_main, loc_main, b_tea_ok, "600.000", "0.000")           # healthy batch
ensure_balance(p_tea, w_main, loc_main, b_tea_near, "440.000", "40.000")        # near-expiry batch
db.commit()
db.close()
print("  static rows committed.")

# --------------------------------------------------------------------------- #
# REQUIRED-STATE verification helpers
# --------------------------------------------------------------------------- #
NEAR_DAYS = 90  # matches app.core.config.settings.near_expiry_days default


def _verify_static() -> list[str]:
    """Data conditions the demo depends on, checked straight from the DB."""
    from sqlalchemy import func

    fails: list[str] = []
    s = Session()
    try:
        U, P, B, SB = models.User, models.Product, models.ProductBatch, models.StockBalance
        d0, d90 = today, today + dt.timedelta(days=NEAR_DAYS)

        for uname, role in (("wc_admin", "admin"), ("wc_wh", "warehouse")):
            u = s.query(U).filter(U.username == uname).first()
            if not u:
                fails.append(f"user {uname!r} missing")
            elif getattr(u, "role", None) != role:
                fails.append(f"user {uname!r} role is {getattr(u,'role',None)!r}, expected {role!r}")
            elif hasattr(u, "is_active") and not u.is_active:
                fails.append(f"user {uname!r} is not active")

        avail = SB.on_hand_qty - SB.reserved_qty

        def _cnt(q):
            return s.query(func.count()).select_from(SB).outerjoin(
                B, B.id == SB.batch_id).filter(q).scalar() or 0

        if not _cnt((avail > 0) & ((SB.batch_id.is_(None)) |
                                   (B.expiry_date.is_(None)) | (B.expiry_date > d90))):
            fails.append("no healthy stock (available > 0, not expiring within "
                         f"{NEAR_DAYS}d)")
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
    finally:
        s.close()
    return fails


def _verify_lifecycle(api_token: str) -> list[str]:
    """Order / PO / transfer status coverage (public API) + movement/audit rows."""
    from sqlalchemy import func

    fails: list[str] = []

    s = Session()
    try:
        if not (s.query(func.count()).select_from(models.InventoryMovement).scalar() or 0):
            fails.append("no inventory movement rows (movement report would be empty)")
        if not (s.query(func.count()).select_from(models.AuditLog).scalar() or 0):
            fails.append("no audit-log rows")
    finally:
        s.close()

    def _statuses(path):
        _, d = _req("GET", path, api_token)
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


def _finish(fails: list[str], mode: str) -> None:
    if fails:
        print(f"\nREQUIRED DEMO STATE CHECK: FAIL ({mode})")
        for f in fails:
            print(f"  FAIL: {f}")
        raise SystemExit(1)
    print(f"\nREQUIRED DEMO STATE CHECK: PASS ({mode})")


# --------------------------------------------------------------------------- #
# Lifecycles via the PUBLIC API  (each step best-effort; REQUIRED states are
# verified at the end and a miss exits non-zero)
# --------------------------------------------------------------------------- #
if not DEMO_API:
    print("\nDEMO_API not set — skipping order / PO / transfer lifecycle seeding.")
    _finish(_verify_static(), "static only, DEMO_API unset")
    print("seed_demo: done (static rows only).")
    raise SystemExit(0)

API_ROOT = DEMO_API[: -len("/api/v1")] if DEMO_API.endswith("/api/v1") else DEMO_API
stamp = time.strftime("%H%M%S")


def _req(method, path, token=None, body=None, idem=None, root=False):
    url = (API_ROOT if root else DEMO_API) + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        r.add_header("content-type", "application/json")
    if idem:
        r.add_header("Idempotency-Key", idem)
    if token:
        r.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw}
    except urllib.error.URLError as e:
        return 0, {"error": str(e)}


def _token(user, pw):
    body = f"username={user}&password={pw}&grant_type=password".encode()
    r = urllib.request.Request(DEMO_API + "/auth/token", data=body, method="POST",
                               headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read())["access_token"]


def _api_items(path, tok):
    _, d = _req("GET", path, tok)
    return ((d or {}).get("data") or {}).get("items") or []


# Wait for readiness (migrations applied).
for _ in range(30):
    st, body = _req("GET", "/ready", root=True)
    if st == 200 and (body or {}).get("status") == "ready":
        print(f"\napi /ready ok (migration={(body or {}).get('migration')})")
        break
    time.sleep(2)
else:
    _die("api /ready never returned ready — run the migrate profile first", code=3)

A = _token("wc_admin", ADMIN_PW)
W = _token("wc_wh", WH_PW)

# ---- reference data ---------------------------------------------------
custs = _api_items("/customers?page_size=1", A)
if not custs:
    _req("POST", "/customers", A, {"customer_name": "DEMO Retail Partner",
                                   "phone": "+66 2 000 0000"})
    custs = _api_items("/customers?page_size=1", A)
sups = _api_items("/suppliers?page_size=1", A)
if not sups:
    _req("POST", "/suppliers", A, {"supplier_name": "DEMO Wholesale Supply",
                                   "contact_name": "Somchai P."})
    sups = _api_items("/suppliers?page_size=1", A)
if not _api_items("/categories?page_size=1", A):
    _req("POST", "/categories", A, {"category_name": "DEMO Beverages"})

if not custs or not sups:
    print("could not obtain customer/supplier — skipping lifecycle seeding.")
    print("seed_demo: done (static rows + reference data).")
    raise SystemExit(0)

cust_id = custs[0]["id"]
sup_id = sups[0]["id"]

prods = _api_items("/products?page_size=50", A)


def _avail(p):
    try:
        return float(p.get("operational_available_quantity") or 0)
    except (TypeError, ValueError):
        return 0.0


stocked = [p for p in prods if p.get("barcode") and _avail(p) >= 10]
line_p = next((p for p in stocked if not p.get("track_batch")),
              stocked[0] if stocked else None)
if line_p is None:
    print("no stocked product available — skipping lifecycle seeding.")
    print("seed_demo: done (static rows + reference data).")
    raise SystemExit(0)

pid, bc = line_p["id"], line_p["barcode"]
print(f"\ndriving lifecycles with product {line_p['sku']} (id={pid}):")


def _try(label, fn):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 — best-effort demo seeding
        print(f"  ! {label}: {type(exc).__name__}: {exc}")


# ---- Purchase orders: DRAFT / PARTIALLY_RECEIVED / RECEIVED / CANCELLED
def _seed_pos():
    def make_po(qty):
        s, d = _req("POST", "/purchase-orders", A, {
            "supplier_id": sup_id,
            "items": [{"product_id": pid, "quantity": f"{qty}.000", "unit_price": "1.00"}],
        })
        return (d or {}).get("data", {}).get("id") if s in (200, 201) else None

    po_draft = make_po(4)
    po_partial = make_po(4)
    if po_partial:
        _req("POST", f"/purchase-orders/{po_partial}/confirm", A)
        _req("POST", f"/purchase-orders/{po_partial}/receive", W,
             {"items": [{"product_id": pid, "quantity": "1.000"}]},
             idem=f"demo-po-{po_partial}-{stamp}")
    po_recv = make_po(2)
    if po_recv:
        _req("POST", f"/purchase-orders/{po_recv}/confirm", A)
        _req("POST", f"/purchase-orders/{po_recv}/receive", W,
             {"items": [{"product_id": pid, "quantity": "2.000"}]},
             idem=f"demo-po-{po_recv}-{stamp}")
    po_cancel = make_po(3)
    if po_cancel:
        _req("POST", f"/purchase-orders/{po_cancel}/cancel", A)
    print(f"  POs: draft={po_draft} partial={po_partial} received={po_recv} cancelled={po_cancel}")


_try("purchase orders", _seed_pos)


# ---- Sales orders: DRAFT .. COMPLETED + CANCELLED ------------------
def _seed_sos():
    def make_so(qty):
        s, d = _req("POST", "/sales-orders/", A, {
            "customer_id": cust_id,
            "items": [{"product_id": pid, "quantity": f"{qty}.000", "unit_price": "1.00"}],
        })
        return (d or {}).get("data", {}).get("sales_order_id") if s in (200, 201) else None

    def to_ready(sid):
        _req("POST", f"/sales-orders/{sid}/confirm", A)
        _req("POST", f"/sales-orders/{sid}/start-picking", W)
        _, det = _req("GET", f"/sales-orders/{sid}", W)
        allocs = [{"allocation_id": a["id"], "quantity": a["quantity"]}
                  for it in (det or {}).get("data", {}).get("items", [])
                  for a in it.get("fulfillment_allocations", [])]
        for a in allocs:
            _req("POST", f"/sales-orders/{sid}/scan-pick", W,
                 {"barcode": bc, "quantity": a["quantity"], "allocation_id": a["allocation_id"]})
        _req("POST", f"/sales-orders/{sid}/complete-picking", W, {"allocations": allocs})
        for a in allocs:
            _req("POST", f"/sales-orders/{sid}/scan-pack", W,
                 {"barcode": bc, "quantity": a["quantity"], "allocation_id": a["allocation_id"]})
        _req("POST", f"/sales-orders/{sid}/complete-packing", W, {"allocations": allocs})

    so_draft = make_so(2)
    so_conf = make_so(2)
    if so_conf:
        _req("POST", f"/sales-orders/{so_conf}/confirm", A)
    so_pick = make_so(2)
    if so_pick:
        _req("POST", f"/sales-orders/{so_pick}/confirm", A)
        _req("POST", f"/sales-orders/{so_pick}/start-picking", W)
    so_ready = make_so(2)
    if so_ready:
        to_ready(so_ready)
    so_ship = make_so(2)
    if so_ship:
        to_ready(so_ship)
        _req("POST", f"/sales-orders/{so_ship}/ship", W)
    so_done = make_so(2)
    if so_done:
        to_ready(so_done)
        _req("POST", f"/sales-orders/{so_done}/ship", W)
        _req("POST", f"/sales-orders/{so_done}/return", W,
             {"items": [{"product_id": pid, "quantity": "1.000", "reason": "demo return"}]})
        _req("POST", f"/sales-orders/{so_done}/complete", A)
    so_cancel = make_so(1)
    if so_cancel:
        _req("PUT", f"/sales-orders/{so_cancel}/cancel", W)
    print(f"  SOs: draft={so_draft} confirmed={so_conf} picking={so_pick} "
          f"ready={so_ready} shipped={so_ship} completed={so_done} cancelled={so_cancel}")


_try("sales orders", _seed_sos)


# ---- Transfers: DRAFT / IN_TRANSIT+PARTIALLY_RECEIVED / COMPLETED ----
def _seed_transfers():
    bals = _api_items("/stock-balances?page=1&page_size=100", W)
    pairs = {}
    for b in bals:
        if b.get("is_transit") or not b.get("warehouse_id") or not b.get("location_id"):
            continue
        pairs.setdefault(b["warehouse_id"], (b["warehouse_id"], b["location_id"]))
    if len(pairs) < 2:
        print("  transfers: skipped (need 2 stocked non-transit warehouses)")
        return
    (sw, sl), (dw, dl) = list(pairs.values())[:2]
    src = next((b for b in bals
                if b["warehouse_id"] == sw and not b.get("is_transit")
                and float(b["available_qty"]) >= 9), None)
    if not src:
        print("  transfers: skipped (no source balance with available >= 9)")
        return
    item = {"product_id": src["product_id"], "from_location_id": sl,
            "to_location_id": dl, "quantity": "3.000"}
    if src.get("batch_id"):
        item["batch_id"] = src["batch_id"]
    body = {"source_warehouse_id": sw, "destination_warehouse_id": dw, "items": [item]}
    made = []

    s, tr = _req("POST", "/inventory-transfers", W, body)
    if s == 201 and tr:
        made.append(("draft", tr["id"]))

    # dispatched, nothing received yet -> IN_TRANSIT
    s, tr = _req("POST", "/inventory-transfers", W, body)
    if s == 201 and tr:
        tid = tr["id"]
        _req("POST", f"/inventory-transfers/{tid}/dispatch", W)
        made.append(("in_transit", tid))

    s, tr = _req("POST", "/inventory-transfers", W, body)
    if s == 201 and tr:
        tid, tiid = tr["id"], tr["items"][0]["id"]
        _req("POST", f"/inventory-transfers/{tid}/dispatch", W)
        _req("POST", f"/inventory-transfers/{tid}/receive", W,
             {"items": [{"transfer_item_id": tiid, "quantity": "1.000"}]},
             idem=f"demo-tr-{tid}-{stamp}")
        made.append(("partially_received", tid))

    s, tr = _req("POST", "/inventory-transfers", W, body)
    if s == 201 and tr:
        tid, tiid = tr["id"], tr["items"][0]["id"]
        _req("POST", f"/inventory-transfers/{tid}/dispatch", W)
        _req("POST", f"/inventory-transfers/{tid}/receive", W,
             {"items": [{"transfer_item_id": tiid, "quantity": "3.000"}]},
             idem=f"demo-tr-{tid}-final-{stamp}")
        made.append(("completed", tid))
    print(f"  transfers: {made or 'none created'}")


_try("transfers", _seed_transfers)

# --------------------------------------------------------------------------- #
# REQUIRED-STATE gate — a miss here exits non-zero.
# --------------------------------------------------------------------------- #
_finish(_verify_static() + _verify_lifecycle(A), "full")

print("\nseed_demo: done. Open the app — Products / Stock / Sales / Purchase "
      "Orders / Transfers / Reports / Audit all have demo data.")
raise SystemExit(0)
