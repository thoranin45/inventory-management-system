"""Phase 9: safe generic error handling; 429 envelope."""
import os

import pytest
from fastapi.testclient import TestClient

import app.routers.system_router as system_router
from app.main import app


@pytest.fixture
def raw_client():
    # Do not let TestClient re-raise server exceptions: we want to inspect the
    # 500 response the exception handler actually produces.
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_unhandled_exception_returns_safe_envelope(raw_client, monkeypatch):
    def blow_up(*_a, **_k):
        raise RuntimeError(
            "psycopg2.OperationalError connection to host=10.0.0.5 user=admin "
            "password=hunter2\nTraceback (most recent call last): ..."
        )

    monkeypatch.setattr(system_router, "current_db_revision", blow_up)
    r = raw_client.get("/ready")

    assert r.status_code == 500
    body = r.json()
    assert body["success"] is False
    assert body["message"] == "Internal server error"
    assert body["request_id"]
    assert body["errors"][0]["error_type"] == "internal_error"

    raw = r.text
    for leak in ("Traceback", "psycopg2", "password=hunter2", "host=10.0.0.5", "hunter2"):
        assert leak not in raw


def test_business_exceptions_still_typed(client, admin_headers):
    # 404 typed business error keeps its message and envelope.
    r = client.get("/api/v1/products/99999999", headers=admin_headers)
    assert r.status_code == 404
    body = r.json()
    assert body["success"] is False
    assert body["request_id"]


def test_validation_error_still_422(client, admin_headers):
    r = client.post("/api/v1/products", headers=admin_headers, json={"price": "abc"})
    assert r.status_code == 422
    assert r.json()["success"] is False


class TestRateLimitEnvelope:
    def setup_method(self):
        from app.middleware.rate_limit import reset_rate_limit_state

        os.environ["RATE_LIMIT_TEST_ENABLED"] = "1"
        reset_rate_limit_state()

    def teardown_method(self):
        from app.middleware.rate_limit import reset_rate_limit_state

        os.environ.pop("RATE_LIMIT_TEST_ENABLED", None)
        reset_rate_limit_state()

    def test_429_uses_error_response_envelope_with_retry_after(self, client):
        last = None
        for _ in range(12):
            last = client.post(
                "/api/v1/auth/login",
                json={"username": "nobody", "password": "bad"},
            )
        assert last.status_code == 429
        body = last.json()
        assert body["success"] is False
        assert body["message"] == "Too many requests"
        assert body["errors"][0]["error_type"] == "rate_limited"
        assert body["request_id"]
        assert last.headers.get("Retry-After")
