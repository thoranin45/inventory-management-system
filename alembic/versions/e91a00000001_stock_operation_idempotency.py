"""Phase 12C.0: durable idempotency for parent-less stock intake.

``POST /stock/in`` and ``POST /batches`` apply inventory but, unlike PO and
transfer receipts, have no parent row to hang a receipt off. This adds a single
table keyed by the client-supplied ``Idempotency-Key`` so a retried Save-once
Stock-In session replays its stored response instead of applying stock twice.

Additive only. New empty table, no data rewrite, no lock on existing tables.
The endpoints keep working without a key (legacy callers); when a key is
present it is honoured.

Revision ID: e91a00000001
Revises: e81a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e91a00000001"
down_revision = "e81a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_operation_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operation_type", sa.String(32), nullable=False),
        sa.Column("operation_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("response_snapshot", JSONB(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("operation_key", name="uq_stock_operation_receipt_key"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM stock_operation_receipts")):
        raise RuntimeError("Cannot downgrade: recorded stock-operation idempotency history would be lost")
    op.drop_table("stock_operation_receipts")
