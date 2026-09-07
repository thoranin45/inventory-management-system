from decimal import Decimal
import re

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import CheckConstraint, inspect, text
from sqlalchemy.exc import IntegrityError

from app.models import Base
from scripts.check_phase3_preflight import inspect_phase3_data
from tests.conftest import TEST_DATABASE_URL
from tests.database_support import isolated_schema, migration_config, validate_test_url

PHASE2 = "72ad612eafc9"
PARITY = "e31a00000001"
HEAD = "e31a00000002"


@pytest.fixture
def migration_engine():
    with isolated_schema(TEST_DATABASE_URL) as engine:
        yield engine


def upgrade(engine, revision=HEAD):
    with engine.begin() as connection:
        command.upgrade(migration_config(connection), revision)


def seed_legacy(connection):
    statements = [
        "INSERT INTO products(id,sku,product_name,stock_qty,price) VALUES (101,'P1','One',1.125,1),(102,'P2','Two',999999999999999.999,1)",
        "INSERT INTO warehouses(id,warehouse_code,warehouse_name) VALUES (101,'W1','One'),(102,'W2','Two')",
        "INSERT INTO warehouse_locations(id,warehouse_id,location_code) VALUES (101,101,'L1'),(102,102,'L2')",
        "INSERT INTO product_batches(id,product_id,lot_no,quantity) VALUES (101,101,'LOT1',1.125),(102,102,'LOT2',999999999999999.999)",
        "INSERT INTO stock_balances(product_id,warehouse_id,location_id,batch_id,on_hand_qty,reserved_qty) VALUES (101,101,101,101,1.125,0.001),(102,102,102,102,999999999999999.999,0)",
        "INSERT INTO stock_transactions(product_id,transaction_type,quantity) VALUES (101,'OUT',-1.125),(101,'IN',0.001)",
        "INSERT INTO inventory_movements(product_id,warehouse_id,location_id,batch_id,movement_type,quantity,balance_before,balance_after) VALUES (101,101,101,101,'OUT',-1.125,1.126,0.001)",
        "INSERT INTO purchase_orders(id,po_number,status) VALUES (101,'PO1','PARTIALLY_RECEIVED')",
        "INSERT INTO purchase_order_items(po_id,product_id,quantity,received_quantity,unit_price) VALUES (101,101,1.125,0.001,1)",
        "INSERT INTO sales_orders(id,so_number,status,total_amount) VALUES (101,'SO1','CONFIRMED',1)",
        "INSERT INTO sales_order_items(id,sales_order_id,product_id,quantity,unit_price,total_price) VALUES (101,101,101,1.125,1,1.13)",
        "INSERT INTO sales_order_batch_allocations(sales_order_id,sales_order_item_id,product_id,batch_id,quantity) VALUES (101,101,101,101,0.001)",
        "INSERT INTO inventory_transfers(id,transfer_number,source_warehouse_id,destination_warehouse_id) VALUES (101,'T1',101,102)",
        "INSERT INTO inventory_transfer_items(transfer_id,product_id,batch_id,from_location_id,to_location_id,quantity) VALUES (101,101,101,101,102,0.001)",
    ]
    for sql in statements:
        connection.execute(text(sql))


def snapshot(connection):
    return {name: connection.execute(text(f'SELECT * FROM "{name}" ORDER BY id')).all()
            for name in inspect(connection).get_table_names() if name != "alembic_version"}


