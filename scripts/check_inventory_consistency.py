"""Read-only PostgreSQL inventory diagnostic. Never loads application configuration.

Run with an explicitly provisioned INVENTORY_DIAGNOSTIC_DATABASE_URL environment
variable. No .env files are opened, and connection errors never expose credentials.
"""
import json
import os
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine, text

# Business calendar for the read-only diagnostic. Kept self-contained (no app
# config import): overridable via INVENTORY_DIAGNOSTIC_TIMEZONE, default matches
# the application's Asia/Bangkok business timezone.
DIAGNOSTIC_TIMEZONE = os.environ.get("INVENTORY_DIAGNOSTIC_TIMEZONE", "Asia/Bangkok")
# Phase 14C: the zone the operator EXPECTS naive created_at values to have
# been written in. The timestamp_provenance check tests this expectation
# against same-transaction evidence. Diagnostic evidence only: the API never
# uses it -- per-row proof is inventory_movements.recorded_at_utc.
DIAGNOSTIC_NAIVE_TIMEZONE = os.environ.get("INVENTORY_DIAGNOSTIC_NAIVE_TIMEZONE", "UTC")

# Exact APPROVE_ADJUSTMENT_REQUEST audit texts, per code generation. The
# whole description must match -- never just a suffix.
_PRE_14C_APPROVE_AUDIT = "{ref}: PENDING -> APPROVED"
_14C_APPROVE_AUDIT = "{ref}: PENDING -> APPROVED; stock_transaction_id={tx}"
_14C_APPROVE_AUDIT_RE = r"{ref}: PENDING -> APPROVED; stock_transaction_id=([1-9][0-9]*)"

# Same-transaction (timestamptz, naive) pairs: both default to now(), which
# is the transaction's start time, so their difference is the exact session
# offset in force when the rows were written.
_TIMESTAMP_ANCHORS_SQL = (
    "SELECT 'PURCHASE_RECEIPT' AS anchor, r.id AS anchor_id, "
    "r.received_at AT TIME ZONE 'UTC' AS aware_utc, min(m.created_at) AS naive_at "
    "FROM purchase_order_receipts r JOIN inventory_movements m ON m.purchase_receipt_id = r.id "
    "GROUP BY r.id, r.received_at "
    "UNION ALL "
    "SELECT 'TRANSFER_RECEIPT', r.id, r.received_at AT TIME ZONE 'UTC', min(m.created_at) "
    "FROM inventory_transfer_receipts r JOIN inventory_movements m ON m.transfer_receipt_id = r.id "
    "GROUP BY r.id, r.received_at "
    "UNION ALL "
    "SELECT 'MOVEMENT_RECORDED', m.id, m.recorded_at_utc AT TIME ZONE 'UTC', m.created_at "
    "FROM inventory_movements m WHERE m.recorded_at_utc IS NOT NULL "
    "UNION ALL "
    "SELECT 'ADJUSTMENT_REQUEST', s.id, s.created_at AT TIME ZONE 'UTC', min(a.created_at) "
    "FROM stock_adjustment_requests s JOIN audit_logs a ON a.table_name = 'stock_adjustment_requests' "
    "AND a.record_id = s.id AND a.action = 'CREATE_ADJUSTMENT_REQUEST' "
    "GROUP BY s.id, s.created_at"
)


