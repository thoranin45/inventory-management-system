"""Phase 9: tiered rate limiting — strict on auth, generous elsewhere."""
import os

import pytest

from app.middleware.rate_limit import reset_rate_limit_state


@pytest.fixture(autouse=True)
def _enable_rate_limiting():
    os.environ["RATE_LIMIT_TEST_ENABLED"] = "1"
    reset_rate_limit_state()
    yield
    os.environ.pop("RATE_LIMIT_TEST_ENABLED", None)
    reset_rate_limit_state()


def test_login_is_locked_after_five_attempts(client):
    codes = [
        client.post("/api/v1/auth/login",
                    json={"username": "nobody", "password": "x"}).status_code
        for _ in range(8)
    ]
    assert codes[:5] == [401] * 5
    assert 429 in codes[5:]


def test_health_and_ready_are_never_rate_limited(client):
    for _ in range(50):
        assert client.get("/health").status_code == 200
    for _ in range(50):
        assert client.get("/ready").status_code in (200, 503)


def test_operational_scanning_is_not_throttled(client, admin_headers):
    # Far more than the auth limit; scanning must keep working.
    for _ in range(40):
        r = client.get("/api/v1/scan/resolve?barcode=none-zzz", headers=admin_headers)
        assert r.status_code in (200, 404)


def test_rate_limited_response_shape(client):
    last = None
    for _ in range(10):
        last = client.post("/api/v1/auth/token",
                           data={"username": "nobody", "password": "x"})
    assert last.status_code == 429
    assert last.headers.get("Retry-After")
    body = last.json()
    assert body["success"] is False
    assert body["request_id"]
