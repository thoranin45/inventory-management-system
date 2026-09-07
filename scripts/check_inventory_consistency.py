"""Read-only PostgreSQL inventory diagnostic. Never loads application configuration.

Run with an explicitly provisioned INVENTORY_DIAGNOSTIC_DATABASE_URL environment
variable. No .env files are opened, and connection errors never expose credentials.
"""
import json
import os
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import create_engine, text


def analyze_inventory(snapshot: dict) -> list[dict]:
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
        if movement["reference_type"] == "STOCK_TRANSACTION":
            linked[movement["reference_id"]].append(movement)
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
    return findings


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


def diagnose_inventory(engine) -> list[dict]:
    queries = {
        "products": "SELECT id, stock_qty FROM products",
        "batches": "SELECT id, product_id, quantity FROM product_batches",
        "balances": "SELECT id, product_id, warehouse_id, location_id, batch_id, on_hand_qty, reserved_qty FROM stock_balances",
        "movements": (
            "SELECT id, product_id, warehouse_id, location_id, batch_id, quantity, balance_before, balance_after, "
            "reference_type, reference_id, movement_type, transfer_item_id, transfer_receipt_id FROM inventory_movements"
        ),
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
            snapshot = {name: list(connection.execute(text(sql)).mappings()) for name, sql in queries.items()}
            return analyze_inventory(snapshot)


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
