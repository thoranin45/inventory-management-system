"""R5-SAFE.1B — keyed fulfilment attempt receipts (service level, NOT reachable through HTTP)."""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import AppException
from app.models import AuditLog, FulfillmentAttemptReceipt, FulfillmentReconciliation, SalesOrderBatchAllocation
from app.repositories.sales_order_repository import SalesOrderRepository
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.schemas.sales_order_schema import FulfillmentScan, FulfillmentUndo
from app.services import fulfillment_integrity_service as integrity
from app.services.fulfillment_integrity_service import (
    FulfillmentAttemptRejected,
    TERMINAL_REJECTION_CODES,
    attempt_fingerprint,
    is_terminal_rejection,
    submit_fulfillment_attempt,
)
from app.services.sales_order_service import IDEMPOTENCY_CONFLICT
from tests import test_sales_order as sales
from tests.test_r5safe_claims import acquire, make_order, make_user


def submit(db, order_id, user, claim, operation="SCAN_PICK", data=None, key=None, epoch=None, token=None):
    return submit_fulfillment_attempt(
        db, SalesOrderRepository(db), StockBalanceRepository(db), sales_order_id=order_id, operation_type=operation,
        data=data, operation_key=key or f"att-{uuid4().hex}", claim_token=token or claim["claim_token"],
        claim_epoch=claim["claim_epoch"] if epoch is None else epoch, current_user=user)


def state(db, order_id):
    """(picked, packed, scan/undo audit count, receipt rows) — everything an attempt may write."""
    db.expire_all()
    a = db.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()
    audits = db.query(AuditLog).filter(AuditLog.table_name == "sales_orders", AuditLog.record_id == order_id,
                                       AuditLog.action.in_(("SCAN_PICK", "SCAN_PACK", "PICK_UNDO", "PACK_UNDO"))).count()
    receipts = db.query(FulfillmentAttemptReceipt).filter_by(sales_order_id=order_id).order_by(FulfillmentAttemptReceipt.id).all()
    return a.picked_quantity, a.packed_quantity, audits, receipts


@pytest.fixture
def picking(client, admin_headers, db_session):
    product, order_id = make_order(client, admin_headers, quantity="2.000")
    worker = make_user(db_session)
    claim = acquire(db_session, order_id, worker)
    return product, order_id, worker, claim


# --------------------------------------------------------------------------- applied + replay


def test_applied_attempt_writes_counter_audit_and_receipt_together(db_session, picking):
    product, order_id, worker, claim = picking
    result = submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-applied")
    assert result["attempt"]["outcome"] == "APPLIED" and result["attempt"]["replayed"] is False
    assert result["data"]["picked_quantity"] == 1
    picked, _, audit_count, [receipt] = state(db_session, order_id)
    assert (picked, audit_count) == (Decimal("1"), 1)
    assert (receipt.operation_key, receipt.outcome, receipt.claim_epoch, receipt.created_by_user_id) == (
        "k-applied", "APPLIED", 1, worker.id)
    assert receipt.response_snapshot == result["data"] and receipt.error_code is None
    assert claim["claim_token"] not in str(receipt.response_snapshot)


def test_exact_replay_never_repeats_the_mutation_and_is_marked_historical(db_session, picking):
    product, order_id, worker, claim = picking
    data = FulfillmentScan(barcode=product["barcode"])
    first = submit(db_session, order_id, worker, claim, data=data, key="k-replay")
    submit(db_session, order_id, worker, claim, data=data)  # a later, different scan moves the counter on
    replay = submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"], quantity="1.000"),
                    key="k-replay")  # "1" and "1.000" are the same canonical request
    assert replay["data"] == first["data"] and replay["data"]["picked_quantity"] == 1  # historical, not live (live is 2)
    assert replay["attempt"]["replayed"] is True and replay["attempt"]["historical"] is True
    picked, _, audit_count, receipts = state(db_session, order_id)
    assert (picked, audit_count, len(receipts)) == (Decimal("2"), 2, 2)


