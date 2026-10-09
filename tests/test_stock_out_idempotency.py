"""Phase 14A — Idempotency-Key on POST /stock/out-fifo and POST /stock/out-fefo.

Same key + same payload  -> the deduction is applied once; later calls replay
                            the stored response (no second movement / audit).
Same key + different body -> 409, nothing applied.
No key                   -> legacy behaviour, no receipt row (backward compat).

Mirrors tests/test_stock_in_idempotency.py's shape exactly — the backend
mechanism (StockOperationReceipt, IdempotencyKeyConflictException,
create_operation_receipt's SAVEPOINT) is reused verbatim from Phase 13; these
tests exercise it for Stock Out specifically.

FIFO/FEFO only ever consume from BATCH balances (get_fifo/fefo_batches_for_update),
never the unbatched balance /stock/in writes to — so every seed here goes
through _create_batch (which flips the product to track_batch=True), exactly
like the pre-existing Stock-Out regression tests in test_stock.py.
"""
from uuid import uuid4

import pytest

from app.models import AuditLog, InventoryMovement, StockOperationReceipt, StockTransaction
from tests.test_stock import _create_batch, _create_product, _make_product


def _key() -> str:
    return f"stockout-{uuid4().hex}"


def _seeded_product(client, admin_headers, quantity: int = 10) -> dict:
    """A track_batch product with one eligible (far-from-expiry) lot, the only
    kind of stock FIFO/FEFO can ever deduct from."""
    product = _create_product(client=client, admin_headers=admin_headers)
    _create_batch(client=client, admin_headers=admin_headers, product_id=product["id"],
                   quantity=quantity, expiry_days=180)
    return product


# --------------------------------------------------------------------------- #
# POST /stock/out-fifo
# --------------------------------------------------------------------------- #
def test_stock_out_fifo_same_key_same_payload_applies_once_and_replays(client, admin_headers, db_session):
    product = _seeded_product(client, admin_headers, 10)
    body = {"product_id": product["id"], "quantity": "4.000", "remark": "pick"}
    key = _key()

    first = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 200, first.text
    first_data = first.json()["data"]
    assert first_data["difference"] == "-4.000" or float(first_data["difference"]) == -4.0

    second = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert second.status_code == 200, second.text
    assert second.json()["data"] == first_data  # byte-identical replay

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_OUT_FIFO").count() == 1
    assert db_session.query(StockTransaction).filter_by(
        product_id=product["id"], transaction_type="OUT_FIFO").count() == 1
    assert db_session.query(AuditLog).filter_by(action="STOCK_OUT_FIFO").filter(
        AuditLog.description.like(f"Product {product['id']};%")).count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1

    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 6.0  # 10 - 4, applied exactly once


def test_stock_out_fefo_same_key_same_payload_applies_once_and_replays(client, admin_headers, db_session):
    product = _seeded_product(client, admin_headers, 10)
    body = {"product_id": product["id"], "quantity": "3.000"}
    key = _key()

    first = client.post("/api/v1/stock/out-fefo", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 200, first.text
    first_data = first.json()["data"]

    second = client.post("/api/v1/stock/out-fefo", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert second.status_code == 200, second.text
    assert second.json()["data"] == first_data

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_OUT_FEFO").count() == 1
    assert db_session.query(AuditLog).filter_by(action="STOCK_OUT_FEFO").filter(
        AuditLog.description.like(f"Product {product['id']};%")).count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1

    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 7.0  # 10 - 3, applied exactly once


def test_stock_out_fifo_same_key_different_payload_conflicts(client, admin_headers, db_session):
    product = _seeded_product(client, admin_headers, 10)
    key = _key()

    ok = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key},
                     json={"product_id": product["id"], "quantity": "2.000"})
    assert ok.status_code == 200

    conflict = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key},
                           json={"product_id": product["id"], "quantity": "5.000"})
    assert conflict.status_code == 409
    assert "different payload" in conflict.text
    assert conflict.json()["request_id"]

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_OUT_FIFO").count() == 1
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 8.0  # 10 - 2; the conflicting call applied nothing


