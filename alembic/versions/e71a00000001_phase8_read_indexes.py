"""Phase 8 read-path indexes for work queues, ordering and identifier lookup.

Additive only. No data rewrite. Each index has query evidence:

- ix_sales_orders_status_created_at    -> GET /sales-orders?status=... ORDER BY created_at; dashboard GROUP BY status
- ix_purchase_orders_status_created_at -> GET /purchase-orders?status=... ORDER BY created_at
- ix_purchase_orders_supplier_id       -> PO list/search join Supplier; supplier_name lookup
- ix_product_batches_lot_no            -> global search exact/prefix lot; GET /batches?search=
- ix_products_product_name             -> product list/search ordering & name match
- ix_customers_customer_name           -> global search customer; sales-order search join
- ix_suppliers_supplier_name           -> global search supplier; PO search join
- ix_audit_logs_created_at             -> GET /audit-logs ORDER BY created_at DESC
- ix_stock_transactions_created_at     -> /reports/stock-movement, /dashboard/recent-transactions ORDER BY created_at DESC

Revision ID: e71a00000001
Revises: e61a00000001
"""
from alembic import op

revision = "e71a00000001"
down_revision = "e61a00000001"
branch_labels = None
depends_on = None


_INDEXES = [
    ("ix_sales_orders_status_created_at", "sales_orders", ["status", "created_at"]),
    ("ix_purchase_orders_status_created_at", "purchase_orders", ["status", "created_at"]),
    ("ix_purchase_orders_supplier_id", "purchase_orders", ["supplier_id"]),
    ("ix_product_batches_lot_no", "product_batches", ["lot_no"]),
    ("ix_products_product_name", "products", ["product_name"]),
    ("ix_customers_customer_name", "customers", ["customer_name"]),
    ("ix_suppliers_supplier_name", "suppliers", ["supplier_name"]),
    ("ix_audit_logs_created_at", "audit_logs", ["created_at"]),
    ("ix_stock_transactions_created_at", "stock_transactions", ["created_at"]),
]


def upgrade() -> None:
    for name, table, cols in _INDEXES:
        op.create_index(name, table, cols)


def downgrade() -> None:
    for name, table, _cols in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
