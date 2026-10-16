"""V1-H5: demo seed hardening -- offline tests.

No database server and no network: the API is a fake transport with V1-H1
return semantics, users live in an in-memory SQLite ``users`` table, and the
ledger gate is fed synthetic diagnostic snapshots. Runs with or without the
shared conftest (``pytest --noconftest tests/test_v1h5_seed_demo.py``).
"""
import datetime as dt
import json
import re
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import User
from scripts import seed_demo as seed
from scripts.check_inventory_consistency import analyze_inventory

SEED_SRC = (Path(__file__).resolve().parents[1] / "scripts" / "seed_demo.py").read_text(encoding="utf-8")
KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")  # the API's Idempotency-Key rule
SO_ID, PRODUCT_ID = 7, 3


class ReturnServer:
    """Fake POST /sales-orders/{id}/return with V1-H1 semantics: a key replays
    its stored response, a reused key with another payload is 409, a missing
    key is 422. ``lose`` = number of leading responses lost AFTER applying."""

    def __init__(self, *, lose=0, honour_keys=True, status=None, response=None):
        self.state = {"on_hand": Decimal("10.000"), "receipts": 0, "transactions": 0, "movements": 0}
        self.stored = {}
        self.calls = []
        self.lose, self.honour_keys, self.status, self.response = lose, honour_keys, status, response

    def transport(self, method, url, headers, data):
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "data": data})
        if self.status:
            return self.status, {"detail": "rejected"}
        key = headers.get("Idempotency-Key")
        if not key:
            return 422, {"detail": [{"loc": ["header", "Idempotency-Key"], "msg": "Field required"}]}
        if self.honour_keys and key in self.stored:
            payload, response = self.stored[key]
            if payload != data:
                return 409, {"detail": "Idempotency-Key already used with a different payload"}
            return self._deliver(response)
        quantity = Decimal(json.loads(data)["items"][0]["quantity"])
        self.state["on_hand"] += quantity
        for counter in ("receipts", "transactions", "movements"):
            self.state[counter] += 1
        response = self.response or {"success": True, "data": {
            "sales_order_id": SO_ID, "returned_items": [{
                "product_id": PRODUCT_ID, "returned_quantity": format(quantity, ".3f"),
                "previously_returned": "0.000", "total_returned": format(quantity, ".3f"),
                "remaining_returnable": "1.000"}]}}
        self.stored[key] = (data, response)
        return self._deliver(response)

    def _deliver(self, response):
        if self.lose:
            self.lose -= 1
            return 0, {"error": "TimeoutError"}  # processed, but the client never sees it
        return 200, response

    def probe(self, sales_order_id, product_id):
        assert (sales_order_id, product_id) == (SO_ID, PRODUCT_ID)
        return dict(self.state)


def _api(transport, run_id="run123"):
    return seed.Api("http://api.test/api/v1", run_id, transport=transport, sleep=lambda _: None)


def _return(server, run_id="run123"):
    return seed.seed_return(_api(server.transport, run_id), "tok", SO_ID, PRODUCT_ID, "1.000", server.probe)


# --------------------------------------------------------------------------- #
# Sales return: key, status validation, exactly-once, replay, lost response
# --------------------------------------------------------------------------- #

def test_successful_return_sends_a_run_and_order_scoped_key_and_applies_once():
    server = ReturnServer()
    data = _return(server)
    assert data["returned_items"][0]["returned_quantity"] == "1.000"
    keys = {c["headers"]["Idempotency-Key"] for c in server.calls}
    assert keys == {"seed-run123-so-7-return"} and KEY_RE.match(keys.pop())
    assert len(server.calls) == 2  # the return + its verified replay
    assert server.state == {"on_hand": Decimal("11.000"), "receipts": 1, "transactions": 1, "movements": 1}


def test_key_is_deterministic_per_run_and_scoped_to_run_and_order():
    api = _api(None)
    assert api.key("so-7-return") == api.key("so-7-return")
    assert api.key("so-7-return") != api.key("so-8-return")
    assert _api(None, "otherrun").key("so-7-return") != api.key("so-7-return")