def analyze_inventory(snapshot: dict, today: date | None = None) -> list[dict]:
    if today is None:
        today = date.today()
    findings = []

    def report(check, classification, **evidence):
        findings.append(dict(check=check, classification=classification, **evidence))

    balances = snapshot["balances"]
    movements = snapshot["movements"]
    transactions = snapshot["transactions"]
    by_product, by_batch, by_key = defaultdict(list), defaultdict(list), defaultdict(list)
    key = lambda row: (row["product_id"], row["warehouse_id"], row["location_id"], row["batch_id"])
    for balance in balances:
        by_product[balance["product_id"]].append(balance)
        by_batch[balance["batch_id"]].append(balance)
        by_key[key(balance)].append(balance)
        valid = Decimal("0") <= balance["reserved_qty"] <= balance["on_hand_qty"]
        report("reservation_bounds", "CONSISTENT" if valid else "UNRESOLVED",
               balance_id=balance["id"], on_hand=balance["on_hand_qty"], reserved=balance["reserved_qty"])
    for table, quantity, groups in (("products", "stock_qty", by_product), ("batches", "quantity", by_batch)):
        for row in snapshot[table]:
            rows = groups[row["id"]]
            total = sum((r["on_hand_qty"] for r in rows), Decimal("0"))
            status = "CONSISTENT" if row[quantity] == total else "UNRESOLVED"
            if not rows and row[quantity]:
                status = "MISSING_EVIDENCE"
            report(table + "_aggregate", status, id=row["id"], stored=row[quantity],
                   balance_total=total, delta=row[quantity] - total, missing_balances=not rows)
    history = defaultdict(list)
    linked = defaultdict(list)
    for movement in movements:
        history[key(movement)].append(movement)
        valid = movement["balance_before"] + movement["quantity"] == movement["balance_after"]
        report("movement_arithmetic", "CONSISTENT" if valid else "UNRESOLVED", movement_id=movement["id"])
        # Phase 14C: the explicit stock_transaction_id FK is the primary link;
        # a legacy reference_type=STOCK_TRANSACTION pointer is the fallback.
        # A movement carrying both is linked once; if they disagree the FK
        # wins and the contradiction is reported.
        fk_transaction = movement.get("stock_transaction_id")
        ref_transaction = (
            movement["reference_id"] if movement["reference_type"] == "STOCK_TRANSACTION" else None
        )
        if fk_transaction is not None and ref_transaction is not None and fk_transaction != ref_transaction:
            report("conflicting_transaction_link", "UNRESOLVED", movement_id=movement["id"],
                   stock_transaction_id=fk_transaction, reference_id=ref_transaction,
                   reason="stock_transaction_id and reference_id name different transactions")
        transaction_link = fk_transaction if fk_transaction is not None else ref_transaction
        if transaction_link is not None:
            linked[transaction_link].append(movement)
        elif movement["reference_type"] == "INVENTORY_TRANSFER":
            peers = [m for m in movements if m["reference_type"] == "INVENTORY_TRANSFER"
                     and m["reference_id"] == movement["reference_id"]
                     and m["product_id"] == movement["product_id"] and m["batch_id"] == movement["batch_id"]]
            balanced = sum((m["quantity"] for m in peers), Decimal("0")) == 0
            report("movement_transaction_link", "EXPLAINED" if balanced else "UNRESOLVED",
                   movement_id=movement["id"], reason="Transfer uses paired movements, not a stock transaction")
        else:
            report("movement_transaction_link", "MISSING_EVIDENCE", movement_id=movement["id"],
                   reason="Business-document reference is not an explicit stock-transaction link")
    for identity in set(by_key) | set(history):
        rows = by_key[identity]
        entries = sorted(history[identity], key=lambda m: m["id"])
        if len(rows) != 1 or not entries:
            report("movement_closing_balance", "MISSING_EVIDENCE", identity=identity,
                   reason="Missing movement evidence or missing/duplicate balance")
            continue
        closing = entries[-1]["balance_after"]
        report("movement_closing_balance", "CONSISTENT" if closing == rows[0]["on_hand_qty"] else "UNRESOLVED",
               identity=identity, recorded=closing, current=rows[0]["on_hand_qty"])
        for previous, current in zip(entries, entries[1:]):
            report("movement_continuity", "CONSISTENT" if previous["balance_after"] == current["balance_before"] else "UNRESOLVED",
                   previous_id=previous["id"], movement_id=current["id"])
    transaction_ids = {t["id"] for t in transactions}
    for transaction in transactions:
        entries = linked[transaction["id"]]
        if not entries:
            status = "EXPLAINED" if transaction["transaction_type"] == "ADJUST" and transaction["quantity"] == 0 else "MISSING_EVIDENCE"
        else:
            valid = all(m["product_id"] == transaction["product_id"] for m in entries)
            valid = valid and sum((m["quantity"] for m in entries), Decimal("0")) == transaction["quantity"]
            status = "CONSISTENT" if valid else "UNRESOLVED"
        report("transaction_movement_link", status, transaction_id=transaction["id"],
               movement_ids=[m["id"] for m in entries],
               reason="No-op adjustment" if status == "EXPLAINED" else "Only explicit links are conclusive; document/remark matching is ambiguous")
    for transaction_id, entries in linked.items():
        if transaction_id not in transaction_ids:
            report("orphan_movement_reference", "UNRESOLVED", transaction_id=transaction_id,
                   movement_ids=[m["id"] for m in entries])

    _analyze_transfers(snapshot, balances, movements, report)
    _analyze_expiry(snapshot, balances, today, report)
    _analyze_adjustment_links(snapshot, transactions, movements, linked, report)
    _analyze_timestamp_provenance(snapshot, movements, report)
    return findings


