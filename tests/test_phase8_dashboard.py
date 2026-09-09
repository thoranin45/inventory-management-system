"""Phase 8: dashboard/summary + attention/* — operational vs owned, status counts, auth."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from tests.test_sales_order import _create_customer
from tests.test_inventory_transfer import (  # noqa: F401
    transfer_storage,
    _create_draft_transfer,
    _create_product as _transfer_product,
    _dispatch,
    _stock_in,
)


def _product(client, headers, **over):
    payload = {
        "sku": f"P8D-{uuid4().hex[:8]}", "product_name": "p8 dash", "price": 1,
        "stock_qty": 0, "category_id": None,
    }
    payload.update(over)
    return client.post("/api/v1/products", headers=headers, json=payload).json()["data"]


def test_summary_inventory_owned_vs_operational_vs_expired_vs_transit(
    client, admin_headers, db_session, transfer_storage
):
    # eligible batch product + an expired batch + an in-transit dispatch
    p = client.post("/api/v1/products", headers=admin_headers, json={
        "sku": f"P8D-{uuid4().hex[:8]}", "product_name": "batchy", "price": 1,
        "stock_qty": 0, "category_id": None, "track_batch": True, "track_expiry": True,
    }).json()["data"]
    client.post("/api/v1/batches", headers=admin_headers, json={
        "product_id": p["id"], "lot_no": f"L-{uuid4().hex[:6]}",
        "mfg_date": date.today().isoformat(),
        "expiry_date": (date.today() + timedelta(days=400)).isoformat(), "quantity": "20.000",
    })
    from app.models import ProductBatch, StockBalance, Product, Warehouse
    wh = db_session.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    loc = db_session.execute(
        __import__("sqlalchemy").text(
            "SELECT id FROM warehouse_locations WHERE warehouse_id=:w AND location_code='DEFAULT'"
        ), {"w": wh.id}
    ).scalar()
    expired = ProductBatch(product_id=p["id"], lot_no=f"EXP-{uuid4().hex[:6]}", mfg_date=None,
                           expiry_date=date.today() - timedelta(days=2), quantity=Decimal("5.000"))
    db_session.add(expired); db_session.flush()
    db_session.add(StockBalance(product_id=p["id"], warehouse_id=wh.id, location_id=loc,
                                batch_id=expired.id, on_hand_qty=Decimal("5.000"), reserved_qty=Decimal("0")))
    prod = db_session.get(Product, p["id"])
    prod.stock_qty = prod.stock_qty + Decimal("5.000")
    db_session.commit()

    # dispatch 6 of the eligible 20 into transit
    transfer = client.post("/api/v1/inventory-transfers", headers=admin_headers, json={
        "source_warehouse_id": transfer_storage["source_warehouse_id"],
        "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
        "items": [{"product_id": p["id"], "batch_id": db_session.query(ProductBatch.id).filter_by(
            product_id=p["id"]).order_by(ProductBatch.id.asc()).first()[0],
            "from_location_id": transfer_storage["source_location_id"],
            "to_location_id": transfer_storage["destination_location_id"], "quantity": "6.000"}],
    }).json()
    _dispatch(client, admin_headers, transfer["id"])

    inv = client.get("/api/v1/dashboard/summary", headers=admin_headers).json()["data"]["inventory"]
    # owned includes expired + transit; operational excludes both
    assert Decimal(inv["expired_quantity"]) >= Decimal("5.000")
    assert Decimal(inv["in_transit_quantity"]) >= Decimal("6.000")
    assert Decimal(inv["operational_available_quantity"]) >= Decimal("14.000")
    assert Decimal(inv["owned_quantity"]) >= (
        Decimal(inv["operational_available_quantity"])
        + Decimal(inv["expired_quantity"])
        + Decimal(inv["in_transit_quantity"])
        - Decimal(inv["reserved_quantity"])
    )


def test_summary_status_counts_and_generated_at(client, admin_headers):
    customer = _create_customer(client, admin_headers)
    prod = _product(client, admin_headers)
    client.post("/api/v1/sales-orders/", headers=admin_headers, json={
        "customer_id": customer["id"],
        "items": [{"product_id": prod["id"], "quantity": "1.000", "unit_price": "1.00"}],
    })
    data = client.get("/api/v1/dashboard/summary", headers=admin_headers).json()["data"]
    assert data["sales"]["DRAFT"] >= 1
    assert "shipped_today" in data["sales"]
    assert "received_today" in data["purchase_orders"]
    assert "completed_today" in data["transfers"]
    assert data["generated_at"]
    assert data["as_of_date"]


def test_attention_summary_keys_and_low_stock_uses_operational(client, admin_headers, db_session):
    from app.models import Product

    prod = _product(client, admin_headers)
    db_session.get(Product, prod["id"]).minimum_stock = Decimal("5.000")
    db_session.commit()
    client.post("/api/v1/stock/in", headers=admin_headers,
                json={"product_id": prod["id"], "quantity": "2.000", "remark": "p8"})
    body = client.get("/api/v1/attention/summary", headers=admin_headers).json()["data"]
    for key in ("low_operational_stock", "expired_inventory_products", "near_expiry_products",
                "sales_blocked_by_expiry", "sales_awaiting_picking", "sales_awaiting_packing",
                "sales_ready_to_ship", "po_partially_received", "transfers_in_transit",
                "transfers_partially_received"):
        assert key in body
    q = client.get("/api/v1/attention/queues?type=low_stock&page_size=100", headers=admin_headers).json()["data"]
    assert prod["id"] in [r["id"] for r in q["items"]]


def test_attention_queue_bad_type_422(client, admin_headers):
    assert client.get("/api/v1/attention/queues?type=bogus", headers=admin_headers).status_code == 422


def test_dashboard_summary_and_attention_require_auth(client):
    assert client.get("/api/v1/dashboard/summary").status_code == 401
    assert client.get("/api/v1/attention/summary").status_code == 401


def test_dashboard_summary_allows_warehouse(client, warehouse_headers):
    assert client.get("/api/v1/dashboard/summary", headers=warehouse_headers).status_code == 200
    assert client.get("/api/v1/attention/summary", headers=warehouse_headers).status_code == 200


def test_legacy_dashboard_unchanged(client, admin_headers):
    body = client.get("/api/v1/dashboard", headers=admin_headers).json()
    assert body["success"] is True
    assert set(body["data"]) >= {
        "total_products", "total_stock", "total_stock_in", "total_stock_out", "low_stock_products"
    }
