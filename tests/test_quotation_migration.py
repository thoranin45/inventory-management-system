"""F1a (f01a00000001): additive quotations migration with a guarded downgrade."""
import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine  # noqa: F401

PREVIOUS = "ef1a00000001"
F1A = "f01a00000001"


def _move(engine, revision, direction=command.upgrade):
    with engine.begin() as connection:
        direction(migration_config(connection), revision)


def test_upgrade_adds_only_the_quotation_tables(migration_engine):
    _move(migration_engine, PREVIOUS)
    with migration_engine.connect() as connection:
        before = set(inspect(connection).get_table_names())
        sales_order_columns = [c["name"] for c in inspect(connection).get_columns("sales_orders")]
    _move(migration_engine, F1A)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) - before == {"quotations", "quotation_items"}
        assert [c["name"] for c in inspector.get_columns("sales_orders")] == sales_order_columns


def test_downgrade_round_trip_when_no_quotations(migration_engine):
    _move(migration_engine, F1A)
    _move(migration_engine, PREVIOUS, command.downgrade)
    with migration_engine.connect() as connection:
        assert "quotations" not in inspect(connection).get_table_names()
    _move(migration_engine, F1A)


def test_downgrade_refuses_to_destroy_quotations(migration_engine):
    _move(migration_engine, F1A)
    with migration_engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (username, password_hash, role) VALUES ('qt-mig', 'x', 'admin') RETURNING id"
        )).scalar()
        customer_id = connection.execute(text(
            "INSERT INTO customers (customer_name) VALUES ('QT migration') RETURNING id"
        )).scalar()
        connection.execute(text(
            "INSERT INTO quotations (status, customer_id, subtotal, vat_base, vat_amount, grand_total, "
            "created_by_user_id) VALUES ('DRAFT', :c, 0, 0, 0, 0, :u)"
        ), {"c": customer_id, "u": user_id})
    with pytest.raises(RuntimeError, match="Refusing to downgrade f01a00000001"):
        _move(migration_engine, PREVIOUS, command.downgrade)
