"""F3a (f03a00000001): additive payments migration with a guarded downgrade."""
import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine  # noqa: F401

PREVIOUS = "f02a00000001"
F3A = "f03a00000001"
NEW_TABLES = {"payment_receipts", "payment_receipt_allocations", "billing_notes", "billing_note_items"}


def _move(engine, revision, direction=command.upgrade):
    with engine.begin() as connection:
        direction(migration_config(connection), revision)


def test_upgrade_adds_only_new_tables(migration_engine):
    _move(migration_engine, PREVIOUS)
    with migration_engine.connect() as connection:
        before = set(inspect(connection).get_table_names())
        invoice_columns = [c["name"] for c in inspect(connection).get_columns("invoices")]
    _move(migration_engine, F3A)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) - before == NEW_TABLES
        assert [c["name"] for c in inspector.get_columns("invoices")] == invoice_columns


def test_downgrade_round_trip_when_empty(migration_engine):
    _move(migration_engine, F3A)
    _move(migration_engine, PREVIOUS, command.downgrade)
    with migration_engine.connect() as connection:
        assert not NEW_TABLES & set(inspect(connection).get_table_names())
    _move(migration_engine, F3A)


def test_downgrade_refuses_to_destroy_receipts(migration_engine):
    _move(migration_engine, F3A)
    with migration_engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (username, password_hash, role) VALUES ('rc-mig', 'x', 'admin') RETURNING id"
        )).scalar()
        customer_id = connection.execute(text(
            "INSERT INTO customers (customer_name) VALUES ('RC migration') RETURNING id"
        )).scalar()
        connection.execute(text(
            "INSERT INTO payment_receipts (receipt_number, status, customer_id, received_date, method, "
            "amount_total, wht_total, settled_total, created_by_user_id) "
            "VALUES ('RC-2099-0001', 'ISSUED', :c, '2099-01-01', 'CASH', 10, 0, 10, :u)"
        ), {"c": customer_id, "u": user_id})
    with pytest.raises(RuntimeError, match="Refusing to downgrade f03a00000001"):
        _move(migration_engine, PREVIOUS, command.downgrade)