def _analyze_adjustment_links(snapshot, transactions, movements, linked, report):
    """Phase 14C (D7): every approval records stock_transaction_id, so
    Request -> StockTransaction(ADJUST) -> movements is checkable even for a
    zero-difference approval that wrote no movement.

    Every approval writes exactly one APPROVE_ADJUSTMENT_REQUEST audit row in
    its own transaction, and its WHOLE description is compared with the
    exact text the writing code generation produces:

    - pre-14C:  ``"<ref>: PENDING -> APPROVED"``
    - 14C+:     ``"<ref>: PENDING -> APPROVED; stock_transaction_id=<id>"``

    A NULL link is EXPLAINED only when the audit is exactly the pre-14C text
    and no movement references the request. A link is CONSISTENT only when
    the audit is exactly the 14C text naming that same transaction (plus the
    transaction / movement checks). Anything else -- missing, duplicated,
    malformed, extra-suffixed or contradictory audit text, or a movement
    disagreeing with the link -- is UNRESOLVED. Timestamps are never used as
    evidence here."""
    requests = snapshot.get("adjustment_requests")
    if not requests:
        return
    transactions_by_id = {t["id"]: t for t in transactions}
    audits = defaultdict(list)
    for row in snapshot.get("adjustment_approval_audits", []):
        audits[row["record_id"]].append(row["description"] or "")
    request_moves = defaultdict(list)
    for m in movements:
        if m["reference_type"] == "STOCK_ADJUSTMENT_REQUEST":
            request_moves[m["reference_id"]].append(m)

    def result(request, classification, reason, **evidence):
        report("adjustment_request_transaction_link", classification, request_id=request["id"],
               stock_transaction_id=request["stock_transaction_id"], reason=reason, **evidence)

    for request in requests:
        transaction_id = request["stock_transaction_id"]
        own_moves = request_moves.get(request["id"], [])
        own_audits = audits.get(request["id"], [])
        if request["status"] != "APPROVED":
            clean = transaction_id is None and not own_moves and not own_audits
            result(request, "CONSISTENT" if clean else "UNRESOLVED",
                   "Not approved: no transaction, movement or approval audit expected",
                   status=request["status"])
            continue
        if len(own_audits) != 1:
            result(request, "UNRESOLVED", "Approved request needs exactly one APPROVE audit row",
                   approve_audits=len(own_audits))
            continue
        audit_text = own_audits[0]
        reference = request["reference_number"] or ""
        audited = re.fullmatch(_14C_APPROVE_AUDIT_RE.format(ref=re.escape(reference)), audit_text)
        audited_id = int(audited.group(1)) if audited else None

        if transaction_id is None:
            if audit_text == _PRE_14C_APPROVE_AUDIT.format(ref=reference) and not own_moves:
                result(request, "EXPLAINED",
                       "Approved before Phase 14C linkage (pre-14C audit format); no backfill (D2)")
            else:
                result(request, "UNRESOLVED",
                       "Approved without a stock_transaction_id link and no proof it predates Phase 14C",
                       audited_stock_transaction_id=audited_id, movement_ids=[m["id"] for m in own_moves])
            continue

        transaction = transactions_by_id.get(transaction_id)
        moves = linked.get(transaction_id, [])
        valid = (
            transaction is not None
            and transaction["transaction_type"] == "ADJUST"
            and transaction["product_id"] == request["product_id"]
            and audit_text == _14C_APPROVE_AUDIT.format(ref=reference, tx=transaction_id)
            and all(m["reference_type"] == "STOCK_ADJUSTMENT_REQUEST"
                    and m["reference_id"] == request["id"] for m in moves)
            and all(m.get("stock_transaction_id") == transaction_id for m in own_moves)
            and len(moves) <= 1
            and len(own_moves) <= 1
        )
        result(request, "CONSISTENT" if valid else "UNRESOLVED",
               "Zero-difference approval: transaction without movement" if valid and not moves else "",
               movement_ids=[m["id"] for m in moves], audited_stock_transaction_id=audited_id)


