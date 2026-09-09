"""Phase 7 — one consistent expiry / FEFO eligibility model across operations.

Business date is injected via the ``business_date`` fixture (patches
``app.core.batch_eligibility.business_today``). Batches are created through
audited APIs with ``expiry_days`` relative to the real calendar day, then the
injected business date is moved to make a lot expired/eligible deterministically:

    expiry_days > offset   -> eligible
    expiry_days == offset   -> same-day, still usable
    expiry_days < offset   -> expired
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models import Product, ProductBatch, StockBalance, Warehouse
from app.repositories.stock_balance_repository import StockBalanceRepository
from scripts.check_inventory_consistency import diagnose_inventory

from tests import test_sales_order as sales
from tests.test_sales_order_fulfillment import action, advance, detail
from tests.test_stock import _create_product as _plain_product, _create_batch
from tests.test_inventory_transfer import (  # noqa: F401
    transfer_storage,
    _create_draft_transfer,
    _create_product as _transfer_product,
    _dispatch,
    _receive,
    _receive_lines,
    _stock_in,
)
from tests.test_phase6_transfer_lifecycle import _create_batch_transfer, _transit_storage
from tests.conftest import test_engine

REAL_TODAY = date.today()
OFFSET = 30
BUSINESS_TODAY = REAL_TODAY + timedelta(days=OFFSET)   # injected "today" for most tests


def _d(v) -> Decimal:
    return Decimal(str(v))


def _main_storage(db):
    w = db.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    loc = w.locations[0] if getattr(w, "locations", None) else None
    row = db.execute(text(
        "SELECT id FROM warehouse_locations WHERE warehouse_id = :w AND location_code = 'DEFAULT'"
    ), {"w": w.id}).scalar()
    return w.id, row


def _seed_batch_stock(db, product_id, *, quantity, expiry_date, lot=None):
    """Insert one batch + its MAIN/DEFAULT balance and keep Product.stock_qty (total
    owned) in step. Used only to construct NULL-expiry / expired fixtures the
    public batch API cannot express directly."""
    wh_id, loc_id = _main_storage(db)
    batch = ProductBatch(product_id=product_id, lot_no=lot or f"P7-{uuid4().hex[:10].upper()}",
                         mfg_date=None, expiry_date=expiry_date, quantity=_d(quantity))
    db.add(batch)
    db.flush()
    db.add(StockBalance(product_id=product_id, warehouse_id=wh_id, location_id=loc_id,
                        batch_id=batch.id, on_hand_qty=_d(quantity), reserved_qty=Decimal("0")))
    product = db.get(Product, product_id)
    product.stock_qty = (product.stock_qty or Decimal("0")) + _d(quantity)
    db.commit()
    return batch.id


def _batch_balance(db, batch_id):
    return db.query(StockBalance).filter_by(batch_id=batch_id).one()


# ========================================================================== #
# FEFO stock out
# ========================================================================== #
def test_fefo_selects_earliest_eligible_and_skips_expired(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    expired = _create_batch(client, admin_headers, product["id"], quantity=5, expiry_days=OFFSET - 1)
    early = _create_batch(client, admin_headers, product["id"], quantity=5, expiry_days=OFFSET + 10)
    late = _create_batch(client, admin_headers, product["id"], quantity=5, expiry_days=OFFSET + 200)

    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "4.000", "remark": "p7 fefo"})
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert _batch_balance(db_session, expired["id"]).on_hand_qty == Decimal("5.000")   # untouched
    assert _batch_balance(db_session, early["id"]).on_hand_qty == Decimal("1.000")     # earliest eligible drained
    assert _batch_balance(db_session, late["id"]).on_hand_qty == Decimal("5.000")
    types = [m["batch_id"] for m in client.get(
        f"/api/v1/inventory-movements/product/{product['id']}", headers=admin_headers).json()
        if m["movement_type"] == "STOCK_OUT_FEFO"]
    assert types == [early["id"]]


def test_fefo_all_expired_is_insufficient_with_no_mutation(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    expired = _create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=OFFSET - 5)

    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "5.000", "remark": "p7 fefo expired"})
    assert response.status_code == 409

    db_session.expire_all()
    assert _batch_balance(db_session, expired["id"]).on_hand_qty == Decimal("10.000")
    assert db_session.execute(text(
        "SELECT count(*) FROM stock_transactions WHERE product_id = :p AND transaction_type = 'OUT_FEFO'"
    ), {"p": product["id"]}).scalar() == 0
    assert db_session.execute(text(
        "SELECT count(*) FROM inventory_movements WHERE product_id = :p AND movement_type = 'STOCK_OUT_FEFO'"
    ), {"p": product["id"]}).scalar() == 0


def test_fefo_respects_reserved_quantity(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    batch = _create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=OFFSET + 60)
    _batch_balance(db_session, batch["id"]).reserved_qty = Decimal("6.000")
    db_session.commit()

    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "5.000", "remark": "p7 reserved"})
    assert response.status_code == 409

    db_session.expire_all()
    assert _batch_balance(db_session, batch["id"]).on_hand_qty == Decimal("10.000")


def test_fefo_null_expiry_ordered_after_dated(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    dated = _create_batch(client, admin_headers, product["id"], quantity=3, expiry_days=OFFSET + 100)
    undated = _seed_batch_stock(db_session, product["id"], quantity=3, expiry_date=None)

    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "4.000", "remark": "p7 null last"})
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert _batch_balance(db_session, dated["id"]).on_hand_qty == Decimal("0.000")   # dated consumed first
    assert _batch_balance(db_session, undated).on_hand_qty == Decimal("2.000")       # NULL expiry used last


def test_fefo_same_expiry_deterministic_tie_break(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    first = _create_batch(client, admin_headers, product["id"], quantity=2, expiry_days=OFFSET + 40)
    second = _create_batch(client, admin_headers, product["id"], quantity=2, expiry_days=OFFSET + 40)

    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "3.000", "remark": "p7 tie"})
    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert _batch_balance(db_session, first["id"]).on_hand_qty == Decimal("0.000")   # lower id / earlier created first
    assert _batch_balance(db_session, second["id"]).on_hand_qty == Decimal("1.000")


def test_fefo_excludes_transit_balances(client, admin_headers, db_session, business_date, transfer_storage):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=400)
    transfer = _create_batch_transfer(client, admin_headers, product["id"], batch["id"], transfer_storage, "6.000")
    _dispatch(client, admin_headers, transfer["id"])   # 6 units now in transit

    db_session.expire_all()
    # only the 4 operational units are FEFO-selectable
    response = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "5.000", "remark": "p7 transit"})
    assert response.status_code == 409
    ok = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                     json={"product_id": product["id"], "quantity": "4.000", "remark": "p7 transit ok"})
    assert ok.status_code == 200, ok.text


# ========================================================================== #
# FIFO stock out
# ========================================================================== #
def test_fifo_cannot_consume_expired_dated_batch(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    expired = _create_batch(client, admin_headers, product["id"], quantity=8, expiry_days=OFFSET - 3)   # created first
    fresh = _create_batch(client, admin_headers, product["id"], quantity=8, expiry_days=OFFSET + 90)

    response = client.post("/api/v1/stock/out-fifo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "5.000", "remark": "p7 fifo"})
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert _batch_balance(db_session, expired["id"]).on_hand_qty == Decimal("8.000")   # FIFO skipped the expired lot
    assert _batch_balance(db_session, fresh["id"]).on_hand_qty == Decimal("3.000")


def test_fifo_all_expired_is_insufficient(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    _create_batch(client, admin_headers, product["id"], quantity=6, expiry_days=OFFSET - 1)
    response = client.post("/api/v1/stock/out-fifo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "2.000", "remark": "p7 fifo expired"})
    assert response.status_code == 409
    assert db_session.execute(text(
        "SELECT count(*) FROM inventory_movements WHERE product_id = :p AND movement_type = 'STOCK_OUT_FIFO'"
    ), {"p": product["id"]}).scalar() == 0


def test_fifo_undated_batches_behaviour_preserved(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = _plain_product(client, admin_headers)
    first = _seed_batch_stock(db_session, product["id"], quantity=4, expiry_date=None, lot="P7-FIFO-A")
    second = _seed_batch_stock(db_session, product["id"], quantity=4, expiry_date=None, lot="P7-FIFO-B")

    response = client.post("/api/v1/stock/out-fifo", headers=admin_headers,
                           json={"product_id": product["id"], "quantity": "5.000", "remark": "p7 fifo undated"})
    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert _batch_balance(db_session, first).on_hand_qty == Decimal("0.000")
    assert _batch_balance(db_session, second).on_hand_qty == Decimal("3.000")


# ========================================================================== #
# Sales
# ========================================================================== #
def test_confirm_skips_expired_and_allocates_next_eligible(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = sales._create_product(client, admin_headers)
    sales._create_batch(client, admin_headers, product["id"], quantity=2, expiry_days=OFFSET - 2)   # expired
    eligible = sales._create_batch(client, admin_headers, product["id"], quantity=2, expiry_days=OFFSET + 30)
    customer = sales._create_customer(client, admin_headers)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=2, unit_price=1)

    assert action(client, admin_headers, order["sales_order_id"], "confirm").status_code == 200
    db_session.expire_all()
    allocation = db_session.execute(text(
        "SELECT batch_id FROM sales_order_batch_allocations WHERE sales_order_id = :o"
    ), {"o": order["sales_order_id"]}).scalar()
    assert allocation == eligible["id"]


def test_confirm_fails_when_only_expired_stock(client, admin_headers, db_session, business_date):
    business_date(BUSINESS_TODAY)
    product = sales._create_product(client, admin_headers)
    sales._create_batch(client, admin_headers, product["id"], quantity=5, expiry_days=OFFSET - 1)
    customer = sales._create_customer(client, admin_headers)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=1, unit_price=1)

    assert action(client, admin_headers, order["sales_order_id"], "confirm").status_code == 409
    assert detail(client, admin_headers, order["sales_order_id"])["status"] == "DRAFT"
    db_session.expire_all()
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).first().reserved_qty == 0


def test_expiry_during_fulfilment_blocks_only_shipment(client, admin_headers, db_session, business_date):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=2, expiry_days=45)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"],
                                         quantity=2, unit_price=1)["sales_order_id"]
    advance(client, admin_headers, order_id, "READY_TO_SHIP")   # confirmed + picked + packed while eligible

    business_date(REAL_TODAY + timedelta(days=60))              # batch now expired mid-fulfilment
    ship = action(client, admin_headers, order_id, "ship")
    assert ship.status_code == 409

    db_session.expire_all()
    assert detail(client, admin_headers, order_id)["status"] == "READY_TO_SHIP"
    balance = db_session.query(StockBalance).filter_by(product_id=product["id"], batch_id=batch["id"]).one()
    assert balance.on_hand_qty == Decimal("2.000") and balance.reserved_qty == Decimal("2.000")
    allocation = db_session.execute(text(
        "SELECT batch_id, picked_quantity, packed_quantity FROM sales_order_batch_allocations WHERE sales_order_id = :o"
    ), {"o": order_id}).one()
    assert tuple(allocation) == (batch["id"], Decimal("2.000"), Decimal("2.000"))   # no silent reallocation
    assert db_session.execute(text(
        "SELECT count(*) FROM inventory_movements WHERE reference_type = 'SALES_ORDER' AND reference_id = :o"
    ), {"o": order_id}).scalar() == 0

    # operational recovery path: cancel releases the reservation
    assert action(client, admin_headers, order_id, "cancel").status_code == 200
    db_session.expire_all()
    assert db_session.query(StockBalance).filter_by(product_id=product["id"], batch_id=batch["id"]).one().reserved_qty == 0


def test_same_day_expiry_ships(client, admin_headers, business_date):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    sales._create_batch(client, admin_headers, product["id"], quantity=1, expiry_days=10)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"],
                                         quantity=1, unit_price=1)["sales_order_id"]
    advance(client, admin_headers, order_id, "READY_TO_SHIP")
    business_date(REAL_TODAY + timedelta(days=10))   # expiry_date == business_today() -> still usable
    assert action(client, admin_headers, order_id, "ship").status_code == 200


# ========================================================================== #
# PO receiving
# ========================================================================== #
def _po_receive(client, admin_headers, product_id, *, lot_no, quantity, mfg_date=None, expiry_date=None, expect=200):
    supplier = client.post("/api/v1/suppliers", headers=admin_headers,
                           json={"supplier_name": f"S-{uuid4().hex[:8]}"}).json()["data"]
    order = client.post("/api/v1/purchase-orders", headers=admin_headers, json={
        "supplier_id": supplier["id"],
        "items": [{"product_id": product_id, "quantity": str(quantity), "unit_price": 1}],
    }).json()["data"]
    client.post(f"/api/v1/purchase-orders/{order['id']}/confirm", headers=admin_headers)
    item = {"product_id": product_id, "quantity": str(quantity), "lot_no": lot_no}
    if mfg_date is not None:
        item["mfg_date"] = mfg_date.isoformat()
    if expiry_date is not None:
        item["expiry_date"] = expiry_date.isoformat()
    response = client.post(f"/api/v1/purchase-orders/{order['id']}/receive",
                           headers={**admin_headers, "Idempotency-Key": uuid4().hex},
                           json={"items": [item]})
    assert response.status_code == expect, response.text
    return order, response


def test_po_receiving_accepts_already_expired_but_it_is_operationally_ineligible(
    client, admin_headers, db_session, business_date
):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)   # track_batch + track_expiry
    _po_receive(client, admin_headers, product["id"], lot_no="P7-EXPIRED-IN", quantity="5.000",
                mfg_date=REAL_TODAY - timedelta(days=20), expiry_date=REAL_TODAY - timedelta(days=5))

    db_session.expire_all()
    product_row = db_session.get(Product, product["id"])
    assert product_row.stock_qty == Decimal("5.000")   # owned inventory recorded
    assert StockBalanceRepository(db_session).operational_available_quantity(
        product["id"], REAL_TODAY
    ) == Decimal("0.000")                               # but not sellable

    # a fresh order for this product cannot be confirmed off the expired lot
    customer = sales._create_customer(client, admin_headers)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=1, unit_price=1)
    assert action(client, admin_headers, order["sales_order_id"], "confirm").status_code == 409


def test_po_receiving_same_day_expiry_is_eligible(client, admin_headers, db_session, business_date):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    _po_receive(client, admin_headers, product["id"], lot_no="P7-SAMEDAY-IN", quantity="3.000",
                mfg_date=REAL_TODAY - timedelta(days=10), expiry_date=REAL_TODAY)
    db_session.expire_all()
    assert StockBalanceRepository(db_session).operational_available_quantity(
        product["id"], REAL_TODAY
    ) == Decimal("3.000")


@pytest.mark.parametrize("mfg_offset,exp_offset,expect", [
    (-10, -10, 400),   # expiry == mfg  -> "Expiry date must be after manufacturing date"
    (-5, -10, 400),    # expiry < mfg
    (-10, -5, 200),    # expiry > mfg (still past today, allowed)
])
def test_po_receiving_mfg_expiry_relationship(client, admin_headers, business_date, mfg_offset, exp_offset, expect):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    _po_receive(client, admin_headers, product["id"], lot_no=f"P7-REL-{uuid4().hex[:6]}", quantity="1.000",
                mfg_date=REAL_TODAY + timedelta(days=mfg_offset),
                expiry_date=REAL_TODAY + timedelta(days=exp_offset), expect=expect)


def test_po_receiving_idempotency_replay_unaffected_by_expiry(client, admin_headers, db_session, business_date):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    supplier = client.post("/api/v1/suppliers", headers=admin_headers,
                           json={"supplier_name": f"S-{uuid4().hex[:8]}"}).json()["data"]
    order = client.post("/api/v1/purchase-orders", headers=admin_headers, json={
        "supplier_id": supplier["id"], "items": [{"product_id": product["id"], "quantity": "4.000", "unit_price": 1}],
    }).json()["data"]
    client.post(f"/api/v1/purchase-orders/{order['id']}/confirm", headers=admin_headers)
    payload = {"items": [{"product_id": product["id"], "quantity": "4.000", "lot_no": "P7-IDEM",
                          "mfg_date": (REAL_TODAY - timedelta(days=10)).isoformat(),
                          "expiry_date": (REAL_TODAY - timedelta(days=1)).isoformat()}]}
    key = uuid4().hex
    first = client.post(f"/api/v1/purchase-orders/{order['id']}/receive",
                        headers={**admin_headers, "Idempotency-Key": key}, json=payload)
    second = client.post(f"/api/v1/purchase-orders/{order['id']}/receive",
                         headers={**admin_headers, "Idempotency-Key": key}, json=payload)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json() == second.json()
    db_session.expire_all()
    assert db_session.execute(text(
        "SELECT count(*) FROM inventory_movements WHERE product_id = :p AND movement_type = 'PURCHASE_RECEIPT'"
    ), {"p": product["id"]}).scalar() == 1


# ========================================================================== #
# Returns
# ========================================================================== #
def test_expired_return_is_accepted_and_restored_but_not_sellable(client, admin_headers, db_session, business_date):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=3, expiry_days=40)
    customer = sales._create_customer(client, admin_headers)
    order_id = sales._create_sales_order(client, admin_headers, customer["id"], product["id"],
                                         quantity=2, unit_price=1)["sales_order_id"]
    advance(client, admin_headers, order_id, "SHIPPED")

    db_session.expire_all()
    shipped_on_hand = db_session.query(StockBalance).filter_by(
        product_id=product["id"], batch_id=batch["id"]).one().on_hand_qty
    assert shipped_on_hand == Decimal("1.000")

    business_date(REAL_TODAY + timedelta(days=90))   # the batch expired since shipment
    resp = action(client, admin_headers, order_id, "return",
                  {"items": [{"product_id": product["id"], "quantity": "2.000", "reason": "expired return"}]})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    restored = db_session.query(StockBalance).filter_by(product_id=product["id"], batch_id=batch["id"]).one()
    assert restored.on_hand_qty == Decimal("3.000")   # physical inventory restored exactly
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("3.000")   # owned total
    assert StockBalanceRepository(db_session).operational_available_quantity(
        product["id"], REAL_TODAY + timedelta(days=90)
    ) == Decimal("0.000")                              # restored expired stock is not sellable

    other = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity=1, unit_price=1)
    assert action(client, admin_headers, other["sales_order_id"], "confirm").status_code == 409


# ========================================================================== #
# Transfers
# ========================================================================== #
def test_transfer_dispatch_rejects_expired_batch(client, admin_headers, db_session, business_date, transfer_storage):
    business_date(BUSINESS_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=OFFSET - 2)
    transfer = _create_batch_transfer(client, admin_headers, product["id"], batch["id"], transfer_storage, "4.000")

    resp = client.post(f"/api/v1/inventory-transfers/{transfer['id']}/dispatch", headers=admin_headers)
    assert resp.status_code == 409
    assert "expired" in resp.json()["message"].lower()

    db_session.expire_all()
    assert db_session.execute(text(
        "SELECT count(*) FROM inventory_movements WHERE reference_type = 'INVENTORY_TRANSFER' AND reference_id = :t"
    ), {"t": transfer["id"]}).scalar() == 0
    assert client.get(f"/api/v1/inventory-transfers/{transfer['id']}", headers=admin_headers).json()["status"] == "DRAFT"


def test_transfer_dispatch_same_day_expiry_allowed(client, admin_headers, business_date, transfer_storage):
    business_date(BUSINESS_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=5, expiry_days=OFFSET)
    transfer = _create_batch_transfer(client, admin_headers, product["id"], batch["id"], transfer_storage, "2.000")
    assert client.post(f"/api/v1/inventory-transfers/{transfer['id']}/dispatch",
                       headers=admin_headers).status_code == 200


def test_batch_expiring_in_transit_still_receives_and_conserves_stock(
    client, admin_headers, db_session, business_date, transfer_storage
):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    batch = sales._create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=40)
    transfer = _create_batch_transfer(client, admin_headers, product["id"], batch["id"], transfer_storage, "6.000")
    _dispatch(client, admin_headers, transfer["id"])

    owned_before = db_session.get(Product, product["id"]).stock_qty
    business_date(REAL_TODAY + timedelta(days=90))   # expired while IN_TRANSIT

    receipt = client.post(f"/api/v1/inventory-transfers/{transfer['id']}/receive",
                          headers={**admin_headers, "Idempotency-Key": uuid4().hex},
                          json={"items": [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "6.000"}]})
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["transfer"]["status"] == "COMPLETED"

    db_session.expire_all()
    transit_wh, transit_loc = _transit_storage(db_session)
    transit_bal = db_session.query(StockBalance).filter_by(
        product_id=product["id"], warehouse_id=transit_wh.id, batch_id=batch["id"]).one()
    dest_bal = db_session.query(StockBalance).filter_by(
        product_id=product["id"], warehouse_id=transfer_storage["destination_warehouse_id"], batch_id=batch["id"]).one()
    assert transit_bal.on_hand_qty == Decimal("0.000")           # not stranded in transit
    assert dest_bal.on_hand_qty == Decimal("6.000")              # same batch identity at destination
    assert db_session.get(Product, product["id"]).stock_qty == owned_before   # global owned conserved
    # destination-held expired stock is owned but not operationally eligible
    assert StockBalanceRepository(db_session).operational_available_quantity(
        product["id"], REAL_TODAY + timedelta(days=90)
    ) == Decimal("0.000")


# ========================================================================== #
# Operational availability
# ========================================================================== #
def test_operational_available_excludes_expired_transit_and_reservations(
    client, admin_headers, db_session, business_date, transfer_storage
):
    business_date(REAL_TODAY)
    product = sales._create_product(client, admin_headers)
    eligible = sales._create_batch(client, admin_headers, product["id"], quantity=10, expiry_days=400)
    _seed_batch_stock(db_session, product["id"], quantity=5, expiry_date=REAL_TODAY - timedelta(days=1), lot="P7-AVAIL-EXP")

    _batch_balance(db_session, eligible["id"]).reserved_qty = Decimal("2.000")
    db_session.commit()

    transfer = _create_batch_transfer(client, admin_headers, product["id"], eligible["id"], transfer_storage, "3.000")
    _dispatch(client, admin_headers, transfer["id"])   # 3 of the eligible units -> transit

    db_session.expire_all()
    repo = StockBalanceRepository(db_session)
    # eligible on_hand now 7 (10-3 dispatched), minus 2 reserved = 5
    assert repo.operational_available_quantity(product["id"], REAL_TODAY) == Decimal("5.000")
    # Phase 2 global aggregate unchanged: 7 operational-eligible + 5 expired + 3 transit
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("15.000")
    assert repo.operational_available_by_product(REAL_TODAY)[product["id"]] == Decimal("5.000")


# ========================================================================== #
# Diagnostics
# ========================================================================== #
def test_diagnostic_reports_owned_eligible_expired_and_transit(
    client, admin_headers, db_session, business_date, transfer_storage
):
    today = REAL_TODAY
    business_date(today)
    product = sales._create_product(client, admin_headers)
    eligible = sales._create_batch(client, admin_headers, product["id"], quantity=12, expiry_days=400)
    _seed_batch_stock(db_session, product["id"], quantity=4, expiry_date=today - timedelta(days=2), lot="P7-DIAG-EXP")
    transfer = _create_batch_transfer(client, admin_headers, product["id"], eligible["id"], transfer_storage, "5.000")
    _dispatch(client, admin_headers, transfer["id"])

    findings = diagnose_inventory(test_engine, today=today)

    def one(check):
        rows = [f for f in findings if f["check"] == check and f.get("product_id") == product["id"]]
        assert len(rows) == 1, (check, rows)
        return rows[0]

    expired = one("expired_owned_quantity")
    assert expired["expired_owned"] == Decimal("4.000")
    assert expired["in_transit"] == Decimal("5.000")

    eligible_row = one("operationally_eligible_quantity")
    assert eligible_row["eligible_on_hand"] == Decimal("7.000")   # 12 - 5 dispatched
    assert eligible_row["eligible_available"] == Decimal("7.000")

    assert one("owned_partition_reconciliation")["classification"] == "CONSISTENT"
    assert one("owned_aggregate_matches_balances")["classification"] == "CONSISTENT"
    # no Phase 7 check flags a defect on this clean lifecycle
    assert all(f["classification"] != "UNRESOLVED"
               for f in findings
               if f["check"].startswith(("expired_", "operationally_", "owned_"))
               and f.get("product_id") == product["id"])
