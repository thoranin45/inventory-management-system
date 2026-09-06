from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import ProductBatch


def _create_product(
    client: TestClient,
    admin_headers: dict[str, str],
    *,
    stock_qty: int = 0,
    price: float = 100.00,
) -> dict:
    unique_value = uuid4().hex[:10].upper()

    response = client.post(
        "/api/v1/products",
        headers=admin_headers,
        json={
            "sku": f"DASH-{unique_value}",
            "barcode": f"882{unique_value}",
            "product_name": (
                f"Dashboard Product {unique_value}"
            ),
            "price": price,
            "stock_qty": 0,
            "category_id": None,
        },
    )

    assert response.status_code in {200, 201}

    body = response.json()

    assert body["success"] is True

    product = body["data"]
    if stock_qty:
        stock = client.post("/api/v1/stock/in", headers=admin_headers, json={
            "product_id": product["id"], "quantity": stock_qty, "remark": "Test opening receipt",
        })
        assert stock.status_code == 200
        product = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    return product


def _create_batch(
    client: TestClient,
    admin_headers: dict[str, str],
    product_id: int,
    *,
    quantity: int,
    expiry_days: int,
) -> dict:
    manufacturing_date = date.today()

    response = client.post(
        "/api/v1/batches",
        headers=admin_headers,
        json={
            "product_id": product_id,
            "lot_no": (
                f"DASH-LOT-{uuid4().hex[:12].upper()}"
            ),
            "mfg_date": manufacturing_date.isoformat(),
            "expiry_date": (
                manufacturing_date
                + timedelta(days=expiry_days)
            ).isoformat(),
            "quantity": quantity,
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["success"] is True

    return body["data"]["batch"]


def _get_dashboard(
    client: TestClient,
) -> dict:
    response = client.get(
        "/api/v1/dashboard"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Dashboard retrieved successfully"
    )

    return body["data"]


def test_dashboard_summary(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    before = _get_dashboard(warehouse_client)

    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=0,
        price=120,
    )

    _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=20,
        expiry_days=180,
    )

    out_response = warehouse_client.post(
        "/api/v1/stock/out-fefo",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 5,
            "remark": "Dashboard stock out",
        },
    )

    assert out_response.status_code == 200

    after = _get_dashboard(warehouse_client)

    assert after["total_products"] == (
        before["total_products"] + 1
    )

    assert after["total_stock"] == (
        before["total_stock"] + 15
    )

    assert after["total_stock_in"] == (
        before["total_stock_in"] + 20
    )

    assert after["total_stock_out"] == (
        before["total_stock_out"] + 5
    )

    assert after["low_stock_products"] >= 0


def test_dashboard_low_stock_products(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    low_stock_product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=4,
    )

    high_stock_product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=25,
    )

    response = warehouse_client.get(
        "/api/v1/dashboard/low-stock"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Low stock products retrieved successfully"
    )

    items = body["data"]["items"]

    product_ids = [
        item["id"]
        for item in items
    ]

    assert low_stock_product["id"] in product_ids
    assert high_stock_product["id"] not in product_ids

    for item in items:
        assert item["stock_qty"] <= 10


def test_dashboard_recent_transactions(
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
            "remark": "Dashboard first transaction",
        },
    )

    assert first_response.status_code == 200

    second_response = warehouse_client.post(
        "/api/v1/stock/in",
        headers=admin_headers,
        json={
            "product_id": product["id"],
            "quantity": 3,
            "remark": "Dashboard second transaction",
        },
    )

    assert second_response.status_code == 200

    response = warehouse_client.get(
        "/api/v1/dashboard/recent-transactions"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Recent transactions retrieved successfully"
    )

    items = body["data"]["items"]

    assert len(items) <= 10

    product_transactions = [
        item
        for item in items
        if item["product_id"] == product["id"]
    ]

    assert len(product_transactions) >= 2

    assert product_transactions[0]["remark"] == (
        "Dashboard second transaction"
    )

    assert product_transactions[1]["remark"] == (
        "Dashboard first transaction"
    )


def test_dashboard_stock_summary(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=8,
        price=12.50,
    )

    response = warehouse_client.get(
        "/api/v1/dashboard/stock-summary"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Stock summary retrieved successfully"
    )

    items = body["data"]["items"]

    summary = next(
        (
            item
            for item in items
            if item["product_id"] == product["id"]
        ),
        None,
    )

    assert summary is not None
    assert summary["sku"] == product["sku"]
    assert summary["barcode"] == product["barcode"]
    assert summary["stock_qty"] == 8
    assert float(summary["price"]) == 12.50
    assert float(summary["stock_value"]) == 100.00


def test_dashboard_top_stock(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    lower_product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=40,
    )

    higher_product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=80,
    )

    response = warehouse_client.get(
        "/api/v1/dashboard/top-stock"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Top stock products retrieved successfully"
    )

    items = body["data"]["items"]

    assert len(items) <= 10

    quantities = [
        item["stock_qty"]
        for item in items
    ]

    assert quantities == sorted(
        quantities,
        reverse=True,
    )

    item_ids = [
        item["id"]
        for item in items
    ]

    assert higher_product["id"] in item_ids

    if lower_product["id"] in item_ids:
        assert item_ids.index(
            higher_product["id"]
        ) < item_ids.index(
            lower_product["id"]
        )


def test_dashboard_total_stock_value(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    before_response = warehouse_client.get(
        "/api/v1/dashboard/stock-value"
    )

    assert before_response.status_code == 200

    before_value = float(
        before_response.json()["data"][
            "total_stock_value"
        ]
    )

    _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
        stock_qty=6,
        price=25.00,
    )

    after_response = warehouse_client.get(
        "/api/v1/dashboard/stock-value"
    )

    assert after_response.status_code == 200

    body = after_response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Total stock value retrieved successfully"
    )

    after_value = float(
        body["data"]["total_stock_value"]
    )

    assert after_value == before_value + 150.00


def test_dashboard_expiring_soon(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    expiring_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=30,
    )

    non_expiring_batch = _create_batch(
        client=warehouse_client,
        admin_headers=admin_headers,
        product_id=product["id"],
        quantity=10,
        expiry_days=180,
    )

    response = warehouse_client.get(
        "/api/v1/dashboard/expiring-soon"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Expiring batches retrieved successfully"
    )

    items = body["data"]["items"]

    batch_ids = [
        item["id"]
        for item in items
    ]

    assert expiring_batch["id"] in batch_ids
    assert non_expiring_batch["id"] not in batch_ids


def test_dashboard_expired_batches(
    warehouse_client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    product = _create_product(
        client=warehouse_client,
        admin_headers=admin_headers,
    )

    expired_batch = ProductBatch(
        product_id=product["id"],
        lot_no=(
            f"EXPIRED-{uuid4().hex[:12].upper()}"
        ),
        mfg_date=date.today() - timedelta(days=365),
        expiry_date=date.today() - timedelta(days=1),
        quantity=7,
    )

    db_session.add(expired_batch)
    db_session.commit()
    db_session.refresh(expired_batch)

    response = warehouse_client.get(
        "/api/v1/dashboard/expired"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["message"] == (
        "Expired batches retrieved successfully"
    )

    items = body["data"]["items"]

    batch_ids = [
        item["id"]
        for item in items
    ]

    assert expired_batch.id in batch_ids

    expired_item = next(
        item
        for item in items
        if item["id"] == expired_batch.id
    )

    assert expired_item["quantity"] == 7