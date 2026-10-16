"""V1-H1: durable idempotency for sales returns.

``POST /sales-orders/{id}/return`` restocks goods. Without a request identity a
retried *partial* return (lost response, timeout, double submit) applied a
second time whenever it still fitted under the sold-quantity cap. This adds a
parent-scoped receipt table, following ``purchase_order_receipts`` and
``inventory_transfer_receipts``: the required ``Idempotency-Key`` is unique per
sales order, and the stored response is replayed for a retry.

Additive only. New empty table, no data rewrite, no lock on existing tables.

Revision ID: eb1a00000001
Revises: ea1a00000004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "eb1a00000001"
down_revision = "ea1a00000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_return_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
        sa.Column("receipt_number", sa.String(100), nullable=False),
        sa.Column("operation_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("returned_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_snapshot", JSONB(), nullable=False),
        sa.UniqueConstraint("receipt_number", name="sales_return_receipts_receipt_number_key"),
        sa.UniqueConstraint("sales_order_id", "operation_key", name="uq_sales_return_receipt_operation"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM sales_return_receipts")):
        raise RuntimeError("Cannot downgrade: recorded sales-return idempotency history would be lost")
    op.drop_table("sales_return_receipts")
