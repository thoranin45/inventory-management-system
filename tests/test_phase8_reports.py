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


def test_stock_movement_report_is_bounded_and_paginated(client, admin_headers, db_session):
    """The report is GLOBAL (every product), ordered created_at DESC, id DESC.

    So this test never assumes the newest row in the database is its own: in a
    shared test schema, other tests may write StockTransactions whose naive
    created_at sorts later (e.g. ones written under a different session
    TimeZone, which shifts naive now() by hours). Instead it bounds the report
    to the window its own five rows were written in -- still unfiltered by
    product, so unrelated rows in that window appear too -- and checks its own
    rows, the global ordering and deterministic pagination."""
    from app.models import StockTransaction

    p = _product(client, admin_headers)
    for _ in range(5):
        response = client.post("/api/v1/stock/in", headers=admin_headers,
                               json={"product_id": p["id"], "quantity": "1.000", "remark": "rpt"})
        assert response.status_code == 200, response.text
    own = (db_session.query(StockTransaction).filter_by(product_id=p["id"])
           .order_by(StockTransaction.id).all())
    assert len(own) == 5
    window = {"date_from": min(t.created_at for t in own).isoformat(),
              "date_to": max(t.created_at for t in own).isoformat()}

    def page(number):
        body = client.get("/api/v1/reports/stock-movement", headers=admin_headers,
                          params={"page": number, "page_size": 2, **window}).json()
        assert body["success"] is True
        return body["data"]

    first = page(1)
    assert first["pagination"]["page_size"] == 2
    assert len(first["items"]) == 2  # bounded: never more than page_size
    total, pages = first["pagination"]["total_items"], first["pagination"]["total_pages"]
    assert total >= 5 and pages == -(-total // 2)

    rows = list(first["items"])
    for number in range(2, pages + 1):
        data = page(number)
        assert data["pagination"]["total_items"] == total  # stable across pages
        rows += data["items"]
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)) == total  # disjoint pages, no gaps
    # Global ordering: created_at DESC, then id DESC.
    keys = [(r["created_at"], r["id"]) for r in rows]
    assert keys == sorted(keys, reverse=True)

    mine = [r for r in rows if r["product_id"] == p["id"]]
    assert [r["id"] for r in mine] == [t.id for t in reversed(own)]
    # quantity is a scale-3 string (Decimal fidelity preserved)
    assert [r["quantity"] for r in mine] == ["1.000"] * 5


def test_stock_movement_report_stays_global_with_an_unrelated_future_dated_row(client, admin_headers,
                                                                              db_session):
    """Regression for the CI failure on PR #4: an unrelated 2.000 transaction
    whose naive created_at sorts after this test's own rows (as a writer in a
    different session TimeZone produces) is correctly ordered before them --
    the endpoint is right to do so -- and must not break checks on this
    test's rows.

    The synthetic timestamp is derived ONLY from the five rows' persisted
    created_at (max + 1 ms): never datetime.now(), the process timezone or
    the PostgreSQL session timezone, so it sorts first among them under any
    combination of the three. Ordering is asserted inside the window
    [min(own), synthetic] -- unfiltered by product -- so other tests' rows
    elsewhere in the shared schema cannot displace it."""
    from datetime import timedelta as td

    from app.models import StockTransaction

    p = _product(client, admin_headers)
    for _ in range(5):
        assert client.post("/api/v1/stock/in", headers=admin_headers, json={
            "product_id": p["id"], "quantity": "1.000", "remark": "rpt"}).status_code == 200
    own = db_session.query(StockTransaction).filter_by(product_id=p["id"]).order_by(StockTransaction.id).all()
    assert len(own) == 5
    newest_own = max(t.created_at for t in own)

    other = _product(client, admin_headers)
    future = StockTransaction(product_id=other["id"], transaction_type="IN", quantity=Decimal("2.000"),
                              remark="unrelated", created_at=newest_own + td(milliseconds=1))
    db_session.add(future)
    db_session.commit()

    window = {"date_from": min(t.created_at for t in own).isoformat(),
              "date_to": future.created_at.isoformat()}
    rows, number = [], 1
    while True:
        data = client.get("/api/v1/reports/stock-movement", headers=admin_headers,
                          params={"page": number, "page_size": 2, **window}).json()["data"]
        assert len(data["items"]) <= 2
        rows += data["items"]
        if number >= data["pagination"]["total_pages"]:
            break
        number += 1
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)) == data["pagination"]["total_items"]
    keys = [(r["created_at"], r["id"]) for r in rows]
    assert keys == sorted(keys, reverse=True)  # global created_at DESC, id DESC -- unchanged

    position = {r["id"]: i for i, r in enumerate(rows)}
    assert all(position[future.id] < position[t.id] for t in own)  # the unrelated row sorts first
    assert next(r for r in rows if r["id"] == future.id)["quantity"] == "2.000"
    assert [r["quantity"] for r in rows if r["product_id"] == p["id"]] == ["1.000"] * 5

    # The original window (own rows only) excludes it and still sees exactly five 1.000 rows.
    bounded = client.get("/api/v1/reports/stock-movement", headers=admin_headers, params={
        "page": 1, "page_size": 100, "date_from": window["date_from"],
        "date_to": newest_own.isoformat()}).json()["data"]["items"]
    assert future.id not in [r["id"] for r in bounded]
    assert [r["quantity"] for r in bounded if r["product_id"] == p["id"]] == ["1.000"] * 5


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
