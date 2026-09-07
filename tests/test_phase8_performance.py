"""Phase 8: query-count regression — list endpoints stay bounded as rows grow (no N+1)."""
from contextlib import contextmanager
from uuid import uuid4

from sqlalchemy import event

from tests.conftest import test_engine
from tests.test_sales_order import _create_customer
from tests.test_inventory_transfer import (  # noqa: F401
    transfer_storage,
    _create_draft_transfer,
    _create_product as _tproduct,
    _stock_in,
)


@contextmanager
def count_queries():
    counter = {"n": 0}

    def _before(conn, cursor, statement, parameters, context, executemany):
        counter["n"] += 1

    event.listen(test_engine, "before_cursor_execute", _before)
    try:
        yield counter
    finally:
        event.remove(test_engine, "before_cursor_execute", _before)


def _product(client, headers):
    tag = uuid4().hex[:8].upper()
    return client.post("/api/v1/products", headers=headers, json={
        "sku": f"PERF-{tag}", "barcode": f"777{tag}", "product_name": f"Perf {tag}",
        "price": 1, "stock_qty": 0, "category_id": None,
    }).json()["data"]


def _seed_sales_orders(client, headers, n):
    customer = _create_customer(client, headers)
    for _ in range(n):
        p = _product(client, headers)
        client.post("/api/v1/sales-orders/", headers=headers, json={
            "customer_id": customer["id"],
            "items": [{"product_id": p["id"], "quantity": "1.000", "unit_price": "1.00"}],
        })


def _seed_purchase_orders(client, headers, n):
    supplier = client.post("/api/v1/suppliers", headers=headers,
                           json={"supplier_name": f"Perf {uuid4().hex[:6]}"}).json()["data"]
    for _ in range(n):
        p = _product(client, headers)
        client.post("/api/v1/purchase-orders", headers=headers, json={
            "supplier_id": supplier["id"],
            "items": [{"product_id": p["id"], "quantity": "1.000", "unit_price": 1}],
        })


def _seed_transfers(client, headers, storage, n):
    for _ in range(n):
        p = _tproduct(client, headers)
        _stock_in(client, headers, p["id"], "5.000")
        _create_draft_transfer(client, headers, p["id"], storage)


def _query_count_for(client, headers, url, seed, small, large):
    seed(small)
    with count_queries() as c1:
        assert client.get(url, headers=headers).status_code == 200
    n_small = c1["n"]
    seed(large - small)
    with count_queries() as c2:
        assert client.get(url, headers=headers).status_code == 200
    n_large = c2["n"]
    # bounded: query count must not scale with the number of rows returned
    assert n_large <= n_small + 3, (url, n_small, n_large)
    return n_small, n_large


def test_sales_list_query_count_bounded(client, admin_headers):
    _query_count_for(
        client, admin_headers, "/api/v1/sales-orders/?page_size=50",
        lambda k: _seed_sales_orders(client, admin_headers, k), 2, 12,
    )


def test_po_list_query_count_bounded(client, admin_headers):
    _query_count_for(
        client, admin_headers, "/api/v1/purchase-orders?page_size=50",
        lambda k: _seed_purchase_orders(client, admin_headers, k), 2, 12,
    )


def test_transfer_list_query_count_bounded(client, admin_headers, transfer_storage):
    _query_count_for(
        client, admin_headers, "/api/v1/inventory-transfers?page_size=50",
        lambda k: _seed_transfers(client, admin_headers, transfer_storage, k), 2, 10,
    )


def test_product_list_with_operational_fields_query_count_bounded(client, admin_headers):
    _query_count_for(
        client, admin_headers, "/api/v1/products?page_size=50",
        lambda k: [_product(client, admin_headers) for _ in range(k)], 2, 15,
    )


def test_dashboard_summary_not_one_query_per_product(client, admin_headers):
    for _ in range(10):
        _product(client, admin_headers)
    with count_queries() as c:
        assert client.get("/api/v1/dashboard/summary", headers=admin_headers).status_code == 200
    assert c["n"] < 20, c["n"]


def test_search_query_bounded(client, admin_headers):
    for _ in range(12):
        _product(client, admin_headers)
    with count_queries() as c:
        assert client.get("/api/v1/search?q=Perf", headers=admin_headers).status_code == 200
    assert c["n"] <= 12, c["n"]
