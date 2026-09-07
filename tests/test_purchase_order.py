from decimal import Decimal
from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

def _decimal(value) -> Decimal:
    return Decimal(str(value))

def _create_supplier(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/suppliers",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_name": (
                f"PO Test Supplier {unique_value}"
            ),
            "contact_name": "Purchase Contact",
            "phone": "0812345678",
            "email": (
                f"po_supplier_"
                f"{unique_value.lower()}@example.com"
            ),
            "address": "Bangkok, Thailand",
        },
    )

    assert response.status_code in {200, 201}

    return response.json()["data"]


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/products",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "sku": f"PO-{unique_value}",
            "barcode": f"883{unique_value}",
            "product_name": (
                f"PO Test Product {unique_value}"
            ),
            "price": 100,
            "stock_qty": 0,
            "category_id": None,
            "track_batch": True,
            "track_expiry": True,
        },
    )

    assert response.status_code in {200, 201}

    return response.json()["data"]


def _create_purchase_order(
    client: TestClient,
    admin_headers: dict[str, str],
    supplier_id: int,
    product_id: int,
    *,
    quantity: int = 10,
    unit_price: float = 125.50,
) -> dict:
    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": supplier_id,
            "items": [
                {
                    "product_id": product_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                }
            ],
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Purchase order created successfully"
    )

    return body["data"]

def _receive_payload(
    product_id: int,
    *,
    quantity: int | float | Decimal,
    lot_no: str | None = None,
) -> dict:
    manufacturing_date = date.today()

    return {
        "items": [
            {
                "product_id": product_id,
                "quantity": quantity,
                "lot_no": (
                    lot_no
                    or (
                        "PO-LOT-"
                        f"{uuid4().hex[:12].upper()}"
                    )
                ),
                "mfg_date": (
                    manufacturing_date.isoformat()
                ),
                "expiry_date": (
                    manufacturing_date
                    + timedelta(days=365)
                ).isoformat(),
            }
        ]
    }

def _get_product(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
) -> dict:
    response = client.get(
        f"/api/v1/products/{product_id}",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
    )

    assert response.status_code == 200

    return response.json()["data"]


def _get_batches(
    client: TestClient,
) -> list[dict]:
    response = client.get("/api/v1/batches")

    assert response.status_code == 200

    return response.json()["data"]


def _get_stock_history(
    client: TestClient,
) -> list[dict]:
    response = client.get(
        "/api/v1/stock/history"
    )

    assert response.status_code == 200

    return response.json()["data"]


def test_create_purchase_order_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": supplier["id"],
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 4,
                    "unit_price": 150.25,
                }
            ],
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True

    data = body["data"]

    assert data["id"] > 0
    assert data["po_number"].startswith("PO-")
    assert data["supplier_id"] == supplier["id"]
    assert data["status"] == "DRAFT"
    assert float(data["total_amount"]) == 601.00
    assert len(data["items"]) == 1

    item = data["items"][0]

    assert item["product_id"] == product["id"]
    assert _decimal(
        item["quantity"]
    ) == Decimal("4.000")
    assert float(item["unit_price"]) == 150.25
    assert float(item["total_price"]) == 601.00


def test_create_po_supplier_not_found(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": 999999999,
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "unit_price": 100,
                }
            ],
        },
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Supplier not found"


def test_create_po_product_not_found(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": supplier["id"],
            "items": [
                {
                    "product_id": 999999999,
                    "quantity": 1,
                    "unit_price": 100,
                }
            ],
        },
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == "Product not found"


def test_create_po_duplicate_product_validation(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": supplier["id"],
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "unit_price": 100,
                },
                {
                    "product_id": product["id"],
                    "quantity": 2,
                    "unit_price": 90,
                },
            ],
        },
    )

    assert response.status_code == 422


def test_get_purchase_orders_and_detail(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        warehouse_client,
        admin_headers,
    )

    product = _create_product(
        warehouse_client,
        admin_headers,
    )

    created = _create_purchase_order(
        warehouse_client,
        admin_headers,
        supplier["id"],
        product["id"],
        quantity=3,
        unit_price=200,
    )

    list_response = warehouse_client.get(
        "/api/v1/purchase-orders"
    )

    assert list_response.status_code == 200

    list_body = list_response.json()

    assert list_body["success"] is True
    assert list_body["message"] == (
        "Purchase orders retrieved successfully"
    )
    assert isinstance(list_body["data"], list)

    po_ids = [
        item["id"]
        for item in list_body["data"]
    ]

    assert created["id"] in po_ids

    detail_response = warehouse_client.get(
        f"/api/v1/purchase-orders/{created['id']}"
    )

    assert detail_response.status_code == 200

    detail = detail_response.json()["data"]

    assert detail["id"] == created["id"]
    assert detail["status"] == "DRAFT"
    assert float(detail["total_amount"]) == 600
    assert len(detail["items"]) == 1


