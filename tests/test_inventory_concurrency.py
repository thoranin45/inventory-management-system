from uuid import uuid4
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
    AuditLog, User, Warehouse, WarehouseLocation, Product, ProductBatch, StockBalance,
    StockOperationReceipt, StockTransaction, InventoryMovement, PurchaseOrderItem,
    SalesOrder, SalesOrderBatchAllocation,
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
            # Phase 14B's migration (ea1a00000001) already seeds MAIN/DEFAULT
            # on every freshly-migrated schema, including this isolated one
            # -- get-or-create rather than blind-insert, mirroring
            # conftest.py's own seed_test_foundation() pattern.
            user = User(username="concurrency_admin", password_hash="unused-test-token", role="ADMIN")
            main = db.query(Warehouse).filter_by(warehouse_code="MAIN").first()
            if main is None:
                main = Warehouse(warehouse_code="MAIN", warehouse_name="Main")
                db.add(main)
            shop = Warehouse(warehouse_code="SHOP", warehouse_name="Shop")
            db.add_all([user, shop])
            db.flush()
            main_location = db.query(WarehouseLocation).filter_by(warehouse_id=main.id, location_code="DEFAULT").first()
            if main_location is None:
                main_location = WarehouseLocation(warehouse_id=main.id, location_code="DEFAULT")
                db.add(main_location)
            shop_location = WarehouseLocation(warehouse_id=shop.id, location_code="DEFAULT")
            db.add(shop_location)
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
    assert table in {"products", "sales_orders", "purchase_orders", "inventory_transfers", "stock_adjustment_requests"}
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
        method, path, payload = request[:3]
        with TestClient(app, headers=state.headers) as worker:
            if len(request) == 4:
                return worker.request(method, path, json=payload, headers={"Idempotency-Key": request[3]})
            return worker.request(method, path, json=payload, headers={"Idempotency-Key": uuid4().hex})

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
        # Two transfers of the same batch race to create the one shared transit balance at dispatch.
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
        requests = [("POST", f"/api/v1/inventory-transfers/{o['id']}/dispatch", None) for o in orders]
    else:
        request = ("POST", "/api/v1/stock/in", {"product_id": product["id"], "quantity": "0.750"})
        requests = [request, request]
    responses = overlap(s, requests, "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        balances = db.query(StockBalance).all()
        if with_batch:
            # exactly one source balance and one shared transit balance, no duplicates
            transit_id = db.query(Warehouse.id).filter_by(warehouse_code="__TRANSIT__").scalar()
            assert len(balances) == 2
            transit = next(b for b in balances if b.warehouse_id == transit_id)
            source = next(b for b in balances if b.warehouse_id == s.storage["source_warehouse_id"])
            assert transit.on_hand_qty == Decimal("1.500")
            assert source.on_hand_qty == Decimal("0.500")
            assert transit.reserved_qty == 0
        else:
            assert len(balances) == 1
            assert balances[0].on_hand_qty == Decimal("1.500")


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
    for p in {first["id"], second["id"]}:
        # Batch inbound requires a batch-tracked product (server invariant).
        s.client.put(f"/api/v1/products/{p}", headers=s.headers,
                     json={"track_batch": True, "track_expiry": True})
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
    purchase._confirm_purchase_order(s.client, s.headers, order['id'])
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
    purchase._confirm_purchase_order(s.client, s.headers, order['id'])
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
    # Opposite-direction transfers race to dispatch, each locking both products and both source balances.
    responses = overlap(s, [("POST", f"/api/v1/inventory-transfers/{o['id']}/dispatch", None) for o in orders],
                        "products", [p["id"] for p in products])
    assert [r.status_code for r in responses] == [200, 200]
    for order in orders:
        receipt = s.client.post(
            f"/api/v1/inventory-transfers/{order['id']}/receive",
            headers={"Idempotency-Key": uuid4().hex},
            json={"items": [{"transfer_item_id": item["id"], "quantity": item["quantity"]}
                            for item in order["items"]]},
        )
        assert receipt.status_code == 200, receipt.text
    with s.sessions() as db:
        operational = [b for b in db.query(StockBalance).all()
                       if b.warehouse_id != db.query(Warehouse.id).filter_by(warehouse_code="__TRANSIT__").scalar()]
        assert all(b.on_hand_qty == Decimal("1.000") for b in operational)
        # 2 transfers x 2 lines x (2 dispatch legs + 2 receipt legs)
        assert db.query(InventoryMovement).filter_by(reference_type="INVENTORY_TRANSFER").count() == 16
        assert db.query(InventoryMovement).filter(
            InventoryMovement.reference_type == "INVENTORY_TRANSFER").filter(
            InventoryMovement.quantity != 0).count() == 16


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


@pytest.mark.parametrize("race", ["confirm", "confirm-cancel", "ship", "complete-picking", "complete-packing",
                                  "scan-pick", "scan-pack", "undo-pick", "undo-pack"])
def test_fulfillment_overlap(concurrent_inventory, race):
    from tests.test_sales_order_fulfillment import advance
    s = concurrent_inventory
    product = _create_product(s.client, s.headers, initial_stock="1.000")
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="1.000", unit_price=1)
    order_id = order["sales_order_id"]
    start = {"confirm": "DRAFT", "confirm-cancel": "DRAFT", "ship": "READY_TO_SHIP",
             "complete-picking": "PICKING", "complete-packing": "PACKING", "scan-pick": "PICKING", "scan-pack": "PACKING",
             "undo-pick": "PICKING", "undo-pack": "PACKING"}[race]
    advance(s.client, s.headers, order_id, start)
    # Completion is scan-authoritative (Phase 12C Amendment 4): the counters
    # must already be full before the racing complete-* calls, or both 409.
    if race in ("complete-picking", "undo-pick"):
        sales._scan_fulfillment_to_full(s.client, s.headers, order_id, packing=False)
    elif race in ("complete-packing", "undo-pack"):
        sales._scan_fulfillment_to_full(s.client, s.headers, order_id, packing=True)
    endpoint = "confirm" if race == "confirm-cancel" else race
    payload = None
    if race.startswith("complete-"):
        payload = sales._fulfillment_payload(s.client, s.headers, order_id)
    if race.startswith("scan-"):
        payload = {"barcode": product["barcode"]}
    if race.startswith("undo-"):
        allocation_id = s.client.get(f"/api/v1/sales-orders/{order_id}", headers=s.headers).json()[
            "data"]["items"][0]["fulfillment_allocations"][0]["id"]
        payload = {"allocation_id": allocation_id, "quantity": "1.000"}
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
            if race == "undo-pick":
                assert allocation.picked_quantity == Decimal(0)  # exactly one undo applied, never negative
            if race == "undo-pack":
                assert allocation.packed_quantity == Decimal(0)
        assert db.query(InventoryMovement).filter_by(movement_type="SALES_SHIPMENT").count() == int(shipped)
        assert db.query(StockTransaction).filter_by(transaction_type="SALE_SHIPMENT").count() == int(shipped)
        if race == "confirm-cancel":
            assert order.status == "CANCELLED"


