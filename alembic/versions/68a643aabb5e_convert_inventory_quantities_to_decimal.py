"""convert inventory quantities to decimal

Revision ID: 68a643aabb5e
Revises: a8bdaee82fb5
Create Date: 2026-08-07 13:44:53.365765

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '68a643aabb5e'
down_revision: Union[str, None] = 'a8bdaee82fb5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    op.alter_column(
        "product_batches",
        "quantity",
        existing_type=sa.INTEGER(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="quantity::numeric(18,3)",
    )

    op.alter_column(
        "purchase_order_items",
        "quantity",
        existing_type=sa.INTEGER(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="quantity::numeric(18,3)",
    )

    op.alter_column(
        "sales_order_batch_allocations",
        "quantity",
        existing_type=sa.INTEGER(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="quantity::numeric(18,3)",
    )

    op.alter_column(
        "sales_order_items",
        "quantity",
        existing_type=sa.INTEGER(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="quantity::numeric(18,3)",
    )

    op.alter_column(
        "stock_transactions",
        "quantity",
        existing_type=sa.INTEGER(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="quantity::numeric(18,3)",
    )


def downgrade() -> None:

    op.alter_column(
        "stock_transactions",
        "quantity",
        existing_type=sa.Numeric(18, 3),
        type_=sa.INTEGER(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="quantity::integer",
    )

    op.alter_column(
        "sales_order_items",
        "quantity",
        existing_type=sa.Numeric(18, 3),
        type_=sa.INTEGER(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="quantity::integer",
    )

    op.alter_column(
        "sales_order_batch_allocations",
        "quantity",
        existing_type=sa.Numeric(18, 3),
        type_=sa.INTEGER(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="quantity::integer",
    )

    op.alter_column(
        "purchase_order_items",
        "quantity",
        existing_type=sa.Numeric(18, 3),
        type_=sa.INTEGER(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="quantity::integer",
    )

    op.alter_column(
        "product_batches",
        "quantity",
        existing_type=sa.Numeric(18, 3),
        type_=sa.INTEGER(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="quantity::integer",
    )
