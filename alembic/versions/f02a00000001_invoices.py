"""F2a invoices and adjustment notes.

Additive only: four new tables and one new column
``company_profile.default_credit_days`` (NOT NULL, server default 30, so the
existing row gets 30). No existing row is rewritten. Numbers come from the F0a
``document_sequences`` table (doc types ``INV`` and ``ADJ``).

Downgrade is guarded: it refuses once any invoice or adjustment note exists,
because dropping the tables would destroy business documents. Rolling the API
image back does NOT need a downgrade: older code ignores the extra tables and
column.

Revision ID: f02a00000001
Revises: f01a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f02a00000001"
down_revision = "f01a00000001"
branch_labels = None
depends_on = None

STATUSES = "DRAFT|ISSUED|VOID"


def _user_fk(column: str, name: str):
    return sa.ForeignKeyConstraint([column], ["users.id"], name=name)


def _money(name: str):
    return sa.Column(name, sa.Numeric(14, 2), nullable=False)


def upgrade() -> None:
    op.add_column("company_profile", sa.Column(
        "default_credit_days", sa.SmallInteger(), nullable=False, server_default=sa.text("30")))
    op.create_check_constraint("ck_company_profile_default_credit_days_range", "company_profile",
                               "default_credit_days >= 0 AND default_credit_days <= 365")

    op.create_table(
        "invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(20), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sales_order_id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("quotation_id", sa.Integer(), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("credit_days", sa.SmallInteger(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("seller_snapshot", postgresql.JSONB(), nullable=True),
        _money("subtotal"), _money("discount_total"), _money("vat_base"), _money("vat_amount"),
        _money("grand_total"),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by_user_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_number"),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"], name="fk_invoices_sales_order"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_invoices_customer"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], name="fk_invoices_quotation"),
        _user_fk("created_by_user_id", "fk_invoices_created_by"),
        _user_fk("issued_by_user_id", "fk_invoices_issued_by"),
        _user_fk("voided_by_user_id", "fk_invoices_voided_by"),
        sa.CheckConstraint(f"status ~ '^({STATUSES})$'", name="ck_invoices_status"),
        sa.CheckConstraint("(status = 'DRAFT') = (invoice_number IS NULL)", name="ck_invoices_number_iff_issued"),
        sa.CheckConstraint("credit_days >= 0 AND credit_days <= 365", name="ck_invoices_credit_days_range"),
        sa.CheckConstraint("due_date IS NULL OR issue_date IS NULL OR due_date >= issue_date",
                           name="ck_invoices_due_after_issue"),
        sa.CheckConstraint("subtotal >= 0 AND discount_total >= 0 AND vat_base >= 0 AND vat_amount >= 0 "
                           "AND grand_total >= 0", name="ck_invoices_totals_nonnegative"),
    )
    op.create_index("uq_invoices_active_sales_order", "invoices", ["sales_order_id"], unique=True,
                    postgresql_where=sa.text("status <> 'VOID'"))
    op.create_index("ix_invoices_status_created_at", "invoices", ["status", "created_at"])
    op.create_index("ix_invoices_customer_id", "invoices", ["customer_id"])
    op.create_index("ix_invoices_issue_date", "invoices", ["issue_date"])

    op.create_table(
        "invoice_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        _money("unit_price"), _money("discount_amount"), _money("line_total"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], name="fk_invoice_items_invoice", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_invoice_items_product"),
        sa.UniqueConstraint("invoice_id", "product_id", name="uq_invoice_items_invoice_product"),
        sa.UniqueConstraint("invoice_id", "line_no", name="uq_invoice_items_invoice_line"),
        sa.CheckConstraint("line_no >= 1", name="ck_invoice_items_line_no_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_invoice_items_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_invoice_items_unit_price_nonnegative"),
        sa.CheckConstraint("discount_amount >= 0", name="ck_invoice_items_discount_nonnegative"),
        sa.CheckConstraint("line_total >= 0", name="ck_invoice_items_line_total_nonnegative"),
    )

    op.create_table(
        "adjustment_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("adjustment_number", sa.String(20), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("sales_return_receipt_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("seller_snapshot", postgresql.JSONB(), nullable=True),
        _money("subtotal"), _money("vat_base"), _money("vat_amount"), _money("grand_total"),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by_user_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("adjustment_number"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], name="fk_adjustment_notes_invoice"),
        sa.ForeignKeyConstraint(["sales_return_receipt_id"], ["sales_return_receipts.id"],
                                name="fk_adjustment_notes_return_receipt"),
        _user_fk("created_by_user_id", "fk_adjustment_notes_created_by"),
        _user_fk("issued_by_user_id", "fk_adjustment_notes_issued_by"),
        _user_fk("voided_by_user_id", "fk_adjustment_notes_voided_by"),
        sa.CheckConstraint(f"status ~ '^({STATUSES})$'", name="ck_adjustment_notes_status"),
        sa.CheckConstraint("(status = 'DRAFT') = (adjustment_number IS NULL)",
                           name="ck_adjustment_notes_number_iff_issued"),
        sa.CheckConstraint("subtotal >= 0 AND vat_base >= 0 AND vat_amount >= 0 AND grand_total >= 0",
                           name="ck_adjustment_notes_totals_nonnegative"),
    )
    op.create_index("ix_adjustment_notes_invoice_id", "adjustment_notes", ["invoice_id"])
    op.create_index("ix_adjustment_notes_status_created_at", "adjustment_notes", ["status", "created_at"])

    op.create_table(
        "adjustment_note_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("adjustment_note_id", sa.Integer(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("invoice_item_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        _money("unit_price"), _money("line_total"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["adjustment_note_id"], ["adjustment_notes.id"],
                                name="fk_adjustment_note_items_note", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_item_id"], ["invoice_items.id"],
                                name="fk_adjustment_note_items_invoice_item"),
        sa.UniqueConstraint("adjustment_note_id", "invoice_item_id",
                            name="uq_adjustment_note_items_note_invoice_item"),
        sa.UniqueConstraint("adjustment_note_id", "line_no", name="uq_adjustment_note_items_note_line"),
        sa.CheckConstraint("line_no >= 1", name="ck_adjustment_note_items_line_no_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_adjustment_note_items_quantity_positive"),
        sa.CheckConstraint("unit_price > 0", name="ck_adjustment_note_items_unit_price_positive"),
        sa.CheckConstraint("line_total >= 0", name="ck_adjustment_note_items_line_total_nonnegative"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    invoices = bind.execute(sa.text("SELECT count(*) FROM invoices")).scalar()
    notes = bind.execute(sa.text("SELECT count(*) FROM adjustment_notes")).scalar()
    if invoices or notes:
        raise RuntimeError(
            f"Refusing to downgrade f02a00000001: {invoices} invoices and {notes} adjustment notes "
            "would be destroyed"
        )
    op.drop_table("adjustment_note_items")
    op.drop_index("ix_adjustment_notes_status_created_at", table_name="adjustment_notes")
    op.drop_index("ix_adjustment_notes_invoice_id", table_name="adjustment_notes")
    op.drop_table("adjustment_notes")
    op.drop_table("invoice_items")
    op.drop_index("ix_invoices_issue_date", table_name="invoices")
    op.drop_index("ix_invoices_customer_id", table_name="invoices")
    op.drop_index("ix_invoices_status_created_at", table_name="invoices")
    op.drop_index("uq_invoices_active_sales_order", table_name="invoices")
    op.drop_table("invoices")
    op.drop_constraint("ck_company_profile_default_credit_days_range", "company_profile", type_="check")
    op.drop_column("company_profile", "default_credit_days")
