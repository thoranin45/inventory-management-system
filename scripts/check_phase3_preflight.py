"""Read-only checks before Alembic upgrades; never loads settings or .env files."""
import json
import os

from sqlalchemy import create_engine, inspect, text


QUANTITIES = {
    "products": {"stock_qty": ">= 0"},
    "product_batches": {"quantity": ">= 0"},
    "stock_balances": {"on_hand_qty": ">= 0", "reserved_qty": ">= 0"},
    "stock_transactions": {"quantity": None},
    "inventory_movements": {"quantity": "<> 0", "balance_before": ">= 0", "balance_after": ">= 0"},
    "purchase_order_items": {"quantity": "> 0", "received_quantity": ">= 0"},
    "sales_order_items": {"quantity": "> 0"},
    "sales_order_batch_allocations": {"quantity": "> 0"},
    "inventory_transfer_items": {"quantity": "> 0"},
}


def inspect_phase3_data(connection) -> list[dict]:
    if connection.dialect.name != "postgresql":
        raise RuntimeError("Phase 3 preflight requires PostgreSQL")
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    findings = []

    def check(table, label, predicate):
        # Identifiers and predicates are internal constants, never caller input.
        ids = list(connection.execute(text(
            f'SELECT id FROM "{table}" WHERE {predicate} ORDER BY id'
        )).scalars())
        if ids:
            findings.append({"table": table, "check": label, "ids": ids})

    for table, fields in QUANTITIES.items():
        if table not in tables:
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        for field, bounds in fields.items():
            if field not in columns:
                continue
            invalid = (
                f'{field} IS NULL OR {field}::text IN (\'NaN\', \'Infinity\', \'-Infinity\') '
                f'OR abs({field}::numeric) > 999999999999999.999 '
                f'OR {field} <> trunc({field}::numeric, 3)'
            )
            if bounds:
                invalid += f" OR NOT ({field} {bounds})"
            check(table, f"{field}_numeric_18_3", invalid)
        if table == "stock_balances":
            check(table, "reservation_bounds", "reserved_qty > on_hand_qty")
        if table == "purchase_order_items" and "received_quantity" in columns:
            check(table, "over_received", "received_quantity > quantity")

    for table, fields in {
        "product_batches": ("product_id",),
        "purchase_order_items": ("po_id", "product_id", "unit_price"),
    }.items():
        if table in tables:
            check(table, "required_legacy_fields", " OR ".join(f"{f} IS NULL" for f in fields))

    for table, columns in {
        "product_batches": ("product_id", "lot_no"),
        "sales_order_items": ("sales_order_id", "product_id"),
        "purchase_order_items": ("po_id", "product_id"),
    }.items():
        if table not in tables:
            continue
        keys = ", ".join(columns)
        nonnull = " AND ".join(f"{c} IS NOT NULL" for c in columns)
        groups = connection.execute(text(
            f'SELECT array_agg(id ORDER BY id) AS ids FROM "{table}" '
            f'WHERE {nonnull} GROUP BY {keys} HAVING count(*) > 1'
        )).scalars().all()
        for ids in groups:
            findings.append({"table": table, "check": f"duplicate_{'_'.join(columns)}", "ids": ids})

    if "inventory_transfers" in tables:
        check("inventory_transfers", "different_warehouses", "source_warehouse_id = destination_warehouse_id")
    if "inventory_transfer_items" in tables:
        check("inventory_transfer_items", "different_locations", "from_location_id = to_location_id")
    return findings


def require_compatible_inventory(connection) -> None:
    findings = inspect_phase3_data(connection)
    if findings:
        raise RuntimeError("Phase 3 preflight refused incompatible data: " + json.dumps(findings))


def main() -> int:
    url = os.environ.get("PHASE3_PREFLIGHT_DATABASE_URL")
    if not url:
        print("Explicit PHASE3_PREFLIGHT_DATABASE_URL is required")
        return 2
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))
                findings = inspect_phase3_data(connection)
        print(json.dumps(findings, indent=2))
        return 1 if findings else 0
    except Exception:
        print("Preflight could not complete; no data was changed. Verify PostgreSQL read-only access.")
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
