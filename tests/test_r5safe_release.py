"""R5-SAFE.2 atomic physical attestation and evidence-preserving release."""
import hashlib
import json
from decimal import Decimal
import pytest
from app.core.exceptions import AppException
from app.core.fulfillment_claim import hash_claim_token
from app.models import AuditLog, SalesOrderBatchAllocation
from app.repositories.sales_order_repository import SalesOrderRepository
from app.schemas.sales_order_schema import FulfillmentScan
from app.services import fulfillment_integrity_service as integrity
from tests.test_r5safe_claims import acquire, make_order, make_user, order_row, reconciliations
from tests.test_r5safe_receipts import picking, submit, state


def counts(db, order_id):
    return [{"allocation_id": a.id, "picked_quantity": str(a.picked_quantity), "packed_quantity": str(a.packed_quantity)}
            for a in db.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).order_by(SalesOrderBatchAllocation.id)]


def release(db, order_id, worker, claim, **kwargs):
    return integrity.release_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=order_id,
        current_user=worker, phase=claim["phase"], claim_token=claim["claim_token"], expected_epoch=claim["claim_epoch"], **kwargs)


def snapshot(db, order_id):
    db.expire_all()
    row = order_row(db, order_id)
    return (row.fulfillment_claim_epoch, row.fulfillment_claim_token_hash, row.fulfillment_claim_user_id,
            row.fulfillment_claim_phase, row.fulfillment_claim_acquired_at, counts(db, order_id),
            [(a.id, a.action, a.description) for a in db.query(AuditLog).filter_by(record_id=order_id, table_name="sales_orders").order_by(AuditLog.id)],
            [(r.id, r.status, r.notes, r.count_lines, r.targets, r.resolution_notes) for r in reconciliations(db, order_id)])


@pytest.mark.parametrize("phase", ["PICK", "PACK"])
def test_verified_release_evidence_reconstructs_and_clean_handoff(client, admin_headers, db_session, phase):
    product, order_id = make_order(client, admin_headers, state="PICKING" if phase == "PICK" else "PACKING")
    worker = make_user(db_session)
    claim = acquire(db_session, order_id, worker, phase=phase)
    submit(db_session, order_id, worker, claim, operation="SCAN_PICK" if phase == "PICK" else "SCAN_PACK",
           data=FulfillmentScan(barcode=product["barcode"], quantity="0.001"), key="before-release")
    lines = counts(db_session, order_id)
    result = release(db_session, order_id, worker, claim, mode="VERIFIED", allocations=lines, physical_count_attested=True)
    row = order_row(db_session, order_id)
    assert row.fulfillment_claim_epoch == 2
    assert all(getattr(row, f"fulfillment_claim_{field}") is None for field in ("token_hash", "user_id", "phase", "acquired_at"))
    records = db_session.query(AuditLog).filter(AuditLog.record_id == order_id,
        AuditLog.action.in_(["FULFILLMENT_RELEASE_LINE", "FULFILLMENT_RELEASE_VERIFIED"])).order_by(AuditLog.id).all()
    evidence = [json.loads(a.description) for a in records if a.action == "FULFILLMENT_RELEASE_LINE"]
    [summary] = [json.loads(a.description) for a in records if a.action == "FULFILLMENT_RELEASE_VERIFIED"]
    canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    assert hashlib.sha256(canonical).hexdigest() == summary["sha256"] == result["evidence_sha256"]
    assert summary["lines"] == len(lines) == len(evidence)
    for source, line in zip(lines, evidence):
        assert line["allocation"] == source["allocation_id"]
        assert Decimal(line["picked"]) == Decimal(source["picked_quantity"])
        assert Decimal(line["packed"]) == Decimal(source["packed_quantity"])
        assert line["release"] == summary["release"] == result["release_id"]
        assert (line["v"], line["actor"], line["order"], line["phase"], line["old_epoch"], line["new_epoch"], line["attested"]) == (1, worker.id, order_id, phase, 1, 2, True)
    assert all(len(a.description) <= 500 and claim["claim_token"] not in a.description for a in records)
    assert counts(db_session, order_id) == lines and reconciliations(db_session, order_id) == []
    # Historical replay remains evidence only after release.
    replay = submit(db_session, order_id, worker, claim, operation="SCAN_PICK" if phase == "PICK" else "SCAN_PACK",
                    data=FulfillmentScan(barcode=product["barcode"], quantity="0.001"), key="before-release")
    assert replay["attempt"]["historical"] is True and counts(db_session, order_id) == lines
    next_claim = acquire(db_session, order_id, make_user(db_session), phase=phase, expected_epoch=2)
    assert next_claim["claim_epoch"] == 3 and not next_claim["reconciliation_required"]


