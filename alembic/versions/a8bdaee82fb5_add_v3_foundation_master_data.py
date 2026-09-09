"""add v3 foundation master data

Revision ID: a8bdaee82fb5
Revises: f40eb5b071a6
Create Date: 2026-08-07 12:27:52.060019

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8bdaee82fb5'
down_revision: Union[str, None] = 'f40eb5b071a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---------------------------------------------------------
    # 1. BRAND
    # ---------------------------------------------------------

    op.create_table(
        "brands",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "brand_code",
            sa.String(length=50),
            nullable=True,
        ),
        sa.Column(
            "brand_name",
            sa.String(length=255),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_brands",
        ),
        sa.UniqueConstraint(
            "brand_code",
            name="uq_brands_brand_code",
        ),
        sa.UniqueConstraint(
            "brand_name",
            name="uq_brands_brand_name",
        ),
    )

    op.create_index(
        "ix_brands_is_active",
        "brands",
        ["is_active"],
        unique=False,
    )

    # ---------------------------------------------------------
    # 2. UNIT
    # ---------------------------------------------------------

    op.create_table(
        "units",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "code",
            sa.String(length=20),
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(length=100),
            nullable=False,
        ),
        sa.Column(
            "unit_type",
            sa.String(length=30),
            nullable=False,
        ),
        sa.Column(
            "decimal_places",
            sa.SmallInteger(),
            nullable=False,
            server_default=sa.text("3"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_units",
        ),
        sa.UniqueConstraint(
            "code",
            name="uq_units_code",
        ),
    )

    op.create_index(
        "ix_units_unit_type",
        "units",
        ["unit_type"],
        unique=False,
    )

    op.create_index(
        "ix_units_is_active",
        "units",
        ["is_active"],
        unique=False,
    )

    # ---------------------------------------------------------
    # 3. WAREHOUSE
    # ---------------------------------------------------------

    op.create_table(
        "warehouses",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "warehouse_code",
            sa.String(length=50),
            nullable=False,
        ),
        sa.Column(
            "warehouse_name",
            sa.String(length=255),
            nullable=False,
        ),
        sa.Column(
            "warehouse_type",
            sa.String(length=50),
            nullable=True,
        ),
        sa.Column(
            "address",
            sa.String(length=500),
            nullable=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_warehouses",
        ),
        sa.UniqueConstraint(
            "warehouse_code",
            name="uq_warehouses_warehouse_code",
        ),
    )

    op.create_index(
        "ix_warehouses_warehouse_type",
        "warehouses",
        ["warehouse_type"],
        unique=False,
    )

    op.create_index(
        "ix_warehouses_is_active",
        "warehouses",
        ["is_active"],
        unique=False,
    )

    # ---------------------------------------------------------
    # 4. WAREHOUSE LOCATION
    # ---------------------------------------------------------

    op.create_table(
        "warehouse_locations",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "warehouse_id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "location_code",
            sa.String(length=50),
            nullable=False,
        ),
        sa.Column(
            "location_name",
            sa.String(length=255),
            nullable=True,
        ),
        sa.Column(
            "location_type",
            sa.String(length=50),
            nullable=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["warehouse_id"],
            ["warehouses.id"],
            name="fk_warehouse_locations_warehouse_id",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_warehouse_locations",
        ),
        sa.UniqueConstraint(
            "warehouse_id",
            "location_code",
            name="uq_warehouse_location_code",
        ),
    )

    op.create_index(
        "ix_warehouse_locations_warehouse_id",
        "warehouse_locations",
        ["warehouse_id"],
        unique=False,
    )

    op.create_index(
        "ix_warehouse_locations_location_type",
        "warehouse_locations",
        ["location_type"],
        unique=False,
    )

    op.create_index(
        "ix_warehouse_locations_is_active",
        "warehouse_locations",
        ["is_active"],
        unique=False,
    )

    # ---------------------------------------------------------
    # 5. PRODUCT V3 TRANSITION COLUMNS
    # ---------------------------------------------------------

    # Important:
    # server_default is required because products may already contain rows.

    op.add_column(
        "products",
        sa.Column(
            "product_type",
            sa.String(length=30),
            nullable=False,
            server_default="MERCHANDISE",
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "brand_id",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "base_unit_id",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "standard_cost",
            sa.Numeric(18, 4),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "minimum_stock",
            sa.Numeric(18, 3),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "maximum_stock",
            sa.Numeric(18, 3),
            nullable=True,
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "safety_stock",
            sa.Numeric(18, 3),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "shelf_life_days",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "track_batch",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "track_expiry",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "track_weight",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "products",
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ---------------------------------------------------------
    # 6. STOCK QTY INTEGER -> DECIMAL
    # ---------------------------------------------------------

    # Existing NULL stock must be converted before NOT NULL.
    op.execute(
        """
        UPDATE products
        SET stock_qty = 0
        WHERE stock_qty IS NULL
        """
    )

    op.alter_column(
        "products",
        "stock_qty",
        existing_type=sa.Integer(),
        type_=sa.Numeric(18, 3),
        existing_nullable=True,
        nullable=False,
        postgresql_using="stock_qty::numeric(18,3)",
    )

    # ---------------------------------------------------------
    # 7. PRODUCT FOREIGN KEYS
    # ---------------------------------------------------------

    op.create_foreign_key(
        "fk_products_brand_id",
        "products",
        "brands",
        ["brand_id"],
        ["id"],
    )

    op.create_foreign_key(
        "fk_products_base_unit_id",
        "products",
        "units",
        ["base_unit_id"],
        ["id"],
    )

    # ---------------------------------------------------------
    # 8. PRODUCT INDEXES
    # ---------------------------------------------------------

    op.create_index(
        "ix_products_brand_id",
        "products",
        ["brand_id"],
        unique=False,
    )

    op.create_index(
        "ix_products_base_unit_id",
        "products",
        ["base_unit_id"],
        unique=False,
    )

    op.create_index(
        "ix_products_product_type",
        "products",
        ["product_type"],
        unique=False,
    )

    op.create_index(
        "ix_products_is_active",
        "products",
        ["is_active"],
        unique=False,
    )

    # category_id already exists from V2.
    # Add an index because it is frequently joined/filterable.
    op.create_index(
        "ix_products_category_id",
        "products",
        ["category_id"],
        unique=False,
    )

    # ---------------------------------------------------------
    # 9. PRODUCT UNIT CONVERSION
    # ---------------------------------------------------------

    op.create_table(
        "product_unit_conversions",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "from_unit_id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "to_unit_id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "conversion_factor",
            sa.Numeric(18, 6),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "conversion_factor > 0",
            name="ck_conversion_factor_positive",
        ),
        sa.CheckConstraint(
            "from_unit_id <> to_unit_id",
            name="ck_conversion_units_different",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_product_unit_conversions_product_id",
        ),
        sa.ForeignKeyConstraint(
            ["from_unit_id"],
            ["units.id"],
            name="fk_product_unit_conversions_from_unit_id",
        ),
        sa.ForeignKeyConstraint(
            ["to_unit_id"],
            ["units.id"],
            name="fk_product_unit_conversions_to_unit_id",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_product_unit_conversions",
        ),
        sa.UniqueConstraint(
            "product_id",
            "from_unit_id",
            "to_unit_id",
            name="uq_product_unit_conversion",
        ),
    )

    op.create_index(
        "ix_product_unit_conversions_product_id",
        "product_unit_conversions",
        ["product_id"],
        unique=False,
    )

    op.create_index(
        "ix_product_unit_conversions_from_unit_id",
        "product_unit_conversions",
        ["from_unit_id"],
        unique=False,
    )

    op.create_index(
        "ix_product_unit_conversions_to_unit_id",
        "product_unit_conversions",
        ["to_unit_id"],
        unique=False,
    )


def downgrade() -> None:
    # Product unit conversions
    op.drop_index(
        "ix_product_unit_conversions_to_unit_id",
        table_name="product_unit_conversions",
    )

    op.drop_index(
        "ix_product_unit_conversions_from_unit_id",
        table_name="product_unit_conversions",
    )

    op.drop_index(
        "ix_product_unit_conversions_product_id",
        table_name="product_unit_conversions",
    )

    op.drop_table(
        "product_unit_conversions"
    )

    # Product indexes
    op.drop_index(
        "ix_products_category_id",
        table_name="products",
    )

    op.drop_index(
        "ix_products_is_active",
        table_name="products",
    )

    op.drop_index(
        "ix_products_product_type",
        table_name="products",
    )

    op.drop_index(
        "ix_products_base_unit_id",
        table_name="products",
    )

    op.drop_index(
        "ix_products_brand_id",
        table_name="products",
    )

    # Product FK
    op.drop_constraint(
        "fk_products_base_unit_id",
        "products",
        type_="foreignkey",
    )

    op.drop_constraint(
        "fk_products_brand_id",
        "products",
        type_="foreignkey",
    )

    # Decimal back to integer.
    # WARNING:
    # Fractional stock will lose its decimal part on downgrade.
    op.alter_column(
        "products",
        "stock_qty",
        existing_type=sa.Numeric(18, 3),
        type_=sa.Integer(),
        existing_nullable=False,
        nullable=True,
        postgresql_using="stock_qty::integer",
    )

    op.drop_column(
        "products",
        "updated_at",
    )

    op.drop_column(
        "products",
        "track_weight",
    )

    op.drop_column(
        "products",
        "track_expiry",
    )

    op.drop_column(
        "products",
        "track_batch",
    )

    op.drop_column(
        "products",
        "shelf_life_days",
    )

    op.drop_column(
        "products",
        "safety_stock",
    )

    op.drop_column(
        "products",
        "maximum_stock",
    )

    op.drop_column(
        "products",
        "minimum_stock",
    )

    op.drop_column(
        "products",
        "standard_cost",
    )

    op.drop_column(
        "products",
        "base_unit_id",
    )

    op.drop_column(
        "products",
        "brand_id",
    )

    op.drop_column(
        "products",
        "product_type",
    )

    # Warehouse location
    op.drop_index(
        "ix_warehouse_locations_is_active",
        table_name="warehouse_locations",
    )

    op.drop_index(
        "ix_warehouse_locations_location_type",
        table_name="warehouse_locations",
    )

    op.drop_index(
        "ix_warehouse_locations_warehouse_id",
        table_name="warehouse_locations",
    )

    op.drop_table(
        "warehouse_locations"
    )

    # Warehouse
    op.drop_index(
        "ix_warehouses_is_active",
        table_name="warehouses",
    )

    op.drop_index(
        "ix_warehouses_warehouse_type",
        table_name="warehouses",
    )

    op.drop_table(
        "warehouses"
    )

    # Unit
    op.drop_index(
        "ix_units_is_active",
        table_name="units",
    )

    op.drop_index(
        "ix_units_unit_type",
        table_name="units",
    )

    op.drop_table(
        "units"
    )

    # Brand
    op.drop_index(
        "ix_brands_is_active",
        table_name="brands",
    )

    op.drop_table(
        "brands"
    )
