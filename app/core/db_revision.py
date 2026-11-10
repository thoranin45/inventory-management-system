"""Expected Alembic head the running application code was built against.

``/ready`` compares this to the database's ``alembic_version`` so a deploy
that skipped its migration (or a DB that is ahead of the code) fails the
readiness check instead of serving broken traffic.

Update ``EXPECTED_ALEMBIC_HEAD`` in the same change that adds a migration.
"""
import re

from sqlalchemy import text
from sqlalchemy.engine import URL, Connection, make_url

# Phase 14C: ea1a00000003 (ledger indexes + stock_adjustment_requests
# .stock_transaction_id link) + ea1a00000004 (movement recorded_at_utc)
# V1-H1: eb1a00000001 (sales_return_receipts)
# V1-H3: ec1a00000001 (stock_transactions.remark -> TEXT)
EXPECTED_ALEMBIC_HEAD = "ec1a00000001"


def current_db_revision(connection: Connection) -> str | None:
    """Read the single row of ``alembic_version``; ``None`` if unmigrated."""
    row = connection.execute(
        text("SELECT version_num FROM alembic_version")
    ).first()
    return row[0] if row else None


# Same "dedicated test database" rule as tests/database_support.validate_test_url.
_TEST_DATABASE_NAME = re.compile(r"(^|[_-])test($|[_-])", re.IGNORECASE)


def migration_target(raw_url: str | None, env: str) -> URL:
    """V1-H5A: validate the database an online ``alembic upgrade`` will touch.

    The target comes only from ``DATABASE_URL`` (app settings), never from
    alembic.ini. Fails closed when it is missing, unparsable, not PostgreSQL,
    the ini placeholder, or when ENV and the database name disagree about
    production vs test. Errors never echo the URL: it carries the password."""
    if not raw_url or not raw_url.strip():
        raise RuntimeError("DATABASE_URL is required for online migrations; alembic.ini is never used")
    try:
        url = make_url(raw_url)
    except Exception:
        raise RuntimeError("DATABASE_URL is not a valid database URL") from None
    if url.get_backend_name() != "postgresql":
        raise RuntimeError(f"migrations require PostgreSQL, not {url.get_backend_name()!r}")
    if not url.database or (url.host or "").endswith(".invalid"):
        raise RuntimeError("DATABASE_URL names no real database (placeholder target)")
    environment = (env or "").strip().lower()
    if environment == "production" and _TEST_DATABASE_NAME.search(url.database):
        raise RuntimeError(f"ENV=production but the target database {url.database!r} is a test database")
    if environment != "production" and "prod" in url.database.lower():
        raise RuntimeError(f"ENV={environment or 'unset'} but the target database {url.database!r} "
                           "looks like production")
    return url


def describe_migration_target(url: URL) -> str:
    """Credential-free identity of a migration target, for operator output."""
    return f"database {url.database!r} on {url.host or 'localhost'}:{url.port or 5432} as {url.username!r}"