@pytest.mark.parametrize("bad", ["missing", "duplicate", "unknown", "mismatch", "negative", "nan", "precision", "float", "unattested"])
def test_failed_verified_release_preserves_everything(db_session, picking, bad):
    _, order_id, worker, claim = picking
    lines = counts(db_session, order_id)
    if bad == "missing": lines = []
    elif bad == "duplicate": lines *= 2
    elif bad == "unknown": lines[0]["allocation_id"] += 10000
    elif bad != "unattested":
        lines[0]["picked_quantity"] = {"mismatch": "1", "negative": "-1", "nan": "NaN", "precision": "0.0009", "float": 0.1}[bad]
    before = snapshot(db_session, order_id)
    with pytest.raises(AppException):
        release(db_session, order_id, worker, claim, mode="VERIFIED", allocations=lines, physical_count_attested=bad != "unattested")
    assert snapshot(db_session, order_id) == before


def test_evidence_insert_failure_rolls_back_release(db_session, picking, monkeypatch):
    _, order_id, worker, claim = picking
    before = snapshot(db_session, order_id)
    original = integrity._release_evidence
    def broken(db, order, user, action, value):
        original(db, order, user, action, value)
        db.flush()
        if action == "FULFILLMENT_RELEASE_VERIFIED": raise RuntimeError("evidence unavailable")
    monkeypatch.setattr(integrity, "_release_evidence", broken)
    with pytest.raises(RuntimeError):
        release(db_session, order_id, worker, claim, mode="VERIFIED", allocations=counts(db_session, order_id), physical_count_attested=True)
    assert snapshot(db_session, order_id) == before


def test_unverified_release_preserves_evidence_and_requires_reconciliation(db_session, picking):
    _, order_id, worker, claim = picking
    claim = acquire(db_session, order_id, worker, takeover=True, reason="device lost")
    [old] = reconciliations(db_session, order_id)
    old.notes = "original operator evidence"
    old.count_lines = [{"physical": "1.000"}]
    old.targets = [{"target": "1.000"}]
    old.resolution_notes = "prior reasoning"
    db_session.commit()
    original_counts = counts(db_session, order_id)
    result = release(db_session, order_id, worker, claim, mode="UNVERIFIED", reason="shift handoff without count")
    first, second = reconciliations(db_session, order_id)
    assert (first.status, second.status, second.reason_code) == ("SUPERSEDED", "REQUIRED", "RELEASE_UNVERIFIED")
    assert first.notes == "original operator evidence" and first.count_lines == [{"physical": "1.000"}]
    assert first.targets == [{"target": "1.000"}] and first.resolution_notes.startswith("prior reasoning\n")
    assert f"#{second.id}" in first.resolution_notes and f"#{first.id}" in second.notes
    assert result["reconciliation_id"] == second.id and counts(db_session, order_id) == original_counts
    assert order_row(db_session, order_id).fulfillment_claim_token_hash is None
    new = acquire(db_session, order_id, worker, expected_epoch=3)
    assert new["reconciliation_required"] is True
    before = snapshot(db_session, order_id)
    with pytest.raises(AppException, match="FULFILLMENT_RECONCILIATION_UNRESOLVED"):
        release(db_session, order_id, worker, new, mode="VERIFIED", allocations=original_counts, physical_count_attested=True)
    assert snapshot(db_session, order_id) == before


