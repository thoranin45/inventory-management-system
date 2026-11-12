"""R5-SAFE.1B — migration ed1a00000001 on fresh disposable schemas: constraints, partial index,
legacy-cutover data, and guarded downgrade."""
import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade  # noqa: F401  (isolated-schema fixture)

PREVIOUS = "ec1a00000001"
REVISION = "ed1a00000001"

CHECKS = {
    "sales_orders": {"ck_sales_orders_fulfillment_claim_epoch", "ck_sales_orders_fulfillment_claim_phase",
                     "ck_sales_orders_fulfillment_claim_complete"},
    "fulfillment_reconciliations": {"ck_fulfillment_reconciliations_phase", "ck_fulfillment_reconciliations_reason",
                                    "ck_fulfillment_reconciliations_status", "ck_fulfillment_reconciliations_resolved_at",
                                    "ck_fulfillment_reconciliations_opened_epoch"},
    "fulfillment_attempt_receipts": {"ck_fulfillment_attempt_receipts_operation", "ck_fulfillment_attempt_receipts_outcome",
                                     "ck_fulfillment_attempt_receipts_claim_epoch"},
}


def _seed_order(c, order_id, status="PICKING"):
    c.execute(text("INSERT INTO sales_orders(id, so_number, status, total_amount) VALUES (:i, :n, :s, 0)"),
              {"i": order_id, "n": f"SO-{order_id}", "s": status})


def _seed_user(c, user_id=900):
    c.execute(text("INSERT INTO users(id, username, password_hash, role) VALUES (:i, :u, 'x', 'WAREHOUSE')"),
              {"i": user_id, "u": f"user{user_id}"})


def _violates(engine, sql, params=None):
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(text(sql), params or {})


def test_fresh_head_has_every_constraint_and_the_partial_index(migration_engine):
    upgrade(migration_engine, "head")
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        inspector = inspect(c)
        for table, names in CHECKS.items():
            assert names <= {ck["name"] for ck in inspector.get_check_constraints(table)}, table
        uniques = {u["name"]: u["column_names"] for u in inspector.get_unique_constraints("fulfillment_attempt_receipts")}
        assert uniques["uq_fulfillment_attempt_operation"] == ["sales_order_id", "operation_key"]
        index = next(i for i in inspector.get_indexes("fulfillment_reconciliations")
                     if i["name"] == "uq_fulfillment_reconciliations_one_unresolved")
        assert index["unique"] and index["column_names"] == ["sales_order_id"]
        where = index["dialect_options"]["postgresql_where"]
        for status in ("REQUIRED", "CORRECTION_IN_PROGRESS", "ESCALATED"):
            assert f"'{status}'" in where
        assert "OPEN" not in where and "RESOLVED" not in where
        claim = {col["name"]: col for col in inspector.get_columns("sales_orders") if col["name"].startswith("fulfillment_claim")}
        assert set(claim) == {"fulfillment_claim_epoch", "fulfillment_claim_token_hash", "fulfillment_claim_user_id",
                              "fulfillment_claim_phase", "fulfillment_claim_acquired_at"}
        assert claim["fulfillment_claim_epoch"]["nullable"] is False
        assert all(claim[n]["nullable"] for n in claim if n != "fulfillment_claim_epoch")


def test_one_unresolved_reconciliation_per_order(migration_engine):
    upgrade(migration_engine, "head")
    insert = ("INSERT INTO fulfillment_reconciliations(sales_order_id, phase, opened_epoch, reason_code, status, resolved_at) "
              "VALUES (:o, 'PICK', 0, 'DISCREPANCY_REPORTED', :s, :r)")
    with migration_engine.begin() as c:
        _seed_order(c, 1, "CONFIRMED")
        _seed_order(c, 2, "CONFIRMED")
        c.execute(text(insert), {"o": 1, "s": "REQUIRED", "r": None})
        c.execute(text(insert), {"o": 1, "s": "SUPERSEDED", "r": "2026-10-18T00:00:00Z"})  # terminal history is fine
        c.execute(text(insert), {"o": 1, "s": "RESOLVED_MATCHED", "r": "2026-10-18T00:00:00Z"})
        c.execute(text(insert), {"o": 2, "s": "ESCALATED", "r": None})  # another order is independent
    for status in ("REQUIRED", "CORRECTION_IN_PROGRESS", "ESCALATED"):
        _violates(migration_engine, insert, {"o": 1, "s": status, "r": None})


_REC = "INSERT INTO fulfillment_reconciliations(sales_order_id, phase, opened_epoch, reason_code, status{extra}) VALUES "
_RCPT = ("INSERT INTO fulfillment_attempt_receipts(sales_order_id, operation_key, operation_type, claim_epoch, "
         "request_fingerprint, outcome{extra}, response_snapshot, created_by_user_id) VALUES ")
_CLAIM = "UPDATE sales_orders SET {set} WHERE id = 1"


