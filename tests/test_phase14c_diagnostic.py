"""Phase 14C diagnostic additions: FK-first transaction links, contradictory
links, Request -> Transaction links, and timestamp provenance."""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text

import scripts.check_inventory_consistency as diagnostic
from scripts.check_inventory_consistency import analyze_inventory, diagnose_inventory
from tests.conftest import test_engine
from tests.test_stock import _create_product
from tests.test_stock_adjustment_requests import _create_request


def _snapshot(**extra):
    base = dict(products=[], batches=[], balances=[], transactions=[], movements=[])
    base.update(extra)
    return base


def _movement(mid, *, quantity="5", tx_fk=None, ref_type="STOCK_TRANSACTION", ref_id=None, created_at=None):
    return dict(id=mid, product_id=1, warehouse_id=1, location_id=1, batch_id=None,
                quantity=Decimal(quantity), balance_before=Decimal("0"), balance_after=Decimal(quantity),
                reference_type=ref_type, reference_id=ref_id, stock_transaction_id=tx_fk,
                movement_type="STOCK_ADJUST", created_at=created_at)


def _by(findings, check):
    return [f for f in findings if f["check"] == check]


def test_movement_linked_by_fk_and_equal_reference_is_counted_once():
    findings = analyze_inventory(_snapshot(
        transactions=[dict(id=1, product_id=1, transaction_type="IN", quantity=Decimal("5"))],
        movements=[_movement(1, tx_fk=1, ref_id=1)],
    ))
    link = _by(findings, "transaction_movement_link")
    assert [f["classification"] for f in link] == ["CONSISTENT"]  # 5, not double-counted 10
    assert link[0]["movement_ids"] == [1]
    assert not _by(findings, "conflicting_transaction_link")


def test_fk_takes_precedence_over_a_reference_based_link():
    """A PO-style movement (business-document reference) is linked via its FK."""
    findings = analyze_inventory(_snapshot(
        transactions=[dict(id=7, product_id=1, transaction_type="IN_PO", quantity=Decimal("5"))],
        movements=[_movement(1, tx_fk=7, ref_type="PURCHASE_ORDER", ref_id=99)],
    ))
    assert [f["classification"] for f in _by(findings, "transaction_movement_link")] == ["CONSISTENT"]
    assert not _by(findings, "movement_transaction_link")


def test_contradictory_links_are_unresolved_and_fk_wins():
    findings = analyze_inventory(_snapshot(
        transactions=[dict(id=1, product_id=1, transaction_type="IN", quantity=Decimal("5")),
                      dict(id=2, product_id=1, transaction_type="IN", quantity=Decimal("5"))],
        movements=[_movement(1, tx_fk=1, ref_id=2)],
    ))
    conflict = _by(findings, "conflicting_transaction_link")
    assert [(f["classification"], f["stock_transaction_id"], f["reference_id"]) for f in conflict] == [
        ("UNRESOLVED", 1, 2)]
    by_tx = {f["transaction_id"]: f["classification"] for f in _by(findings, "transaction_movement_link")}
    assert by_tx == {1: "CONSISTENT", 2: "MISSING_EVIDENCE"}


def _request(rid, status="APPROVED", tx=None, product_id=1):
    return dict(id=rid, reference_number=f"ADJ-{rid:06d}", status=status, product_id=product_id,
                stock_transaction_id=tx)


def _approve_audit(rid, tx=None, text=None):
    """The APPROVE audit text each code generation writes in the approval's own transaction."""
    if text is None:
        text = f"ADJ-{rid:06d}: PENDING -> APPROVED" + (f"; stock_transaction_id={tx}" if tx is not None else "")
    return dict(record_id=rid, description=text)


def _link_results(**snapshot):
    findings = analyze_inventory(_snapshot(**snapshot))
    return {f["request_id"]: f for f in _by(findings, "adjustment_request_transaction_link")}


def _adj(tid, qty="4", product_id=1):
    return dict(id=tid, product_id=product_id, transaction_type="ADJUST", quantity=Decimal(qty))


def test_adjustment_request_link_classifications():
    results = _link_results(
        transactions=[_adj(1), _adj(2, "0"), _adj(3), _adj(4)],
        movements=[
            _movement(1, quantity="4", tx_fk=1, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=10),
            _movement(2, quantity="4", tx_fk=4, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=999),
        ],
        adjustment_requests=[
            _request(10, tx=1),                   # linked, one movement
            _request(11, tx=2),                   # zero-difference: transaction, no movement
            _request(13, status="PENDING", tx=3),  # impossible link on a pending request
            _request(14, tx=3, product_id=2),     # wrong product
            _request(15, tx=4),                   # its movement names another request
            _request(16, status="REJECTED"),
        ],
        adjustment_approval_audits=[_approve_audit(10, 1), _approve_audit(11, 2), _approve_audit(14, 3),
                                    _approve_audit(15, 4)],
    )
    assert {rid: f["classification"] for rid, f in results.items()} == {
        10: "CONSISTENT", 11: "CONSISTENT", 13: "UNRESOLVED", 14: "UNRESOLVED", 15: "UNRESOLVED",
        16: "CONSISTENT"}


