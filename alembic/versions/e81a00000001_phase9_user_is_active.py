"""Phase 9: users.is_active — allow disabling a compromised or departed account.

Additive only. One column, ``NOT NULL DEFAULT TRUE``. Existing rows are filled
by the server default, so every current user stays active. No data rewrite,
no coordinated rollout required (brief metadata-only lock on the small
``users`` table).

Authorization reloads the DB user on every request, so setting a row to
``is_active = FALSE`` makes that user's existing JWTs unusable immediately —
no token blocklist is introduced.

Revision ID: e81a00000001
Revises: e71a00000001
"""
from alembic import op
import sqlalchemy as sa

revision = "e81a00000001"
down_revision = "e71a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    connection = op.get_bind()
    inactive = connection.execute(
        sa.text("SELECT id FROM users WHERE is_active = FALSE ORDER BY id")
    ).scalars().all()
    if inactive:
        raise RuntimeError(
            "Cannot downgrade Phase 9: disabled user accounts would be "
            f"silently re-enabled; user identifiers: {inactive}"
        )
    op.drop_column("users", "is_active")
