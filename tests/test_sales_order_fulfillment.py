"""Phase 4 lifecycle and barcode progress through audited inventory setup."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from app.models import SalesOrder, SalesOrderBatchAllocation, StockBalance, InventoryMovement, StockTransaction, ProductBatch
from tests import test_sales_order as sales
from tests.test_stock import _create_product
from tests.test_inventory_authority import assert_aggregates
from tests.test_inventory_transfer import transfer_storage


@pytest.fixture
def fulfillment(client, admin_headers):
    product = _create_product(client, admin_headers, initial_stock="3.000")
    customer = sales._create_customer(client, admin_headers)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="1.125", unit_price=1)
    return product, order["sales_order_id"]


def detail(client, headers, order_id):
    return client.get(f"/api/v1/sales-orders/{order_id}", headers=headers).json()["data"]


def action(client, headers, order_id, name, payload=None):
    method = client.put if name == "cancel" else client.post
    return method(f"/api/v1/sales-orders/{order_id}/{name}", headers=headers, json=payload)


def advance(client, headers, order_id, state):
    if state == "DRAFT":
        return
    sales._confirm_sales_order(client, headers, order_id)
    if state == "CONFIRMED":
        return
    assert action(client, headers, order_id, "start-picking").status_code == 200
    if state == "PICKING":
        return
    payload = sales._fulfillment_payload(client, headers, order_id)
    assert action(client, headers, order_id, "complete-picking", payload).status_code == 200
    if state == "PACKING":
        return
    assert action(client, headers, order_id, "complete-packing", payload).status_code == 200
    if state == "READY_TO_SHIP":
        return
    assert action(client, headers, order_id, "ship").status_code == 200
    if state == "COMPLETED":
        assert action(client, headers, order_id, "complete").status_code == 200


def test_draft_and_full_lifecycle(client, admin_headers, warehouse_headers, warehouse_user, db_session, fulfillment):
    product, order_id = fulfillment
    balance = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    assert balance.reserved_qty == 0
    assert not db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).all()
    movements = db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count()
    sales._confirm_sales_order(client, admin_headers, order_id)
    assert action(client, admin_headers, order_id, "confirm").status_code == 409
    sales._ready_sales_order(client, warehouse_headers, order_id)
    db_session.expire_all()
    assert balance.on_hand_qty == Decimal("3.000")
    assert balance.reserved_qty == Decimal("1.125")
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == movements
    assert action(client, warehouse_headers, order_id, "ship").status_code == 200
    assert action(client, warehouse_headers, order_id, "ship").status_code == 409
    db_session.expire_all()
    assert balance.on_hand_qty == Decimal("1.875")
    assert balance.reserved_qty == 0
    order = db_session.get(SalesOrder, order_id)
    assert order.shipment_number and order.shipped_at
    assert order.picked_by_user_id == order.packed_by_user_id == order.shipped_by_user_id == warehouse_user.id
    assert action(client, admin_headers, order_id, "complete").status_code == 200
    assert action(client, admin_headers, order_id, "complete").status_code == 409
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"], transaction_type="SALE_SHIPMENT").count() == 1
    assert_aggregates(db_session, product["id"])


@pytest.mark.parametrize("state", ["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED", "CANCELLED"])
def test_invalid_transition_matrix(client, admin_headers, fulfillment, state):
    _, order_id = fulfillment
    advance(client, admin_headers, order_id, "DRAFT" if state == "CANCELLED" else state)
    if state == "CANCELLED":
        assert action(client, admin_headers, order_id, "cancel").status_code == 200
    allowed = {"DRAFT": {"confirm", "cancel"}, "CONFIRMED": {"start-picking", "cancel"},
               "PICKING": {"complete-picking", "cancel", "scan-pick"},
               "PACKING": {"complete-packing", "cancel", "scan-pack"},
               "READY_TO_SHIP": {"ship", "cancel"}, "SHIPPED": {"complete"}}
    for name in ("confirm", "start-picking", "complete-picking", "complete-packing", "ship", "complete", "cancel", "scan-pick", "scan-pack"):
        if name in allowed.get(state, set()):
            continue
        payload = {"allocations": [{"allocation_id": 999999, "quantity": "1"}]} if name.startswith("complete-") else None
        if name.startswith("scan-"):
            payload = {"barcode": "unknown"}
        assert action(client, admin_headers, order_id, name, payload).status_code == 409


@pytest.mark.parametrize("state", ["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP"])
def test_cancel_preserves_progress(client, admin_headers, db_session, fulfillment, state):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, state)
    before = detail(client, admin_headers, order_id)["items"][0]["fulfillment_allocations"]
    assert action(client, admin_headers, order_id, "cancel").status_code == 200
    assert action(client, admin_headers, order_id, "cancel").status_code == 409
    assert detail(client, admin_headers, order_id)["items"][0]["fulfillment_allocations"] == before
    db_session.expire_all()
    b = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    assert b.reserved_qty == 0 and b.on_hand_qty == Decimal("3.000")
    assert db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).count() == 0


@pytest.mark.parametrize("packing", [False, True])
def test_barcode_progress(client, admin_headers, warehouse_headers, db_session, fulfillment, packing):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PACKING" if packing else "PICKING")
    endpoint = "scan-pack" if packing else "scan-pick"
    barcode = product["barcode"]
    assert action(client, warehouse_headers, order_id, endpoint, {"barcode": "not-found"}).status_code == 404
    wrong = _create_product(client, admin_headers)
    assert "PRODUCT_NOT_IN_ORDER" in action(client, warehouse_headers, order_id, endpoint, {"barcode": wrong["barcode"]}).text
    for quantity in ("0.001", "1", "0.124"):
        result = action(client, warehouse_headers, order_id, endpoint, {"barcode": barcode, "quantity": quantity})
        assert result.status_code == 200, result.text
    assert action(client, warehouse_headers, order_id, endpoint, {"barcode": barcode}).status_code == 409
    for value in ("0.0001", "NaN", "Infinity", "1000000000000000", "0", "-1"):
        assert action(client, warehouse_headers, order_id, endpoint, {"barcode": barcode, "quantity": value}).status_code == 422
    db_session.expire_all()
    b = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    assert b.on_hand_qty == Decimal("3.000") and b.reserved_qty == Decimal("1.125")
    assert db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).count() == 0
    completion = "complete-packing" if packing else "complete-picking"
    assert action(client, warehouse_headers, order_id, completion, sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200


@pytest.mark.parametrize("packing", [False, True])
def test_completion_membership(client, admin_headers, fulfillment, packing):
    _, order_id = fulfillment
    advance(client, admin_headers, order_id, "PACKING" if packing else "PICKING")
    payload = sales._fulfillment_payload(client, admin_headers, order_id)
    row = payload["allocations"][0]
    endpoint = "complete-packing" if packing else "complete-picking"
    for quantity in ("0.001", "2"):
        assert action(client, admin_headers, order_id, endpoint, {"allocations": [{**row, "quantity": quantity}]}).status_code == 409
    assert action(client, admin_headers, order_id, endpoint, {"allocations": [row, row]}).status_code == 422
    assert action(client, admin_headers, order_id, endpoint, {"allocations": [{**row, "allocation_id": 999999}]}).status_code == 409
    assert action(client, admin_headers, order_id, endpoint, {"allocations": []}).status_code == 422


def test_batch_ambiguity_and_expiry(client, admin_headers, db_session):
    product = sales._create_product(client, admin_headers)
    customer = sales._create_customer(client, admin_headers)
    batches = [sales._create_batch(client, admin_headers, product["id"], quantity=1, expiry_days=days) for days in (1, 2)]
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=2, unit_price=1)
    order_id = order["sales_order_id"]
    advance(client, admin_headers, order_id, "PICKING")
    assert "ALLOCATION_IDENTIFICATION_REQUIRED" in action(client, admin_headers, order_id, "scan-pick", {"barcode": product["barcode"]}).text
    allocation = detail(client, admin_headers, order_id)["items"][0]["fulfillment_allocations"][0]
    assert action(client, admin_headers, order_id, "scan-pick", {"barcode": product["barcode"], "allocation_id": allocation["id"]}).status_code == 200
    payload = sales._fulfillment_payload(client, admin_headers, order_id)
    assert action(client, admin_headers, order_id, "complete-picking", payload).status_code == 200
    assert action(client, admin_headers, order_id, "complete-packing", payload).status_code == 200
    db_session.get(ProductBatch, batches[0]["id"]).expiry_date = date.today() - timedelta(days=1)
    db_session.commit()
    assert action(client, admin_headers, order_id, "ship").status_code == 409
    assert detail(client, admin_headers, order_id)["status"] == "READY_TO_SHIP"
    db_session.get(ProductBatch, batches[0]["id"]).expiry_date = date.today()
    db_session.commit()
    assert action(client, admin_headers, order_id, "ship").status_code == 200


@pytest.mark.parametrize("packing", [False, True])
def test_corrupt_progress_or_source_fails_safely(client, admin_headers, db_session, fulfillment, packing):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "PACKING" if packing else "PICKING")
    a = db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()
    if packing:
        a.picked_quantity = Decimal("0.001")
    else:
        a.stock_balance_id = None
    db_session.commit()
    endpoint = "scan-pack" if packing else "scan-pick"
    assert action(client, admin_headers, order_id, endpoint, {"barcode": product["barcode"]}).status_code == 409
    assert db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).count() == 0


def test_confirmation_expiry_and_no_other_location_borrowing(client, admin_headers, db_session, transfer_storage):
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=1, expiry_days=1)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=1, unit_price=1)["sales_order_id"]
    db_session.get(ProductBatch, batch["id"]).expiry_date = date.today() - timedelta(days=1)
    db_session.commit()
    assert action(client, admin_headers, order_id, "confirm").status_code == 409
    assert detail(client, admin_headers, order_id)["status"] == "DRAFT"
    db_session.get(ProductBatch, batch["id"]).expiry_date = date.today()
    db_session.commit()
    assert action(client, admin_headers, order_id, "confirm").status_code == 200
    other = _create_product(client, admin_headers)
    response = client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": other["id"], "quantity": "3",
        "warehouse_id": transfer_storage["destination_warehouse_id"], "location_id": transfer_storage["destination_location_id"]})
    assert response.status_code == 200
    second = sales._create_sales_order(client, admin_headers, customer["id"], other["id"], quantity=1, unit_price=1)
    assert action(client, admin_headers, second["sales_order_id"], "confirm").status_code == 409
    db_session.expire_all()
    assert db_session.query(StockBalance).filter_by(product_id=other["id"]).one().reserved_qty == 0


@pytest.mark.parametrize("batch", [False, True])
def test_historical_completed_returns(client, admin_headers, db_session, batch):
    product = sales._create_product(client, admin_headers) if batch else _create_product(client, admin_headers, initial_stock="1.125")
    if batch:
        sales._create_batch(client, admin_headers, product["id"], quantity="1.125", expiry_days=1)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="1.125", unit_price=1)["sales_order_id"]
    advance(client, admin_headers, order_id, "COMPLETED")
    # Represent the nullable metadata of pre-Phase-4 completed orders.
    order = db_session.get(SalesOrder, order_id)
    for field in ("shipment_number", "picked_at", "packed_at", "shipped_at", "picked_by_user_id", "packed_by_user_id", "shipped_by_user_id"):
        setattr(order, field, None)
    a = db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()
    if batch:
        a.stock_balance_id = a.picked_quantity = a.packed_quantity = None
    else:
        db_session.delete(a)
    db_session.commit()
    for quantity in ("0.001", "1.124"):
        response = action(client, admin_headers, order_id, "return", {"items": [{"product_id": product["id"], "quantity": quantity, "reason": "Legacy return"}]})
        assert response.status_code == 200, response.text
    assert action(client, admin_headers, order_id, "return", {"items": [{"product_id": product["id"], "quantity": "0.001", "reason": "Excess"}]}).status_code == 409
    assert detail(client, admin_headers, order_id)["status"] == "COMPLETED"


def test_multiline_shipment_and_confirmation_rollback(client, admin_headers, db_session, monkeypatch):
    from app.repositories.stock_balance_repository import StockBalanceRepository
    customer = sales._create_customer(client, admin_headers)
    products = [_create_product(client, admin_headers, initial_stock="1.125"), _create_product(client, admin_headers)]
    response = client.post("/api/v1/sales-orders/", headers=admin_headers, json={"customer_id": customer["id"], "items": [
        {"product_id": p["id"], "quantity": "1.125", "unit_price": 1} for p in products]})
    order_id = response.json()["data"]["sales_order_id"]
    assert action(client, admin_headers, order_id, "confirm").status_code == 409
    db_session.expire_all()
    assert db_session.query(StockBalance).filter_by(product_id=products[0]["id"]).one().reserved_qty == 0
    assert not db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).all()
    assert client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": products[1]["id"], "quantity": "1.125"}).status_code == 200
    advance(client, admin_headers, order_id, "READY_TO_SHIP")
    original = StockBalanceRepository.sync_aggregates
    def fail_second(self, product_id, actor):
        original(self, product_id, actor)
        if product_id == products[1]["id"]:
            from app.core.exceptions import AppException
            raise AppException(message="Injected atomic rollback", status_code=409)
    monkeypatch.setattr(StockBalanceRepository, "sync_aggregates", fail_second)
    assert action(client, admin_headers, order_id, "ship").status_code == 409
    db_session.expire_all()
    assert db_session.get(SalesOrder, order_id).status == "READY_TO_SHIP"
    assert db_session.get(SalesOrder, order_id).shipment_number is None
    for p in products:
        balance = db_session.query(StockBalance).filter_by(product_id=p["id"]).one()
        assert balance.on_hand_qty == balance.reserved_qty == Decimal("1.125")
        assert_aggregates(db_session, p["id"])
    assert db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).count() == 0
    assert db_session.query(StockTransaction).filter(StockTransaction.product_id.in_([p["id"] for p in products]), StockTransaction.transaction_type == "SALE_SHIPMENT").count() == 0


@pytest.mark.parametrize("batch", [False, True])
def test_pinned_source_survives_default_location_change(client, admin_headers, db_session, batch):
    from app.models import WarehouseLocation
    product = sales._create_product(client, admin_headers) if batch else _create_product(client, admin_headers, initial_stock="1.125")
    if batch:
        sales._create_batch(client, admin_headers, product["id"], quantity="1.125", expiry_days=1)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="1.125", unit_price=1)["sales_order_id"]
    advance(client, admin_headers, order_id, "READY_TO_SHIP")
    a = db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()
    balance = db_session.get(StockBalance, a.stock_balance_id)
    location = db_session.get(WarehouseLocation, balance.location_id)
    old_code = location.location_code
    location.location_code = "PINNED_" + uuid4().hex[:12]
    db_session.commit()
    try:
        assert action(client, admin_headers, order_id, "ship").status_code == 200
        assert action(client, admin_headers, order_id, "return", {"items": [{"product_id": product["id"], "quantity": "0.001", "reason": "Pinned return"}]}).status_code == 200
        db_session.expire_all()
        assert balance.on_hand_qty == Decimal("0.001")
        movements = db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).all()
        assert all(m.location_id == balance.location_id for m in movements)
    finally:
        location.location_code = old_code
        db_session.commit()


def test_combined_balance_demand_and_full_packing_required(client, admin_headers, db_session, fulfillment):
    product, order_id = fulfillment
    advance(client, admin_headers, order_id, "CONFIRMED")
    first = db_session.query(SalesOrderBatchAllocation).filter_by(sales_order_id=order_id).one()
    first.quantity = Decimal("0.125")
    db_session.add(SalesOrderBatchAllocation(sales_order_id=order_id, sales_order_item_id=first.sales_order_item_id,
        product_id=first.product_id, stock_balance_id=first.stock_balance_id, batch_id=None,
        quantity=Decimal("1.000"), picked_quantity=Decimal(0), packed_quantity=Decimal(0)))
    db_session.commit()
    sales._ready_sales_order(client, admin_headers, order_id)
    db_session.expire_all()
    balance = db_session.get(StockBalance, first.stock_balance_id)
    balance.reserved_qty = Decimal("1.000")
    db_session.commit()
    assert action(client, admin_headers, order_id, "ship").status_code == 409
    balance.reserved_qty = Decimal("1.125")
    first.packed_quantity = Decimal(0)
    db_session.commit()
    assert action(client, admin_headers, order_id, "ship").status_code == 409
    first.packed_quantity = first.quantity
    db_session.commit()
    assert action(client, admin_headers, order_id, "ship").status_code == 200
    movements = db_session.query(InventoryMovement).filter_by(reference_type="SALES_ORDER", reference_id=order_id).all()
    assert len(movements) == 1 and movements[0].quantity == Decimal("-1.125")


def test_sales_same_lot_across_products(client, admin_headers):
    customer = sales._create_customer(client, admin_headers)
    products = [sales._create_product(client, admin_headers) for _ in range(2)]
    lot = "SHARED_" + uuid4().hex[:12]
    batches = []
    for p in products:
        response = client.post("/api/v1/batches", headers=admin_headers, json={"product_id": p["id"], "lot_no": lot,
            "quantity": "1.125", "mfg_date": (date.today() - timedelta(days=1)).isoformat(), "expiry_date": date.today().isoformat()})
        assert response.status_code == 201, response.text
        batches.append(response.json()["data"]["batch"]["id"])
    response = client.post("/api/v1/sales-orders/", headers=admin_headers, json={"customer_id": customer["id"], "items": [
        {"product_id": p["id"], "quantity": "1.125", "unit_price": 1} for p in products]})
    order_id = response.json()["data"]["sales_order_id"]
    advance(client, admin_headers, order_id, "SHIPPED")
    items = detail(client, admin_headers, order_id)["items"]
    assert [item["batch_allocations"][0]["batch_id"] for item in items] == batches
