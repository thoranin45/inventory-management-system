"""Phase 6 warehouse transfer lifecycle: dispatch -> in transit -> (partial) receipt.

Covers the state machine, transit StockBalance behaviour, transit isolation from
every other inventory workflow, batch identity, quantity rules, receipt-event
idempotency and multi-line atomicity.  All setup uses audited public APIs.
"""
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    InventoryMovement,
    Product,
    ProductBatch,
    StockBalance,
    Warehouse,
    WarehouseLocation,
)
from tests.test_inventory_transfer import (  # noqa: F401  (transfer_storage is a fixture)
    transfer_storage,
    _create_draft_transfer,
    _create_product,
    _dispatch,
    _receive,
    _receive_lines,
    _run_transfer_lifecycle,
    _stock_in,
)
from tests.test_stock import _create_batch


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _d(value) -> Decimal:
    return Decimal(str(value))


def _transit_storage(db: Session):
    row = (
        db.query(Warehouse, WarehouseLocation)
        .join(WarehouseLocation, WarehouseLocation.warehouse_id == Warehouse.id)
        .filter(Warehouse.warehouse_code == "__TRANSIT__")
        .one()
    )
    return row[0], row[1]


def _balance(db, product_id, warehouse_id, location_id, batch_id=None):
    query = db.query(StockBalance).filter(
        StockBalance.product_id == product_id,
        StockBalance.warehouse_id == warehouse_id,
        StockBalance.location_id == location_id,
    )
    if batch_id is None:
        query = query.filter(StockBalance.batch_id.is_(None))
    else:
        query = query.filter(StockBalance.batch_id == batch_id)
    return query.first()


def _on_hand(balance) -> Decimal:
    return Decimal("0.000") if balance is None else _d(balance.on_hand_qty)


