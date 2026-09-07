"""Alembic Phase 6 (transfer lifecycle) upgrade / preflight / downgrade checks.

Every check runs against the dedicated PostgreSQL ``TEST_DATABASE_URL`` on a
disposable, Alembic-built schema.  Historical migrations are never edited.
"""
from decimal import Decimal

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.models import Base
from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade

PHASE5 = "e51a00000001"
PHASE6 = "e61a00000001"


# --------------------------------------------------------------------------- #
# Seed helpers (Phase 5 schema shape)
# --------------------------------------------------------------------------- #
def _seed_master_data(c):
    c.execute(text(
        "INSERT INTO products(id,sku,product_name,stock_qty,price) VALUES (601,'P6-A','Legacy A',5,1)"
    ))
    c.execute(text(
        "INSERT INTO warehouses(id,warehouse_code,warehouse_name,warehouse_type) "
        "VALUES (601,'W6A','Warehouse 6A','MAIN'),(602,'W6B','Warehouse 6B','SHOP')"
    ))
    c.execute(text(
        "INSERT INTO warehouse_locations(id,warehouse_id,location_code,location_type) "
        "VALUES (601,601,'LA','STORAGE'),(602,602,'LB','STORAGE')"
    ))


def _seed_completed_transfer(c):
    """A historical, immediately-completed transfer with exact paired movement legs."""
    _seed_master_data(c)
    c.execute(text(
        "INSERT INTO inventory_transfers(id,transfer_number,source_warehouse_id,destination_warehouse_id,status) "
        "VALUES (601,'TR-LEGACY-6',601,602,'COMPLETED')"
    ))
    c.execute(text(
        "INSERT INTO inventory_transfer_items(id,transfer_id,product_id,batch_id,from_location_id,to_location_id,quantity) "
        "VALUES (601,601,601,NULL,601,602,2.000)"
    ))
    c.execute(text(
        "INSERT INTO inventory_movements"
        "(product_id,warehouse_id,location_id,batch_id,movement_type,quantity,balance_before,balance_after,"
        " reference_type,reference_id,reference_number) VALUES "
        "(601,601,601,NULL,'TRANSFER_OUT',-2.000,5.000,3.000,'INVENTORY_TRANSFER',601,'TR-LEGACY-6'),"
        "(601,602,602,NULL,'TRANSFER_IN', 2.000,0.000,2.000,'INVENTORY_TRANSFER',601,'TR-LEGACY-6')"
    ))


def _snapshot(c, *tables):
    return {t: c.execute(text(f'SELECT * FROM "{t}" ORDER BY id')).all() for t in tables}


# Columns that exist in both the Phase 5 and Phase 6 shapes, so before/after
# comparisons stay meaningful across the additive migration.
_MOVEMENT_COLS = ("id,product_id,warehouse_id,location_id,batch_id,movement_type,quantity,"
                  "balance_before,balance_after,reference_type,reference_id,reference_number")


def _stable_snapshot(c):
    return {
        "movements": c.execute(text(
            f"SELECT {_MOVEMENT_COLS} FROM inventory_movements ORDER BY id"
        )).all(),
        "products": c.execute(text("SELECT id,sku,stock_qty FROM products ORDER BY id")).all(),
        "transfer_items_qty": c.execute(text(
            "SELECT id,transfer_id,product_id,batch_id,from_location_id,to_location_id,quantity "
            "FROM inventory_transfer_items ORDER BY id"
        )).all(),
    }


