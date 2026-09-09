"""Phase 8: global search + scan resolver — matches, ranking, limits, authorization."""
from datetime import date, timedelta
from uuid import uuid4

import pytest

from tests.test_sales_order import _create_customer
from tests.test_inventory_transfer import transfer_storage  # noqa: F401


def _product(client, headers, **over):
    tag = uuid4().hex[:8].upper()
    payload = {
        "sku": f"SR-{tag}", "barcode": f"999{tag}", "product_name": f"Searchable {tag}",
        "price": 1, "stock_qty": 0, "category_id": None,
    }
    payload.update(over)
    return client.post("/api/v1/products", headers=headers, json=payload).json()["data"]


def test_exact_barcode_ranked_first(client, admin_headers):
    p = _product(client, admin_headers)
    _product(client, admin_headers, product_name=f"{p['barcode']} decoy name")
    res = client.get(f"/api/v1/search?q={p['barcode']}", headers=admin_headers).json()["data"]["results"]
    assert res[0]["type"] == "product" and res[0]["id"] == p["id"]


def test_sku_lot_customer_supplier_matches(client, admin_headers):
    p = _product(client, admin_headers, track_batch=True, track_expiry=True)
    lot = f"LOT-{uuid4().hex[:8].upper()}"
    client.post("/api/v1/batches", headers=admin_headers, json={
        "product_id": p["id"], "lot_no": lot, "mfg_date": date.today().isoformat(),
        "expiry_date": (date.today() + timedelta(days=90)).isoformat(), "quantity": "1.000",
    })
    cust = _create_customer(client, admin_headers)
    supp = client.post("/api/v1/suppliers", headers=admin_headers,
                       json={"supplier_name": f"SupCo {uuid4().hex[:6]}"}).json()["data"]

    def types_for(q):
        return {r["type"] for r in client.get(f"/api/v1/search?q={q}", headers=admin_headers).json()["data"]["results"]}

    assert "product" in types_for(p["sku"])
    assert "batch" in types_for(lot)
    assert "customer" in types_for(cust["customer_name"][:8])
    assert "supplier" in types_for(supp["supplier_name"][:6])


def test_sales_po_transfer_number_matches(client, admin_headers, transfer_storage):
    from tests.test_inventory_transfer import _create_draft_transfer, _create_product, _stock_in

    cust = _create_customer(client, admin_headers)
    p = _product(client, admin_headers)
    so = client.post("/api/v1/sales-orders/", headers=admin_headers, json={
        "customer_id": cust["id"],
        "items": [{"product_id": p["id"], "quantity": "1.000", "unit_price": "1.00"}],
    }).json()["data"]
    supp = client.post("/api/v1/suppliers", headers=admin_headers,
                       json={"supplier_name": f"S{uuid4().hex[:6]}"}).json()["data"]
    po = client.post("/api/v1/purchase-orders", headers=admin_headers, json={
        "supplier_id": supp["id"], "items": [{"product_id": p["id"], "quantity": "1.000", "unit_price": 1}],
    }).json()["data"]
    tp = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, tp["id"], "5.000")
    tr = _create_draft_transfer(client, admin_headers, tp["id"], transfer_storage)

    def hit(q, t):
        return any(
            r["type"] == t
            for r in client.get(f"/api/v1/search?q={q}", headers=admin_headers).json()["data"]["results"]
        )

    assert hit(so["so_number"], "sales_order")
    assert hit(po["po_number"], "purchase_order")
    assert hit(tr["transfer_number"], "transfer")


def test_limit_and_short_query_contract(client, admin_headers):
    for _ in range(5):
        _product(client, admin_headers, product_name="RepeatedName Widget")
    body = client.get("/api/v1/search?q=RepeatedName&limit=3", headers=admin_headers).json()["data"]
    assert len(body["results"]) <= 3
    # short query returns an empty, non-error result
    short = client.get("/api/v1/search?q=a", headers=admin_headers).json()["data"]
    assert short["results"] == []


def test_search_never_returns_users_or_audit(client, admin_headers):
    body = client.get("/api/v1/search?q=admin", headers=admin_headers).json()["data"]
    assert all(r["type"] in {
        "product", "sales_order", "purchase_order", "transfer", "batch", "customer", "supplier"
    } for r in body["results"])


def test_search_requires_auth(client):
    assert client.get("/api/v1/search?q=abc").status_code == 401


def test_search_allows_warehouse(client, warehouse_headers):
    assert client.get("/api/v1/search?q=abc", headers=warehouse_headers).status_code == 200


# ------------------------- scan resolver ------------------------------- #
def test_scan_resolve_returns_product_and_batches(client, admin_headers):
    p = _product(client, admin_headers, track_batch=True, track_expiry=True)
    client.post("/api/v1/batches", headers=admin_headers, json={
        "product_id": p["id"], "lot_no": f"L-{uuid4().hex[:6]}", "mfg_date": date.today().isoformat(),
        "expiry_date": (date.today() + timedelta(days=30)).isoformat(), "quantity": "3.000",
    })
    body = client.get(f"/api/v1/scan/resolve?barcode={p['barcode']}&context=pick",
                      headers=admin_headers).json()["data"]
    assert body["product"]["id"] == p["id"]
    assert body["product"]["track_batch"] is True
    assert len(body["batches"]) == 1
    assert body["batches"][0]["operational_available_quantity"] == "3.000"


def test_scan_resolve_unknown_barcode_404(client, admin_headers):
    assert client.get("/api/v1/scan/resolve?barcode=nope-zzz", headers=admin_headers).status_code == 404


def test_scan_resolve_requires_auth(client):
    assert client.get("/api/v1/scan/resolve?barcode=x").status_code == 401
