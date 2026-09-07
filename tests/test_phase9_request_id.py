"""Phase 9: request-ID propagation and correlation."""
import pytest
from fastapi.testclient import TestClient

import app.routers.system_router as system_router
from app.main import app


@pytest.fixture
def raw_client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_every_response_has_request_id_header(client):
    for path in ("/health", "/", "/api/v1/does-not-exist"):
        r = client.get(path)
        assert r.headers.get("X-Request-ID")


def test_error_body_request_id_matches_header(client):
    r = client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["request_id"]
    assert body["request_id"] == r.headers["X-Request-ID"]


def test_inbound_request_id_is_honoured_when_sane(client):
    r = client.get("/health", headers={"X-Request-ID": "trace-abc-000123"})
    assert r.headers["X-Request-ID"] == "trace-abc-000123"


def test_inbound_request_id_rejected_when_garbage(client):
    r = client.get("/health", headers={"X-Request-ID": "bad id with spaces!!"})
    assert r.headers["X-Request-ID"] != "bad id with spaces!!"
    assert len(r.headers["X-Request-ID"]) >= 8


def test_forced_500_carries_request_id(raw_client, monkeypatch):
    def blow_up(*_a, **_k):
        raise RuntimeError("internal dsn=postg:secret traceback frame")

    monkeypatch.setattr(system_router, "current_db_revision", blow_up)
    r = raw_client.get("/ready")
    assert r.status_code == 500
    body = r.json()
    assert body["request_id"] == r.headers["X-Request-ID"]
