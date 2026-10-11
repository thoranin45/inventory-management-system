"""Phase 14D -- batch-level stock adjustment requests and approvals.

The exact balance key is (product_id, warehouse_id, location_id, batch_id):
never another batch, location, the unbatched row or an aggregate. Expiry
rules use the frozen Bangkok business date (``business_date`` fixture).
"""
import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import (
    AuditLog,
    InventoryMovement,
    Product,
    ProductBatch,
    SalesOrderBatchAllocation,
    StockAdjustmentRequest,
    StockBalance,
    StockTransaction,
    Warehouse,
    WarehouseLocation,
)
from scripts.check_inventory_consistency import diagnose_inventory
from tests import test_sales_order as sales
from tests.conftest import test_engine
from tests.test_inventory_authority import assert_aggregates
from tests.test_inventory_transfer import (  # noqa: F401
    _create_draft_transfer,
    _dispatch,
    _receive,
    _receive_lines,
    transfer_storage,
)
from tests.test_phase14c_adjustment_privacy import _headers, _mint
from tests.test_phase6_transfer_lifecycle import transit_ids  # noqa: F401
from tests.test_stock import _create_product, _make_product
from tests.test_stock_adjustment_requests import _approve, _create_request, _key

TODAY = date(2026, 6, 15)
REASONS = ("DAMAGE", "LOSS_THEFT", "EXPIRY_WRITE_OFF", "CYCLE_COUNT_VARIANCE", "SYSTEM_ERROR_CORRECTION", "OTHER")


@pytest.fixture(autouse=True)
def frozen_business_day(business_date):
    business_date(TODAY)
    return TODAY


def _main(db):
    warehouse = db.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    location = db.query(WarehouseLocation).filter_by(warehouse_id=warehouse.id, location_code="DEFAULT").one()
    return warehouse, location


def _lot_product(client, admin_headers):
    return _make_product(client, admin_headers, track_batch=True, track_expiry=True)


def _batch_in(client, admin_headers, product_id, quantity="10.000", *, expiry=TODAY + timedelta(days=60),
              lot=None, warehouse_id=None, location_id=None):
    body = {"product_id": product_id, "lot_no": lot or f"L-{uuid4().hex[:8]}", "quantity": quantity,
            "mfg_date": date(2026, 1, 1).isoformat(), "expiry_date": expiry.isoformat()}
    if warehouse_id is not None:
        body.update(warehouse_id=warehouse_id, location_id=location_id)
    response = client.post("/api/v1/batches", headers=admin_headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()["data"]["batch"]


def _batch_request(client, headers, db, *, product_id, batch_id, observed, requested, reason="CYCLE_COUNT_VARIANCE",
                   notes=None, warehouse_id=None, location_id=None, key=None):
    if warehouse_id is None:
        warehouse, location = _main(db)
        warehouse_id, location_id = warehouse.id, location.id
    return _create_request(client, headers, product_id=product_id, observed=observed, requested=requested,
                           reason_code=reason, notes=notes or ("note" if reason == "OTHER" else None),
                           key=key, batch_id=batch_id, warehouse_id=warehouse_id, location_id=location_id)


def _balance(db, product_id, batch_id, warehouse_id=None, location_id=None):
    if warehouse_id is None:
        warehouse, location = _main(db)
        warehouse_id, location_id = warehouse.id, location.id
    db.expire_all()
    return db.query(StockBalance).filter_by(product_id=product_id, batch_id=batch_id, warehouse_id=warehouse_id,
                                           location_id=location_id).one_or_none()


# --------------------------------------------------------------------------- #
# D1 / D8 -- batch identity
# --------------------------------------------------------------------------- #
def test_batch_product_requires_batch_and_non_batch_forbids_it(client, admin_headers, warehouse_headers, db_session):
    lot_product = _lot_product(client, admin_headers)
    missing = _create_request(client, warehouse_headers, product_id=lot_product["id"], observed="0.000",
                              requested="1.000")
    assert (missing.status_code, missing.json()["message"]) == (422, "batch_id is required for a batch-tracked product")

    plain = _create_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, lot_product["id"])
    forbidden = _batch_request(client, warehouse_headers, db_session, product_id=plain["id"], batch_id=batch["id"],
                               observed="0.000", requested="1.000")
    assert forbidden.status_code == 422
    assert forbidden.json()["message"] == "batch_id must be omitted for a product that is not batch-tracked"

    # Legacy: omitted and explicit null are both still the non-batch path.
    for extra in ({}, {"batch_id": None}):
        ok = _create_request(client, warehouse_headers, product_id=plain["id"], observed="0.000",
                             requested="1.000", **extra)
        assert ok.status_code == 201, ok.text
        assert ok.json()["data"]["batch"] is None


