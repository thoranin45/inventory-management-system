"""V1-H1: sales-return idempotency.

Before V1-H1 a retried *partial* return (lost response, timeout, resubmit)
restocked a second time whenever it still fitted under the sold-quantity cap.
``POST /sales-orders/{id}/return`` now requires an ``Idempotency-Key``; the same
key + same payload replays the stored response, a different payload is a 409,
and a business return changes physical stock exactly once.
"""
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func

from app.core.security import create_access_token
from app.main import app
from app.models import (AuditLog, InventoryMovement, Product, ProductBatch, SalesReturnReceipt, StockBalance,
                        StockTransaction, User)
from app.repositories.stock_balance_repository import StockBalanceRepository
from tests import test_sales_order as sales
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401  (fixture reuse)
from tests.test_stock import _create_product as _create_plain_product

CONFLICT = "Idempotency-Key already used with a different payload"


def _shipped(client, headers, *, batch=True, stock="10", quantity="6"):
    customer = sales._create_customer(client, headers)
    if batch:
        product = sales._create_product(client, headers)
        sales._create_batch(client, headers, product["id"], quantity=stock, expiry_days=90)
    else:
        product = _create_plain_product(client, headers, initial_stock=stock)
    order = sales._create_sales_order(client, headers, customer["id"], product["id"], quantity=quantity,
                                      unit_price=1)
    order_id = order["sales_order_id"]
    sales._confirm_sales_order(client, headers, order_id)
    sales._ready_sales_order(client, headers, order_id)
    sales._ship_sales_order(client, headers, order_id)
    return order_id, product["id"]


def _return(client, headers, order_id, items, key):
    request_headers = dict(headers)
    if key is not None:
        request_headers["Idempotency-Key"] = key
    return client.post(f"/api/v1/sales-orders/{order_id}/return", headers=request_headers, json={"items": items})


def _item(product_id, quantity, reason="Damaged"):
    return {"product_id": product_id, "quantity": quantity, "reason": reason}


def _state(db, order_id, product_id):
    """Every place a return writes: balances, ledger, transactions, audit, receipts, derived totals."""
    db.expire_all()
    balances = db.query(func.coalesce(func.sum(StockBalance.on_hand_qty), 0),
                        func.coalesce(func.sum(StockBalance.reserved_qty), 0)).filter_by(product_id=product_id).one()
    movements = db.query(InventoryMovement).filter_by(movement_type="SALES_RETURN", reference_id=order_id,
                                                      product_id=product_id)
    return {
        "on_hand": Decimal(balances[0]), "reserved": Decimal(balances[1]),
        "stock_qty": db.get(Product, product_id).stock_qty,
        "movements": movements.count(),
        "moved": Decimal(sum((m.quantity for m in movements), Decimal(0))),
        "transactions": db.query(StockTransaction).filter_by(product_id=product_id,
                                                             transaction_type="SALE_RETURN").count(),
        "audits": db.query(AuditLog).filter_by(action="SALES_RETURN", record_id=order_id).count(),
        "receipts": db.query(SalesReturnReceipt).filter_by(sales_order_id=order_id).count(),
    }