def test_fresh_install_and_metadata_parity(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "e51a00000001"
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) == set(Base.metadata.tables) | {"alembic_version"}
        migration_context = MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True})
        assert compare_metadata(migration_context, Base.metadata) == []

        def normalized(expression):
            if expression is None:
                return ""
            return re.sub(r"[\s()]|::(?:numeric|integer|text)", "", str(expression)).lower()

        for table in Base.metadata.sorted_tables:
            actual_checks = {c["name"]: normalized(c["sqltext"]) for c in inspector.get_check_constraints(table.name)}
            expected_checks = {c.name: normalized(c.sqltext) for c in table.constraints if isinstance(c, CheckConstraint)}
            assert actual_checks == expected_checks, table.name
            assert inspector.get_pk_constraint(table.name)["constrained_columns"] == [c.name for c in table.primary_key]
            if table.primary_key.name:
                assert inspector.get_pk_constraint(table.name)["name"] == table.primary_key.name
            actual_fks = inspector.get_foreign_keys(table.name)
            for fk in table.foreign_key_constraints:
                columns = [e.parent.name for e in fk.elements]
                found = next(f for f in actual_fks if f["constrained_columns"] == columns)
                assert found["referred_columns"] == [e.column.name for e in fk.elements]
                assert found["referred_table"] == next(iter(fk.elements)).column.table.name
                if fk.name:
                    assert found["name"] == fk.name
                assert found["options"].get("ondelete") == fk.ondelete
                assert found["options"].get("onupdate") == fk.onupdate
            indexes = {i["name"]: i for i in inspector.get_indexes(table.name) if not i.get("duplicates_constraint")}
            assert set(indexes) == {i.name for i in table.indexes}
            for index in table.indexes:
                actual = indexes[index.name]
                assert actual["column_names"] == [c.name for c in index.columns]
                assert actual["unique"] == index.unique
                assert normalized(actual.get("dialect_options", {}).get("postgresql_where", "")) == normalized(
                    index.dialect_options["postgresql"].get("where", "")
                )


def test_populated_phase2_upgrade_preserves_every_row_and_decimal(migration_engine):
    upgrade(migration_engine, PHASE2)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
        before = snapshot(connection)
    upgrade(migration_engine)
    with migration_engine.connect() as connection:
        assert snapshot(connection) == before
        assert connection.scalar(text("SELECT stock_qty FROM products WHERE id=102")) == Decimal("999999999999999.999")
        assert connection.scalar(text("SELECT received_quantity FROM purchase_order_items")) == Decimal("0.001")
        assert connection.scalar(text("SELECT quantity FROM sales_order_items")) == Decimal("1.125")
        assert connection.scalar(text("SELECT quantity FROM inventory_movements")) == Decimal("-1.125")


def test_early_integer_legacy_upgrade_is_exact(migration_engine):
    upgrade(migration_engine, "f40eb5b071a6")
    with migration_engine.begin() as connection:
        connection.execute(text("INSERT INTO products(id,stock_qty) VALUES (71,12)"))
        connection.execute(text("INSERT INTO product_batches(id,product_id,lot_no,quantity) VALUES (72,71,NULL,7)"))
    upgrade(migration_engine)
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT stock_qty FROM products WHERE id=71")) == Decimal("12.000")
        assert connection.scalar(text("SELECT quantity FROM product_batches WHERE id=72")) == Decimal("7.000")


def test_null_legacy_stock_refused_before_historical_rewrite(migration_engine):
    upgrade(migration_engine, "f40eb5b071a6")
    with migration_engine.begin() as connection:
        connection.execute(text("INSERT INTO products(id,stock_qty) VALUES (71,NULL)"))
    with pytest.raises(RuntimeError, match=r'products.*71'):
        upgrade(migration_engine)
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT stock_qty FROM products WHERE id=71")) is None
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "f40eb5b071a6"
        assert "brands" not in inspect(connection).get_table_names()


@pytest.mark.parametrize("invalid_sql,check", [
    ("UPDATE inventory_transfers SET destination_warehouse_id=source_warehouse_id", "different_warehouses"),
    ("INSERT INTO sales_order_items(sales_order_id,product_id,quantity) VALUES (101,101,1)", "duplicate_sales_order_id_product_id"),
    ("INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_price) VALUES (101,101,1,1)", "duplicate_po_id_product_id"),
    ("UPDATE products SET stock_qty='NaN'::numeric WHERE id=101", "stock_qty_numeric_18_3"),
])
def test_incompatible_phase2_refused_without_changes(migration_engine, invalid_sql, check):
    upgrade(migration_engine, PHASE2)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
        connection.execute(text(invalid_sql))
        before = snapshot(connection)
    with pytest.raises(RuntimeError, match=check):
        upgrade(migration_engine)
    with migration_engine.connect() as connection:
        # NaN is not equal to itself in Decimal; compare text representations.
        assert repr(snapshot(connection)) == repr(before)
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == PHASE2