def _analyze_timestamp_provenance(snapshot, movements, report):
    """Phase 14C (D8): which zone were the naive created_at values written in?

    Never inferred from the current session TimeZone. Instead, rows written
    in one transaction with both a timestamptz and a naive ``now()`` column
    (PO receipts, transfer receipts, adjustment requests vs their audit row)
    reveal the exact offset in force when each was written. Periods with no
    such anchor are reported as UNANCHORED, never assumed."""
    anchors = snapshot.get("timestamp_anchors")
    if anchors is None:
        return
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    declared = ZoneInfo(DIAGNOSTIC_NAIVE_TIMEZONE)
    if snapshot.get("session_timezone") is not None:
        report("db_session_timezone", "EXPLAINED", value=snapshot["session_timezone"],
               reason="Current session only; says nothing about when historical rows were written")

    groups = defaultdict(list)
    for anchor in anchors:
        offset = int((anchor["naive_at"] - anchor["aware_utc"]).total_seconds())
        instant = anchor["aware_utc"].replace(tzinfo=dt_timezone.utc)
        expected = int(declared.utcoffset(instant).total_seconds())
        groups[(anchor["anchor"], offset, expected)].append(anchor["naive_at"])
    for (kind, offset, expected), stamps in sorted(groups.items()):
        report("timestamp_provenance", "CONSISTENT" if offset == expected else "UNRESOLVED",
               anchor=kind, offset_seconds=offset, declared_zone=DIAGNOSTIC_NAIVE_TIMEZONE,
               declared_offset_seconds=expected, anchors=len(stamps),
               first_naive=min(stamps), last_naive=max(stamps))
    offsets = {offset for (_, offset, _) in groups}
    if len(offsets) > 1:
        report("timestamp_provenance_change", "UNRESOLVED", offsets_seconds=sorted(offsets),
               reason="Naive rows were written under more than one session TimeZone")

    stamps = [m["created_at"] for m in movements if m.get("created_at") is not None]
    if not anchors:
        if stamps:
            report("timestamp_provenance_unanchored", "UNANCHORED", movements=len(stamps),
                   earliest_naive=min(stamps), latest_naive=max(stamps),
                   reason="No same-transaction anchor exists; storage zone is assumed, not proven")
        return
    window_start = min(a["naive_at"] for a in anchors)
    window_end = max(a["naive_at"] for a in anchors)
    before = [s for s in stamps if s < window_start]
    after = [s for s in stamps if s > window_end]
    if before or after:
        report("timestamp_provenance_unanchored", "UNANCHORED",
               movements_before=len(before), movements_after=len(after),
               anchored_from=window_start, anchored_to=window_end,
               reason="Movements outside the anchored window; storage zone is assumed, not proven")


def _analyze_expiry(snapshot, balances, today, report):
    """Read-only Phase 7 view: how much owned stock is expired, still operationally
    eligible, or in transit, and whether the partition reconciles against
    Product.stock_qty. Classifies only; never reconciles or mutates."""
    batch_expiry = {b["id"]: b.get("expiry_date") for b in snapshot.get("batches", [])}
    transit_warehouse_ids = {
        w["id"] for w in snapshot.get("warehouses", [])
        if w.get("warehouse_code") == "__TRANSIT__" or w.get("warehouse_type") == "TRANSIT"
    }

    def is_expired_batch(batch_id):
        expiry = batch_expiry.get(batch_id)
        return expiry is not None and expiry < today

    by_product = defaultdict(list)
    for b in balances:
        by_product[b["product_id"]].append(b)

    owned_by_product = {p["id"]: p["stock_qty"] for p in snapshot.get("products", [])}

    for product_id in sorted(set(by_product) | set(owned_by_product)):
        rows = by_product.get(product_id, [])
        transit_qty = sum((r["on_hand_qty"] for r in rows if r["warehouse_id"] in transit_warehouse_ids), Decimal("0"))
        operational = [r for r in rows if r["warehouse_id"] not in transit_warehouse_ids]
        expired_qty = sum((r["on_hand_qty"] for r in operational if is_expired_batch(r["batch_id"])), Decimal("0"))
        eligible_on_hand = sum((r["on_hand_qty"] for r in operational if not is_expired_batch(r["batch_id"])), Decimal("0"))
        eligible_reserved = sum((r["reserved_qty"] for r in operational if not is_expired_batch(r["batch_id"])), Decimal("0"))
        eligible_available = eligible_on_hand - eligible_reserved
        owned_total = sum((r["on_hand_qty"] for r in rows), Decimal("0"))

        report("expired_owned_quantity", "CONSISTENT",
               product_id=product_id, expired_owned=expired_qty, in_transit=transit_qty)
        report("operationally_eligible_quantity", "CONSISTENT",
               product_id=product_id, eligible_on_hand=eligible_on_hand,
               eligible_available=eligible_available, reserved=eligible_reserved)

        stored = owned_by_product.get(product_id)
        # every operational balance is either expired or eligible; plus transit.
        partition_ok = owned_total == transit_qty + expired_qty + eligible_on_hand
        report("owned_partition_reconciliation",
               "CONSISTENT" if partition_ok else "UNRESOLVED",
               product_id=product_id, owned_total=owned_total, in_transit=transit_qty,
               expired=expired_qty, eligible_on_hand=eligible_on_hand,
               delta=owned_total - (transit_qty + expired_qty + eligible_on_hand))
        if stored is not None:
            report("owned_aggregate_matches_balances",
                   "CONSISTENT" if stored == owned_total else "UNRESOLVED",
                   product_id=product_id, stored_stock_qty=stored, balance_total=owned_total,
                   note="Product.stock_qty is total owned inventory incl. expired and transit")


