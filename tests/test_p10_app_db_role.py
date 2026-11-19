"""P10 finding F2: the API connects as a least-privilege role, not the superuser.

Static checks on the prod compose wiring, plus a real-PostgreSQL test of
scripts/app_db_role.py in a throwaway schema and role (dropped afterwards).
"""
import re
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ProgrammingError

from scripts import app_db_role
from tests.conftest import TEST_DATABASE_URL
from tests.test_p7_prod_stack import _service

ROOT = Path(__file__).resolve().parents[1]


def _env_files(service: str) -> list[str]:
    match = re.search(r"^\s+env_file: \[(.+)\]$", _service(service), flags=re.M)
    assert match, f"{service} has no env_file"
    return [p.strip() for p in match.group(1).split(",")]


def test_only_the_api_loads_the_runtime_role_credentials_and_they_win():
    assert _env_files("api") == [".env.production", ".env.production.app"]
    assert _env_files("migrate") == [".env.production"]
    assert _env_files("db") == [".env.production"]


def test_runtime_role_env_file_is_ignored_templated_and_prepared_in_ci():
    assert ".env.production.app" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    example = (ROOT / ".env.production.app.example").read_text(encoding="utf-8")
    keys = dict(ln.split("=", 1) for ln in example.splitlines() if ln and not ln.startswith("#"))
    assert set(keys) == {"DB_USER", "DB_PASSWORD", "DATABASE_URL"}
    assert keys["DB_USER"] == "inventory_app" and keys["DB_PASSWORD"] == "CHANGE_ME"
    assert "inventory_app:CHANGE_ME@" in keys["DATABASE_URL"]
    workflow = (ROOT / ".github" / "workflows" / "tests.yml").read_text(encoding="utf-8")
    assert "cp .env.production.app.example .env.production.app" in workflow


@pytest.fixture
def scratch():
    """A fresh schema owned by the test user, a role name, and cleanup."""
    owner = create_engine(TEST_DATABASE_URL)
    tag = uuid4().hex[:10]
    schema, role = f"p10_{tag}", f"p10_app_{tag}"
    with owner.begin() as conn:
        conn.execute(text(f"CREATE SCHEMA {schema}"))
        conn.execute(text(f"CREATE TABLE {schema}.before_t (id serial PRIMARY KEY, v text)"))
        conn.execute(text(f"CREATE TABLE {schema}.alembic_version (version_num varchar(32) PRIMARY KEY)"))
        conn.execute(text(f"INSERT INTO {schema}.alembic_version VALUES ('head1')"))
    yield owner, schema, role
    with owner.begin() as conn:
        conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        if conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first():
            conn.execute(text(f"DROP OWNED BY {role}"))
            conn.execute(text(f"DROP ROLE {role}"))
    owner.dispose()


def _as_role(role: str, password: str, schema: str):
    url = make_url(TEST_DATABASE_URL).set(username=role, password=password)
    return create_engine(url, connect_args={"options": f"-c search_path={schema}"})


def test_provisioned_role_can_use_rows_but_not_the_schema(scratch):
    owner, schema, role = scratch
    password = "p10-" + uuid4().hex
    with owner.begin() as conn:
        result = app_db_role.provision(conn, role, password, schema)
        assert result["created"] is True and result["tables"] == 2
        # A table created later by a migration (same owner) is covered by default privileges.
        conn.execute(text(f"CREATE TABLE {schema}.after_t (id serial PRIMARY KEY, v text)"))

    app = _as_role(role, password, schema)
    try:
        with app.begin() as conn:
            conn.execute(text("INSERT INTO before_t (v) VALUES ('a')"))
            conn.execute(text("UPDATE before_t SET v = 'b'"))
            conn.execute(text("INSERT INTO after_t (v) VALUES ('c')"))
            conn.execute(text("DELETE FROM after_t"))
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "head1"
        with app.connect() as conn:
            assert app_db_role.check(conn, schema) == []
        for forbidden in (
            "CREATE TABLE sneaky (id int)",
            "UPDATE alembic_version SET version_num = 'x'",
            "DELETE FROM alembic_version",
            "DROP TABLE before_t",
            "ALTER TABLE before_t ADD COLUMN x int",
            f"CREATE ROLE p10_evil_{uuid4().hex[:6]}",
        ):
            with app.begin() as conn, pytest.raises(ProgrammingError):
                conn.execute(text(forbidden))
    finally:
        app.dispose()


def test_provision_is_idempotent_and_rotates_the_password(scratch):
    owner, schema, role = scratch
    with owner.begin() as conn:
        app_db_role.provision(conn, role, "first-password-123456", schema)
    with owner.begin() as conn:
        assert app_db_role.provision(conn, role, "second-password-123456", schema)["created"] is False
    app = _as_role(role, "second-password-123456", schema)
    try:
        with app.connect() as conn:
            assert app_db_role.check(conn, schema) == []
    finally:
        app.dispose()


def test_check_flags_a_superuser_or_owner_connection(scratch):
    owner, schema, _ = scratch
    with owner.connect() as conn:
        is_super = conn.execute(text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar_one()
        problems = app_db_role.check(conn, schema)
    assert any("owns" in p for p in problems)
    assert any("CREATE in schema" in p for p in problems)
    assert any("alembic_version" in p for p in problems)
    if is_super:
        assert any("SUPERUSER" in p for p in problems)


def test_provision_refuses_weak_input(scratch):
    owner, schema, role = scratch
    with owner.begin() as conn:
        with pytest.raises(ValueError):
            app_db_role.provision(conn, role, "short", schema)
        with pytest.raises(ValueError):
            app_db_role.provision(conn, "bad-name;drop", "long-enough-password-123", schema)
        me = conn.execute(text("SELECT current_user")).scalar_one()
        with pytest.raises(ValueError):
            app_db_role.provision(conn, me, "long-enough-password-123", schema)


def test_cli_needs_explicit_inputs_and_never_echoes_the_password(capsys):
    assert app_db_role.main([], env={}) == 2
    assert app_db_role.main(["provision"], env={}) == 2
    assert app_db_role.main(["provision"], env={"DATABASE_URL": TEST_DATABASE_URL}) == 2
    out = capsys.readouterr()
    assert "APP_DB_PASSWORD" in out.err
