"""F0a finance foundation: company profile, customer tax fields, document numbers.

Additive only:
1. ``company_profile`` -- single row (id = 1) with the seller's details and
   the VAT switch (``vat_registered`` defaults to false: the business is not
   VAT-registered, so documents carry no VAT line until it is switched on).
2. ``customers`` -- four NULLABLE columns (tax_id, branch_code,
   billing_address, credit_term_days). Existing rows stay NULL; no backfill.
3. ``document_sequences`` -- gapless running numbers per (doc_type, year),
   allocated under a row lock in the issuing transaction.

No existing column, constraint or row is changed. Inventory tables are not
touched.

Downgrade is guarded: it refuses once any finance data exists (a profile
row, an allocated number, or any customer tax field), because dropping it
would destroy business records. Rolling the API image back does NOT need a
downgrade: older code ignores the extra tables and columns.

Revision ID: ef1a00000001
Revises: ee1a00000001
"""
from alembic import op
import sqlalchemy as sa

revision = "ef1a00000001"
down_revision = "ee1a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("tax_id", sa.String(13), nullable=True))
    op.add_column("customers", sa.Column("branch_code", sa.String(5), nullable=True))
    op.add_column("customers", sa.Column("billing_address", sa.Text(), nullable=True))
    op.add_column("customers", sa.Column("credit_term_days", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_customers_tax_id_format", "customers", "tax_id ~ '^[0-9]{13}$'"
    )
    op.create_check_constraint(
        "ck_customers_branch_code_format", "customers", "branch_code ~ '^[0-9]{5}$'"
    )
    op.create_check_constraint(
        "ck_customers_credit_term_days_nonnegative", "customers", "credit_term_days >= 0"
    )

    op.create_table(
        "company_profile",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("legal_name_th", sa.String(255), nullable=True),
        sa.Column("legal_name_en", sa.String(255), nullable=True),
        sa.Column("tax_id", sa.String(13), nullable=True),
        sa.Column("branch_code", sa.String(5), nullable=True),
        sa.Column("address_th", sa.Text(), nullable=True),
        sa.Column("address_en", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("vat_registered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=False, server_default=sa.text("7.00")),
        sa.Column("prices_include_vat", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["users.id"], name="fk_company_profile_updated_by_user"
        ),
        sa.CheckConstraint("id = 1", name="ck_company_profile_singleton"),
        sa.CheckConstraint("tax_id ~ '^[0-9]{13}$'", name="ck_company_profile_tax_id_format"),
        sa.CheckConstraint("branch_code ~ '^[0-9]{5}$'", name="ck_company_profile_branch_code_format"),
        sa.CheckConstraint("vat_rate >= 0 AND vat_rate <= 100", name="ck_company_profile_vat_rate_range"),
    )

    op.create_table(
        "document_sequences",
        sa.Column("doc_type", sa.String(16), nullable=False),
        sa.Column("year", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.PrimaryKeyConstraint("doc_type", "year"),
        sa.CheckConstraint("doc_type ~ '^[A-Z]{2,8}$'", name="ck_document_sequences_doc_type_format"),
        sa.CheckConstraint("year >= 2000 AND year <= 9999", name="ck_document_sequences_year_range"),
        sa.CheckConstraint("next_value >= 1", name="ck_document_sequences_next_value_positive"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    blockers = {
        "company_profile rows": "SELECT count(*) FROM company_profile",
        "allocated document numbers": "SELECT count(*) FROM document_sequences WHERE next_value > 1",
        "customers with tax data": (
            "SELECT count(*) FROM customers WHERE tax_id IS NOT NULL OR branch_code IS NOT NULL "
            "OR billing_address IS NOT NULL OR credit_term_days IS NOT NULL"
        ),
    }
    found = {label: bind.execute(sa.text(sql)).scalar() for label, sql in blockers.items()}
    found = {label: count for label, count in found.items() if count}
    if found:
        detail = ", ".join(f"{count} {label}" for label, count in found.items())
        raise RuntimeError(
            f"Refusing to downgrade ef1a00000001: finance data would be destroyed ({detail})"
        )

    op.drop_table("document_sequences")
    op.drop_table("company_profile")
    op.drop_constraint("ck_customers_credit_term_days_nonnegative", "customers", type_="check")
    op.drop_constraint("ck_customers_branch_code_format", "customers", type_="check")
    op.drop_constraint("ck_customers_tax_id_format", "customers", type_="check")
    op.drop_column("customers", "credit_term_days")
    op.drop_column("customers", "billing_address")
    op.drop_column("customers", "branch_code")
    op.drop_column("customers", "tax_id")
