"""Phase 14B: Stock Adjustment Request & Approval workflow.

Warehouse users submit a correction request; only Admin may approve or
reject it. No inventory changes until approval. One new, purely additive
table -- zero changes to any existing table or column.

``status`` stays a plain String with no DB enum or CHECK constraint,
matching every other lifecycle table in this codebase (purchase_orders,
sales_orders, inventory_transfers) -- validity is enforced in the service
layer, never at the schema level. No unique constraint on the
(product, warehouse, location, batch) scope: multiple legitimate pending
requests for the same scope are permitted by design and arbitrated safely
at approval time by a stale-quantity check, not blocked at creation.

Idempotency for both CREATE and APPROVE reuses the existing
stock_operation_receipts table (new operation_type values
STOCK_ADJUST_REQUEST_CREATE / STOCK_ADJUST_REQUEST_APPROVAL) rather than
duplicating fingerprint/snapshot columns here.

Revision ID: ea1a00000002
Revises: ea1a00000001
"""
from alembic import op
import sqlalchemy as sa

revision = "ea1a00000002"
down_revision = "ea1a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_adjustment_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_number", sa.String(20), nullable=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", name="fk_stock_adjustment_requests_product"), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), sa.ForeignKey("warehouses.id", name="fk_stock_adjustment_requests_warehouse"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("warehouse_locations.id", name="fk_stock_adjustment_requests_location"), nullable=False),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("product_batches.id", name="fk_stock_adjustment_requests_batch"), nullable=True),
        sa.Column("observed_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("requested_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("reason_code", sa.String(40), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_stock_adjustment_requests_requested_by_user"), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_stock_adjustment_requests_reviewed_by_user"), nullable=True),
        sa.Column("rejection_reason", sa.String(500), nullable=True),
        sa.Column("create_operation_key", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("reference_number", name="uq_stock_adjustment_requests_reference_number"),
    )
    op.create_index(
        "ix_stock_adjustment_requests_status_created_at",
        "stock_adjustment_requests", ["status", "created_at"],
    )
    op.create_index(
        "ix_stock_adjustment_requests_scope_status",
        "stock_adjustment_requests", ["product_id", "warehouse_id", "location_id", "status"],
    )
    op.create_index(
        "ix_stock_adjustment_requests_requested_by_user_id",
        "stock_adjustment_requests", ["requested_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_stock_adjustment_requests_requested_by_user_id", table_name="stock_adjustment_requests")
    op.drop_index("ix_stock_adjustment_requests_scope_status", table_name="stock_adjustment_requests")
    op.drop_index("ix_stock_adjustment_requests_status_created_at", table_name="stock_adjustment_requests")
    op.drop_table("stock_adjustment_requests")
