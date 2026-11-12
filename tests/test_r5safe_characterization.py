"""R5-SAFE.0 — characterization of the CURRENT fulfilment scan / undo / complete contract.

These tests describe what the backend does today (HEAD 7a2d9db). They are not
tests of the future R5-SAFE contract. Where today's behaviour is a known design
gap for R5-SAFE, the test name says ``gap_`` and the docstring states the gap;
the assertion records the current behaviour so that R5-SAFE.1+ must change the
test deliberately rather than silently.
"""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from time import monotonic
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError

from app.core.exceptions import AppException
from app.core.security import create_access_token, hash_password
from app.core.unit_of_work import UnitOfWork
from app.main import app
from app.models import AuditLog, SalesOrder, SalesOrderBatchAllocation, User
from tests import test_sales_order as sales
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401  (fixture + helper)
from tests.test_sales_order_fulfillment import action, advance, detail
from tests.test_stock import _create_product

SCAN_RESULT_KEYS = {"sales_order_id", "so_number", "status", "shipment_number",
                    "allocation_id", "quantity", "picked_quantity", "packed_quantity"}


def _order(client, headers, quantity="2.000", stock="5.000"):
    product = _create_product(client, headers, initial_stock=stock)
    customer = sales._create_customer(client, headers)
    order = sales._create_sales_order(client, headers, customer["id"], product["id"], quantity=quantity, unit_price=1)
    return product, order["sales_order_id"]


def _allocation(client, headers, order_id):
    return detail(client, headers, order_id)["items"][0]["fulfillment_allocations"][0]


def _audits(db, order_id, act):
    db.expire_all()
    return db.query(AuditLog).filter_by(table_name="sales_orders", record_id=order_id, action=act).count()


# --------------------------------------------------------------------------- contract shape and invariants


@pytest.mark.parametrize("packing", [False, True])
def test_scan_success_contract_counter_and_audit(client, admin_headers, warehouse_headers, db_session, packing):
    """One scan = +1 on one allocation counter, one audit row, no stock movement; response has no attempt identity."""
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, "PICKING")
    if packing:
        sales._scan_fulfillment_to_full(client, admin_headers, order_id, packing=False)
        assert action(client, admin_headers, order_id, "complete-picking",
                      sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200
    endpoint, act = ("scan-pack", "SCAN_PACK") if packing else ("scan-pick", "SCAN_PICK")
    before = _audits(db_session, order_id, act)
    response = action(client, warehouse_headers, order_id, endpoint, {"barcode": product["barcode"]})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert set(data) == SCAN_RESULT_KEYS  # current gap: no attempt key / receipt / replay marker
    field = "packed_quantity" if packing else "picked_quantity"
    assert Decimal(str(data[field])) == Decimal("1")
    assert _audits(db_session, order_id, act) == before + 1


@pytest.mark.parametrize("packing", [False, True])
def test_undo_success_contract_counter_and_audit(client, admin_headers, warehouse_headers, db_session, packing):
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, "PICKING")
    if packing:
        sales._scan_fulfillment_to_full(client, admin_headers, order_id, packing=False)
        assert action(client, admin_headers, order_id, "complete-picking",
                      sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200
    scan, undo, act = ("scan-pack", "undo-pack", "PACK_UNDO") if packing else ("scan-pick", "undo-pick", "PICK_UNDO")
    assert action(client, warehouse_headers, order_id, scan, {"barcode": product["barcode"]}).status_code == 200
    allocation_id = _allocation(client, admin_headers, order_id)["id"]
    response = action(client, warehouse_headers, order_id, undo, {"allocation_id": allocation_id})
    assert response.status_code == 200, response.text
    field = "packed_quantity" if packing else "picked_quantity"
    assert Decimal(str(response.json()["data"][field])) == Decimal("0")
    assert _audits(db_session, order_id, act) == 1


def test_ceilings_and_ordering_invariant(client, admin_headers, warehouse_headers, db_session):
    """picked <= allocated, packed <= picked, and the counters never go negative."""
    product, order_id = _order(client, admin_headers, quantity="1.000")
    advance(client, admin_headers, order_id, "PICKING")
    allocation_id = _allocation(client, admin_headers, order_id)["id"]
    assert "UNDO_BELOW_ZERO" in action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": allocation_id}).text
    assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    over = action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]})
    assert over.status_code == 409 and "ALLOCATION_SCAN_EXCEEDS_REMAINING" in over.text
    assert action(client, admin_headers, order_id, "complete-picking",
                  sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200
    assert action(client, warehouse_headers, order_id, "scan-pack", {"barcode": product["barcode"]}).status_code == 200
    over_pack = action(client, warehouse_headers, order_id, "scan-pack", {"barcode": product["barcode"]})
    assert over_pack.status_code == 409 and "ALLOCATION_SCAN_EXCEEDS_REMAINING" in over_pack.text
    db_session.expire_all()
    a = db_session.get(SalesOrderBatchAllocation, allocation_id)
    assert Decimal(0) <= a.packed_quantity <= a.picked_quantity <= a.quantity


def test_undo_below_packed_guard_exists_but_is_unreachable_through_the_api(client, admin_headers, warehouse_headers, db_session):
    """undo-pick is only allowed in PICKING, where packed is 0 — so UNDO_BELOW_PACKED is a defensive guard.
    Forcing packed > 0 in PICKING (impossible via the API) shows the guard still fires and writes nothing."""
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, "PICKING")
    assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    allocation_id = _allocation(client, admin_headers, order_id)["id"]
    a = db_session.get(SalesOrderBatchAllocation, allocation_id)
    a.packed_quantity = Decimal("1")
    db_session.commit()
    response = action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": allocation_id})
    assert response.status_code == 409 and "UNDO_BELOW_PACKED" in response.text
    db_session.expire_all()
    assert db_session.get(SalesOrderBatchAllocation, allocation_id).picked_quantity == Decimal("1")