def test_missing_and_foreign_batches_answer_identically(client, admin_headers, warehouse_headers, db_session):
    mine = _lot_product(client, admin_headers)
    theirs = _lot_product(client, admin_headers)
    foreign = _batch_in(client, admin_headers, theirs["id"])
    answers = []
    for batch_id in (foreign["id"], 999_999_999):
        response = _batch_request(client, warehouse_headers, db_session, product_id=mine["id"], batch_id=batch_id,
                                  observed="0.000", requested="1.000")
        answers.append((response.status_code, response.json()["message"]))
    assert answers == [(404, "Batch not found")] * 2  # never reveals which batch exists


# --------------------------------------------------------------------------- #
# D2 / D3 -- exact balance only
# --------------------------------------------------------------------------- #
def test_absent_exact_balance_is_rejected_and_nothing_falls_back(client, admin_headers, warehouse_headers,
                                                                 db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"])  # lives at MAIN/DEFAULT only
    warehouse, _ = _main(db_session)
    empty = WarehouseLocation(warehouse_id=warehouse.id, location_code=f"E-{uuid4().hex[:6]}", location_name="Empty")
    db_session.add(empty)
    db_session.commit()

    response = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                              observed="0.000", requested="1.000", warehouse_id=warehouse.id, location_id=empty.id)
    assert response.status_code == 409
    assert response.json()["message"].startswith("No stock balance exists for this batch")
    assert _balance(db_session, product["id"], batch["id"], warehouse.id, empty.id) is None  # never created
    assert db_session.query(StockAdjustmentRequest).filter_by(product_id=product["id"]).count() == 0


def test_inactive_and_transit_storage_are_rejected(client, admin_headers, warehouse_headers, db_session,
                                                    transit_ids):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"])
    warehouse, _ = _main(db_session)
    closed = WarehouseLocation(warehouse_id=warehouse.id, location_code=f"X-{uuid4().hex[:6]}", is_active=False)
    db_session.add(closed)
    db_session.commit()
    inactive = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                              observed="0.000", requested="1.000", warehouse_id=warehouse.id, location_id=closed.id)
    assert inactive.status_code == 404
    transit = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="0.000", requested="1.000", warehouse_id=transit_ids["warehouse_id"],
                             location_id=transit_ids["location_id"])
    assert transit.status_code == 409


def test_existing_zero_balance_may_be_corrected_upward(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "2.000")
    out = client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                      json={"product_id": product["id"], "quantity": "2.000"})
    assert out.status_code == 200, out.text
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("0.000")

    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="0.000", requested="3.000")
    assert created.status_code == 201, created.text
    assert _approve(client, admin_headers, created.json()["data"]["id"]).status_code == 200
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("3.000")
    assert_aggregates(db_session, product["id"])


def test_only_the_exact_location_of_a_multi_location_lot_changes(client, admin_headers, warehouse_headers,
                                                                 transfer_storage, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    transfer = client.post("/api/v1/inventory-transfers", headers=admin_headers, json={
        "source_warehouse_id": transfer_storage["source_warehouse_id"],
        "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
        "items": [{"product_id": product["id"], "batch_id": batch["id"], "quantity": "4.000",
                   "from_location_id": transfer_storage["source_location_id"],
                   "to_location_id": transfer_storage["destination_location_id"]}],
    })
    assert transfer.status_code in (200, 201), transfer.text
    transfer = transfer.json()  # transfers use the bare (non-envelope) response
    _dispatch(client, admin_headers, transfer["id"])
    _receive(client, admin_headers, transfer["id"], _receive_lines(transfer))

    dest = (transfer_storage["destination_warehouse_id"], transfer_storage["destination_location_id"])
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="4.000", requested="1.000", reason="DAMAGE",
                             warehouse_id=dest[0], location_id=dest[1]).json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200
    assert _balance(db_session, product["id"], batch["id"], *dest).on_hand_qty == Decimal("1.000")
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("6.000")  # source untouched
    movement = db_session.query(InventoryMovement).filter_by(reference_type="STOCK_ADJUSTMENT_REQUEST",
                                                             reference_id=created["id"]).one()
    assert (movement.warehouse_id, movement.location_id, movement.batch_id) == (*dest, batch["id"])
    assert_aggregates(db_session, product["id"])


