"""Expected Alembic head the running application code was built against.

``/ready`` compares this to the database's ``alembic_version`` so a deploy
that skipped its migration (or a DB that is ahead of the code) fails the
readiness check instead of serving broken traffic.

Update ``EXPECTED_ALEMBIC_HEAD`` in the same change that adds a migration.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

# Phase 9: users.is_active
EXPECTED_ALEMBIC_HEAD = "e81a00000001"


def current_db_revision(connection: Connection) -> str | None:
    """Read the single row of ``alembic_version``; ``None`` if unmigrated."""
    row = connection.execute(
        text("SELECT version_num FROM alembic_version")
    ).first()
    return row[0] if row else None
