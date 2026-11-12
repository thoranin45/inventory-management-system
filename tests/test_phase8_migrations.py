"""Phase 8 index migration: fresh upgrade, populated Phase 7 -> 8, parity, downgrade, presence.

Additive indexes only. No data rewrite.
"""
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.models import Base
from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade

PHASE7 = "e61a00000001"
HEAD = "ed1a00000001"

_EXPECTED_INDEXES = {
    "sales_orders": "ix_sales_orders_status_created_at",
    "purchase_orders": "ix_purchase_orders_status_created_at",
    "product_batches": "ix_product_batches_lot_no",
    "products": "ix_products_product_name",
    "customers": "ix_customers_customer_name",
    "suppliers": "ix_suppliers_supplier_name",
    "audit_logs": "ix_audit_logs_created_at",
    "stock_transactions": "ix_stock_transactions_created_at",
}


def _index_names(conn, table):
    return {i["name"] for i in inspect(conn).get_indexes(table)}


def test_fresh_upgrade_creates_phase8_indexes(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
        for table, index in _EXPECTED_INDEXES.items():
            assert index in _index_names(c, table), (table, index)
        # composite covers both columns
        po = next(i for i in inspect(c).get_indexes("purchase_orders")
                  if i["name"] == "ix_purchase_orders_supplier_id")
        assert po["column_names"] == ["supplier_id"]


def test_head_schema_matches_orm_metadata(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        context = MigrationContext.configure(
            c, opts={"compare_type": True, "compare_server_default": True}
        )
        assert compare_metadata(context, Base.metadata) == []


_PRESERVED_TABLES = ("products", "customers", "suppliers", "sales_orders", "purchase_orders")
# R5-SAFE.1B (ed1a00000001) is the only later revision that adds columns to these tables.
_ADDED_COLUMNS = {
    "sales_orders": {"fulfillment_claim_epoch", "fulfillment_claim_token_hash", "fulfillment_claim_user_id",
                     "fulfillment_claim_phase", "fulfillment_claim_acquired_at"},
}


def _columns(conn, table):
    return [col["name"] for col in inspect(conn).get_columns(table)]


def _rows(conn, table, columns):
    quoted = ", ".join(f'"{name}"' for name in columns)
    return conn.execute(text(f"SELECT {quoted} FROM {table} ORDER BY id")).all()


def test_populated_phase7_to_phase8_upgrade_changes_no_data(migration_engine):
    upgrade(migration_engine, PHASE7)
    with migration_engine.begin() as c:
        c.execute(text(
            "INSERT INTO products(id,sku,product_name,stock_qty,price) VALUES (801,'P8','Eight',3,1)"
        ))
        c.execute(text("INSERT INTO customers(id,customer_name) VALUES (801,'Cust 8')"))
        c.execute(text("INSERT INTO suppliers(id,supplier_name) VALUES (801,'Sup 8')"))
        c.execute(text(
            "INSERT INTO sales_orders(id,so_number,status,total_amount) VALUES (801,'SO-8','DRAFT',0)"
        ))
        # Open fulfilment work at upgrade time: ed1a00000001 must open a LEGACY_CUTOVER reconciliation for it.
        c.execute(text(
            "INSERT INTO sales_orders(id,so_number,status,total_amount) "
            "VALUES (802,'SO-8P','PICKING',0), (803,'SO-8K','PACKING',0)"
        ))
        c.execute(text(
            "INSERT INTO purchase_orders(id,po_number,supplier_id,status) VALUES (801,'PO-8',801,'DRAFT')"
        ))
        # Every column that exists BEFORE the upgrade, in table order, is captured and compared.
        original_columns = {t: _columns(c, t) for t in _PRESERVED_TABLES}
        before = {t: _rows(c, t, original_columns[t]) for t in _PRESERVED_TABLES}
    assert [row[0] for row in before["sales_orders"]] == [801, 802, 803]

    upgrade(migration_engine, "head")

    with migration_engine.connect() as c:
        for table in _PRESERVED_TABLES:
            columns_after = _columns(c, table)
            # No historical column disappears or is renamed; only the planned columns are added.
            assert columns_after[:len(original_columns[table])] == original_columns[table], table
            assert set(columns_after) - set(original_columns[table]) == _ADDED_COLUMNS.get(table, set()), table
        after = {t: _rows(c, t, original_columns[t]) for t in _PRESERVED_TABLES}
        # Same rows, same order, same values for every pre-existing column.
        assert after == before
        # The new claim columns arrive empty on every pre-existing order: epoch 0, no holder.
        claims = c.execute(text(
            "SELECT id, fulfillment_claim_epoch, fulfillment_claim_token_hash, fulfillment_claim_user_id, "
            "fulfillment_claim_phase, fulfillment_claim_acquired_at FROM sales_orders ORDER BY id"
        )).all()
        assert claims == [(801, 0, None, None, None, None), (802, 0, None, None, None, None),
                          (803, 0, None, None, None, None)]
        # Legacy open work is never treated as physically verified; DRAFT gets no reconciliation.
        reconciliations = c.execute(text(
            "SELECT sales_order_id, phase, opened_epoch, reason_code, status, resolved_at, counted_at "
            "FROM fulfillment_reconciliations ORDER BY sales_order_id"
        )).all()
        assert reconciliations == [(802, "PICK", 0, "LEGACY_CUTOVER", "REQUIRED", None, None),
                                   (803, "PACK", 0, "LEGACY_CUTOVER", "REQUIRED", None, None)]
        for table, index in _EXPECTED_INDEXES.items():
            assert index in _index_names(c, table)


def test_downgrade_removes_only_the_new_indexes(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PHASE7)
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE7
        for table, index in _EXPECTED_INDEXES.items():
            assert index not in _index_names(c, table)
        # Phase 7 structures remain intact
        assert "inventory_transfer_receipts" in inspect(c).get_table_names()
    upgrade(migration_engine, "head")
