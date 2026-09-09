from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from app.models import Product, StockBalance, Warehouse
from scripts.check_inventory_consistency import analyze_inventory, diagnose_inventory
from tests.conftest import test_engine
from tests.test_inventory_transfer import (  # noqa: F401
    transfer_storage,
    _create_draft_transfer,
    _create_product,
    _dispatch,
    _receive,
    _receive_lines,
    _stock_in,
)


def test_diagnostic_reports_missing_balance_without_changing_data(db_session):
    product = Product(sku=uuid4().hex, product_name="Diagnostic fixture", price=1, stock_qty=7)
    db_session.add(product)
    db_session.commit()
    findings = diagnose_inventory(test_engine)
    finding = next(f for f in findings if f["check"] == "products_aggregate" and f["id"] == product.id)
    assert finding["classification"] == "MISSING_EVIDENCE"
    assert finding["delta"] == Decimal("7")
    db_session.refresh(product)
    assert product.stock_qty == Decimal("7")


def test_diagnostic_arithmetic_reservations_and_ambiguous_history():
    snapshot = dict(products=[dict(id=1, stock_qty=8)], batches=[], transactions=[
        dict(id=1, product_id=1, transaction_type="IN_PO", quantity=8)],
        balances=[dict(id=1, product_id=1, warehouse_id=1, location_id=1, batch_id=None, on_hand_qty=8, reserved_qty=9)],
        movements=[dict(id=1, product_id=1, warehouse_id=1, location_id=1, batch_id=None,
                        quantity=5, balance_before=0, balance_after=7, reference_type="PURCHASE_ORDER", reference_id=1)])
    findings = analyze_inventory(snapshot)
    by_check = {f["check"]: f["classification"] for f in findings}
    assert by_check["products_aggregate"] == "CONSISTENT"
    assert by_check["reservation_bounds"] == "UNRESOLVED"
    assert by_check["movement_arithmetic"] == "UNRESOLVED"
    assert by_check["movement_closing_balance"] == "UNRESOLVED"
    assert by_check["transaction_movement_link"] == "MISSING_EVIDENCE"
    # a snapshot without any transfer data emits no Phase 6 findings
    assert not any(f["check"].startswith("transfer_") or f["check"].startswith("transit_")
                   or f["check"] == "legacy_transfer_history_distinct" for f in findings)


def _phase6_findings(check):
    findings = diagnose_inventory(test_engine)
    return [f for f in findings if f["check"] == check]


def test_diagnostic_transfer_lifecycle_is_consistent(client, admin_headers, transfer_storage, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "40.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="30.000"
    )
    _dispatch(client, admin_headers, transfer["id"])
    # leave 12.000 still in transit, 18.000 received
    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "18.000"}])

    db_session.expire_all()
    item_id = db_session.execute(text(
        "SELECT id FROM inventory_transfer_items WHERE transfer_id = :t"
    ), {"t": transfer["id"]}).scalar()
    transit_warehouse_id = db_session.query(Warehouse.id).filter_by(warehouse_code="__TRANSIT__").scalar()
    transit_balance_id = db_session.query(StockBalance.id).filter_by(
        product_id=product["id"], warehouse_id=transit_warehouse_id
    ).scalar()

    pairing = [f for f in _phase6_findings("transfer_movement_pair_conservation")
               if f["transfer_item_id"] == item_id]
    totals = [f for f in _phase6_findings("transfer_receipt_movement_totals")
              if f["transfer_item_id"] == item_id]
    distinct = [f for f in _phase6_findings("legacy_transfer_history_distinct")
                if f["transfer_item_id"] == item_id]
    reconciliation = [f for f in _phase6_findings("transit_outstanding_reconciliation")
                      if f["transit_stock_balance_id"] == transit_balance_id]

    assert len(pairing) == 1 and pairing[0]["classification"] == "CONSISTENT"
    assert pairing[0]["net_movement"] == Decimal("0")
    assert len(totals) == 1 and totals[0]["classification"] == "CONSISTENT"
    assert totals[0]["received_quantity"] == Decimal("18.000")
    assert totals[0]["destination_in"] == Decimal("18.000")
    assert totals[0]["transit_out"] == Decimal("18.000")
    assert len(distinct) == 1 and distinct[0]["classification"] == "CONSISTENT"
    assert len(reconciliation) == 1 and reconciliation[0]["classification"] == "CONSISTENT"
    assert reconciliation[0]["on_hand"] == Decimal("12.000")
    assert reconciliation[0]["outstanding"] == Decimal("12.000")


def test_diagnostic_flags_transit_balance_drift_without_touching_data(
    client, admin_headers, transfer_storage, db_session
):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "20.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="10.000"
    )
    _dispatch(client, admin_headers, transfer["id"])

    transit_warehouse = (
        db_session.query(Warehouse).filter_by(warehouse_code="__TRANSIT__").one()
    )
    transit_balance = (
        db_session.query(StockBalance)
        .filter_by(product_id=product["id"], warehouse_id=transit_warehouse.id)
        .one()
    )
    transit_balance_id = transit_balance.id
    # Simulate drift: transit shows more than the outstanding dispatched quantity.
    transit_balance.on_hand_qty = Decimal("11.000")
    db_session.commit()

    results = [
        f for f in _phase6_findings("transit_outstanding_reconciliation")
        if f["transit_stock_balance_id"] == transit_balance_id
    ]
    assert len(results) == 1 and results[0]["classification"] == "UNRESOLVED"
    assert results[0]["delta"] == Decimal("1.000")

    # the diagnostic never rewrote the row
    db_session.expire_all()
    assert db_session.query(StockBalance).filter_by(
        product_id=product["id"], warehouse_id=transit_warehouse.id
    ).one().on_hand_qty == Decimal("11.000")


def test_diagnostic_marks_legacy_immediate_transfer_history_distinct():
    """A legacy_completed transfer with NULL progress and unlinked movements is EXPLAINED,
    not confused with a lifecycle transfer."""
    snapshot = dict(
        products=[dict(id=1, stock_qty=0)], batches=[], transactions=[], balances=[],
        movements=[
            dict(id=1, product_id=1, warehouse_id=1, location_id=1, batch_id=None, quantity=-2,
                 balance_before=2, balance_after=0, reference_type="INVENTORY_TRANSFER", reference_id=9,
                 movement_type="TRANSFER_OUT", transfer_item_id=None, transfer_receipt_id=None),
            dict(id=2, product_id=1, warehouse_id=2, location_id=2, batch_id=None, quantity=2,
                 balance_before=0, balance_after=2, reference_type="INVENTORY_TRANSFER", reference_id=9,
                 movement_type="TRANSFER_IN", transfer_item_id=None, transfer_receipt_id=None),
        ],
        transfers=[dict(id=9, status="COMPLETED", legacy_completed=True)],
        transfer_items=[dict(id=90, transfer_id=9, product_id=1, batch_id=None, quantity=2,
                             dispatched_quantity=None, received_quantity=None,
                             source_stock_balance_id=None, transit_stock_balance_id=None)],
        transfer_receipts=[],
    )
    findings = analyze_inventory(snapshot)
    legacy = [f for f in findings if f["check"] == "legacy_transfer_history_distinct"]
    assert legacy and all(f["classification"] == "EXPLAINED" for f in legacy)