# --------------------------------------------------------------------------- #
# D4 / D5 / B1 -- reason x direction matrix
# --------------------------------------------------------------------------- #
DIRECTIONS = {"up": "13.000", "down": "7.000", "zero": "10.000"}
BATCH_ALLOWED = {
    ("DAMAGE", "down"), ("LOSS_THEFT", "down"), ("EXPIRY_WRITE_OFF", "down"),
    *{(reason, d) for reason in ("CYCLE_COUNT_VARIANCE", "SYSTEM_ERROR_CORRECTION", "OTHER") for d in DIRECTIONS},
}


@pytest.mark.parametrize("reason", REASONS)
@pytest.mark.parametrize("direction", list(DIRECTIONS))
def test_batch_reason_direction_matrix(client, admin_headers, warehouse_headers, db_session, reason, direction):
    product = _lot_product(client, admin_headers)
    expiry = TODAY - timedelta(days=1) if reason == "EXPIRY_WRITE_OFF" else TODAY + timedelta(days=60)
    batch = _batch_in(client, admin_headers, product["id"], "10.000", expiry=expiry)
    response = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                              observed="10.000", requested=DIRECTIONS[direction], reason=reason)
    if (reason, direction) not in BATCH_ALLOWED:
        assert response.status_code == 422, response.text
        assert "must reduce the quantity" in response.json()["message"]
        return
    assert response.status_code == 201, response.text
    approved = _approve(client, admin_headers, response.json()["data"]["id"])
    assert approved.status_code == 200, approved.text
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal(DIRECTIONS[direction])
    assert_aggregates(db_session, product["id"])


@pytest.mark.parametrize("reason", [r for r in REASONS if r != "EXPIRY_WRITE_OFF"])
@pytest.mark.parametrize("direction", list(DIRECTIONS))
def test_non_batch_reason_behavior_is_unchanged(client, admin_headers, warehouse_headers, reason, direction):
    """B1: batch-only direction rules never reach non-batch requests
    (e.g. a DAMAGE increase stays valid, as in Phase 14B/14C)."""
    product = _create_product(client, admin_headers, initial_stock=10)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000",
                               requested=DIRECTIONS[direction], reason_code=reason,
                               notes="note" if reason == "OTHER" else None)
    assert response.status_code == 201, response.text
    assert _approve(client, admin_headers, response.json()["data"]["id"]).status_code == 200


def test_non_batch_expiry_write_off_still_needs_a_batch(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers, initial_stock=10)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000",
                               requested="0.000", reason_code="EXPIRY_WRITE_OFF")
    assert response.status_code == 422


def test_other_requires_notes_for_batch_requests(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"])
    warehouse, location = _main(db_session)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000",
                               requested="9.000", reason_code="OTHER", batch_id=batch["id"],
                               warehouse_id=warehouse.id, location_id=location.id)
    assert response.status_code == 422


@pytest.mark.parametrize("offset, allowed", [(-1, True), (0, False), (1, False)])
def test_expiry_write_off_needs_expiry_strictly_before_business_day(client, admin_headers, warehouse_headers,
                                                                    db_session, offset, allowed):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], expiry=TODAY + timedelta(days=offset))
    response = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                              observed="10.000", requested="0.000", reason="EXPIRY_WRITE_OFF")
    if allowed:
        assert response.status_code == 201, response.text
        assert _approve(client, admin_headers, response.json()["data"]["id"]).status_code == 200
        assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("0.000")
    else:
        assert response.status_code == 422
        assert "expiry date is before today's business date" in response.json()["message"]


