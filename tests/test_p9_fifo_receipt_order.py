"""P9: FIFO issues lots in RECEIPT order (Owner decision 2026-11-17).

The FIFO key is ``ProductBatch.created_at`` (then ``id``). That equals the
lot's receipt time because a lot can only come into existence by being
received (POST /batches or a PO receipt, each in the receiving transaction)
and a lot can never be received twice. These tests pin that contract through
the real API. See docs/fifo.md.
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.models import ProductBatch
from tests import test_purchase_order as purchase


def _batch_product(client, admin_headers) -> dict:
    tag = uuid4().hex[:10].upper()
    response = client.post("/api/v1/products", headers=admin_headers, json={
        "sku": f"P9-{tag}", "barcode": f"889{tag}", "product_name": f"P9 FIFO {tag}",
        "price": "10.00", "track_batch": True, "track_expiry": True,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _dates(expiry_days: int) -> dict:
    today = date.today()
    return {"mfg_date": (today - timedelta(days=5)).isoformat(),
            "expiry_date": (today + timedelta(days=expiry_days)).isoformat()}


def _receive_batch(client, headers, product_id, lot, quantity, expiry_days):
    response = client.post("/api/v1/batches", headers={**headers, "Idempotency-Key": uuid4().hex}, json={
        "product_id": product_id, "lot_no": lot, "quantity": quantity, **_dates(expiry_days)})
    assert response.status_code == 201, response.text
    return response.json()["data"]["batch"]


def _receive_via_po(client, admin_headers, product_id, lot, quantity, expiry_days):
    supplier = purchase._create_supplier(client, admin_headers)
    po = client.post("/api/v1/purchase-orders", headers={**admin_headers, "Idempotency-Key": uuid4().hex}, json={
        "supplier_id": supplier["id"], "items": [{"product_id": product_id, "quantity": quantity, "unit_price": 1}]})
    assert po.status_code == 201, po.text
    po_id = po.json()["data"]["id"]
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    received = client.post(f"/api/v1/purchase-orders/{po_id}/receive",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={"items": [{"product_id": product_id, "quantity": quantity, "lot_no": lot, **_dates(expiry_days)}]})
    assert received.status_code == 200, received.text
    return po_id


def _fifo_out(client, headers, product_id, quantity):
    response = client.post("/api/v1/stock/out-fifo", headers={**headers, "Idempotency-Key": uuid4().hex},
                           json={"product_id": product_id, "quantity": quantity, "remark": "P9 FIFO"})
    assert response.status_code == 200, response.text


def _lot_quantities(db_session, product_id) -> dict[str, Decimal]:
    db_session.expire_all()
    rows = db_session.query(ProductBatch).filter_by(product_id=product_id).all()
    return {b.lot_no: b.quantity for b in rows}


def test_fifo_follows_receipt_order_not_lot_number_or_expiry(client, admin_headers, db_session):
    """Received Z (expires last), then M, then A (expires first): FIFO takes Z, then M."""
    p = _batch_product(client, admin_headers)
    _receive_batch(client, admin_headers, p["id"], "LOT-Z", "4.000", expiry_days=300)
    _receive_batch(client, admin_headers, p["id"], "LOT-M", "4.000", expiry_days=200)
    _receive_batch(client, admin_headers, p["id"], "LOT-A", "4.000", expiry_days=30)

    _fifo_out(client, admin_headers, p["id"], "5.500")

    # Alphabetical or expiry order would have touched LOT-A first.
    assert _lot_quantities(db_session, p["id"]) == {
        "LOT-Z": Decimal("0.000"), "LOT-M": Decimal("2.500"), "LOT-A": Decimal("4.000"),
    }


def test_fifo_orders_po_receipts_and_direct_receipts_by_when_they_were_received(client, admin_headers, db_session):
    p = _batch_product(client, admin_headers)
    _receive_via_po(client, admin_headers, p["id"], "LOT-PO-FIRST", "3.000", expiry_days=400)
    _receive_batch(client, admin_headers, p["id"], "LOT-DIRECT-SECOND", "3.000", expiry_days=20)
    _receive_via_po(client, admin_headers, p["id"], "LOT-PO-THIRD", "3.000", expiry_days=10)

    _fifo_out(client, admin_headers, p["id"], "4.000")

    assert _lot_quantities(db_session, p["id"]) == {
        "LOT-PO-FIRST": Decimal("0.000"), "LOT-DIRECT-SECOND": Decimal("2.000"), "LOT-PO-THIRD": Decimal("3.000"),
    }


def test_a_lot_is_received_exactly_once_so_its_created_at_is_its_receipt_time(client, admin_headers, db_session):
    """The guarantee the FIFO key relies on: neither path can re-receive a lot."""
    p = _batch_product(client, admin_headers)
    first = _receive_batch(client, admin_headers, p["id"], "LOT-ONCE", "2.000", expiry_days=90)

    again = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": uuid4().hex}, json={
        "product_id": p["id"], "lot_no": "LOT-ONCE", "quantity": "1.000", **_dates(90)})
    assert again.status_code == 409

    supplier = purchase._create_supplier(client, admin_headers)
    po_id = client.post("/api/v1/purchase-orders", headers={**admin_headers, "Idempotency-Key": uuid4().hex}, json={
        "supplier_id": supplier["id"], "items": [{"product_id": p["id"], "quantity": "1.000", "unit_price": 1}]}
    ).json()["data"]["id"]
    purchase._confirm_purchase_order(client, admin_headers, po_id)
    via_po = client.post(f"/api/v1/purchase-orders/{po_id}/receive",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={"items": [{"product_id": p["id"], "quantity": "1.000", "lot_no": "LOT-ONCE", **_dates(90)}]})
    assert via_po.status_code == 409

    db_session.expire_all()
    batch = db_session.get(ProductBatch, first["id"])
    assert batch.quantity == Decimal("2.000")
    assert db_session.query(ProductBatch).filter_by(product_id=p["id"]).count() == 1


def test_stock_balances_expose_the_fifo_key(client, admin_headers, db_session):
    """batch_received_at on balance rows is the server's FIFO key, so a client can show FIFO order."""
    p = _batch_product(client, admin_headers)
    late_expiry = _receive_batch(client, admin_headers, p["id"], "LOT-B-FIRST", "1.000", expiry_days=300)
    early_expiry = _receive_batch(client, admin_headers, p["id"], "LOT-A-SECOND", "1.000", expiry_days=30)

    response = client.get(f"/api/v1/stock-balances/product/{p['id']}", headers=admin_headers)
    assert response.status_code == 200, response.text
    rows = [r for r in response.json()["data"]["items"] if r["batch_id"] is not None]

    db_session.expire_all()
    for row in rows:
        stored = db_session.get(ProductBatch, row["batch_id"]).created_at
        assert row["batch_received_at"] == stored.isoformat()

    ordered = sorted(rows, key=lambda r: (r["batch_received_at"], r["batch_id"]))
    assert [r["batch_id"] for r in ordered] == [late_expiry["id"], early_expiry["id"]]
    assert [r["batch_lot_no"] for r in ordered] == ["LOT-B-FIRST", "LOT-A-SECOND"]


def test_non_batch_balance_rows_have_no_receipt_time(client, admin_headers):
    from tests.test_stock import _create_product

    p = _create_product(client, admin_headers, initial_stock=3)
    rows = client.get(f"/api/v1/stock-balances/product/{p['id']}", headers=admin_headers).json()["data"]["items"]
    assert rows and all(r["batch_id"] is None and r["batch_received_at"] is None for r in rows)