# --------------------------------------------------------------------------------------------
# The original defect: a retried partial return applied twice
# --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("batch", [True, False])
def test_retried_partial_return_restocks_exactly_once(client, admin_headers, db_session, batch):
    order_id, product_id = _shipped(client, admin_headers, batch=batch)
    before = _state(db_session, order_id, product_id)
    key = uuid4().hex

    first = _return(client, admin_headers, order_id, [_item(product_id, 2)], key)
    assert first.status_code == 200, first.text
    # The client never saw `first` (lost response / timeout) and resubmits the same intent.
    retry = _return(client, admin_headers, order_id, [_item(product_id, 2)], key)
    assert retry.status_code == 200, retry.text
    assert retry.json() == first.json()  # replayed, byte-for-byte the same body

    after = _state(db_session, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + 2  # NOT +4 as before V1-H1
    assert after["stock_qty"] == before["stock_qty"] + 2
    assert after["moved"] == Decimal("2") and after["movements"] >= 1
    assert after["transactions"] == before["transactions"] + 1
    assert after["audits"] == before["audits"] + 1
    assert after["receipts"] == 1
    returned = first.json()["data"]["returned_items"][0]
    assert sales._decimal(returned["total_returned"]) == Decimal("2")
    assert sales._decimal(returned["remaining_returnable"]) == Decimal("4")


def test_a_new_key_is_a_new_partial_return(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    before = _state(db_session, order_id, product_id)
    for _ in range(2):
        response = _return(client, admin_headers, order_id, [_item(product_id, 2)], uuid4().hex)
        assert response.status_code == 200, response.text
    after = _state(db_session, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + 4
    assert after["receipts"] == 2 and after["audits"] == before["audits"] + 2
    assert sales._decimal(response.json()["data"]["returned_items"][0]["total_returned"]) == Decimal("4")


def test_same_key_with_a_different_payload_is_409_and_changes_nothing(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    key = uuid4().hex
    assert _return(client, admin_headers, order_id, [_item(product_id, 2)], key).status_code == 200
    applied = _state(db_session, order_id, product_id)
    for items in ([_item(product_id, 3)], [_item(product_id, 2, reason="Other reason")]):
        response = _return(client, admin_headers, order_id, items, key)
        assert response.status_code == 409
        assert response.json()["message"] == CONFLICT
        assert _state(db_session, order_id, product_id) == applied


def test_quantity_spelling_does_not_change_the_fingerprint(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    key = uuid4().hex
    bodies = [_return(client, admin_headers, order_id, [_item(product_id, quantity)], key)
              for quantity in (2, "2", "2.0", "2.000")]
    assert [b.status_code for b in bodies] == [200, 200, 200, 200]
    assert all(b.json() == bodies[0].json() for b in bodies)
    assert _state(db_session, order_id, product_id)["receipts"] == 1


def test_the_same_key_on_another_order_is_independent(client, admin_headers, db_session):
    key = uuid4().hex
    first_order, first_product = _shipped(client, admin_headers)
    second_order, second_product = _shipped(client, admin_headers)
    assert _return(client, admin_headers, first_order, [_item(first_product, 1)], key).status_code == 200
    response = _return(client, admin_headers, second_order, [_item(second_product, 1)], key)
    assert response.status_code == 200
    assert response.json()["data"]["sales_order_id"] == second_order
    assert _state(db_session, second_order, second_product)["receipts"] == 1


# --------------------------------------------------------------------------------------------
# Validation: key and payload
# --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("key", [None, "", "x" * 129, "has space", "bad/slash", "quote\"key"])
def test_missing_or_invalid_key_is_422_and_changes_nothing(client, admin_headers, db_session, key):
    order_id, product_id = _shipped(client, admin_headers)
    before = _state(db_session, order_id, product_id)
    response = _return(client, admin_headers, order_id, [_item(product_id, 1)], key)
    assert response.status_code == 422
    assert _state(db_session, order_id, product_id) == before


def test_duplicate_product_ids_are_422_and_change_nothing(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    before = _state(db_session, order_id, product_id)
    response = _return(client, admin_headers, order_id, [_item(product_id, 1), _item(product_id, 1)], uuid4().hex)
    assert response.status_code == 422
    assert "Duplicate product_id" in response.text
    assert _state(db_session, order_id, product_id) == before


def test_return_above_the_sold_quantity_is_409_and_leaves_no_receipt(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers, quantity="6")
    before = _state(db_session, order_id, product_id)
    key = uuid4().hex
    response = _return(client, admin_headers, order_id, [_item(product_id, 7)], key)
    assert response.status_code == 409
    assert "Remaining: 6" in response.json()["message"]
    assert _state(db_session, order_id, product_id) == before  # receipt rolled back with the refusal
    # Nothing was recorded for the key, so a corrected request with it applies (once).
    assert _return(client, admin_headers, order_id, [_item(product_id, 6)], key).status_code == 200
    assert _return(client, admin_headers, order_id, [_item(product_id, 6)], key).status_code == 200
    after = _state(db_session, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + 6 and after["receipts"] == 1
    over = _return(client, admin_headers, order_id, [_item(product_id, 1)], uuid4().hex)
    assert over.status_code == 409 and "Remaining: 0" in over.json()["message"]


def test_order_not_yet_shipped_is_409_before_any_receipt(client, admin_headers, db_session):
    customer = sales._create_customer(client, admin_headers)
    product = _create_plain_product(client, admin_headers, initial_stock="5")
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="2", unit_price=1)
    sales._confirm_sales_order(client, admin_headers, order["sales_order_id"])
    response = _return(client, admin_headers, order["sales_order_id"], [_item(product["id"], 1)], uuid4().hex)
    assert response.status_code == 409
    assert _state(db_session, order["sales_order_id"], product["id"])["receipts"] == 0


# --------------------------------------------------------------------------------------------
# Atomicity
# --------------------------------------------------------------------------------------------

def test_failure_mid_return_rolls_back_receipt_and_stock(admin_headers, db_session, monkeypatch):
    with TestClient(app) as setup:
        order_id, product_id = _shipped(setup, admin_headers)
    before = _state(db_session, order_id, product_id)
    key = uuid4().hex

    def explode(self, product_id, actor):
        raise RuntimeError("simulated failure after the stock mutation")
    with monkeypatch.context() as patch:
        patch.setattr(StockBalanceRepository, "sync_aggregates", explode)
        with TestClient(app, raise_server_exceptions=False) as failing:
            response = _return(failing, admin_headers, order_id, [_item(product_id, 2)], key)
    assert response.status_code == 500
    assert _state(db_session, order_id, product_id) == before  # no receipt, balance, ledger or audit row

    with TestClient(app) as retrying:
        assert _return(retrying, admin_headers, order_id, [_item(product_id, 2)], key).status_code == 200
        assert _return(retrying, admin_headers, order_id, [_item(product_id, 2)], key).status_code == 200
    after = _state(db_session, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + 2 and after["receipts"] == 1


# --------------------------------------------------------------------------------------------
# Batch accounting, ledger and audit
# --------------------------------------------------------------------------------------------

def test_multi_batch_return_restores_each_allocation_once(client, admin_headers, db_session):
    customer = sales._create_customer(client, admin_headers)
    product = sales._create_product(client, admin_headers)
    sales._create_batch(client, admin_headers, product["id"], quantity="3", expiry_days=30)
    sales._create_batch(client, admin_headers, product["id"], quantity="3", expiry_days=90)
    order = sales._create_sales_order(client, admin_headers, customer["id"], product["id"], quantity="5",
                                      unit_price=1)
    order_id = order["sales_order_id"]
    sales._confirm_sales_order(client, admin_headers, order_id)
    sales._ready_sales_order(client, admin_headers, order_id)
    sales._ship_sales_order(client, admin_headers, order_id)
    before = _state(db_session, order_id, product["id"])
    key = uuid4().hex
    for _ in range(3):
        assert _return(client, admin_headers, order_id, [_item(product["id"], 4)], key).status_code == 200

    after = _state(db_session, order_id, product["id"])
    assert after["on_hand"] == before["on_hand"] + 4 and after["moved"] == Decimal("4")
    assert after["movements"] == 2  # one SALES_RETURN movement per batch allocation, written once
    assert after["transactions"] == before["transactions"] + 1 and after["receipts"] == 1
    db_session.expire_all()
    batches = db_session.query(ProductBatch).filter_by(product_id=product["id"]).all()
    per_batch = {b.id: db_session.query(func.coalesce(func.sum(StockBalance.on_hand_qty), 0))
                 .filter_by(batch_id=b.id).scalar() for b in batches}
    assert all(b.quantity == per_batch[b.id] for b in batches)  # batch totals match their balances
    assert sum(per_batch.values()) == after["on_hand"] == after["stock_qty"]
    assert after["reserved"] == 0  # a return never touches reservations


def test_audit_is_written_once_and_names_the_receipt(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    key = uuid4().hex
    for _ in range(2):
        assert _return(client, admin_headers, order_id, [_item(product_id, 1)], key).status_code == 200
    db_session.expire_all()
    receipt = db_session.query(SalesReturnReceipt).filter_by(sales_order_id=order_id).one()
    audits = db_session.query(AuditLog).filter_by(action="SALES_RETURN", record_id=order_id).all()
    assert len(audits) == 1
    assert audits[0].description.endswith(f"Receipt: {receipt.receipt_number}")
    assert receipt.operation_key == key and receipt.receipt_number.startswith("SRR-")
    # The ledger lookup that caps returns still matches the unchanged remark format.
    remark = db_session.query(StockTransaction).filter_by(product_id=product_id,
                                                          transaction_type="SALE_RETURN").one().remark
    assert remark.startswith("Return from ") and remark.endswith("Reason: Damaged")


# --------------------------------------------------------------------------------------------
# Authorisation is checked before any replay
# --------------------------------------------------------------------------------------------

def test_warehouse_and_admin_may_return_others_may_not_even_replay(client, admin_headers, warehouse_headers,
                                                                   db_session):
    order_id, product_id = _shipped(client, admin_headers)
    key = uuid4().hex
    assert _return(client, warehouse_headers, order_id, [_item(product_id, 1)], key).status_code == 200
    applied = _state(db_session, order_id, product_id)

    viewer = User(username=f"viewer_{uuid4().hex[:8]}", password_hash="unused", role="VIEWER")
    db_session.add(viewer)
    db_session.commit()
    viewer_headers = {"Authorization": "Bearer " + create_access_token({"sub": str(viewer.id)})}
    forbidden = _return(client, viewer_headers, order_id, [_item(product_id, 1)], key)
    assert forbidden.status_code == 403
    assert "returned_items" not in forbidden.text  # the stored response is not disclosed
    unauthenticated = _return(client, {}, order_id, [_item(product_id, 1)], key)
    assert unauthenticated.status_code == 401
    assert "returned_items" not in unauthenticated.text

    assert _return(client, admin_headers, order_id, [_item(product_id, 1)], key).status_code == 200  # replay
    assert _state(db_session, order_id, product_id) == applied


# --------------------------------------------------------------------------------------------
# Real PostgreSQL concurrency (independent connections, isolated schema)
# --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("track_batch", [False, True])
def test_concurrent_identical_requests_with_one_key_apply_once(concurrent_inventory, track_batch):
    s = concurrent_inventory
    order_id, product_id = _shipped(s.client, s.headers, batch=track_batch, stock="10", quantity="6")
    with s.sessions() as db:
        before = _state(db, order_id, product_id)
    key = uuid4().hex
    request = ("POST", f"/api/v1/sales-orders/{order_id}/return",
               {"items": [_item(product_id, "2.000", reason="Race")]}, key)
    responses = overlap(s, [request, request], "sales_orders", [order_id])
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert responses[0].json() == responses[1].json()  # one applied, the other replayed
    with s.sessions() as db:
        after = _state(db, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + 2
    assert after["transactions"] == before["transactions"] + 1
    assert after["audits"] == before["audits"] + 1 and after["receipts"] == 1


def test_concurrent_same_key_different_payloads_one_applies_one_conflicts(concurrent_inventory):
    s = concurrent_inventory
    order_id, product_id = _shipped(s.client, s.headers, batch=False, stock="10", quantity="6")
    with s.sessions() as db:
        before = _state(db, order_id, product_id)
    key = uuid4().hex
    requests = [("POST", f"/api/v1/sales-orders/{order_id}/return", {"items": [_item(product_id, q)]}, key)
                for q in ("1.000", "3.000")]
    responses = overlap(s, requests, "sales_orders", [order_id])
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(r for r in responses if r.status_code == 200)
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["message"] == CONFLICT
    applied = sales._decimal(winner.json()["data"]["returned_items"][0]["returned_quantity"])
    with s.sessions() as db:
        after = _state(db, order_id, product_id)
    assert after["on_hand"] == before["on_hand"] + applied and after["receipts"] == 1
