"""F3a payment receipts and billing notes.

Additive only: four new tables. No existing row is rewritten. Numbers come
from the F0a ``document_sequences`` table (doc types ``RC`` and ``BN``).

Downgrade is guarded: it refuses once any receipt or billing note exists,
because dropping the tables would destroy business documents. Rolling the API
image back does NOT need a downgrade: older code ignores the extra tables
(but would then show invoice balances without payments).

Revision ID: f03a00000001
Revises: f02a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f03a00000001"
down_revision = "f02a00000001"
branch_labels = None
depends_on = None


def _user_fk(column: str, name: str):
    return sa.ForeignKeyConstraint([column], ["users.id"], name=name)


def _money(name: str):
    return sa.Column(name, sa.Numeric(14, 2), nullable=False)


def upgrade() -> None:
    op.create_table(
        "payment_receipts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("receipt_number", sa.String(20), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("reference", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        _money("amount_total"), _money("wht_total"), _money("settled_total"),
        sa.Column("client_request_id", sa.String(64), nullable=True),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("seller_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("receipt_number"),
        sa.UniqueConstraint("client_request_id"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_payment_receipts_customer"),
        _user_fk("created_by_user_id", "fk_payment_receipts_created_by"),
        _user_fk("voided_by_user_id", "fk_payment_receipts_voided_by"),
        sa.CheckConstraint("status ~ '^(ISSUED|VOID)$'", name="ck_payment_receipts_status"),
        sa.CheckConstraint("method ~ '^(CASH|TRANSFER|CHEQUE|OTHER)$'", name="ck_payment_receipts_method"),
        sa.CheckConstraint("amount_total >= 0 AND wht_total >= 0", name="ck_payment_receipts_totals_nonnegative"),
        sa.CheckConstraint("settled_total = amount_total + wht_total AND settled_total > 0",
                           name="ck_payment_receipts_settled_total"),
    )
    op.create_index("ix_payment_receipts_customer_id", "payment_receipts", ["customer_id"])
    op.create_index("ix_payment_receipts_status_received_date", "payment_receipts", ["status", "received_date"])

    op.create_table(
        "payment_receipt_allocations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("payment_receipt_id", sa.Integer(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        _money("amount"), _money("wht_amount"),
        sa.Column("wht_certificate_no", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["payment_receipt_id"], ["payment_receipts.id"],
                                name="fk_payment_receipt_allocations_receipt", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], name="fk_payment_receipt_allocations_invoice"),
        sa.UniqueConstraint("payment_receipt_id", "invoice_id", name="uq_payment_receipt_allocations_receipt_invoice"),
        sa.UniqueConstraint("payment_receipt_id", "line_no", name="uq_payment_receipt_allocations_receipt_line"),
        sa.CheckConstraint("line_no >= 1", name="ck_payment_receipt_allocations_line_no_positive"),
        sa.CheckConstraint("amount >= 0 AND wht_amount >= 0", name="ck_payment_receipt_allocations_nonnegative"),
        sa.CheckConstraint("amount + wht_amount > 0", name="ck_payment_receipt_allocations_positive"),
    )
    op.create_index("ix_payment_receipt_allocations_invoice_id", "payment_receipt_allocations", ["invoice_id"])

    op.create_table(
        "billing_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("billing_number", sa.String(20), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("payment_due_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        _money("total_amount"),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("seller_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by_user_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("billing_number"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], name="fk_billing_notes_customer"),
        _user_fk("created_by_user_id", "fk_billing_notes_created_by"),
        _user_fk("issued_by_user_id", "fk_billing_notes_issued_by"),
        _user_fk("voided_by_user_id", "fk_billing_notes_voided_by"),
        sa.CheckConstraint("status ~ '^(DRAFT|ISSUED|VOID)$'", name="ck_billing_notes_status"),
        sa.CheckConstraint("(status = 'DRAFT') = (billing_number IS NULL)", name="ck_billing_notes_number_iff_issued"),
        sa.CheckConstraint("total_amount >= 0", name="ck_billing_notes_total_nonnegative"),
        sa.CheckConstraint("payment_due_date IS NULL OR issue_date IS NULL OR payment_due_date >= issue_date",
                           name="ck_billing_notes_due_after_issue"),
    )
    op.create_index("ix_billing_notes_customer_id", "billing_notes", ["customer_id"])
    op.create_index("ix_billing_notes_status_created_at", "billing_notes", ["status", "created_at"])

    op.create_table(
        "billing_note_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("billing_note_id", sa.Integer(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        _money("amount"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["billing_note_id"], ["billing_notes.id"], name="fk_billing_note_items_note",
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], name="fk_billing_note_items_invoice"),
        sa.UniqueConstraint("billing_note_id", "invoice_id", name="uq_billing_note_items_note_invoice"),
        sa.UniqueConstraint("billing_note_id", "line_no", name="uq_billing_note_items_note_line"),
        sa.CheckConstraint("line_no >= 1", name="ck_billing_note_items_line_no_positive"),
        sa.CheckConstraint("amount >= 0", name="ck_billing_note_items_amount_nonnegative"),
    )
    op.create_index("ix_billing_note_items_invoice_id", "billing_note_items", ["invoice_id"])


def downgrade() -> None:
    bind = op.get_bind()
    receipts = bind.execute(sa.text("SELECT count(*) FROM payment_receipts")).scalar()
    notes = bind.execute(sa.text("SELECT count(*) FROM billing_notes")).scalar()
    if receipts or notes:
        raise RuntimeError(
            f"Refusing to downgrade f03a00000001: {receipts} receipts and {notes} billing notes "
            "would be destroyed"
        )
    op.drop_index("ix_billing_note_items_invoice_id", table_name="billing_note_items")
    op.drop_table("billing_note_items")
    op.drop_index("ix_billing_notes_status_created_at", table_name="billing_notes")
    op.drop_index("ix_billing_notes_customer_id", table_name="billing_notes")
    op.drop_table("billing_notes")
    op.drop_index("ix_payment_receipt_allocations_invoice_id", table_name="payment_receipt_allocations")
    op.drop_table("payment_receipt_allocations")
    op.drop_index("ix_payment_receipts_status_received_date", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_customer_id", table_name="payment_receipts")
    op.drop_table("payment_receipts")
