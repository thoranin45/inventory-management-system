from uuid import uuid4

from fastapi.testclient import TestClient


def _product_payload() -> dict:
    unique_value = uuid4().hex[:10].upper()

    return {
        "sku": f"TEST-{unique_value}",
        "barcode": f"885{unique_value}",
        "product_name": "Pytest Product",
        "price": 199.50,
        "stock_qty": 10,
        "category_id": None,
    }


def test_create_product_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["sku"] == payload["sku"]
    assert body["data"]["barcode"] == payload["barcode"]
    assert body["data"]["product_name"] == (
        payload["product_name"]
    )
    assert body["data"]["stock_qty"] == 10
    assert body["data"]["is_active"] is True


def test_create_product_duplicate_sku(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    first_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code in {200, 201}

    duplicate_payload = payload.copy()
    duplicate_payload["barcode"] = (
        f"886{uuid4().hex[:10].upper()}"
    )

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=duplicate_payload,
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "SKU already exists"


def test_create_product_duplicate_barcode(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    first_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code in {200, 201}

    duplicate_payload = payload.copy()
    duplicate_payload["sku"] = (
        f"OTHER-{uuid4().hex[:10].upper()}"
    )

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=duplicate_payload,
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Barcode already exists"


def test_get_products(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    create_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert create_response.status_code in {200, 201}

    response = client.get(
        "/api/v1/products?page=1&size=100",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert "items" in body["data"]
    assert "pagination" in body["data"]

    assert isinstance(
        body["data"]["items"],
        list,
    )

    assert len(
        body["data"]["items"]
    ) <= 100

    pagination = body["data"]["pagination"]

    assert isinstance(pagination, dict)
    assert pagination["page"] == 1
    assert pagination["page_size"] == 100
    assert pagination["total_items"] >= 1
    assert pagination["total_pages"] >= 1

def test_get_product_by_id(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    create_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert create_response.status_code in {200, 201}

    product_id = create_response.json()["data"]["id"]

    response = client.get(
        f"/api/v1/products/{product_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] == product_id
    assert body["data"]["sku"] == payload["sku"]


def test_update_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    create_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert create_response.status_code in {200, 201}

    product_id = create_response.json()["data"]["id"]

    update_payload = payload.copy()
    update_payload["product_name"] = (
        "Pytest Product Updated"
    )
    update_payload["price"] = 299.75
    update_payload["stock_qty"] = 25

    response = client.put(
        f"/api/v1/products/{product_id}",
        headers=admin_headers,
        json=update_payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["product_name"] == (
        "Pytest Product Updated"
    )
    assert float(body["data"]["price"]) == 299.75
    assert body["data"]["stock_qty"] == 25


def test_soft_delete_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _product_payload()

    create_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=payload,
    )

    assert create_response.status_code in {200, 201}

    product_id = create_response.json()["data"]["id"]

    response = client.delete(
        f"/api/v1/products/{product_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["is_active"] is False


def test_get_missing_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/v1/products/999999999",
        headers=admin_headers,
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Product not found"


def test_create_product_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/products",
        json=_product_payload(),
    )

    assert response.status_code == 401