def test_expiry_write_off_is_revalidated_at_approval(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], expiry=TODAY - timedelta(days=1))
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="0.000", reason="EXPIRY_WRITE_OFF").json()["data"]
    row = db_session.get(ProductBatch, batch["id"])
    row.expiry_date = TODAY  # corrected after the request: no longer expired
    db_session.commit()
    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 409
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("10.000")
    assert db_session.get(StockAdjustmentRequest, created["id"]).status == "PENDING"


# --------------------------------------------------------------------------- #
# D6 -- reserved floor
# --------------------------------------------------------------------------- #
def _reserve(client, admin_headers, product_id, quantity):
    customer = sales._create_customer(client, admin_headers)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product_id, quantity=quantity,
                                      unit_price=1)
    sales._confirm_sales_order(client, admin_headers, order["sales_order_id"])
    return order["sales_order_id"]


def test_reserved_floor_at_create_and_equal_is_allowed(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    _reserve(client, admin_headers, product["id"], 4)
    below = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                           observed="10.000", requested="3.000", reason="DAMAGE")
    assert below.status_code == 409
    assert "reserved by open orders" in below.json()["message"]
    equal = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                           observed="10.000", requested="4.000", reason="DAMAGE")
    assert equal.status_code == 201
    allocations_before = [(a.id, a.quantity) for a in db_session.query(SalesOrderBatchAllocation)
                          .filter_by(batch_id=batch["id"]).all()]
    assert _approve(client, admin_headers, equal.json()["data"]["id"]).status_code == 200
    balance = _balance(db_session, product["id"], batch["id"])
    assert (balance.on_hand_qty, balance.reserved_qty) == (Decimal("4.000"), Decimal("4.000"))
    assert [(a.id, a.quantity) for a in db_session.query(SalesOrderBatchAllocation)
            .filter_by(batch_id=batch["id"]).all()] == allocations_before


def test_reservation_after_create_blocks_approval_without_side_effects(client, admin_headers, warehouse_headers,
                                                                       db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000", expiry=TODAY - timedelta(days=1))
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="0.000", reason="EXPIRY_WRITE_OFF").json()["data"]
    # Expired lots cannot be allocated, so reserve on a usable lot instead and
    # prove the floor on a plain DAMAGE request against a reserved balance.
    usable = _batch_in(client, admin_headers, product["id"], "5.000")
    damage = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=usable["id"],
                            observed="5.000", requested="1.000", reason="DAMAGE").json()["data"]
    _reserve(client, admin_headers, product["id"], 3)
    tx_before = db_session.query(StockTransaction).filter_by(product_id=product["id"]).count()
    response = _approve(client, admin_headers, damage["id"])
    assert response.status_code == 409 and "reserved by open orders" in response.json()["message"]
    balance = _balance(db_session, product["id"], usable["id"])
    assert (balance.on_hand_qty, balance.reserved_qty) == (Decimal("5.000"), Decimal("3.000"))
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == tx_before
    assert db_session.get(StockAdjustmentRequest, damage["id"]).status == "PENDING"
    # The expired-lot write-off (nothing reserved on it) still approves cleanly.
    assert _approve(client, admin_headers, created["id"]).status_code == 200


# --------------------------------------------------------------------------- #
# Stale count, FEFO, aggregates
# --------------------------------------------------------------------------- #
def test_stale_on_hand_is_a_409_naming_the_live_value(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="8.000", reason="DAMAGE").json()["data"]
    assert client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                       json={"product_id": product["id"], "quantity": "1.000"}).status_code == 200
    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 409 and "9.000" in response.json()["message"]


def test_fefo_after_a_batch_adjustment_respects_the_new_balance(client, admin_headers, warehouse_headers,
                                                                db_session):
    product = _lot_product(client, admin_headers)
    first = _batch_in(client, admin_headers, product["id"], "5.000", expiry=TODAY + timedelta(days=10))
    second = _batch_in(client, admin_headers, product["id"], "5.000", expiry=TODAY + timedelta(days=90))
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=first["id"],
                             observed="5.000", requested="1.000", reason="DAMAGE").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200
    assert client.post("/api/v1/stock/out-fefo", headers=admin_headers,
                       json={"product_id": product["id"], "quantity": "3.000"}).status_code == 200
    assert _balance(db_session, product["id"], first["id"]).on_hand_qty == Decimal("0.000")
    assert _balance(db_session, product["id"], second["id"]).on_hand_qty == Decimal("3.000")
    assert_aggregates(db_session, product["id"])


