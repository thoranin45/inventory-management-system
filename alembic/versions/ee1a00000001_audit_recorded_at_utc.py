"""P11 B1: row-level timestamp provenance for audit_logs.

audit_logs.created_at is a naive ``now()`` -- wall-clock time in whatever
session TimeZone wrote the row (UTC in the stock postgres image), which
nothing records. The UI therefore could only show it unconverted, labelled
as a stored time, and showed UTC clock times to Bangkok users.

Same approach as ea1a00000004 (inventory_movements.recorded_at_utc):
1. ADD COLUMN recorded_at_utc TIMESTAMPTZ with NO default -- every existing
   row stays NULL ("provenance unverified"). ``ADD COLUMN ... DEFAULT now()``
   would stamp one upgrade-time instant onto all history.
2. SET DEFAULT now() -- the database stamps every NEW row.

No historical value is written or changed; created_at is untouched.

Downgrade is guarded: once any row carries a recorded instant, dropping the
column would destroy the only per-row timezone evidence. Rolling the API
image back does NOT need a downgrade: older code ignores the extra column.

Revision ID: ee1a00000001
Revises: ed1a00000001
"""
from alembic import op
import sqlalchemy as sa

revision = "ee1a00000001"
down_revision = "ed1a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("recorded_at_utc", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column(
        "audit_logs",
        "recorded_at_utc",
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    recorded = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM audit_logs WHERE recorded_at_utc IS NOT NULL"
    )).scalar()
    if recorded:
        raise RuntimeError(
            f"Refusing to downgrade ee1a00000001: {recorded} audit log row(s) carry a "
            "recorded_at_utc provenance instant that would be destroyed"
        )
    op.drop_column("audit_logs", "recorded_at_utc")
