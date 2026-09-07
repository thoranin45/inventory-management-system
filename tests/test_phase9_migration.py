"""Phase 9 migration: users.is_active — additive, existing users stay active."""
import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.models import Base
from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade  # noqa: F401

PHASE8 = "e71a00000001"
HEAD = "e81a00000001"


def _columns(conn, table):
    return {c["name"]: c for c in inspect(conn).get_columns(table)}


def test_fresh_upgrade_adds_is_active(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
        col = _columns(c, "users")["is_active"]
        assert col["nullable"] is False


def test_head_schema_matches_orm_metadata(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        ctx = MigrationContext.configure(
            c, opts={"compare_type": True, "compare_server_default": True}
        )
        assert compare_metadata(ctx, Base.metadata) == []


def test_populated_phase8_to_phase9_keeps_users_active(migration_engine):
    upgrade(migration_engine, PHASE8)
    with migration_engine.begin() as c:
        c.execute(text(
            "INSERT INTO users(id, username, password_hash, role) "
            "VALUES (901,'u901','h','ADMIN'),(902,'u902','h','WAREHOUSE')"
        ))
        before_ids = c.execute(text("SELECT id FROM users ORDER BY id")).scalars().all()

    upgrade(migration_engine, "head")

    with migration_engine.connect() as c:
        rows = c.execute(text("SELECT id, is_active FROM users ORDER BY id")).all()
        assert [r[0] for r in rows] == before_ids
        assert all(r[1] is True for r in rows)


def test_downgrade_blocked_when_disabled_users_exist(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.begin() as c:
        c.execute(text(
            "INSERT INTO users(id, username, password_hash, role, is_active) "
            "VALUES (903,'u903','h','ADMIN', FALSE)"
        ))
    with pytest.raises(RuntimeError, match="disabled user accounts"):
        with migration_engine.begin() as c:
            command.downgrade(migration_config(c), PHASE8)
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD


def test_downgrade_removes_column_when_all_active(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.begin() as c:
        c.execute(text(
            "INSERT INTO users(id, username, password_hash, role) "
            "VALUES (904,'u904','h','ADMIN')"
        ))
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PHASE8)
    with migration_engine.connect() as c:
        assert "is_active" not in _columns(c, "users")
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE8
    upgrade(migration_engine, "head")
