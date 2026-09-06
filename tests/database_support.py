"""Explicit PostgreSQL test targets and disposable Alembic-built schemas."""
from contextlib import contextmanager
from pathlib import Path
import re
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def validate_test_url(url):
    parsed = make_url(url)
    if parsed.get_backend_name() != "postgresql" or not re.search(
        r"(^|[_-])test($|[_-])", parsed.database or "", re.IGNORECASE
    ):
        raise RuntimeError("Refusing database access: dedicated PostgreSQL test database required")
    return parsed


def migration_config(connection):
    config = Config()
    config.set_main_option("script_location", str(PROJECT_ROOT / "alembic"))
    config.attributes["connection"] = connection
    return config


def make_schema_engine(url, schema):
    parsed = validate_test_url(url)
    if not re.fullmatch(r"test_[a-f0-9]{32}", schema):
        raise RuntimeError("Refusing non-test schema")
    engine = create_engine(parsed, pool_pre_ping=True, hide_parameters=True)

    @event.listens_for(engine, "connect")
    def set_test_schema(dbapi_connection, connection_record):
        previous = dbapi_connection.autocommit
        dbapi_connection.autocommit = True
        try:
            with dbapi_connection.cursor() as cursor:
                cursor.execute("SELECT current_database()")
                if cursor.fetchone()[0] != parsed.database:
                    raise RuntimeError("Connected database differs from explicit test database")
                cursor.execute(f'SET search_path TO "{schema}"')
                cursor.execute("SET statement_timeout TO '15s'")
                cursor.execute("SET lock_timeout TO '10s'")
        finally:
            dbapi_connection.autocommit = previous
    return engine


@contextmanager
def isolated_schema(url, revision=None):
    schema = "test_" + uuid4().hex
    engine = make_schema_engine(url, schema)
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            if revision is not None:
                command.upgrade(migration_config(connection), revision)
        yield engine
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()
