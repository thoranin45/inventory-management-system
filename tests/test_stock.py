from decimal import Decimal
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
from app.models import (
    InventoryMovement,
    Product,
    ProductBatch,
    StockBalance,
    StockTransaction,
)

def _decimal(value) -> Decimal:
    return Decimal(str(value))

def _product_payload(
    *,
    initial_stock: int = 0,
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    return {
        "sku": f"STOCK-{unique_value}",
        "barcode": f"886{unique_value}",
        "product_name": (
            f"Stock Test Product {unique_value}"
        ),
        "price": 150.00,
        "stock_qty": initial_stock,
        "category_id": None,
    }


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
    *,
    initial_stock: int = 0,
) -> dict:
    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json=_product_payload(
            initial_stock=0,
        ),
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True

    product = body["data"]
    if initial_stock:
        stock = client.post("/api/v1/stock/in", headers=admin_headers, json={
            "product_id": product["id"], "quantity": initial_stock, "remark": "Test opening receipt",
        })
        assert stock.status_code == 200
        product = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    return product


def _batch_payload(
    product_id: int,
    *,
    quantity: int,
    expiry_days: int,
    lot_no: str | None = None,
) -> dict:
    manufacturing_date = date.today()

    return {
        "product_id": product_id,
        "lot_no": (
            lot_no
            or f"STOCK-LOT-{uuid4().hex[:12].upper()}"
        ),
        "mfg_date": manufacturing_date.isoformat(),
        "expiry_date": (
            manufacturing_date
            + timedelta(days=expiry_days)
        ).isoformat(),
        "quantity": quantity,
    }


def _create_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    *,
    quantity: int,
    expiry_days: int,
) -> dict:
    payload = _batch_payload(
        product_id=product_id,
        quantity=quantity,
        expiry_days=expiry_days,
    )

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json=payload,
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True

    return body["data"]["batch"]


def _get_product(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
) -> dict:
    response = client.get(
        f"/api/v1/products/{product_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200

    return response.json()["data"]


def _get_batches(
    client: TestClient,
) -> list[dict]:
    response = client.get(
        "/api/v1/batches"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True

    return body["data"]


def _get_batch_by_id(
    client: TestClient,
    batch_id: int,
) -> dict:
    batches = _get_batches(client)

    batch = next(
        (
            current_batch
            for current_batch in batches
            if current_batch["id"] == batch_id
        ),
        None,
    )

    assert batch is not None

    return batch


def _get_stock_history(
    client: TestClient,
) -> list[dict]:
    response = client.get(
        "/api/v1/stock/history"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Stock history retrieved successfully"
    )

    return body["data"]


def test_stock_in_success(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    response = warehouse_client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 20,
            "remark": "Pytest stock in",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Stock in completed successfully"
    )

    data = body["data"]

    assert data["product_id"] == product["id"]
    assert _decimal(data["previous_stock"]) == Decimal("0.000")
    assert _decimal(data["current_stock"]) == Decimal("20.000")
    assert _decimal(data["difference"]) == Decimal("20.000")

    updated_product = _get_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
    )

    assert _decimal(
        updated_product["stock_qty"]
    ) == Decimal("20.000")

    history = _get_stock_history(warehouse_client)

    transaction = next(
        (
            item
            for item in history
            if (
                item["product_id"] == product["id"]
                and item["transaction_type"] == "IN"
                and item["remark"] == "Pytest stock in"
            )
        ),
        None,
    )

    assert transaction is not None
    assert _decimal(
        transaction["quantity"]
    ) == Decimal("20.000")


def test_stock_in_product_not_found(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": 999999999,
            "quantity": 5,
            "remark": "Missing product test",
        },
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Product not found"


def test_stock_out_fifo_success(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    first_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=180,
    )

    second_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=365,
    )

    response = warehouse_client.post(
        "/api/v1/stock/out-fifo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 15,
            "remark": "Pytest FIFO",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "FIFO stock out completed successfully"
    )

    data = body["data"]

    assert _decimal(data["previous_stock"]) == Decimal("30.000")
    assert _decimal(data["current_stock"]) == Decimal("15.000")
    assert _decimal(data["difference"]) == Decimal("-15.000")

    first_batch_after = _get_batch_by_id(
        client=warehouse_client,
        batch_id=first_batch["id"],
    )

    second_batch_after = _get_batch_by_id(
        client=warehouse_client,
        batch_id=second_batch["id"],
    )

    assert _decimal(
        first_batch_after["quantity"]
    ) == Decimal("0.000")

    assert _decimal(
        second_batch_after["quantity"]
    ) == Decimal("15.000")

    history = _get_stock_history(warehouse_client)

    transaction = next(
        (
            item
            for item in history
            if (
                item["product_id"] == product["id"]
                and item["transaction_type"] == "OUT_FIFO"
            )
        ),
        None,
    )

    assert transaction is not None
    assert _decimal(
        transaction["quantity"]
    ) == Decimal("-15.000")


