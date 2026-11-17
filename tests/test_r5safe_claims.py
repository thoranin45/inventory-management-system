"""R5-SAFE.1B — service-level fulfilment claim primitives (NOT reachable through HTTP).

Orders are created and advanced through the existing legacy routes; claims are
exercised only by calling the integrity service directly.
"""
import hashlib
from uuid import uuid4

import pytest

from app.core.exceptions import AppException
from app.core.fulfillment_claim import claim_token_matches, generate_claim_token, hash_claim_token
from app.core.security import hash_password
from app.models import AuditLog, FulfillmentReconciliation, SalesOrder, User
from app.repositories.sales_order_repository import SalesOrderRepository
from app.services.fulfillment_integrity_service import (
    FulfillmentClaimHeld,
    acquire_fulfillment_claim,
    verify_fulfillment_claim,
)
from tests import test_sales_order as sales
from tests.test_sales_order_fulfillment import advance
from tests.test_stock import _create_product


# --------------------------------------------------------------------------- shared helpers (also used by sibling files)


def make_user(db, role="WAREHOUSE", active=True):
    user = User(username=f"r5safe_{role.lower()}_{uuid4().hex[:8]}", password_hash=hash_password("R5safeTest123!"),
                role=role, is_active=active)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_order(client, headers, state="PICKING", quantity="2.000", stock="5.000"):
    product = _create_product(client, headers, initial_stock=stock)
    customer = sales._create_customer(client, headers)
    order = sales._create_sales_order(client, headers, customer["id"], product["id"], quantity=quantity, unit_price=1)
    advance(client, headers, order["sales_order_id"], state)
    return product, order["sales_order_id"]


def acquire(db, order_id, user, phase="PICK", **kwargs):
    kwargs.setdefault("expected_epoch", order_row(db, order_id).fulfillment_claim_epoch)
    return acquire_fulfillment_claim(db, SalesOrderRepository(db), sales_order_id=order_id, current_user=user,
                                     phase=phase, **kwargs)


def order_row(db, order_id):
    db.expire_all()
    return db.get(SalesOrder, order_id)


def reconciliations(db, order_id):
    db.expire_all()
    return db.query(FulfillmentReconciliation).filter_by(sales_order_id=order_id).order_by(FulfillmentReconciliation.id).all()


def audits(db, order_id, action):
    db.expire_all()
    return db.query(AuditLog).filter_by(table_name="sales_orders", record_id=order_id, action=action).all()


# --------------------------------------------------------------------------- token primitives


def test_tokens_are_unpredictable_and_only_their_hash_is_comparable():
    tokens = {generate_claim_token() for _ in range(50)}
    assert len(tokens) == 50 and all(len(t) >= 43 for t in tokens)  # 32 random bytes, url-safe
    token = next(iter(tokens))
    digest = hash_claim_token(token)
    assert digest == hashlib.sha256(token.encode()).hexdigest() and len(digest) == 64 and token not in digest
    assert claim_token_matches(token, digest)
    assert not claim_token_matches(token + "x", digest)
    assert not claim_token_matches(None, digest) and not claim_token_matches("", digest)
    assert not claim_token_matches(token, None) and not claim_token_matches(token, digest[:-1])


# --------------------------------------------------------------------------- acquisition


def test_acquire_issues_token_once_and_stores_only_its_hash(client, admin_headers, db_session):
    _, order_id = make_order(client, admin_headers)
    worker = make_user(db_session)
    claim = acquire(db_session, order_id, worker)
    assert claim["claim_epoch"] == 1 and claim["phase"] == "PICK" and claim["holder_user_id"] == worker.id
    assert claim["reconciliation_required"] is False
    row = order_row(db_session, order_id)
    assert row.fulfillment_claim_token_hash == hash_claim_token(claim["claim_token"])
    assert row.fulfillment_claim_token_hash != claim["claim_token"]
    assert (row.fulfillment_claim_user_id, row.fulfillment_claim_phase, row.fulfillment_claim_epoch) == (worker.id, "PICK", 1)
    assert row.fulfillment_claim_acquired_at is not None
    [audit] = audits(db_session, order_id, "FULFILLMENT_CLAIM_ACQUIRED")
    assert claim["claim_token"] not in audit.description and row.fulfillment_claim_token_hash not in audit.description
    assert reconciliations(db_session, order_id) == []