@pytest.mark.parametrize("sql,constraint", [
    # reconciliation status / resolved_at / phase / reason / epoch
    (_REC.format(extra="") + "(1,'PICK',0,'TAKEOVER','OPEN')", "ck_fulfillment_reconciliations_status"),
    (_REC.format(extra="") + "(1,'PICK',0,'TAKEOVER','RESOLVED_MATCHED')", "ck_fulfillment_reconciliations_resolved_at"),
    (_REC.format(extra=", resolved_at") + "(1,'PICK',0,'TAKEOVER','REQUIRED', now())",
     "ck_fulfillment_reconciliations_resolved_at"),
    (_REC.format(extra="") + "(1,'SHIP',0,'TAKEOVER','REQUIRED')", "ck_fulfillment_reconciliations_phase"),
    (_REC.format(extra="") + "(1,'PICK',0,'WHATEVER','REQUIRED')", "ck_fulfillment_reconciliations_reason"),
    (_REC.format(extra="") + "(1,'PICK',-1,'TAKEOVER','REQUIRED')", "ck_fulfillment_reconciliations_opened_epoch"),
    # receipts: outcome consistency, operation type, epoch
    (_RCPT.format(extra=", error_code, http_status") + "(1,'k','SCAN_PICK',1,'f','APPLIED','BARCODE_NOT_FOUND',404,'{}',900)",
     "ck_fulfillment_attempt_receipts_outcome"),
    (_RCPT.format(extra="") + "(1,'k','SCAN_PICK',1,'f','REJECTED','{}',900)", "ck_fulfillment_attempt_receipts_outcome"),
    (_RCPT.format(extra="") + "(1,'k','SHIP',1,'f','APPLIED','{}',900)", "ck_fulfillment_attempt_receipts_operation"),
    (_RCPT.format(extra="") + "(1,'k','SCAN_PICK',-1,'f','APPLIED','{}',900)", "ck_fulfillment_attempt_receipts_claim_epoch"),
    # claim metadata: all-or-nothing, phase, epoch
    (_CLAIM.format(set="fulfillment_claim_token_hash = 'h'"), "ck_sales_orders_fulfillment_claim_complete"),
    (_CLAIM.format(set="fulfillment_claim_token_hash = 'h', fulfillment_claim_user_id = 900, "
                       "fulfillment_claim_acquired_at = now()"), "ck_sales_orders_fulfillment_claim_complete"),
    (_CLAIM.format(set="fulfillment_claim_token_hash = 'h', fulfillment_claim_user_id = 900, "
                       "fulfillment_claim_phase = 'SHIP', fulfillment_claim_acquired_at = now()"),
     "ck_sales_orders_fulfillment_claim_phase"),
    (_CLAIM.format(set="fulfillment_claim_epoch = -1"), "ck_sales_orders_fulfillment_claim_epoch"),
    (_CLAIM.format(set="fulfillment_claim_epoch = NULL"), "fulfillment_claim_epoch"),  # NOT NULL violation
])
def test_constraints_reject_invalid_rows(migration_engine, sql, constraint):
    upgrade(migration_engine, "head")
    with migration_engine.begin() as c:
        _seed_order(c, 1, "CONFIRMED")
        _seed_user(c)
    with pytest.raises(IntegrityError) as err:
        with migration_engine.begin() as c:
            c.execute(text(sql))
    assert constraint in str(err.value.orig)  # the intended constraint fired, not an unrelated one


def test_valid_rows_are_accepted_and_keys_are_unique_per_order(migration_engine):
    upgrade(migration_engine, "head")
    receipt = ("INSERT INTO fulfillment_attempt_receipts(sales_order_id, operation_key, operation_type, claim_epoch, "
               "request_fingerprint, outcome, error_code, http_status, response_snapshot, created_by_user_id) "
               "VALUES (:o, :k, 'SCAN_PICK', 1, 'f', :out, :err, :st, '{}', 900)")
    with migration_engine.begin() as c:
        _seed_order(c, 1, "PICKING")
        _seed_order(c, 2, "PICKING")
        _seed_user(c)
        c.execute(text("UPDATE sales_orders SET fulfillment_claim_epoch = 1, fulfillment_claim_token_hash = :h, "
                       "fulfillment_claim_user_id = 900, fulfillment_claim_phase = 'PICK', "
                       "fulfillment_claim_acquired_at = now() WHERE id = 1"), {"h": "a" * 64})
        c.execute(text(receipt), {"o": 1, "k": "k1", "out": "APPLIED", "err": None, "st": None})
        c.execute(text(receipt), {"o": 1, "k": "k2", "out": "REJECTED", "err": "BARCODE_NOT_FOUND", "st": 404})
        c.execute(text(receipt), {"o": 2, "k": "k1", "out": "APPLIED", "err": None, "st": None})  # same key, other order
    _violates(migration_engine, receipt, {"o": 1, "k": "k1", "out": "APPLIED", "err": None, "st": None})