def test_aggregates_stay_consistent_with_lot_stock_in_transit(client, admin_headers, warehouse_headers,
                                                              transfer_storage, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    transfer = client.post("/api/v1/inventory-transfers", headers=admin_headers, json={
        "source_warehouse_id": transfer_storage["source_warehouse_id"],
        "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
        "items": [{"product_id": product["id"], "batch_id": batch["id"], "quantity": "3.000",
                   "from_location_id": transfer_storage["source_location_id"],
                   "to_location_id": transfer_storage["destination_location_id"]}],
    }).json()
    _dispatch(client, admin_headers, transfer["id"])  # 3 now in transit
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="7.000", requested="6.000", reason="LOSS_THEFT").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200
    db_session.expire_all()
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("9.000")  # 6 + 3 in transit
    assert db_session.get(ProductBatch, batch["id"]).quantity == Decimal("9.000")
    assert_aggregates(db_session, product["id"])


# --------------------------------------------------------------------------- #
# Ledger, audit, diagnostic, zero delta, detail
# --------------------------------------------------------------------------- #
def test_batch_approval_links_ledger_audit_and_diagnostic(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="6.000", reason="DAMAGE", notes="crushed").json()["data"]
    approved = _approve(client, admin_headers, created["id"]).json()["data"]
    request = db_session.get(StockAdjustmentRequest, created["id"])
    transaction = db_session.get(StockTransaction, request.stock_transaction_id)
    movement = db_session.query(InventoryMovement).filter_by(stock_transaction_id=transaction.id).one()
    warehouse, location = _main(db_session)
    assert (movement.movement_type, movement.reference_type, movement.reference_id) == (
        "STOCK_ADJUST", "STOCK_ADJUSTMENT_REQUEST", request.id)
    assert (movement.product_id, movement.warehouse_id, movement.location_id, movement.batch_id) == (
        product["id"], warehouse.id, location.id, batch["id"])
    assert (movement.quantity, movement.balance_before, movement.balance_after) == (
        Decimal("-4.000"), Decimal("10.000"), Decimal("6.000"))
    assert transaction.quantity == Decimal("-4.000")
    assert movement.recorded_at_utc is not None
    assert "crushed" not in (transaction.remark or "") and "crushed" not in (movement.remark or "")
    stock_audit = db_session.query(AuditLog).filter_by(table_name="stock_transactions",
                                                       record_id=transaction.id).one()
    assert f"batch={batch['id']};" in stock_audit.description
    assert approved["batch"]["id"] == batch["id"]

    link = next(f for f in diagnose_inventory(test_engine)
                if f["check"] == "adjustment_request_transaction_link" and f["request_id"] == request.id)
    assert link["classification"] == "CONSISTENT", link


def test_zero_delta_batch_approval_is_traceable_without_a_movement(client, admin_headers, warehouse_headers,
                                                                   db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="10.000").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200
    request = db_session.get(StockAdjustmentRequest, created["id"])
    assert db_session.get(StockTransaction, request.stock_transaction_id).quantity == Decimal("0.000")
    assert db_session.query(InventoryMovement).filter_by(reference_type="STOCK_ADJUSTMENT_REQUEST",
                                                         reference_id=request.id).count() == 0
    link = next(f for f in diagnose_inventory(test_engine)
                if f["check"] == "adjustment_request_transaction_link" and f["request_id"] == request.id)
    assert link["classification"] == "CONSISTENT"


def test_detail_and_list_carry_batch_context_only_for_authorized_viewers(client, admin_headers, warehouse_headers,
                                                                         db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000", expiry=TODAY - timedelta(days=1))
    _batch_in(client, admin_headers, product["id"], "1.000")  # a second lot: reservation lands elsewhere
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="2.000", reason="EXPIRY_WRITE_OFF",
                             notes="private").json()["data"]
    detail = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=warehouse_headers).json()["data"]
    assert detail["batch"] == {"id": batch["id"], "lot_no": batch["lot_no"],
                               "expiry_date": (TODAY - timedelta(days=1)).isoformat(), "is_expired": True}
    assert detail["current_balance"] == {"on_hand": "10.000", "reserved": "0.000", "available": "10.000"}
    listed = client.get("/api/v1/stock-adjustment-requests", headers=warehouse_headers).json()["data"]["items"]
    assert next(r for r in listed if r["id"] == created["id"])["batch_id"] == batch["id"]
    stranger = _mint(db_session, "batch_stranger")
    assert client.get(f"/api/v1/stock-adjustment-requests/{created['id']}",
                      headers=_headers(stranger)).status_code == 403


