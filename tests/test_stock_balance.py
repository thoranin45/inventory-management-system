from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Warehouse, WarehouseLocation


def _decimal(value) -> Decimal:
    return Decimal(str(value))


@pytest.fixture
def main_storage(
    db_session: Session,
) -> tuple[int, int]:

    warehouse = (
        db_session.query(Warehouse)
        .filter(
            Warehouse.warehouse_code == "MAIN"
        )
        .first()
    )

    if warehouse is None:
        warehouse = Warehouse(
            warehouse_code="MAIN",
            warehouse_name="Main Warehouse",
            warehouse_type="MAIN",
            is_active=True,
        )

        db_session.add(warehouse)
        db_session.flush()

    location = (
        db_session.query(WarehouseLocation)
        .filter(
            WarehouseLocation.warehouse_id
            == warehouse.id,
            WarehouseLocation.location_code
            == "DEFAULT",
        )
        .first()
    )

    if location is None:
        location = WarehouseLocation(
            warehouse_id=warehouse.id,
            location_code="DEFAULT",
            location_name="Default Location",
            location_type="STORAGE",
            is_active=True,
        )

        db_session.add(location)

    db_session.commit()

    return warehouse.id, location.id


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json={
            "sku": f"BAL-{unique_value}",
            "barcode": f"881{unique_value}",
            "product_name": (
                f"Stock Balance Product {unique_value}"
            ),
            "price": 100,
            "stock_qty": 0,
            "category_id": None,
        },
    )

    assert response.status_code in {200, 201}

    return response.json()["data"]


def _create_balance(
    client: TestClient,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    *,
    on_hand_qty: str = "100.500",
    reserved_qty: str = "20.250",
) -> dict:

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "batch_id": None,
            "on_hand_qty": on_hand_qty,
            "reserved_qty": reserved_qty,
        },
    )

    assert response.status_code == 201

    return response.json()


def test_create_stock_balance_success(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    balance = _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
    )

    assert balance["product_id"] == product["id"]

    assert _decimal(
        balance["on_hand_qty"]
    ) == Decimal("100.500")

    assert _decimal(
        balance["reserved_qty"]
    ) == Decimal("20.250")

    assert _decimal(
        balance["available_qty"]
    ) == Decimal("80.250")


def test_get_stock_balances(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
    )

    response = client.get(
        "/api/v1/stock-balances"
    )

    assert response.status_code == 200

    body = response.json()

    assert isinstance(body, list)

    balance_ids = [
        item["id"]
        for item in body
    ]

    assert created["id"] in balance_ids


def test_get_product_stock_balances(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
    )

    response = client.get(
        (
            "/api/v1/stock-balances/"
            f"product/{product['id']}"
        )
    )

    assert response.status_code == 200

    body = response.json()

    assert isinstance(body, list)
    assert len(body) >= 1

    balance_ids = [
        item["id"]
        for item in body
    ]

    assert created["id"] in balance_ids


def test_duplicate_stock_balance_fails(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
    )

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "batch_id": None,
            "on_hand_qty": "50.000",
            "reserved_qty": "0.000",
        },
    )

    assert response.status_code == 409

    body = response.json()

    assert body["message"] == (
        "Stock balance already exists"
    )


def test_reserved_greater_than_on_hand_fails(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "batch_id": None,
            "on_hand_qty": "10.000",
            "reserved_qty": "11.000",
        },
    )

    assert response.status_code == 409

    assert response.json()["message"] == (
        "Reserved quantity cannot "
        "exceed on-hand quantity"
    )


def test_adjust_stock_balance_success(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    balance = _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
        on_hand_qty="100.000",
        reserved_qty="20.000",
    )

    response = client.patch(
        (
            "/api/v1/stock-balances/"
            f"{balance['id']}"
        ),
        json={
            "on_hand_qty": "120.000",
            "reserved_qty": "25.000",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert _decimal(
        body["on_hand_qty"]
    ) == Decimal("120.000")

    assert _decimal(
        body["reserved_qty"]
    ) == Decimal("25.000")

    assert _decimal(
        body["available_qty"]
    ) == Decimal("95.000")


def test_adjust_reserved_greater_than_on_hand_fails(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:

    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    balance = _create_balance(
        client,
        product["id"],
        warehouse_id,
        location_id,
        on_hand_qty="100.000",
        reserved_qty="10.000",
    )

    response = client.patch(
        (
            "/api/v1/stock-balances/"
            f"{balance['id']}"
        ),
        json={
            "on_hand_qty": "5.000",
        },
    )

    assert response.status_code == 409

    assert response.json()["message"] == (
        "Reserved quantity cannot "
        "exceed on-hand quantity"
    )


def test_adjust_missing_stock_balance(
    client: TestClient,
) -> None:

    response = client.patch(
        "/api/v1/stock-balances/999999999",
        json={
            "on_hand_qty": "10.000",
        },
    )

    assert response.status_code == 404

    assert response.json()["message"] == (
        "Stock balance not found"
    )

def test_get_stock_balances_missing_product(
    client: TestClient,
) -> None:
    response = client.get(
        "/api/v1/stock-balances/product/999999999"
    )

    assert response.status_code == 404

    body = response.json()

    assert body["message"] == "Product not found"


def test_create_stock_balance_missing_warehouse(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:
    _, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product["id"],
            "warehouse_id": 999999999,
            "location_id": location_id,
            "batch_id": None,
            "on_hand_qty": "10.000",
            "reserved_qty": "0.000",
        },
    )

    assert response.status_code == 404

    assert response.json()["message"] == (
        "Warehouse not found"
    )


def test_create_stock_balance_missing_location(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:
    warehouse_id, _ = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": 999999999,
            "batch_id": None,
            "on_hand_qty": "10.000",
            "reserved_qty": "0.000",
        },
    )

    assert response.status_code == 404

    assert response.json()["message"] == (
        "Warehouse location not found"
    )


def test_non_batch_product_rejects_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    main_storage: tuple[int, int],
) -> None:
    warehouse_id, location_id = main_storage

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/stock-balances",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "batch_id": 999999999,
            "on_hand_qty": "10.000",
            "reserved_qty": "0.000",
        },
    )

    assert response.status_code == 400

    assert response.json()["message"] == (
        "Batch is not allowed for this product"
    )