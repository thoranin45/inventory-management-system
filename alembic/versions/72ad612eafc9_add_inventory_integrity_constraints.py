"""add inventory integrity constraints

Revision ID: 72ad612eafc9
Revises: 935925e73f2d
Create Date: 2026-08-09 14:23:35.199934

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '72ad612eafc9'
down_revision: Union[str, None] = '935925e73f2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "product_batches",
        "product_id",
        existing_type=sa.INTEGER(),
        nullable=False,
    )

    op.create_check_constraint(
        "ck_products_stock_qty_non_negative",
        "products",
        "stock_qty >= 0",
    )

    op.create_check_constraint(
        "ck_product_batches_quantity_non_negative",
        "product_batches",
        "quantity >= 0",
    )

    op.create_check_constraint(
        "ck_purchase_order_items_quantity_positive",
        "purchase_order_items",
        "quantity > 0",
    )

    op.create_check_constraint(
        "ck_purchase_order_items_received_quantity_non_negative",
        "purchase_order_items",
        "received_quantity >= 0",
    )

    op.create_check_constraint(
        "ck_purchase_order_items_received_quantity_lte_quantity",
        "purchase_order_items",
        "received_quantity <= quantity",
    )

    op.create_check_constraint(
        "ck_sales_order_items_quantity_positive",
        "sales_order_items",
        "quantity > 0",
    )

    op.create_check_constraint(
        "ck_sales_order_batch_allocations_quantity_positive",
        "sales_order_batch_allocations",
        "quantity > 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_sales_order_batch_allocations_quantity_positive",
        "sales_order_batch_allocations",
        type_="check",
    )

    op.drop_constraint(
        "ck_sales_order_items_quantity_positive",
        "sales_order_items",
        type_="check",
    )

    op.drop_constraint(
        "ck_purchase_order_items_received_quantity_lte_quantity",
        "purchase_order_items",
        type_="check",
    )

    op.drop_constraint(
        "ck_purchase_order_items_received_quantity_non_negative",
        "purchase_order_items",
        type_="check",
    )

    op.drop_constraint(
        "ck_purchase_order_items_quantity_positive",
        "purchase_order_items",
        type_="check",
    )

    op.drop_constraint(
        "ck_product_batches_quantity_non_negative",
        "product_batches",
        type_="check",
    )

    op.drop_constraint(
        "ck_products_stock_qty_non_negative",
        "products",
        type_="check",
    )

    op.alter_column(
        "product_batches",
        "product_id",
        existing_type=sa.INTEGER(),
        nullable=True,
    )