def test_product_lot_transition_nulls_case_and_guarded_downgrade(migration_engine):
    upgrade(migration_engine, PHASE2)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
    upgrade(migration_engine)
    with migration_engine.begin() as connection:
        connection.execute(text("INSERT INTO product_batches(product_id,lot_no,quantity) VALUES (102,'LOT1',0),(101,NULL,0),(101,NULL,0),(101,'lot1',0),(101,' LOT1',0)"))
        before = snapshot(connection)
    with migration_engine.begin() as connection:
        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(text("INSERT INTO product_batches(product_id,lot_no,quantity) VALUES (101,'LOT1',0)"))
    with pytest.raises(RuntimeError, match="Cannot restore global lot uniqueness"):
        with migration_engine.begin() as connection:
            command.downgrade(migration_config(connection), PHASE2)
    with migration_engine.connect() as connection:
        assert snapshot(connection) == before
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == HEAD


def test_compatible_downgrade_preserves_data(migration_engine):
    upgrade(migration_engine, PHASE2)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
        before = snapshot(connection)
    upgrade(migration_engine)
    with migration_engine.begin() as connection:
        command.downgrade(migration_config(connection), PHASE2)
        assert snapshot(connection) == before
        uniques = inspect(connection).get_unique_constraints("product_batches")
        assert any(c["column_names"] == ["lot_no"] for c in uniques)
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == PHASE2
    upgrade(migration_engine)


@pytest.mark.parametrize("sql", [
    "INSERT INTO sales_order_items(sales_order_id,product_id,quantity) VALUES (101,101,1)",
    "INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_price) VALUES (101,101,1,1)",
    "UPDATE inventory_transfers SET destination_warehouse_id=source_warehouse_id",
    "UPDATE inventory_transfer_items SET to_location_id=from_location_id",
    "UPDATE stock_balances SET reserved_qty=on_hand_qty+1",
])
def test_migrated_constraints_reject_violations(migration_engine, sql):
    upgrade(migration_engine)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(text(sql))


@pytest.mark.parametrize("url", ["sqlite://", "postgresql://localhost/inventory", "postgresql://test_user@localhost/production"])
def test_test_database_identity_is_required(url):
    with pytest.raises(RuntimeError, match="dedicated PostgreSQL"):
        validate_test_url(url)


def test_duplicate_product_lot_preflight_reports_identifiers(migration_engine):
    upgrade(migration_engine, PHASE2)
    with migration_engine.begin() as connection:
        seed_legacy(connection)
        # Deliberately simulate an incompatible legacy schema, without editing revisions.
        connection.execute(text("ALTER TABLE product_batches DROP CONSTRAINT product_batches_lot_no_key"))
        connection.execute(text("INSERT INTO product_batches(id,product_id,lot_no,quantity) VALUES (103,101,'LOT1',0)"))
    with pytest.raises(RuntimeError, match=r'duplicate_product_id_lot_no.*101.*103'):
        upgrade(migration_engine)
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM product_batches")) == 3
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == PHASE2


def test_explicit_connection_never_uses_application_engine(migration_engine, monkeypatch):
    import sqlalchemy

    def forbidden(*args, **kwargs):
        raise AssertionError("Application engine fallback must not run")

    monkeypatch.setattr(sqlalchemy, "engine_from_config", forbidden)
    upgrade(migration_engine)


def test_normal_application_fallback_uses_configured_url(migration_engine, monkeypatch):
    import sys
    from types import SimpleNamespace
    import sqlalchemy

    placeholder = "postgresql://localhost/explicit_test"
    monkeypatch.setitem(sys.modules, "app.core.config", SimpleNamespace(
        settings=SimpleNamespace(database_url=placeholder)
    ))
    calls = []

    def test_engine_from_config(configuration, **kwargs):
        assert configuration["sqlalchemy.url"] == placeholder
        calls.append(True)
        return migration_engine

    monkeypatch.setattr(sqlalchemy, "engine_from_config", test_engine_from_config)
    # No supplied connection: the settings path must run, but its engine is test-only.
    command.upgrade(migration_config(None), "head")
    assert calls == [True]
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "e51a00000001"
