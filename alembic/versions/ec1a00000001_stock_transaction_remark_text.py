"""V1-H3: stock_transactions.remark VARCHAR(255) -> TEXT.

A sales return writes ``Return from {so_number}. Reason: {reason}`` into this
column. ``so_number`` is up to 100 characters and the validated ``reason`` up to
255, so a legitimate return could exceed 255 characters, raise a database
error and roll the whole return back. ``inventory_movements.remark`` is already
VARCHAR(500) and holds the same text, so only this column changes. Nothing is
truncated: the stored text is exactly what the application writes.

PostgreSQL treats VARCHAR(n) -> TEXT as binary-coercible: no table rewrite, no
data change, existing rows and the remark-prefix lookup are unaffected.

Downgrade restores VARCHAR(255) only if every stored remark still fits; it never
truncates history.

Revision ID: ec1a00000001
Revises: eb1a00000001
"""
from alembic import op
import sqlalchemy as sa

revision = "ec1a00000001"
down_revision = "eb1a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("stock_transactions", "remark", type_=sa.Text(),
                    existing_type=sa.String(length=255), existing_nullable=True)


def downgrade() -> None:
    connection = op.get_bind()
    too_long = connection.scalar(sa.text(
        "SELECT count(*) FROM stock_transactions WHERE char_length(remark) > 255"))
    if too_long:
        raise RuntimeError(
            f"Refusing to downgrade ec1a00000001: {too_long} stock_transactions.remark value(s) "
            "exceed 255 characters and would be truncated")
    op.alter_column("stock_transactions", "remark", type_=sa.String(length=255),
                    existing_type=sa.Text(), existing_nullable=True)
