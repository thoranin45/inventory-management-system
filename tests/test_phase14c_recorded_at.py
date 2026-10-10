"""Phase 14C (ea1a00000004): row-level timestamp provenance.

Every movement write path must get a database-stamped recorded_at_utc;
history stays NULL; STOCK_TRANSACTION lookups stay complete, ordered and
duplicate-free; and the two-step migration never backfills old rows."""
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import inspect, text

from app.models import InventoryMovement, StockAdjustmentRequest, StockTransaction
from app.schemas.inventory_movement_schema import MOVEMENT_GROUPS
from tests import test_purchase_order as purchase
from tests import test_sales_order as sales
from tests.database_support import migration_config
from tests.test_inventory_transfer import (  # noqa: F401
    _create_draft_transfer,
    _dispatch,
    _receive,
    _receive_lines,
    transfer_storage,
)
from tests.test_migrations import migration_engine, upgrade  # noqa: F401
from tests.test_phase14c_adjustment_privacy import _main_storage
from tests.test_purchase_receipts import receive as po_receive
from tests.test_stock import _create_product
from tests.test_stock_adjustment_requests import _approve, _create_request

URL = "/api/v1/inventory-movements"
ALL_TYPES = {t for types in MOVEMENT_GROUPS.values() for t in types}


def _ok(response, *codes):
    assert response.status_code in (codes or (200,)), response.text
    return response


# --------------------------------------------------------------------------- #
# Every write path stamps recorded_at_utc
# --------------------------------------------------------------------------- #
def test_every_movement_write_path_records_an_aware_instant(client, admin_headers, warehouse_headers,
                                                            transfer_storage, db_session):
    products = []

    # Stock In + approved adjustment (non-batch product).
    plain = _create_product(client, admin_headers)
    products.append(plain["id"])
    _ok(client.post("/api/v1/stock/in", headers=admin_headers,
                    json={"product_id": plain["id"], "quantity": "40.000", "remark": "write-path"}))
    created = _create_request(client, warehouse_headers, product_id=plain["id"], observed="40.000",
                              requested="39.000").json()["data"]
    _ok(_approve(client, admin_headers, created["id"]))

    # Transfer dispatch + receipt (four legs incl. transit).
    transfer = _create_draft_transfer(client, admin_headers, plain["id"], transfer_storage, quantity="5.000")
    _dispatch(client, admin_headers, transfer["id"])
    _receive(client, admin_headers, transfer["id"], _receive_lines(transfer))

    # PO receipt.
    supplier = purchase._create_supplier(client, admin_headers)
    order = purchase._create_purchase_order(client, admin_headers, supplier["id"], plain["id"], quantity=3)
    purchase._confirm_purchase_order(client, admin_headers, order["id"])
    _ok(po_receive(client, admin_headers, order["id"], quantity="3.000", product_id=plain["id"]))

    # Batch In + FIFO + FEFO + sales shipment + sales return (batch product).
    lotted = sales._create_product(client, admin_headers)
    products.append(lotted["id"])
    sales._create_batch(client, admin_headers, lotted["id"], quantity=30, expiry_days=120)
    for strategy in ("fifo", "fefo"):
        _ok(client.post(f"/api/v1/stock/out-{strategy}", headers=admin_headers,
                        json={"product_id": lotted["id"], "quantity": "1.000", "remark": strategy}))
    customer = sales._create_customer(client, admin_headers)
    so = sales._create_sales_order(client, admin_headers, customer["id"], lotted["id"], quantity=4,
                                   unit_price=100)
    sales._confirm_sales_order(client, admin_headers, so["sales_order_id"])
    sales._ready_sales_order(client, admin_headers, so["sales_order_id"])
    sales._ship_sales_order(client, admin_headers, so["sales_order_id"])
    _ok(client.post(f"/api/v1/sales-orders/{so['sales_order_id']}/return", headers=admin_headers,
                    json={"items": [{"product_id": lotted["id"], "quantity": 1, "reason": "write-path"}]}))

    db_session.expire_all()
    rows = db_session.query(InventoryMovement).filter(InventoryMovement.product_id.in_(products)).all()
    assert {r.movement_type for r in rows} == ALL_TYPES  # all 12 written types exercised
    assert [r.id for r in rows if r.recorded_at_utc is None] == []
    assert all(r.recorded_at_utc.tzinfo is not None for r in rows)

    # The DB stamped recorded_at_utc and created_at from the same now(): read
    # in the writing session's zone they are the same instant, row by row.
    mismatched = db_session.execute(text(
        "SELECT id FROM inventory_movements WHERE product_id = ANY(:ids) "
        "AND (recorded_at_utc AT TIME ZONE current_setting('TimeZone')) <> created_at"
    ), {"ids": products}).scalars().all()
    assert mismatched == []


