"""Alembic Phase 5 upgrade/preflight/downgrade on isolated test schemas."""
from decimal import Decimal
import pytest
from alembic import command
from sqlalchemy import text, inspect
from tests.test_migrations import migration_engine, upgrade
from tests.database_support import migration_config

PHASE4 = "e41a00000001"


def seed(c, status="PENDING", received="0"):
    c.execute(text("INSERT INTO products(id,sku,product_name,stock_qty,price) VALUES (301,'P5','Legacy',0,1)"))
    c.execute(text("INSERT INTO suppliers(id,supplier_name) VALUES (301,'Supplier')"))
    c.execute(text("INSERT INTO purchase_orders(id,po_number,supplier_id,status) VALUES (301,'PO-301',301,:status)"), {"status": status})
    c.execute(text("INSERT INTO purchase_order_items(id,po_id,product_id,quantity,received_quantity,unit_price) VALUES (301,301,301,1.125,:received,1)"), {"received": Decimal(received)})


def inventory(c):
    return {table:c.execute(text(f"SELECT * FROM {table} ORDER BY id")).all() for table in ("products","product_batches","stock_balances","stock_transactions")}


@pytest.mark.parametrize("status,quantity", [("PENDING","0"),("CANCELLED","0"),("PARTIALLY_RECEIVED","0.001"),("RECEIVED","1.125")])
def test_populated_upgrade_and_compatible_downgrade(migration_engine,status,quantity):
    upgrade(migration_engine, PHASE4)
    with migration_engine.begin() as c:
        seed(c,status,quantity)
        before=inventory(c)
    upgrade(migration_engine,"head")
    with migration_engine.connect() as c:
        assert inventory(c)==before
        assert c.scalar(text("SELECT status FROM purchase_orders")) == ("CONFIRMED" if status=="PENDING" else status)
        assert c.scalar(text("SELECT received_quantity FROM purchase_order_items")) == Decimal(quantity)
        assert c.scalar(text("SELECT count(*) FROM purchase_order_receipts")) == 0
    with migration_engine.begin() as c:
        command.downgrade(migration_config(c),PHASE4)
        assert inventory(c)==before
        assert c.scalar(text("SELECT status FROM purchase_orders"))==status
    upgrade(migration_engine,"head")


@pytest.mark.parametrize("sql,reason", [
    ("UPDATE purchase_orders SET status='UNKNOWN'","unknown_status"),
    ("UPDATE purchase_orders SET status='RECEIVED'","status_quantity_mismatch"),
    ("UPDATE purchase_orders SET status='PARTIALLY_RECEIVED'","status_quantity_mismatch"),
    ("DELETE FROM purchase_order_items","empty_order"),
    ("INSERT INTO product_batches(product_id,lot_no,quantity) VALUES (301,'FAKE',0)","batches_on_non_batch_products"),
    ("UPDATE purchase_order_items SET received_quantity=0.001","status_quantity_mismatch"),
])
def test_preflight_refusal(migration_engine,sql,reason):
    upgrade(migration_engine,PHASE4)
    with migration_engine.begin() as c:
        seed(c)
        c.execute(text(sql))
        before=inventory(c)
    with pytest.raises(RuntimeError,match=reason):
        upgrade(migration_engine,"head")
    with migration_engine.connect() as c:
        assert inventory(c)==before
        assert c.scalar(text("SELECT version_num FROM alembic_version"))==PHASE4
        assert "purchase_order_receipts" not in inspect(c).get_table_names()


def test_legacy_movement_links_remain_unknown(migration_engine):
    upgrade(migration_engine,PHASE4)
    with migration_engine.begin() as c:
        seed(c,"RECEIVED","1.125")
        c.execute(text("INSERT INTO warehouses(id,warehouse_code,warehouse_name) VALUES (301,'MAIN','Main')"))
        c.execute(text("INSERT INTO warehouse_locations(id,warehouse_id,location_code) VALUES (301,301,'DEFAULT')"))
        c.execute(text("INSERT INTO inventory_movements(product_id,warehouse_id,location_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id) VALUES (301,301,301,'PURCHASE_RECEIPT',1.125,0,1.125,'PURCHASE_ORDER',301)"))
    upgrade(migration_engine,"head")
    with migration_engine.connect() as c:
        row=c.execute(text("SELECT quantity,purchase_receipt_id,purchase_order_item_id,stock_transaction_id FROM inventory_movements")).one()
        assert tuple(row)==(Decimal("1.125"),None,None,None)


@pytest.mark.parametrize("history", [False,True])
def test_downgrade_guard(migration_engine,history):
    upgrade(migration_engine,PHASE4)
    with migration_engine.begin() as c:
        seed(c)
    upgrade(migration_engine,"head")
    with migration_engine.begin() as c:
        if history:
            c.execute(text("INSERT INTO users(id,username,password_hash,role) VALUES (301,'p5','unused','ADMIN')"))
            c.execute(text("INSERT INTO purchase_order_receipts(po_id,receipt_number,operation_key,request_fingerprint,received_by_user_id,response_snapshot) VALUES (301,'R','K','hash',301,'{}')"))
        else:
            c.execute(text("UPDATE purchase_orders SET status='DRAFT'"))
    with pytest.raises(RuntimeError,match="Cannot downgrade"):
        with migration_engine.begin() as c:
            command.downgrade(migration_config(c),PHASE4)
    with migration_engine.connect() as c:
        # Refused Phase 4 downgrade leaves the database at the current head revision.
        assert c.scalar(text("SELECT version_num FROM alembic_version"))=="e71a00000001"
