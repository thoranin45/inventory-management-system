from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import AuditLog, InventoryMovement, Product, ProductBatch, StockBalance, StockTransaction
from app.repositories.stock_balance_repository import StockBalanceRepository
from tests.test_stock import _create_product, _create_batch
from tests.test_inventory_transfer import transfer_storage
from tests import test_purchase_order as purchase
from tests import test_sales_order as sales


def assert_aggregates(db, product_id):
    db.expire_all()
    balances = db.query(StockBalance).filter_by(product_id=product_id).all()
    assert db.get(Product, product_id).stock_qty == sum((b.on_hand_qty for b in balances), Decimal("0"))
    assert all(0 <= b.reserved_qty <= b.on_hand_qty for b in balances)
    for batch in db.query(ProductBatch).filter_by(product_id=product_id).all():
        assert batch.quantity == sum((b.on_hand_qty for b in balances if b.batch_id == batch.id), Decimal("0"))
    for movement in db.query(InventoryMovement).filter_by(product_id=product_id).all():
        assert movement.balance_after == movement.balance_before + movement.quantity


@pytest.mark.parametrize("quantity", [1, "0.001", 100])
def test_product_nonzero_initial_stock_rejected(client, admin_headers, quantity):
    response = client.post("/api/v1/products", headers=admin_headers, json={
        "sku": uuid4().hex, "product_name": "Direct initialization", "price": 1, "stock_qty": quantity,
    })
    assert response.status_code == 422


@pytest.mark.parametrize("quantity", [None, 0, 10])
def test_product_stock_update_rejected(client, admin_headers, quantity):
    product = _create_product(client, admin_headers)
    response = client.put(f"/api/v1/products/{product['id']}", headers=admin_headers, json={"stock_qty": quantity})
    assert response.status_code == 422


@pytest.mark.parametrize("reserved", [0, 1])
def test_nonzero_raw_balance_creation_rejected(client, admin_headers, db_session, transfer_storage, reserved):
    product = _create_product(client, admin_headers)
    response = client.post("/api/v1/stock-balances", headers=admin_headers, json={
        "product_id": product["id"],
        "warehouse_id": transfer_storage["destination_warehouse_id"],
        "location_id": transfer_storage["destination_location_id"],
        "on_hand_qty": 10,
        "reserved_qty": reserved,
    })
    assert response.status_code == 409
    assert "zero-balance initialization" in response.json()["message"]
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 0
    assert db_session.get(Product, product["id"]).stock_qty == 0


def test_stock_in_derives_stale_compatibility_with_audit(client, admin_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    db_session.get(Product, product["id"]).stock_qty = 999
    db_session.commit()
    response = client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": product["id"], "quantity": 5})
    assert response.status_code == 200
    assert Decimal(response.json()["data"]["previous_stock"]) == 10
    assert Decimal(response.json()["data"]["current_stock"]) == 15
    assert_aggregates(db_session, product["id"])
    audit = db_session.query(AuditLog).filter_by(action="DERIVE_INVENTORY_TOTAL", table_name="products", record_id=product["id"]).order_by(AuditLog.id.desc()).first()
    assert "before=999" in audit.description
    assert "derived=15" in audit.description


@pytest.mark.parametrize("method", ["out-fifo", "out-fefo"])
@pytest.mark.parametrize("stale", [0, 999])
def test_stock_out_uses_balances_not_product_or_batch_cache(client, admin_headers, db_session, method, stale):
    product = _create_product(client, admin_headers)
    batch = _create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=90)
    db_session.get(Product, product["id"]).stock_qty = stale
    db_session.get(ProductBatch, batch["id"]).quantity = stale
    db_session.commit()
    response = client.post(f"/api/v1/stock/{method}", headers=admin_headers, json={"product_id": product["id"], "quantity": 4})
    assert response.status_code == 200
    assert Decimal(response.json()["data"]["current_stock"]) == 6
    assert_aggregates(db_session, product["id"])


def test_adjustment_one_location_preserves_other_locations(client, admin_headers, db_session, transfer_storage):
    product = _create_product(client, admin_headers, initial_stock=10)
    response = client.post("/api/v1/stock/in", headers=admin_headers, json={
        "product_id": product["id"], "quantity": 20,
        "warehouse_id": transfer_storage["destination_warehouse_id"],
        "location_id": transfer_storage["destination_location_id"],
    })
    assert response.status_code == 200
    response = client.post("/api/v1/stock/adjust", headers=admin_headers, json={
        "product_id": product["id"], "new_quantity": 5, "remark": "Count MAIN only",
    })
    assert response.status_code == 200
    assert Decimal(response.json()["data"]["current_stock"]) == 25
    assert Decimal(response.json()["data"]["difference"]) == -5
    assert_aggregates(db_session, product["id"])
    remote = db_session.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transfer_storage["destination_warehouse_id"]).one()
    assert remote.on_hand_qty == 20