def _create_batch_transfer(client, headers, product_id, batch_id, storage, quantity):
    response = client.post(
        "/api/v1/inventory-transfers",
        headers=headers,
        json={
            "source_warehouse_id": storage["source_warehouse_id"],
            "destination_warehouse_id": storage["destination_warehouse_id"],
            "remark": "Phase 6 batch transfer",
            "items": [
                {
                    "product_id": product_id,
                    "batch_id": batch_id,
                    "from_location_id": storage["source_location_id"],
                    "to_location_id": storage["destination_location_id"],
                    "quantity": quantity,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def stocked_transfer(client, admin_headers, transfer_storage):
    """A DRAFT transfer of 30.000 units with 50.000 available at the source."""
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "50.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="30.000"
    )
    return product, transfer


# --------------------------------------------------------------------------- #
# Lifecycle state machine
# --------------------------------------------------------------------------- #
def test_lifecycle_draft_dispatch_partial_partial_final(client, admin_headers, stocked_transfer):
    product, transfer = stocked_transfer
    item_id = transfer["items"][0]["id"]

    assert transfer["status"] == "DRAFT"

    dispatched = _dispatch(client, admin_headers, transfer["id"]).json()
    assert dispatched["status"] == "IN_TRANSIT"
    assert dispatched["items"][0]["dispatched_quantity"] == "30.000"
    assert dispatched["items"][0]["received_quantity"] == "0.000"
    assert dispatched["items"][0]["outstanding_quantity"] == "30.000"

    first = _receive(
        client, admin_headers, transfer["id"],
        [{"transfer_item_id": item_id, "quantity": "10.000"}],
    ).json()["transfer"]
    assert first["status"] == "PARTIALLY_RECEIVED"
    assert first["items"][0]["received_quantity"] == "10.000"
    assert first["items"][0]["outstanding_quantity"] == "20.000"
    assert first["completed_at"] is None

    second = _receive(
        client, admin_headers, transfer["id"],
        [{"transfer_item_id": item_id, "quantity": "5.500"}],
    ).json()["transfer"]
    assert second["status"] == "PARTIALLY_RECEIVED"
    assert second["items"][0]["received_quantity"] == "15.500"

    final = _receive(
        client, admin_headers, transfer["id"],
        [{"transfer_item_id": item_id, "quantity": "14.500"}],
    ).json()["transfer"]
    assert final["status"] == "COMPLETED"
    assert final["items"][0]["received_quantity"] == "30.000"
    assert final["items"][0]["outstanding_quantity"] == "0.000"
    assert final["completed_at"] is not None
    assert final["completed_by_user_id"] is not None


def test_direct_full_receive_after_dispatch(client, admin_headers, stocked_transfer):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    body = _receive(
        client, admin_headers, transfer["id"], _receive_lines(transfer)
    ).json()["transfer"]
    assert body["status"] == "COMPLETED"


@pytest.mark.parametrize("second_expect", [409])
def test_duplicate_dispatch_is_rejected(client, admin_headers, stocked_transfer, second_expect):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    _dispatch(client, admin_headers, transfer["id"], expect=second_expect)


@pytest.mark.parametrize("bad_state", ["dispatch_completed", "receive_draft", "receive_cancelled"])
def test_invalid_transitions(client, admin_headers, transfer_storage, bad_state):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "20.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="5.000"
    )

    if bad_state == "dispatch_completed":
        _run_transfer_lifecycle(client, admin_headers, transfer)
        _dispatch(client, admin_headers, transfer["id"], expect=409)
    elif bad_state == "receive_draft":
        _receive(client, admin_headers, transfer["id"], _receive_lines(transfer), expect=409)
    else:
        client.post(f"/api/v1/inventory-transfers/{transfer['id']}/cancel", headers=admin_headers)
        _receive(client, admin_headers, transfer["id"], _receive_lines(transfer), expect=409)


@pytest.mark.parametrize("progress", ["draft", "in_transit", "partially_received"])
def test_cancellation_only_from_draft(client, admin_headers, transfer_storage, progress):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "20.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="8.000"
    )
    item_id = transfer["items"][0]["id"]

    if progress == "draft":
        response = client.post(
            f"/api/v1/inventory-transfers/{transfer['id']}/cancel", headers=admin_headers
        )
        assert response.status_code == 200
        assert response.json()["status"] == "CANCELLED"
        return

    _dispatch(client, admin_headers, transfer["id"])
    if progress == "partially_received":
        _receive(client, admin_headers, transfer["id"],
                 [{"transfer_item_id": item_id, "quantity": "3.000"}])

    blocked = client.post(
        f"/api/v1/inventory-transfers/{transfer['id']}/cancel", headers=admin_headers
    )
    assert blocked.status_code == 409


# --------------------------------------------------------------------------- #
# Transit StockBalance behaviour + conservation
# --------------------------------------------------------------------------- #
def test_transit_balance_tracks_goods_in_flight(client, admin_headers, transfer_storage, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "50.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="30.000"
    )

    src_wh = transfer_storage["source_warehouse_id"]
    src_loc = transfer_storage["source_location_id"]
    dst_wh = transfer_storage["destination_warehouse_id"]
    dst_loc = transfer_storage["destination_location_id"]

    db_session.expire_all()
    transit_wh, transit_loc = _transit_storage(db_session)

    def totals():
        db_session.expire_all()
        product_row = db_session.get(Product, product["id"])
        return (
            _on_hand(_balance(db_session, product["id"], src_wh, src_loc)),
            _on_hand(_balance(db_session, product["id"], transit_wh.id, transit_loc.id)),
            _on_hand(_balance(db_session, product["id"], dst_wh, dst_loc)),
            _d(product_row.stock_qty),
        )

    # before dispatch
    assert totals() == (Decimal("50.000"), Decimal("0.000"), Decimal("0.000"), Decimal("50.000"))

    _dispatch(client, admin_headers, transfer["id"])
    # source decreases only at dispatch; transit holds it; destination untouched
    src, transit, dst, global_qty = totals()
    assert (src, transit, dst) == (Decimal("20.000"), Decimal("30.000"), Decimal("0.000"))
    assert global_qty == Decimal("50.000")  # global aggregate still conserved, includes transit

    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "12.000"}])
    # partial receipt decreases transit and increases destination by exactly the received qty
    src, transit, dst, global_qty = totals()
    assert (src, transit, dst) == (Decimal("20.000"), Decimal("18.000"), Decimal("12.000"))
    assert global_qty == Decimal("50.000")

    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "18.000"}])
    src, transit, dst, global_qty = totals()
    assert (src, transit, dst) == (Decimal("20.000"), Decimal("0.000"), Decimal("30.000"))
    assert global_qty == Decimal("50.000")

    # reservations never touched anywhere
    for b in db_session.query(StockBalance).filter_by(product_id=product["id"]).all():
        assert b.reserved_qty == Decimal("0.000")


