"""Phase 8: reports — operational categories, bounded history, Decimal fidelity, business date."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4


def _product(client, headers, **over):
    tag = uuid4().hex[:8].upper()
    payload = {
        "sku": f"RPT-{tag}", "barcode": f"778{tag}", "product_name": f"Rpt {tag}",
        "price": 1, "stock_qty": 0, "category_id": None,
    }
    payload.update(over)
    return client.post("/api/v1/products", headers=headers, json=payload).json()["data"]


def test_operational_stock_report_categories(client, admin_headers, db_session):
    from app.models import Product, ProductBatch, StockBalance, Warehouse
    import sqlalchemy as sa

    p = _product(client, admin_headers, track_batch=True, track_expiry=True)
    client.post("/api/v1/batches", headers=admin_headers, json={
        "product_id": p["id"], "lot_no": f"OK-{uuid4().hex[:6]}", "mfg_date": date.today().isoformat(),
        "expiry_date": (date.today() + timedelta(days=400)).isoformat(), "quantity": "10.000",
    })
    wh = db_session.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    loc = db_session.execute(sa.text(
        "SELECT id FROM warehouse_locations WHERE warehouse_id=:w AND location_code='DEFAULT'"
    ), {"w": wh.id}).scalar()
    exp = ProductBatch(product_id=p["id"], lot_no=f"X-{uuid4().hex[:6]}", mfg_date=None,
                       expiry_date=date.today() - timedelta(days=1), quantity=Decimal("4.000"))
    db_session.add(exp); db_session.flush()
    db_session.add(StockBalance(product_id=p["id"], warehouse_id=wh.id, location_id=loc,
                                batch_id=exp.id, on_hand_qty=Decimal("4.000"), reserved_qty=Decimal("0")))
    prod = db_session.get(Product, p["id"]); prod.stock_qty = prod.stock_qty + Decimal("4.000")
    db_session.commit()

    rows = client.get("/api/v1/reports/operational-stock?page_size=100", headers=admin_headers).json()["data"]["items"]
    row = next(r for r in rows if r["id"] == p["id"])
    assert row["owned_quantity"] == "14.000"
    assert row["operational_available_quantity"] == "10.000"
    assert row["expired_quantity"] == "4.000"


def test_stock_movement_report_is_bounded_and_paginated(client, admin_headers):
    p = _product(client, admin_headers)
    for _ in range(5):
        client.post("/api/v1/stock/in", headers=admin_headers,
                    json={"product_id": p["id"], "quantity": "1.000", "remark": "rpt"})
    body = client.get("/api/v1/reports/stock-movement?page=1&page_size=2", headers=admin_headers).json()
    assert body["success"] is True
    assert len(body["data"]["items"]) == 2
    assert body["data"]["pagination"]["page_size"] == 2
    # quantity is a scale-3 string (Decimal fidelity preserved)
    assert body["data"]["items"][0]["quantity"] == "1.000"


def test_expired_and_near_expiry_reports(client, admin_headers):
    p = _product(client, admin_headers, track_batch=True, track_expiry=True)
    near = client.post("/api/v1/batches", headers=admin_headers, json={
        "product_id": p["id"], "lot_no": f"N-{uuid4().hex[:6]}", "mfg_date": date.today().isoformat(),
        "expiry_date": (date.today() + timedelta(days=10)).isoformat(), "quantity": "2.000",
    }).json()["data"]["batch"]
    near_ids = [b["batch_id"] for b in
                client.get("/api/v1/reports/near-expiry-stock", headers=admin_headers).json()["items"]]
    assert near["id"] in near_ids


def test_work_queue_reports_reuse_summary_shape(client, admin_headers):
    for url in ("/api/v1/reports/sales", "/api/v1/reports/purchase-orders", "/api/v1/reports/transfers"):
        body = client.get(url, headers=admin_headers).json()
        assert body["success"] is True
        assert set(body["data"]) == {"items", "pagination"}


def test_charts_are_bounded(client, admin_headers):
    for _ in range(6):
        _product(client, admin_headers)
    rows = client.get("/api/v1/reports/chart/stock?limit=3", headers=admin_headers).json()
    assert len(rows) <= 3


def test_legacy_reports_unchanged(client, admin_headers):
    assert client.get("/api/v1/reports/stock-balance", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/reports/low-stock", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/reports/expiring?days=90", headers=admin_headers).status_code == 200


def test_reports_require_auth(client):
    assert client.get("/api/v1/reports/operational-stock").status_code == 401
