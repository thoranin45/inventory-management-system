from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _create_customer(
    client: TestClient,
    admin_headers: dict[str, str],
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/customers",
        headers=admin_headers,
        json={
            "customer_name": (
                f"Sales Test Customer {unique_value}"
            ),
            "phone": "0812345678",
            "email": (
                f"sales_customer_"
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
        headers=admin_headers,
        json={
            "sku": f"SALE-{unique_value}",
            "barcode": f"884{unique_value}",
            "product_name": (
                f"Sales Test Product {unique_value}"
            ),
            "price": 100.00,
            "stock_qty": 0,
            "category_id": None,
            "track_batch": True,
            "track_expiry": True,
        },
    )

    assert response.status_code in {200, 201}

    return response.json()["data"]


def _create_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    *,
    quantity: int,
    expiry_days: int,
) -> dict:
    mfg_date = date.today()

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json={
            "product_id": product_id,
            "lot_no": (
                f"SO-LOT-"
                f"{uuid4().hex[:12].upper()}"
            ),
            "mfg_date": (
                mfg_date.isoformat()
            ),
            "expiry_date": (
                mfg_date
                + timedelta(days=expiry_days)
            ).isoformat(),
            "quantity": quantity,
        },
    )

    assert response.status_code == 201

    return response.json()["data"]["batch"]


def _create_sales_order(
    client: TestClient,
    admin_headers: dict[str, str],
    customer_id: int,
    product_id: int,
    *,
    quantity: int,
    unit_price: float,
) -> dict:
    response = client.post(
        "/api/v1/sales-orders/",
        headers=admin_headers,
        json={
            "customer_id": customer_id,
            "items": [
                {
                    "product_id": product_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                }
            ],
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Sales Order Created"
    )

    return body["data"]


def _ship_sales_order(
    client: TestClient,
    admin_headers: dict[str, str],
    sales_order_id: int,
) -> dict:
    response = client.post(
        (
            "/api/v1/sales-orders/"
            f"{sales_order_id}/ship"
        ),
        headers=admin_headers,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Sales Order Shipped"
    )

    return body["data"]


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

    return response.json()["data"]


def _get_batch(
    client: TestClient,
    batch_id: int,
) -> dict:
    batches = _get_batches(
        client
    )

    batch = next(
        (
            item
            for item in batches
            if item["id"] == batch_id
        ),
        None,
    )

    assert batch is not None

    return batch


def test_create_sales_order_success(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=20,
        expiry_days=90,
    )

    response = client.post(
        "/api/v1/sales-orders/",
        headers=admin_headers,
        json={
            "customer_id": customer["id"],
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 5,
                    "unit_price": 125.50,
                }
            ],
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Sales Order Created"
    )

    data = body["data"]

    assert data["sales_order_id"] > 0
    assert data["so_number"].startswith(
        "SO-"
    )
    assert data["status"] == "CONFIRMED"
    assert data["total_amount"] == 627.50

    # Creating an SO only reserves stock.
    # Physical stock must not decrease yet.
    product_after = _get_product(
        client,
        admin_headers,
        product["id"],
    )

    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("20.000")


def test_sales_order_uses_fefo(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    later_batch = _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=365,
    )

    earlier_batch = _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=8,
        expiry_days=30,
    )

    sales_order = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=12,
        unit_price=100,
    )

    detail_response = client.get(
        (
            "/api/v1/sales-orders/"
            f"{sales_order['sales_order_id']}"
        )
    )

    assert (
        detail_response.status_code
        == 200
    )

    detail = (
        detail_response.json()["data"]
    )

    allocations = (
        detail["items"][0][
            "batch_allocations"
        ]
    )

    assert len(allocations) == 2

    assert (
        allocations[0]["batch_id"]
        == earlier_batch["id"]
    )

    assert _decimal(
        allocations[0]["quantity"]
    ) == Decimal("8.000")

    assert (
        allocations[1]["batch_id"]
        == later_batch["id"]
    )

    assert _decimal(
        allocations[1]["quantity"]
    ) == Decimal("4.000")

    # Allocation reserves stock only.
    # Batch physical quantities remain unchanged.
    earlier_after = _get_batch(
        client,
        earlier_batch["id"],
    )

    later_after = _get_batch(
        client,
        later_batch["id"],
    )

    assert _decimal(
        earlier_after["quantity"]
    ) == Decimal("8.000")

    assert _decimal(
        later_after["quantity"]
    ) == Decimal("10.000")


