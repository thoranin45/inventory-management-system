"""Phase 14C: row-level timestamp provenance for inventory_movements.

inventory_movements.created_at is a naive ``now()`` -- wall-clock time in
whatever session TimeZone wrote the row, which nothing records. This adds
``recorded_at_utc TIMESTAMPTZ``: an explicit instant the database itself
stamps on every NEW row, so each row carries its own proof of when it was
recorded, independent of any session or configuration.

Two steps, deliberately:
1. ADD COLUMN with NO default -- every existing row stays NULL. (Since
   PostgreSQL 11, ``ADD COLUMN ... DEFAULT now()`` would evaluate now() once
   and stamp that single value onto every historical row, falsely marking
   all history as verified.)
2. SET DEFAULT now() -- applies only to rows inserted from now on.

No historical value is written or changed; created_at is untouched.
NULL = "provenance unverified" (all pre-revision history).

Downgrade is guarded: once any row carries a recorded instant, dropping the
column would destroy the only per-row timezone evidence.

Revision ID: ea1a00000004
Revises: ea1a00000003
"""
from alembic import op
import sqlalchemy as sa

revision = "ea1a00000004"
down_revision = "ea1a00000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_movements",
        sa.Column("recorded_at_utc", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column(
        "inventory_movements",
        "recorded_at_utc",
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    recorded = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM inventory_movements WHERE recorded_at_utc IS NOT NULL"
    )).scalar()
    if recorded:
        raise RuntimeError(
            f"Refusing to downgrade ea1a00000004: {recorded} inventory movement(s) carry a "
            "recorded_at_utc provenance instant that would be destroyed"
        )
    op.drop_column("inventory_movements", "recorded_at_utc")