def _analyze_transfers(snapshot, balances, movements, report):
    """Read-only Phase 6 checks: transit vs outstanding, movement pairing,
    receipt totals, and legacy immediate-transfer history remaining distinct.
    Nothing here reconciles or mutates."""
    transfers = {t["id"]: t for t in snapshot.get("transfers", [])}
    items = snapshot.get("transfer_items", [])
    if not transfers and not items:
        return

    balances_by_id = {b["id"]: b for b in balances}
    transfer_moves = [m for m in movements if m["reference_type"] == "INVENTORY_TRANSFER"]
    moves_by_item = defaultdict(list)
    for m in transfer_moves:
        if m.get("transfer_item_id") is not None:
            moves_by_item[m["transfer_item_id"]].append(m)

    RECEIPT_IN = {"TRANSFER_IN"}
    TRANSIT_OUT = {"TRANSFER_TRANSIT_OUT"}
    outstanding_by_transit = defaultdict(lambda: Decimal("0"))

    for item in items:
        transfer = transfers.get(item["transfer_id"])
        legs = moves_by_item.get(item["id"], [])
        dispatched = item.get("dispatched_quantity")
        received = item.get("received_quantity")

        # 1) movement pairing: every transfer leg for an item nets to zero
        #    (-dispatched + dispatched - received + received), regardless of progress.
        if legs:
            net = sum((m["quantity"] for m in legs), Decimal("0"))
            report("transfer_movement_pair_conservation",
                   "CONSISTENT" if net == 0 else "UNRESOLVED",
                   transfer_item_id=item["id"], net_movement=net)

        # 2) legacy immediate-transfer history stays distinguishable from lifecycle rows.
        is_legacy = bool(transfer and transfer.get("legacy_completed"))
        has_progress = dispatched is not None or received is not None
        has_lifecycle_moves = any(
            m.get("transfer_item_id") is not None or m.get("transfer_receipt_id") is not None
            for m in legs
        )
        if is_legacy:
            status = "EXPLAINED" if not has_progress and not has_lifecycle_moves else "UNRESOLVED"
            report("legacy_transfer_history_distinct", status, transfer_item_id=item["id"],
                   reason="Legacy immediate transfer: no lifecycle progress or linked movements")
        elif transfer and transfer.get("status") in {"IN_TRANSIT", "PARTIALLY_RECEIVED", "COMPLETED"}:
            report("legacy_transfer_history_distinct",
                   "CONSISTENT" if has_progress else "MISSING_EVIDENCE",
                   transfer_item_id=item["id"],
                   reason="Lifecycle transfer carries explicit dispatched/received progress")

        if dispatched is None or received is None:
            continue

        # 3) receipt movement totals vs recorded received_quantity.
        received_legs = sum((abs(m["quantity"]) for m in legs if m["movement_type"] in RECEIPT_IN), Decimal("0"))
        transit_out_legs = sum((abs(m["quantity"]) for m in legs if m["movement_type"] in TRANSIT_OUT), Decimal("0"))
        matches = received_legs == received == transit_out_legs
        report("transfer_receipt_movement_totals",
               "CONSISTENT" if matches else ("EXPLAINED" if not legs and received == 0 else "UNRESOLVED"),
               transfer_item_id=item["id"], received_quantity=received,
               destination_in=received_legs, transit_out=transit_out_legs)

        # 4) accumulate outstanding (still-in-transit) quantity per pinned transit balance.
        transit_balance_id = item.get("transit_stock_balance_id")
        if transit_balance_id is not None:
            outstanding_by_transit[transit_balance_id] += dispatched - received

    # 1b) transit StockBalance on-hand must equal the sum of outstanding transfer quantities pinned to it.
    transit_balance_ids = {
        b["id"] for b in balances
        if b["id"] in outstanding_by_transit
    } | set(outstanding_by_transit)
    for balance_id in sorted(transit_balance_ids):
        balance = balances_by_id.get(balance_id)
        outstanding = outstanding_by_transit.get(balance_id, Decimal("0"))
        if balance is None:
            report("transit_outstanding_reconciliation", "MISSING_EVIDENCE",
                   transit_stock_balance_id=balance_id, outstanding=outstanding)
            continue
        report("transit_outstanding_reconciliation",
               "CONSISTENT" if balance["on_hand_qty"] == outstanding else "UNRESOLVED",
               transit_stock_balance_id=balance_id, on_hand=balance["on_hand_qty"],
               outstanding=outstanding, delta=balance["on_hand_qty"] - outstanding)


