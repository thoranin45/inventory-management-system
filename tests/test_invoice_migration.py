"""F2a (f02a00000001): additive invoices migration with a guarded downgrade."""
import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine  # noqa: F401

PREVIOUS = "f01a00000001"
F2A = "f02a00000001"
NEW_TABLES = {"invoices", "invoice_items", "adjustment_notes", "adjustment_note_items"}


def _move(engine, revision, direction=command.upgrade):
    with engine.begin() as connection:
        direction(migration_config(connection), revision)


def test_upgrade_adds_tables_and_a_defaulted_credit_days_column(migration_engine):
    _move(migration_engine, PREVIOUS)
    with migration_engine.begin() as connection:
        before = set(inspect(connection).get_table_names())
        sales_order_columns = [c["name"] for c in inspect(connection).get_columns("sales_orders")]
        connection.execute(text("INSERT INTO company_profile (id) VALUES (1) ON CONFLICT DO NOTHING"))
    _move(migration_engine, F2A)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) - before == NEW_TABLES
        assert [c["name"] for c in inspector.get_columns("sales_orders")] == sales_order_columns
        assert connection.scalar(text("SELECT default_credit_days FROM company_profile WHERE id = 1")) == 30


def test_downgrade_round_trip_when_empty(migration_engine):
    _move(migration_engine, F2A)
    _move(migration_engine, PREVIOUS, command.downgrade)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert not NEW_TABLES & set(inspector.get_table_names())
        assert "default_credit_days" not in [c["name"] for c in inspector.get_columns("company_profile")]
    _move(migration_engine, F2A)


def test_downgrade_refuses_to_destroy_invoices(migration_engine):
    _move(migration_engine, F2A)
    with migration_engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (username, password_hash, role) VALUES ('inv-mig', 'x', 'admin') RETURNING id"
        )).scalar()
        customer_id = connection.execute(text(
            "INSERT INTO customers (customer_name) VALUES ('INV migration') RETURNING id"
        )).scalar()
        order_id = connection.execute(text(
            "INSERT INTO sales_orders (so_number, customer_id, status, total_amount) "
            "VALUES ('SO-MIG-INV', :c, 'SHIPPED', 0) RETURNING id"
        ), {"c": customer_id}).scalar()
        connection.execute(text(
            "INSERT INTO invoices (status, sales_order_id, customer_id, credit_days, subtotal, discount_total, "
            "vat_base, vat_amount, grand_total, created_by_user_id) "
            "VALUES ('DRAFT', :o, :c, 30, 0, 0, 0, 0, 0, :u)"
        ), {"o": order_id, "c": customer_id, "u": user_id})
    with pytest.raises(RuntimeError, match="Refusing to downgrade f02a00000001"):
        _move(migration_engine, PREVIOUS, command.downgrade)
