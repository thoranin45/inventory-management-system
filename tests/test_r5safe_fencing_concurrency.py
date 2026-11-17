"""R5-SAFE.1B — real PostgreSQL concurrency for keyed attempts and claim fencing (service level).

Each worker uses its own session/connection in a disposable isolated schema. The
interleaving is forced, not hoped for: a blocker holds the sales-order row lock
until pg_stat_activity shows the expected number of workers waiting on it.
"""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event
from time import monotonic
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.exceptions import AppException
from app.core.security import hash_password
from app.models import AuditLog, FulfillmentAttemptReceipt, FulfillmentReconciliation, SalesOrder, SalesOrderBatchAllocation, User
from app.repositories.sales_order_repository import SalesOrderRepository
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.schemas.sales_order_schema import FulfillmentScan
from app.services.fulfillment_integrity_service import acquire_fulfillment_claim, submit_fulfillment_attempt
from tests import test_sales_order as sales
from tests.test_inventory_concurrency import concurrent_inventory  # noqa: F401  (isolated-schema fixture)
from tests.test_sales_order_fulfillment import advance
from tests.test_stock import _create_product


def _user(s, role):
    with s.sessions() as db:
        user = User(username=f"r5c_{role.lower()}_{uuid4().hex[:8]}", password_hash=hash_password("R5cTest123!"), role=role)
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user


def _order(s, quantity="2.000"):
    product = _create_product(s.client, s.headers, initial_stock="5.000")
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity=quantity, unit_price=1)
    advance(s.client, s.headers, order["sales_order_id"], "PICKING")
    return product, order["sales_order_id"]


def _acquire(s, order_id, user, **kwargs):
    with s.sessions() as db:
        kwargs.setdefault("expected_epoch", db.get(SalesOrder, order_id).fulfillment_claim_epoch)
        return acquire_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=order_id, current_user=user,
                                         phase="PICK", **kwargs)


def _submit(s, order_id, user, claim, key, barcode):
    """Returns ("ok", result) or ("error", exception) — never raises, so threads report cleanly."""
    with s.sessions() as db:
        try:
            return "ok", submit_fulfillment_attempt(
                db, SalesOrderRepository(db), StockBalanceRepository(db), sales_order_id=order_id,
                operation_type="SCAN_PICK", data=FulfillmentScan(barcode=barcode), operation_key=key,
                claim_token=claim["claim_token"], claim_epoch=claim["claim_epoch"], current_user=user)
        except AppException as exc:
            return "error", exc


def _await_waiters(s, count):
    with s.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as monitor:
        deadline = monotonic() + 8
        while monotonic() < deadline:
            waiting = monitor.scalar(text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"))
            if waiting >= count:
                return
            Event().wait(0.01)
    raise AssertionError(f"expected {count} worker(s) waiting on the order row lock")


def _snapshot(s, order_id):
    with s.sessions() as db:
        order = db.get(SalesOrder, order_id)
        picked = db.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one().picked_quantity
        receipts = db.query(FulfillmentAttemptReceipt).filter_by(sales_order_id=order_id).count()
        audits = db.query(AuditLog).filter_by(table_name="sales_orders", record_id=order_id, action="SCAN_PICK").count()
        recs = [(r.status, r.reason_code, r.opened_epoch) for r in
                db.query(FulfillmentReconciliation).filter_by(sales_order_id=order_id).order_by(FulfillmentReconciliation.id)]
        return order.fulfillment_claim_epoch, picked, receipts, audits, recs


def test_concurrent_same_key_applies_exactly_once(concurrent_inventory):
    s = concurrent_inventory
    product, order_id = _order(s)
    worker = _user(s, "WAREHOUSE")
    claim = _acquire(s, order_id, worker)
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(_submit, s, order_id, worker, claim, "k-same", product["barcode"]) for _ in range(2)]
            try:
                _await_waiters(s, 2)  # both requests genuinely overlap on the row lock
            finally:
                tx.rollback()
            outcomes = [f.result(timeout=15) for f in futures]
    assert [kind for kind, _ in outcomes] == ["ok", "ok"]
    assert sorted(r["attempt"]["replayed"] for _, r in outcomes) == [False, True]
    assert outcomes[0][1]["data"] == outcomes[1][1]["data"]
    epoch, picked, receipts, audits, _ = _snapshot(s, order_id)
    assert (picked, receipts, audits) == (Decimal("1"), 1, 1)