def test_dispatch_respects_reservations_on_source(client, admin_headers, transfer_storage, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "20.000")
    db_session.expire_all()
    source = _balance(
        db_session, product["id"],
        transfer_storage["source_warehouse_id"], transfer_storage["source_location_id"],
    )
    source.reserved_qty = Decimal("15.000")
    db_session.commit()

    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="10.000"
    )
    # available = 20 - 15 = 5 < 10
    _dispatch(client, admin_headers, transfer["id"], expect=409)

    db_session.expire_all()
    assert _on_hand(_balance(
        db_session, product["id"],
        transfer_storage["source_warehouse_id"], transfer_storage["source_location_id"],
    )) == Decimal("20.000")


# --------------------------------------------------------------------------- #
# Transit isolation from every other workflow
# --------------------------------------------------------------------------- #
@pytest.fixture
def transit_ids(db_session):
    wh, loc = _transit_storage(db_session)
    return {"warehouse_id": wh.id, "location_id": loc.id}


def test_stock_in_cannot_target_transit(client, admin_headers, transit_ids):
    product = _create_product(client, admin_headers)
    response = client.post(
        "/api/v1/stock/in", headers=admin_headers,
        json={"product_id": product["id"], "quantity": "1.000", **transit_ids},
    )
    assert response.status_code == 409
    assert "transit" in response.json()["message"].lower()


@pytest.mark.parametrize("path", ["/api/v1/stock/out-fifo", "/api/v1/stock/out-fefo"])
def test_stock_out_cannot_source_transit(client, admin_headers, transit_ids, path):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "5.000")
    response = client.post(
        path, headers=admin_headers,
        json={"product_id": product["id"], "quantity": "1.000", **transit_ids},
    )
    assert response.status_code == 409


def test_adjustment_cannot_target_transit(client, admin_headers, transit_ids):
    product = _create_product(client, admin_headers)
    response = client.post(
        "/api/v1/stock/adjust", headers=admin_headers,
        json={"product_id": product["id"], "new_quantity": "3.000", "remark": "cycle count", **transit_ids},
    )
    assert response.status_code == 409


def test_raw_stock_balance_cannot_target_transit(client, admin_headers, transit_ids):
    product = _create_product(client, admin_headers)
    response = client.post(
        "/api/v1/stock-balances", headers=admin_headers,
        json={"product_id": product["id"], **transit_ids},
    )
    assert response.status_code == 409


def test_po_receiving_cannot_target_transit(client, admin_headers, transit_ids):
    supplier = client.post(
        "/api/v1/suppliers", headers=admin_headers, json={"supplier_name": f"S-{uuid4().hex[:8]}"}
    ).json()["data"]
    product = _create_product(client, admin_headers)
    order = client.post(
        "/api/v1/purchase-orders", headers=admin_headers,
        json={"supplier_id": supplier["id"], "items": [{"product_id": product["id"], "quantity": "5.000", "unit_price": 1}]},
    ).json()["data"]
    client.post(f"/api/v1/purchase-orders/{order['id']}/confirm", headers=admin_headers)
    response = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={"items": [{"product_id": product["id"], "quantity": "5.000"}], **transit_ids},
    )
    assert response.status_code == 409