def diagnose_inventory(engine, today: date | None = None) -> list[dict]:
    queries = {
        "products": "SELECT id, stock_qty FROM products",
        "batches": "SELECT id, product_id, quantity, expiry_date FROM product_batches",
        "warehouses": "SELECT id, warehouse_code, warehouse_type FROM warehouses",
        "balances": "SELECT id, product_id, warehouse_id, location_id, batch_id, on_hand_qty, reserved_qty FROM stock_balances",
        "movements": (
            "SELECT id, product_id, warehouse_id, location_id, batch_id, quantity, balance_before, balance_after, "
            "reference_type, reference_id, movement_type, transfer_item_id, transfer_receipt_id, "
            "stock_transaction_id, created_at FROM inventory_movements"
        ),
        "adjustment_requests": (
            "SELECT id, reference_number, status, product_id, stock_transaction_id "
            "FROM stock_adjustment_requests"
        ),
        "adjustment_approval_audits": (
            "SELECT record_id, description FROM audit_logs "
            "WHERE table_name = 'stock_adjustment_requests' AND action = 'APPROVE_ADJUSTMENT_REQUEST'"
        ),
        "timestamp_anchors": _TIMESTAMP_ANCHORS_SQL,
        "transactions": "SELECT id, product_id, transaction_type, quantity FROM stock_transactions",
        "transfers": "SELECT id, status, legacy_completed FROM inventory_transfers",
        "transfer_items": (
            "SELECT id, transfer_id, product_id, batch_id, quantity, dispatched_quantity, received_quantity, "
            "source_stock_balance_id, transit_stock_balance_id FROM inventory_transfer_items"
        ),
        "transfer_receipts": "SELECT id, transfer_id FROM inventory_transfer_receipts",
    }
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            if today is None:
                today = connection.execute(
                    text("SELECT (now() AT TIME ZONE :tz)::date"), {"tz": DIAGNOSTIC_TIMEZONE}
                ).scalar()
            snapshot = {name: list(connection.execute(text(sql)).mappings()) for name, sql in queries.items()}
            snapshot["session_timezone"] = connection.execute(
                text("SELECT current_setting('TimeZone')")
            ).scalar()
            return analyze_inventory(snapshot, today=today)


def main() -> int:
    url = os.environ.get("INVENTORY_DIAGNOSTIC_DATABASE_URL")
    if not url:
        print("An explicitly configured INVENTORY_DIAGNOSTIC_DATABASE_URL is required.")
        return 2
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        if engine.dialect.name != "postgresql":
            raise ValueError("PostgreSQL required")
        findings = diagnose_inventory(engine)
        print(json.dumps(findings, default=str, indent=2))
        return 1 if any(f["classification"] in {"UNRESOLVED", "MISSING_EVIDENCE"} for f in findings) else 0
    except Exception:
        print("Diagnostic could not complete. No inventory data was changed; verify read-only database access.")
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
