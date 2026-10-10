"""Phase 14B migrations: safe MAIN/DEFAULT provisioning + the new
stock_adjustment_requests table.

ea1a00000001 must never touch an already-seeded MAIN/DEFAULT row -- unlike
__TRANSIT__'s own migration (e61a00000001), which could use a bare INSERT
because that data never existed before it ran, MAIN/DEFAULT may already
exist from the manual scripts/seed_v3_foundation.py script. This file
proves the ON CONFLICT DO NOTHING guard holds even against an inconsistent
pre-existing row (inactive, off-convention name), and that downgrade is
the documented no-op -- it never deletes data it cannot prove it created.
"""
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade  # noqa: F401

PRE_14B = "e91a00000001"
MAIN_DEFAULT = "ea1a00000001"
HEAD = "ea1a00000002"


def test_fresh_upgrade_seeds_main_default(migration_engine):
    upgrade(migration_engine, HEAD)
    with migration_engine.connect() as c:
        row = c.execute(text(
            "SELECT warehouse_code, warehouse_name, warehouse_type, is_active FROM warehouses WHERE warehouse_code='MAIN'"
        )).one()
        assert row == ("MAIN", "Main Warehouse", "MAIN", True)
        loc = c.execute(text(
            "SELECT location_code, location_name, location_type, is_active FROM warehouse_locations "
            "WHERE warehouse_id = (SELECT id FROM warehouses WHERE warehouse_code='MAIN') AND location_code='DEFAULT'"
        )).one()
        assert loc == ("DEFAULT", "Default Location", "STORAGE", True)


def test_already_seeded_inactive_off_convention_main_survives_untouched(migration_engine):
    """Simulates an environment where scripts/seed_v3_foundation.py already
    ran (or an admin manually deactivated MAIN) before this migration was
    introduced. ON CONFLICT DO NOTHING must leave every column exactly as
    it was -- never reactivate it, never rename it, never duplicate it."""
    upgrade(migration_engine, PRE_14B)
    with migration_engine.begin() as c:
        c.execute(text(
            "INSERT INTO warehouses(warehouse_code, warehouse_name, warehouse_type, is_active) "
            "VALUES ('MAIN', 'Legacy Depot (renamed)', 'MAIN', false)"
        ))
        c.execute(text(
            "INSERT INTO warehouse_locations(warehouse_id, location_code, location_name, location_type, is_active) "
            "SELECT id, 'DEFAULT', 'Legacy Default (renamed)', 'STORAGE', false FROM warehouses WHERE warehouse_code='MAIN'"
        ))

    upgrade(migration_engine, HEAD)

    with migration_engine.connect() as c:
        warehouses = c.execute(text("SELECT warehouse_code, warehouse_name, is_active FROM warehouses WHERE warehouse_code='MAIN'")).all()
        assert len(warehouses) == 1  # never duplicated
        assert warehouses[0] == ("MAIN", "Legacy Depot (renamed)", False)  # never renamed, never reactivated

        locations = c.execute(text(
            "SELECT location_code, location_name, is_active FROM warehouse_locations "
            "WHERE warehouse_id = (SELECT id FROM warehouses WHERE warehouse_code='MAIN') AND location_code='DEFAULT'"
        )).all()
        assert len(locations) == 1
        assert locations[0] == ("DEFAULT", "Legacy Default (renamed)", False)


def test_downgrade_main_default_migration_is_a_documented_noop(migration_engine):
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PRE_14B)
    with migration_engine.connect() as c:
        # MAIN/DEFAULT survive the downgrade -- upgrade() never
        # unconditionally created them, so downgrade() has nothing it can
        # safely reverse (see the migration's own docstring).
        assert c.execute(text("SELECT 1 FROM warehouses WHERE warehouse_code='MAIN'")).first() is not None
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PRE_14B
        assert "stock_adjustment_requests" not in inspect(c).get_table_names()
    upgrade(migration_engine, HEAD)


def test_downgrade_adjustment_requests_table_drops_cleanly(migration_engine):
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), MAIN_DEFAULT)
    with migration_engine.connect() as c:
        assert "stock_adjustment_requests" not in inspect(c).get_table_names()
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == MAIN_DEFAULT
        # MAIN/DEFAULT are untouched by this step either way.
        assert c.execute(text("SELECT 1 FROM warehouses WHERE warehouse_code='MAIN'")).first() is not None
    upgrade(migration_engine, HEAD)