def test_legacy_open_orders_get_a_required_cutover_reconciliation(migration_engine):
    upgrade(migration_engine, PREVIOUS)
    with migration_engine.begin() as c:
        for order_id, status in ((11, "PICKING"), (12, "PACKING"), (13, "CONFIRMED"), (14, "SHIPPED"), (15, "DRAFT")):
            _seed_order(c, order_id, status)
    upgrade(migration_engine, REVISION)
    with migration_engine.connect() as c:
        rows = c.execute(text(
            "SELECT sales_order_id, phase, opened_epoch, reason_code, status, resolved_at, counted_at, count_lines, "
            "opened_by_user_id FROM fulfillment_reconciliations ORDER BY sales_order_id")).all()
        assert rows == [(11, "PICK", 0, "LEGACY_CUTOVER", "REQUIRED", None, None, None, None),
                        (12, "PACK", 0, "LEGACY_CUTOVER", "REQUIRED", None, None, None, None)]
        assert c.execute(text("SELECT count(*) FROM sales_orders WHERE fulfillment_claim_epoch <> 0 "
                              "OR fulfillment_claim_token_hash IS NOT NULL")).scalar() == 0


def test_clean_downgrade_removes_everything(migration_engine):
    upgrade(migration_engine, PREVIOUS)
    with migration_engine.begin() as c:
        _seed_order(c, 21, "CONFIRMED")  # no integrity history
    upgrade(migration_engine, REVISION)
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PREVIOUS)
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PREVIOUS
        inspector = inspect(c)
        tables = set(inspector.get_table_names())
        assert "fulfillment_attempt_receipts" not in tables and "fulfillment_reconciliations" not in tables
        assert not [col for col in inspector.get_columns("sales_orders") if col["name"].startswith("fulfillment_claim")]
        assert c.scalar(text("SELECT status FROM sales_orders WHERE id = 21")) == "CONFIRMED"


def _preservation_snapshot(engine):
    with engine.connect() as c:
        inspector = inspect(c)
        tables = sorted(inspector.get_table_names())
        return {
            "revision": c.scalar(text("SELECT version_num FROM alembic_version")),
            "tables": tables,
            "columns": {t: [{**col, "type": str(col["type"])} for col in inspector.get_columns(t)]
                        for t in tables},
            "rows": {t: sorted(c.execute(text(f'SELECT row_to_json(t)::text FROM "{t}" t')).scalars())
                     for t in tables},
        }


@pytest.mark.parametrize("status,history", [
    ("PICKING", None),
    ("PACKING", None),
    ("PICKING", "UPDATE fulfillment_reconciliations SET notes = 'Operator evidence: counted physically'"),
    ("PICKING", "UPDATE fulfillment_reconciliations SET counted_at = now(), count_lines = '[{\"quantity\":\"1.000\"}]'"),
    ("PICKING", "UPDATE fulfillment_reconciliations SET targets = '[{\"quantity\":\"1.000\"}]'"),
    ("PICKING", "UPDATE fulfillment_reconciliations SET status = 'RESOLVED_MATCHED', resolved_at = now()"),
    ("PICKING", "UPDATE fulfillment_reconciliations SET status = 'SUPERSEDED', resolved_at = now()"),
    ("CONFIRMED", "UPDATE sales_orders SET fulfillment_claim_epoch = 1 WHERE id = 31"),
    ("CONFIRMED", "UPDATE sales_orders SET fulfillment_claim_token_hash = 'synthetic-hash', fulfillment_claim_user_id = 900, fulfillment_claim_phase = 'PICK', fulfillment_claim_acquired_at = now() WHERE id = 31"),
    ("CONFIRMED", "INSERT INTO fulfillment_attempt_receipts(sales_order_id, operation_key, operation_type, claim_epoch, request_fingerprint, outcome, response_snapshot, created_by_user_id) VALUES (31,'k','SCAN_PICK',0,'f','APPLIED','{}',900)"),
    ("CONFIRMED", "INSERT INTO fulfillment_attempt_receipts(sales_order_id, operation_key, operation_type, claim_epoch, request_fingerprint, outcome, error_code, http_status, response_snapshot, created_by_user_id) VALUES (31,'k','SCAN_PICK',0,'f','REJECTED','BARCODE_NOT_FOUND',404,'{}',900)"),
], ids=["untouched-picking", "untouched-packing", "notes-only", "physical-counts", "targets",
        "resolved", "superseded", "historical-epoch", "claim-token", "applied-receipt", "rejected-receipt"])
def test_downgrade_refuses_once_integrity_history_exists(migration_engine, status, history):
    upgrade(migration_engine, PREVIOUS)
    with migration_engine.begin() as c:
        _seed_order(c, 31, status)
        _seed_user(c)
    upgrade(migration_engine, REVISION)
    with migration_engine.begin() as c:
        if status in ("PICKING", "PACKING"):
            assert c.execute(text("SELECT reason_code, status FROM fulfillment_reconciliations")).all() == [
                ("LEGACY_CUTOVER", "REQUIRED")]
        if history:
            c.execute(text(history))
    before = _preservation_snapshot(migration_engine)
    with pytest.raises(RuntimeError, match="Refusing to downgrade ed1a00000001"):
        with migration_engine.begin() as c:
            command.downgrade(migration_config(c), PREVIOUS)
    after = _preservation_snapshot(migration_engine)
    assert after["revision"] == REVISION
    assert "fulfillment_reconciliations" in after["tables"]
    assert "fulfillment_attempt_receipts" in after["tables"]
    assert after == before  # every table, column and row, including notes and business data
