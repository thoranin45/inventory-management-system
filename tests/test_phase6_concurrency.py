"""Phase 6 transfer lifecycle under real overlapping PostgreSQL requests.

Uses the shared isolated concurrency harness (``concurrent_inventory`` + ``overlap``).
The critical invariant under test: one transfer must never consume another
transfer's outstanding goods just because they share the same transit
``StockBalance`` row.
"""
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import (
    AuditLog,
    InventoryMovement,
    InventoryTransfer,
    InventoryTransferItem,
    InventoryTransferReceipt,
    StockBalance,
    Warehouse,
)
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401
from tests.test_stock import _create_product


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _stock(s, product_id, quantity):
    r = s.client.post("/api/v1/stock/in", json={"product_id": product_id, "quantity": quantity})
    assert r.status_code == 200, r.text


def _new_transfer(s, product_id, quantity, batch_id=None):
    r = s.client.post("/api/v1/inventory-transfers", json={
        "source_warehouse_id": s.storage["source_warehouse_id"],
        "destination_warehouse_id": s.storage["destination_warehouse_id"],
        "items": [{
            "product_id": product_id, "batch_id": batch_id,
            "from_location_id": s.storage["source_location_id"],
            "to_location_id": s.storage["destination_location_id"],
            "quantity": quantity,
        }],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _dispatch_req(transfer_id):
    return ("POST", f"/api/v1/inventory-transfers/{transfer_id}/dispatch", None)


def _receive_req(transfer, quantity, key=None):
    body = {"items": [{"transfer_item_id": transfer["items"][0]["id"], "quantity": quantity}]}
    return ("POST", f"/api/v1/inventory-transfers/{transfer['id']}/receive", body, key or uuid4().hex)


def _transit_wh_id(db):
    return db.query(Warehouse.id).filter_by(warehouse_code="__TRANSIT__").scalar()


def _assert_no_duplicate_balances(db):
    seen = set()
    for b in db.query(StockBalance).all():
        key = (b.product_id, b.warehouse_id, b.location_id, b.batch_id)
        assert key not in seen, key
        seen.add(key)
        assert Decimal("0") <= b.reserved_qty <= b.on_hand_qty


# --------------------------------------------------------------------------- #
# dispatch races
# --------------------------------------------------------------------------- #
def test_dispatch_vs_dispatch_shares_one_source(concurrent_inventory):
    """Two transfers, one source balance of 1.000, each wanting 0.750: exactly one dispatches."""
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "1.000")
    a = _new_transfer(s, product["id"], "0.750")
    b = _new_transfer(s, product["id"], "0.750")
    responses = overlap(s, [_dispatch_req(a["id"]), _dispatch_req(b["id"])], "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        transit_id = _transit_wh_id(db)
        source = db.query(StockBalance).filter_by(
            product_id=product["id"], warehouse_id=s.storage["source_warehouse_id"]).one()
        transit = db.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transit_id).one()
        assert source.on_hand_qty == Decimal("0.250")
        assert transit.on_hand_qty == Decimal("0.750")
        assert {t.status for t in db.query(InventoryTransfer).all()} == {"IN_TRANSIT", "DRAFT"}
        dispatched = sum(i.dispatched_quantity for i in db.query(InventoryTransferItem).all())
        assert dispatched == Decimal("0.750")
        assert db.query(InventoryMovement).filter_by(movement_type="TRANSFER_OUT").count() == 1
        _assert_no_duplicate_balances(db)


def test_dispatch_vs_dispatch_both_succeed_creates_single_transit_balance(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "3.000")
    a = _new_transfer(s, product["id"], "1.000")
    b = _new_transfer(s, product["id"], "1.000")
    responses = overlap(s, [_dispatch_req(a["id"]), _dispatch_req(b["id"])], "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        transit_id = _transit_wh_id(db)
        transit = db.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transit_id).all()
        assert len(transit) == 1
        assert transit[0].on_hand_qty == Decimal("2.000")
        assert db.query(StockBalance).filter_by(
            product_id=product["id"], warehouse_id=s.storage["source_warehouse_id"]).one().on_hand_qty == Decimal("1.000")
        _assert_no_duplicate_balances(db)


def test_dispatch_vs_cancel(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "2.000")
    transfer = _new_transfer(s, product["id"], "1.000")
    # dispatch and cancel both contend on the transfer row (cancel never locks products).
    responses = overlap(s, [
        _dispatch_req(transfer["id"]),
        ("POST", f"/api/v1/inventory-transfers/{transfer['id']}/cancel", None),
    ], "inventory_transfers", [transfer["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        status = db.get(InventoryTransfer, transfer["id"]).status
        assert status in {"IN_TRANSIT", "CANCELLED"}
        transit_id = _transit_wh_id(db)
        transit = db.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transit_id).all()
        moves = db.query(InventoryMovement).filter_by(reference_type="INVENTORY_TRANSFER").count()
        if status == "IN_TRANSIT":
            assert transit[0].on_hand_qty == Decimal("1.000") and moves == 2
        else:
            assert (not transit or transit[0].on_hand_qty == Decimal("0.000")) and moves == 0
        _assert_no_duplicate_balances(db)


# --------------------------------------------------------------------------- #
# receipt races
# --------------------------------------------------------------------------- #
def _dispatched_transfer(s, product_id, quantity):
    transfer = _new_transfer(s, product_id, quantity)
    r = s.client.post(f"/api/v1/inventory-transfers/{transfer['id']}/dispatch")
    assert r.status_code == 200, r.text
    return transfer


def test_two_partial_receipts_within_outstanding_both_apply(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "5.000")
    transfer = _dispatched_transfer(s, product["id"], "4.000")
    responses = overlap(s, [_receive_req(transfer, "1.500"), _receive_req(transfer, "2.000")],
                        "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        item = db.query(InventoryTransferItem).filter_by(transfer_id=transfer["id"]).one()
        assert item.received_quantity == Decimal("3.500")
        assert item.dispatched_quantity - item.received_quantity == Decimal("0.500")
        assert db.get(InventoryTransfer, transfer["id"]).status == "PARTIALLY_RECEIVED"
        assert db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer["id"]).count() == 2
        transit_id = _transit_wh_id(db)
        transit = db.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transit_id).one()
        dest = db.query(StockBalance).filter_by(
            product_id=product["id"], warehouse_id=s.storage["destination_warehouse_id"]).one()
        assert transit.on_hand_qty == Decimal("0.500")
        assert dest.on_hand_qty == Decimal("3.500")
        assert db.query(InventoryMovement).filter_by(movement_type="TRANSFER_IN").count() == 2
        _assert_no_duplicate_balances(db)


def test_two_receipts_exceeding_remaining_quantity(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "5.000")
    transfer = _dispatched_transfer(s, product["id"], "4.000")
    # 3.000 + 3.000 > 4.000 outstanding -> exactly one applies
    responses = overlap(s, [_receive_req(transfer, "3.000"), _receive_req(transfer, "3.000")],
                        "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        item = db.query(InventoryTransferItem).filter_by(transfer_id=transfer["id"]).one()
        assert item.received_quantity == Decimal("3.000")
        assert db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer["id"]).count() == 1
        assert db.query(InventoryMovement).filter_by(movement_type="TRANSFER_IN").count() == 1
        _assert_no_duplicate_balances(db)


def test_final_receipt_race(concurrent_inventory):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "5.000")
    transfer = _dispatched_transfer(s, product["id"], "4.000")
    responses = overlap(s, [_receive_req(transfer, "4.000"), _receive_req(transfer, "4.000")],
                        "products", [product["id"]])
    assert sorted(r.status_code for r in responses) == [200, 409]
    with s.sessions() as db:
        item = db.query(InventoryTransferItem).filter_by(transfer_id=transfer["id"]).one()
        assert item.received_quantity == Decimal("4.000")
        assert db.get(InventoryTransfer, transfer["id"]).status == "COMPLETED"
        assert db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer["id"]).count() == 1
        assert db.query(InventoryMovement).filter_by(
            reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]).count() == 4
        _assert_no_duplicate_balances(db)