def test_create_sales_order_customer_not_found(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    response = client.post(
        "/api/v1/sales-orders/",
        headers=admin_headers,
        json={
            "customer_id": 999999999,
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

    assert response.json()["message"] == (
        "Customer not found"
    )


def test_create_sales_order_insufficient_stock(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=3,
        expiry_days=90,
    )

    response = client.post(
        "/api/v1/sales-orders/",
        headers=admin_headers,
        json={
            "customer_id": customer["id"],
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 10,
                    "unit_price": 100,
                }
            ],
        },
    )

    assert response.status_code == 409

    body = response.json()

    assert body["success"] is False

    assert body["message"] == (
        "Insufficient available stock"
    )


def test_duplicate_product_validation(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    response = client.post(
        "/api/v1/sales-orders/",
        headers=admin_headers,
        json={
            "customer_id": customer["id"],
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "unit_price": 100,
                },
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "unit_price": 100,
                },
            ],
        },
    )

    assert response.status_code == 422


def test_get_sales_orders_and_detail(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=2,
        unit_price=199,
    )

    list_response = client.get(
        "/api/v1/sales-orders/"
    )

    assert list_response.status_code == 200

    list_body = list_response.json()

    assert list_body["success"] is True
    assert "items" in list_body["data"]

    sales_order_ids = [
        item["id"]
        for item in (
            list_body["data"]["items"]
        )
    ]

    assert created["sales_order_id"] in (
        sales_order_ids
    )

    detail_response = client.get(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
        )
    )

    assert (
        detail_response.status_code
        == 200
    )

    detail = (
        detail_response.json()["data"]
    )

    assert detail["id"] == (
        created["sales_order_id"]
    )

    assert detail["total_amount"] == 398
    assert len(detail["items"]) == 1


def test_cancel_sales_order_restores_stock(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    batch = _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=4,
        unit_price=100,
    )

    cancel_response = client.put(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
            "/cancel"
        ),
        headers=admin_headers,
    )

    assert (
        cancel_response.status_code
        == 200
    )

    data = (
        cancel_response.json()["data"]
    )

    assert data["status"] == "CANCELLED"

    product_after = _get_product(
        client,
        admin_headers,
        product["id"],
    )

    batch_after = _get_batch(
        client,
        batch["id"],
    )

    # Cancelling a CONFIRMED order releases
    # reservation only. Physical stock was
    # never deducted.
    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("10.000")

    assert _decimal(
        batch_after["quantity"]
    ) == Decimal("10.000")


def test_cancel_sales_order_twice(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=2,
        unit_price=100,
    )

    url = (
        "/api/v1/sales-orders/"
        f"{created['sales_order_id']}"
        "/cancel"
    )

    first_response = client.put(
        url,
        headers=admin_headers,
    )

    assert (
        first_response.status_code
        == 200
    )

    second_response = client.put(
        url,
        headers=admin_headers,
    )

    assert (
        second_response.status_code
        == 409
    )

    assert (
        second_response.json()["message"]
        == "Sales Order already cancelled"
    )