def test_same_key_different_payload_or_epoch_conflicts_without_mutation(db_session, picking):
    product, order_id, worker, claim = picking
    submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-conflict")
    before = state(db_session, order_id)
    for data, epoch in ((FulfillmentScan(barcode=product["barcode"], quantity="0.5"), None),
                        (FulfillmentScan(barcode=product["barcode"], allocation_id=1), None),
                        (FulfillmentScan(barcode=product["barcode"]), 7)):
        with pytest.raises(AppException) as err:
            submit(db_session, order_id, worker, claim, data=data, key="k-conflict", epoch=epoch)
        assert (err.value.status_code, err.value.message) == (409, IDEMPOTENCY_CONFLICT)
    assert state(db_session, order_id)[:3] == before[:3] and len(state(db_session, order_id)[3]) == 1


def test_another_user_cannot_replay_someone_elses_receipt(db_session, picking):
    product, order_id, worker, claim = picking
    submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-owner")
    intruder = make_user(db_session)
    with pytest.raises(AppException) as err:
        submit(db_session, order_id, intruder, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-owner")
    assert (err.value.status_code, err.value.message) == (403, "FULFILLMENT_ATTEMPT_FORBIDDEN")
    assert not isinstance(err.value, FulfillmentAttemptRejected)  # no snapshot / attempt payload disclosed


def test_omitted_and_explicit_allocation_are_different_attempts():
    explicit = FulfillmentScan(barcode="885", allocation_id=5)
    omitted = FulfillmentScan(barcode="885")
    assert attempt_fingerprint(1, "SCAN_PICK", 1, explicit) != attempt_fingerprint(1, "SCAN_PICK", 1, omitted)
    assert attempt_fingerprint(1, "SCAN_PICK", 1, omitted) != attempt_fingerprint(1, "SCAN_PICK", 2, omitted)
    assert attempt_fingerprint(1, "SCAN_PICK", 1, omitted) != attempt_fingerprint(1, "SCAN_PACK", 1, omitted)
    assert attempt_fingerprint(1, "SCAN_PICK", 1, FulfillmentScan(barcode="885", quantity="2")) == attempt_fingerprint(
        1, "SCAN_PICK", 1, FulfillmentScan(barcode="885", quantity="2.000"))


# --------------------------------------------------------------------------- terminal rejections


def test_terminal_rejection_commits_a_rejected_receipt_and_nothing_else(db_session, picking):
    _, order_id, worker, claim = picking
    with pytest.raises(FulfillmentAttemptRejected) as err:
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode="no-such-barcode"), key="k-404")
    assert (err.value.status_code, err.value.message, err.value.attempt["replayed"]) == (404, "BARCODE_NOT_FOUND", False)
    picked, _, audit_count, [receipt] = state(db_session, order_id)
    assert (picked, audit_count) == (Decimal("0"), 0)
    assert (receipt.outcome, receipt.error_code, receipt.http_status, receipt.allocation_id) == (
        "REJECTED", "BARCODE_NOT_FOUND", 404, None)
    with pytest.raises(FulfillmentAttemptRejected) as again:
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode="no-such-barcode"), key="k-404")
    assert again.value.attempt["replayed"] is True and len(state(db_session, order_id)[3]) == 1


def test_a_rejected_key_never_mutates_later_even_when_the_operation_would_now_succeed(db_session, picking):
    product, order_id, worker, claim = picking
    scan = FulfillmentScan(barcode=product["barcode"])
    submit(db_session, order_id, worker, claim, data=scan)
    submit(db_session, order_id, worker, claim, data=scan)
    with pytest.raises(FulfillmentAttemptRejected) as err:
        submit(db_session, order_id, worker, claim, data=scan, key="k-ceiling")  # 2/2: over the ceiling
    assert err.value.message == "ALLOCATION_SCAN_EXCEEDS_REMAINING"
    allocation_id = state(db_session, order_id)[3][0].allocation_id
    submit(db_session, order_id, worker, claim, operation="UNDO_PICK", data=FulfillmentUndo(allocation_id=allocation_id))
    with pytest.raises(FulfillmentAttemptRejected) as replay:  # capacity exists again, but the key is spent
        submit(db_session, order_id, worker, claim, data=scan, key="k-ceiling")
    assert replay.value.attempt["replayed"] is True
    assert state(db_session, order_id)[0] == Decimal("1")