def test_stock_in_same_idempotency_key_applies_once(concurrent_inventory):
    """Two overlapping /stock/in requests with the same Idempotency-Key: stock moves once.

    Both workers serialise on the per-product advisory lock; the loser replays
    the committed receipt instead of applying a second movement.
    """
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    key = "idem-race-" + uuid4().hex
    request = ("POST", "/api/v1/stock/in", {"product_id": product["id"], "quantity": "6.000"}, key)
    responses = overlap(s, [request, request], "products", [product["id"]])

    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["data"] == responses[1].json()["data"]  # one applied, one replayed

    with s.sessions() as db:
        assert db.get(Product, product["id"]).stock_qty == Decimal("6.000")
        assert db.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1
        assert db.query(InventoryMovement).filter_by(
            product_id=product["id"], movement_type="STOCK_IN").count() == 1
        assert db.query(StockTransaction).filter_by(product_id=product["id"]).count() == 1


def test_stock_in_same_idempotency_key_different_products_conflicts_safely(concurrent_inventory):
    """Same Idempotency-Key, two DIFFERENT products, genuinely concurrent.

    ``stock_operation_receipts.operation_key`` is globally unique with no
    parent row to scope it (unlike PO/transfer receipts, which key off their
    parent id). ``lock_inventory`` locks each request's own product only, so
    two different products are NOT serialised against each other by it the
    way two requests for the SAME product are in
    ``test_stock_in_same_idempotency_key_applies_once`` above — both workers
    can pass the synchronous "no existing receipt" check before either
    commits.

    A barrier on the INSERT itself (rather than relying on incidental thread
    scheduling) forces that exact collision every run, so this is a
    deterministic repro of the race, not a probabilistic one. The loser must
    get a clean 409 — never a bare 500 from an uncaught IntegrityError — and
    its entire stock mutation must roll back, not just the receipt insert.
    """
    s = concurrent_inventory
    first = _create_product(s.client, s.headers)
    second = _create_product(s.client, s.headers)
    key = "idem-cross-product-" + uuid4().hex

    barrier = Barrier(2, timeout=6)

    def before_insert(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO stock_operation_receipts" in statement:
            barrier.wait()

    event.listen(s.engine, "before_cursor_execute", before_insert)
    try:
        request_a = ("POST", "/api/v1/stock/in", {"product_id": first["id"], "quantity": "4.000"}, key)
        request_b = ("POST", "/api/v1/stock/in", {"product_id": second["id"], "quantity": "9.000"}, key)
        responses = overlap(s, [request_a, request_b], "products", sorted({first["id"], second["id"]}))
    finally:
        event.remove(s.engine, "before_cursor_execute", before_insert)

    assert sorted(r.status_code for r in responses) == [200, 409]
    loser = next(r for r in responses if r.status_code == 409)
    assert "different payload" in loser.text
    assert loser.json()["request_id"]

    winner_is_first = responses[0].status_code == 200
    winner_id, winner_qty = (first["id"], Decimal("4.000")) if winner_is_first else (second["id"], Decimal("9.000"))
    loser_id = second["id"] if winner_is_first else first["id"]

    with s.sessions() as db:
        assert db.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1
        assert db.get(Product, winner_id).stock_qty == winner_qty
        assert db.get(Product, loser_id).stock_qty == Decimal("0.000")  # rolled back whole, not half-applied
        assert db.query(InventoryMovement).filter_by(movement_type="STOCK_IN").count() == 1
        assert db.query(StockTransaction).count() == 1


@pytest.mark.parametrize("endpoint,movement_type", [("out-fifo", "STOCK_OUT_FIFO"), ("out-fefo", "STOCK_OUT_FEFO")])
def test_stock_out_same_idempotency_key_applies_once(concurrent_inventory, endpoint, movement_type):
    """Phase 14A — two overlapping /stock/out-fifo (or -fefo) requests with
    the same Idempotency-Key, same product: stock deducts once.

    Both workers serialise on the per-product advisory lock (lock_inventory);
    the loser replays the committed receipt instead of deducting a second
    time. Mirrors test_stock_in_same_idempotency_key_applies_once.
    """
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _create_batch(s.client, s.headers, product["id"], quantity="10.000", expiry_days=180)
    key = "idem-out-race-" + uuid4().hex
    request = ("POST", f"/api/v1/stock/{endpoint}", {"product_id": product["id"], "quantity": "6.000"}, key)
    responses = overlap(s, [request, request], "products", [product["id"]])

    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["data"] == responses[1].json()["data"]  # one applied, one replayed

    with s.sessions() as db:
        assert db.get(Product, product["id"]).stock_qty == Decimal("4.000")  # 10 - 6, deducted exactly once
        assert db.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1
        assert db.query(InventoryMovement).filter_by(
            product_id=product["id"], movement_type=movement_type).count() == 1
        # product_id alone would also count the IN_BATCH transaction the
        # _create_batch() setup call wrote — scope to this operation's own type.
        out_transaction_type = "OUT_FIFO" if endpoint == "out-fifo" else "OUT_FEFO"
        assert db.query(StockTransaction).filter_by(
            product_id=product["id"], transaction_type=out_transaction_type).count() == 1
        assert db.query(AuditLog).filter_by(action=movement_type).count() == 1


def test_stock_out_fifo_same_idempotency_key_different_products_conflicts_safely(concurrent_inventory):
    """Phase 14A — same Idempotency-Key, two DIFFERENT products, genuinely
    concurrent, on /stock/out-fifo. Mirrors
    test_stock_in_same_idempotency_key_different_products_conflicts_safely:
    the per-product lock does not serialise two different products against
    each other, so a barrier on the INSERT itself forces the exact
    cross-product receipt-key collision every run. The loser must get a
    clean 409 (never a bare 500) and roll back its deduction entirely.
    """
    s = concurrent_inventory
    first = _create_product(s.client, s.headers)
    second = _create_product(s.client, s.headers)
    _create_batch(s.client, s.headers, first["id"], quantity="10.000", expiry_days=180)
    _create_batch(s.client, s.headers, second["id"], quantity="10.000", expiry_days=180)
    key = "idem-out-cross-product-" + uuid4().hex

    barrier = Barrier(2, timeout=6)

    def before_insert(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO stock_operation_receipts" in statement:
            barrier.wait()

    event.listen(s.engine, "before_cursor_execute", before_insert)
    try:
        request_a = ("POST", "/api/v1/stock/out-fifo", {"product_id": first["id"], "quantity": "4.000"}, key)
        request_b = ("POST", "/api/v1/stock/out-fifo", {"product_id": second["id"], "quantity": "9.000"}, key)
        responses = overlap(s, [request_a, request_b], "products", sorted({first["id"], second["id"]}))
    finally:
        event.remove(s.engine, "before_cursor_execute", before_insert)

    assert sorted(r.status_code for r in responses) == [200, 409]
    loser = next(r for r in responses if r.status_code == 409)
    assert "different payload" in loser.text
    assert loser.json()["request_id"]

    winner_is_first = responses[0].status_code == 200
    winner_id, winner_qty = (first["id"], Decimal("6.000")) if winner_is_first else (second["id"], Decimal("1.000"))
    loser_id = second["id"] if winner_is_first else first["id"]

    with s.sessions() as db:
        assert db.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1
        assert db.get(Product, winner_id).stock_qty == winner_qty  # 10 - (4 or 9), deducted exactly once
        assert db.get(Product, loser_id).stock_qty == Decimal("10.000")  # rolled back whole, not half-applied
        assert db.query(InventoryMovement).filter_by(movement_type="STOCK_OUT_FIFO").count() == 1
        assert db.query(StockTransaction).filter_by(transaction_type="OUT_FIFO").count() == 1
        # The loser's own AuditLog insert (written before the final receipt
        # insert that actually loses the race) must roll back along with
        # everything else in its transaction — not just the stock mutation.
        audit_rows = db.query(AuditLog).filter_by(action="STOCK_OUT_FIFO").all()
        assert len(audit_rows) == 1
        assert f"Product {winner_id};" in audit_rows[0].description
        assert f"Product {loser_id};" not in audit_rows[0].description


def _receipt_race_order(s, products, quantity="1.000"):
    supplier = purchase._create_supplier(s.client, s.headers)
    response = s.client.post("/api/v1/purchase-orders", json={"supplier_id":supplier["id"], "items":[
        {"product_id":p["id"],"quantity":quantity,"unit_price":1} for p in products]})
    assert response.status_code == 201
    po_id=response.json()["data"]["id"]
    purchase._confirm_purchase_order(s.client,s.headers,po_id)
    return po_id


@pytest.mark.parametrize("race", ["same-key", "changed-payload", "same-lot", "different-products-lot", "missing-balance", "multiline", "cancel"])
def test_receipt_operation_races(concurrent_inventory,race):
    from app.models import PurchaseOrderReceipt, PurchaseOrder
    s=concurrent_inventory
    batch=race in {"same-lot","different-products-lot"}
    create=purchase._create_product if batch else _create_product
    products=[create(s.client,s.headers)]
    if race in {"different-products-lot","multiline"}:
        products.append(create(s.client,s.headers))
    same_order=race in {"same-key","changed-payload","cancel"}
    first=_receipt_race_order(s,products if race=="multiline" else products[:1])
    second=first if same_order else _receipt_race_order(s,list(reversed(products)) if race=="multiline" else products[-1:])
    def payload(ps,amount):
        return {"items":[purchase._receive_payload(p["id"],quantity=amount,lot_no="RACE-LOT")["items"][0]
                         if batch else {"product_id":p["id"],"quantity":amount} for p in ps]}
    amount="1.000" if race=="same-key" else "0.500"
    first_payload=payload(products if race=="multiline" else products[:1],amount)
    second_payload=payload(list(reversed(products)) if race=="multiline" else products[-1:],"0.750" if race=="changed-payload" else amount)
    key=uuid4().hex
    requests=[("POST",f"/api/v1/purchase-orders/{first}/receive",first_payload,key),
              ("POST",f"/api/v1/purchase-orders/{second}/receive",second_payload,key if same_order else uuid4().hex)]
    if race=="cancel":
        requests[1]=("POST",f"/api/v1/purchase-orders/{first}/cancel",None)
    responses=overlap(s,requests,"purchase_orders" if same_order else "products",[first] if same_order else [p["id"] for p in products])
    expected=[200,409] if race in {"changed-payload","same-lot","cancel"} else [200,200]
    assert sorted(r.status_code for r in responses)==expected
    if race=="same-key":
        assert responses[0].json()==responses[1].json()
        replay=s.client.post(f"/api/v1/purchase-orders/{first}/receive",json=first_payload,headers={"Idempotency-Key":key})
        assert replay.json()==responses[0].json()
    with s.sessions() as db:
        events=db.query(PurchaseOrderReceipt).all()
        expected_events=1 if race in {"same-key","changed-payload","same-lot"} else (int(db.get(PurchaseOrder,first).status!="CANCELLED") if race=="cancel" else 2)
        assert len(events)==expected_events
        movements=db.query(InventoryMovement).filter_by(movement_type="PURCHASE_RECEIPT").all()
        assert len(movements)==expected_events*(2 if race=="multiline" else 1)
        assert db.query(StockTransaction).filter_by(transaction_type="IN_PO").count()==len(movements)
        for p in products:
            balances=db.query(StockBalance).filter_by(product_id=p["id"]).all()
            assert len(balances)<=1 and all(b.reserved_qty==0 for b in balances)
            committed=sum((m.quantity for m in movements if m.product_id==p["id"]),Decimal(0))
            assert sum((b.on_hand_qty for b in balances),Decimal(0))==committed
            items=db.query(PurchaseOrderItem).filter_by(product_id=p["id"]).all()
            assert sum((i.received_quantity for i in items),Decimal(0))==committed
            assert all(i.received_quantity<=i.quantity for i in items)
        assert db.query(ProductBatch).count()==(expected_events if batch else 0)