@pytest.mark.parametrize("status", [422, 409, 400, 403, 404, 500])
def test_a_rejected_return_fails_the_seed_and_changes_nothing(status):
    server = ReturnServer(status=status)
    with pytest.raises(seed.SeedError, match=f"HTTP {status}"):
        _return(server)
    assert server.state["on_hand"] == Decimal("10.000") and server.state["receipts"] == 0
    assert len(server.calls) == 1  # a 4xx/500 is never retried


def test_a_missing_idempotency_key_is_reported_not_ignored():
    server = ReturnServer()
    with pytest.raises(seed.SeedError, match="HTTP 422"):
        _api(server.transport).call("POST", f"/sales-orders/{SO_ID}/return", "tok",
                                    {"items": [{"product_id": PRODUCT_ID, "quantity": "1.000"}]})
    assert server.state["receipts"] == 0


def test_repeating_the_same_seed_return_never_restocks_twice():
    server = ReturnServer()
    _return(server)
    with pytest.raises(seed.SeedError, match="did not apply exactly once"):
        _return(server)  # same run + order -> same key -> replay, nothing applied
    assert server.state == {"on_hand": Decimal("11.000"), "receipts": 1, "transactions": 1, "movements": 1}


def test_a_server_that_ignores_keys_is_detected():
    server = ReturnServer(honour_keys=False)
    with pytest.raises(seed.SeedError):
        _return(server)


def test_lost_response_is_retried_with_the_same_key_and_applied_once():
    server = ReturnServer(lose=1)
    data = _return(server)
    assert data["returned_items"][0]["product_id"] == PRODUCT_ID
    assert len(server.calls) == 3  # lost attempt, retry (replayed), verification replay
    assert {c["headers"]["Idempotency-Key"] for c in server.calls} == {"seed-run123-so-7-return"}
    assert len({c["data"] for c in server.calls}) == 1  # byte-identical payload on every attempt
    assert server.state == {"on_hand": Decimal("11.000"), "receipts": 1, "transactions": 1, "movements": 1}


def test_lost_responses_beyond_the_retry_budget_fail_without_double_apply():
    server = ReturnServer(lose=5)
    with pytest.raises(seed.SeedError, match="HTTP 0"):
        _return(server)
    assert server.state["receipts"] == 1 and server.state["on_hand"] == Decimal("11.000")


@pytest.mark.parametrize("response", [
    {"success": True, "data": {"returned_items": []}},
    {"success": True, "data": {"returned_items": [{"product_id": PRODUCT_ID, "returned_quantity": "2.000"}]}},
    {"success": True, "data": {"returned_items": [{"product_id": 999, "returned_quantity": "1.000"}]}},
    {"success": True},
])
def test_an_incomplete_or_wrong_return_response_fails(response):
    with pytest.raises(seed.SeedError, match="incomplete or wrong"):
        _return(ReturnServer(response=response))


# --------------------------------------------------------------------------- #
# Checked API client: no silent 4xx/5xx, retries only for keyed requests
# --------------------------------------------------------------------------- #

class Scripted:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def __call__(self, method, url, headers, data):
        self.calls.append((method, url, dict(headers), data))
        return self.responses.pop(0)


@pytest.mark.parametrize("status", [0, 400, 401, 403, 404, 409, 422, 500, 502, 503, 504])
def test_unkeyed_failures_raise_immediately(status):
    transport = Scripted((status, {"detail": "x"}))
    with pytest.raises(seed.SeedError, match=f"HTTP {status}"):
        _api(transport).call("POST", "/sales-orders/1/confirm", "tok")
    assert len(transport.calls) == 1  # a lost non-idempotent response is never re-sent


def test_keyed_requests_retry_only_transport_and_gateway_failures():
    transport = Scripted((503, None), (0, None), (201, {"data": {"batch": {"id": 1}}}))
    assert _api(transport).call("POST", "/batches", "tok", {"a": 1}, idem="seed-r-x", retries=2,
                                expect=(201,)) == {"data": {"batch": {"id": 1}}}
    assert [c[2]["Idempotency-Key"] for c in transport.calls] == ["seed-r-x"] * 3

    transport = Scripted((409, {"detail": "conflict"}))
    with pytest.raises(seed.SeedError, match="HTTP 409"):
        _api(transport).call("POST", "/batches", "tok", {"a": 1}, idem="seed-r-x", retries=2)
    assert len(transport.calls) == 1


