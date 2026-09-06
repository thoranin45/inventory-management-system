"""Product-scoped lots and query-backed inventory indexes.

Revision ID: e31a00000002
Revises: e31a00000001
"""
from alembic import op
import sqlalchemy as sa

from scripts.check_phase3_preflight import require_compatible_inventory

revision = "e31a00000002"
down_revision = "e31a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    op.execute("LOCK TABLE product_batches, sales_order_items, purchase_order_items IN ACCESS EXCLUSIVE MODE")
    require_compatible_inventory(connection)
    global_lots = [c for c in sa.inspect(connection).get_unique_constraints("product_batches")
                   if c["column_names"] == ["lot_no"]]
    if len(global_lots) != 1 or global_lots[0]["name"] != "product_batches_lot_no_key":
        raise RuntimeError("Expected global lot constraint product_batches_lot_no_key; inspect schema before upgrading")
    op.create_unique_constraint("uq_product_batches_product_lot", "product_batches", ["product_id", "lot_no"])
    op.drop_constraint(global_lots[0]["name"], "product_batches", type_="unique")
    op.create_unique_constraint("uq_sales_order_items_order_product", "sales_order_items", ["sales_order_id", "product_id"])
    op.create_unique_constraint("uq_purchase_order_items_po_product", "purchase_order_items", ["po_id", "product_id"])
    op.create_index("ix_product_batches_product_expiry", "product_batches", ["product_id", "expiry_date", "created_at", "id"])
    op.create_index("ix_sales_allocations_order_item", "sales_order_batch_allocations", ["sales_order_id", "sales_order_item_id", "id"])
    op.create_index("ix_stock_transactions_product_type", "stock_transactions", ["product_id", "transaction_type"])


def downgrade() -> None:
    op.execute("LOCK TABLE product_batches IN ACCESS EXCLUSIVE MODE")
    groups = op.get_bind().execute(sa.text(
        "SELECT array_agg(id ORDER BY id) FROM product_batches WHERE lot_no IS NOT NULL "
        "GROUP BY lot_no HAVING count(*) > 1"
    )).scalars().all()
    if groups:
        raise RuntimeError(f"Cannot restore global lot uniqueness; conflicting batch identifiers: {groups}")
    op.create_unique_constraint("product_batches_lot_no_key", "product_batches", ["lot_no"])
    op.drop_constraint("uq_product_batches_product_lot", "product_batches", type_="unique")
    op.drop_index("ix_stock_transactions_product_type", table_name="stock_transactions")
    op.drop_index("ix_sales_allocations_order_item", table_name="sales_order_batch_allocations")
    op.drop_index("ix_product_batches_product_expiry", table_name="product_batches")
    op.drop_constraint("uq_purchase_order_items_po_product", "purchase_order_items", type_="unique")
    op.drop_constraint("uq_sales_order_items_order_product", "sales_order_items", type_="unique")
