"""Least-privilege runtime database role for the API (P10 finding F2).

The postgres image makes ``POSTGRES_USER`` a superuser. That role owns the
schema and runs migrations. The API itself should connect as a separate,
non-superuser role that can read and write rows but cannot change the schema,
create roles, bypass row-level security or rewrite ``alembic_version``.

Two subcommands, both reading ``DATABASE_URL`` from the environment:

``provision``  run as the migrator / schema owner (the ``migrate`` service):
    docker compose -f compose.prod.yml --profile migrate run --rm \
        -e APP_DB_PASSWORD migrate python scripts/app_db_role.py provision
  Creates or updates the role (default ``inventory_app``; ``APP_DB_ROLE``
  overrides), sets its password from ``APP_DB_PASSWORD`` (never printed),
  and grants DML on every table and sequence in the schema, plus default
  privileges so tables created by later migrations are covered too.
  ``alembic_version`` stays read-only. Idempotent: re-run it after every
  restore (backups are taken with ``--no-privileges``) and it is safe to run
  after every migration.

``check``  run as the API (the ``api`` service):
    docker compose -f compose.prod.yml exec api python scripts/app_db_role.py check
  Exits 1 unless the connected role is not a superuser, cannot create roles
  or databases, owns no table, cannot create objects in the schema and cannot
  write ``alembic_version``.

Exit codes: 0 ok, 1 check failed, 2 could not run (missing input, DB error).
"""
from __future__ import annotations

import os
import re
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

DEFAULT_ROLE = "inventory_app"
DEFAULT_SCHEMA = "public"
_IDENT = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _ident(conn: Connection, name: str) -> str:
    if not _IDENT.match(name):
        raise ValueError(f"unsafe identifier: {name!r}")
    return conn.execute(text("SELECT quote_ident(:n)"), {"n": name}).scalar_one()


def provision(conn: Connection, role: str, password: str, schema: str = DEFAULT_SCHEMA) -> dict:
    """Create/refresh ``role`` with DML-only rights on ``schema``. Caller commits."""
    if len(password) < 16:
        raise ValueError("APP_DB_PASSWORD must be at least 16 characters")
    r, s = _ident(conn, role), _ident(conn, schema)
    owner = _ident(conn, conn.execute(text("SELECT current_user")).scalar_one())
    if role == conn.execute(text("SELECT current_user")).scalar_one():
        raise ValueError("the app role must differ from the migrator role running this")
    pw = conn.execute(text("SELECT quote_literal(:p)"), {"p": password}).scalar_one()
    db = _ident(conn, conn.execute(text("SELECT current_database()")).scalar_one())

    exists = conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first()
    if not exists:
        conn.execute(text(f"CREATE ROLE {r} LOGIN"))
    conn.execute(text(
        f"ALTER ROLE {r} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS "
        f"NOINHERIT PASSWORD {pw}"
    ))
    conn.execute(text(f"GRANT CONNECT ON DATABASE {db} TO {r}"))
    conn.execute(text(f"GRANT USAGE ON SCHEMA {s} TO {r}"))
    conn.execute(text(f"REVOKE CREATE ON SCHEMA {s} FROM {r}"))
    conn.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {s} TO {r}"))
    conn.execute(text(f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {s} TO {r}"))
    conn.execute(text(
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {r}"
    ))
    conn.execute(text(
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {s} "
        f"GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {r}"
    ))
    has_alembic = conn.execute(text(
        "SELECT 1 FROM pg_tables WHERE schemaname = :s AND tablename = 'alembic_version'"
    ), {"s": schema}).first()
    if has_alembic:
        conn.execute(text(f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {s}.alembic_version FROM {r}"))
    tables = conn.execute(text(
        "SELECT count(*) FROM pg_tables WHERE schemaname = :s"
    ), {"s": schema}).scalar_one()
    return {"role": role, "created": not exists, "schema": schema, "tables": tables}


def check(conn: Connection, schema: str = DEFAULT_SCHEMA) -> list[str]:
    """Problems with the connected role; an empty list means least-privilege."""
    problems = []
    me = conn.execute(text(
        "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls "
        "FROM pg_roles WHERE rolname = current_user"
    )).one()
    if me.rolsuper:
        problems.append(f"role {me.rolname} is a SUPERUSER")
    if me.rolcreaterole:
        problems.append(f"role {me.rolname} can create roles")
    if me.rolcreatedb:
        problems.append(f"role {me.rolname} can create databases")
    if me.rolbypassrls:
        problems.append(f"role {me.rolname} bypasses row-level security")
    owned = conn.execute(text(
        "SELECT count(*) FROM pg_tables WHERE schemaname = :s AND tableowner = current_user"
    ), {"s": schema}).scalar_one()
    if owned:
        problems.append(f"role {me.rolname} owns {owned} table(s) in {schema}")
    if conn.execute(text("SELECT has_schema_privilege(current_user, :s, 'CREATE')"), {"s": schema}).scalar_one():
        problems.append(f"role {me.rolname} can CREATE in schema {schema}")
    alembic = f"{schema}.alembic_version"
    if conn.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": alembic}).scalar_one():
        if not conn.execute(text("SELECT has_table_privilege(current_user, :t, 'SELECT')"), {"t": alembic}).scalar_one():
            problems.append("cannot read alembic_version (/ready needs it)")
        for priv in ("INSERT", "UPDATE", "DELETE"):
            if conn.execute(text("SELECT has_table_privilege(current_user, :t, :p)"), {"t": alembic, "p": priv}).scalar_one():
                problems.append(f"can {priv} alembic_version")
    return problems


def main(argv: list[str], env=os.environ) -> int:
    if len(argv) != 1 or argv[0] not in ("provision", "check"):
        print("usage: app_db_role.py provision|check", file=sys.stderr)
        return 2
    url = env.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    schema = env.get("APP_DB_SCHEMA", DEFAULT_SCHEMA)
    engine = create_engine(url, hide_parameters=True)
    try:
        if argv[0] == "provision":
            password = env.get("APP_DB_PASSWORD", "")
            if not password:
                print("set APP_DB_PASSWORD (read from the environment only)", file=sys.stderr)
                return 2
            with engine.begin() as conn:
                result = provision(conn, env.get("APP_DB_ROLE", DEFAULT_ROLE), password, schema)
            state = "created" if result["created"] else "updated"
            print(f"OK  role {result['role']} {state}; DML on {result['tables']} table(s) in {result['schema']}; "
                  "alembic_version read-only; default privileges set")
            return 0
        with engine.connect() as conn:
            problems = check(conn, schema)
            who = conn.execute(text("SELECT current_user")).scalar_one()
        if problems:
            for p in problems:
                print(f"FAIL  {p}")
            return 1
        print(f"OK  API connects as {who}: not superuser, owns nothing, no DDL, alembic_version read-only")
        return 0
    except ValueError as exc:
        print(f"ERROR  {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # DB unreachable, permission denied, ...
        print(f"ERROR  {type(exc).__name__}: {str(exc).splitlines()[0][:200]}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
