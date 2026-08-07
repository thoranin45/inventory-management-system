from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    Product,
    StockBalance,
    Warehouse,
    WarehouseLocation,
    InventoryMovement,
)


def _decimal(value) -> Decimal:
    return Decimal(str(value))


@pytest.fixture
def transfer_storage(
    db_session: Session,
) -> dict[str, int]:
    source_warehouse = (
        db_session.query(Warehouse)
        .filter(
            Warehouse.warehouse_code == "MAIN"
        )
        .first()
    )

    assert source_warehouse is not None

    source_location = (
        db_session.query(WarehouseLocation)
        .filter(
            WarehouseLocation.warehouse_id
            == source_warehouse.id,
            WarehouseLocation.location_code
            == "DEFAULT",
        )
        .first()
    )

    assert source_location is not None

    destination_warehouse = (
        db_session.query(Warehouse)
        .filter(
            Warehouse.warehouse_code == "SHOP"
        )
        .first()
    )

    if destination_warehouse is None:
        destination_warehouse = Warehouse(
            warehouse_code="SHOP",
            warehouse_name="Shop Warehouse",
            warehouse_type="SHOP",
            is_active=True,
        )

        db_session.add(destination_warehouse)
        db_session.flush()

    destination_location = (
        db_session.query(WarehouseLocation)
        .filter(
            WarehouseLocation.warehouse_id
            == destination_warehouse.id,
            WarehouseLocation.location_code
            == "DEFAULT",
        )
        .first()
    )

    if destination_location is None:
        destination_location = WarehouseLocation(
            warehouse_id=destination_warehouse.id,
            location_code="DEFAULT",
            location_name="Default Location",
            location_type="STORAGE",
            is_active=True,
        )

        db_session.add(destination_location)

    db_session.commit()

    return {
        "source_warehouse_id": source_warehouse.id,
        "source_location_id": source_location.id,
        "destination_warehouse_id": (
            destination_warehouse.id
        ),
        "destination_location_id": (
            destination_location.id
        ),
    }


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json={
            "sku": f"TR-{unique_value}",
            "barcode": f"889{unique_value}",
            "product_name": (
                f"Transfer Product {unique_value}"
            ),
            "price": 100,
            "stock_qty": 0,
            "category_id": None,
        },
    )

    assert response.status_code in {200, 201}

    return response.json()["data"]


def _create_draft_transfer(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    storage: dict[str, int],
    *,
    quantity: str = "10.000",
) -> dict:
    response = client.post(
        "/api/v1/inventory-transfers",
        headers=admin_headers,
        json={
            "source_warehouse_id": (
                storage["source_warehouse_id"]
            ),
            "destination_warehouse_id": (
                storage[
                    "destination_warehouse_id"
                ]
            ),
            "remark": "Pytest transfer",
            "items": [
                {
                    "product_id": product_id,
                    "batch_id": None,
                    "from_location_id": (
                        storage["source_location_id"]
                    ),
                    "to_location_id": (
                        storage[
                            "destination_location_id"
                        ]
                    ),
                    "quantity": quantity,
                }
            ],
        },
    )

    assert response.status_code == 201

    return response.json()


def _stock_in(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    quantity: str,
) -> None:
    response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product_id,
            "quantity": quantity,
            "remark": "Prepare transfer stock",
        },
    )

    assert response.status_code == 200


# ---------------------------------------------------------
# DRAFT TRANSFER
# ---------------------------------------------------------


def test_create_inventory_transfer_success(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="10.500",
    )

    assert transfer["status"] == "DRAFT"

    assert transfer["transfer_number"].startswith(
        "TR-"
    )

    assert (
        transfer["source_warehouse_id"]
        == transfer_storage[
            "source_warehouse_id"
        ]
    )

    assert (
        transfer["destination_warehouse_id"]
        == transfer_storage[
            "destination_warehouse_id"
        ]
    )

    assert len(transfer["items"]) == 1

    item = transfer["items"][0]

    assert item["product_id"] == product["id"]

    assert _decimal(
        item["quantity"]
    ) == Decimal("10.500")


