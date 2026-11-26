"""F0a (ef1a00000001): additive migration with a guarded downgrade."""
import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.database_support import migration_config
from tests.test_migrations import migration_engine  # noqa: F401

PREVIOUS = "ee1a00000001"
F0A = "ef1a00000001"


def _move(engine, revision, direction=command.upgrade):
    with engine.begin() as connection:
        direction(migration_config(connection), revision)


def test_upgrade_adds_only_new_tables_and_nullable_customer_columns(migration_engine):
    _move(migration_engine, PREVIOUS)
    with migration_engine.connect() as connection:
        before_tables = set(inspect(connection).get_table_names())
        before_customer = {c["name"] for c in inspect(connection).get_columns("customers")}
        connection.execute(text("INSERT INTO customers (customer_name) VALUES ('Legacy')"))
        connection.commit()

    _move(migration_engine, F0A)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert set(inspector.get_table_names()) - before_tables == {"company_profile", "document_sequences"}
        columns = {c["name"]: c for c in inspector.get_columns("customers")}
        added = set(columns) - before_customer
        assert added == {"tax_id", "branch_code", "billing_address", "credit_term_days"}
        assert all(columns[name]["nullable"] for name in added)
        legacy = connection.execute(text(
            "SELECT tax_id, branch_code, billing_address, credit_term_days FROM customers WHERE customer_name = 'Legacy'"
        )).one()
        assert tuple(legacy) == (None, None, None, None)


def test_downgrade_round_trip_when_no_finance_data(migration_engine):
    _move(migration_engine, F0A)
    _move(migration_engine, PREVIOUS, command.downgrade)
    with migration_engine.connect() as connection:
        inspector = inspect(connection)
        assert "company_profile" not in inspector.get_table_names()
        assert "tax_id" not in {c["name"] for c in inspector.get_columns("customers")}
    _move(migration_engine, F0A)


@pytest.mark.parametrize("seed", [
    "INSERT INTO company_profile (id, legal_name_th) VALUES (1, 'ร้านตัวอย่าง')",
    "INSERT INTO document_sequences (doc_type, year, next_value) VALUES ('INV', 2026, 2)",
    "INSERT INTO customers (customer_name, tax_id) VALUES ('Taxed', '0105536092641')",
])
def test_downgrade_refuses_to_destroy_finance_data(migration_engine, seed):
    _move(migration_engine, F0A)
    with migration_engine.begin() as connection:
        connection.execute(text(seed))
    with pytest.raises(RuntimeError, match="Refusing to downgrade ef1a00000001"):
        _move(migration_engine, PREVIOUS, command.downgrade)
