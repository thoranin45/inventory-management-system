"""Phase 12C.0 — Idempotency-Key on POST /stock/in and POST /batches.

Same key + same payload  -> the operation is applied once; later calls replay
                            the stored response (no second movement / audit).
Same key + different body -> 409, nothing applied.
No key                   -> legacy behaviour, no receipt row (backward compat).
"""
from uuid import uuid4

import pytest

from app.models import AuditLog, InventoryMovement, StockOperationReceipt
from tests.test_stock import _make_product


def _key() -> str:
    return f"stockin-{uuid4().hex}"


# --------------------------------------------------------------------------- #
# POST /stock/in  (non-batch)
# --------------------------------------------------------------------------- #
def test_stock_in_same_key_same_payload_applies_once_and_replays(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=False)
    body = {"product_id": product["id"], "quantity": "12.000", "remark": "opening"}
    key = _key()

    first = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 200, first.text
    first_data = first.json()["data"]
    assert first_data["difference"] == "12.000" or float(first_data["difference"]) == 12.0

    second = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert second.status_code == 200, second.text
    assert second.json()["data"] == first_data  # byte-identical replay

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_IN").count() == 1
    assert db_session.query(AuditLog).filter_by(action="STOCK_IN").filter(
        AuditLog.description.like(f"Product {product['id']};%")).count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1

    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 12.0  # applied exactly once


def test_stock_in_same_key_different_payload_conflicts(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=False)
    key = _key()

    ok = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key},
                     json={"product_id": product["id"], "quantity": "5.000"})
    assert ok.status_code == 200

    conflict = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key},
                           json={"product_id": product["id"], "quantity": "9.000"})
    assert conflict.status_code == 409
    assert "different payload" in conflict.text
    assert conflict.json()["request_id"]

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_IN").count() == 1
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 5.0  # the conflicting call applied nothing


def test_stock_in_same_key_different_product_conflicts(client, admin_headers, db_session):
    """Reusing a key for an unrelated product is still "a different payload":
    the fingerprint includes product_id, so this hits the same clean 409 as
    changing the quantity does — sequentially, this never reaches the DB
    unique constraint at all (the synchronous receipt check catches it first).
    The genuinely concurrent version of this, which does exercise the unique
    constraint, is `test_stock_in_same_idempotency_key_different_products_conflicts_safely`
    in test_inventory_concurrency.py.
    """
    first = _make_product(client, admin_headers, track_batch=False)
    second = _make_product(client, admin_headers, track_batch=False)
    key = _key()

    ok = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key},
                     json={"product_id": first["id"], "quantity": "4.000"})
    assert ok.status_code == 200

    conflict = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key},
                           json={"product_id": second["id"], "quantity": "4.000"})
    assert conflict.status_code == 409
    assert "different payload" in conflict.text
    assert conflict.json()["request_id"]

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(
        product_id=second["id"], movement_type="STOCK_IN").count() == 0  # the conflicting call applied nothing
    fresh_first = client.get(f"/api/v1/products/{first['id']}", headers=admin_headers).json()["data"]
    fresh_second = client.get(f"/api/v1/products/{second['id']}", headers=admin_headers).json()["data"]
    assert float(fresh_first["stock_qty"]) == 4.0
    assert float(fresh_second["stock_qty"]) == 0.0


def test_stock_in_without_key_is_unchanged_and_records_no_receipt(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=False)
    body = {"product_id": product["id"], "quantity": "4.000"}
    receipts_before = db_session.query(StockOperationReceipt).count()

    a = client.post("/api/v1/stock/in", headers=admin_headers, json=body)
    b = client.post("/api/v1/stock/in", headers=admin_headers, json=body)
    assert a.status_code == 200 and b.status_code == 200

    db_session.expire_all()
    # No key -> no replay: both calls apply.
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_IN").count() == 2
    assert db_session.query(StockOperationReceipt).count() == receipts_before  # no receipt written
    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 8.0


def test_stock_in_key_reused_across_operation_type_conflicts(client, admin_headers):
    """A key that succeeded on /stock/in cannot be replayed on /batches."""
    non_batch = _make_product(client, admin_headers, track_batch=False)
    batch_product = _make_product(client, admin_headers, track_batch=True, track_expiry=False)
    key = _key()

    assert client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": key},
                       json={"product_id": non_batch["id"], "quantity": "1.000"}).status_code == 200

    crossed = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": key},
                          json={"product_id": batch_product["id"], "lot_no": "LOT-X", "quantity": "1.000"})
    assert crossed.status_code == 409
    assert "different payload" in crossed.text


@pytest.mark.parametrize("bad_key", ["with space", "x" * 129, "hash#tag"])
def test_stock_in_rejects_malformed_key(client, admin_headers, bad_key):
    product = _make_product(client, admin_headers, track_batch=False)
    r = client.post("/api/v1/stock/in", headers={**admin_headers, "Idempotency-Key": bad_key},
                    json={"product_id": product["id"], "quantity": "1.000"})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# POST /batches
# --------------------------------------------------------------------------- #
def test_batch_in_same_key_same_payload_applies_once_and_replays(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=True, track_expiry=False)
    body = {"product_id": product["id"], "lot_no": "LOT-IDEM-1", "quantity": "25.000"}
    key = _key()

    first = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201, first.text
    first_data = first.json()["data"]
    batch_id = first_data["batch"]["id"]

    second = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": key}, json=body)
    assert second.status_code == 201, second.text
    assert second.json()["data"] == first_data  # replay, same batch id

    db_session.expire_all()
    from app.models import ProductBatch
    assert db_session.query(ProductBatch).filter_by(product_id=product["id"]).count() == 1
    assert db_session.query(ProductBatch).filter_by(product_id=product["id"]).one().id == batch_id
    assert db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="BATCH_IN").count() == 1
    assert db_session.query(AuditLog).filter_by(action="BATCH_IN", record_id=batch_id).count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key, operation_type="BATCH_IN").count() == 1

    fresh = client.get(f"/api/v1/products/{product['id']}", headers=admin_headers).json()["data"]
    assert float(fresh["stock_qty"]) == 25.0


def test_batch_in_same_key_different_payload_conflicts(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=True, track_expiry=False)
    key = _key()

    ok = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": key},
                     json={"product_id": product["id"], "lot_no": "LOT-A", "quantity": "3.000"})
    assert ok.status_code == 201

    conflict = client.post("/api/v1/batches", headers={**admin_headers, "Idempotency-Key": key},
                           json={"product_id": product["id"], "lot_no": "LOT-B", "quantity": "3.000"})
    assert conflict.status_code == 409
    assert "different payload" in conflict.text

    db_session.expire_all()
    from app.models import ProductBatch
    assert db_session.query(ProductBatch).filter_by(product_id=product["id"]).count() == 1  # LOT-B never created


def test_batch_in_without_key_records_no_receipt(client, admin_headers, db_session):
    product = _make_product(client, admin_headers, track_batch=True, track_expiry=False)
    receipts_before = db_session.query(StockOperationReceipt).count()
    r = client.post("/api/v1/batches", headers=admin_headers,
                    json={"product_id": product["id"], "lot_no": "LOT-NOKEY", "quantity": "2.000"})
    assert r.status_code == 201
    db_session.expire_all()
    assert db_session.query(StockOperationReceipt).count() == receipts_before