def test_get_inventory_transfer(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
    )

    response = client.get(
        (
            "/api/v1/inventory-transfers/"
            f"{created['id']}"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["id"] == created["id"]

    assert (
        body["transfer_number"]
        == created["transfer_number"]
    )

    assert body["status"] == "DRAFT"


def test_get_inventory_transfers(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
    )

    response = client.get(
        "/api/v1/inventory-transfers",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert isinstance(body, list)

    transfer_ids = [
        transfer["id"]
        for transfer in body
    ]

    assert created["id"] in transfer_ids


def test_get_missing_inventory_transfer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/v1/inventory-transfers/999999999",
        headers=admin_headers,
    )

    assert response.status_code == 404

    assert response.json()["message"] == (
        "Inventory transfer not found"
    )


def test_create_transfer_missing_warehouse(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/inventory-transfers",
        headers=admin_headers,
        json={
            "source_warehouse_id": 999999999,
            "destination_warehouse_id": (
                transfer_storage[
                    "destination_warehouse_id"
                ]
            ),
            "items": [
                {
                    "product_id": product["id"],
                    "batch_id": None,
                    "from_location_id": (
                        transfer_storage[
                            "source_location_id"
                        ]
                    ),
                    "to_location_id": (
                        transfer_storage[
                            "destination_location_id"
                        ]
                    ),
                    "quantity": "10.000",
                }
            ],
        },
    )

    assert response.status_code == 404

    assert response.json()["message"] == (
        "Warehouse not found"
    )


def test_create_transfer_wrong_location(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/inventory-transfers",
        headers=admin_headers,
        json={
            "source_warehouse_id": (
                transfer_storage[
                    "source_warehouse_id"
                ]
            ),
            "destination_warehouse_id": (
                transfer_storage[
                    "destination_warehouse_id"
                ]
            ),
            "items": [
                {
                    "product_id": product["id"],
                    "batch_id": None,

                    # ตั้งใจใช้ location ของ SHOP
                    # เป็น source เพื่อทดสอบ validation
                    "from_location_id": (
                        transfer_storage[
                            "destination_location_id"
                        ]
                    ),

                    "to_location_id": (
                        transfer_storage[
                            "destination_location_id"
                        ]
                    ),

                    "quantity": "10.000",
                }
            ],
        },
    )

    assert response.status_code == 400

    assert response.json()["message"] == (
        "Transfer location does not belong "
        "to the specified warehouse"
    )


def test_create_duplicate_transfer_item(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    item = {
        "product_id": product["id"],
        "batch_id": None,
        "from_location_id": (
            transfer_storage[
                "source_location_id"
            ]
        ),
        "to_location_id": (
            transfer_storage[
                "destination_location_id"
            ]
        ),
        "quantity": "10.000",
    }

    response = client.post(
        "/api/v1/inventory-transfers",
        headers=admin_headers,
        json={
            "source_warehouse_id": (
                transfer_storage[
                    "source_warehouse_id"
                ]
            ),
            "destination_warehouse_id": (
                transfer_storage[
                    "destination_warehouse_id"
                ]
            ),
            "items": [
                item,
                item.copy(),
            ],
        },
    )

    assert response.status_code == 409

    assert response.json()["message"] == (
        "Duplicate transfer item"
    )


def test_draft_transfer_does_not_move_stock(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    db_session.expire_all()

    source_before = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "source_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "source_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert source_before is not None

    assert _decimal(
        source_before.on_hand_qty
    ) == Decimal("50.000")

    _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    db_session.expire_all()

    source_after = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "source_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "source_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    destination_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "destination_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "destination_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert source_after is not None

    assert _decimal(
        source_after.on_hand_qty
    ) == Decimal("50.000")

    assert destination_balance is None


# ---------------------------------------------------------
# COMPLETE TRANSFER
# ---------------------------------------------------------


def test_complete_inventory_transfer_success(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["status"] == "COMPLETED"
    assert body["completed_by_user_id"] is not None
    assert body["completed_at"] is not None

    db_session.expire_all()

    source_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "source_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "source_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    destination_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "destination_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "destination_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert source_balance is not None
    assert destination_balance is not None

    assert _decimal(
        source_balance.on_hand_qty
    ) == Decimal("30.000")

    assert _decimal(
        destination_balance.on_hand_qty
    ) == Decimal("20.000")


def test_complete_transfer_keeps_total_product_stock(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    db_session.expire_all()

    product_row = (
        db_session.query(Product)
        .filter(
            Product.id == product["id"]
        )
        .first()
    )

    assert product_row is not None

    assert Decimal(
        str(product_row.stock_qty)
    ) == Decimal("50.000")


def test_complete_inventory_transfer_twice(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    first_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert first_response.status_code == 200

    second_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert second_response.status_code == 409

    assert second_response.json()["message"] == (
        "Inventory transfer already completed"
    )


def test_complete_transfer_insufficient_stock(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "10.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_complete_transfer_uses_available_stock(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    db_session.expire_all()

    source_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "source_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "source_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert source_balance is not None

    source_balance.reserved_qty = Decimal("40.000")
    db_session.commit()

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 409

def test_cancel_inventory_transfer_success(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["status"] == "CANCELLED"

def test_cancel_transfer_does_not_move_stock(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    db_session.expire_all()

    source_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.warehouse_id
            == transfer_storage[
                "source_warehouse_id"
            ],
            StockBalance.location_id
            == transfer_storage[
                "source_location_id"
            ],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert source_balance is not None

    assert Decimal(
        str(source_balance.on_hand_qty)
    ) == Decimal("50.000")

def test_cancel_completed_transfer_fails(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    cancel_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert cancel_response.status_code == 409

    assert cancel_response.json()["message"] == (
        "Only draft inventory transfer "
        "can be cancelled"
    )

def test_cancel_inventory_transfer_twice(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
    )

    first_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert first_response.status_code == 200

    second_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert second_response.status_code == 409

def test_complete_transfer_creates_inventory_movements(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    db_session.expire_all()

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.reference_type
            == "INVENTORY_TRANSFER",
            InventoryMovement.reference_id
            == transfer["id"],
        )
        .order_by(
            InventoryMovement.id.asc()
        )
        .all()
    )

    assert len(movements) == 2

    movement_out = movements[0]
    movement_in = movements[1]

    assert movement_out.movement_type == (
        "TRANSFER_OUT"
    )

    assert movement_in.movement_type == (
        "TRANSFER_IN"
    )

    assert movement_out.product_id == (
        product["id"]
    )

    assert movement_in.product_id == (
        product["id"]
    )

    assert Decimal(
        str(movement_out.quantity)
    ) == Decimal("-20.000")

    assert Decimal(
        str(movement_in.quantity)
    ) == Decimal("20.000")

    assert Decimal(
        str(movement_out.balance_before)
    ) == Decimal("50.000")

    assert Decimal(
        str(movement_out.balance_after)
    ) == Decimal("30.000")

    assert Decimal(
        str(movement_in.balance_before)
    ) == Decimal("0.000")

    assert Decimal(
        str(movement_in.balance_after)
    ) == Decimal("20.000")

    assert movement_out.warehouse_id == (
        transfer_storage[
            "source_warehouse_id"
        ]
    )

    assert movement_out.location_id == (
        transfer_storage[
            "source_location_id"
        ]
    )

    assert movement_in.warehouse_id == (
        transfer_storage[
            "destination_warehouse_id"
        ]
    )

    assert movement_in.location_id == (
        transfer_storage[
            "destination_location_id"
        ]
    )

    assert movement_out.reference_number == (
        transfer["transfer_number"]
    )

    assert movement_in.reference_number == (
        transfer["transfer_number"]
    )

    assert (
        movement_out.created_by_user_id
        is not None
    )

    assert (
        movement_in.created_by_user_id
        is not None
    )

def test_draft_transfer_creates_no_movements(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="10.000",
    )

    db_session.expire_all()

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.reference_type
            == "INVENTORY_TRANSFER",
            InventoryMovement.reference_id
            == transfer["id"],
        )
        .all()
    )

    assert movements == []

def test_cancelled_transfer_creates_no_movements(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
    db_session: Session,
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="10.000",
    )

    response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/cancel"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    db_session.expire_all()

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.reference_type
            == "INVENTORY_TRANSFER",
            InventoryMovement.reference_id
            == transfer["id"],
        )
        .all()
    )

    assert movements == []

def test_get_inventory_movements(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        "/api/v1/inventory-movements",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert "items" in body
    assert "pagination" in body

    assert isinstance(
        body["items"],
        list,
    )

    assert len(
        body["items"]
    ) >= 2

    pagination = body["pagination"]

    assert pagination["page"] == 1
    assert pagination["page_size"] == 50
    assert pagination["total_items"] >= 2
    assert pagination["total_pages"] >= 1

    movement_types = {
        item["movement_type"]
        for item in body["items"]
        if item["reference_id"] == transfer["id"]
    }

    assert "TRANSFER_OUT" in movement_types
    assert "TRANSFER_IN" in movement_types


def test_get_inventory_movements_by_product(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        (
            "/api/v1/inventory-movements/"
            f"product/{product['id']}"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert isinstance(body, list)
    assert len(body) >= 2

    for movement in body:
        assert (
            movement["product_id"]
            == product["id"]
        )


def test_get_inventory_movements_by_reference(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        (
            "/api/v1/inventory-movements/"
            "reference/INVENTORY_TRANSFER/"
            f"{transfer['id']}"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert len(body) == 2

    movement_types = {
        item["movement_type"]
        for item in body
    }

    assert movement_types == {
        "TRANSFER_OUT",
        "TRANSFER_IN",
    }

    for movement in body:
        assert (
            movement["reference_type"]
            == "INVENTORY_TRANSFER"
        )

        assert (
            movement["reference_id"]
            == transfer["id"]
        )

        assert (
            movement["reference_number"]
            == transfer["transfer_number"]
        )


def test_inventory_movements_without_token(
    client: TestClient,
) -> None:
    response = client.get(
        "/api/v1/inventory-movements"
    )

    assert response.status_code == 401

def test_inventory_movement_pagination(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        "/api/v1/inventory-movements?page=1&size=1",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert len(body["items"]) == 1
    assert body["pagination"]["page"] == 1
    assert body["pagination"]["page_size"] == 1
    assert body["pagination"]["total_items"] >= 2
    assert body["pagination"]["total_pages"] >= 2

def test_filter_inventory_movements_by_type(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        (
            "/api/v1/inventory-movements"
            "?movement_type=TRANSFER_OUT"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert len(body["items"]) >= 1

    for item in body["items"]:
        assert (
            item["movement_type"]
            == "TRANSFER_OUT"
        )

def test_filter_inventory_movements_by_product(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        (
            "/api/v1/inventory-movements"
            f"?product_id={product['id']}"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert len(body["items"]) >= 2

    for item in body["items"]:
        assert item["product_id"] == product["id"]

def test_filter_inventory_movements_by_warehouse(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    source_warehouse_id = (
        transfer_storage[
            "source_warehouse_id"
        ]
    )

    response = client.get(
        (
            "/api/v1/inventory-movements"
            f"?warehouse_id={source_warehouse_id}"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert len(body["items"]) >= 1

    for item in body["items"]:
        assert (
            item["warehouse_id"]
            == source_warehouse_id
        )

def test_filter_inventory_movements_by_date(
    client: TestClient,
    admin_headers: dict[str, str],
    transfer_storage: dict[str, int],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _stock_in(
        client,
        admin_headers,
        product["id"],
        "50.000",
    )

    transfer = _create_draft_transfer(
        client,
        admin_headers,
        product["id"],
        transfer_storage,
        quantity="20.000",
    )

    complete_response = client.post(
        (
            "/api/v1/inventory-transfers/"
            f"{transfer['id']}/complete"
        ),
        headers=admin_headers,
    )

    assert complete_response.status_code == 200

    response = client.get(
        (
            "/api/v1/inventory-movements"
            "?date_from=2026-01-01T00:00:00"
            "&date_to=2026-12-31T23:59:59"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert "items" in body
    assert "pagination" in body

    assert len(body["items"]) >= 2

    movement_ids = {
        item["reference_id"]
        for item in body["items"]
        if item["reference_type"]
        == "INVENTORY_TRANSFER"
    }

    assert transfer["id"] in movement_ids