def test_stock_out_fifo_insufficient_stock(
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
        quantity=5,
        expiry_days=180,
    )

    response = client.post(
        "/api/v1/stock/out-fifo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 10,
            "remark": "Insufficient stock test",
        },
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Not enough stock"


def test_stock_out_fefo_success(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    later_expiry_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=365,
    )

    earlier_expiry_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=30,
    )

    response = warehouse_client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 15,
            "remark": "Pytest FEFO",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "FEFO stock out completed successfully"
    )

    data = body["data"]

    assert _decimal(data["previous_stock"]) == Decimal("30.000")
    assert _decimal(data["current_stock"]) == Decimal("15.000")
    assert _decimal(data["difference"]) == Decimal("-15.000")

    earlier_batch_after = _get_batch_by_id(
        client=warehouse_client,
        batch_id=earlier_expiry_batch["id"],
    )

    later_batch_after = _get_batch_by_id(
        client=warehouse_client,
        batch_id=later_expiry_batch["id"],
    )

    assert _decimal(
        earlier_batch_after["quantity"]
    ) == Decimal("0.000")

    assert _decimal(
        later_batch_after["quantity"]
    ) == Decimal("15.000")

    history = _get_stock_history(warehouse_client)

    transaction = next(
        (
            item
            for item in history
            if (
                item["product_id"] == product["id"]
                and item["transaction_type"] == "OUT_FEFO"
            )
        ),
        None,
    )

    assert transaction is not None
    assert _decimal(
        transaction["quantity"]
    ) == Decimal("-15.000")


def test_stock_out_batch_stock_not_enough(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    # Product มี stock_qty แต่ไม่มี Batch
    # จึงผ่านการตรวจ stock รวม แต่ไม่ผ่าน Batch stock
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=10,
    )

    response = client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 5,
            "remark": (
                "Insufficient batch stock test"
            ),
        },
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Not enough batch stock"
    )

    product_after = _get_product(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
    )

    # ต้องไม่ถูกหัก เพราะ operation ไม่สำเร็จ
    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("10.000")


def test_stock_adjust_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    stock_in_response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "5.000",
            "remark": "Prepare stock for adjustment",
        },
    )

    assert stock_in_response.status_code == 200

    response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": "12.000",
            "remark": "Pytest adjustment",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert Decimal(
        str(body["data"]["previous_stock"])
    ) == Decimal("5.000")

    assert Decimal(
        str(body["data"]["current_stock"])
    ) == Decimal("12.000")

    assert Decimal(
        str(body["data"]["difference"])
    ) == Decimal("7.000")


def test_stock_adjust_with_active_batch_fails(
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
        quantity=10,
        expiry_days=180,
    )

    response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": 50,
            "remark": "Blocked adjustment",
        },
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Cannot directly adjust a product "
        "that has active batch stock"
    )

    product_after = _get_product(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
    )

    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("10.000")


def test_stock_history_sorted_latest_first(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    first_response = warehouse_client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 2,
            "remark": "History first",
        },
    )

    assert first_response.status_code == 200

    second_response = warehouse_client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 3,
            "remark": "History second",
        },
    )

    assert second_response.status_code == 200

    history = _get_stock_history(warehouse_client)

    product_transactions = [
        item
        for item in history
        if item["product_id"] == product["id"]
    ]

    assert len(product_transactions) >= 2
    assert product_transactions[0]["remark"] == (
        "History second"
    )
    assert product_transactions[1]["remark"] == (
        "History first"
    )