def test_terminal_allowlist_is_exact():
    for code in TERMINAL_REJECTION_CODES:
        assert is_terminal_rejection(AppException(code, 404 if code in {"BARCODE_NOT_FOUND", "ALLOCATION_NOT_IN_ORDER"} else 409))
    assert is_terminal_rejection(AppException("Sales Order state conflict: PACKING; requires PICKING", 409))
    for message in ("Order has no items", "Invalid allocation membership", "Invalid allocation ownership/source: 4",
                    "Invalid allocation tracking identity: 4", "Invalid pinned allocation source: 4",
                    "Invalid allocated batch: 4", "ALLOCATION_NOT_FULFILLABLE", "Sales Order not found",
                    "BARCODE_NOT_FOUND ", "x BARCODE_NOT_FOUND", "Sales Order state conflict: PICKING; requires SHIPPED",
                    "Sales Order state conflict: PICKING; requires PICKING; extra"):
        assert not is_terminal_rejection(AppException(message, 409)), message

    class Subclass(AppException):
        pass
    assert not is_terminal_rejection(Subclass("BARCODE_NOT_FOUND", 404))
    assert not is_terminal_rejection(RuntimeError("BARCODE_NOT_FOUND"))


# --------------------------------------------------------------------------- rollbacks (nothing recorded)


def _core_then(raise_exc):
    """Wrap the real business core: it applies its counter + audit, then the given error is raised."""
    real = integrity.apply_fulfillment_scan

    def wrapped(*args, **kwargs):
        real(*args, **kwargs)
        raise raise_exc
    return wrapped


@pytest.mark.parametrize("error", [
    AppException("Invalid allocation membership", 409),  # data integrity: never a terminal receipt
    AppException("ALLOCATION_NOT_FULFILLABLE", 409),
    RuntimeError("unexpected failure after the counter was written"),
])
def test_non_terminal_errors_roll_back_everything_with_no_receipt(db_session, picking, monkeypatch, error):
    product, order_id, worker, claim = picking
    monkeypatch.setattr(integrity, "apply_fulfillment_scan", _core_then(error))
    with pytest.raises(type(error)) as raised:
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-rollback")
    assert not isinstance(raised.value, FulfillmentAttemptRejected)
    assert state(db_session, order_id)[:3] == (Decimal("0"), Decimal("0"), 0)
    assert state(db_session, order_id)[3] == []
    monkeypatch.undo()  # the same key is still usable once the fault is gone
    result = submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]), key="k-rollback")
    assert result["attempt"]["outcome"] == "APPLIED"


@pytest.mark.parametrize("barcode", [None, "no-such-barcode"])  # APPLIED path / REJECTED path
def test_receipt_write_failure_rolls_back_the_whole_attempt(db_session, picking, monkeypatch, barcode):
    product, order_id, worker, claim = picking

    def failing_insert(self, receipt):
        raise IntegrityError("INSERT INTO fulfillment_attempt_receipts", {}, Exception("simulated"))
    monkeypatch.setattr(SalesOrderRepository, "create_fulfillment_receipt", failing_insert)
    with pytest.raises(IntegrityError):
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=barcode or product["barcode"]))
    assert state(db_session, order_id)[:3] == (Decimal("0"), Decimal("0"), 0) and state(db_session, order_id)[3] == []


# --------------------------------------------------------------------------- pre-acceptance (nothing recorded)