@pytest.mark.parametrize("endpoint,state,requires", [
    ("scan-pick", "CONFIRMED", "PICKING"),
    ("scan-pack", "PICKING", "PACKING"),
    ("undo-pick", "CONFIRMED", "PICKING"),
    ("undo-pack", "PICKING", "PACKING"),
])
def test_state_restrictions_and_exact_message(client, admin_headers, warehouse_headers, endpoint, state, requires):
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, state)
    payload = {"barcode": product["barcode"]} if endpoint.startswith("scan") else {"allocation_id": 1}
    response = action(client, warehouse_headers, order_id, endpoint, payload)
    assert response.status_code == 409
    assert response.json()["message"] == f"Sales Order state conflict: {state}; requires {requires}"


def test_error_codes_and_statuses(client, admin_headers, warehouse_headers):
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, "PICKING")
    other = _create_product(client, admin_headers)
    cases = [
        ("scan-pick", {"barcode": "no-such-barcode"}, 404, "BARCODE_NOT_FOUND"),
        ("scan-pick", {"barcode": other["barcode"]}, 409, "PRODUCT_NOT_IN_ORDER"),
        ("scan-pick", {"barcode": product["barcode"], "allocation_id": 999999}, 404, "ALLOCATION_NOT_IN_ORDER"),
        ("undo-pick", {"allocation_id": 999999}, 404, "ALLOCATION_NOT_IN_ORDER"),
        ("scan-pick", {"barcode": product["barcode"], "quantity": "0"}, 422, None),
    ]
    for endpoint, payload, status, code in cases:
        response = action(client, warehouse_headers, order_id, endpoint, payload)
        assert response.status_code == status, (endpoint, payload, response.text)
        if code:
            assert response.json()["message"] == code


def test_business_rejections_write_nothing(client, admin_headers, warehouse_headers, db_session):
    """Every rejection is raised before any write: counters and audit rows are unchanged afterwards."""
    product, order_id = _order(client, admin_headers, quantity="1.000")
    advance(client, admin_headers, order_id, "PICKING")
    assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    allocation_id = _allocation(client, admin_headers, order_id)["id"]
    audits_before = db_session.query(AuditLog).filter_by(record_id=order_id, table_name="sales_orders").count()
    for endpoint, payload in [("scan-pick", {"barcode": product["barcode"]}),            # ceiling
                              ("scan-pick", {"barcode": "no-such-barcode"}),
                              ("undo-pick", {"allocation_id": allocation_id, "quantity": "5"})]:  # below zero
        assert action(client, warehouse_headers, order_id, endpoint, payload).status_code in (404, 409)
    db_session.expire_all()
    assert db_session.get(SalesOrderBatchAllocation, allocation_id).picked_quantity == Decimal("1")
    assert db_session.query(AuditLog).filter_by(record_id=order_id, table_name="sales_orders").count() == audits_before


