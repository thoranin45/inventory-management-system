"""Mount only in a dedicated test application; production app must stay unchanged."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.dependencies import require_warehouse
from app.database import get_db
from app.main import app as production
from app.routers.fulfillment_claim_router import router
from tests.test_r5safe_claims import make_order, make_user


@pytest.fixture
def claim_api(db_session):
    app = FastAPI()
    app.include_router(router)
    user = make_user(db_session)
    app.dependency_overrides[require_warehouse] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as client:
        yield client


def url(order):
    return f"/api/v1/sales-orders/{order}/fulfillment/claim"


def test_production_router_is_unmounted():
    assert not any("/fulfillment/claim" in getattr(r, "path", "") for r in production.routes)


def test_claim_api_token_delivery_resume_and_release(client, admin_headers, db_session, claim_api):
    _, order = make_order(client, admin_headers)
    base = url(order)
    result = claim_api.post(base + "/acquire", json={"phase": "PICK", "expected_epoch": 0})
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    claim = result.json()
    token = claim["claim_token"]
    headers = {"X-Fulfillment-Claim-Token": token, "X-Fulfillment-Claim-Epoch": "1"}
    status = claim_api.get(base)
    assert status.status_code == 200 and token not in status.text and "token_hash" not in status.text
    valid = claim_api.post(base + "/validate", headers=headers, json={"phase": "PICK", "expected_epoch": 1})
    assert valid.status_code == 200 and token not in valid.text
    duplicate = claim_api.post(base + "/acquire", json={"phase": "PICK", "expected_epoch": 0})
    assert duplicate.status_code == 409 and token not in duplicate.text
    released = claim_api.post(base + "/release", headers=headers,
        json={"mode": "UNVERIFIED", "phase": "PICK", "expected_epoch": 1, "reason": "physical count pending"})
    assert released.status_code == 200 and released.json()["reconciliation_required"]
    assert token not in released.text
    assert claim_api.post(base + "/validate", headers=headers,
                          json={"phase": "PICK", "expected_epoch": 1}).status_code == 409


@pytest.mark.parametrize("payload,header", [
    ({"phase": "PICK", "expected_epoch": 0, "secret": "DO_NOT_REFLECT"}, None),
    ({"phase": "PICK", "expected_epoch": True}, None),
    ({"phase": "PICK", "expected_epoch": "0"}, None),
    ({"phase": "PICK", "expected_epoch": 0}, "1"),
    ({"phase": "PICK", "expected_epoch": 0}, "00"),
    ({"phase": "PICK", "expected_epoch": 0}, "DO_NOT_REFLECT"),
])
def test_strict_adapter_rejects_inputs_without_echo(claim_api, payload, header):
    headers = {} if header is None else {"X-Fulfillment-Claim-Epoch": header}
    response = claim_api.post(url(999) + "/acquire", json=payload, headers=headers)
    assert response.status_code == 422
    assert "DO_NOT_REFLECT" not in response.text and response.headers["cache-control"] == "no-store"


def test_takeover_requires_confirmation_and_rejects_duplicate(client, admin_headers, claim_api):
    _, order = make_order(client, admin_headers)
    base = url(order)
    claim_api.post(base + "/acquire", json={"phase": "PICK", "expected_epoch": 0}).raise_for_status()
    payload = {"phase": "PICK", "expected_epoch": 1, "reason": "lost token response", "confirmed": False}
    assert claim_api.post(base + "/takeover", json=payload).status_code == 422
    payload["confirmed"] = True
    response = claim_api.post(base + "/takeover", json=payload)
    assert response.status_code == 200 and response.json()["reconciliation_required"]
    assert claim_api.post(base + "/takeover", json=payload).status_code == 409


def test_adapter_unauthenticated_denied_without_input_echo():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.get(url(1))
    assert response.status_code in (401, 403) and response.headers["cache-control"] == "no-store"



@pytest.mark.parametrize("quantity", [1.234, 123456789012345.001, True])
def test_physical_count_rejects_lossy_json_values(claim_api, quantity):
    result = claim_api.post(url(999) + "/release", json={"phase": "PICK", "expected_epoch": 1,
        "mode": "VERIFIED", "physical_count_attested": True,
        "allocations": [{"allocation_id": 1, "picked_quantity": quantity, "packed_quantity": "0"}]},
        headers={"X-Fulfillment-Claim-Token": "x" * 43, "X-Fulfillment-Claim-Epoch": "1"})
    assert result.status_code == 422 and result.headers["cache-control"] == "no-store"


def test_exact_physical_quantity_text_is_lossless():
    from app.schemas.fulfillment_claim_schema import PhysicalAllocation
    from decimal import Decimal
    line = PhysicalAllocation(allocation_id=1, picked_quantity="123456789012345.001", packed_quantity=0)
    assert line.picked_quantity == Decimal("123456789012345.001")
    assert line.packed_quantity == Decimal(0)


def test_unexpected_adapter_failure_is_private_and_uncached(claim_api, monkeypatch):
    from app.routers import fulfillment_claim_router as adapter
    def fail(*args, **kwargs):
        raise RuntimeError("SYNTHETIC_PRIVATE_TOKEN")
    monkeypatch.setattr(adapter, "fulfillment_claim_status", fail)
    result = claim_api.get(url(999))
    assert result.status_code == 500 and result.headers["cache-control"] == "no-store"
    assert "SYNTHETIC_PRIVATE_TOKEN" not in result.text


def test_verified_release_adapter_preserves_exact_counts(client, admin_headers, db_session, claim_api):
    from tests.test_r5safe_release import counts
    _, order = make_order(client, admin_headers)
    base = url(order)
    acquired = claim_api.post(base + "/acquire", json={"phase": "PICK", "expected_epoch": 0}).json()
    result = claim_api.post(base + "/release", json={"phase": "PICK", "expected_epoch": 1,
        "mode": "VERIFIED", "physical_count_attested": True, "allocations": counts(db_session, order)},
        headers={"X-Fulfillment-Claim-Token": acquired["claim_token"], "X-Fulfillment-Claim-Epoch": "1"})
    assert result.status_code == 200 and result.json()["mode"] == "VERIFIED"
    assert result.json()["claim_epoch"] == 2 and not result.json()["reconciliation_required"]
    assert acquired["claim_token"] not in result.text