@pytest.mark.parametrize("mode", ["same-payload", "changed-payload"])
def test_receipt_idempotency_key_race(concurrent_inventory, mode):
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "5.000")
    transfer = _dispatched_transfer(s, product["id"], "4.000")
    key = uuid4().hex
    second_qty = "2.000" if mode == "changed-payload" else "1.500"
    responses = overlap(s, [
        _receive_req(transfer, "1.500", key=key),
        _receive_req(transfer, second_qty, key=key),
    ], "products", [product["id"]])
    if mode == "changed-payload":
        assert sorted(r.status_code for r in responses) == [200, 409]
        with s.sessions() as db:
            # whichever payload won, exactly one receipt applied and no duplicate effects
            assert db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer["id"]).count() == 1
            item = db.query(InventoryTransferItem).filter_by(transfer_id=transfer["id"]).one()
            assert item.received_quantity in {Decimal("1.500"), Decimal("2.000")}
            assert db.query(InventoryMovement).filter_by(
                reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]).count() == 4
            assert db.query(AuditLog).filter_by(
                action="RECEIVE_TRANSFER", record_id=transfer["id"]).count() == 1
            _assert_no_duplicate_balances(db)
        return
    else:
        assert [r.status_code for r in responses] == [200, 200]
        assert responses[0].json() == responses[1].json()
        replay = s.client.post(
            f"/api/v1/inventory-transfers/{transfer['id']}/receive",
            headers={"Idempotency-Key": key},
            json={"items": [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "1.500"}]},
        )
        assert replay.json() == responses[0].json()
    with s.sessions() as db:
        assert db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer["id"]).count() == 1
        item = db.query(InventoryTransferItem).filter_by(transfer_id=transfer["id"]).one()
        assert item.received_quantity == Decimal("1.500")
        assert db.query(InventoryMovement).filter_by(
            reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]).count() == 4
        assert db.query(AuditLog).filter_by(
            action="RECEIVE_TRANSFER", record_id=transfer["id"]).count() == 1
        _assert_no_duplicate_balances(db)


