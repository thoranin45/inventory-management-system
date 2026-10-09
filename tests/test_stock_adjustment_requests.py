"""Phase 14B — Stock Adjustment Request & Approval workflow.

Warehouse submits a request (never mutates stock); only Admin may approve
or reject it; approval reuses the exact same tested mutation core
(execute_adjustment_mutation) that the retired direct /stock/adjust used,
so the batch-tracking guard, locking, decimal precision and AuditLog shape
are provably unchanged. No self-approval. Multiple pending requests for the
same scope are permitted by design (D5) -- arbitrated safely at approval
time by a stale-quantity check, never blocked at creation.
"""
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import (
    AuditLog,
    InventoryMovement,
    StockAdjustmentRequest,
    StockOperationReceipt,
    StockTransaction,
    User,
)
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401
from tests.test_phase6_transfer_lifecycle import transit_ids  # noqa: F401
from tests.test_stock import _create_product, _get_product, _make_product


def _key(prefix: str = "adjreq") -> str:
    return f"{prefix}-{uuid4().hex}"


def _create_request(client, headers, *, product_id, observed="10.000", requested="15.000",
                     reason_code="CYCLE_COUNT_VARIANCE", notes=None, key=None, **extra):
    body = {
        "product_id": product_id, "observed_quantity": observed, "requested_quantity": requested,
        "reason_code": reason_code, **extra,
    }
    if notes is not None:
        body["notes"] = notes
    return client.post(
        "/api/v1/stock-adjustment-requests", headers={**headers, "Idempotency-Key": key or _key()}, json=body,
    )


def _approve(client, headers, request_id, key=None):
    return client.post(
        f"/api/v1/stock-adjustment-requests/{request_id}/approve",
        headers={**headers, "Idempotency-Key": key or _key("approve")},
    )


def _reject(client, headers, request_id, reason="Count was correct"):
    return client.post(
        f"/api/v1/stock-adjustment-requests/{request_id}/reject",
        headers=headers, json={"rejection_reason": reason},
    )


def _cancel(client, headers, request_id):
    return client.post(f"/api/v1/stock-adjustment-requests/{request_id}/cancel", headers=headers)


# --------------------------------------------------------------------------- #
# Create: never mutates stock
# --------------------------------------------------------------------------- #
def test_create_is_pending_and_never_mutates_stock(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="15.000")
    assert response.status_code == 201
    body = response.json()["data"]
    assert body["status"] == "PENDING"
    assert body["reference_number"].startswith("ADJ-")
    assert body["requested_by"]["username"]

    db_session.expire_all()
    product_after = _get_product(client, admin_headers, product["id"])
    assert Decimal(str(product_after["stock_qty"])) == Decimal("10.000")
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == 1  # the opening STOCK_IN only
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 1
    assert db_session.query(AuditLog).filter_by(table_name="stock_adjustment_requests", record_id=body["id"]).count() == 1


def test_create_rejects_batch_tracked_product(client, admin_headers, warehouse_headers):
    product = _make_product(client, admin_headers, track_batch=True, track_expiry=True)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000", requested="5.000")
    assert response.status_code == 409
    assert "Batch-tracked" in response.json()["message"]


def test_create_cannot_target_transit(client, admin_headers, warehouse_headers, transit_ids):
    product = _create_product(client, admin_headers)
    response = _create_request(
        client, warehouse_headers, product_id=product["id"], observed="0.000", requested="3.000", **transit_ids,
    )
    assert response.status_code == 409


def test_create_rejects_expiry_write_off_reason(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="0", requested="1",
                                reason_code="EXPIRY_WRITE_OFF")
    assert response.status_code == 422


def test_create_other_reason_requires_notes(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    response = _create_request(client, warehouse_headers, product_id=product["id"], observed="0", requested="1",
                                reason_code="OTHER")
    assert response.status_code == 422


def test_create_multiple_pending_for_same_scope_allowed(client, admin_headers, warehouse_headers):
    """D5: no uniqueness constraint on scope -- creation is never blocked by
    an existing pending sibling. Safety is arbitrated at approval time."""
    product = _create_product(client, admin_headers, initial_stock=10)
    first = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="8.000")
    second = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="9.000")
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["data"]["id"] != second.json()["data"]["id"]