def test_pre_acceptance_failures_record_nothing(client, admin_headers, db_session, picking):
    product, order_id, worker, claim = picking
    scan = FulfillmentScan(barcode=product["barcode"])
    cases = [
        (dict(token=claim["claim_token"] + "x"), 409, "FULFILLMENT_CLAIM_INVALID"),
        (dict(epoch=claim["claim_epoch"] + 1), 409, "FULFILLMENT_CLAIM_INVALID"),
        (dict(key="bad key with spaces"), 422, "Invalid Idempotency-Key"),
        (dict(key="x" * 129), 422, "Invalid Idempotency-Key"),
        (dict(epoch=-1), 422, "Invalid claim epoch"),
        (dict(operation="SHIP"), 422, "Invalid fulfillment operation"),
        (dict(data=FulfillmentUndo(allocation_id=1)), 422, "Invalid fulfillment payload"),
    ]
    for overrides, status, message in cases:
        kwargs = {"data": scan, **overrides}
        with pytest.raises(AppException) as err:
            submit(db_session, order_id, worker, claim, **kwargs)
        assert (err.value.status_code, err.value.message) == (status, message), overrides
    _, unclaimed = make_order(client, admin_headers)
    with pytest.raises(AppException) as err:
        submit(db_session, unclaimed, worker, claim, data=scan)
    assert err.value.message == "FULFILLMENT_CLAIM_REQUIRED"
    viewer = make_user(db_session, role="viewer")
    with pytest.raises(AppException) as err:
        submit(db_session, order_id, viewer, claim, data=scan)
    assert err.value.status_code == 403
    assert state(db_session, order_id)[:3] == (Decimal("0"), Decimal("0"), 0) and state(db_session, order_id)[3] == []


# --------------------------------------------------------------------------- reconciliation gate (fail closed)


@pytest.mark.parametrize("status", ["REQUIRED", "CORRECTION_IN_PROGRESS", "ESCALATED"])
@pytest.mark.parametrize("operation", ["SCAN_PICK", "UNDO_PICK"])
def test_every_unresolved_reconciliation_blocks_mutations(db_session, picking, status, operation):
    product, order_id, worker, claim = picking
    if operation == "UNDO_PICK":
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]))
    record = FulfillmentReconciliation(sales_order_id=order_id, phase="PICK", opened_epoch=1, reason_code="DISCREPANCY_REPORTED",
                                       status=status)
    db_session.add(record)
    db_session.commit()
    before = state(db_session, order_id)
    data = (FulfillmentScan(barcode=product["barcode"]) if operation == "SCAN_PICK"
            else FulfillmentUndo(allocation_id=before[3][0].allocation_id))
    with pytest.raises(FulfillmentAttemptRejected) as err:
        submit(db_session, order_id, worker, claim, operation=operation, data=data, key="k-gated")
    assert (err.value.status_code, err.value.message) == (409, "FULFILLMENT_RECONCILIATION_UNRESOLVED")
    after = state(db_session, order_id)
    assert after[:3] == before[:3]
    gated = after[3][-1]
    assert (gated.operation_key, gated.outcome, gated.reconciliation_id) == ("k-gated", "REJECTED", record.id)
    # resolving the record does not revive the spent key
    record.status, record.resolved_at = "RESOLVED_MATCHED", datetime.now(timezone.utc)
    db_session.commit()
    with pytest.raises(FulfillmentAttemptRejected) as replay:
        submit(db_session, order_id, worker, claim, operation=operation, data=data, key="k-gated")
    assert replay.value.attempt["replayed"] is True and state(db_session, order_id)[:3] == before[:3]


# --------------------------------------------------------------------------- undo, packing, legacy parity


