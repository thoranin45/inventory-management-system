"""Phase 12C.5 — Pick/Pack Undo.

Undo is counter-only: it reverses scan progress on an allocation and never
touches stock balances or the inventory ledger (pick/pack progress does not
either — stock reserves at confirm and deducts at ship).
"""
from decimal import Decimal

import pytest

from app.models import AuditLog, InventoryMovement, SalesOrderBatchAllocation, StockBalance, StockTransaction
from tests import test_sales_order as sales
from tests.test_sales_order_fulfillment import action, advance, detail, fulfillment  # noqa: F401


def _allocation(db_session, order_id):
    return db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()


# --------------------------------------------------------------------------- #
# Undo Pick
# --------------------------------------------------------------------------- #
def test_undo_pick_reverses_scan_progress(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    assert action(client, warehouse_headers, order_id, "scan-pick",
                  {"barcode": product["barcode"], "quantity": "1.000"}).status_code == 200
    alloc_id = _allocation(db_session, order_id).id

    response = action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": alloc_id, "quantity": "0.400"})
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert Decimal(str(body["picked_quantity"])) == Decimal("0.600")

    db_session.expire_all()
    assert _allocation(db_session, order_id).picked_quantity == Decimal("0.600")


def test_undo_pick_defaults_to_one_unit(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"], "quantity": "1.000"})
    alloc_id = _allocation(db_session, order_id).id

    assert action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": alloc_id}).status_code == 200

    db_session.expire_all()
    assert _allocation(db_session, order_id).picked_quantity == Decimal("0.000")


def test_undo_pick_cannot_go_below_zero(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"], "quantity": "0.100"})
    alloc_id = _allocation(db_session, order_id).id

    response = action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": alloc_id, "quantity": "0.500"})
    assert response.status_code == 409
    assert "UNDO_BELOW_ZERO" in response.text
    assert response.json()["request_id"]

    db_session.expire_all()
    assert _allocation(db_session, order_id).picked_quantity == Decimal("0.100")  # unchanged


def test_undo_pick_unknown_allocation_rejected(client, admin_headers, warehouse_headers, fulfillment):
    _, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    response = action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": 999999, "quantity": "1"})
    assert response.status_code == 404
    assert "ALLOCATION_NOT_IN_ORDER" in response.text


def test_undo_pick_rejects_allocation_from_another_order(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")

    customer = sales._create_customer(client, admin_headers)
    other = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="1.000", unit_price=1)
    other_id = other["sales_order_id"]
    advance(client, admin_headers, other_id, "PICKING")
    foreign_alloc_id = db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=other_id).one().id

    response = action(client, warehouse_headers, order_id, "undo-pick",
                      {"allocation_id": foreign_alloc_id, "quantity": "1"})
    assert response.status_code == 404
    assert "ALLOCATION_NOT_IN_ORDER" in response.text


@pytest.mark.parametrize("state", ["CONFIRMED", "PACKING", "READY_TO_SHIP"])
def test_undo_pick_only_in_picking(client, admin_headers, warehouse_headers, db_session, fulfillment, state):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, state)
    # An allocation id that really belongs to the order (membership must not be the failure).
    alloc_id = _allocation(db_session, order_id).id
    response = action(client, warehouse_headers, order_id, "undo-pick", {"allocation_id": alloc_id, "quantity": "1"})
    assert response.status_code == 409
    assert "state conflict" in response.text.lower() or "requires" in response.text.lower()


# --------------------------------------------------------------------------- #
# Undo Pack
# --------------------------------------------------------------------------- #
def test_undo_pack_reverses_scan_progress(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PACKING")
    assert action(client, warehouse_headers, order_id, "scan-pack",
                  {"barcode": product["barcode"], "quantity": "1.000"}).status_code == 200
    alloc_id = _allocation(db_session, order_id).id

    response = action(client, warehouse_headers, order_id, "undo-pack", {"allocation_id": alloc_id, "quantity": "0.250"})
    assert response.status_code == 200, response.text

    db_session.expire_all()
    allocation = _allocation(db_session, order_id)
    assert allocation.packed_quantity == Decimal("0.750")
    assert allocation.picked_quantity == Decimal("1.125")  # pick counter untouched


def test_undo_pack_cannot_go_below_zero(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PACKING")
    action(client, warehouse_headers, order_id, "scan-pack", {"barcode": product["barcode"], "quantity": "0.100"})
    alloc_id = _allocation(db_session, order_id).id

    response = action(client, warehouse_headers, order_id, "undo-pack", {"allocation_id": alloc_id, "quantity": "0.500"})
    assert response.status_code == 409
    assert "UNDO_BELOW_ZERO" in response.text

    db_session.expire_all()
    assert _allocation(db_session, order_id).packed_quantity == Decimal("0.100")


def test_undo_pack_only_in_packing(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    alloc_id = _allocation(db_session, order_id).id
    response = action(client, warehouse_headers, order_id, "undo-pack", {"allocation_id": alloc_id, "quantity": "1"})
    assert response.status_code == 409


# --------------------------------------------------------------------------- #
# Cross-cutting: auth, audit, no stock side effects
# --------------------------------------------------------------------------- #
def test_undo_requires_authentication(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"], "quantity": "1.000"})
    alloc_id = _allocation(db_session, order_id).id
    response = client.post(f"/api/v1/sales-orders/{order_id}/undo-pick",
                           json={"allocation_id": alloc_id, "quantity": "1"})
    assert response.status_code == 401


def test_undo_pick_writes_audit_and_no_stock_side_effects(client, admin_headers, warehouse_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PICKING")
    action(client, warehouse_headers, order_id, "scan-pick", {"barcode": product["barcode"], "quantity": "1.000"})
    alloc_id = _allocation(db_session, order_id).id

    db_session.expire_all()
    balance_before = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    on_hand_before, reserved_before = balance_before.on_hand_qty, balance_before.reserved_qty
    tx_before = db_session.query(StockTransaction).count()

    assert action(client, warehouse_headers, order_id, "undo-pick",
                  {"allocation_id": alloc_id, "quantity": "0.400"}).status_code == 200

    db_session.expire_all()
    row = (db_session.query(AuditLog)
           .filter_by(action="PICK_UNDO", table_name="sales_orders", record_id=order_id)
           .order_by(AuditLog.id.desc()).first())
    assert row is not None
    assert row.username  # actor preserved
    assert f"Allocation {alloc_id}" in row.description
    assert "decrement 0.400" in row.description
    assert "picked_quantity=0.600" in row.description

    balance_after = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    assert balance_after.on_hand_qty == on_hand_before
    assert balance_after.reserved_qty == reserved_before
    assert db_session.query(StockTransaction).count() == tx_before
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="SALES_ORDER", reference_id=order_id).count() == 0
