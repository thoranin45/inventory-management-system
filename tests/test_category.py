from uuid import uuid4

from fastapi.testclient import TestClient


def _category_payload() -> dict[str, str]:
    unique_value = uuid4().hex[:10].upper()

    return {
        "category_name": f"Pytest Category {unique_value}",
    }


def _create_category(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    payload = _category_payload()

    response = client.post(
        "/api/v1/categories/",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["category_name"] == (
        payload["category_name"]
    )

    return body["data"]


def test_create_category_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _category_payload()

    response = client.post(
        "/api/v1/categories/",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Category created successfully"
    assert body["data"]["id"] > 0
    assert body["data"]["category_name"] == (
        payload["category_name"]
    )


def test_create_duplicate_category(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _category_payload()

    first_response = client.post(
        "/api/v1/categories/",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code in {200, 201}

    duplicate_response = client.post(
        "/api/v1/categories/",
        headers=admin_headers,
        json=payload,
    )

    assert duplicate_response.status_code == 409

    body = duplicate_response.json()

    assert body["success"] is False
    assert body["message"] == "Category already exists"


def test_get_categories(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_category = _create_category(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.get(
        "/api/v1/categories/",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Categories retrieved successfully"
    body["data"] = body["data"]["items"]
    category_ids = [
        category["id"]
        for category in body["data"]
    ]

    assert created_category["id"] in category_ids


def test_get_category_by_id(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_category = _create_category(
        client=client,
        admin_headers=admin_headers,
    )

    category_id = created_category["id"]

    response = client.get(
        f"/api/v1/categories/{category_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Category retrieved successfully"
    assert body["data"]["id"] == category_id
    assert body["data"]["category_name"] == (
        created_category["category_name"]
    )


def test_update_category(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_category = _create_category(
        client=client,
        admin_headers=admin_headers,
    )

    category_id = created_category["id"]

    new_name = (
        f"Updated Category "
        f"{uuid4().hex[:10].upper()}"
    )

    response = client.put(
        f"/api/v1/categories/{category_id}",
        headers=admin_headers,
        json={
            "category_name": new_name,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Category updated successfully"
    assert body["data"]["id"] == category_id
    assert body["data"]["category_name"] == new_name


def test_delete_category(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_category = _create_category(
        client=client,
        admin_headers=admin_headers,
    )

    category_id = created_category["id"]

    response = client.delete(
        f"/api/v1/categories/{category_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Category deleted successfully"

    get_response = client.get(
        f"/api/v1/categories/{category_id}",
        headers=admin_headers,
    )

    assert get_response.status_code == 404


def test_delete_category_in_use(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_category = _create_category(
        client=client,
        admin_headers=admin_headers,
    )

    category_id = created_category["id"]
    unique_value = uuid4().hex[:10].upper()

    product_response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json={
            "sku": f"CAT-USE-{unique_value}",
            "barcode": f"889{unique_value}",
            "product_name": "Category In Use Product",
            "price": 100,
            "stock_qty": 0,
            "category_id": category_id,
        },
    )

    assert product_response.status_code in {200, 201}

    response = client.delete(
        f"/api/v1/categories/{category_id}",
        headers=admin_headers,
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Cannot delete category with active products"
    )


def test_get_missing_category(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/v1/categories/999999999",
        headers=admin_headers,
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Category not found"


def test_create_category_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/categories/",
        json=_category_payload(),
    )

    assert response.status_code == 401