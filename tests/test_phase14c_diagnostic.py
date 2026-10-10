"""Phase 14C diagnostic additions: FK-first transaction links, contradictory
links, Request -> Transaction links, and timestamp provenance."""
from datetime import datetime, timedelta
from decimal import Decimal

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


def test_adjustment_request_link_classifications():
    adj = lambda tid, qty="4": dict(id=tid, product_id=1, transaction_type="ADJUST", quantity=Decimal(qty))  # noqa: E731
    findings = analyze_inventory(_snapshot(
        transactions=[adj(1), adj(2, "0"), adj(3), adj(4)],
        movements=[
            _movement(1, quantity="4", tx_fk=1, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=10),
            _movement(2, quantity="4", tx_fk=4, ref_type="STOCK_ADJUSTMENT_REQUEST", ref_id=999),
        ],
        adjustment_requests=[
            dict(id=10, status="APPROVED", product_id=1, stock_transaction_id=1),   # linked, one movement
            dict(id=11, status="APPROVED", product_id=1, stock_transaction_id=2),   # zero-difference
            dict(id=12, status="APPROVED", product_id=1, stock_transaction_id=None),  # pre-14C
            dict(id=13, status="PENDING", product_id=1, stock_transaction_id=3),    # impossible link
            dict(id=14, status="APPROVED", product_id=2, stock_transaction_id=3),   # wrong product
            dict(id=15, status="APPROVED", product_id=1, stock_transaction_id=4),   # movement names another request
            dict(id=16, status="REJECTED", product_id=1, stock_transaction_id=None),
        ],
    ))
    result = {f["request_id"]: f["classification"] for f in _by(findings, "adjustment_request_transaction_link")}
    assert result == {10: "CONSISTENT", 11: "CONSISTENT", 12: "EXPLAINED", 13: "UNRESOLVED",
                      14: "UNRESOLVED", 15: "UNRESOLVED", 16: "CONSISTENT"}


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