@pytest.mark.parametrize("storage,status", [
    ({"warehouse_id": 999999}, 422),
    ({"warehouse_id": 999999, "location_id": 999999}, 404),
])
def test_explicit_invalid_storage_never_falls_back(client, admin_headers, db_session, storage, status):
    product = _create_product(client, admin_headers)
    response = client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": product["id"], "quantity": 1, **storage})
    assert response.status_code == status
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).count() == 0


def test_legacy_missing_balance_evidence_is_not_reconciled(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    db_session.get(Product, product["id"]).stock_qty = 50
    db_session.commit()
    response = client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": product["id"], "quantity": 1})
    assert response.status_code == 409
    assert "diagnostic" in response.json()["message"]
    db_session.expire_all()
    assert db_session.get(Product, product["id"]).stock_qty == 50
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 0


def test_tracking_change_rejected_after_inventory_history(client, admin_headers):
    product = _create_product(client, admin_headers, initial_stock=1)
    response = client.post("/api/v1/stock/adjust", headers=admin_headers, json={
        "product_id": product["id"], "new_quantity": 0, "remark": "Count zero",
    })
    assert response.status_code == 200
    response = client.put(f"/api/v1/products/{product['id']}", headers=admin_headers, json={"track_batch": True})
    assert response.status_code == 409


def test_po_receiving_explicit_location_maintains_aggregates(client, admin_headers, db_session, transfer_storage):
    supplier = purchase._create_supplier(client, admin_headers)
    product = purchase._create_product(client, admin_headers)
    order = purchase._create_purchase_order(client, admin_headers, supplier["id"], product["id"])
    purchase._confirm_purchase_order(client, admin_headers, order['id'])
    payload = purchase._receive_payload(product["id"], quantity=4)
    payload.update(warehouse_id=transfer_storage["destination_warehouse_id"], location_id=transfer_storage["destination_location_id"])
    response = client.post(f"/api/v1/purchase-orders/{order['id']}/receive", headers={**admin_headers, "Idempotency-Key": uuid4().hex}, json=payload)
    assert response.status_code == 200
    assert_aggregates(db_session, product["id"])
    movement = db_session.query(InventoryMovement).filter_by(product_id=product["id"]).one()
    assert movement.warehouse_id == transfer_storage["destination_warehouse_id"]
    assert movement.quantity == 4


def test_sales_reservation_shipment_return_use_balances(client, admin_headers, db_session):
    customer = sales._create_customer(client, admin_headers)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=90)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=4, unit_price=1)
    sales._confirm_sales_order(client, admin_headers, order['sales_order_id'])
    balance = db_session.query(StockBalance).filter_by(product_id=product["id"]).one()
    assert balance.on_hand_qty == 10
    assert balance.reserved_qty == 4
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 1
    db_session.get(Product, product["id"]).stock_qty = 0
    db_session.get(ProductBatch, batch["id"]).quantity = 0
    db_session.commit()
    sales._ready_sales_order(client, admin_headers, order["sales_order_id"])
    sales._ship_sales_order(client, admin_headers, order["sales_order_id"])
    assert_aggregates(db_session, product["id"])
    assert balance.on_hand_qty == 6
    assert balance.reserved_qty == 0
    response = client.post(f"/api/v1/sales-orders/{order['sales_order_id']}/return", headers=admin_headers,
                           json={"items": [{"product_id": product["id"], "quantity": 2, "reason": "Return"}]})
    assert response.status_code == 200
    assert_aggregates(db_session, product["id"])
    assert balance.on_hand_qty == 8


def test_aggregate_failure_rolls_back_entire_operation(client, admin_headers, db_session, monkeypatch):
    product = _create_product(client, admin_headers, initial_stock=10)
    before = (db_session.query(InventoryMovement).count(), db_session.query(StockTransaction).count(), db_session.query(AuditLog).count())
    def fail(*args):
        raise RuntimeError("Aggregate write failed")
    monkeypatch.setattr(StockBalanceRepository, "sync_aggregates", fail)
    with pytest.raises(RuntimeError, match="Aggregate write failed"):
        client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": product["id"], "quantity": 3})
    assert_aggregates(db_session, product["id"])
    assert db_session.get(Product, product["id"]).stock_qty == 10
    assert before == (db_session.query(InventoryMovement).count(), db_session.query(StockTransaction).count(), db_session.query(AuditLog).count())
