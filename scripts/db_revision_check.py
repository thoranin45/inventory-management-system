"""Read-only check: does the database's Alembic revision match this build?

Never loads application settings and never falls back to the app
``DATABASE_URL``. The target must be given explicitly.

Usage:
    DB_REVISION_CHECK_DATABASE_URL=postgresql://u:p@host:5432/db \
        python scripts/db_revision_check.py

Exit codes:
    0  database revision == expected head
    1  mismatch (database ahead of / behind the code)
    2  could not complete (no URL, DB unreachable, no alembic_version)
"""
import os
import sys

from sqlalchemy import create_engine, text


def _expected_head() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "app", "core", "db_revision.py")
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("EXPECTED_ALEMBIC_HEAD"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("EXPECTED_ALEMBIC_HEAD not found")


def main() -> int:
    url = os.environ.get("DB_REVISION_CHECK_DATABASE_URL")
    if not url:
        print("Set DB_REVISION_CHECK_DATABASE_URL (explicit target; no fallback).")
        return 2

    expected = _expected_head()
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(text("SET TRANSACTION READ ONLY"))
                row = conn.execute(
                    text("SELECT version_num FROM alembic_version")
                ).first()
        actual = row[0] if row else None
    except Exception:
        print("Could not read alembic_version; verify read-only PostgreSQL access.")
        return 2
    finally:
        if engine is not None:
            engine.dispose()

    if actual == expected:
        print(f"OK  database revision {actual} matches expected head")
        return 0

    print(f"MISMATCH  database={actual!r}  expected_head={expected!r}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
