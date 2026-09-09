"""Alembic-built Phase 3 fixtures exercise the Phase 4 cutover."""
from decimal import Decimal
import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from tests.test_migrations import migration_engine, upgrade, HEAD as PHASE3
from tests.database_support import migration_config


def legacy(connection, status="CONFIRMED", batch=True):
    connection.execute(text("INSERT INTO products(id,sku,product_name,stock_qty,price,track_batch) VALUES (201,'LEGACY','Legacy',1.125,1,:batch)"), {"batch": batch})
    connection.execute(text("INSERT INTO warehouses(id,warehouse_code,warehouse_name) VALUES (201,'MAIN','Main')"))
    connection.execute(text("INSERT INTO warehouse_locations(id,warehouse_id,location_code) VALUES (201,201,'DEFAULT')"))
    if batch:
        connection.execute(text("INSERT INTO product_batches(id,product_id,lot_no,quantity) VALUES (201,201,'LEGACY',1.125)"))
    connection.execute(text("INSERT INTO stock_balances(id,product_id,warehouse_id,location_id,batch_id,on_hand_qty,reserved_qty) VALUES (201,201,201,201,:batch,1.125,:reserved)"), {"batch": 201 if batch else None, "reserved": Decimal("1.125") if status == "CONFIRMED" else Decimal(0)})
    connection.execute(text("INSERT INTO sales_orders(id,so_number,status,total_amount) VALUES (201,'SO-LEGACY',:status,1.13)"), {"status": status})
    connection.execute(text("INSERT INTO sales_order_items(id,sales_order_id,product_id,quantity,unit_price,total_price) VALUES (201,201,201,1.125,1,1.13)"))
    if batch:
        connection.execute(text("INSERT INTO sales_order_batch_allocations(id,sales_order_id,sales_order_item_id,product_id,batch_id,quantity) VALUES (201,201,201,201,201,1.125)"))


def inventory(connection):
    return {table: connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
            for table in ("products", "product_batches", "stock_balances", "stock_transactions", "inventory_movements")}


@pytest.mark.parametrize("batch", [False, True])
@pytest.mark.parametrize("status", ["CONFIRMED", "COMPLETED", "CANCELLED"])
def test_phase4_legacy_upgrade_and_compatible_downgrade(migration_engine, batch, status):
    upgrade(migration_engine, PHASE3)
    with migration_engine.begin() as c:
        legacy(c, status, batch)
        before = inventory(c)
    upgrade(migration_engine, "e41a00000001")
    with migration_engine.connect() as c:
        assert inventory(c) == before
        order = c.execute(text("SELECT * FROM sales_orders WHERE id=201")).mappings().one()
        assert order["status"] == status
        assert all(order[field] is None for field in ("picked_at", "packed_at", "shipped_at", "shipment_number", "picked_by_user_id", "packed_by_user_id", "shipped_by_user_id"))
        rows = c.execute(text("SELECT * FROM sales_order_batch_allocations")).mappings().all()
        if status == "CONFIRMED":
            assert len(rows) == 1
            assert rows[0]["stock_balance_id"] == 201
            assert rows[0]["picked_quantity"] == rows[0]["packed_quantity"] == 0
            assert rows[0]["quantity"] == Decimal("1.125")
        else:
            assert all(r["stock_balance_id"] is r["picked_quantity"] is r["packed_quantity"] is None for r in rows)
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c), PHASE3)
        assert inventory(c) == before
    upgrade(migration_engine, "e41a00000001")


@pytest.mark.parametrize("sql,reason", [
    ("UPDATE sales_orders SET status='UNKNOWN'", "unknown_status"),
    ("UPDATE sales_order_batch_allocations SET quantity=0.001", "allocation_total"),
    ("UPDATE sales_order_batch_allocations SET sales_order_item_id=NULL", "allocation_ownership"),
    ("UPDATE warehouses SET warehouse_code='OTHER'", "ambiguous_or_missing_source"),
    ("UPDATE stock_balances SET reserved_qty=0", "reservation_inconsistency"),
])
def test_phase4_preflight_refuses_without_changes(migration_engine, sql, reason):
    upgrade(migration_engine, PHASE3)
    with migration_engine.begin() as c:
        legacy(c)
        c.execute(text(sql))
        before = inventory(c)
    with pytest.raises(RuntimeError, match=reason):
        upgrade(migration_engine, "e41a00000001")
    with migration_engine.connect() as c:
        assert inventory(c) == before
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PHASE3
        assert c.scalar(text("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sales_orders' AND column_name='picked_at'")) == 0


@pytest.mark.parametrize("sql", ["UPDATE sales_orders SET status='DRAFT'", "UPDATE sales_order_batch_allocations SET picked_quantity=0.001", "UPDATE sales_orders SET shipment_number='SHIP-201',status='COMPLETED'"])
def test_phase4_downgrade_refuses_history(migration_engine, sql):
    upgrade(migration_engine, PHASE3)
    with migration_engine.begin() as c:
        legacy(c)
    upgrade(migration_engine, "e41a00000001")
    with migration_engine.begin() as c:
        c.execute(text(sql))
        before = inventory(c)
    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        with migration_engine.begin() as c:
            command.downgrade(migration_config(c), PHASE3)
    with migration_engine.connect() as c:
        assert inventory(c) == before
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == "e41a00000001"


@pytest.mark.parametrize("values", ["picked_quantity=-0.001", "picked_quantity=2", "packed_quantity=0.001"])
def test_phase4_progress_constraint(migration_engine, values):
    upgrade(migration_engine, PHASE3)
    with migration_engine.begin() as c:
        legacy(c)
    upgrade(migration_engine, "e41a00000001")
    with pytest.raises(IntegrityError):
        with migration_engine.begin() as c:
            c.execute(text("UPDATE sales_order_batch_allocations SET " + values))