def test_pre_14c_approval_is_explained_only_with_deterministic_audit_proof():
    """Pre-14C code wrote exactly '<ref>: PENDING -> APPROVED'; 14C code always
    appends '; stock_transaction_id=<id>' in the same transaction."""
    results = _link_results(
        adjustment_requests=[_request(20)],
        adjustment_approval_audits=[_approve_audit(20)],
    )
    assert results[20]["classification"] == "EXPLAINED"


@pytest.mark.parametrize("audits, movements, why", [
    # Post-14C approval (audit names a transaction) whose link went missing.
    ([_approve_audit(21, tx=77)], [], "broken current link"),
    # No approval audit at all: nothing proves when or how it was approved.
    ([], [], "no audit evidence"),
    # Two approval audits for one request: contradictory history.
    ([_approve_audit(21), _approve_audit(21)], [], "duplicate audits"),
    # Pre-14C-looking text but a movement already references the request (14C shape).
    ([_approve_audit(21)], [_movement(9, tx_fk=None, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=21)],
     "movement contradicts legacy"),
    # Free-form / altered audit text is not proof either.
    ([_approve_audit(21, text="ADJ-000021: approved manually")], [], "unrecognised audit text"),
])
def test_unproven_or_contradictory_null_links_are_unresolved(audits, movements, why):
    results = _link_results(adjustment_requests=[_request(21)], adjustment_approval_audits=audits,
                            movements=movements)
    assert results[21]["classification"] == "UNRESOLVED", why


def test_linked_approval_contradicting_its_own_audit_or_movement_is_unresolved():
    results = _link_results(
        transactions=[_adj(5), _adj(6)],
        movements=[_movement(3, tx_fk=6, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=31)],
        adjustment_requests=[_request(30, tx=5), _request(31, tx=5)],
        adjustment_approval_audits=[_approve_audit(30, 6),   # audit names a different transaction
                                    _approve_audit(31, 5)],  # its movement is linked to transaction 6
    )
    assert results[30]["classification"] == "UNRESOLVED"
    assert results[31]["classification"] == "UNRESOLVED"


def _anchor(kind, aware_utc, offset_hours):
    return dict(anchor=kind, anchor_id=1, aware_utc=aware_utc, naive_at=aware_utc + timedelta(hours=offset_hours))


T0 = datetime(2026, 5, 1, 3, 0, 0)


def test_provenance_matches_declared_zone(monkeypatch):
    monkeypatch.setattr(diagnostic, "DIAGNOSTIC_NAIVE_TIMEZONE", "UTC")
    findings = analyze_inventory(_snapshot(timestamp_anchors=[_anchor("PURCHASE_RECEIPT", T0, 0)],
                                           session_timezone="Asia/Bangkok"))
    [prov] = _by(findings, "timestamp_provenance")
    assert (prov["classification"], prov["offset_seconds"], prov["declared_offset_seconds"]) == ("CONSISTENT", 0, 0)
    assert _by(findings, "db_session_timezone")[0]["classification"] == "EXPLAINED"


def test_provenance_contradicting_declared_zone_is_unresolved(monkeypatch):
    monkeypatch.setattr(diagnostic, "DIAGNOSTIC_NAIVE_TIMEZONE", "UTC")
    findings = analyze_inventory(_snapshot(timestamp_anchors=[_anchor("TRANSFER_RECEIPT", T0, 7)]))
    [prov] = _by(findings, "timestamp_provenance")
    assert (prov["classification"], prov["offset_seconds"]) == ("UNRESOLVED", 7 * 3600)

    monkeypatch.setattr(diagnostic, "DIAGNOSTIC_NAIVE_TIMEZONE", "Asia/Bangkok")
    findings = analyze_inventory(_snapshot(timestamp_anchors=[_anchor("TRANSFER_RECEIPT", T0, 7)]))
    assert _by(findings, "timestamp_provenance")[0]["classification"] == "CONSISTENT"