def test_partial_sales_return(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    batch = _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=6,
        unit_price=100,
    )

    # Return is allowed only after shipment.
    _ship_sales_order(
        client,
        admin_headers,
        created["sales_order_id"],
    )

    response = client.post(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
            "/return"
        ),
        headers=admin_headers,
        json={
            "items": [
                {
                    "product_id": (
                        product["id"]
                    ),
                    "quantity": 2,
                    "reason": (
                        "Damaged package"
                    ),
                }
            ]
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True

    assert body["message"] == (
        "Sales return completed"
    )

    returned = (
        body["data"]["returned_items"][0]
    )

    assert _decimal(
        returned["returned_quantity"]
    ) == Decimal("2.000")

    assert _decimal(
        returned["total_returned"]
    ) == Decimal("2.000")

    assert _decimal(
        returned["remaining_returnable"]
    ) == Decimal("4.000")

    product_after = _get_product(
        client,
        admin_headers,
        product["id"],
    )

    batch_after = _get_batch(
        client,
        batch["id"],
    )

    # 10 initial
    # -6 shipment
    # +2 return
    # =6
    assert _decimal(
        product_after["stock_qty"]
    ) == Decimal("6.000")

    assert _decimal(
        batch_after["quantity"]
    ) == Decimal("6.000")


def test_return_quantity_exceeds_remaining(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=5,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=3,
        unit_price=100,
    )

    # Order must be completed before return.
    _ship_sales_order(
        client,
        admin_headers,
        created["sales_order_id"],
    )

    response = client.post(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
            "/return"
        ),
        headers=admin_headers,
        json={
            "items": [
                {
                    "product_id": (
                        product["id"]
                    ),
                    "quantity": 4,
                    "reason": (
                        "Invalid return"
                    ),
                }
            ]
        },
    )

    assert response.status_code == 409

    assert (
        response.json()["message"]
        .startswith(
            "Return quantity exceeds"
        )
    )


def test_cancel_after_return_fails(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=4,
        unit_price=100,
    )

    # Complete the order before returning.
    _ship_sales_order(
        client,
        admin_headers,
        created["sales_order_id"],
    )

    return_response = client.post(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
            "/return"
        ),
        headers=admin_headers,
        json={
            "items": [
                {
                    "product_id": (
                        product["id"]
                    ),
                    "quantity": 1,
                    "reason": (
                        "Test return"
                    ),
                }
            ]
        },
    )

    assert (
        return_response.status_code
        == 200
    )

    cancel_response = client.put(
        (
            "/api/v1/sales-orders/"
            f"{created['sales_order_id']}"
            "/cancel"
        ),
        headers=admin_headers,
    )

    assert (
        cancel_response.status_code
        == 409
    )

    assert (
        cancel_response.json()["message"]
        ==
        "Completed Sales Order cannot "
        "be cancelled. "
        "Use sales return instead."
    )


def test_create_sales_order_without_token(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/sales-orders/",
        json={
            "customer_id": 1,
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


def test_generate_sales_order_invoice(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    customer = _create_customer(
        client,
        admin_headers,
    )

    product = _create_product(
        client,
        admin_headers,
    )

    _create_batch(
        client,
        admin_headers,
        product["id"],
        quantity=10,
        expiry_days=90,
    )

    created = _create_sales_order(
        client,
        admin_headers,
        customer["id"],
        product["id"],
        quantity=2,
        unit_price=199,
    )

    sales_order_id = (
        created["sales_order_id"]
    )

    so_number = created["so_number"]

    invoice_path = Path(
        "app/static/invoices"
    ) / f"{so_number}.pdf"

    try:
        response = client.get(
            (
                "/api/v1/sales-orders/"
                f"{sales_order_id}/invoice"
            )
        )

        assert response.status_code == 200

        assert response.headers[
            "content-type"
        ].startswith(
            "application/pdf"
        )

        assert response.content.startswith(
            b"%PDF"
        )

        content_disposition = (
            response.headers.get(
                "content-disposition",
                "",
            )
        )

        assert (
            f"{so_number}.pdf"
            in content_disposition
        )

        assert invoice_path.exists()

        assert (
            invoice_path.stat().st_size
            > 0
        )

    finally:
        if invoice_path.exists():
            invoice_path.unlink()


def test_generate_invoice_sales_order_not_found(
    client: TestClient,
) -> None:
    response = client.get(
        (
            "/api/v1/sales-orders/"
            "999999999/invoice"
        )
    )

    assert response.status_code == 404

    body = response.json()

    assert body["success"] is False

    assert body["message"] == (
        "Sales Order not found"
    )