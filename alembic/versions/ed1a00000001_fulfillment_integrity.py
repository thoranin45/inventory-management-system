"""R5-SAFE.1B: fulfilment integrity — claims, attempt receipts, reconciliations.

One coherent revision for the R5-SAFE persistence (owner decision D9):

* ``sales_orders`` gains the fulfilment claim: a fencing epoch plus the
  holder, phase, acquisition time and the SHA-256 hash of the server-issued
  claim token (the raw token is never stored).
* ``fulfillment_attempt_receipts`` records each accepted keyed scan / undo
  attempt exactly once per (sales order, Idempotency-Key): APPLIED or a
  terminal REJECTED outcome, written in the same transaction as its effect.
* ``fulfillment_reconciliations`` is the single authoritative reconciliation
  state. A partial unique index allows at most one UNRESOLVED record
  (REQUIRED / CORRECTION_IN_PROGRESS / ESCALATED) per sales order.

Every order already in PICKING or PACKING receives one REQUIRED
``LEGACY_CUTOVER`` reconciliation: counters recorded before this revision are
never treated as physically verified.

NON-RELEASE-READY: no HTTP route uses these structures yet (R5-SAFE.1B is a
service-level core; activation is a later, separately approved gate).

Downgrade refuses if any receipt, historical claim activity, or reconciliation
exists, including untouched LEGACY_CUTOVER records. Recovery with integrity
history requires a separately approved, verified backup-and-restore procedure.

Revision ID: ed1a00000001
Revises: ec1a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "ed1a00000001"
down_revision = "ec1a00000001"
branch_labels = None
depends_on = None

# OR-of-equalities rather than IN-lists: PostgreSQL stores IN as `= ANY (ARRAY[...])`, which does not
# round-trip through the metadata-parity check. Identical allowed values and NULL semantics.
UNRESOLVED = "status = 'REQUIRED' OR status = 'CORRECTION_IN_PROGRESS' OR status = 'ESCALATED'"
TERMINAL = ("status = 'RESOLVED_MATCHED' OR status = 'RESOLVED_CORRECTED' "
            "OR status = 'RESOLVED_ACCEPTED' OR status = 'SUPERSEDED' OR status = 'CANCELLED'")
REASONS = ("reason_code = 'LEGACY_CUTOVER' OR reason_code = 'TAKEOVER' OR reason_code = 'SELF_TAKEOVER' "
           "OR reason_code = 'RELEASE_UNVERIFIED' OR reason_code = 'DISCREPANCY_REPORTED'")
OPERATIONS = ("operation_type = 'SCAN_PICK' OR operation_type = 'SCAN_PACK' "
              "OR operation_type = 'UNDO_PICK' OR operation_type = 'UNDO_PACK'")


def upgrade() -> None:
    # ------------------------------------------------------------- claim on sales_orders
    op.add_column("sales_orders", sa.Column("fulfillment_claim_epoch", sa.Integer(), nullable=False,
                                            server_default=sa.text("0")))
    op.add_column("sales_orders", sa.Column("fulfillment_claim_token_hash", sa.String(64), nullable=True))
    op.add_column("sales_orders", sa.Column("fulfillment_claim_user_id", sa.Integer(),
                                            sa.ForeignKey("users.id", name="fk_sales_orders_fulfillment_claim_user"),
                                            nullable=True))
    op.add_column("sales_orders", sa.Column("fulfillment_claim_phase", sa.String(8), nullable=True))
    op.add_column("sales_orders", sa.Column("fulfillment_claim_acquired_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_sales_orders_fulfillment_claim_epoch", "sales_orders",
                               "fulfillment_claim_epoch >= 0")
    op.create_check_constraint("ck_sales_orders_fulfillment_claim_phase", "sales_orders",
                               "fulfillment_claim_phase IS NULL OR fulfillment_claim_phase = 'PICK' "
                               "OR fulfillment_claim_phase = 'PACK'")
    op.create_check_constraint(
        "ck_sales_orders_fulfillment_claim_complete", "sales_orders",
        "(fulfillment_claim_token_hash IS NULL AND fulfillment_claim_user_id IS NULL "
        "AND fulfillment_claim_phase IS NULL AND fulfillment_claim_acquired_at IS NULL) OR "
        "(fulfillment_claim_token_hash IS NOT NULL AND fulfillment_claim_user_id IS NOT NULL "
        "AND fulfillment_claim_phase IS NOT NULL AND fulfillment_claim_acquired_at IS NOT NULL)")

    # ------------------------------------------------------------- reconciliations
    op.create_table(
        "fulfillment_reconciliations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
        sa.Column("phase", sa.String(8), nullable=False),
        sa.Column("opened_epoch", sa.Integer(), nullable=False),
        sa.Column("reason_code", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("count_lines", JSONB(), nullable=True),
        sa.Column("targets", JSONB(), nullable=True),
        sa.Column("opened_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("counted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("supervisor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.CheckConstraint("phase = 'PICK' OR phase = 'PACK'", name="ck_fulfillment_reconciliations_phase"),
        sa.CheckConstraint(REASONS, name="ck_fulfillment_reconciliations_reason"),
        sa.CheckConstraint(f"{UNRESOLVED} OR {TERMINAL}", name="ck_fulfillment_reconciliations_status"),
        sa.CheckConstraint(f"({TERMINAL}) = (resolved_at IS NOT NULL)",
                           name="ck_fulfillment_reconciliations_resolved_at"),
        sa.CheckConstraint("opened_epoch >= 0", name="ck_fulfillment_reconciliations_opened_epoch"),
    )
    op.create_index("ix_fulfillment_reconciliations_order_opened", "fulfillment_reconciliations",
                    ["sales_order_id", "opened_at"])
    op.create_index("uq_fulfillment_reconciliations_one_unresolved", "fulfillment_reconciliations",
                    ["sales_order_id"], unique=True, postgresql_where=sa.text(UNRESOLVED))

    # ------------------------------------------------------------- attempt receipts
    op.create_table(
        "fulfillment_attempt_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
        sa.Column("operation_key", sa.String(128), nullable=False),
        sa.Column("operation_type", sa.String(16), nullable=False),
        sa.Column("claim_epoch", sa.Integer(), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("error_code", sa.String(255), nullable=True),
        sa.Column("http_status", sa.SmallInteger(), nullable=True),
        sa.Column("allocation_id", sa.Integer(), sa.ForeignKey("sales_order_batch_allocations.id"), nullable=True),
        sa.Column("response_snapshot", JSONB(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reconciliation_id", sa.Integer(), sa.ForeignKey("fulfillment_reconciliations.id"), nullable=True),
        sa.UniqueConstraint("sales_order_id", "operation_key", name="uq_fulfillment_attempt_operation"),
        sa.CheckConstraint(OPERATIONS, name="ck_fulfillment_attempt_receipts_operation"),
        sa.CheckConstraint(
            "(outcome = 'APPLIED' AND error_code IS NULL AND http_status IS NULL) OR "
            "(outcome = 'REJECTED' AND error_code IS NOT NULL AND http_status IS NOT NULL)",
            name="ck_fulfillment_attempt_receipts_outcome"),
        sa.CheckConstraint("claim_epoch >= 0", name="ck_fulfillment_attempt_receipts_claim_epoch"),
    )
    op.create_index("ix_fulfillment_attempt_receipts_order_created", "fulfillment_attempt_receipts",
                    ["sales_order_id", "created_at"])

    # ------------------------------------------------------------- legacy open work
    op.execute(
        "INSERT INTO fulfillment_reconciliations (sales_order_id, phase, opened_epoch, reason_code, status) "
        "SELECT id, CASE status WHEN 'PICKING' THEN 'PICK' ELSE 'PACK' END, 0, 'LEGACY_CUTOVER', 'REQUIRED' "
        "FROM sales_orders WHERE status IN ('PICKING', 'PACKING')"
    )


def downgrade() -> None:
    connection = op.get_bind()
    receipts = connection.scalar(sa.text("SELECT count(*) FROM fulfillment_attempt_receipts"))
    claims = connection.scalar(sa.text(
        "SELECT count(*) FROM sales_orders WHERE fulfillment_claim_epoch > 0 OR fulfillment_claim_token_hash IS NOT NULL"))
    worked = connection.scalar(sa.text(
        "SELECT count(*) FROM fulfillment_reconciliations"))
    if receipts or claims or worked:
        raise RuntimeError(
            "Refusing to downgrade ed1a00000001: fulfilment integrity history exists "
            f"(receipts={receipts}, claimed_orders={claims}, reconciliations={worked}); restore from backup instead")
    op.drop_index("ix_fulfillment_attempt_receipts_order_created", table_name="fulfillment_attempt_receipts")
    op.drop_table("fulfillment_attempt_receipts")
    op.drop_index("uq_fulfillment_reconciliations_one_unresolved", table_name="fulfillment_reconciliations")
    op.drop_index("ix_fulfillment_reconciliations_order_opened", table_name="fulfillment_reconciliations")
    op.drop_table("fulfillment_reconciliations")
    op.drop_constraint("ck_sales_orders_fulfillment_claim_complete", "sales_orders", type_="check")
    op.drop_constraint("ck_sales_orders_fulfillment_claim_phase", "sales_orders", type_="check")
    op.drop_constraint("ck_sales_orders_fulfillment_claim_epoch", "sales_orders", type_="check")
    op.drop_column("sales_orders", "fulfillment_claim_acquired_at")
    op.drop_column("sales_orders", "fulfillment_claim_phase")
    op.drop_column("sales_orders", "fulfillment_claim_user_id")
    op.drop_column("sales_orders", "fulfillment_claim_token_hash")
    op.drop_column("sales_orders", "fulfillment_claim_epoch")
