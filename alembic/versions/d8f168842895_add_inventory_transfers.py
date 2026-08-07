"""add inventory transfers

Revision ID: d8f168842895
Revises: bc773a4eb44e
Create Date: 2026-08-07 23:19:30.004530

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d8f168842895"
down_revision: Union[str, None] = "bc773a4eb44e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    op.create_table(
        "inventory_transfers",

        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "transfer_number",
            sa.String(length=50),
            nullable=False,
        ),

        sa.Column(
            "status",
            sa.String(length=30),
            server_default="DRAFT",
            nullable=False,
        ),

        sa.Column(
            "source_warehouse_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "destination_warehouse_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "requested_by_user_id",
            sa.Integer(),
            nullable=True,
        ),

        sa.Column(
            "completed_by_user_id",
            sa.Integer(),
            nullable=True,
        ),

        sa.Column(
            "remark",
            sa.String(length=500),
            nullable=True,
        ),

        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),

        sa.Column(
            "completed_at",
            sa.DateTime(),
            nullable=True,
        ),

        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),

        sa.ForeignKeyConstraint(
            ["completed_by_user_id"],
            ["users.id"],
            name=(
                "fk_inventory_transfers_"
                "completed_by_user"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["destination_warehouse_id"],
            ["warehouses.id"],
            name=(
                "fk_inventory_transfers_"
                "destination_warehouse"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            name=(
                "fk_inventory_transfers_"
                "requested_by_user"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["source_warehouse_id"],
            ["warehouses.id"],
            name=(
                "fk_inventory_transfers_"
                "source_warehouse"
            ),
        ),

        sa.PrimaryKeyConstraint(
            "id"
        ),

        sa.UniqueConstraint(
            "transfer_number",
            name=(
                "uq_inventory_transfers_"
                "transfer_number"
            ),
        ),
    )

    op.create_index(
        "ix_inventory_transfers_created_at",
        "inventory_transfers",
        ["created_at"],
        unique=False,
    )

    op.create_index(
        "ix_inventory_transfers_destination_warehouse",
        "inventory_transfers",
        ["destination_warehouse_id"],
        unique=False,
    )

    op.create_index(
        "ix_inventory_transfers_source_warehouse",
        "inventory_transfers",
        ["source_warehouse_id"],
        unique=False,
    )

    op.create_index(
        "ix_inventory_transfers_status",
        "inventory_transfers",
        ["status"],
        unique=False,
    )

    # --------------------------------------------------
    # Transfer Items
    # --------------------------------------------------

    op.create_table(
        "inventory_transfer_items",

        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "transfer_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "product_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "batch_id",
            sa.Integer(),
            nullable=True,
        ),

        sa.Column(
            "from_location_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "to_location_id",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "quantity",
            sa.Numeric(
                precision=18,
                scale=3,
            ),
            nullable=False,
        ),

        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),

        sa.CheckConstraint(
            "from_location_id <> to_location_id",
            name=(
                "ck_inventory_transfer_items_"
                "different_locations"
            ),
        ),

        sa.CheckConstraint(
            "quantity > 0",
            name=(
                "ck_inventory_transfer_items_"
                "quantity_positive"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["product_batches.id"],
            name=(
                "fk_inventory_transfer_items_"
                "batch"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["from_location_id"],
            ["warehouse_locations.id"],
            name=(
                "fk_inventory_transfer_items_"
                "from_location"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=(
                "fk_inventory_transfer_items_"
                "product"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["to_location_id"],
            ["warehouse_locations.id"],
            name=(
                "fk_inventory_transfer_items_"
                "to_location"
            ),
        ),

        sa.ForeignKeyConstraint(
            ["transfer_id"],
            ["inventory_transfers.id"],
            name=(
                "fk_inventory_transfer_items_"
                "transfer"
            ),
        ),

        sa.PrimaryKeyConstraint(
            "id"
        ),
    )

    # Normal indexes
    op.create_index(
        "ix_inventory_transfer_items_batch_id",
        "inventory_transfer_items",
        ["batch_id"],
        unique=False,
    )

    op.create_index(
        "ix_inventory_transfer_items_product_id",
        "inventory_transfer_items",
        ["product_id"],
        unique=False,
    )

    op.create_index(
        "ix_inventory_transfer_items_transfer_id",
        "inventory_transfer_items",
        ["transfer_id"],
        unique=False,
    )

    # Non-batch item uniqueness
    op.create_index(
        "uq_inventory_transfer_items_no_batch",
        "inventory_transfer_items",
        [
            "transfer_id",
            "product_id",
            "from_location_id",
            "to_location_id",
        ],
        unique=True,
        postgresql_where=sa.text(
            "batch_id IS NULL"
        ),
    )

    # Batch item uniqueness
    op.create_index(
        "uq_inventory_transfer_items_with_batch",
        "inventory_transfer_items",
        [
            "transfer_id",
            "product_id",
            "batch_id",
            "from_location_id",
            "to_location_id",
        ],
        unique=True,
        postgresql_where=sa.text(
            "batch_id IS NOT NULL"
        ),
    )


def downgrade() -> None:

    # Partial unique indexes must be removed
    # before dropping the table.

    op.drop_index(
        "uq_inventory_transfer_items_with_batch",
        table_name="inventory_transfer_items",
        postgresql_where=sa.text(
            "batch_id IS NOT NULL"
        ),
    )

    op.drop_index(
        "uq_inventory_transfer_items_no_batch",
        table_name="inventory_transfer_items",
        postgresql_where=sa.text(
            "batch_id IS NULL"
        ),
    )

    op.drop_index(
        "ix_inventory_transfer_items_transfer_id",
        table_name="inventory_transfer_items",
    )

    op.drop_index(
        "ix_inventory_transfer_items_product_id",
        table_name="inventory_transfer_items",
    )

    op.drop_index(
        "ix_inventory_transfer_items_batch_id",
        table_name="inventory_transfer_items",
    )

    op.drop_table(
        "inventory_transfer_items"
    )

    op.drop_index(
        "ix_inventory_transfers_status",
        table_name="inventory_transfers",
    )

    op.drop_index(
        "ix_inventory_transfers_source_warehouse",
        table_name="inventory_transfers",
    )

    op.drop_index(
        "ix_inventory_transfers_destination_warehouse",
        table_name="inventory_transfers",
    )

    op.drop_index(
        "ix_inventory_transfers_created_at",
        table_name="inventory_transfers",
    )

    op.drop_table(
        "inventory_transfers"
    )