def test_stock_operation_without_token(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.post(
        "/api/v1/stock/in",
        json={
            "product_id": product["id"],
            "quantity": 5,
            "remark": "Unauthorized test",
        },
    )

    assert response.status_code == 401


def test_stock_validation_error(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 0,
            "remark": "Invalid quantity test",
        },
    )

    assert response.status_code == 422

def test_stock_in_updates_stock_balance(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "20.500",
            "remark": "Dual-write test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"]
        )
        .first()
    )

    assert balance is not None

    assert Decimal(
        str(balance.on_hand_qty)
    ) == Decimal("20.500")

    assert Decimal(
        str(balance.reserved_qty)
    ) == Decimal("0.000")

def test_fifo_updates_batch_balances(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    first_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=180,
    )

    second_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=365,
    )

    response = client.post(
        "/api/v1/stock/out-fifo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FIFO balance test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    first_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id == product["id"],
            StockBalance.batch_id == first_batch["id"]
        )
        .first()
    )

    second_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id == product["id"],
            StockBalance.batch_id == second_batch["id"]
        )
        .first()
    )

    assert first_balance is not None
    assert second_balance is not None

    assert Decimal(
        str(first_balance.on_hand_qty)
    ) == Decimal("0.000")

    assert Decimal(
        str(second_balance.on_hand_qty)
    ) == Decimal("15.000")

def test_fefo_updates_batch_balances(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
    )

    later_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=365,
    )

    earlier_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=12,
        expiry_days=30,
    )

    response = client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FEFO balance test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    earlier_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.batch_id == earlier_batch["id"]
        )
        .first()
    )

    later_balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.batch_id == later_batch["id"]
        )
        .first()
    )

    assert earlier_balance is not None
    assert later_balance is not None

    assert Decimal(
        str(earlier_balance.on_hand_qty)
    ) == Decimal("0.000")

    assert Decimal(
        str(later_balance.on_hand_qty)
    ) == Decimal("7.000")

def test_stock_adjust_updates_balance(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    stock_in_response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "5.000",
            "remark": "Prepare adjust",
        },
    )

    assert stock_in_response.status_code == 200

    response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": "12.500",
            "remark": "Adjust balance test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id == product["id"],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    assert balance is not None

    assert Decimal(
        str(balance.on_hand_qty)
    ) == Decimal("12.500")

def test_fifo_creates_inventory_movements_per_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    first_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=180,
    )

    second_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=365,
    )

    response = client.post(
        "/api/v1/stock/out-fifo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FIFO ledger test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_OUT_FIFO",
        )
        .order_by(
            InventoryMovement.id.asc()
        )
        .all()
    )

    assert len(movements) == 2

    first = movements[0]
    second = movements[1]

    assert first.batch_id == first_batch["id"]
    assert second.batch_id == second_batch["id"]

    assert Decimal(
        str(first.quantity)
    ) == Decimal("-10.000")

    assert Decimal(
        str(second.quantity)
    ) == Decimal("-5.000")

    assert Decimal(
        str(first.balance_before)
    ) == Decimal("10.000")

    assert Decimal(
        str(first.balance_after)
    ) == Decimal("0.000")

    assert Decimal(
        str(second.balance_before)
    ) == Decimal("20.000")

    assert Decimal(
        str(second.balance_after)
    ) == Decimal("15.000")

    assert sum(
        (
            Decimal(str(item.quantity))
            for item in movements
        ),
        Decimal("0"),
    ) == Decimal("-15.000")

    assert all(
        item.reference_type
        == "STOCK_TRANSACTION"
        for item in movements
    )

    assert all(
        item.reference_id is not None
        for item in movements
    )

def test_fefo_creates_inventory_movements_per_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    later_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=365,
    )

    earlier_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=12,
        expiry_days=30,
    )

    response = client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FEFO ledger test",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_OUT_FEFO",
        )
        .order_by(
            InventoryMovement.id.asc()
        )
        .all()
    )

    assert len(movements) == 2

    first = movements[0]
    second = movements[1]

    assert first.batch_id == earlier_batch["id"]
    assert second.batch_id == later_batch["id"]

    assert Decimal(
        str(first.quantity)
    ) == Decimal("-12.000")

    assert Decimal(
        str(second.quantity)
    ) == Decimal("-3.000")

    assert Decimal(
        str(first.balance_before)
    ) == Decimal("12.000")

    assert Decimal(
        str(first.balance_after)
    ) == Decimal("0.000")

    assert Decimal(
        str(second.balance_before)
    ) == Decimal("10.000")

    assert Decimal(
        str(second.balance_after)
    ) == Decimal("7.000")

    assert sum(
        (
            Decimal(str(item.quantity))
            for item in movements
        ),
        Decimal("0"),
    ) == Decimal("-15.000")

    assert all(
        item.reference_type
        == "STOCK_TRANSACTION"
        for item in movements
    )

    assert all(
        item.reference_id is not None
        for item in movements
    )

