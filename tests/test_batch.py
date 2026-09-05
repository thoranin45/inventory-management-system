from decimal import Decimal
from app.models import InventoryMovement
from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    InventoryMovement,
    Product,
    ProductBatch,
    StockBalance,
    StockTransaction,
)
def _product_payload() -> dict:
    unique_value = uuid4().hex[:10].upper()

    return {
        "sku": f"BATCH-{unique_value}",
        "barcode": f"887{unique_value}",
        "product_name": f"Batch Test Product {unique_value}",
        "price": 150.00,
        "stock_qty": 0,
        "category_id": None,
    }


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=_product_payload(),
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True

    return body["data"]


def _batch_payload(
    product_id: int,
    *,
    lot_no: str | None = None,
    mfg_date: date | None = None,
    expiry_date: date | None = None,
    quantity: int = 10,
) -> dict:
    manufacturing_date = mfg_date or date.today()

    expiration_date = (
        expiry_date
        or manufacturing_date + timedelta(days=365)
    )

    return {
        "product_id": product_id,
        "lot_no": (
            lot_no
            or f"LOT-{uuid4().hex[:12].upper()}"
        ),
        "mfg_date": manufacturing_date.isoformat(),
        "expiry_date": expiration_date.isoformat(),
        "quantity": quantity,
    }


def _create_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    quantity: int = 10,
) -> dict:
    payload = _batch_payload(
        product_id=product_id,
        quantity=quantity,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True

    return body["data"]


def test_create_batch_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    payload = _batch_payload(
        product_id=product["id"],
        quantity=25,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True
    assert body["message"] == "Batch created successfully"

    batch = body["data"]["batch"]

    assert batch["product_id"] == product["id"]
    assert batch["lot_no"] == payload["lot_no"]
    assert Decimal(
        batch["quantity"]
    ) == Decimal("25.000")
    assert Decimal(
        body["data"]["current_stock"]
    ) == Decimal("25.000")


def test_create_batch_updates_product_stock(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=15,
    )

    response = client.get(
        f"/api/v1/products/{product['id']}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert Decimal(
        body["data"]["stock_qty"]
    ) == Decimal("15.000")


def test_create_duplicate_lot_number(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    lot_no = f"DUP-{uuid4().hex[:12].upper()}"

    payload = _batch_payload(
        product_id=product["id"],
        lot_no=lot_no,
    )

    first_response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert first_response.status_code == 201

    duplicate_response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert duplicate_response.status_code == 409

    body = duplicate_response.json()

    assert body["success"] is False
    assert body["message"] == "Lot number already exists"


def test_create_batch_product_not_found(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=_batch_payload(
            product_id=999999999,
        ),
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Product not found"


def test_create_batch_invalid_dates(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    manufacturing_date = date.today()

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=_batch_payload(
            product_id=product["id"],
            mfg_date=manufacturing_date,
            expiry_date=manufacturing_date,
        ),
    )

    assert response.status_code == 400

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Expiry date must be after manufacturing date"
    )


def test_create_batch_quantity_zero(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=_batch_payload(
            product_id=product["id"],
            quantity=0,
        ),
    )

    assert response.status_code == 422


def test_get_batches(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    created = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
    )

    response = warehouse_client.get(
        "/api/v1/batches"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Batches retrieved successfully"
    )
    assert isinstance(body["data"], list)

    batch_ids = [
        batch["id"]
        for batch in body["data"]
    ]

    assert created["batch"]["id"] in batch_ids


def test_get_expiring_batches(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    payload = _batch_payload(
        product_id=product["id"],
        expiry_date=date.today() + timedelta(days=30),
    )

    create_response = warehouse_client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert create_response.status_code == 201

    batch_id = (
        create_response.json()["data"]["batch"]["id"]
    )

    response = warehouse_client.get(
        "/api/v1/batches/expiring"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Expiring batches retrieved successfully"
    )
    assert isinstance(body["data"], list)

    batch_ids = [
        batch["id"]
        for batch in body["data"]
    ]

    assert batch_id in batch_ids


def test_create_batch_without_token(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.post(
        "/api/v1/batches",
        json=_batch_payload(
            product_id=product["id"],
        ),
    )

    assert response.status_code == 401

def test_create_batch_creates_inventory_movement(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    payload = _batch_payload(
        product_id=product["id"],
        quantity=25,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 201

    batch = response.json()["data"]["batch"]

    db_session.expire_all()

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.batch_id
            == batch["id"],
            InventoryMovement.movement_type
            == "BATCH_IN",
        )
        .first()
    )

    assert movement is not None

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("25.000")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("0.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("25.000")

    assert movement.reference_type == (
        "STOCK_TRANSACTION"
    )

    assert movement.reference_id is not None

def test_batch_inventory_consistency(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    payload = _batch_payload(
        product_id=product["id"],
        quantity=25,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 201

    batch = response.json()["data"]["batch"]

    db_session.expire_all()

    product_row = (
        db_session.query(Product)
        .filter(Product.id == product["id"])
        .first()
    )

    batch_row = (
        db_session.query(ProductBatch)
        .filter(ProductBatch.id == batch["id"])
        .first()
    )

    balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id == product["id"],
            StockBalance.batch_id == batch["id"],
        )
        .first()
    )

    transaction = (
        db_session.query(StockTransaction)
        .filter(
            StockTransaction.product_id == product["id"],
            StockTransaction.transaction_type == "IN_BATCH",
        )
        .order_by(StockTransaction.id.desc())
        .first()
    )

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id == product["id"],
            InventoryMovement.batch_id == batch["id"],
            InventoryMovement.movement_type == "BATCH_IN",
        )
        .first()
    )

    assert product_row is not None
    assert batch_row is not None
    assert balance is not None
    assert transaction is not None
    assert movement is not None

    assert Decimal(
        str(product_row.stock_qty)
    ) == Decimal("25.000")

    assert Decimal(
        str(batch_row.quantity)
    ) == Decimal("25.000")

    assert Decimal(
        str(balance.on_hand_qty)
    ) == Decimal("25.000")

    assert Decimal(
        str(transaction.quantity)
    ) == Decimal("25.000")

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("25.000")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("0.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("25.000")