# --------------------------------------------------------------------------- #
# D7 -- idempotency
# --------------------------------------------------------------------------- #
def _legacy_fingerprint(product_id, observed, requested, reason):
    """The exact Phase 14B/14C payload (no batch_id key)."""
    payload = {"version": 1, "operation": "STOCK_ADJUST_REQUEST_CREATE", "product_id": product_id,
               "storage": "MAIN/DEFAULT", "observed_quantity": observed, "requested_quantity": requested,
               "reason_code": reason, "notes": None}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


@pytest.mark.parametrize("extra", [{}, {"batch_id": None}])
def test_non_batch_fingerprint_is_byte_identical_to_14c(client, admin_headers, warehouse_headers, db_session, extra):
    from app.models import StockOperationReceipt

    product = _create_product(client, admin_headers)
    key = _key()
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                              requested="1.000", key=key, **extra)
    assert created.status_code == 201
    receipt = db_session.query(StockOperationReceipt).filter_by(operation_key=key).one()
    assert receipt.request_fingerprint == _legacy_fingerprint(product["id"], "0.000", "1.000", "CYCLE_COUNT_VARIANCE")
    # Omitted and null are the same request: replays, not a conflict.
    other = {"batch_id": None} if not extra else {}
    replay = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                             requested="1.000", key=key, **other)
    assert replay.status_code == 201 and replay.json()["data"]["id"] == created.json()["data"]["id"]


def test_batch_replay_conflict_and_cross_user_authorization(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    first = _batch_in(client, admin_headers, product["id"])
    second = _batch_in(client, admin_headers, product["id"])
    key = _key()
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=first["id"],
                             observed="10.000", requested="9.000", key=key)
    replay = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=first["id"],
                            observed="10.000", requested="9.000", key=key)
    assert replay.json()["data"]["id"] == created.json()["data"]["id"]
    changed = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=second["id"],
                             observed="10.000", requested="9.000", key=key)
    assert changed.status_code == 409  # same key, different batch
    stranger = _mint(db_session, "replayer")
    foreign = _batch_request(client, _headers(stranger), db_session, product_id=product["id"], batch_id=first["id"],
                             observed="10.000", requested="9.000", key=key)
    assert foreign.status_code == 403
    assert db_session.query(StockAdjustmentRequest).filter_by(product_id=product["id"]).count() == 1


def test_approval_retry_after_uncertain_response_replays(client, admin_headers, warehouse_headers, db_session):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "10.000")
    created = _batch_request(client, warehouse_headers, db_session, product_id=product["id"], batch_id=batch["id"],
                             observed="10.000", requested="5.000", reason="DAMAGE").json()["data"]
    key = _key("approve")
    first = _approve(client, admin_headers, created["id"], key=key)
    retry = _approve(client, admin_headers, created["id"], key=key)
    assert first.status_code == retry.status_code == 200
    assert retry.json()["data"] == first.json()["data"]
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"], transaction_type="ADJUST").count() == 1
    assert _balance(db_session, product["id"], batch["id"]).on_hand_qty == Decimal("5.000")


def test_product_balance_rows_name_their_lot_for_the_picker(client, admin_headers):
    product = _lot_product(client, admin_headers)
    batch = _batch_in(client, admin_headers, product["id"], "3.000", lot="LOT-PICKER-1")
    rows = client.get(f"/api/v1/stock-balances/product/{product['id']}", headers=admin_headers).json()["data"]["items"]
    row = next(r for r in rows if r["batch_id"] == batch["id"])
    assert row["batch_lot_no"] == "LOT-PICKER-1"
    assert {"on_hand_qty", "reserved_qty", "available_qty", "batch_expiry_date", "is_expired"} <= set(row)
