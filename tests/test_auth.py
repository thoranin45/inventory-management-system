from fastapi.testclient import TestClient

from app.models import User


def test_login_success(
    client: TestClient,
    admin_user: User,
) -> None:
    response = client.post(
        "/api/v1/auth/token",
        data={
            "username": admin_user.username,
            "password": "AdminTest123!",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert "access_token" in body
    assert body["access_token"]
    assert body["token_type"] == "bearer"


def test_login_wrong_password(
    client: TestClient,
    admin_user: User,
) -> None:
    response = client.post(
        "/api/v1/auth/token",
        data={
            "username": admin_user.username,
            "password": "WrongPassword123!",
        },
    )

    assert response.status_code == 401

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Invalid username or password"
    )


def test_login_unknown_user(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/auth/token",
        data={
            "username": "user_not_found",
            "password": "Password123!",
        },
    )

    assert response.status_code == 401

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Invalid username or password"
    )


def test_protected_endpoint_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/products",
        json={
            "sku": "AUTH-NO-TOKEN-001",
            "barcode": "AUTH000000001",
            "product_name": (
                "Unauthorized Test Product"
            ),
            "price": 100,
            "stock_qty": 0,
            "category_id": None,
        },
    )

    assert response.status_code == 401


def test_protected_endpoint_with_admin_token(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json={
            "sku": "AUTH-ADMIN-001",
            "barcode": "AUTH000000002",
            "product_name": (
                "Admin Authorized Product"
            ),
            "price": 100,
            "stock_qty": 0,
            "category_id": None,
        },
    )

    assert response.status_code in {
        200,
        201,
    }

    body = response.json()

    assert body["success"] is True