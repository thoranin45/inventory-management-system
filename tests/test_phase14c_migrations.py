"""Phase 14C migration (ea1a00000003): ledger indexes + the D7 link.

Runs only in the isolated, disposable migration schema."""
import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade  # noqa: F401

PRE_14C = "ea1a00000002"
HEAD = "ea1a00000003"


def _indexes(connection, table):
    return {i["name"]: i["column_names"] for i in inspect(connection).get_indexes(table)}


def _downgrade(engine, revision):
    with engine.begin() as connection:
        command.downgrade(migration_config(connection), revision)


def test_upgrade_swaps_the_redundant_index_and_adds_the_link(migration_engine):
    upgrade(migration_engine, PRE_14C)
    with migration_engine.connect() as c:
        before = _indexes(c, "inventory_movements")
    assert before["ix_inventory_movements_product_id"] == ["product_id"]

    upgrade(migration_engine, HEAD)
    with migration_engine.connect() as c:
        after = _indexes(c, "inventory_movements")
        assert "ix_inventory_movements_product_id" not in after
        assert after["ix_inventory_movements_product_created_id"] == ["product_id", "created_at", "id"]
        assert after["ix_inventory_movements_reference_number"] == ["reference_number"]
        # Nothing else on the ledger table changed.
        assert set(after) - set(before) == {
            "ix_inventory_movements_product_created_id", "ix_inventory_movements_reference_number"}
        assert set(before) - set(after) == {"ix_inventory_movements_product_id"}

        insp = inspect(c)
        column = next(col for col in insp.get_columns("stock_adjustment_requests")
                      if col["name"] == "stock_transaction_id")
        assert column["nullable"] is True
        fks = {fk["name"]: fk for fk in insp.get_foreign_keys("stock_adjustment_requests")}
        fk = fks["fk_stock_adjustment_requests_stock_transaction"]
        assert (fk["referred_table"], fk["constrained_columns"]) == ("stock_transactions", ["stock_transaction_id"])
        uniques = {u["name"]: u["column_names"] for u in insp.get_unique_constraints("stock_adjustment_requests")}
        assert uniques["uq_stock_adjustment_requests_stock_transaction_id"] == ["stock_transaction_id"]
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD


def _seed_approved_request(connection, *, linked: bool):
    connection.execute(text(
        "INSERT INTO products(id, sku, product_name, stock_qty, price) VALUES (9101, 'P14C', 'Ledger', 0, 1)"))
    connection.execute(text("INSERT INTO users(id, username, role) VALUES (9101, 'u14c', 'WAREHOUSE')"))
    connection.execute(text(
        "INSERT INTO stock_transactions(id, product_id, transaction_type, quantity) VALUES (9101, 9101, 'ADJUST', 0)"))
    connection.execute(text(
        "INSERT INTO stock_adjustment_requests(product_id, warehouse_id, location_id, observed_quantity, "
        "requested_quantity, reason_code, status, requested_by_user_id, stock_transaction_id) "
        "SELECT 9101, w.id, l.id, 0, 0, 'DAMAGE', 'APPROVED', 9101, :tx FROM warehouses w "
        "JOIN warehouse_locations l ON l.warehouse_id = w.id WHERE w.warehouse_code = 'MAIN' "
        "AND l.location_code = 'DEFAULT'"
    ), {"tx": 9101 if linked else None})


def test_downgrade_refuses_while_any_request_carries_a_transaction_link(migration_engine):
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        _seed_approved_request(c, linked=True)

    with pytest.raises(RuntimeError, match="Refusing to downgrade ea1a00000003"):
        _downgrade(migration_engine, PRE_14C)

    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
        assert c.scalar(text(
            "SELECT stock_transaction_id FROM stock_adjustment_requests WHERE product_id = 9101")) == 9101


def test_downgrade_without_links_restores_the_previous_schema_exactly(migration_engine):
    upgrade(migration_engine, PRE_14C)
    with migration_engine.connect() as c:
        before = _indexes(c, "inventory_movements")
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        _seed_approved_request(c, linked=False)  # pre-14C approval: no link, data survives

    _downgrade(migration_engine, PRE_14C)
    with migration_engine.connect() as c:
        assert _indexes(c, "inventory_movements") == before
        columns = {col["name"] for col in inspect(c).get_columns("stock_adjustment_requests")}
        assert "stock_transaction_id" not in columns
        assert c.scalar(text("SELECT count(*) FROM stock_adjustment_requests WHERE product_id = 9101")) == 1
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PRE_14C
    upgrade(migration_engine, HEAD)
