"""P11 B1 (ee1a00000001): audit_logs.recorded_at_utc.

New audit rows carry a database-stamped aware instant, the adjustment
history and the audit API expose it with an explicit offset, history rows
written before the revision stay NULL and fall back to the naive created_at,
and the migration never backfills."""
import re
from datetime import datetime, timezone

from sqlalchemy import text

from tests.test_migrations import migration_engine, upgrade  # noqa: F401
from tests.test_stock import _create_product
from tests.test_stock_adjustment_requests import _approve, _create_request

ZONED = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")


def test_adjustment_history_times_are_explicit_instants(client, admin_headers, warehouse_headers):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    _approve(client, admin_headers, created["id"])

    detail = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=admin_headers).json()["data"]
    assert [h["action"] for h in detail["history"]] == ["CREATE_ADJUSTMENT_REQUEST", "APPROVE_ADJUSTMENT_REQUEST"]
    for entry in detail["history"]:
        assert ZONED.search(entry["at"]), entry["at"]
        at = datetime.fromisoformat(entry["at"].replace("Z", "+00:00"))
        assert abs((datetime.now(timezone.utc) - at).total_seconds()) < 300


def test_audit_api_exposes_recorded_at_utc(client, admin_headers):
    _create_product(client, admin_headers, initial_stock=1)
    rows = client.get("/api/v1/audit-logs/", headers=admin_headers).json()
    assert rows, "expected audit rows"
    newest = rows[0]
    assert newest["recorded_at_utc"] and ZONED.search(newest["recorded_at_utc"])


def test_legacy_rows_without_recorded_at_fall_back_to_created_at(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers, initial_stock=10)
    created = _create_request(client, warehouse_headers, product_id=product["id"]).json()["data"]
    # simulate pre-revision history: no recorded instant, naive wall clock only
    db_session.execute(text(
        "UPDATE audit_logs SET recorded_at_utc = NULL, created_at = '2026-01-02 03:04:05' "
        "WHERE table_name = 'stock_adjustment_requests' AND record_id = :i"
    ), {"i": created["id"]})
    db_session.commit()

    detail = client.get(f"/api/v1/stock-adjustment-requests/{created['id']}", headers=admin_headers).json()["data"]
    assert detail["history"][0]["at"].startswith("2026-01-02T03:04:05")
    assert not ZONED.search(detail["history"][0]["at"])


def test_migration_leaves_history_null_and_stamps_new_rows(migration_engine):  # noqa: F811
    upgrade(migration_engine, "ed1a00000001")
    with migration_engine.begin() as c:
        c.execute(text("INSERT INTO audit_logs(username, action, table_name) VALUES ('old', 'X', 'products')"))
    upgrade(migration_engine, "ee1a00000001")
    with migration_engine.begin() as c:
        c.execute(text("INSERT INTO audit_logs(username, action, table_name) VALUES ('new', 'X', 'products')"))
        rows = dict(c.execute(text("SELECT username, recorded_at_utc FROM audit_logs")).all())
    assert rows["old"] is None
    assert rows["new"] is not None and rows["new"].tzinfo is not None
