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
    return findings


def diagnose_inventory(engine) -> list[dict]:
    queries = {
        "products": "SELECT id, stock_qty FROM products",
        "batches": "SELECT id, product_id, quantity FROM product_batches",
        "balances": "SELECT id, product_id, warehouse_id, location_id, batch_id, on_hand_qty, reserved_qty FROM stock_balances",
        "movements": "SELECT id, product_id, warehouse_id, location_id, batch_id, quantity, balance_before, balance_after, reference_type, reference_id FROM inventory_movements",
        "transactions": "SELECT id, product_id, transaction_type, quantity FROM stock_transactions",
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
