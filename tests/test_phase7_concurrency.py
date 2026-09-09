"""Phase 7 expiry / FEFO eligibility under real overlapping PostgreSQL requests.

Reuses the isolated-schema concurrency harness (``concurrent_inventory`` +
``overlap``). Business dates are injected by patching
``app.core.batch_eligibility.business_today`` — the system clock is never touched.
Every existing Phase 3–6 race is expected to stay green (run separately).
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

import app.core.batch_eligibility as be
from app.models import (
    InventoryMovement,
    ProductBatch,
    SalesOrder,
    SalesOrderBatchAllocation,
    StockBalance,
    StockTransaction,
)
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401
from tests.test_stock import _create_product, _create_batch
from tests import test_sales_order as sales

REAL_TODAY = date.today()
OFFSET = 30
BUSINESS_TODAY = REAL_TODAY + timedelta(days=OFFSET)


@pytest.fixture
def business_date(monkeypatch):
    state = {"today": BUSINESS_TODAY}
    monkeypatch.setattr(be, "business_today", lambda: state["today"])

    def _set(value):
        state["today"] = value
        return value

    return _set


def _fefo_req(product_id, quantity):
    return ("POST", "/api/v1/stock/out-fefo", {"product_id": product_id, "quantity": quantity, "remark": "p7c"})


def _fifo_req(product_id, quantity):
    return ("POST", "/api/v1/stock/out-fifo", {"product_id": product_id, "quantity": quantity, "remark": "p7c"})


# --------------------------------------------------------------------------- #
# FEFO / FIFO deduction races
# --------------------------------------------------------------------------- #
def test_two_fefo_deductions_compete_for_last_eligible_unit(concurrent_inventory, business_date):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=OFFSET - 1)   # expired
    _create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=OFFSET + 90)  # only eligible unit

    req = _fefo_req(product["id"], "0.750")
    responses = overlap(s, [req, req], "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]

    with s.sessions() as db:
        balances = {b.batch_id: b for b in db.query(StockBalance).all()}
        eligible = db.query(ProductBatch).order_by(ProductBatch.id.desc()).first()
        assert balances[eligible.id].on_hand_qty == Decimal("0.250")   # one deduction only
        expired = db.query(ProductBatch).order_by(ProductBatch.id.asc()).first()
        assert balances[expired.id].on_hand_qty == Decimal("1.000")    # never touched
        assert db.query(InventoryMovement).filter_by(movement_type="STOCK_OUT_FEFO").count() == 1
        assert db.query(StockTransaction).filter_by(transaction_type="OUT_FEFO").count() == 1


def test_fifo_and_fefo_race_never_consume_expired(concurrent_inventory, business_date):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _create_batch(s.client, s.headers, product["id"], quantity="2.000", expiry_days=OFFSET - 2)   # expired, created first
    _create_batch(s.client, s.headers, product["id"], quantity="2.000", expiry_days=OFFSET + 120)

    responses = overlap(s, [_fifo_req(product["id"], "1.500"), _fefo_req(product["id"], "1.500")],
                        "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]

    with s.sessions() as db:
        expired = db.query(ProductBatch).order_by(ProductBatch.id.asc()).first()
        expired_balance = db.query(StockBalance).filter_by(batch_id=expired.id).one()
        assert expired_balance.on_hand_qty == Decimal("2.000")   # untouched by whichever won
        eligible = db.query(ProductBatch).order_by(ProductBatch.id.desc()).first()
        assert db.query(StockBalance).filter_by(batch_id=eligible.id).one().on_hand_qty == Decimal("0.500")
        assert db.query(InventoryMovement).filter(InventoryMovement.quantity < 0).count() == 1


# --------------------------------------------------------------------------- #
# Sales
# --------------------------------------------------------------------------- #
def test_confirm_versus_stock_change_skips_expired(concurrent_inventory, business_date):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers)
    sales._create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=OFFSET - 1)   # expired
    sales._create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=OFFSET + 60)  # eligible
    customer = sales._create_customer(s.client, s.headers)
    orders = [sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="0.750", unit_price=1)
              for _ in range(2)]
    requests = [("POST", f"/api/v1/sales-orders/{o['sales_order_id']}/confirm", None) for o in orders]

    responses = overlap(s, requests, "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]

    with s.sessions() as db:
        eligible_batch = db.query(ProductBatch).order_by(ProductBatch.id.desc()).first()
        expired_batch = db.query(ProductBatch).order_by(ProductBatch.id.asc()).first()
        allocations = db.query(SalesOrderBatchAllocation).all()
        assert len(allocations) == 1
        assert allocations[0].batch_id == eligible_batch.id
        eligible_bal = db.query(StockBalance).filter_by(batch_id=eligible_batch.id).one()
        expired_bal = db.query(StockBalance).filter_by(batch_id=expired_batch.id).one()
        assert eligible_bal.reserved_qty == Decimal("0.750")
        assert expired_bal.reserved_qty == Decimal("0.000")
        assert db.query(SalesOrder).filter_by(status="CONFIRMED").count() == 1


@pytest.mark.parametrize("ship_offset,ship_ok", [(10, True), (60, False)])
def test_shipment_boundary_versus_cancellation(concurrent_inventory, business_date, ship_offset, ship_ok):
    s = concurrent_inventory
    business_date(REAL_TODAY)                                   # eligible while the order is built
    product = sales._create_product(s.client, s.headers)
    batch = sales._create_batch(s.client, s.headers, product["id"], quantity="1.000", expiry_days=10)
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="0.750", unit_price=1)
    order_id = order["sales_order_id"]
    sales._confirm_sales_order(s.client, s.headers, order_id)
    sales._ready_sales_order(s.client, s.headers, order_id)
    # ship_offset == 10 -> expiry_date == business_today() (same-day, usable); 60 -> expired
    business_date(REAL_TODAY + timedelta(days=ship_offset))

    responses = overlap(s, [
        ("POST", f"/api/v1/sales-orders/{order_id}/ship", None),
        ("PUT", f"/api/v1/sales-orders/{order_id}/cancel", None),
    ], "sales_orders", [order_id])
    codes = sorted(r.status_code for r in responses)

    with s.sessions() as db:
        status = db.get(SalesOrder, order_id).status
        balance = db.query(StockBalance).filter_by(batch_id=batch["id"]).one()
        assert balance.reserved_qty == 0
        if ship_ok:
            # same-day expiry: ship may win or lose the race to cancel, but never a silent third state
            assert codes in ([200, 409], [200, 200])
            assert status in {"SHIPPED", "CANCELLED"}
        else:
            # expired: ship can never succeed
            assert status == "CANCELLED"
            assert db.query(InventoryMovement).filter(InventoryMovement.quantity < 0).count() == 0
        assert balance.on_hand_qty == (Decimal("0.250") if status == "SHIPPED" else Decimal("1.000"))


# --------------------------------------------------------------------------- #
# Transfers
# --------------------------------------------------------------------------- #
def test_transfer_dispatch_of_expired_batch_races_are_all_rejected(concurrent_inventory, business_date):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers)
    batch = sales._create_batch(s.client, s.headers, product["id"], quantity="4.000", expiry_days=OFFSET - 2)

    def make():
        r = s.client.post("/api/v1/inventory-transfers", json={
            "source_warehouse_id": s.storage["source_warehouse_id"],
            "destination_warehouse_id": s.storage["destination_warehouse_id"],
            "items": [{"product_id": product["id"], "batch_id": batch["id"],
                       "from_location_id": s.storage["source_location_id"],
                       "to_location_id": s.storage["destination_location_id"], "quantity": "1.000"}],
        })
        assert r.status_code == 201, r.text
        return r.json()

    a, b = make(), make()
    responses = overlap(s, [
        ("POST", f"/api/v1/inventory-transfers/{a['id']}/dispatch", None),
        ("POST", f"/api/v1/inventory-transfers/{b['id']}/dispatch", None),
    ], "products", [product["id"]])
    assert [r.status_code for r in responses] == [409, 409]

    with s.sessions() as db:
        assert db.query(InventoryMovement).filter_by(reference_type="INVENTORY_TRANSFER").count() == 0
        assert db.query(StockBalance).filter_by(batch_id=batch["id"]).one().on_hand_qty == Decimal("4.000")


# --------------------------------------------------------------------------- #
# Return vs allocation
# --------------------------------------------------------------------------- #
def test_return_versus_allocation_on_expired_batch(concurrent_inventory, business_date):
    s = concurrent_inventory
    product = sales._create_product(s.client, s.headers)
    batch = sales._create_batch(s.client, s.headers, product["id"], quantity="2.000", expiry_days=OFFSET + 10)
    customer = sales._create_customer(s.client, s.headers)

    shipped = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="1.000", unit_price=1)
    shipped_id = shipped["sales_order_id"]
    sales._confirm_sales_order(s.client, s.headers, shipped_id)
    sales._ready_sales_order(s.client, s.headers, shipped_id)
    sales._ship_sales_order(s.client, s.headers, shipped_id)

    business_date(BUSINESS_TODAY + timedelta(days=365))   # batch expired after shipment

    pending = sales._create_sales_order(s.client, s.headers, customer["id"], product["id"], quantity="0.500", unit_price=1)
    requests = [
        ("POST", f"/api/v1/sales-orders/{shipped_id}/return",
         {"items": [{"product_id": product["id"], "quantity": "1.000", "reason": "expired return"}]}),
        ("POST", f"/api/v1/sales-orders/{pending['sales_order_id']}/confirm", None),
    ]
    responses = overlap(s, requests, "products", [product["id"]])
    return_code, confirm_code = responses[0].status_code, responses[1].status_code

    assert return_code == 200                     # physical return always accepted
    assert confirm_code == 409                    # cannot allocate the now-expired lot
    with s.sessions() as db:
        balance = db.query(StockBalance).filter_by(batch_id=batch["id"]).one()
        assert balance.on_hand_qty == Decimal("2.000")   # 1 remained + 1 restored
        assert balance.reserved_qty == Decimal("0.000")
        assert db.query(SalesOrderBatchAllocation).filter_by(
            sales_order_id=pending["sales_order_id"]).count() == 0