def test_stock_adjust_creates_positive_movement(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    stock_in_response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "10.000",
            "remark": "Prepare adjust stock",
        },
    )

    assert stock_in_response.status_code == 200

    response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": "15.000",
            "remark": "Positive adjustment",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_ADJUST",
        )
        .order_by(
            InventoryMovement.id.desc()
        )
        .first()
    )

    assert movement is not None

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("5.000")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("10.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("15.000")

def test_stock_adjust_creates_negative_movement(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    stock_in_response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "Prepare adjust stock",
        },
    )

    assert stock_in_response.status_code == 200

    response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": "8.000",
            "remark": "Negative adjustment",
        },
    )

    assert response.status_code == 200

    db_session.expire_all()

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_ADJUST",
        )
        .order_by(
            InventoryMovement.id.desc()
        )
        .first()
    )

    assert movement is not None

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("-7.000")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("15.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("8.000")

def test_stock_in_inventory_consistency(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "25.500",
            "remark": "Stock consistency test",
        },
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

    balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    transaction = (
        db_session.query(StockTransaction)
        .filter(
            StockTransaction.product_id
            == product["id"],
            StockTransaction.transaction_type
            == "IN",
        )
        .order_by(
            StockTransaction.id.desc()
        )
        .first()
    )

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_IN",
        )
        .order_by(
            InventoryMovement.id.desc()
        )
        .first()
    )

    assert product_row is not None
    assert balance is not None
    assert transaction is not None
    assert movement is not None

    assert Decimal(
        str(product_row.stock_qty)
    ) == Decimal("25.500")

    assert Decimal(
        str(balance.on_hand_qty)
    ) == Decimal("25.500")

    assert Decimal(
        str(transaction.quantity)
    ) == Decimal("25.500")

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("25.500")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("0.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("25.500")

    assert movement.reference_type == (
        "STOCK_TRANSACTION"
    )

    assert movement.reference_id == (
        transaction.id
    )

def test_fifo_inventory_consistency(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    first_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=180,
    )

    second_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=365,
    )

    response = client.post(
        "/api/v1/stock/out-fifo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FIFO consistency test",
        },
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

    batches = (
        db_session.query(ProductBatch)
        .filter(
            ProductBatch.product_id
            == product["id"]
        )
        .all()
    )

    balances = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.batch_id.is_not(None),
        )
        .all()
    )

    transaction = (
        db_session.query(StockTransaction)
        .filter(
            StockTransaction.product_id
            == product["id"],
            StockTransaction.transaction_type
            == "OUT_FIFO",
        )
        .order_by(
            StockTransaction.id.desc()
        )
        .first()
    )

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_OUT_FIFO",
        )
        .all()
    )

    assert product_row is not None
    assert transaction is not None

    product_stock = Decimal(
        str(product_row.stock_qty)
    )

    batch_total = sum(
        (
            Decimal(str(batch.quantity))
            for batch in batches
        ),
        Decimal("0"),
    )

    balance_total = sum(
        (
            Decimal(str(balance.on_hand_qty))
            for balance in balances
        ),
        Decimal("0"),
    )

    movement_total = sum(
        (
            Decimal(str(movement.quantity))
            for movement in movements
        ),
        Decimal("0"),
    )

    assert product_stock == Decimal("15.000")
    assert batch_total == Decimal("15.000")
    assert balance_total == Decimal("15.000")

    assert Decimal(
        str(transaction.quantity)
    ) == Decimal("-15.000")

    assert movement_total == Decimal("-15.000")

    assert len(movements) == 2