# --------------------------------------------------------------------------- #
# Create idempotency
# --------------------------------------------------------------------------- #
def test_create_same_key_same_payload_replays(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    key = _key()
    first = _create_request(client, warehouse_headers, product_id=product["id"], key=key)
    second = _create_request(client, warehouse_headers, product_id=product["id"], key=key)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["data"] == second.json()["data"]
    db_session.expire_all()
    assert db_session.query(StockAdjustmentRequest).filter_by(product_id=product["id"]).count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1


def test_create_same_key_different_payload_conflicts(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers, initial_stock=10)
    key = _key()
    first = _create_request(client, warehouse_headers, product_id=product["id"], requested="15.000", key=key)
    second = _create_request(client, warehouse_headers, product_id=product["id"], requested="99.000", key=key)
    assert first.status_code == 201
    assert second.status_code == 409


def test_create_rejects_malformed_key(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    response = client.post(
        "/api/v1/stock-adjustment-requests", headers={**warehouse_headers, "Idempotency-Key": "has a space"},
        json={"product_id": product["id"], "observed_quantity": "0", "requested_quantity": "1",
              "reason_code": "CYCLE_COUNT_VARIANCE"},
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# List / detail authorization -- enforced server-side
# --------------------------------------------------------------------------- #
def test_list_scoped_to_requester_unless_admin(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    _create_request(client, warehouse_headers, product_id=product["id"])

    mine = client.get("/api/v1/stock-adjustment-requests", headers=warehouse_headers)
    assert mine.status_code == 200
    assert all(r["requested_by_user_id"] for r in mine.json()["data"]["items"])

    everyone = client.get("/api/v1/stock-adjustment-requests", headers=admin_headers)
    assert everyone.status_code == 200
    assert everyone.json()["data"]["pagination"]["total_items"] >= mine.json()["data"]["pagination"]["total_items"]


def test_detail_forbidden_for_non_owner_non_admin(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]

    other = User(username=f"other_wh_{uuid4().hex[:8]}", password_hash="unused", role="WAREHOUSE")
    db_session.add(other)
    db_session.commit()
    from app.core.security import create_access_token
    other_headers = {"Authorization": "Bearer " + create_access_token({"sub": str(other.id)})}

    response = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=other_headers)
    assert response.status_code == 403

    own = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=warehouse_headers)
    assert own.status_code == 200

    as_admin = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=admin_headers)
    assert as_admin.status_code == 200


def test_detail_includes_lifecycle_history_inline(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    _approve(client, admin_headers, created["id"])

    detail = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=admin_headers).json()["data"]
    actions = [h["action"] for h in detail["history"]]
    assert actions == ["CREATE_ADJUSTMENT_REQUEST", "APPROVE_ADJUSTMENT_REQUEST"]


# --------------------------------------------------------------------------- #
# Approve: reuses the tested mutation core
# --------------------------------------------------------------------------- #
def test_approve_applies_exactly_once_with_full_audit_separation(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="15.000").json()["data"]

    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["status"] == "APPROVED"

    db_session.expire_all()
    product_after = _get_product(client, admin_headers, product["id"])
    assert Decimal(str(product_after["stock_qty"])) == Decimal("15.000")

    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"], movement_type="STOCK_ADJUST").count() == 1
    transaction = db_session.query(StockTransaction).filter_by(product_id=product["id"], transaction_type="ADJUST").one()
    assert db_session.query(AuditLog).filter_by(
        action="STOCK_ADJUST", table_name="stock_transactions", record_id=transaction.id,
    ).count() == 1
    assert db_session.query(AuditLog).filter_by(
        action="APPROVE_ADJUSTMENT_REQUEST", table_name="stock_adjustment_requests", record_id=created["id"],
    ).count() == 1


def test_approve_preserves_batch_tracked_guard(client, admin_headers, warehouse_headers, db_session):
    """track_batch flips true after the request is created -- approve must
    still refuse, never weaken the guard execute_adjustment_mutation enforces."""
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="15.000").json()["data"]

    from app.models import Product
    row = db_session.query(Product).filter_by(id=product["id"]).one()
    # Simulate the product becoming batch-tracked after the request existed
    # (direct DB write -- normal API use can't reach this combination once
    # stock exists, mirrors test_stock.py's own residual-guard test).
    row.track_batch = True
    db_session.commit()

    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 409

    db_session.expire_all()
    refreshed = db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one()
    assert refreshed.status == "PENDING"


def test_self_approval_blocked(client, admin_headers, db_session):
    """Admin may also create (superset role); the SAME admin may never
    approve their own request."""
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, admin_headers, product_id=product["id"]).json()["data"]
    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one().status == "PENDING"


def test_approve_preserves_pending_data_on_stale_quantity_never_rebases(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="15.000").json()["data"]

    # Balance drifts away from what the requester observed.
    moved = client.post("/api/v1/stock/in", headers=admin_headers, json={"product_id": product["id"], "quantity": "3.000"})
    assert moved.status_code == 200

    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 409
    assert "already changed" in response.json()["message"]

    db_session.expire_all()
    refreshed = db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one()
    assert refreshed.status == "PENDING"
    assert refreshed.observed_quantity == Decimal("10.000")  # never silently rebased
    assert refreshed.requested_quantity == Decimal("15.000")