def test_provenance_detects_a_session_timezone_change(monkeypatch):
    monkeypatch.setattr(diagnostic, "DIAGNOSTIC_NAIVE_TIMEZONE", "UTC")
    findings = analyze_inventory(_snapshot(timestamp_anchors=[
        _anchor("PURCHASE_RECEIPT", T0, 7), _anchor("PURCHASE_RECEIPT", T0 + timedelta(days=30), 0)]))
    [change] = _by(findings, "timestamp_provenance_change")
    assert change["classification"] == "UNRESOLVED" and change["offsets_seconds"] == [0, 7 * 3600]


def test_unanchored_periods_are_reported_never_assumed():
    early, late = T0 - timedelta(days=90), T0 + timedelta(days=90)
    findings = analyze_inventory(_snapshot(
        movements=[_movement(1, created_at=early), _movement(2, created_at=T0), _movement(3, created_at=late)],
        timestamp_anchors=[_anchor("PURCHASE_RECEIPT", T0, 0)],
    ))
    [gap] = _by(findings, "timestamp_provenance_unanchored")
    assert (gap["classification"], gap["movements_before"], gap["movements_after"]) == ("UNANCHORED", 1, 1)

    no_anchor = analyze_inventory(_snapshot(movements=[_movement(1, created_at=T0)], timestamp_anchors=[]))
    [none] = _by(no_anchor, "timestamp_provenance_unanchored")
    assert (none["classification"], none["movements"]) == ("UNANCHORED", 1)


def test_unanchored_is_informational_for_the_exit_code(monkeypatch, capsys):
    class _Engine:
        class dialect:  # noqa: N801
            name = "postgresql"

        def dispose(self):
            pass

    monkeypatch.setenv("INVENTORY_DIAGNOSTIC_DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(diagnostic, "create_engine", lambda *a, **k: _Engine())
    monkeypatch.setattr(diagnostic, "diagnose_inventory", lambda engine: [
        dict(check="timestamp_provenance_unanchored", classification="UNANCHORED")])
    assert diagnostic.main() == 0
    monkeypatch.setattr(diagnostic, "diagnose_inventory", lambda engine: [
        dict(check="timestamp_provenance", classification="UNRESOLVED")])
    assert diagnostic.main() == 1
    capsys.readouterr()


def test_database_provenance_anchor_matches_the_session_that_wrote_it(client, admin_headers, warehouse_headers):
    """Same-transaction timestamptz/naive pairs reveal the exact offset in
    force when written. In this run every row was written by this server's
    session TimeZone, so the measured offset equals that session's offset."""
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                              requested="1.000").json()["data"]
    with test_engine.connect() as connection:
        session_offset = int(connection.execute(text("SELECT EXTRACT(TIMEZONE FROM now())")).scalar())
        anchor = connection.execute(text(
            "SELECT (s.created_at AT TIME ZONE 'UTC') AS aware_utc, a.created_at AS naive_at "
            "FROM stock_adjustment_requests s JOIN audit_logs a ON a.record_id = s.id "
            "AND a.table_name = 'stock_adjustment_requests' AND a.action = 'CREATE_ADJUSTMENT_REQUEST' "
            "WHERE s.id = :id"), {"id": created["id"]}).one()
    assert int((anchor.naive_at - anchor.aware_utc).total_seconds()) == session_offset

    findings = diagnose_inventory(test_engine)
    offsets = {f["offset_seconds"] for f in _by(findings, "timestamp_provenance")
               if f["anchor"] == "ADJUSTMENT_REQUEST"}
    assert offsets == {session_offset}
    assert _by(findings, "db_session_timezone")


def test_database_post_14c_approval_with_broken_link_is_not_mistaken_for_legacy(
    client, admin_headers, warehouse_headers, db_session,
):
    """A real 14C approval whose link is later lost must be UNRESOLVED, never
    the EXPLAINED pre-14C classification."""
    from app.models import StockAdjustmentRequest
    from tests.test_stock_adjustment_requests import _approve

    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                              requested="2.000").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200

    def classification():
        return next(f for f in diagnose_inventory(test_engine)
                    if f["check"] == "adjustment_request_transaction_link"
                    and f["request_id"] == created["id"])["classification"]

    assert classification() == "CONSISTENT"
    request = db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one()
    request.stock_transaction_id = None
    db_session.commit()
    assert classification() == "UNRESOLVED"