# --------------------------------------------------------------------------- #
# 1. Fresh upgrade + TRANSIT seed + model/schema parity
# --------------------------------------------------------------------------- #
def test_fresh_upgrade_seeds_resolvable_transit_storage(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE6

        # exactly one active, fully-typed transit warehouse/location pair, resolvable
        # by the same predicate StockBalanceRepository.get_transit_storage() uses.
        row = c.execute(text(
            "SELECT w.is_active, l.is_active, w.warehouse_type, l.location_type "
            "FROM warehouses w JOIN warehouse_locations l ON l.warehouse_id = w.id "
            "WHERE w.warehouse_code='__TRANSIT__' AND w.warehouse_type='TRANSIT' "
            "AND l.location_code='__TRANSIT__' AND l.location_type='TRANSIT' "
            "AND w.is_active AND l.is_active"
        )).all()
        assert len(row) == 1
        assert row[0] == (True, True, "TRANSIT", "TRANSIT")

        # new structures exist
        tables = set(inspect(c).get_table_names())
        assert "inventory_transfer_receipts" in tables
        cols = {col["name"] for col in inspect(c).get_columns("inventory_transfer_items")}
        assert {"dispatched_quantity", "received_quantity",
                "source_stock_balance_id", "transit_stock_balance_id"} <= cols
        movement_cols = {col["name"] for col in inspect(c).get_columns("inventory_movements")}
        assert {"transfer_item_id", "transfer_receipt_id"} <= movement_cols


def test_head_schema_matches_orm_metadata(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        context = MigrationContext.configure(
            c, opts={"compare_type": True, "compare_server_default": True}
        )
        assert compare_metadata(context, Base.metadata) == []


# --------------------------------------------------------------------------- #
# 2. Populated Phase 5 -> Phase 6 upgrade preserves history
# --------------------------------------------------------------------------- #
def test_populated_upgrade_preserves_legacy_completed_transfer(migration_engine):
    upgrade(migration_engine, PHASE5)
    with migration_engine.begin() as c:
        _seed_completed_transfer(c)
        # a DRAFT transfer with no progress and no movements is also compatible
        c.execute(text(
            "INSERT INTO inventory_transfers(id,transfer_number,source_warehouse_id,destination_warehouse_id,status) "
            "VALUES (602,'TR-DRAFT-6',601,602,'DRAFT')"
        ))
        c.execute(text(
            "INSERT INTO inventory_transfer_items(id,transfer_id,product_id,batch_id,from_location_id,to_location_id,quantity) "
            "VALUES (602,602,601,NULL,601,602,1.000)"
        ))
        before = _stable_snapshot(c)

    upgrade(migration_engine, "head")

    with migration_engine.connect() as c:
        # ledger, products and item quantities are untouched by the migration
        after = _stable_snapshot(c)
        assert after["movements"] == before["movements"]
        assert after["products"] == before["products"]
        assert after["transfer_items_qty"] == before["transfer_items_qty"]

        completed = c.execute(text(
            "SELECT status, legacy_completed FROM inventory_transfers WHERE id=601"
        )).one()
        assert tuple(completed) == ("COMPLETED", True)

        # historical completed item keeps NULL progress (distinguishable from lifecycle transfers)
        item = c.execute(text(
            "SELECT dispatched_quantity, received_quantity FROM inventory_transfer_items WHERE id=601"
        )).one()
        assert tuple(item) == (None, None)

        # DRAFT transfer progress is normalised to zero and is not legacy-completed
        draft = c.execute(text(
            "SELECT t.legacy_completed, i.dispatched_quantity, i.received_quantity "
            "FROM inventory_transfers t JOIN inventory_transfer_items i ON i.transfer_id=t.id WHERE t.id=602"
        )).one()
        assert tuple(draft) == (False, Decimal("0"), Decimal("0"))

        # the historical transfer is still fully readable end to end
        legs = c.execute(text(
            "SELECT movement_type, quantity FROM inventory_movements "
            "WHERE reference_type='INVENTORY_TRANSFER' AND reference_id=601 ORDER BY id"
        )).all()
        assert [tuple(r) for r in legs] == [("TRANSFER_OUT", Decimal("-2.000")),
                                            ("TRANSFER_IN", Decimal("2.000"))]


# --------------------------------------------------------------------------- #
# 3. Preflight refuses incompatible legacy data without any change
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("mutate,reason", [
    ("UPDATE inventory_transfers SET status='SHIPPED' WHERE id=601", "unknown_status"),
    ("DELETE FROM inventory_movements WHERE reference_id=601", "ambiguous_movement_history"),
    ("UPDATE inventory_movements SET balance_after=balance_after+1 WHERE reference_id=601", "movement_arithmetic"),
    ("INSERT INTO inventory_movements"
     "(product_id,warehouse_id,location_id,batch_id,movement_type,quantity,balance_before,balance_after,"
     " reference_type,reference_id,reference_number) "
     "VALUES (601,601,601,NULL,'TRANSFER_OUT',-1.000,3.000,2.000,'INVENTORY_TRANSFER',99999,'TR-ORPHAN')",
     "orphan_transfer_movement"),
    ("INSERT INTO warehouses(id,warehouse_code,warehouse_name,warehouse_type) "
     "VALUES (699,'__TRANSIT__','pre-existing','TRANSIT')", "transit_configuration_conflict"),
])
def test_preflight_refuses_incompatible_legacy_data(migration_engine, mutate, reason):
    upgrade(migration_engine, PHASE5)
    with migration_engine.begin() as c:
        _seed_completed_transfer(c)
        c.execute(text(mutate))
        before = _snapshot(c, "inventory_transfers", "inventory_transfer_items", "inventory_movements")

    with pytest.raises(RuntimeError, match=reason):
        upgrade(migration_engine, "head")

    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE5
        assert _snapshot(c, "inventory_transfers", "inventory_transfer_items", "inventory_movements") == before
        assert "inventory_transfer_receipts" not in inspect(c).get_table_names()
        # the migration never created its own transit warehouse/location pair
        assert c.scalar(text(
            "SELECT count(*) FROM warehouse_locations WHERE location_code='__TRANSIT__'"
        )) == 0


def test_preflight_import_is_exercised_during_real_alembic_run(migration_engine):
    """The migration imports scripts.check_phase6_preflight at module load and calls it
    inside upgrade(); a refusal proves both the import and the call executed."""
    from scripts.check_phase6_preflight import require_phase6_compatible  # noqa: F401

    upgrade(migration_engine, PHASE5)
    with migration_engine.begin() as c:
        _seed_completed_transfer(c)
        c.execute(text("UPDATE inventory_transfers SET status='NOT_A_REAL_STATUS' WHERE id=601"))
    with pytest.raises(RuntimeError, match=r"Phase 6 preflight refused.*unknown_status"):
        upgrade(migration_engine, "head")


# --------------------------------------------------------------------------- #
# 4. Guarded downgrade
# --------------------------------------------------------------------------- #
def test_downgrade_without_lifecycle_history_is_reversible(migration_engine):
    upgrade(migration_engine, PHASE5)
    with migration_engine.begin() as c:
        _seed_completed_transfer(c)
        before = _snapshot(c, "inventory_transfers", "inventory_transfer_items", "inventory_movements")
    upgrade(migration_engine, "head")

    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PHASE5)

    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE5
        assert "inventory_transfer_receipts" not in inspect(c).get_table_names()
        assert c.scalar(text("SELECT count(*) FROM warehouses WHERE warehouse_code='__TRANSIT__'")) == 0
        # every legacy row survived the round trip unchanged
        assert _snapshot(c, "inventory_transfers", "inventory_transfer_items", "inventory_movements") == before
    upgrade(migration_engine, "head")


@pytest.mark.parametrize("history_sql", [
    "UPDATE inventory_transfers SET dispatched_at = now() WHERE id=601",
    "UPDATE inventory_transfer_items SET dispatched_quantity=2.000, received_quantity=1.000 WHERE id=601",
])
def test_downgrade_refused_once_lifecycle_history_exists(migration_engine, history_sql):
    upgrade(migration_engine, PHASE5)
    with migration_engine.begin() as c:
        _seed_master_data(c)
        c.execute(text(
            "INSERT INTO inventory_transfers(id,transfer_number,source_warehouse_id,destination_warehouse_id,status) "
            "VALUES (601,'TR-LIVE-6',601,602,'DRAFT')"
        ))
        c.execute(text(
            "INSERT INTO inventory_transfer_items(id,transfer_id,product_id,batch_id,from_location_id,to_location_id,quantity) "
            "VALUES (601,601,601,NULL,601,602,2.000)"
        ))
    upgrade(migration_engine, "head")
    with migration_engine.begin() as c:
        c.execute(text(history_sql))

    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        with migration_engine.begin() as c:
            command.downgrade(migration_config(c), PHASE5)

    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE6
        assert "inventory_transfer_receipts" in inspect(c).get_table_names()
        assert c.scalar(text("SELECT count(*) FROM warehouses WHERE warehouse_code='__TRANSIT__'")) == 1
