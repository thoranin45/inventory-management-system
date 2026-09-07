"""Read-only checks for the Phase 4 -> Phase 5 PO cutover."""
import json
import os
from decimal import Decimal
from sqlalchemy import create_engine, text


def inspect_phase5_data(connection):
    if connection.dialect.name != "postgresql":
        raise RuntimeError("Phase 5 preflight requires PostgreSQL")
    findings = []
    orders = connection.execute(text("SELECT id,status FROM purchase_orders ORDER BY id")).mappings().all()
    items = connection.execute(text("SELECT i.*,p.id AS existing_product FROM purchase_order_items i LEFT JOIN products p ON p.id=i.product_id ORDER BY i.id")).mappings().all()
    ids = {o["id"] for o in orders}
    def fail(check, identifiers):
        findings.append({"check": check, "ids": list(identifiers)})
    for i in items:
        if i["po_id"] not in ids or i["existing_product"] is None:
            fail("item_ownership", [i["id"]])
        values = (i["quantity"], i["received_quantity"])
        if any(v is None or not v.is_finite() or abs(v) > Decimal("999999999999999.999") or v != v.quantize(Decimal("0.001")) for v in values):
            fail("quantity_precision", [i["id"]])
        elif not (i["quantity"] > 0 and 0 <= i["received_quantity"] <= i["quantity"]):
            fail("quantity_bounds", [i["id"]])
    for order in orders:
        rows = [i for i in items if i["po_id"] == order["id"]]
        if order["status"] not in {"PENDING", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"}:
            fail("unknown_status", [order["id"]])
        if not rows:
            fail("empty_order", [order["id"]])
            continue
        if len({i["product_id"] for i in rows}) != len(rows):
            fail("duplicate_product_lines", [i["id"] for i in rows])
        if any(i["received_quantity"] is None or not i["received_quantity"].is_finite() for i in rows):
            continue
        zero = all(i["received_quantity"] == 0 for i in rows)
        full = all(i["received_quantity"] == i["quantity"] for i in rows)
        if ((order["status"] in {"PENDING", "CANCELLED"} and not zero) or
                (order["status"] == "PARTIALLY_RECEIVED" and (zero or full)) or
                (order["status"] == "RECEIVED" and not full)):
            fail("status_quantity_mismatch", [order["id"]])
    fake = connection.execute(text("SELECT b.id FROM product_batches b JOIN products p ON p.id=b.product_id WHERE p.track_batch IS NOT TRUE ORDER BY b.id")).scalars().all()
    if fake:
        fail("batches_on_non_batch_products", fake)
    return findings


def require_phase5_compatible(connection):
    findings = inspect_phase5_data(connection)
    if findings:
        raise RuntimeError("Phase 5 preflight refused incompatible data: " + json.dumps(findings))


def main():
    url = os.environ.get("PHASE5_PREFLIGHT_DATABASE_URL")
    if not url:
        print("Explicit PHASE5_PREFLIGHT_DATABASE_URL is required")
        return 2
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))
                findings = inspect_phase5_data(connection)
        print(json.dumps(findings, indent=2))
        return int(bool(findings))
    except Exception:
        print("Preflight could not complete; no data was changed. Verify explicit PostgreSQL read-only access.")
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