@pytest.mark.parametrize("description, expected", [
    ("ADJ-000040: PENDING -> APPROVED; stock_transaction_id=5", "CONSISTENT"),       # exact 14C text
    ("ADJ-000040: PENDING -> APPROVED; stock_transaction_id=6", "UNRESOLVED"),       # names another tx
    ("ADJ-000040: PENDING -> APPROVED; stock_transaction_id=5 (edited)", "UNRESOLVED"),  # extra suffix
    ("note ADJ-000040: PENDING -> APPROVED; stock_transaction_id=5", "UNRESOLVED"),  # extra prefix
    ("ADJ-000099: PENDING -> APPROVED; stock_transaction_id=5", "UNRESOLVED"),       # wrong request ref
    ("ADJ-000040: PENDING -> APPROVED; stock_transaction_id=abc", "UNRESOLVED"),     # malformed id
    ("ADJ-000040: PENDING -> APPROVED; stock_transaction_id=05", "UNRESOLVED"),      # non-canonical id
    ("ADJ-000040: PENDING -> APPROVED stock_transaction_id=5", "UNRESOLVED"),        # malformed separator
    ("ADJ-000040: PENDING -> APPROVED", "UNRESOLVED"),                               # legacy text, but linked
])
def test_linked_approval_requires_the_whole_exact_audit_text(description, expected):
    # A zero-difference approval (transaction 0, no movement) isolates the
    # audit-text rule; Phase 14D requires a non-zero one to carry a movement.
    results = _link_results(
        transactions=[_adj(5, "0")],
        adjustment_requests=[_request(40, tx=5)],
        adjustment_approval_audits=[_approve_audit(40, text=description)],
    )
    assert results[40]["classification"] == expected


@pytest.mark.parametrize("description", [
    "ADJ-000041: PENDING -> APPROVED ",                     # trailing space
    "ADJ-000041: PENDING -> APPROVED; stock_transaction_id=",  # truncated 14C text
    "ADJ-000041: pending -> approved",                     # altered case
])
def test_unlinked_approval_requires_the_whole_exact_pre_14c_text(description):
    results = _link_results(adjustment_requests=[_request(41)],
                            adjustment_approval_audits=[_approve_audit(41, text=description)])
    assert results[41]["classification"] == "UNRESOLVED"


# --------------------------------------------------------------------------- #
# Phase 14D: exact movement scope and quantity for approved adjustments
# --------------------------------------------------------------------------- #
def _scoped_request(rid=50, tx=8, *, warehouse=1, location=1, batch=7):
    return dict(_request(rid, tx=tx), warehouse_id=warehouse, location_id=location, batch_id=batch)


def _scoped_move(mid=60, *, quantity="-4", before="10", after="6", warehouse=1, location=1, batch=7, tx=8,
                 ref_id=50):
    return dict(id=mid, product_id=1, warehouse_id=warehouse, location_id=location, batch_id=batch,
                quantity=Decimal(quantity), balance_before=Decimal(before), balance_after=Decimal(after),
                reference_type="STOCK_ADJUSTMENT_REQUEST", reference_id=ref_id, stock_transaction_id=tx,
                movement_type="STOCK_ADJUST")


@pytest.mark.parametrize("move, tx_quantity, expected", [
    (_scoped_move(), "-4", "CONSISTENT"),                         # exact scope, matching delta
    (_scoped_move(batch=99), "-4", "UNRESOLVED"),                 # wrong batch
    (_scoped_move(location=99), "-4", "UNRESOLVED"),              # wrong location
    (_scoped_move(warehouse=99), "-4", "UNRESOLVED"),             # wrong warehouse
    (_scoped_move(), "-3", "UNRESOLVED"),                         # transaction != movement delta
    (_scoped_move(after="7"), "-4", "UNRESOLVED"),                # broken before/delta/after
    (None, "-4", "UNRESOLVED"),                                   # non-zero but no movement
    (_scoped_move(quantity="-4"), "0", "UNRESOLVED"),             # zero delta with a fabricated movement
    (None, "0", "CONSISTENT"),                                    # zero delta, no movement
])
def test_approved_adjustment_movement_must_match_exact_scope_and_delta(move, tx_quantity, expected):
    results = _link_results(
        transactions=[dict(id=8, product_id=1, transaction_type="ADJUST", quantity=Decimal(tx_quantity))],
        movements=[move] if move else [],
        adjustment_requests=[_scoped_request()],
        adjustment_approval_audits=[_approve_audit(50, 8)],
    )
    assert results[50]["classification"] == expected


def test_two_movements_for_one_approval_are_unresolved():
    results = _link_results(
        transactions=[dict(id=8, product_id=1, transaction_type="ADJUST", quantity=Decimal("-4"))],
        movements=[_scoped_move(60), _scoped_move(61)],
        adjustment_requests=[_scoped_request()],
        adjustment_approval_audits=[_approve_audit(50, 8)],
    )
    assert results[50]["classification"] == "UNRESOLVED"
