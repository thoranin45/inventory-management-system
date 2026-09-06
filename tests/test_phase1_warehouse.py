from decimal import Decimal

from app.models import InventoryMovement
from tests import test_purchase_order as purchase
from tests import test_sales_order as sales
from tests import test_inventory_transfer as transfer
from tests.test_inventory_transfer import transfer_storage


def test_warehouse_can_receive_purchase_order(client, admin_headers, warehouse_headers, warehouse_user, db_session):
    supplier = purchase._create_supplier(client, admin_headers)
    product = purchase._create_product(client, admin_headers)
    order = purchase._create_purchase_order(client, admin_headers, supplier["id"], product["id"])
    response = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive", headers=warehouse_headers,
        json=purchase._receive_payload(product["id"], quantity=10),
    )
    assert response.status_code == 200
    movements = db_session.query(InventoryMovement).filter_by(product_id=product["id"]).all()
    assert movements
    assert all(movement.created_by_user_id == warehouse_user.id for movement in movements)
    assert sum(movement.quantity for movement in movements) == Decimal("10")


def test_warehouse_can_ship_return_and_cancel(client, admin_headers, warehouse_headers):
    customer = sales._create_customer(client, admin_headers)
    product = sales._create_product(client, admin_headers)
    sales._create_batch(client, warehouse_headers, product["id"], quantity=20, expiry_days=90)
    order = sales._create_sales_order(
        client, admin_headers, customer["id"], product["id"], quantity=6, unit_price=100,
    )
    sales._confirm_sales_order(client, admin_headers, order['sales_order_id'])
    sales._ready_sales_order(client, warehouse_headers, order["sales_order_id"])
    sales._ship_sales_order(client, warehouse_headers, order["sales_order_id"])
    response = client.post(
        f"/api/v1/sales-orders/{order['sales_order_id']}/return", headers=warehouse_headers,
        json={"items": [{"product_id": product["id"], "quantity": 2, "reason": "Damaged package"}]},
    )
    assert response.status_code == 200
    second_order = sales._create_sales_order(
        client, admin_headers, customer["id"], product["id"], quantity=2, unit_price=100,
    )
    sales._confirm_sales_order(client, admin_headers, second_order['sales_order_id'])
    response = client.put(
        f"/api/v1/sales-orders/{second_order['sales_order_id']}/cancel", headers=warehouse_headers,
    )
    assert response.status_code == 200


def test_warehouse_can_complete_and_cancel_transfers(
    client, admin_headers, warehouse_headers, warehouse_user, db_session, transfer_storage,
):
    product = transfer._create_product(client, admin_headers)
    transfer._stock_in(client, warehouse_headers, product["id"], "20.000")
    draft = transfer._create_draft_transfer(client, warehouse_headers, product["id"], transfer_storage)
    response = client.post(
        f"/api/v1/inventory-transfers/{draft['id']}/complete", headers=warehouse_headers,
    )
    assert response.status_code == 200
    movements = db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=draft["id"],
    ).all()
    assert len(movements) == 2
    assert all(movement.created_by_user_id == warehouse_user.id for movement in movements)
    assert sum(movement.quantity for movement in movements) == Decimal("0")
    draft = transfer._create_draft_transfer(client, warehouse_headers, product["id"], transfer_storage)
    response = client.post(
        f"/api/v1/inventory-transfers/{draft['id']}/cancel", headers=warehouse_headers,
    )
    assert response.status_code == 200