# --------------------------------------------------------------------------- #
# cross-transfer isolation through the shared transit balance
# --------------------------------------------------------------------------- #
def test_one_transfer_never_consumes_another_transfers_transit_goods(concurrent_inventory):
    """Two transfers of the same product each dispatch 1.000 into the shared transit
    balance (total 2.000).  Racing a full receipt of each must not let either pull
    the other's 1.000."""
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "4.000")
    a = _dispatched_transfer(s, product["id"], "1.000")
    b = _dispatched_transfer(s, product["id"], "1.000")
    responses = overlap(s, [_receive_req(a, "1.000"), _receive_req(b, "1.000")],
                        "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        transit_id = _transit_wh_id(db)
        transit = db.query(StockBalance).filter_by(product_id=product["id"], warehouse_id=transit_id).one()
        dest = db.query(StockBalance).filter_by(
            product_id=product["id"], warehouse_id=s.storage["destination_warehouse_id"]).one()
        assert transit.on_hand_qty == Decimal("0.000")
        assert dest.on_hand_qty == Decimal("2.000")
        for item in db.query(InventoryTransferItem).all():
            assert item.received_quantity == Decimal("1.000")
            assert item.dispatched_quantity == Decimal("1.000")
        assert {t.status for t in db.query(InventoryTransfer).all()} == {"COMPLETED"}
        assert db.query(InventoryTransferReceipt).count() == 2
        # 2 transfers x (2 dispatch + 2 receipt) legs
        assert db.query(InventoryMovement).filter_by(reference_type="INVENTORY_TRANSFER").count() == 8
        _assert_no_duplicate_balances(db)


def test_reversed_order_multiline_transfers_dispatch_race(concurrent_inventory):
    s = concurrent_inventory
    products = [_create_product(s.client, s.headers) for _ in range(2)]
    for p in products:
        _stock(s, p["id"], "2.000")
    def make(order):
        r = s.client.post("/api/v1/inventory-transfers", json={
            "source_warehouse_id": s.storage["source_warehouse_id"],
            "destination_warehouse_id": s.storage["destination_warehouse_id"],
            "items": [{"product_id": p["id"], "batch_id": None,
                       "from_location_id": s.storage["source_location_id"],
                       "to_location_id": s.storage["destination_location_id"], "quantity": "1.000"}
                      for p in order],
        })
        assert r.status_code == 201, r.text
        return r.json()
    a = make(products)
    b = make(list(reversed(products)))
    responses = overlap(s, [_dispatch_req(a["id"]), _dispatch_req(b["id"])],
                        "products", [p["id"] for p in products])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        transit_id = _transit_wh_id(db)
        for p in products:
            transit = db.query(StockBalance).filter_by(product_id=p["id"], warehouse_id=transit_id).all()
            assert len(transit) == 1 and transit[0].on_hand_qty == Decimal("2.000")
            src = db.query(StockBalance).filter_by(
                product_id=p["id"], warehouse_id=s.storage["source_warehouse_id"]).one()
            assert src.on_hand_qty == Decimal("0.000")
        assert db.query(InventoryMovement).filter_by(movement_type="TRANSFER_OUT").count() == 4
        _assert_no_duplicate_balances(db)


def test_simultaneous_destination_balance_creation_on_receipt(concurrent_inventory):
    """Two different transfers receive the same product into the same destination
    at once: exactly one destination balance row is created."""
    s = concurrent_inventory
    product = _create_product(s.client, s.headers)
    _stock(s, product["id"], "4.000")
    a = _dispatched_transfer(s, product["id"], "1.000")
    b = _dispatched_transfer(s, product["id"], "1.000")
    responses = overlap(s, [_receive_req(a, "1.000"), _receive_req(b, "1.000")],
                        "products", [product["id"]])
    assert [r.status_code for r in responses] == [200, 200]
    with s.sessions() as db:
        dest = db.query(StockBalance).filter_by(
            product_id=product["id"], warehouse_id=s.storage["destination_warehouse_id"]).all()
        assert len(dest) == 1
        assert dest[0].on_hand_qty == Decimal("2.000")
        _assert_no_duplicate_balances(db)
