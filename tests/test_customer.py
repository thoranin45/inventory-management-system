from uuid import uuid4

from fastapi.testclient import TestClient


def _customer_payload() -> dict:
    unique_value = uuid4().hex[:10].upper()

    return {
        "customer_name": f"Pytest Customer {unique_value}",
        "phone": "0891234567",
        "email": (
            f"customer_{unique_value.lower()}"
            "@example.com"
        ),
        "address": "Bangkok, Thailand",
    }


def _create_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    payload = _customer_payload()

    response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["customer_name"] == (
        payload["customer_name"]
    )

    return body["data"]


def test_create_customer_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _customer_payload()

    response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] > 0
    assert body["data"]["customer_name"] == (
        payload["customer_name"]
    )


def test_create_duplicate_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _customer_payload()

    first_response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code in {200, 201}

    duplicate_response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json=payload,
    )

    assert duplicate_response.status_code == 409

    body = duplicate_response.json()

    assert body["success"] is False
    assert body["message"] == "Customer already exists"


def test_get_customers(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_customer = _create_customer(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.get(
        "/api/v1/customers",
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

    customer_ids = [
        customer["id"]
        for customer in items
    ]

    assert created_customer["id"] in customer_ids


def test_get_customer_by_id(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_customer = _create_customer(
        client=client,
        admin_headers=admin_headers,
    )

    customer_id = created_customer["id"]

    response = client.get(
        f"/api/v1/customers/{customer_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] == customer_id
    assert body["data"]["customer_name"] == (
        created_customer["customer_name"]
    )


def test_update_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_customer = _create_customer(
        client=client,
        admin_headers=admin_headers,
    )

    customer_id = created_customer["id"]

    update_payload = _customer_payload()
    update_payload["customer_name"] = (
        f"Updated Customer "
        f"{uuid4().hex[:10].upper()}"
    )
    update_payload["phone"] = "0811111111"
    update_payload["address"] = "Chiang Mai, Thailand"

    response = client.put(
        f"/api/v1/customers/{customer_id}",
        headers=admin_headers,
        json=update_payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["id"] == customer_id
    assert body["data"]["customer_name"] == (
        update_payload["customer_name"]
    )


def test_delete_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    created_customer = _create_customer(
        client=client,
        admin_headers=admin_headers,
    )

    customer_id = created_customer["id"]

    response = client.delete(
        f"/api/v1/customers/{customer_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True

    get_response = client.get(
        f"/api/v1/customers/{customer_id}",
        headers=admin_headers,
    )

    assert get_response.status_code == 404


def test_get_missing_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/v1/customers/999999999",
        headers=admin_headers,
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Customer not found"


def test_create_customer_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/customers",
        json=_customer_payload(),
    )

    assert response.status_code == 401


def test_create_customer_invalid_name(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    payload = _customer_payload()
    payload["customer_name"] = ""

    response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 422