def test_active_claim_is_never_preempted_without_explicit_takeover(client, admin_headers, db_session):
    _, order_id = make_order(client, admin_headers)
    holder, other = make_user(db_session), make_user(db_session)
    first = acquire(db_session, order_id, holder)
    for user, mine in ((other, False), (holder, True)):
        with pytest.raises(FulfillmentClaimHeld) as held:
            acquire(db_session, order_id, user)
        assert held.value.status_code == 409 and held.value.holder_user_id == holder.id
        assert held.value.held_by_you is mine and "claim_token" not in vars(held.value)
    row = order_row(db_session, order_id)
    assert row.fulfillment_claim_epoch == 1 and row.fulfillment_claim_token_hash == hash_claim_token(first["claim_token"])


def test_phase_must_match_order_state(client, admin_headers, db_session):
    _, order_id = make_order(client, admin_headers, state="PICKING")
    with pytest.raises(AppException) as err:
        acquire(db_session, order_id, make_user(db_session), phase="PACK")
    assert (err.value.status_code, err.value.message) == (409, "FULFILLMENT_PHASE_MISMATCH")
    with pytest.raises(AppException) as err:
        acquire(db_session, order_id, make_user(db_session), phase="SHIP")
    assert err.value.status_code == 422
    _, confirmed = make_order(client, admin_headers, state="CONFIRMED")
    with pytest.raises(AppException) as err:
        acquire(db_session, confirmed, make_user(db_session))
    assert err.value.message == "FULFILLMENT_PHASE_MISMATCH"
    assert order_row(db_session, confirmed).fulfillment_claim_epoch == 0


@pytest.mark.parametrize("role,active", [("viewer", True), ("WAREHOUSE", False)])
def test_unauthorized_users_cannot_acquire(client, admin_headers, db_session, role, active):
    _, order_id = make_order(client, admin_headers)
    with pytest.raises(AppException) as err:
        acquire(db_session, order_id, make_user(db_session, role=role, active=active))
    assert err.value.status_code == 403
    assert order_row(db_session, order_id).fulfillment_claim_token_hash is None


# --------------------------------------------------------------------------- takeover


def test_self_takeover_fences_the_old_token_and_requires_reconciliation(client, admin_headers, db_session):
    _, order_id = make_order(client, admin_headers)
    worker = make_user(db_session)
    old = acquire(db_session, order_id, worker)
    new = acquire(db_session, order_id, worker, takeover=True, reason="explicit device recovery")
    assert new["claim_epoch"] == 2 and new["claim_token"] != old["claim_token"] and new["reconciliation_required"] is True
    row = order_row(db_session, order_id)
    with pytest.raises(AppException) as err:
        verify_fulfillment_claim(row, worker, old["claim_token"], old["claim_epoch"], "PICK")
    assert err.value.message == "FULFILLMENT_CLAIM_INVALID"
    verify_fulfillment_claim(row, worker, new["claim_token"], 2, "PICK")  # the new claim is valid
    [record] = reconciliations(db_session, order_id)
    assert (record.status, record.reason_code, record.opened_epoch, record.phase) == ("REQUIRED", "SELF_TAKEOVER", 2, "PICK")
    assert record.supervisor_user_id is None and record.resolved_at is None
    [audit] = audits(db_session, order_id, "FULFILLMENT_CLAIM_TAKEOVER")
    assert old["claim_token"] not in audit.description and new["claim_token"] not in audit.description


def test_cross_user_takeover_is_admin_only_and_needs_a_reason(client, admin_headers, admin_user, db_session):
    _, order_id = make_order(client, admin_headers)
    holder, colleague = make_user(db_session), make_user(db_session)
    acquire(db_session, order_id, holder)
    with pytest.raises(AppException) as err:
        acquire(db_session, order_id, colleague, takeover=True, reason="shift change")
    assert (err.value.status_code, err.value.message) == (403, "FULFILLMENT_TAKEOVER_FORBIDDEN")
    with pytest.raises(AppException) as err:
        acquire(db_session, order_id, admin_user, takeover=True, reason="   ")
    assert (err.value.status_code, err.value.message) == (422, "FULFILLMENT_TAKEOVER_REASON_REQUIRED")
    row = order_row(db_session, order_id)
    assert row.fulfillment_claim_user_id == holder.id and row.fulfillment_claim_epoch == 1  # nothing changed

    taken = acquire(db_session, order_id, admin_user, takeover=True, reason="holder's device lost")
    assert taken["claim_epoch"] == 2 and taken["holder_user_id"] == admin_user.id
    [record] = reconciliations(db_session, order_id)
    assert (record.reason_code, record.status, record.supervisor_user_id, record.notes) == (
        "TAKEOVER", "REQUIRED", admin_user.id, "holder's device lost")


