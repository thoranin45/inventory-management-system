"""Phase 14C: Inventory Ledger & Audit Traceability.

Purely additive except one redundant index swap. No data is rewritten or
backfilled (D2) -- historical rows keep exactly the values they were
written with.

inventory_movements:
- ix_inventory_movements_product_created_id (product_id, created_at, id)
  serves the ledger's dominant query (one product, newest first, stable
  id tie-break) without a sort step.
- ix_inventory_movements_product_id is dropped: it is the left prefix of
  the new composite, which also serves every FK / equality lookup on
  product_id, so keeping both only doubles write cost.
- ix_inventory_movements_reference_number: the new exact-match
  ``reference_number`` filter (ADJ-/PO-/SO-/transfer numbers, lot numbers).
  Plain btree, case-sensitive -- no expression index.

stock_adjustment_requests:
- stock_transaction_id (nullable FK -> stock_transactions.id, UNIQUE) is
  set on every successful approval, including a zero-difference approval
  that writes no InventoryMovement, so Request -> StockTransaction ->
  AuditLog(STOCK_ADJUST, record_id=transaction id) is always deterministic.
  NULL for every request approved before this revision (no backfill).

Downgrade is guarded: once any request carries a transaction link,
dropping the column would destroy the only deterministic Request ->
Transaction evidence, so the downgrade refuses instead.

Revision ID: ea1a00000003
Revises: ea1a00000002
"""
from alembic import op
import sqlalchemy as sa

revision = "ea1a00000003"
down_revision = "ea1a00000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_inventory_movements_product_created_id",
        "inventory_movements",
        ["product_id", "created_at", "id"],
    )
    op.drop_index("ix_inventory_movements_product_id", table_name="inventory_movements")
    op.create_index(
        "ix_inventory_movements_reference_number",
        "inventory_movements",
        ["reference_number"],
    )

    op.add_column(
        "stock_adjustment_requests",
        sa.Column("stock_transaction_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_stock_adjustment_requests_stock_transaction",
        "stock_adjustment_requests",
        "stock_transactions",
        ["stock_transaction_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_stock_adjustment_requests_stock_transaction_id",
        "stock_adjustment_requests",
        ["stock_transaction_id"],
    )


def downgrade() -> None:
    linked = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM stock_adjustment_requests WHERE stock_transaction_id IS NOT NULL"
    )).scalar()
    if linked:
        raise RuntimeError(
            f"Refusing to downgrade ea1a00000003: {linked} approved adjustment request(s) "
            "carry a stock_transaction_id link that would be destroyed"
        )

    op.drop_constraint(
        "uq_stock_adjustment_requests_stock_transaction_id",
        "stock_adjustment_requests",
        type_="unique",
    )
    op.drop_constraint(
        "fk_stock_adjustment_requests_stock_transaction",
        "stock_adjustment_requests",
        type_="foreignkey",
    )
    op.drop_column("stock_adjustment_requests", "stock_transaction_id")

    op.drop_index("ix_inventory_movements_reference_number", table_name="inventory_movements")
    op.create_index("ix_inventory_movements_product_id", "inventory_movements", ["product_id"])
    op.drop_index("ix_inventory_movements_product_created_id", table_name="inventory_movements")
