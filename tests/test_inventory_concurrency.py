"""Real overlapping PostgreSQL requests; all inventory setup uses audited APIs."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier, Event, Lock
from time import monotonic
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, text
from sqlalchemy.orm import sessionmaker

from app.core.security import create_access_token
from app.database import get_db
from app.main import app
from app.models import (
    User, Warehouse, WarehouseLocation, Product, ProductBatch, StockBalance,
    StockTransaction, InventoryMovement, PurchaseOrderItem, SalesOrder, SalesOrderBatchAllocation,
)
from tests.conftest import TEST_DATABASE_URL
from tests.database_support import isolated_schema
from tests.test_inventory_authority import assert_aggregates
from tests.test_stock import _create_product, _create_batch
from tests import test_purchase_order as purchase
from tests import test_sales_order as sales
from tests import test_inventory_transfer as transfers


@pytest.fixture
def concurrent_inventory():
    with isolated_schema(TEST_DATABASE_URL, "head") as engine:
        sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
        with sessions() as db:
            user = User(username="concurrency_admin", password_hash="unused-test-token", role="ADMIN")
            main = Warehouse(warehouse_code="MAIN", warehouse_name="Main")
            shop = Warehouse(warehouse_code="SHOP", warehouse_name="Shop")
            db.add_all([user, main, shop])
            db.flush()
            main_location = WarehouseLocation(warehouse_id=main.id, location_code="DEFAULT")
            shop_location = WarehouseLocation(warehouse_id=shop.id, location_code="DEFAULT")
            db.add_all([main_location, shop_location])
            db.commit()
            headers = {"Authorization": "Bearer " + create_access_token({"sub": str(user.id)})}
            storage = dict(source_warehouse_id=main.id, source_location_id=main_location.id,
                           destination_warehouse_id=shop.id, destination_location_id=shop_location.id)

        def get_test_db():
            with sessions() as db:
                yield db

        previous = app.dependency_overrides[get_db]
        app.dependency_overrides[get_db] = get_test_db
        try:
            with TestClient(app, headers=headers) as client:
                state = SimpleNamespace(engine=engine, sessions=sessions, client=client, headers=headers, storage=storage)
                yield state
                with sessions() as db:
                    for product in db.query(Product).all():
                        assert_aggregates(db, product.id)
                        physical = db.query(func.coalesce(func.sum(StockBalance.on_hand_qty), 0)).filter_by(product_id=product.id).scalar()
                        ledger = db.query(func.coalesce(func.sum(InventoryMovement.quantity), 0)).filter_by(product_id=product.id).scalar()
                        assert physical == ledger
        finally:
            app.dependency_overrides[get_db] = previous


def overlap(state, requests, table, ids):
    """Hold a real row lock until both independent backends visibly wait on locks."""
    assert table in {"products", "sales_orders", "purchase_orders"}
    barrier = Barrier(2, timeout=6)
    mutex = Lock()
    pids = set()

    def before_execute(connection, cursor, statement, parameters, context, executemany):
        # Capture both authenticated request backends, including a worker waiting
        # on an earlier document uniqueness/FK lock before its inventory lock.
        if "FROM users" not in statement:
            return
        with connection.connection.driver_connection.cursor() as probe:
            probe.execute("SELECT pg_backend_pid()")
            pid = probe.fetchone()[0]
        with mutex:
            if pid in pids:
                return
            pids.add(pid)
        barrier.wait()

    def invoke(request):
        method, path, payload = request
        with TestClient(app, headers=state.headers) as worker:
            return worker.request(method, path, json=payload)

    with state.engine.connect() as blocker:
        transaction = blocker.begin()
        blocker.execute(text(f"SELECT id FROM {table} WHERE id = ANY(:ids) ORDER BY id FOR UPDATE"), {"ids": ids})
        event.listen(state.engine, "before_cursor_execute", before_execute)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(invoke, request) for request in requests]
                try:
                    deadline = monotonic() + 6
                    observed = False
                    with state.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as monitor:
                        while monotonic() < deadline:
                            with mutex:
                                workers = list(pids)
                            if len(workers) == 2:
                                waits = monitor.scalar(text(
                                    "SELECT count(*) FROM pg_stat_activity WHERE pid = ANY(:pids) AND wait_event_type = 'Lock'"
                                ), {"pids": workers})
                                if waits == 2:
                                    observed = True
                                    break
                            Event().wait(0.01)
                    assert observed, "Both PostgreSQL workers must overlap and wait on real row locks"
                finally:
                    transaction.rollback()
                results = [future.result(timeout=12) for future in futures]
        finally:
            if transaction.is_active:
                transaction.rollback()
            event.remove(state.engine, "before_cursor_execute", before_execute)
    return results


def batch_payload(product_id, quantity="1.000", lot="RACE"):
    return {"product_id": product_id, "quantity": quantity, "lot_no": lot,
            "mfg_date": date.today().isoformat(), "expiry_date": (date.today() + timedelta(days=90)).isoformat()}


def test_competing_stock_deductions(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=90)
    request = ("POST", "/api/v1/stock/out-fefo", {"product_id": product["id"], "quantity": "0.750"})
    responses = overlap(s, [request, request], "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        assert db.query(StockBalance).one().on_hand_qty == Decimal("0.250")
        assert db.query(StockTransaction).filter_by(transaction_type="OUT_FEFO").count() == 1
        assert db.query(InventoryMovement).filter(InventoryMovement.quantity < 0).count() == 1


def test_competing_reservations(concurrent_inventory):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers)
    customer = sales._create_customer(s.client, s.headers)
    sales._create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=90)
    orders = [sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="0.750", unit_price=1) for _ in range(2)]
    requests = [("POST", f"/api/v1/sales-orders/{o['sales_order_id']}/confirm", None) for o in orders]
    responses = overlap(s, requests, "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        balance = db.query(StockBalance).one()
        assert balance.on_hand_qty == Decimal("1.000")
        assert balance.reserved_qty == Decimal("0.750")
        assert db.query(SalesOrder).filter_by(status="CONFIRMED").count() == 1
        assert db.query(SalesOrder).filter_by(status="DRAFT").count() == 1
        assert db.query(SalesOrderBatchAllocation).one().quantity == Decimal("0.750")
        assert db.query(InventoryMovement).count() == 1


@pytest.mark.parametrize("with_batch", [False, True])
def test_simultaneous_missing_balance_creation(concurrent_inventory, with_batch):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers) if with_batch else _create_product(s.client, s.headers)
    if with_batch:
        batch = _create_batch(s.client, s.headers, product["id"], quantity="2.000", expiry_days=90)
        orders = []
        for _ in range(2):
            response = s.client.post("/api/v1/inventory-transfers", json={
                "source_warehouse_id": s.storage["source_warehouse_id"],
                "destination_warehouse_id": s.storage["destination_warehouse_id"],
                "items": [{"product_id": product["id"], "batch_id": batch["id"],
                           "from_location_id": s.storage["source_location_id"],
                           "to_location_id": s.storage["destination_location_id"], "quantity": "0.750"}],
            })
            assert response.status_code == 201
            orders.append(response.json())
        requests = [("POST", f"/api/v1/inventory-transfers/{o['id']}/complete", None) for o in orders]
    else:
        request = ("POST", "/api/v1/stock/in", {"product_id": product["id"], "quantity": "0.750"})
        requests = [request, request]
    responses = overlap(s, requests, "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        balances = db.query(StockBalance).all()
        assert len(balances) == (2 if with_batch else 1)
        target = next(b for b in balances if not with_batch or b.warehouse_id == s.storage["destination_warehouse_id"])
        assert target.on_hand_qty == Decimal("1.500")


def test_raw_zero_balance_creation_race(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    request = ("POST", "/api/v1/stock-balances", {"product_id": product["id"],
               "warehouse_id": s.storage["source_warehouse_id"], "location_id": s.storage["source_location_id"]})
    responses = overlap(s, [request, request], "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [201, 409]
    with s.sessions() as db:
        assert db.query(StockBalance).count() == 1
        assert db.query(StockTransaction).count() == 0
        assert db.query(InventoryMovement).count() == 0


@pytest.mark.parametrize("same_product", [True, False])
def test_simultaneous_batch_creation(concurrent_inventory, same_product):
    s = concurrent_inventory
    first = _create_product(s.client, s.headers)
    second = first if same_product else _create_product(s.client, s.headers)
    requests = [("POST", "/api/v1/batches", batch_payload(p["id"], "0.125")) for p in [first, second]]
    responses = overlap(s, requests, "products", sorted({first["id"], second["id"]}))
    assert sorted(r.status_code for r in responses) == ([201, 409] if same_product else [201, 201])
    with s.sessions() as db:
        assert db.query(ProductBatch).count() == (1 if same_product else 2)
        assert db.query(StockTransaction).count() == (1 if same_product else 2)


@pytest.mark.parametrize("quantity,statuses,total", [
    ("0.750", [200, 409], Decimal("0.750")),
    ("0.500", [200, 200], Decimal("1.000")),
])
def test_po_partial_receipt_race(concurrent_inventory, quantity, statuses, total):
    s = concurrent_inventory
    product = purchase._create_product(s.client, s.headers)
    supplier = purchase._create_supplier(s.client, s.headers)
    order = purchase._create_purchase_order(s.client, s.headers, supplier["id"], product["id"], quantity=1)
    requests = [("POST", f"/api/v1/purchase-orders/{order['id']}/receive",
                 purchase._receive_payload(product["id"], quantity=quantity, lot_no=f"PO-RACE-{i}")) for i in range(2)]
    responses = overlap(s, requests, "purchase_orders", [order["id"]])
    assert sorted(r.status_code for r in responses) == statuses
    with s.sessions() as db:
        assert db.query(PurchaseOrderItem).one().received_quantity == total
        assert db.get(Product, product["id"]).stock_qty == total
        assert db.query(StockTransaction).count() == statuses.count(200)


def test_batch_creation_races_po_receipt(concurrent_inventory):
    s = concurrent_inventory
    product = purchase._create_product(s.client, s.headers)
    supplier = purchase._create_supplier(s.client, s.headers)
    order = purchase._create_purchase_order(s.client, s.headers, supplier["id"], product["id"], quantity=1)
    requests = [
        ("POST", "/api/v1/batches", batch_payload(product["id"], "0.125", "SHARED")),
        ("POST", f"/api/v1/purchase-orders/{order['id']}/receive",
         purchase._receive_payload(product["id"], quantity="0.125", lot_no="SHARED")),
    ]
    responses = overlap(s, requests, "products", [product["id"]])
    assert sum(r.status_code in {200, 201} for r in responses) == 1
    assert sum(r.status_code == 409 for r in responses) == 1
    with s.sessions() as db:
        assert db.query(ProductBatch).count() == 1
        assert db.query(StockTransaction).count() == 1
        assert db.get(Product, product["id"]).stock_qty == Decimal("0.125")


def test_shipment_versus_cancellation(concurrent_inventory):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers)
    customer = sales._create_customer(s.client, s.headers)
    sales._create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=90)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="0.750", unit_price=1)
    sales._confirm_sales_order(s.client, s.headers, order['sales_order_id'])
    order_id = order["sales_order_id"]
    sales._ready_sales_order(s.client, s.headers, order_id)
    responses = overlap(s, [
        ("POST", f"/api/v1/sales-orders/{order_id}/ship", None),
        ("PUT", f"/api/v1/sales-orders/{order_id}/cancel", None),
    ], "sales_orders", [order_id])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        status = db.get(SalesOrder, order_id).status
        balance = db.query(StockBalance).one()
        assert status in {"SHIPPED", "CANCELLED"}
        assert balance.reserved_qty == 0
        assert balance.on_hand_qty == (Decimal("0.250") if status == "SHIPPED" else Decimal("1.000"))
        assert db.query(InventoryMovement).filter(InventoryMovement.quantity < 0).count() == (1 if status == "SHIPPED" else 0)


def test_opposite_direction_multi_product_transfers(concurrent_inventory):
    s = concurrent_inventory
    products = [_create_product(s.client, s.headers, initial_stock="1.000") for _ in range(2)]
    for product in products:
        response = s.client.post("/api/v1/stock/in", json={"product_id": product["id"], "quantity": "1.000",
            "warehouse_id": s.storage["destination_warehouse_id"], "location_id": s.storage["destination_location_id"]})
        assert response.status_code == 200
    orders = []
    for reverse in [False, True]:
        source = "destination" if reverse else "source"
        target = "source" if reverse else "destination"
        response = s.client.post("/api/v1/inventory-transfers", json={
            "source_warehouse_id": s.storage[source + "_warehouse_id"],
            "destination_warehouse_id": s.storage[target + "_warehouse_id"],
            "items": [{"product_id": p["id"], "quantity": "0.750",
                       "from_location_id": s.storage[source + "_location_id"],
                       "to_location_id": s.storage[target + "_location_id"]}
                      for p in (list(reversed(products)) if reverse else products)],
        })
        assert response.status_code == 201
        orders.append(response.json())
    responses = overlap(s, [("POST", f"/api/v1/inventory-transfers/{o['id']}/complete", None) for o in orders],
                        "products", [p["id"] for p in products])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        assert all(b.on_hand_qty == Decimal("1.000") for b in db.query(StockBalance).all())
        assert db.query(InventoryMovement).filter_by(reference_type="INVENTORY_TRANSFER").count() == 8


@pytest.mark.parametrize("track_batch", [False, True])
def test_fractional_repeated_returns(concurrent_inventory, track_batch):
    s = concurrent_inventory
    if track_batch:
        product = sales._create_product(s.client, s.headers)
        sales._create_batch(s.client, s.headers, product["id"], quantity="1.125", expiry_days=90)
    else:
        product = _create_product(s.client, s.headers, initial_stock="1.125")
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="1.125", unit_price=1)
    sales._confirm_sales_order(s.client, s.headers, order['sales_order_id'])
    order_id = order["sales_order_id"]
    sales._ready_sales_order(s.client, s.headers, order_id)
    sales._ship_sales_order(s.client, s.headers, order_id)
    for quantity in ["0.125", "0.001"]:
        response = s.client.post(f"/api/v1/sales-orders/{order_id}/return", json={"items": [
            {"product_id": product["id"], "quantity": quantity, "reason": "Fractional return"}]})
        assert response.status_code == 200
    request = ("POST", f"/api/v1/sales-orders/{order_id}/return", {"items": [
        {"product_id": product["id"], "quantity": "0.750", "reason": "Race"}]})
    responses = overlap(s, [request, request], "sales_orders", [order_id])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        assert db.get(Product, product["id"]).stock_qty == Decimal("0.876")
        assert db.query(StockTransaction).filter_by(transaction_type="SALE_RETURN").count() == 3
    response = s.client.post(f"/api/v1/sales-orders/{order_id}/return", json={"items": [
        {"product_id": product["id"], "quantity": "0.249", "reason": "Remainder"}]})
    assert response.status_code == 200
    response = s.client.post(f"/api/v1/sales-orders/{order_id}/return", json={"items": [
        {"product_id": product["id"], "quantity": "0.001", "reason": "Over return"}]})
    assert response.status_code == 409


@pytest.mark.parametrize("race", ["confirm", "confirm-cancel", "ship", "complete-picking", "complete-packing", "scan-pick", "scan-pack"])
def test_fulfillment_overlap(concurrent_inventory, race):
    from tests.test_sales_order_fulfillment import advance
    s = concurrent_inventory
    product = _create_product(s.client, s.headers, initial_stock="1.000")
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="1.000", unit_price=1)
    order_id = order["sales_order_id"]
    start = {"confirm": "DRAFT", "confirm-cancel": "DRAFT", "ship": "READY_TO_SHIP",
             "complete-picking": "PICKING", "complete-packing": "PACKING", "scan-pick": "PICKING", "scan-pack": "PACKING"}[race]
    advance(s.client, s.headers, order_id, start)
    endpoint = "confirm" if race == "confirm-cancel" else race
    payload = None
    if race.startswith("complete-"):
        payload = sales._fulfillment_payload(s.client, s.headers, order_id)
    if race.startswith("scan-"):
        payload = {"barcode": product["barcode"]}
    request = ("POST", f"/api/v1/sales-orders/{order_id}/{endpoint}", payload)
    second = ("PUT", f"/api/v1/sales-orders/{order_id}/cancel", None) if race == "confirm-cancel" else request
    responses = overlap(s, [request, second], "sales_orders", [order_id])
    if race == "confirm-cancel":
        assert sorted(r.status_code for r in responses) in ([200, 200], [200, 409])
    else:
        assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        order = db.get(SalesOrder, order_id)
        balance = db.query(StockBalance).one()
        allocations = db.query(SalesOrderBatchAllocation).all()
        shipped = race == "ship"
        assert balance.on_hand_qty == (Decimal(0) if shipped else Decimal(1))
        assert balance.reserved_qty == (Decimal(0) if shipped or race == "confirm-cancel" else Decimal(1))
        assert len(allocations) <= 1
        for allocation in allocations:
            assert Decimal(0) <= allocation.packed_quantity <= allocation.picked_quantity <= allocation.quantity
            if race == "scan-pick":
                assert allocation.picked_quantity == Decimal(1)
            if race == "scan-pack":
                assert allocation.packed_quantity == Decimal(1)
        assert db.query(InventoryMovement).filter_by(movement_type="SALES_SHIPMENT").count() == int(shipped)
        assert db.query(StockTransaction).filter_by(transaction_type="SALE_SHIPMENT").count() == int(shipped)
        if race == "confirm-cancel":
            assert order.status == "CANCELLED"