def test_undo_and_packing_paths(client, admin_headers, db_session):
    product, order_id = make_order(client, admin_headers, quantity="1.000")
    sales._scan_fulfillment_to_full(client, admin_headers, order_id, packing=False)  # legacy route, no claim
    assert client.post(f"/api/v1/sales-orders/{order_id}/complete-picking", headers=admin_headers,
                       json=sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200
    packer = make_user(db_session)
    claim = acquire(db_session, order_id, packer, phase="PACK")
    packed = submit(db_session, order_id, packer, claim, operation="SCAN_PACK", data=FulfillmentScan(barcode=product["barcode"]))
    assert packed["data"]["packed_quantity"] == 1
    allocation_id = packed["data"]["allocation_id"]
    undone = submit(db_session, order_id, packer, claim, operation="UNDO_PACK", data=FulfillmentUndo(allocation_id=allocation_id))
    assert undone["data"]["packed_quantity"] == 0
    with pytest.raises(FulfillmentAttemptRejected) as err:
        submit(db_session, order_id, packer, claim, operation="UNDO_PACK", data=FulfillmentUndo(allocation_id=allocation_id))
    assert err.value.message == "UNDO_BELOW_ZERO"
    picked, packed_qty, audit_count, receipts = state(db_session, order_id)
    assert (picked, packed_qty) == (Decimal("1"), Decimal("0"))
    assert [r.outcome for r in receipts] == ["APPLIED", "APPLIED", "REJECTED"]


def test_keyed_and_legacy_scans_have_the_same_effect_and_response_shape(client, admin_headers, warehouse_headers, db_session):
    product, legacy_order = make_order(client, admin_headers)
    legacy = client.post(f"/api/v1/sales-orders/{legacy_order}/scan-pick", headers=warehouse_headers,
                         json={"barcode": product["barcode"]})
    assert legacy.status_code == 200
    product2, keyed_order = make_order(client, admin_headers)
    worker = make_user(db_session)
    claim = acquire(db_session, keyed_order, worker)
    keyed = submit(db_session, keyed_order, worker, claim, data=FulfillmentScan(barcode=product2["barcode"]))
    assert set(keyed["data"]) == set(legacy.json()["data"])
    assert keyed["data"]["picked_quantity"] == legacy.json()["data"]["picked_quantity"] == 1
    legacy_audit = db_session.query(AuditLog).filter_by(record_id=legacy_order, action="SCAN_PICK").one()
    keyed_audit = db_session.query(AuditLog).filter_by(record_id=keyed_order, action="SCAN_PICK").one()
    assert legacy_audit.description.split(": ", 1)[1].split(". Allocation")[0] == keyed_audit.description.split(": ", 1)[1].split(". Allocation")[0]
    assert "increment 1" in keyed_audit.description and "picked_quantity=1" in keyed_audit.description


@pytest.mark.parametrize("message,status", [("BARCODE_NOT_FOUND", 409), ("ALLOCATION_NOT_IN_ORDER", 500),
    ("UNDO_BELOW_ZERO", 500), ("UNDO_BELOW_ZERO", 404), ("unknown", 409),
    ("Sales Order state conflict: PACKING; requires PICKING", 500)])
def test_unexpected_terminal_status_rolls_back(db_session, picking, monkeypatch, message, status):
    product, order_id, worker, claim = picking
    original = integrity.apply_fulfillment_scan
    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise AppException(message, status)
    monkeypatch.setattr(integrity, "apply_fulfillment_scan", fail)
    with pytest.raises(AppException):
        submit(db_session, order_id, worker, claim, data=FulfillmentScan(barcode=product["barcode"]))
    picked, packed, count, receipts = state(db_session, order_id)
    assert (picked, packed, count, receipts) == (Decimal(0), Decimal(0), 0, [])


def test_terminal_subclasses_and_unknown_status_fail_closed():
    class Other(AppException):
        pass
    for code in TERMINAL_REJECTION_CODES:
        status = 404 if code in {"BARCODE_NOT_FOUND", "ALLOCATION_NOT_IN_ORDER"} else 409
        assert not is_terminal_rejection(Other(code, status))
        assert not is_terminal_rejection(AppException(code, None))
