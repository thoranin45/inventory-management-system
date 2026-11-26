"""F1a quotations: quotations and quotation_items.

Additive only: two new tables. No existing table, column, constraint or row
is changed (the link to a sales order lives on ``quotations``, not on
``sales_orders``). Numbers come from the F0a ``document_sequences`` table
(doc_type ``QT``).

Downgrade is guarded: it refuses once any quotation exists, because dropping
the tables would destroy business documents. Rolling the API image back does
NOT need a downgrade: older code ignores the extra tables.

Revision ID: f01a00000001
Revises: ef1a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f01a00000001"
down_revision = "ef1a00000001"
branch_labels = None
depends_on = None

STATUSES = "DRAFT|ISSUED|ACCEPTED|REJECTED|VOID|CONVERTED"


def _user_fk(column: str, name: str):
    return sa.ForeignKeyConstraint([column], ["users.id"], name=name)


def upgrade() -> None:
    op.create_table(
        "quotations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("quotation_number", sa.String(20), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("seller_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False),
        sa.Column("vat_base", sa.Numeric(14, 2), nullable=False),
        sa.Column("vat_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("grand_total", sa.Numeric(14, 2), nullable=False),
        sa.Column("sales_order_id", sa.Integer(), nullable=True),
        sa.Column("revision_of_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("converted_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("quotation_number"),
        sa.UniqueConstraint("sales_order_id"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_quotations_customer"),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"], name="fk_quotations_sales_order"),
        sa.ForeignKeyConstraint(["revision_of_id"], ["quotations.id"], name="fk_quotations_revision_of"),
        _user_fk("created_by_user_id", "fk_quotations_created_by"),
        _user_fk("issued_by_user_id", "fk_quotations_issued_by"),
        _user_fk("decided_by_user_id", "fk_quotations_decided_by"),
        _user_fk("voided_by_user_id", "fk_quotations_voided_by"),
        _user_fk("converted_by_user_id", "fk_quotations_converted_by"),
        sa.CheckConstraint(f"status ~ '^({STATUSES})$'", name="ck_quotations_status"),
        sa.CheckConstraint("(status = 'DRAFT') = (quotation_number IS NULL)", name="ck_quotations_number_iff_issued"),
        sa.CheckConstraint("(status = 'CONVERTED') = (sales_order_id IS NOT NULL)",
                           name="ck_quotations_converted_has_order"),
        sa.CheckConstraint("valid_until IS NULL OR issue_date IS NULL OR valid_until >= issue_date",
                           name="ck_quotations_valid_until_after_issue"),
        sa.CheckConstraint("subtotal >= 0 AND vat_base >= 0 AND vat_amount >= 0 AND grand_total >= 0",
                           name="ck_quotations_totals_nonnegative"),
    )
    op.create_index("ix_quotations_status_created_at", "quotations", ["status", "created_at"])
    op.create_index("ix_quotations_customer_id", "quotations", ["customer_id"])

    op.create_table(
        "quotation_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("quotation_id", sa.Integer(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(14, 2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], name="fk_quotation_items_quotation",
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_quotation_items_product"),
        sa.UniqueConstraint("quotation_id", "product_id", name="uq_quotation_items_quotation_product"),
        sa.UniqueConstraint("quotation_id", "line_no", name="uq_quotation_items_quotation_line"),
        sa.CheckConstraint("line_no >= 1", name="ck_quotation_items_line_no_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_quotation_items_quantity_positive"),
        sa.CheckConstraint("unit_price > 0", name="ck_quotation_items_unit_price_positive"),
        sa.CheckConstraint("line_total >= 0", name="ck_quotation_items_line_total_nonnegative"),
    )


def downgrade() -> None:
    count = op.get_bind().execute(sa.text("SELECT count(*) FROM quotations")).scalar()
    if count:
        raise RuntimeError(
            f"Refusing to downgrade f01a00000001: {count} quotations would be destroyed"
        )
    op.drop_table("quotation_items")
    op.drop_index("ix_quotations_customer_id", table_name="quotations")
    op.drop_index("ix_quotations_status_created_at", table_name="quotations")
    op.drop_table("quotations")
