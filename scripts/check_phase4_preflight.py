"""Read-only Phase 4 legacy validation and unambiguous source mapping."""
import json
from decimal import Decimal
from sqlalchemy import text


def inspect_phase4_data(connection):
    if connection.dialect.name != "postgresql":
        raise RuntimeError("Phase 4 preflight requires PostgreSQL")
    findings, plans = [], []
    def fail(kind, ids):
        findings.append({"check": kind, "ids": list(ids)})
    orders = connection.execute(text("SELECT id,status FROM sales_orders ORDER BY id")).mappings().all()
    items = connection.execute(text("SELECT i.*,p.id AS existing_product_id,p.track_batch FROM sales_order_items i LEFT JOIN products p ON p.id=i.product_id ORDER BY i.id")).mappings().all()
    allocations = connection.execute(text("SELECT * FROM sales_order_batch_allocations ORDER BY id")).mappings().all()
    batches = {r.id: r.product_id for r in connection.execute(text("SELECT id,product_id FROM product_batches"))}
    balances = connection.execute(text("SELECT b.*,w.warehouse_code,l.location_code FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN warehouse_locations l ON l.id=b.location_id AND l.warehouse_id=w.id")).mappings().all()
    order_map = {r["id"]: r["status"] for r in orders}
    item_map = {r["id"]: r for r in items}
    demand = {}
    for order in orders:
        if order["status"] not in {"CONFIRMED", "COMPLETED", "CANCELLED"}:
            fail("unknown_status", [order["id"]])
        if not any(i["sales_order_id"] == order["id"] for i in items):
            fail("order_without_items", [order["id"]])
    for a in allocations:
        item = item_map.get(a["sales_order_item_id"])
        if (item is None or item["sales_order_id"] != a["sales_order_id"] or
                item["product_id"] != a["product_id"] or
                batches.get(a["batch_id"]) != a["product_id"] or not item["track_batch"]):
            fail("allocation_ownership", [a["id"]])
    for item in items:
        status = order_map.get(item["sales_order_id"])
        rows = [a for a in allocations if a["sales_order_item_id"] == item["id"]]
        if status is None or item["existing_product_id"] is None:
            fail("item_ownership", [item["id"]])
        if item["track_batch"] and sum((a["quantity"] for a in rows), Decimal(0)) != item["quantity"]:
            fail("allocation_total", [item["id"]])
        sources = rows if item["track_batch"] else [{"id": None, "batch_id": None, "quantity": item["quantity"]}]
        for source in sources:
            matches = [b for b in balances if b["product_id"] == item["product_id"] and
                       b["batch_id"] == source["batch_id"] and b["warehouse_code"] == "MAIN" and b["location_code"] == "DEFAULT"]
            if len(matches) != 1:
                fail("ambiguous_or_missing_source", [item["id"]])
                continue
            if status != "CONFIRMED":
                continue
            balance = matches[0]
            demand[balance["id"]] = demand.get(balance["id"], Decimal(0)) + source["quantity"]
            plans.append(dict(allocation_id=source["id"], stock_balance_id=balance["id"],
                              sales_order_id=item["sales_order_id"], sales_order_item_id=item["id"],
                              product_id=item["product_id"], quantity=source["quantity"]))
    for b in balances:
        if b["reserved_qty"] != demand.get(b["id"], Decimal(0)) or b["reserved_qty"] > b["on_hand_qty"]:
            fail("reservation_inconsistency", [b["id"]])
    return findings, plans


def require_phase4_compatible(connection):
    findings, plans = inspect_phase4_data(connection)
    if findings:
        raise RuntimeError("Phase 4 preflight refused incompatible data: " + json.dumps(findings))
    return plans


def main():
    import os
    from sqlalchemy import create_engine
    url = os.environ.get("PHASE4_PREFLIGHT_DATABASE_URL")
    if not url:
        print("Explicit PHASE4_PREFLIGHT_DATABASE_URL is required")
        return 2
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        if engine.dialect.name != "postgresql":
            raise RuntimeError("PostgreSQL required")
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))
                findings, _ = inspect_phase4_data(connection)
        print(json.dumps(findings, indent=2))
        return 1 if findings else 0
    except Exception:
        print("Phase 4 preflight could not complete; no data was changed. Verify explicit PostgreSQL read-only access.")
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