@pytest.mark.parametrize("field", ["source", "destination"])
def test_transfer_endpoint_cannot_use_transit(client, admin_headers, transfer_storage, transit_ids, field):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "10.000")
    payload = {
        "source_warehouse_id": transfer_storage["source_warehouse_id"],
        "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
        "items": [{
            "product_id": product["id"], "batch_id": None,
            "from_location_id": transfer_storage["source_location_id"],
            "to_location_id": transfer_storage["destination_location_id"],
            "quantity": "1.000",
        }],
    }
    if field == "source":
        payload["source_warehouse_id"] = transit_ids["warehouse_id"]
        payload["items"][0]["from_location_id"] = transit_ids["location_id"]
    else:
        payload["destination_warehouse_id"] = transit_ids["warehouse_id"]
        payload["items"][0]["to_location_id"] = transit_ids["location_id"]
    response = client.post("/api/v1/inventory-transfers", headers=admin_headers, json=payload)
    assert response.status_code == 409


def test_transit_excluded_from_normal_stock_views_but_kept_in_global_total(
    client, admin_headers, transfer_storage, db_session
):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "40.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="25.000"
    )
    _dispatch(client, admin_headers, transfer["id"])

    listed = client.get(
        f"/api/v1/stock-balances/product/{product['id']}", headers=admin_headers
    ).json()
    transit_wh, _ = _transit_storage(db_session)
    assert all(row["warehouse_id"] != transit_wh.id for row in listed)
    # only the reduced operational source balance is visible
    assert sum(_d(row["on_hand_qty"]) for row in listed) == Decimal("15.000")

    all_listed = client.get("/api/v1/stock-balances", headers=admin_headers).json()
    assert all(row["warehouse_id"] != transit_wh.id for row in all_listed)

    # the authoritative product total still accounts for the in-transit goods
    db_session.expire_all()
    assert _d(db_session.get(Product, product["id"]).stock_qty) == Decimal("40.000")


# --------------------------------------------------------------------------- #
# Batch / non-batch identity
# --------------------------------------------------------------------------- #
def test_batch_identity_preserved_source_transit_destination(
    client, admin_headers, transfer_storage, db_session
):
    product = client.post(
        "/api/v1/products", headers=admin_headers,
        json={"sku": f"B6-{uuid4().hex[:8]}", "product_name": "Batch transfer", "price": 10,
              "stock_qty": 0, "track_batch": True},
    ).json()["data"]
    batch = _create_batch(client, admin_headers, product["id"], quantity=20, expiry_days=120)

    before_batches = db_session.query(ProductBatch).filter_by(product_id=product["id"]).count()

    transfer = _create_batch_transfer(
        client, admin_headers, product["id"], batch["id"], transfer_storage, "8.000"
    )
    _dispatch(client, admin_headers, transfer["id"])
    _receive(client, admin_headers, transfer["id"], _receive_lines(transfer))

    db_session.expire_all()
    # no new ProductBatch rows created by the transfer
    assert db_session.query(ProductBatch).filter_by(product_id=product["id"]).count() == before_batches

    transit_wh, transit_loc = _transit_storage(db_session)
    # every balance and movement touched carries the original batch id
    movements = (
        db_session.query(InventoryMovement)
        .filter_by(reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"])
        .all()
    )
    assert movements and all(m.batch_id == batch["id"] for m in movements)
    for wh, loc in (
        (transfer_storage["source_warehouse_id"], transfer_storage["source_location_id"]),
        (transit_wh.id, transit_loc.id),
        (transfer_storage["destination_warehouse_id"], transfer_storage["destination_location_id"]),
    ):
        assert _balance(db_session, product["id"], wh, loc, batch_id=batch["id"]) is not None

    # batch quantity total is conserved (20 in, none lost)
    total = sum(
        _d(b.on_hand_qty)
        for b in db_session.query(StockBalance).filter_by(batch_id=batch["id"]).all()
    )
    assert total == Decimal("20.000")
    assert _d(db_session.get(ProductBatch, batch["id"]).quantity) == Decimal("20.000")


def test_non_batch_transfer_keeps_batch_id_null(client, admin_headers, transfer_storage, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "10.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity="6.000"
    )
    _run_transfer_lifecycle(client, admin_headers, transfer)

    db_session.expire_all()
    movements = (
        db_session.query(InventoryMovement)
        .filter_by(reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"])
        .all()
    )
    assert movements and all(m.batch_id is None for m in movements)
    assert db_session.query(ProductBatch).filter_by(product_id=product["id"]).count() == 0


# --------------------------------------------------------------------------- #
# Quantity rules
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("quantity", ["0.001", "1.125"])
def test_fractional_quantities_move_exactly(client, admin_headers, transfer_storage, db_session, quantity):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "2.000")
    transfer = _create_draft_transfer(
        client, admin_headers, product["id"], transfer_storage, quantity=quantity
    )
    _run_transfer_lifecycle(client, admin_headers, transfer)

    db_session.expire_all()
    dst = _balance(
        db_session, product["id"],
        transfer_storage["destination_warehouse_id"], transfer_storage["destination_location_id"],
    )
    assert _on_hand(dst) == Decimal(quantity)


@pytest.mark.parametrize("quantity", ["0", "-1.000", "1.0005"])
def test_transfer_rejects_non_positive_or_over_precise_quantity(
    client, admin_headers, transfer_storage, quantity
):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "5.000")
    response = client.post(
        "/api/v1/inventory-transfers", headers=admin_headers,
        json={
            "source_warehouse_id": transfer_storage["source_warehouse_id"],
            "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
            "items": [{
                "product_id": product["id"], "batch_id": None,
                "from_location_id": transfer_storage["source_location_id"],
                "to_location_id": transfer_storage["destination_location_id"],
                "quantity": quantity,
            }],
        },
    )
    assert response.status_code == 422