def test_ordering_a_attempt_locks_first_then_takeover(concurrent_inventory):
    """The old holder's attempt reaches the lock before the takeover: it applies, the takeover
    fences everything after it, and the original actor can still learn the outcome by replay."""
    s = concurrent_inventory
    product, order_id = _order(s)
    worker, admin = _user(s, "WAREHOUSE"), _user(s, "ADMIN")
    claim = _acquire(s, order_id, worker)
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=1) as pool:
            attempt = pool.submit(_submit, s, order_id, worker, claim, "k-race-a", product["barcode"])
            try:
                _await_waiters(s, 1)
            finally:
                tx.rollback()
            kind, result = attempt.result(timeout=15)
    assert kind == "ok" and result["attempt"]["outcome"] == "APPLIED"
    takeover = _acquire(s, order_id, admin, takeover=True, reason="handset lost")
    assert takeover["claim_epoch"] == claim["claim_epoch"] + 1
    epoch, picked, receipts, audits, recs = _snapshot(s, order_id)
    assert (epoch, picked, receipts, audits) == (2, Decimal("1"), 1, 1)
    assert recs == [("REQUIRED", "TAKEOVER", 2)]
    # the original actor retries the same key after the takeover: historical replay, no new effect
    kind, replay = _submit(s, order_id, worker, claim, "k-race-a", product["barcode"])
    assert kind == "ok" and replay["attempt"]["replayed"] is True and replay["data"] == result["data"]
    assert _snapshot(s, order_id)[1:4] == (Decimal("1"), 1, 1)
    # a NEW attempt under the old claim is fenced
    kind, err = _submit(s, order_id, worker, claim, "k-after", product["barcode"])
    assert kind == "error" and err.message == "FULFILLMENT_CLAIM_INVALID"
    assert _snapshot(s, order_id)[1:4] == (Decimal("1"), 1, 1)


def test_ordering_b_takeover_locks_first_then_the_old_attempt_is_fenced(concurrent_inventory):
    """The takeover reaches the lock first: the in-flight attempt under the old claim is rejected
    before acceptance — no counter, no audit, no receipt — and can never apply later."""
    s = concurrent_inventory
    product, order_id = _order(s)
    worker, admin = _user(s, "WAREHOUSE"), _user(s, "ADMIN")
    claim = _acquire(s, order_id, worker)
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id = :id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=2) as pool:
            taking = pool.submit(_acquire, s, order_id, admin, takeover=True, reason="supervised handoff")
            try:
                _await_waiters(s, 1)  # the takeover is queued on the lock first
                attempt = pool.submit(_submit, s, order_id, worker, claim, "k-race-b", product["barcode"])
                _await_waiters(s, 2)  # then the old holder's attempt queues behind it
            finally:
                tx.rollback()
            takeover = taking.result(timeout=15)
            kind, err = attempt.result(timeout=15)
    assert takeover["claim_epoch"] == 2
    assert kind == "error" and (err.status_code, err.message) == (409, "FULFILLMENT_CLAIM_INVALID")
    epoch, picked, receipts, audits, recs = _snapshot(s, order_id)
    assert (epoch, picked, receipts, audits) == (2, Decimal("0"), 0, 0)
    assert recs == [("REQUIRED", "TAKEOVER", 2)]
    for _ in range(2):  # retrying the same key under the old claim stays fenced, forever
        kind, err = _submit(s, order_id, worker, claim, "k-race-b", product["barcode"])
        assert kind == "error" and err.message == "FULFILLMENT_CLAIM_INVALID"
    assert _snapshot(s, order_id)[1:4] == (Decimal("0"), 0, 0)



def _release(s, order_id, worker, claim):
    from app.services.fulfillment_integrity_service import release_fulfillment_claim
    with s.sessions() as db:
        return release_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=order_id,
            current_user=worker, phase="PICK", claim_token=claim["claim_token"],
            expected_epoch=claim["claim_epoch"], mode="UNVERIFIED", reason="physical reconciliation pending")