def test_fefo_inventory_consistency(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    later_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=365,
    )

    earlier_batch = _create_batch(
        client=client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=12,
        expiry_days=30,
    )

    response = client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "15.000",
            "remark": "FEFO consistency test",
        },
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

    batches = (
        db_session.query(ProductBatch)
        .filter(
            ProductBatch.product_id
            == product["id"]
        )
        .all()
    )

    balances = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.batch_id.is_not(None),
        )
        .all()
    )

    transaction = (
        db_session.query(StockTransaction)
        .filter(
            StockTransaction.product_id
            == product["id"],
            StockTransaction.transaction_type
            == "OUT_FEFO",
        )
        .order_by(
            StockTransaction.id.desc()
        )
        .first()
    )

    movements = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_OUT_FEFO",
        )
        .order_by(
            InventoryMovement.id.asc()
        )
        .all()
    )

    assert product_row is not None
    assert transaction is not None
    assert len(movements) == 2

    product_stock = Decimal(
        str(product_row.stock_qty)
    )

    batch_total = sum(
        (
            Decimal(str(batch.quantity))
            for batch in batches
        ),
        Decimal("0"),
    )

    balance_total = sum(
        (
            Decimal(str(balance.on_hand_qty))
            for balance in balances
        ),
        Decimal("0"),
    )

    movement_total = sum(
        (
            Decimal(str(movement.quantity))
            for movement in movements
        ),
        Decimal("0"),
    )

    assert product_stock == Decimal("7.000")
    assert batch_total == Decimal("7.000")
    assert balance_total == Decimal("7.000")

    assert Decimal(
        str(transaction.quantity)
    ) == Decimal("-15.000")

    assert movement_total == Decimal("-15.000")

    earlier_batch_id = (
        earlier_batch["batch"]["id"]
        if "batch" in earlier_batch
        else earlier_batch["id"]
    )

    later_batch_id = (
        later_batch["batch"]["id"]
        if "batch" in later_batch
        else later_batch["id"]
    )

    first_movement = movements[0]
    second_movement = movements[1]

    assert first_movement.batch_id == earlier_batch_id
    assert second_movement.batch_id == later_batch_id

    assert Decimal(
        str(first_movement.quantity)
    ) == Decimal("-12.000")

    assert Decimal(
        str(second_movement.quantity)
    ) == Decimal("-3.000")

def test_stock_adjust_inventory_consistency(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=client,
        admin_headers=admin_headers,
        initial_stock=0,
    )

    stock_in_response = client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": "20.000",
            "remark": "Prepare adjust consistency",
        },
    )

    assert stock_in_response.status_code == 200

    adjust_response = client.post(
        "/api/v1/stock/adjust",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "new_quantity": "12.500",
            "remark": "Adjust consistency test",
        },
    )

    assert adjust_response.status_code == 200

    db_session.expire_all()

    product_row = (
        db_session.query(Product)
        .filter(
            Product.id == product["id"]
        )
        .first()
    )

    balance = (
        db_session.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product["id"],
            StockBalance.batch_id.is_(None),
        )
        .first()
    )

    transaction = (
        db_session.query(StockTransaction)
        .filter(
            StockTransaction.product_id
            == product["id"],
            StockTransaction.transaction_type
            == "ADJUST",
        )
        .order_by(
            StockTransaction.id.desc()
        )
        .first()
    )

    movement = (
        db_session.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id
            == product["id"],
            InventoryMovement.movement_type
            == "STOCK_ADJUST",
        )
        .order_by(
            InventoryMovement.id.desc()
        )
        .first()
    )

    assert product_row is not None
    assert balance is not None
    assert transaction is not None
    assert movement is not None

    assert Decimal(
        str(product_row.stock_qty)
    ) == Decimal("12.500")

    assert Decimal(
        str(balance.on_hand_qty)
    ) == Decimal("12.500")

    assert Decimal(
        str(transaction.quantity)
    ) == Decimal("-7.500")

    assert Decimal(
        str(movement.quantity)
    ) == Decimal("-7.500")

    assert Decimal(
        str(movement.balance_before)
    ) == Decimal("20.000")

    assert Decimal(
        str(movement.balance_after)
    ) == Decimal("12.500")

    assert movement.reference_type == (
        "STOCK_TRANSACTION"
    )

    assert movement.reference_id == (
        transaction.id
    )