@pytest.mark.parametrize("status", ["CORRECTION_IN_PROGRESS", "ESCALATED"])
@pytest.mark.parametrize("operation", ["takeover", "VERIFIED", "UNVERIFIED"])
def test_protected_reconciliation_states_block_ordinary_transitions(db_session, picking, status, operation):
    _, order_id, worker, _ = picking
    claim = acquire(db_session, order_id, worker, takeover=True, reason="lost device")
    [record] = reconciliations(db_session, order_id)
    record.status = status
    db_session.commit()
    before = snapshot(db_session, order_id)
    with pytest.raises(AppException, match="FULFILLMENT_RECONCILIATION_TRANSITION_BLOCKED"):
        if operation == "takeover":
            acquire(db_session, order_id, worker, takeover=True, reason="another device")
        else:
            release(db_session, order_id, worker, claim, mode=operation, reason="handoff")
    assert snapshot(db_session, order_id) == before


def test_release_wrong_credentials_and_duplicate_are_nonmutating(db_session, picking):
    _, order_id, worker, claim = picking
    before = snapshot(db_session, order_id)
    with pytest.raises(AppException):
        release(db_session, order_id, worker, {**claim, "claim_token": "wrong"}, mode="UNVERIFIED", reason="test")
    assert snapshot(db_session, order_id) == before
    release(db_session, order_id, worker, claim, mode="UNVERIFIED", reason="test")
    before = snapshot(db_session, order_id)
    with pytest.raises(AppException, match="FULFILLMENT_EPOCH_CONFLICT"):
        release(db_session, order_id, worker, claim, mode="UNVERIFIED", reason="test")
    assert snapshot(db_session, order_id) == before



def test_multiple_allocations_are_canonically_ordered(client, admin_headers, db_session):
    from tests import test_sales_order as sales
    from tests.test_stock import _create_product
    from tests.test_sales_order_fulfillment import advance
    products = [_create_product(client, admin_headers, initial_stock="5") for _ in range(2)]
    customer = sales._create_customer(client, admin_headers)
    response = client.post("/api/v1/sales-orders/", headers=admin_headers, json={"customer_id": customer["id"],
        "items": [{"product_id": v["id"], "quantity": "1.234", "unit_price": "1"} for v in products]})
    assert response.status_code in (200, 201)
    order = response.json()["data"]["sales_order_id"]
    advance(client, admin_headers, order, "PICKING")
    worker = make_user(db_session)
    claim = acquire(db_session, order, worker)
    lines = counts(db_session, order)
    assert len(lines) == 2
    result = release(db_session, order, worker, claim, mode="VERIFIED", allocations=list(reversed(lines)), physical_count_attested=True)
    records = db_session.query(AuditLog).filter_by(record_id=order, action="FULFILLMENT_RELEASE_LINE").order_by(AuditLog.id).all()
    evidence = [json.loads(r.description) for r in records]
    assert [v["allocation"] for v in evidence] == sorted(v["allocation_id"] for v in lines)
    assert all(v["allocated"] == "1.234" for v in evidence)
    digest = hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    assert digest == result["evidence_sha256"]


def test_oversized_evidence_fails_without_truncation(db_session, picking):
    _, order, worker, _ = picking
    before = snapshot(db_session, order)
    with pytest.raises(AppException, match="FULFILLMENT_RELEASE_EVIDENCE_TOO_LARGE"):
        integrity._release_evidence(db_session, order_row(db_session, order), worker,
                                    "FULFILLMENT_RELEASE_LINE", {"evidence": "x" * 501})
    assert snapshot(db_session, order) == before


def test_unverified_record_failure_rolls_back_fencing(db_session, picking, monkeypatch):
    _, order, worker, claim = picking
    before = snapshot(db_session, order)
    def fail(*args):
        raise RuntimeError("reconciliation unavailable")
    monkeypatch.setattr(SalesOrderRepository, "create_reconciliation", fail)
    with pytest.raises(RuntimeError):
        release(db_session, order, worker, claim, mode="UNVERIFIED", reason="recount required")
    assert snapshot(db_session, order) == before