@pytest.mark.parametrize("endpoint,movement_type", [("out-fifo", "STOCK_OUT_FIFO"), ("out-fefo", "STOCK_OUT_FEFO")])
def test_stock_out_without_key_is_unchanged_and_records_no_receipt(
    client, admin_headers, db_session, endpoint, movement_type,
):
    product = _seeded_product(client, admin_headers, 10)
    body = {"product_id": product["id"], "quantity": "1.000"}
    receipts_before = db_session.query(StockOperationReceipt).count()

    a = client.post(f"/api/v1/stock/{endpoint}", headers=admin_headers, json=body)
    b = client.post(f"/api/v1/stock/{endpoint}", headers=admin_headers, json=body)
    assert a.status_code == 200 and b.status_code == 200

    db_session.expire_all()
    # No key -> no replay: both calls apply.
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type=movement_type).count() == 2
    assert db_session.query(StockOperationReceipt).count() == receipts_before  # no receipt written
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 8.0  # 10 - 1 - 1


def test_stock_out_key_reused_across_operation_type_conflicts(client, admin_headers):
    """A key committed on /stock/in cannot be replayed on /stock/out-fifo —
    the idempotency gate runs before any batch/stock lookup, so this is
    detected even on a product with no batch stock at all. A key committed on
    /stock/out-fifo likewise cannot be replayed on /stock/out-fefo: the
    fingerprint folds the operation tag in, and the stored operation_type is
    checked independently of the fingerprint too."""
    non_batch = _make_product(client, admin_headers, track_batch=False)
    key_a = f"stockin-{uuid4().hex}"

    assert client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key_a},
                       json={"product_id": non_batch["id"], "quantity": "1.000"}).status_code == 200

    crossed = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key_a},
                          json={"product_id": non_batch["id"], "quantity": "1.000"})
    assert crossed.status_code == 409
    assert "different payload" in crossed.text

    batch_product = _seeded_product(client, admin_headers, 10)
    key_b = _key()
    assert client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key_b},
                       json={"product_id": batch_product["id"], "quantity": "1.000"}).status_code == 200

    crossed_strategy = client.post("/api/v1/stock/out-fefo", headers={**admin_headers, "Idempotency-Key": key_b},
                                   json={"product_id": batch_product["id"], "quantity": "1.000"})
    assert crossed_strategy.status_code == 409
    assert "different payload" in crossed_strategy.text


@pytest.mark.parametrize("bad_key", ["with space", "x" * 129, "hash#tag"])
def test_stock_out_rejects_malformed_key(client, admin_headers, bad_key):
    product = _seeded_product(client, admin_headers, 5)
    r = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": bad_key},
                    json={"product_id": product["id"], "quantity": "1.000"})
    assert r.status_code == 422


def test_stock_out_insufficient_stock_leaves_key_reusable(client, admin_headers, db_session):
    """A rejected attempt (not enough stock) must never persist a receipt —
    the same key, retried with a corrected (smaller) quantity, must succeed
    rather than being treated as 'already consumed'. This is the lost-response
    / corrected-retry scenario: nothing should get the operator stuck."""
    product = _seeded_product(client, admin_headers, 5)
    key = _key()

    too_much = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key},
                           json={"product_id": product["id"], "quantity": "50.000"})
    assert too_much.status_code == 409

    db_session.expire_all()
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 0
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_OUT_FIFO").count() == 0
    assert db_session.query(StockTransaction).filter_by(
        product_id=product["id"], transaction_type="OUT_FIFO").count() == 0
    assert db_session.query(AuditLog).filter_by(action="STOCK_OUT_FIFO").filter(
        AuditLog.description.like(f"Product {product['id']};%")).count() == 0
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 5.0  # the failed attempt changed nothing — stock, movement, audit, receipt alike

    corrected = client.post("/api/v1/stock/out-fifo", headers={**admin_headers, "Idempotency-Key": key},
                            json={"product_id": product["id"], "quantity": "2.000"})
    assert corrected.status_code == 200, corrected.text

    db_session.expire_all()
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_OUT_FIFO").count() == 1
    assert db_session.query(StockTransaction).filter_by(
        product_id=product["id"], transaction_type="OUT_FIFO").count() == 1
    assert db_session.query(AuditLog).filter_by(action="STOCK_OUT_FIFO").filter(
        AuditLog.description.like(f"Product {product['id']};%")).count() == 1
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 3.0  # 5 - 2, the corrected retry applied exactly once