def test_approve_not_pending_names_current_status(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    _reject(client, admin_headers, created["id"])
    response = _approve(client, admin_headers, created["id"])
    assert response.status_code == 409
    assert "REJECTED" in response.json()["message"]


# --------------------------------------------------------------------------- #
# Approve idempotency: replay before terminal-state, new key after approved
# --------------------------------------------------------------------------- #
def test_approve_same_key_replays_even_once_terminal(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    key = _key("approve")
    first = _approve(client, admin_headers, created["id"], key=key)
    second = _approve(client, admin_headers, created["id"], key=key)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"] == second.json()["data"]

    db_session.expire_all()
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"], movement_type="STOCK_ADJUST").count() == 1
    assert db_session.query(StockOperationReceipt).filter_by(operation_key=key).count() == 1


def test_approve_new_key_after_already_approved_conflicts_without_remutating(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="15.000").json()["data"]
    first = _approve(client, admin_headers, created["id"])
    assert first.status_code == 200

    second = _approve(client, admin_headers, created["id"])  # independent, freshly-generated key
    assert second.status_code == 409
    assert "already decided" in second.json()["message"]

    db_session.expire_all()
    product_after = _get_product(client, admin_headers, product["id"])
    assert Decimal(str(product_after["stock_qty"])) == Decimal("15.000")  # applied exactly once
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"], movement_type="STOCK_ADJUST").count() == 1


# --------------------------------------------------------------------------- #
# ABA limitation: documented boundary, not silently wrong
# --------------------------------------------------------------------------- #
def test_quantity_only_concurrency_aba_limitation_is_bounded(client, admin_headers, warehouse_headers, db_session):
    """Named ABA problem: a plain quantity compare cannot distinguish
    "nothing changed" from "it changed away and came back to the same
    number before approval." Demonstrated here entirely through the new
    workflow's own mechanism -- two intervening create+approve cycles move
    the balance 10 -> 12 -> 10 while request R1 (observed=10) is still
    pending; R1's approval still succeeds, since the balance IS 10 again
    at that instant -- the two intervening movements are real, audited,
    and independently visible, just invisible to R1's own staleness check."""
    product = _create_product(client, admin_headers, initial_stock=10)
    r1 = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="8.000").json()["data"]

    r2 = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000", requested="12.000").json()["data"]
    assert _approve(client, admin_headers, r2["id"]).status_code == 200  # 10 -> 12

    r3 = _create_request(client, warehouse_headers, product_id=product["id"], observed="12.000", requested="10.000").json()["data"]
    assert _approve(client, admin_headers, r3["id"]).status_code == 200  # 12 -> 10 (back to R1's observed value)

    response = _approve(client, admin_headers, r1["id"])
    assert response.status_code == 200  # the known, accepted limitation: R1 can't see the round trip

    db_session.expire_all()
    movements = db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_ADJUST",
    ).order_by(InventoryMovement.id).all()
    assert len(movements) == 3  # R2's, R3's, and R1's own -- all independently audited


# --------------------------------------------------------------------------- #
# Reject / cancel
# --------------------------------------------------------------------------- #
def test_reject_requires_reason_and_never_mutates(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]

    blank = client.post(f"/api/v1/stock-adjustment-requests/{created['id']}/reject",
                         headers=admin_headers, json={"rejection_reason": "  "})
    assert blank.status_code == 422

    response = _reject(client, admin_headers, created["id"], reason="Counted again, original balance correct")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "REJECTED"

    db_session.expire_all()
    product_after = _get_product(client, admin_headers, product["id"])
    assert Decimal(str(product_after["stock_qty"])) == Decimal("10.000")
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 1  # opening stock-in only