@pytest.mark.parametrize("release_first", [False, True])
def test_scan_release_lock_orderings(concurrent_inventory, release_first):
    s = concurrent_inventory
    product, order_id = _order(s)
    worker = _user(s, "WAREHOUSE")
    claim = _acquire(s, order_id, worker)
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id=:id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=2) as pool:
            try:
                if release_first:
                    releasing = pool.submit(_release, s, order_id, worker, claim)
                    _await_waiters(s, 1)
                    scanning = pool.submit(_submit, s, order_id, worker, claim, "release-race", product["barcode"])
                else:
                    scanning = pool.submit(_submit, s, order_id, worker, claim, "release-race", product["barcode"])
                    _await_waiters(s, 1)
                    releasing = pool.submit(_release, s, order_id, worker, claim)
                _await_waiters(s, 2)
            finally:
                tx.rollback()
            released = releasing.result(timeout=15)
            kind, result = scanning.result(timeout=15)
    epoch, picked, receipts, audits, recs = _snapshot(s, order_id)
    assert epoch == released["claim_epoch"] == 2
    assert recs == [("REQUIRED", "RELEASE_UNVERIFIED", 2)]
    if release_first:
        assert kind == "error" and result.message == "FULFILLMENT_CLAIM_REQUIRED"
        assert (picked, receipts, audits) == (Decimal(0), 0, 0)
    else:
        assert kind == "ok" and (picked, receipts, audits) == (Decimal(1), 1, 1)
        kind, replay = _submit(s, order_id, worker, claim, "release-race", product["barcode"])
        assert kind == "ok" and replay["attempt"]["historical"] is True
        assert _snapshot(s, order_id)[1:4] == (Decimal(1), 1, 1)


def test_concurrent_duplicate_acquire_has_one_token_and_epoch(concurrent_inventory):
    s = concurrent_inventory
    _, order_id = _order(s)
    worker = _user(s, "WAREHOUSE")
    def acquiring():
        try:
            return "ok", _acquire(s, order_id, worker, expected_epoch=0)
        except AppException as exc:
            return "error", exc
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id=:id FOR UPDATE"), {"id": order_id})
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(acquiring) for _ in range(2)]
            try:
                _await_waiters(s, 2)
            finally:
                tx.rollback()
            results = [f.result(timeout=15) for f in futures]
    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    [error] = [value for kind, value in results if kind == "error"]
    assert error.message == "FULFILLMENT_EPOCH_CONFLICT"
    assert _snapshot(s, order_id)[0] == 1



def _verified_release(s, order_id, worker, claim, allocation_id):
    from app.services.fulfillment_integrity_service import release_fulfillment_claim
    with s.sessions() as db:
        try:
            result = release_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=order_id,
                current_user=worker, phase="PICK", claim_token=claim["claim_token"], expected_epoch=1,
                mode="VERIFIED", physical_count_attested=True,
                allocations=[{"allocation_id": allocation_id, "picked_quantity": "0", "packed_quantity": "0"}])
            return "ok", result
        except AppException as exc:
            return "error", exc


@pytest.mark.parametrize("release_first", [False, True])
def test_verified_release_serializes_attestation_with_scan(concurrent_inventory, release_first):
    s = concurrent_inventory
    product, order = _order(s)
    worker = _user(s, "WAREHOUSE")
    claim = _acquire(s, order, worker)
    with s.sessions() as db:
        allocation = db.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order).one().id
    with s.engine.connect() as blocker:
        tx = blocker.begin()
        blocker.execute(text("SELECT id FROM sales_orders WHERE id=:id FOR UPDATE"), {"id": order})
        with ThreadPoolExecutor(max_workers=2) as pool:
            try:
                if release_first:
                    releasing = pool.submit(_verified_release, s, order, worker, claim, allocation)
                    _await_waiters(s, 1)
                    scanning = pool.submit(_submit, s, order, worker, claim, "verified-race", product["barcode"])
                else:
                    scanning = pool.submit(_submit, s, order, worker, claim, "verified-race", product["barcode"])
                    _await_waiters(s, 1)
                    releasing = pool.submit(_verified_release, s, order, worker, claim, allocation)
                _await_waiters(s, 2)
            finally:
                tx.rollback()
            released, scan = releasing.result(timeout=15), scanning.result(timeout=15)
    if release_first:
        assert released[0] == "ok" and scan[0] == "error"
        assert scan[1].message == "FULFILLMENT_CLAIM_REQUIRED"
        assert _snapshot(s, order)[:4] == (2, Decimal(0), 0, 0)
    else:
        assert scan[0] == "ok" and released[0] == "error"
        assert released[1].message == "Physical count does not match authoritative counters"
        assert _snapshot(s, order)[:4] == (1, Decimal(1), 1, 1)
        with s.sessions() as db:
            assert db.query(AuditLog).filter_by(record_id=order, action="FULFILLMENT_RELEASE_VERIFIED").count() == 0
