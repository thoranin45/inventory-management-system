"""PO lifecycle, exact receipts and durable retries through the real API."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4
import pytest
from app.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderReceipt, StockBalance, ProductBatch, InventoryMovement, StockTransaction, AuditLog
from tests import test_purchase_order as purchase
from tests.test_stock import _create_product
from tests.test_inventory_authority import assert_aggregates
from tests.test_inventory_transfer import transfer_storage


@pytest.fixture
def receipt_order(client, admin_headers):
    p = _create_product(client, admin_headers, initial_stock="5.000")
    supplier = purchase._create_supplier(client, admin_headers)
    order = purchase._create_purchase_order(client, admin_headers, supplier["id"], p["id"], quantity=10)
    return p, order["id"]


def receive(client, headers, po_id, quantity="3.000", product_id=None, payload=None, key=None):
    return client.post(f"/api/v1/purchase-orders/{po_id}/receive",
        headers={**headers, "Idempotency-Key": key or uuid4().hex},
        json=payload or {"items": [{"product_id": product_id, "quantity": quantity}]})


def test_repeated_partial_and_final_replay(client, admin_headers, warehouse_headers, warehouse_user, db_session, receipt_order):
    p, po_id = receipt_order
    assert receive(client, warehouse_headers, po_id, product_id=p["id"]).status_code == 409
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    assert client.post(f"/api/v1/purchase-orders/{po_id}/confirm", headers=admin_headers).status_code == 409
    for amount, total, expected in (("3", "8", "PARTIALLY_RECEIVED"), ("2", "10", "PARTIALLY_RECEIVED"), ("5", "15", "RECEIVED")):
        key = uuid4().hex
        response = receive(client, warehouse_headers, po_id, quantity=amount, product_id=p["id"], key=key)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["status"] == expected and data["received_batches"] == []
        assert Decimal(data["received_items"][0]["current_stock"]) == Decimal(total)
        assert receive(client, warehouse_headers, po_id, quantity=amount + ".000", product_id=p["id"], key=key).json() == response.json()
        assert receive(client, warehouse_headers, po_id, quantity="0.001", product_id=p["id"], key=key).status_code == 409
    db_session.expire_all()
    events = db_session.query(PurchaseOrderReceipt).filter_by(po_id=po_id).all()
    assert len(events) == 3 and all(e.received_by_user_id == warehouse_user.id for e in events)
    movements = db_session.query(InventoryMovement).filter_by(reference_type="PURCHASE_ORDER", reference_id=po_id).order_by(InventoryMovement.id).all()
    assert [(m.balance_before, m.quantity, m.balance_after) for m in movements] == [(Decimal(5), Decimal(3), Decimal(8)), (Decimal(8), Decimal(2), Decimal(10)), (Decimal(10), Decimal(5), Decimal(15))]
    assert all(m.purchase_receipt_id and m.purchase_order_item_id and m.stock_transaction_id for m in movements)
    assert db_session.query(AuditLog).filter_by(action="RECEIVE_PURCHASE_ORDER", record_id=po_id).count() == 3
    assert db_session.query(ProductBatch).filter_by(product_id=p["id"]).count() == 0
    assert_aggregates(db_session, p["id"])


@pytest.mark.parametrize("state,received,allowed", [("DRAFT",0,True),("CONFIRMED",0,True),("CONFIRMED",1,False),("PARTIALLY_RECEIVED",1,False),("RECEIVED",10,False),("CANCELLED",0,False),("UNKNOWN",0,False)])
def test_cancellation_states(client, admin_headers, db_session, receipt_order, state, received, allowed):
    _, po_id = receipt_order
    db_session.get(PurchaseOrder, po_id).status = state
    db_session.query(PurchaseOrderItem).filter_by(po_id=po_id).one().received_quantity = Decimal(received)
    db_session.commit()
    response = client.post(f"/api/v1/purchase-orders/{po_id}/cancel", headers=admin_headers)
    assert response.status_code == (200 if allowed else 409)
    if allowed:
        assert client.post(f"/api/v1/purchase-orders/{po_id}/cancel", headers=admin_headers).status_code == 409


@pytest.mark.parametrize("quantity", ["0", "-1", "NaN", "Infinity", "-Infinity", "0.0001", "1000000000000000"])
def test_receipt_precision_rejected(client, admin_headers, receipt_order, quantity):
    p, po_id = receipt_order
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    assert receive(client, admin_headers, po_id, quantity=quantity, product_id=p["id"]).status_code == 422


@pytest.mark.parametrize("quantity", ["0.001", "1.125"])
def test_fractional_receipt(client, admin_headers, receipt_order, quantity):
    p, po_id = receipt_order
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    assert receive(client, admin_headers, po_id, quantity=quantity, product_id=p["id"]).status_code == 200


def test_missing_key_metadata_and_overreceipt(client, admin_headers, db_session, receipt_order):
    p, po_id = receipt_order
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    payload = {"items": [{"product_id": p["id"], "quantity": "1"}]}
    assert client.post(f"/api/v1/purchase-orders/{po_id}/receive", headers=admin_headers, json=payload).status_code == 422
    assert receive(client, admin_headers, po_id, quantity="11", product_id=p["id"]).status_code == 409
    for field, value in (("lot_no", "LOT"), ("mfg_date", date.today().isoformat()), ("expiry_date", date.today().isoformat())):
        assert receive(client, admin_headers, po_id, payload={"items": [{**payload["items"][0], field: value}]}).status_code == 422
    assert db_session.query(PurchaseOrderReceipt).filter_by(po_id=po_id).count() == 0


@pytest.mark.parametrize("expiry", [False, True])
def test_batch_contract_and_retry(client, admin_headers, db_session, expiry):
    p = purchase._create_product(client, admin_headers)
    if not expiry:
        from app.models import Product
        db_session.get(Product,p["id"]).track_expiry = False
        db_session.commit()
    supplier = purchase._create_supplier(client, admin_headers)
    po_id = purchase._create_purchase_order(client, admin_headers, supplier["id"], p["id"])["id"]
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    assert receive(client, admin_headers, po_id, product_id=p["id"]).status_code == 422
    payload = {"items": [{"product_id": p["id"], "quantity": "1.125", "lot_no": "LOT-" + uuid4().hex}]}
    if expiry:
        assert receive(client, admin_headers, po_id, payload=payload).status_code == 422
        payload["items"][0].update(mfg_date=date.today().isoformat(), expiry_date=(date.today()+timedelta(days=1)).isoformat())
    key = uuid4().hex
    first = receive(client, admin_headers, po_id, payload=payload, key=key)
    assert first.status_code == 200, first.text
    batches = client.get("/api/v1/batches", headers=admin_headers)
    assert batches.status_code == 200
    batch = next(b for b in batches.json()["data"] if b["product_id"] == p["id"])
    assert batch["mfg_date"] == payload["items"][0].get("mfg_date")
    assert batch["expiry_date"] == payload["items"][0].get("expiry_date")
    assert receive(client, admin_headers, po_id, payload=payload, key=key).json() == first.json()
    assert receive(client, admin_headers, po_id, payload=payload).status_code == 409
    payload["items"][0]["expiry_date"] = (date.today()+timedelta(days=2)).isoformat()
    assert receive(client, admin_headers, po_id, payload=payload).status_code == 409


def test_multiline_rollback_retry_and_canonical_order(client, admin_headers, db_session, monkeypatch):
    from app.repositories.stock_balance_repository import StockBalanceRepository
    products = [_create_product(client, admin_headers) for _ in range(2)]
    supplier = purchase._create_supplier(client, admin_headers)
    created = client.post("/api/v1/purchase-orders", headers=admin_headers, json={"supplier_id": supplier["id"], "items": [{"product_id": p["id"], "quantity": "1.125", "unit_price": 1} for p in products]})
    po_id = created.json()["data"]["id"]
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    payload = {"items": [{"product_id": p["id"], "quantity": "1.125"} for p in products]}
    original = StockBalanceRepository.sync_aggregates
    def fail(self, product_id, actor):
        original(self, product_id, actor)
        if product_id == products[1]["id"]:
            from app.core.exceptions import AppException
            raise AppException(message="Injected rollback", status_code=409)
    key = uuid4().hex
    with monkeypatch.context() as scoped:
        scoped.setattr(StockBalanceRepository, "sync_aggregates", fail)
        assert receive(client, admin_headers, po_id, payload=payload, key=key).status_code == 409
    db_session.expire_all()
    assert db_session.query(PurchaseOrderReceipt).filter_by(po_id=po_id).count() == 0
    assert db_session.query(InventoryMovement).filter_by(reference_type="PURCHASE_ORDER", reference_id=po_id).count() == 0
    assert all(i.received_quantity == 0 for i in db_session.query(PurchaseOrderItem).filter_by(po_id=po_id))
    response = receive(client, admin_headers, po_id, payload=payload, key=key)
    assert response.status_code == 200
    payload["items"].reverse()
    assert receive(client, admin_headers, po_id, payload=payload, key=key).json() == response.json()
    for p in products:
        assert_aggregates(db_session, p["id"])


def test_storage_reservations_and_replay_after_mutable_change(client, admin_headers, db_session, receipt_order, transfer_storage):
    from app.models import Product, WarehouseLocation
    p, po_id = receipt_order
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    b = db_session.query(StockBalance).filter_by(product_id=p["id"]).one()
    b.reserved_qty = Decimal("1.125")
    db_session.commit()
    key = uuid4().hex
    response = receive(client, admin_headers, po_id, quantity="0.001", product_id=p["id"], key=key)
    assert response.status_code == 200
    db_session.expire_all()
    assert b.reserved_qty == Decimal("1.125")
    db_session.get(Product,p["id"]).is_active = False
    db_session.commit()
    assert receive(client, admin_headers, po_id, quantity="0.001", product_id=p["id"], key=key).json() == response.json()
    db_session.get(Product,p["id"]).is_active = True
    db_session.commit()
    payload = {"items": [{"product_id":p["id"],"quantity":"1"}], "warehouse_id":transfer_storage["destination_warehouse_id"], "location_id":transfer_storage["destination_location_id"]}
    assert receive(client, admin_headers, po_id, payload=payload).status_code == 200
    payload["location_id"] = transfer_storage["source_location_id"]
    assert receive(client, admin_headers, po_id, payload=payload).status_code == 404
    del payload["location_id"]
    assert receive(client, admin_headers, po_id, payload=payload).status_code == 422
