"""Phase 9: liveness / readiness split."""
import pytest
from sqlalchemy.exc import OperationalError

import app.routers.system_router as system_router
from app.core.db_revision import EXPECTED_ALEMBIC_HEAD


def test_health_is_liveness_only_and_needs_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"


def test_ready_ok(client):
    r = client.get("/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["database"] == "ok"
    assert body["migration"] == EXPECTED_ALEMBIC_HEAD
    assert body["expected"] == EXPECTED_ALEMBIC_HEAD


def test_ready_reports_db_unreachable_without_leaking(client, monkeypatch):
    def raising_text(*_a, **_k):
        raise OperationalError(
            "stmt", {}, Exception("db is down: host=secret user=secret password=secret")
        )

    monkeypatch.setattr(system_router, "text", raising_text)
    r = client.get("/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["reason"] == "db_unreachable"
    raw = r.text
    assert "secret" not in raw
    assert "Traceback" not in raw
    assert "OperationalError" not in raw


def test_ready_reports_migration_mismatch(client, monkeypatch):
    monkeypatch.setattr(system_router, "EXPECTED_ALEMBIC_HEAD", "deadbeef0000")
    r = client.get("/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["reason"] == "migration_mismatch"
    assert body["expected"] == "deadbeef0000"
    assert "password" not in r.text.lower()


def test_legacy_health_alias_still_works(client):
    r = client.get("/api/v1/health/")
    assert r.status_code == 200
    assert r.json()["success"] is True


def test_health_and_ready_are_unauthenticated(client):
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code in (200, 503)
