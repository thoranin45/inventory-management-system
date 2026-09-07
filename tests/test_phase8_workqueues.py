"""Phase 8: Sales / PO / Transfer work-queue summary rows through their lifecycles."""
from uuid import uuid4

from tests.test_sales_order import _create_customer
from tests.test_sales_order_fulfillment import advance
from tests.test_inventory_transfer import (  # noqa: F401
    transfer_storage,
    _create_draft_transfer,
    _create_product as _tproduct,
    _dispatch,
    _receive,
    _receive_lines,
    _stock_in,
)


def _product(client, headers):
    tag = uuid4().hex[:8].upper()
    return client.post("/api/v1/products", headers=headers, json={
        "sku": f"WQ-{tag}", "barcode": f"776{tag}", "product_name": f"Wq {tag}",
        "price": 1, "stock_qty": 0, "category_id": None,
    }).json()["data"]


def _row(client, headers, url, key, value):
    for r in client.get(f"{url}?page_size=100", headers=headers).json()["data"]["items"]:
        if r[key] == value:
            return r
    raise AssertionError(f"row {value} not in {url}")


def test_sales_queue_summary_fields_and_status_progression(client, admin_headers):
    customer = _create_customer(client, admin_headers)
    product = _tproduct(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "5.000")
    order = client.post("/api/v1/sales-orders/", headers=admin_headers, json={
        "customer_id": customer["id"],
        "items": [{"product_id": product["id"], "quantity": "2.000", "unit_price": "3.00"}],
    }).json()["data"]
    oid = order["sales_order_id"]

    row = _row(client, admin_headers, "/api/v1/sales-orders/", "id", oid)
    assert row["so_number"] == order["so_number"]
    assert row["customer_name"] == customer["customer_name"]
    assert row["item_count"] == 1
    assert row["total_quantity"] == "2.000"
    assert row["total_amount"] == "6.00"
    assert row["status"] == "DRAFT"
    assert row["attention_reason"] is None
    assert row["last_activity_at"]

    advance(client, admin_headers, oid, "READY_TO_SHIP")
    row = _row(client, admin_headers, "/api/v1/sales-orders/", "id", oid)
    assert row["status"] == "READY_TO_SHIP"
    assert row["picked_pct"] == 100.0
    assert row["packed_pct"] == 100.0

    # status filter narrows the queue
    ready = client.get("/api/v1/sales-orders/?status=READY_TO_SHIP&page_size=100", headers=admin_headers).json()["data"]["items"]
    assert oid in [r["id"] for r in ready]
    assert all(r["status"] == "READY_TO_SHIP" for r in ready)


def test_po_queue_summary_fields_through_partial_receipt(client, admin_headers):
    supplier = client.post("/api/v1/suppliers", headers=admin_headers,
                           json={"supplier_name": f"Wq {uuid4().hex[:6]}"}).json()["data"]
    product = _product(client, admin_headers)
    po = client.post("/api/v1/purchase-orders", headers=admin_headers, json={
        "supplier_id": supplier["id"],
        "items": [{"product_id": product["id"], "quantity": "10.000", "unit_price": 2}],
    }).json()["data"]
    client.post(f"/api/v1/purchase-orders/{po['id']}/confirm", headers=admin_headers)
    client.post(f"/api/v1/purchase-orders/{po['id']}/receive",
                headers={**admin_headers, "Idempotency-Key": uuid4().hex},
                json={"items": [{"product_id": product["id"], "quantity": "4.000"}]})

    row = _row(client, admin_headers, "/api/v1/purchase-orders", "id", po["id"])
    assert row["supplier_name"] == supplier["supplier_name"]
    assert row["ordered_quantity"] == "10.000"
    assert row["received_quantity"] == "4.000"
    assert row["remaining_quantity"] == "6.000"
    assert row["status"] == "PARTIALLY_RECEIVED"
    assert row["receipt_count"] == 1
    assert row["last_receipt_at"]
    assert 39.0 <= row["receiving_pct"] <= 41.0


def test_transfer_queue_summary_fields_through_dispatch_and_partial_receipt(
    client, admin_headers, transfer_storage
):
    product = _tproduct(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "20.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="10.000"
    )
    _dispatch(client, admin_headers, transfer["id"])
    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "4.000"}])

    row = _row(client, admin_headers, "/api/v1/inventory-transfers", "id", transfer["id"])
    assert row["transfer_number"] == transfer["transfer_number"]
    assert row["source_warehouse_name"]
    assert row["destination_warehouse_name"]
    assert row["line_count"] == 1
    assert row["total_quantity"] == "10.000"
    assert row["dispatched_quantity"] == "10.000"
    assert row["received_quantity"] == "4.000"
    assert row["outstanding_quantity"] == "6.000"
    assert row["status"] == "PARTIALLY_RECEIVED"
    assert row["latest_receipt_at"]
    assert 39.0 <= row["progress_pct"] <= 41.0

    filtered = client.get(
        f"/api/v1/inventory-transfers?source_warehouse_id={transfer_storage['source_warehouse_id']}&page_size=100",
        headers=admin_headers,
    ).json()["data"]["items"]
    assert transfer["id"] in [r["id"] for r in filtered]