def test_over_receipt_is_rejected(client, admin_headers, stocked_transfer):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    item_id = transfer["items"][0]["id"]
    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": item_id, "quantity": "20.000"}])
    # only 10.000 outstanding
    over = _receive(
        client, admin_headers, transfer["id"],
        [{"transfer_item_id": item_id, "quantity": "10.001"}], expect=409,
    )
    assert "outstanding" in over.json()["message"].lower()


def test_receipt_over_precision_fails_atomically(client, admin_headers, stocked_transfer, db_session):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    item_id = transfer["items"][0]["id"]
    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": item_id, "quantity": "1.0005"}], expect=422)

    db_session.expire_all()
    # still fully in transit, no receipt event, no destination balance
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"],
        movement_type="TRANSFER_IN",
    ).count() == 0


# --------------------------------------------------------------------------- #
# Receipt-event idempotency
# --------------------------------------------------------------------------- #
def test_same_key_same_payload_replays_without_new_effects(
    client, admin_headers, stocked_transfer, db_session
):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    lines = [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "12.000"}]
    key = uuid4().hex

    first = _receive(client, admin_headers, transfer["id"], lines, key=key).json()
    second = _receive(client, admin_headers, transfer["id"], lines, key=key).json()
    assert first == second

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]
    ).count() == 4  # 2 dispatch legs + 2 legs from the single receipt
    assert db_session.query(AuditLog).filter_by(
        action="RECEIVE_TRANSFER", table_name="inventory_transfers", record_id=transfer["id"]
    ).count() == 1
    dst = _balance(
        db_session, product["id"],
        transfer["destination_warehouse_id"], transfer["items"][0]["to_location_id"],
    )
    assert _on_hand(dst) == Decimal("12.000")


def test_same_key_different_payload_conflicts(client, admin_headers, stocked_transfer):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    key = uuid4().hex
    _receive(client, admin_headers, transfer["id"],
             [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "12.000"}], key=key)
    conflict = _receive(
        client, admin_headers, transfer["id"],
        [{"transfer_item_id": transfer["items"][0]["id"], "quantity": "13.000"}],
        key=key, expect=409,
    )
    assert "different payload" in conflict.json()["message"].lower()


def test_final_receipt_replays_after_completion(client, admin_headers, stocked_transfer, db_session):
    product, transfer = stocked_transfer
    _dispatch(client, admin_headers, transfer["id"])
    lines = _receive_lines(transfer)
    key = uuid4().hex

    done = _receive(client, admin_headers, transfer["id"], lines, key=key).json()
    assert done["transfer"]["status"] == "COMPLETED"
    replay = _receive(client, admin_headers, transfer["id"], lines, key=key).json()
    assert replay == done

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]
    ).count() == 4


