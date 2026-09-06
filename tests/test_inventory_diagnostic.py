from decimal import Decimal
from uuid import uuid4

from app.models import Product
from scripts.check_inventory_consistency import analyze_inventory, diagnose_inventory
from tests.conftest import test_engine


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