def test_warehouse_cannot_reject(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    response = _reject(client, warehouse_headers, created["id"])
    assert response.status_code == 403


def test_cancel_by_owner_or_admin_only(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]

    other = User(username=f"other_wh_{uuid4().hex[:8]}", password_hash="unused", role="WAREHOUSE")
    db_session.add(other)
    db_session.commit()
    from app.core.security import create_access_token
    other_headers = {"Authorization": "Bearer " + create_access_token({"sub": str(other.id)})}

    forbidden = _cancel(client, other_headers, created["id"])
    assert forbidden.status_code == 403

    response = _cancel(client, warehouse_headers, created["id"])
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "CANCELLED"


def test_cannot_act_twice_on_a_terminal_request(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    _cancel(client, warehouse_headers, created["id"])
    again = _cancel(client, warehouse_headers, created["id"])
    assert again.status_code == 409


# --------------------------------------------------------------------------- #
# Concurrency: approve / reject / cancel racing on the SAME request
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("first_action,second_action", [
    ("approve", "reject"), ("approve", "cancel"), ("reject", "cancel"),
])
def test_concurrent_decisions_resolve_to_exactly_one_outcome(concurrent_inventory, first_action, second_action):
    s = concurrent_inventory
    product_resp = s.client.post("/api/v1/products", json={
        "sku": f"RACE-{uuid4().hex[:10].upper()}", "barcode": f"887{uuid4().hex[:10]}",
        "product_name": "Race product", "price": 10, "stock_qty": 0, "category_id": None,
    })
    assert product_resp.status_code in {200, 201}
    product_id = product_resp.json()["data"]["id"]
    stock_in = s.client.post("/api/v1/stock/in", json={"product_id": product_id, "quantity": "10.000"})
    assert stock_in.status_code == 200

    with s.sessions() as db:
        from app.models import User as UserModel
        requester = UserModel(username=f"race_requester_{uuid4().hex[:8]}", password_hash="unused", role="WAREHOUSE")
        db.add(requester)
        db.flush()
        request = StockAdjustmentRequest(
            reference_number=None, product_id=product_id,
            warehouse_id=s.storage["source_warehouse_id"], location_id=s.storage["source_location_id"],
            batch_id=None,
            observed_quantity=Decimal("10.000"), requested_quantity=Decimal("13.000"),
            reason_code="CYCLE_COUNT_VARIANCE", status="PENDING", requested_by_user_id=requester.id,
        )
        db.add(request)
        db.flush()
        request.reference_number = f"ADJ-{request.id:06d}"
        db.commit()
        request_id = request.id

    actions = {
        "approve": ("POST", f"/api/v1/stock-adjustment-requests/{request_id}/approve", None),
        "reject": ("POST", f"/api/v1/stock-adjustment-requests/{request_id}/reject", {"rejection_reason": "race test"}),
        "cancel": ("POST", f"/api/v1/stock-adjustment-requests/{request_id}/cancel", None),
    }
    responses = overlap(s, [actions[first_action], actions[second_action]], "stock_adjustment_requests", [request_id])

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 409]
    assert "already decided" in next(r for r in responses if r.status_code == 409).text

    with s.sessions() as db:
        final = db.query(StockAdjustmentRequest).filter_by(id=request_id).one()
        assert final.status != "PENDING"
        if final.status == "APPROVED":
            assert db.query(InventoryMovement).filter_by(product_id=product_id, movement_type="STOCK_ADJUST").count() == 1


# --------------------------------------------------------------------------- #
# Legacy endpoint stays retired, permanently
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("role_headers", ["admin_headers", "warehouse_headers"])
def test_legacy_stock_adjust_endpoint_stays_retired(client, admin_headers, warehouse_headers, request, role_headers):
    headers = request.getfixturevalue(role_headers)
    product = _create_product(client, admin_headers, initial_stock=5)
    response = client.post("/api/v1/stock/adjust", headers=headers,
                            json={"product_id": product["id"], "new_quantity": "99.000", "remark": "should never apply"})
    assert response.status_code == 409
    assert response.json()["message"].startswith("Direct stock adjustment is retired")


# --------------------------------------------------------------------------- #
# GET /warehouses
# --------------------------------------------------------------------------- #
def test_warehouses_excludes_transit_and_filters_active(client, admin_headers, transit_ids, db_session):
    response = client.get("/api/v1/warehouses", headers=admin_headers)
    assert response.status_code == 200
    codes = [w["warehouse_code"] for w in response.json()["data"]]
    assert "__TRANSIT__" not in codes
    assert "MAIN" in codes

    from app.models import Warehouse
    main = db_session.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    main.is_active = False
    db_session.commit()
    try:
        active_only = client.get("/api/v1/warehouses", headers=admin_headers).json()["data"]
        assert "MAIN" not in [w["warehouse_code"] for w in active_only]
        include_inactive = client.get("/api/v1/warehouses?active_only=false", headers=admin_headers).json()["data"]
        assert "MAIN" in [w["warehouse_code"] for w in include_inactive]
    finally:
        main.is_active = True
        db_session.commit()


def test_warehouses_nested_locations(client, admin_headers):
    response = client.get("/api/v1/warehouses", headers=admin_headers)
    main = next(w for w in response.json()["data"] if w["warehouse_code"] == "MAIN")
    assert any(l["location_code"] == "DEFAULT" for l in main["locations"])