def test_get_missing_purchase_order(
    warehouse_client: TestClient,
) -> None:
    response = warehouse_client.get(
        "/api/v1/purchase-orders/999999999"
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False
    assert body["message"] == (
        "Purchase order not found"
    )


def test_receive_purchase_order_success(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        warehouse_client,
        admin_headers,
    )

    product = _create_product(
        warehouse_client,
        admin_headers,
    )

    created = _create_purchase_order(
        warehouse_client,
        admin_headers,
        supplier["id"],
        product["id"],
        quantity=12,
        unit_price=80,
    )
    _confirm_purchase_order(warehouse_client, admin_headers, created['id'])

    payload = _receive_payload(
        product["id"],
        quantity=12,
    )

    response = warehouse_client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json=payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Purchase order received successfully"
    )

    data = body["data"]

    assert data["id"] == created["id"]
    assert data["status"] == "RECEIVED"
    assert len(data["received_batches"]) == 1

    received_batch = data["received_batches"][0]

    assert received_batch["product_id"] == (
        product["id"]
    )
    assert _decimal(
        received_batch["received_quantity"]
    ) == Decimal("12.000")

    assert _decimal(
        received_batch["current_stock"]
    ) == Decimal("12.000")

    product_after = _get_product(
        warehouse_client,
        admin_headers,
        product["id"],
    )

    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("12.000")

    batches = _get_batches(warehouse_client)

    created_batch = next(
        (
            batch
            for batch in batches
            if batch["id"]
            == received_batch["batch_id"]
        ),
        None,
    )

    assert created_batch is not None
    assert _decimal(
        created_batch["quantity"]
    ) == Decimal("12.000")
    assert created_batch["lot_no"] == (
        payload["items"][0]["lot_no"]
    )

    history = _get_stock_history(warehouse_client)

    transaction = next(
        (
            item
            for item in history
            if (
                item["product_id"] == product["id"]
                and item["transaction_type"] == "IN_PO"
            )
        ),
        None,
    )

    assert transaction is not None
    assert _decimal(
        transaction["quantity"]
    ) == Decimal("12.000")


def test_receive_purchase_order_twice(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_purchase_order(
        client,
        admin_headers,
        supplier["id"],
        product["id"],
    )
    _confirm_purchase_order(client, admin_headers, created['id'])

    first_payload = _receive_payload(
        product["id"],
        quantity=10,
    )

    first_response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json=first_payload,
    )

    assert first_response.status_code == 200

    second_response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json=_receive_payload(
            product["id"],
            quantity=10,
        ),
    )

    assert second_response.status_code == 409

    assert second_response.json()["message"] == (
        "Purchase order already received"
    )


def test_receive_po_invalid_batch_date(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_purchase_order(
        client,
        admin_headers,
        supplier["id"],
        product["id"],
    )
    _confirm_purchase_order(client, admin_headers, created['id'])

    same_date = date.today().isoformat()

    response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 10,
                    "lot_no": (
                        f"INVALID-{uuid4().hex[:10]}"
                    ),
                    "mfg_date": same_date,
                    "expiry_date": same_date,
                }
            ]
        },
    )

    assert response.status_code == 400

    assert response.json()["message"] == (
        "Expiry date must be after manufacturing date"
    )

    product_after = _get_product(
        client,
        admin_headers,
        product["id"],
    )

    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("0.000")


def test_partial_receive_purchase_order(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    first_product = _create_product(
        client,
        admin_headers,
    )

    second_product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/purchase-orders",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={
            "supplier_id": supplier["id"],
            "items": [
                {
                    "product_id": first_product["id"],
                    "quantity": 5,
                    "unit_price": 100,
                },
                {
                    "product_id": second_product["id"],
                    "quantity": 7,
                    "unit_price": 80,
                },
            ],
        },
    )

    assert response.status_code == 201

    po_id = response.json()["data"]["id"]
    _confirm_purchase_order(client, admin_headers, po_id)

    receive_response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{po_id}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json=_receive_payload(
            first_product["id"],
            quantity=5,
        ),
    )

    assert receive_response.status_code == 200

    body = receive_response.json()

    assert body["success"] is True

    data = body["data"]

    assert data["id"] == po_id
    assert data["status"] == "PARTIALLY_RECEIVED"

    assert len(
        data["received_batches"]
    ) == 1

    received_batch = (
        data["received_batches"][0]
    )

    assert (
        received_batch["product_id"]
        == first_product["id"]
    )

    assert _decimal(
        received_batch["received_quantity"]
    ) == Decimal("5.000")

def test_cancel_purchase_order_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_purchase_order(
        client,
        admin_headers,
        supplier["id"],
        product["id"],
    )
    _confirm_purchase_order(client, admin_headers, created['id'])

    response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/cancel"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Purchase order cancelled successfully"
    )
    assert body["data"]["status"] == "CANCELLED"


def test_cancel_purchase_order_twice(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_purchase_order(
        client,
        admin_headers,
        supplier["id"],
        product["id"],
    )
    _confirm_purchase_order(client, admin_headers, created['id'])

    url = (
        f"/api/v1/purchase-orders/"
        f"{created['id']}/cancel"
    )

    first_response = client.post(
        url,
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
    )

    assert first_response.status_code == 200

    second_response = client.post(
        url,
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
    )

    assert second_response.status_code == 409

    assert second_response.json()["message"] == (
        "Purchase order is cancelled"
    )


def test_receive_cancelled_purchase_order(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    supplier = _create_supplier(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    created = _create_purchase_order(
        client,
        admin_headers,
        supplier["id"],
        product["id"],
    )
    _confirm_purchase_order(client, admin_headers, created['id'])

    cancel_response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/cancel"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
    )

    assert cancel_response.status_code == 200

    receive_response = client.post(
        (
            f"/api/v1/purchase-orders/"
            f"{created['id']}/receive"
        ),
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json=_receive_payload(
            product["id"],
            quantity=10,
        ),
    )

    assert receive_response.status_code == 409

    assert receive_response.json()["message"] == (
        "Purchase order is cancelled"
    )


def test_create_purchase_order_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/purchase-orders",
        json={
            "supplier_id": 1,
            "items": [
                {
                    "product_id": 1,
                    "quantity": 1,
                    "unit_price": 100,
                }
            ],
        },
    )

    assert response.status_code == 401



def _confirm_purchase_order(client, headers, po_id):
    response = client.post(f"/api/v1/purchase-orders/{po_id}/confirm", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]