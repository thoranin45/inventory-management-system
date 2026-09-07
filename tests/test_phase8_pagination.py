"""Phase 8: standardized collection contract — envelope, pagination, sort, filters."""
import pytest

from tests.test_sales_order import _create_customer

LIST_ENDPOINTS = [
    "/api/v1/products",
    "/api/v1/customers",
    "/api/v1/suppliers",
    "/api/v1/categories",
    "/api/v1/batches",
    "/api/v1/stock-balances",
    "/api/v1/sales-orders/",
    "/api/v1/purchase-orders",
    "/api/v1/inventory-transfers",
    "/api/v1/inventory-movements",
]


@pytest.mark.parametrize("url", LIST_ENDPOINTS)
def test_list_envelope_shape(client, admin_headers, url):
    body = client.get(url, headers=admin_headers).json()
    assert body["success"] is True
    assert set(body["data"]) == {"items", "pagination"}
    pg = body["data"]["pagination"]
    assert set(pg) == {"page", "page_size", "total_items", "total_pages"}
    assert pg["page"] == 1
    # movements keep a documented 50 default; every other list defaults to 20
    assert pg["page_size"] == (50 if "inventory-movements" in url else 20)
    assert isinstance(body["data"]["items"], list)


def test_page_size_default_and_hard_max(client, admin_headers):
    assert client.get("/api/v1/products?page_size=100", headers=admin_headers).status_code == 200
    r = client.get("/api/v1/products?page_size=101", headers=admin_headers)
    assert r.status_code == 422


def test_unknown_sort_field_is_422(client, admin_headers):
    assert client.get("/api/v1/products?sort_by=totally_unknown", headers=admin_headers).status_code == 422
    assert client.get("/api/v1/sales-orders/?sort_by=nope", headers=admin_headers).status_code == 422


def test_deterministic_non_overlapping_pages(client, admin_headers):
    for _ in range(7):
        _create_customer(client, admin_headers)
    p1 = client.get("/api/v1/customers?page=1&page_size=3&sort_by=id&sort_order=asc", headers=admin_headers).json()["data"]
    p2 = client.get("/api/v1/customers?page=2&page_size=3&sort_by=id&sort_order=asc", headers=admin_headers).json()["data"]
    ids1 = [r["id"] for r in p1["items"]]
    ids2 = [r["id"] for r in p2["items"]]
    assert ids1 == sorted(ids1)
    assert set(ids1).isdisjoint(ids2)
    assert p1["pagination"]["total_items"] == p2["pagination"]["total_items"] >= 7


def test_sort_order_asc_desc(client, admin_headers):
    for _ in range(3):
        _create_customer(client, admin_headers)
    asc = client.get("/api/v1/customers?sort_by=id&sort_order=asc&page_size=50", headers=admin_headers).json()["data"]["items"]
    desc = client.get("/api/v1/customers?sort_by=id&sort_order=desc&page_size=50", headers=admin_headers).json()["data"]["items"]
    assert [r["id"] for r in asc] == list(reversed([r["id"] for r in desc]))


def test_status_filter_sales_orders(client, admin_headers):
    customer = _create_customer(client, admin_headers)
    product = client.post("/api/v1/products", headers=admin_headers, json={
        "sku": f"P8F-{customer['id']}", "product_name": "p8 filter", "price": 1,
        "stock_qty": 0, "category_id": None,
    }).json()["data"]
    client.post("/api/v1/sales-orders/", headers=admin_headers, json={
        "customer_id": customer["id"],
        "items": [{"product_id": product["id"], "quantity": "1.000", "unit_price": "1.00"}],
    })
    body = client.get("/api/v1/sales-orders/?status=DRAFT&page_size=100", headers=admin_headers).json()["data"]
    assert body["items"]
    assert all(r["status"] == "DRAFT" for r in body["items"])


def test_quantity_fields_are_fixed_scale_strings(client, admin_headers):
    """Phase 8 contract: quantities are scale-3 strings, money scale-2 strings."""
    product = client.post("/api/v1/products", headers=admin_headers, json={
        "sku": f"P8Q-{__import__('uuid').uuid4().hex[:8]}", "product_name": "p8 qty", "price": 1,
        "stock_qty": 0, "category_id": None,
    }).json()["data"]
    client.post("/api/v1/stock/in", headers=admin_headers,
                json={"product_id": product["id"], "quantity": "12.500", "remark": "p8"})
    row = next(
        r for r in client.get("/api/v1/products?page_size=100", headers=admin_headers).json()["data"]["items"]
        if r["id"] == product["id"]
    )
    assert row["stock_qty"] == "12.500"
    assert row["owned_quantity"] == "12.500"
    assert row["operational_available_quantity"] == "12.500"