def test_application_code_never_assigns_recorded_at_utc():
    """Only the database's DEFAULT now() may stamp provenance."""
    app_dir = Path(__file__).resolve().parent.parent / "app"
    offenders = [
        str(path) for path in app_dir.rglob("*.py")
        if path.name != "models.py" and re.search(r"recorded_at_utc\s*=", path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


# --------------------------------------------------------------------------- #
# STOCK_TRANSACTION lookups: FK rows, pagination, ordering, no duplicates
# --------------------------------------------------------------------------- #
def test_po_receipt_movement_is_found_through_its_transaction_fk(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    supplier = purchase._create_supplier(client, admin_headers)
    order = purchase._create_purchase_order(client, admin_headers, supplier["id"], product["id"], quantity=2)
    purchase._confirm_purchase_order(client, admin_headers, order["id"])
    _ok(po_receive(client, admin_headers, order["id"], quantity="2.000", product_id=product["id"]))

    movement = db_session.query(InventoryMovement).filter_by(product_id=product["id"],
                                                             movement_type="PURCHASE_RECEIPT").one()
    assert movement.reference_type == "PURCHASE_ORDER" and movement.stock_transaction_id is not None
    bare = client.get(f"{URL}/reference/STOCK_TRANSACTION/{movement.stock_transaction_id}", headers=admin_headers)
    assert [r["id"] for r in bare.json()] == [movement.id]
    listed = client.get(URL, headers=admin_headers, params={
        "reference_type": "STOCK_TRANSACTION", "reference_id": movement.stock_transaction_id}).json()["data"]
    assert [r["id"] for r in listed["items"]] == [movement.id]
    # Its own business reference still works exactly as before.
    assert movement.id in [r["id"] for r in client.get(
        f"{URL}/reference/PURCHASE_ORDER/{order['id']}", headers=admin_headers).json()]


def test_many_matching_rows_paginate_stably_without_duplicates(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    transaction = StockTransaction(product_id=product["id"], transaction_type="ADJUST", quantity=Decimal("6"))
    db_session.add(transaction)
    db_session.flush()
    warehouse, location = _main_storage(db_session)
    same = datetime(2026, 2, 2, 10, 0, 0)  # identical created_at -> id tie-break decides
    kinds = [
        ("STOCK_TRANSACTION", transaction.id, None),             # legacy reference only
        ("STOCK_TRANSACTION", transaction.id, None),
        ("STOCK_ADJUSTMENT_REQUEST", 1, transaction.id),         # FK only
        ("STOCK_TRANSACTION", transaction.id, transaction.id),   # both
        ("STOCK_TRANSACTION", transaction.id, transaction.id),   # both
    ]
    ids = []
    for ref_type, ref_id, fk in kinds:
        m = InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id, location_id=location.id,
                              movement_type="STOCK_ADJUST", quantity=Decimal("1"), balance_before=Decimal("0"),
                              balance_after=Decimal("1"), reference_type=ref_type, reference_id=ref_id,
                              stock_transaction_id=fk, created_at=same)
        db_session.add(m)
        db_session.flush()
        ids.append(m.id)
    # Noise that must NOT match: another transaction, and a non-STOCK_TRANSACTION
    # reference that merely reuses the same numeric id.
    db_session.add(InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id, location_id=location.id,
                                     movement_type="STOCK_IN", quantity=Decimal("1"), balance_before=Decimal("0"),
                                     balance_after=Decimal("1"), reference_type="PURCHASE_ORDER",
                                     reference_id=transaction.id, created_at=same))
    db_session.commit()

    bare = client.get(f"{URL}/reference/STOCK_TRANSACTION/{transaction.id}", headers=admin_headers).json()
    assert [r["id"] for r in bare] == sorted(ids)  # legacy bare array: id ascending, once each

    seen, totals = [], set()
    for page in (1, 2, 3):
        data = client.get(URL, headers=admin_headers, params={
            "reference_type": "STOCK_TRANSACTION", "reference_id": transaction.id,
            "page": page, "page_size": 2}).json()["data"]
        totals.add(data["pagination"]["total_items"])
        seen += [r["id"] for r in data["items"]]
    assert totals == {5}
    assert seen == sorted(ids, reverse=True)  # newest first, stable id tie-break, no gaps/dupes


# --------------------------------------------------------------------------- #
# Migration ea1a00000004
# --------------------------------------------------------------------------- #
PRE = "ea1a00000003"
HEAD = "ea1a00000004"


def _seed_movement(connection, product_id):
    connection.execute(text(
        "INSERT INTO products(id, sku, product_name, stock_qty, price) "
        "VALUES (:p, :sku, 'Provenance', 0, 1)"), {"p": product_id, "sku": f"PRV-{uuid4().hex[:8]}"})
    connection.execute(text(
        "INSERT INTO inventory_movements(product_id, warehouse_id, location_id, movement_type, quantity, "
        "balance_before, balance_after, created_at) "
        "SELECT :p, w.id, l.id, 'STOCK_IN', 1, 0, 1, TIMESTAMP '2025-06-01 09:00:00' FROM warehouses w "
        "JOIN warehouse_locations l ON l.warehouse_id = w.id "
        "WHERE w.warehouse_code = 'MAIN' AND l.location_code = 'DEFAULT'"), {"p": product_id})


def _downgrade(engine, revision):
    with engine.begin() as connection:
        command.downgrade(migration_config(connection), revision)


def test_upgrade_adds_column_without_backfilling_history(migration_engine):
    upgrade(migration_engine, PRE)
    with migration_engine.begin() as c:
        _seed_movement(c, 9201)
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        column = next(col for col in inspect(c).get_columns("inventory_movements")
                      if col["name"] == "recorded_at_utc")
        assert column["nullable"] is True
        assert column["type"].timezone is True  # TIMESTAMPTZ
        assert "now()" in str(column["default"])
        old = c.execute(text("SELECT recorded_at_utc, created_at FROM inventory_movements "
                             "WHERE product_id = 9201")).one()
        assert old.recorded_at_utc is None                       # no backfill
        assert old.created_at == datetime(2025, 6, 1, 9, 0, 0)  # history untouched
        _seed_movement(c, 9202)  # a NEW insert that never mentions the column
        new = c.execute(text("SELECT recorded_at_utc FROM inventory_movements WHERE product_id = 9202")).scalar()
        assert new is not None and new.tzinfo is not None
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD


def test_downgrade_refuses_while_rows_carry_provenance(migration_engine):
    upgrade(migration_engine, HEAD)
    with migration_engine.begin() as c:
        _seed_movement(c, 9203)
    with pytest.raises(RuntimeError, match="Refusing to downgrade ea1a00000004"):
        _downgrade(migration_engine, PRE)
    with migration_engine.connect() as c:
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == HEAD


def test_downgrade_without_provenance_drops_only_the_column(migration_engine):
    upgrade(migration_engine, PRE)
    with migration_engine.begin() as c:
        _seed_movement(c, 9204)  # pre-revision history stays NULL after upgrade
    upgrade(migration_engine, HEAD)
    _downgrade(migration_engine, PRE)
    with migration_engine.connect() as c:
        columns = {col["name"] for col in inspect(c).get_columns("inventory_movements")}
        assert "recorded_at_utc" not in columns
        assert c.scalar(text("SELECT count(*) FROM inventory_movements WHERE product_id = 9204")) == 1
        assert c.scalar(text("SELECT version_num FROM alembic_version")) == PRE
    upgrade(migration_engine, HEAD)
