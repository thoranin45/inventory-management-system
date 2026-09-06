"""Align transfer-header integrity with model metadata.

Revision ID: e31a00000001
Revises: 72ad612eafc9
"""
from alembic import op

from scripts.check_phase3_preflight import require_compatible_inventory

revision = "e31a00000001"
down_revision = "72ad612eafc9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("LOCK TABLE inventory_transfers IN ACCESS EXCLUSIVE MODE")
    require_compatible_inventory(op.get_bind())
    op.create_check_constraint(
        "ck_inventory_transfers_different_warehouses", "inventory_transfers",
        "source_warehouse_id <> destination_warehouse_id",
    )


def downgrade() -> None:
    op.drop_constraint("ck_inventory_transfers_different_warehouses", "inventory_transfers", type_="check")
