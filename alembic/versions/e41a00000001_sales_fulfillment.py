"""Sales fulfillment progress; preserve legacy terminal history.

Revision ID: e41a00000001
Revises: e31a00000002
"""
from alembic import op
import sqlalchemy as sa
from scripts.check_phase4_preflight import require_phase4_compatible

revision = "e41a00000001"
down_revision = "e31a00000002"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    op.execute("LOCK TABLE sales_orders, sales_order_items, sales_order_batch_allocations, products, product_batches, stock_balances, warehouses, warehouse_locations IN ACCESS EXCLUSIVE MODE")
    plans = require_phase4_compatible(connection)
    for stage in ("picked", "packed", "shipped"):
        op.add_column("sales_orders", sa.Column(stage + "_at", sa.DateTime(timezone=True)))
        op.add_column("sales_orders", sa.Column(stage + "_by_user_id", sa.Integer()))
        op.create_foreign_key(None, "sales_orders", "users", [stage + "_by_user_id"], ["id"])
    op.add_column("sales_orders", sa.Column("shipment_number", sa.String(100)))
    op.create_unique_constraint("sales_orders_shipment_number_key", "sales_orders", ["shipment_number"])
    op.add_column("sales_order_batch_allocations", sa.Column("stock_balance_id", sa.Integer()))
    op.create_foreign_key(None, "sales_order_batch_allocations", "stock_balances", ["stock_balance_id"], ["id"])
    for field in ("picked_quantity", "packed_quantity"):
        op.add_column("sales_order_batch_allocations", sa.Column(field, sa.Numeric(18, 3)))
    op.create_check_constraint("ck_sales_allocations_fulfillment_quantities", "sales_order_batch_allocations",
                               "(picked_quantity IS NULL AND packed_quantity IS NULL) OR (picked_quantity IS NOT NULL AND packed_quantity IS NOT NULL AND packed_quantity >= 0 AND picked_quantity >= packed_quantity AND quantity >= picked_quantity)")
    # Only live reservations gain source metadata. No physical/reserved quantity changes.
    for plan in plans:
        if plan["allocation_id"] is not None:
            connection.execute(sa.text("UPDATE sales_order_batch_allocations SET stock_balance_id=:stock_balance_id,picked_quantity=0,packed_quantity=0 WHERE id=:allocation_id"), plan)
        else:
            connection.execute(sa.text("INSERT INTO sales_order_batch_allocations(sales_order_id,sales_order_item_id,product_id,quantity,stock_balance_id,picked_quantity,packed_quantity) VALUES (:sales_order_id,:sales_order_item_id,:product_id,:quantity,:stock_balance_id,0,0)"), plan)


def downgrade():
    op.execute("LOCK TABLE sales_orders, sales_order_batch_allocations IN ACCESS EXCLUSIVE MODE")
    connection = op.get_bind()
    ids = connection.execute(sa.text("SELECT id FROM sales_orders WHERE status IS NULL OR status NOT IN ('CONFIRMED','COMPLETED','CANCELLED') OR picked_at IS NOT NULL OR packed_at IS NOT NULL OR shipped_at IS NOT NULL OR shipment_number IS NOT NULL OR picked_by_user_id IS NOT NULL OR packed_by_user_id IS NOT NULL OR shipped_by_user_id IS NOT NULL UNION SELECT sales_order_id FROM sales_order_batch_allocations WHERE picked_quantity > 0 OR packed_quantity > 0")).scalars().all()
    if ids:
        raise RuntimeError(f"Cannot downgrade Phase 4 fulfillment history; order identifiers: {ids}")
    # Non-batch allocation metadata did not exist before Phase 4; quantities are untouched.
    op.execute("DELETE FROM sales_order_batch_allocations WHERE batch_id IS NULL AND stock_balance_id IS NOT NULL")
    op.drop_constraint("ck_sales_allocations_fulfillment_quantities", "sales_order_batch_allocations", type_="check")
    for field in ("stock_balance_id", "picked_quantity", "packed_quantity"):
        op.drop_column("sales_order_batch_allocations", field)
    op.drop_column("sales_orders", "shipment_number")
    for stage in ("picked", "packed", "shipped"):
        op.drop_column("sales_orders", stage + "_at")
        op.drop_column("sales_orders", stage + "_by_user_id")