def test_completion_requires_exact_counters_and_ends_phase(client, admin_headers, warehouse_headers):
    product, order_id = _order(client, admin_headers, quantity="2.000")
    advance(client, admin_headers, order_id, "PICKING")
    assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    payload = sales._fulfillment_payload(client, admin_headers, order_id)
    partial = action(client, warehouse_headers, order_id, "complete-picking", payload)
    assert partial.status_code == 409
    assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    assert action(client, warehouse_headers, order_id, "complete-picking", payload).status_code == 200
    assert detail(client, admin_headers, order_id)["status"] == "PACKING"
    late = action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]})
    assert late.status_code == 409 and "requires PICKING" in late.text


def test_rbac_current_rules(client, admin_headers, db_session):
    """Two layers today: a user whose role is neither warehouse nor admin is refused at LOGIN (403), and even a
    token minted for such a user is refused by the route (require_warehouse -> 403). No token is 401."""
    product, order_id = _order(client, admin_headers)
    advance(client, admin_headers, order_id, "PICKING")
    viewer = User(username=f"viewer_test_{uuid4().hex[:8]}", password_hash=hash_password("ViewerTest123!"), role="viewer")
    db_session.add(viewer)
    db_session.commit()
    login = client.post("/api/v1/auth/token", data={"username": viewer.username, "password": "ViewerTest123!"})
    assert login.status_code == 403
    viewer_headers = {"Authorization": "Bearer " + create_access_token({"sub": str(viewer.id)})}
    assert action(client, viewer_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 403
    assert client.post(f"/api/v1/sales-orders/{order_id}/scan-pick", json={"barcode": product["barcode"]}).status_code == 401
    assert action(client, admin_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200


# --------------------------------------------------------------------------- R5-SAFE design gaps (current behaviour)


def test_gap_identical_unkeyed_scans_both_apply(client, admin_headers, warehouse_headers, db_session):
    """GAP: a transport retry and a second physical scan are indistinguishable — both increment."""
    product, order_id = _order(client, admin_headers, quantity="2.000")
    advance(client, admin_headers, order_id, "PICKING")
    for _ in range(2):
        assert action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).status_code == 200
    assert Decimal(str(_allocation(client, admin_headers, order_id)["picked_quantity"])) == Decimal("2")
    assert _audits(db_session, order_id, "SCAN_PICK") == 2


def test_gap_idempotency_key_header_is_ignored_on_scan(client, admin_headers, warehouse_headers):
    """GAP: scan-pick accepts but ignores Idempotency-Key — the same key applies twice."""
    product, order_id = _order(client, admin_headers, quantity="2.000")
    advance(client, admin_headers, order_id, "PICKING")
    keyed = {**warehouse_headers, "Idempotency-Key": "same-key-" + uuid4().hex}
    for _ in range(2):
        response = client.post(f"/api/v1/sales-orders/{order_id}/scan-pick", headers=keyed, json={"barcode": product["barcode"]})
        assert response.status_code == 200
    assert Decimal(str(_allocation(client, admin_headers, order_id)["picked_quantity"])) == Decimal("2")


# --------------------------------------------------------------------------- transactions (UnitOfWork / savepoints)


def _uow_probe(db, marker, *, raise_inside, catch_inside):
    try:
        with UnitOfWork(db):
            db.add(AuditLog(username="r5safe0", action="R5SAFE0_PROBE", table_name="probe", record_id=0, description=marker))
            if raise_inside:
                try:
                    raise AppException("BUSINESS_REJECTION", 409)
                except AppException:
                    if not catch_inside:
                        raise
    except AppException:
        pass


def test_unit_of_work_commits_on_clean_exit_and_rolls_back_any_escaping_exception(db_session):
    """The trap R5-SAFE.1 must avoid: a receipt added inside the block is LOST if the exception escapes the block."""
    clean, escaped, swallowed = (f"r5safe0-{uuid4().hex}" for _ in range(3))
    _uow_probe(db_session, clean, raise_inside=False, catch_inside=False)
    _uow_probe(db_session, escaped, raise_inside=True, catch_inside=False)
    _uow_probe(db_session, swallowed, raise_inside=True, catch_inside=True)
    db_session.expire_all()
    found = {r.description for r in db_session.query(AuditLog).filter_by(action="R5SAFE0_PROBE")}
    assert clean in found
    assert escaped not in found       # rolled back: catching + re-raising inside does NOT commit
    assert swallowed in found         # held and not re-raised inside: committed


def test_savepoint_rollback_keeps_an_earlier_order_row_lock(concurrent_inventory):
    """Premise for R5-SAFE.1: a row lock taken BEFORE begin_nested() survives ROLLBACK TO SAVEPOINT."""
    s = concurrent_inventory
    _, order_id = _order(s.client, s.headers)
    with s.engine.connect() as holder, s.engine.connect() as other:
        tx = holder.begin()
        holder.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE"), {"id": order_id})
        nested = holder.begin_nested()
        holder.execute(text("SELECT 1"))
        nested.rollback()
        other_tx = other.begin()
        with pytest.raises(OperationalError):
            other.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE NOWAIT"), {"id": order_id})
        other_tx.rollback()
        tx.rollback()
        other_tx = other.begin()
        assert other.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE NOWAIT"), {"id": order_id}).scalar() == order_id
        other_tx.rollback()


# --------------------------------------------------------------------------- locks and concurrency (isolated schema)


def test_scan_lock_order_is_order_then_products_batches_balances(concurrent_inventory):
    s = concurrent_inventory
    product, order_id = _order(s.client, s.headers)
    advance(s.client, s.headers, order_id, "PICKING")
    seen = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        if "FOR UPDATE" in statement:
            for table in ("sales_orders", "products", "product_batches", "stock_balances"):
                if f"FROM {table}" in statement and table not in seen:
                    seen.append(table)

    event.listen(s.engine, "before_cursor_execute", capture)
    try:
        assert s.client.post(f"/api/v1/sales-orders/{order_id}/scan-pick", json={"barcode": product["barcode"]}).status_code == 200
        get_seen = list(seen)
        s.client.get(f"/api/v1/sales-orders/{order_id}")
        assert seen == get_seen  # the order-detail GET takes no row lock
    finally:
        event.remove(s.engine, "before_cursor_execute", capture)
    assert seen[0] == "sales_orders"
    assert [t for t in seen if t != "sales_orders"] == ["products", "product_batches", "stock_balances"]


def test_gap_overlapping_identical_scans_serialise_and_both_apply(concurrent_inventory):
    """GAP: two simultaneous identical scans are serialised by the order row lock — and BOTH count."""
    s = concurrent_inventory
    product, order_id = _order(s.client, s.headers, quantity="2.000")
    advance(s.client, s.headers, order_id, "PICKING")
    request = ("POST", f"/api/v1/sales-orders/{order_id}/scan-pick", {"barcode": product["barcode"]})
    responses = overlap(s, [request, request], "sales_orders", [order_id])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        assert db.query(SalesOrderBatchAllocation).one().picked_quantity == Decimal("2")


def test_gap_successful_get_does_not_prove_an_earlier_scan_settled(concurrent_inventory):
    """GAP (the R5 lost-response problem): while a scan waits on the order row lock, a GET succeeds and
    reports the OLD count; the scan then commits afterwards. A successful GET is not a settlement boundary."""
    s = concurrent_inventory
    product, order_id = _order(s.client, s.headers, quantity="2.000")
    advance(s.client, s.headers, order_id, "PICKING")

    def scan():
        with TestClient(app, headers=s.headers) as worker:
            return worker.post(f"/api/v1/sales-orders/{order_id}/scan-pick", json={"barcode": product["barcode"]})

    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(scan)
            try:
                with s.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as monitor:
                    deadline, waiting = monotonic() + 6, False
                    while monotonic() < deadline and not waiting:
                        waiting = monitor.scalar(text(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                            "AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()")) > 0
                        Event().wait(0.01)
                assert waiting, "the scan must be waiting on the order row lock"
                during = s.client.get(f"/api/v1/sales-orders/{order_id}")
                assert during.status_code == 200
                assert Decimal(str(during.json()["data"]["items"][0]["fulfillment_allocations"][0]["picked_quantity"])) == 0
                assert not pending.done()
            finally:
                tx.rollback()
            assert pending.result(timeout=12).status_code == 200
    after = s.client.get(f"/api/v1/sales-orders/{order_id}").json()["data"]
    assert Decimal(str(after["items"][0]["fulfillment_allocations"][0]["picked_quantity"])) == 1
    with s.sessions() as db:
        assert db.get(SalesOrder, order_id).status == "PICKING"