def test_a_second_takeover_supersedes_the_open_reconciliation(client, admin_headers, admin_user, db_session):
    _, order_id = make_order(client, admin_headers)
    worker = make_user(db_session)
    acquire(db_session, order_id, worker)
    acquire(db_session, order_id, worker, takeover=True, reason="explicit device recovery")
    acquire(db_session, order_id, admin_user, takeover=True, reason="supervisor recount")
    first, second = reconciliations(db_session, order_id)
    assert (first.status, first.resolved_at is not None, first.resolved_by_user_id) == ("SUPERSEDED", True, admin_user.id)
    assert (second.status, second.reason_code, second.opened_epoch) == ("REQUIRED", "TAKEOVER", 3)
    assert order_row(db_session, order_id).fulfillment_claim_epoch == 3


# --------------------------------------------------------------------------- verification


def test_verification_checks_token_epoch_holder_and_phase(client, admin_headers, db_session):
    _, order_id = make_order(client, admin_headers)
    worker, other = make_user(db_session), make_user(db_session)
    row = order_row(db_session, order_id)
    with pytest.raises(AppException) as err:
        verify_fulfillment_claim(row, worker, "anything", 0, "PICK")
    assert err.value.message == "FULFILLMENT_CLAIM_REQUIRED"
    claim = acquire(db_session, order_id, worker)
    row = order_row(db_session, order_id)
    for user, token, epoch in ((worker, claim["claim_token"] + "x", 1), (worker, claim["claim_token"], 2),
                               (other, claim["claim_token"], 1), (worker, None, 1)):
        with pytest.raises(AppException) as err:
            verify_fulfillment_claim(row, user, token, epoch, "PICK")
        assert (err.value.status_code, err.value.message) == (409, "FULFILLMENT_CLAIM_INVALID")
    with pytest.raises(AppException) as err:
        verify_fulfillment_claim(row, worker, claim["claim_token"], 1, "PACK")
    assert err.value.message == "FULFILLMENT_CLAIM_PHASE_MISMATCH"
    verify_fulfillment_claim(row, worker, claim["claim_token"], 1, "PICK")


def test_a_claim_left_behind_by_a_legacy_phase_change_no_longer_verifies(client, admin_headers, db_session):
    """Legacy complete-picking (route unchanged in 1B) does not clear the claim; the order state check fences it."""
    _, order_id = make_order(client, admin_headers, quantity="1.000")
    worker = make_user(db_session)
    claim = acquire(db_session, order_id, worker)
    sales._scan_fulfillment_to_full(client, admin_headers, order_id, packing=False)
    assert client.post(f"/api/v1/sales-orders/{order_id}/complete-picking", headers=admin_headers,
                       json=sales._fulfillment_payload(client, admin_headers, order_id)).status_code == 200
    row = order_row(db_session, order_id)
    assert row.status == "PACKING"
    with pytest.raises(AppException) as err:
        verify_fulfillment_claim(row, worker, claim["claim_token"], claim["claim_epoch"], "PICK")
    assert err.value.message == "FULFILLMENT_CLAIM_PHASE_MISMATCH"
    # the stale metadata is still there (1B does not touch legacy routes) — only the state check fences it
    assert (row.fulfillment_claim_phase, row.fulfillment_claim_epoch) == ("PICK", claim["claim_epoch"])


@pytest.mark.parametrize("operation", ["acquire", "takeover"])
def test_duplicate_lifecycle_request_does_not_rotate_again(client, admin_headers, db_session, operation):
    _, order_id = make_order(client, admin_headers)
    worker = make_user(db_session)
    old = acquire(db_session, order_id, worker, expected_epoch=0)
    expected = 0
    kwargs = {}
    if operation == "takeover":
        expected = 1
        kwargs = {"takeover": True, "reason": "lost response recovery"}
        old = acquire(db_session, order_id, worker, expected_epoch=expected, **kwargs)
    with pytest.raises(AppException, match="FULFILLMENT_EPOCH_CONFLICT"):
        acquire(db_session, order_id, worker, expected_epoch=expected, **kwargs)
    row = order_row(db_session, order_id)
    assert row.fulfillment_claim_epoch == old["claim_epoch"]
    assert row.fulfillment_claim_token_hash == hash_claim_token(old["claim_token"])


def test_resume_does_not_reissue_token(client, admin_headers, db_session):
    from app.services.fulfillment_integrity_service import validate_fulfillment_claim
    _, order_id = make_order(client, admin_headers)
    worker = make_user(db_session)
    claim = acquire(db_session, order_id, worker)
    result = validate_fulfillment_claim(db_session, SalesOrderRepository(db_session), sales_order_id=order_id,
        current_user=worker, phase="PICK", expected_epoch=1, claim_token=claim["claim_token"])
    assert result["claim_epoch"] == 1 and "claim_token" not in result
    assert order_row(db_session, order_id).fulfillment_claim_token_hash == hash_claim_token(claim["claim_token"])
