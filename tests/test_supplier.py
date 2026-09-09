from uuid import uuid4

from fastapi.testclient import TestClient


def _supplier_payload() -> dict:
    unique_value = uuid4().hex[:10].upper()

    return {
        "supplier_name": f"Pytest Supplier {unique_value}",
        "contact_name": "Test Contact",
        "phone": "0812345678",
        "email": f"supplier_{unique_value.lower()}@example.com",
        "address": "Bangkok, Thailand",
    }


def _create_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    payload = _supplier_payload()

    response = client.post(
        "/api/v1/suppliers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["supplier_name"] == (
        payload["supplier_name"]
    )

    return body["data"]


def test_create_supplier_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _supplier_payload()

    response = client.post(
        "/api/v1/suppliers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] > 0
    assert body["data"]["supplier_name"] == (
        payload["supplier_name"]
    )


def test_create_duplicate_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _supplier_payload()

    first_response = client.post(
        "/api/v1/suppliers",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code in {200, 201}

    response = client.post(
        "/api/v1/suppliers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Supplier already exists"


def test_get_suppliers(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_supplier = _create_supplier(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.get(
        "/api/v1/suppliers",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True

    data = body["data"]

    if isinstance(data, dict):
        items = data.get("items", [])
    else:
        items = data

    supplier_ids = [
        supplier["id"]
        for supplier in items
    ]

    assert created_supplier["id"] in supplier_ids


def test_get_supplier_by_id(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_supplier = _create_supplier(
        client=client,
        admin_headers=admin_headers,
    )

    supplier_id = created_supplier["id"]

    response = client.get(
        f"/api/v1/suppliers/{supplier_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] == supplier_id
    assert body["data"]["supplier_name"] == (
        created_supplier["supplier_name"]
    )


def test_update_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_supplier = _create_supplier(
        client=client,
        admin_headers=admin_headers,
    )

    supplier_id = created_supplier["id"]

    payload = _supplier_payload()
    payload["supplier_name"] = (
        f"Updated Supplier "
        f"{uuid4().hex[:10].upper()}"
    )

    response = client.put(
        f"/api/v1/suppliers/{supplier_id}",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] == supplier_id
    assert body["data"]["supplier_name"] == (
        payload["supplier_name"]
    )


def test_delete_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_supplier = _create_supplier(
        client=client,
        admin_headers=admin_headers,
    )

    supplier_id = created_supplier["id"]

    response = client.delete(
        f"/api/v1/suppliers/{supplier_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    get_response = client.get(
        f"/api/v1/suppliers/{supplier_id}",
        headers=admin_headers,
    )

    assert get_response.status_code == 404


def test_get_missing_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/v1/suppliers/999999999",
        headers=admin_headers,
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Supplier not found"


def test_create_supplier_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/suppliers",
        json=_supplier_payload(),
    )

    assert response.status_code == 401