def test_login_form_is_url_encoded_and_errors_never_echo_the_password():
    transport = Scripted((200, {"access_token": "t"}), (401, {"detail": "pw&=x+y secret"}))
    api = _api(transport)
    assert api.token("wc_admin", "pw&=x+y secret") == "t"
    assert b"password=pw%26%3Dx%2By+secret" in transport.calls[0][3]
    with pytest.raises(seed.SeedError) as failed:
        api.token("wc_admin", "pw&=x+y secret")
    assert "secret" not in str(failed.value)


def test_no_best_effort_paths_remain_in_the_seed():
    assert "_try(" not in SEED_SRC and "except Exception" not in SEED_SRC
    assert "best-effort" not in SEED_SRC.split('"""', 2)[2]  # outside the module docstring


# --------------------------------------------------------------------------- #
# Existing users are never modified
# --------------------------------------------------------------------------- #

@pytest.fixture
def user_session():
    engine = create_engine("sqlite://")
    User.__table__.create(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def test_existing_demo_user_is_detected_and_never_modified(user_session):
    user_session.add(User(username="wc_admin", password_hash="ORIGINAL", role="WAREHOUSE", is_active=False))
    user_session.commit()
    with pytest.raises(seed.SeedError, match="already exists"):
        seed.create_user_once(user_session, "wc_admin", "new-password", "ADMIN", hasher=lambda p: "NEW")
    user_session.rollback()
    row = user_session.query(User).filter_by(username="wc_admin").one()
    assert (row.password_hash, row.role, row.is_active) == ("ORIGINAL", "WAREHOUSE", False)


def test_a_new_demo_user_is_created_with_a_hashed_password(user_session):
    seed.create_user_once(user_session, "wc_admin", "new-password", "ADMIN", hasher=lambda p: f"H({p})")
    row = user_session.query(User).filter_by(username="wc_admin").one()
    assert (row.password_hash, row.role, row.is_active) == ("H(new-password)", "ADMIN", True)


def test_no_code_path_resets_a_password():
    assert "ensure_user" not in SEED_SRC and "setattr(" not in SEED_SRC
    assert ": password reset" not in SEED_SRC  # the old "user ...: password reset" path


# --------------------------------------------------------------------------- #
# Fresh, disposable database only
# --------------------------------------------------------------------------- #
HEAD = "ec1a00000001"


def _db(counts=None, storage=None, head=HEAD, name="inventory_demo"):
    counts = counts or {}
    storage = seed.MIGRATION_STORAGE if storage is None else storage

    def scalar(sql):
        if sql == "SELECT current_database()":
            return name
        if sql == "SELECT version_num FROM alembic_version":
            return head
        return counts.get(sql.rsplit(" ", 1)[-1], 0)
    return scalar, lambda sql: list(storage)


def test_a_freshly_migrated_database_passes():
    assert seed.freshness_problems(*_db(), HEAD, "inventory_demo") == []


@pytest.mark.parametrize("table", seed.FRESH_EMPTY_TABLES)
def test_any_existing_row_means_not_fresh(table):
    problems = seed.freshness_problems(*_db(counts={table: 1}), HEAD, "inventory_demo")
    assert problems == [f"{table} already has 1 row(s)"]


@pytest.mark.parametrize("kwargs,expected", [
    ({"head": "eb1a00000001"}, "not the expected head"),
    ({"head": None}, "not the expected head"),
    ({"name": "inventory_dev"}, "is not the configured"),
    ({"storage": seed.MIGRATION_STORAGE | {("WEST", "DEFAULT")}}, "migration-provisioned"),
    ({"storage": {("__TRANSIT__", "__TRANSIT__")}}, "migration-provisioned"),
])
def test_wrong_revision_database_or_storage_means_not_fresh(kwargs, expected):
    problems = seed.freshness_problems(*_db(**kwargs), HEAD, "inventory_demo")
    assert len(problems) == 1 and expected in problems[0]


def test_core_business_tables_are_all_covered():
    for table in ("users", "products", "stock_balances", "stock_transactions", "inventory_movements",
                  "sales_orders", "purchase_orders", "inventory_transfers", "audit_logs",
                  "sales_return_receipts"):
        assert table in seed.FRESH_EMPTY_TABLES


class FakeSession:
    """Records SQL; any ORM read or write fails the test."""

    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def begin(self):
        return self

    def execute(self, statement):
        self.log.append(str(statement))

    def query(self, *_):
        raise AssertionError("bootstrap touched the ORM before proving freshness")

    add = query


def test_bootstrap_locks_then_refuses_a_non_fresh_database_before_writing(monkeypatch):
    log = []
    monkeypatch.setattr(seed, "freshness_problems", lambda *a: ["users already has 2 row(s)"])
    cfg = seed.SeedConfig("postgresql://u:x@db/inventory_demo", "inventory_demo", "a" * 8, "b" * 8, "http://x")
    with pytest.raises(seed.SeedError, match="not a fresh demo database"):
        seed.bootstrap(lambda: FakeSession(log), cfg, HEAD, hasher=lambda p: p)
    assert log == ["LOCK TABLE users, warehouses, warehouse_locations IN EXCLUSIVE MODE"]


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #

@pytest.fixture
def guard_env(monkeypatch):
    for name in ("SEED_DATABASE_URL", "SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SEED_CONFIRM", "1")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:x@db:5432/inventory_demo")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "demo-admin-pass")
    monkeypatch.setenv("DEMO_WH_PASSWORD", "demo-wh-pass")
    monkeypatch.setenv("DEMO_API", "http://api:8081/api/v1/")
    return monkeypatch


def test_guards_accept_a_complete_demo_configuration(guard_env):
    cfg = seed.check_guards()
    assert (cfg.db_name, cfg.api) == ("inventory_demo", "http://api:8081/api/v1")


@pytest.mark.parametrize("change,message", [
    ({"DEMO_API": None}, "DEMO_API"),
    ({"DEMO_WH_PASSWORD": "x" * 73}, "72 UTF-8 bytes"),
    ({"DATABASE_URL": "postgresql+psycopg2://u:x@db:5432/inventory_live"}, "production"),
    ({"SEED_CONFIRM": "0"}, "SEED_CONFIRM"),
])
def test_guards_refuse(guard_env, capsys, change, message):
    for name, value in change.items():
        if value is None:
            guard_env.delenv(name)
        else:
            guard_env.setenv(name, value)
    with pytest.raises(SystemExit) as refused:
        seed.check_guards()
    assert refused.value.code == 2 and message in capsys.readouterr().err


def test_importing_the_seed_has_no_side_effects():
    assert 'if __name__ == "__main__":' in SEED_SRC
    assert "create_engine(" not in SEED_SRC.split("def main", 1)[0]


# --------------------------------------------------------------------------- #
# Stock only through the ledgered API
# --------------------------------------------------------------------------- #

def test_seed_never_writes_stock_or_ledger_rows_directly():
    for forbidden in ("StockBalance(", "StockTransaction(", "InventoryMovement(", "on_hand_qty =",
                      "reserved_qty =", "stock_qty =", "INSERT INTO", "UPDATE stock", "ensure_balance"):
        assert forbidden not in SEED_SRC, forbidden


def test_opening_stock_goes_through_batches_and_stock_in_with_keys():
    calls = []

    def transport(method, url, headers, data):
        calls.append((method, url, headers.get("Idempotency-Key"), json.loads(data)))
        return (201, {"data": {"batch": {"id": len(calls)}}}) if url.endswith("/batches") \
            else (200, {"data": {"current_stock": "1"}})

    products = {k: {"id": i, "sku": v[0]} for i, (k, v) in enumerate(seed.PRODUCTS.items(), 1)}
    storage = seed.Storage(main_wh=1, main_loc=10, west_wh=2, west_loc=20)
    today = dt.date(2026, 10, 17)
    seed.seed_inventory(_api(transport), "tok", products, storage, today)

    assert {(m, u.rsplit("/api/v1", 1)[1]) for m, u, _, _ in calls} == {("POST", "/batches"), ("POST", "/stock/in")}
    keys = [k for _, _, k, _ in calls]
    assert all(k and KEY_RE.match(k) and k.startswith("seed-run123-") for k in keys)
    assert len(set(keys)) == len(keys) == len(seed.OPENING_BATCHES) + len(seed.OPENING_STOCK)
    batches = {b["lot_no"]: b for _, u, _, b in calls if u.endswith("/batches")}
    expired = batches["LOT-MK-EXPIRED"]
    assert dt.date.fromisoformat(expired["expiry_date"]) < today
    assert all(dt.date.fromisoformat(b["mfg_date"]) < dt.date.fromisoformat(b["expiry_date"])
               for b in batches.values())
    west = [b for _, u, _, b in calls if u.endswith("/stock/in") and b["warehouse_id"] == 2]
    assert west == [{"product_id": products["salt"]["id"], "warehouse_id": 2, "location_id": 20,
                     "quantity": "300.000", "remark": "Demo opening stock"}]


def test_a_rejected_opening_stock_call_aborts_the_seed():
    transport = Scripted((201, {"data": {"batch": {"id": 1}}}), (409, {"detail": "Duplicate lot"}))
    products = {k: {"id": i} for i, k in enumerate(seed.PRODUCTS, 1)}
    with pytest.raises(seed.SeedError, match="HTTP 409"):
        seed.seed_inventory(_api(transport), "tok", products, seed.Storage(1, 10, 2, 20), dt.date(2026, 10, 17))


# --------------------------------------------------------------------------- #
# Final-state validation (ledger gate over the read-only diagnostic)
# --------------------------------------------------------------------------- #
D = Decimal


def _snapshot(*, on_hand="5", stock_qty="5", movement=True, link=True):
    balance = {"id": 1, "product_id": 1, "warehouse_id": 1, "location_id": 1, "batch_id": None,
               "on_hand_qty": D(on_hand), "reserved_qty": D("0")}
    movements = [{"id": 1, "product_id": 1, "warehouse_id": 1, "location_id": 1, "batch_id": None,
                  "quantity": D("5"), "balance_before": D("0"), "balance_after": D("5"),
                  "reference_type": "STOCK_TRANSACTION" if link else "SALES_ORDER", "reference_id": 1,
                  "movement_type": "STOCK_IN", "stock_transaction_id": 1 if link else None}] if movement else []
    return {"products": [{"id": 1, "stock_qty": D(stock_qty)}], "batches": [], "balances": [balance],
            "movements": movements,
            "transactions": [{"id": 1, "product_id": 1, "transaction_type": "IN", "quantity": D("5")}]}


def test_a_ledgered_state_passes_the_gate():
    assert seed.ledger_failures(analyze_inventory(_snapshot(), today=dt.date(2026, 10, 17))) == []


def test_a_directly_inserted_balance_fails_the_gate():
    fails = seed.ledger_failures(analyze_inventory(_snapshot(movement=False), today=dt.date(2026, 10, 17)))
    assert any("movement_closing_balance MISSING_EVIDENCE" in f for f in fails)


@pytest.mark.parametrize("kwargs,check", [
    ({"stock_qty": "6"}, "products_aggregate UNRESOLVED"),
    ({"on_hand": "4", "stock_qty": "4"}, "movement_closing_balance UNRESOLVED"),
])
def test_inconsistent_stock_fails_the_gate(kwargs, check):
    fails = seed.ledger_failures(analyze_inventory(_snapshot(**kwargs), today=dt.date(2026, 10, 17)))
    assert any(check in f for f in fails)


def test_link_evidence_gaps_alone_do_not_fail_the_gate():
    findings = analyze_inventory(_snapshot(link=False), today=dt.date(2026, 10, 17))
    assert any(f["classification"] == "MISSING_EVIDENCE" for f in findings)
    assert seed.ledger_failures(findings) == []


def test_finish_exits_non_zero_on_any_failure(capsys):
    seed._finish([], "full")
    assert "REQUIRED DEMO STATE CHECK: PASS (full)" in capsys.readouterr().out
    with pytest.raises(SystemExit) as failed:
        seed._finish(["no reserved stock"], "full")
    assert failed.value.code == 1
    assert "FAIL: no reserved stock" in capsys.readouterr().out
