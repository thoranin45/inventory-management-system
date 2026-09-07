"""PO confirmation and durable receipt replay.

Revision ID: e51a00000001
Revises: e41a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from scripts.check_phase5_preflight import require_phase5_compatible

revision = "e51a00000001"
down_revision = "e41a00000001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("LOCK TABLE purchase_orders, purchase_order_items, products, product_batches IN ACCESS EXCLUSIVE MODE")
    require_phase5_compatible(op.get_bind())
    op.create_table("purchase_order_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("po_id", sa.Integer(), sa.ForeignKey("purchase_orders.id"), nullable=False),
        sa.Column("receipt_number", sa.String(100), nullable=False),
        sa.Column("operation_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("received_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_snapshot", JSONB(), nullable=False),
        sa.UniqueConstraint("receipt_number", name="purchase_order_receipts_receipt_number_key"),
        sa.UniqueConstraint("po_id", "operation_key", name="uq_po_receipt_operation"))
    for field, table in (("purchase_receipt_id", "purchase_order_receipts"), ("purchase_order_item_id", "purchase_order_items"), ("stock_transaction_id", "stock_transactions")):
        op.add_column("inventory_movements", sa.Column(field, sa.Integer()))
        op.create_foreign_key(None, "inventory_movements", table, [field], ["id"])
    op.create_unique_constraint("uq_receipt_movement_item", "inventory_movements", ["purchase_receipt_id", "purchase_order_item_id"])
    op.execute("UPDATE purchase_orders SET status='CONFIRMED' WHERE status='PENDING'")


def downgrade():
    op.execute("LOCK TABLE purchase_orders, purchase_order_receipts, inventory_movements IN ACCESS EXCLUSIVE MODE")
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM purchase_order_receipts")):
        raise RuntimeError("Cannot downgrade recorded receipt history")
    ids = connection.execute(sa.text("SELECT id FROM purchase_orders WHERE status IS NULL OR status NOT IN ('CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')")).scalars().all()
    if ids:
        raise RuntimeError(f"Cannot downgrade PO lifecycle; identifiers: {ids}")
    op.execute("UPDATE purchase_orders SET status='PENDING' WHERE status='CONFIRMED'")
    op.drop_constraint("uq_receipt_movement_item", "inventory_movements", type_="unique")
    for field in ("purchase_receipt_id", "purchase_order_item_id", "stock_transaction_id"):
        op.drop_column("inventory_movements", field)
    op.drop_table("purchase_order_receipts")