# --------------------------------------------------------------------------- #
# Multi-line atomicity
# --------------------------------------------------------------------------- #
@pytest.fixture
def two_line_transfer(client, admin_headers, transfer_storage):
    products = [_create_product(client, admin_headers) for _ in range(2)]
    _stock_in(client, admin_headers, products[0]["id"], "20.000")
    _stock_in(client, admin_headers, products[1]["id"], "20.000")
    response = client.post(
        "/api/v1/inventory-transfers", headers=admin_headers,
        json={
            "source_warehouse_id": transfer_storage["source_warehouse_id"],
            "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
            "items": [
                {"product_id": products[0]["id"], "batch_id": None,
                 "from_location_id": transfer_storage["source_location_id"],
                 "to_location_id": transfer_storage["destination_location_id"], "quantity": "10.000"},
                {"product_id": products[1]["id"], "batch_id": None,
                 "from_location_id": transfer_storage["source_location_id"],
                 "to_location_id": transfer_storage["destination_location_id"], "quantity": "10.000"},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return products, response.json()


def test_multi_line_dispatch_shortage_rolls_back_all_lines(
    client, admin_headers, transfer_storage, db_session
):
    products = [_create_product(client, admin_headers) for _ in range(2)]
    _stock_in(client, admin_headers, products[0]["id"], "20.000")
    _stock_in(client, admin_headers, products[1]["id"], "1.000")  # not enough for its 10.000 line
    response = client.post(
        "/api/v1/inventory-transfers", headers=admin_headers,
        json={
            "source_warehouse_id": transfer_storage["source_warehouse_id"],
            "destination_warehouse_id": transfer_storage["destination_warehouse_id"],
            "items": [
                {"product_id": products[0]["id"], "batch_id": None,
                 "from_location_id": transfer_storage["source_location_id"],
                 "to_location_id": transfer_storage["destination_location_id"], "quantity": "10.000"},
                {"product_id": products[1]["id"], "batch_id": None,
                 "from_location_id": transfer_storage["source_location_id"],
                 "to_location_id": transfer_storage["destination_location_id"], "quantity": "10.000"},
            ],
        },
    )
    transfer = response.json()
    _dispatch(client, admin_headers, transfer["id"], expect=409)

    db_session.expire_all()
    # no line moved: no transfer movements at all and both sources intact
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"]
    ).count() == 0
    assert _on_hand(_balance(
        db_session, products[0]["id"],
        transfer_storage["source_warehouse_id"], transfer_storage["source_location_id"],
    )) == Decimal("20.000")
    fetched = client.get(
        f"/api/v1/inventory-transfers/{transfer['id']}", headers=admin_headers
    ).json()
    assert fetched["status"] == "DRAFT"


def test_receipt_invalid_line_leaves_all_goods_in_transit(
    client, admin_headers, two_line_transfer, db_session
):
    products, transfer = two_line_transfer
    _dispatch(client, admin_headers, transfer["id"])

    good_item = transfer["items"][0]["id"]
    response = client.post(
        f"/api/v1/inventory-transfers/{transfer['id']}/receive",
        headers={**admin_headers, "Idempotency-Key": uuid4().hex},
        json={"items": [
            {"transfer_item_id": good_item, "quantity": "5.000"},
            {"transfer_item_id": 999999999, "quantity": "5.000"},  # not part of this transfer
        ]},
    )
    assert response.status_code == 409

    db_session.expire_all()
    # neither line received: no TRANSFER_IN legs, both still fully in transit
    assert db_session.query(InventoryMovement).filter_by(
        reference_type="INVENTORY_TRANSFER", reference_id=transfer["id"],
        movement_type="TRANSFER_IN",
    ).count() == 0
    transit_wh, transit_loc = _transit_storage(db_session)
    in_transit = sum(
        _on_hand(_balance(db_session, p["id"], transit_wh.id, transit_loc.id))
        for p in products
    )
    assert in_transit == Decimal("20.000")
    body = client.get(
        f"/api/v1/inventory-transfers/{transfer['id']}", headers=admin_headers
    ).json()
    assert body["status"] == "IN_TRANSIT"
    assert all(item["received_quantity"] == "0.000" for item in body["items"])
