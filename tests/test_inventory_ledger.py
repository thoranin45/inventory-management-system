"""Phase 14C -- GET /inventory-movements as the operational ledger.

Covers backward compatibility, the new filters and their validation,
bounded query counts, inactive history, transfer stage expectations, the
declared-timezone policy, and Request -> Transaction -> AuditLog
traceability (including zero-difference approvals that write no movement).
"""
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.core.config import settings
from app.core.pagination import phase8_json
from app.models import (
    AuditLog,
    InventoryMovement,
    Product,
    StockAdjustmentRequest,
    StockBalance,
    StockTransaction,
    Warehouse,
    WarehouseLocation,
)
from app.schemas.inventory_movement_schema import InventoryMovementResponse, MOVEMENT_GROUPS
from scripts.check_inventory_consistency import diagnose_inventory
from tests.conftest import test_engine
from tests.test_inventory_transfer import (  # noqa: F401
    _create_draft_transfer,
    _dispatch,
    _receive,
    transfer_storage,
)
from tests.test_phase14c_adjustment_privacy import _approved_request, _adjust_rows, _headers, _main_storage, _mint
from tests.test_stock import _create_product
from tests.test_stock_adjustment_requests import _approve, _create_request, _key

URL = "/api/v1/inventory-movements"


def _ledger(client, headers, **params):
    response = client.get(URL, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _stock_in(client, headers, product_id, quantity):
    response = client.post("/api/v1/stock/in", headers=headers,
                           json={"product_id": product_id, "quantity": quantity, "remark": "ledger"})
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- #
# Backward compatibility
# --------------------------------------------------------------------------- #
def test_legacy_fields_are_unchanged_and_new_fields_are_additive(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "5.250")
    data = _ledger(client, admin_headers, product_id=product["id"])

    assert set(data) == {"items", "pagination"}
    assert data["pagination"] == {"page": 1, "page_size": 50, "total_items": 1, "total_pages": 1}
    item = data["items"][0]
    movement = db_session.query(InventoryMovement).filter_by(product_id=product["id"]).one()
    legacy = phase8_json(InventoryMovementResponse.model_validate(movement))
    for key, value in legacy.items():
        assert item[key] == value, key  # byte-identical legacy values, incl. naive created_at
    assert item["created_at"] == movement.created_at.isoformat()
    assert item["quantity"] == "5.250"
    assert {"occurred_at", "direction", "is_transit_leg", "product", "batch", "warehouse", "location",
            "created_by", "source", "adjustment", "remark_redacted"} <= set(item)
    assert item["direction"] == "IN"
    assert item["product"]["id"] == product["id"]
    assert item["created_by"]["username"]
    assert item["source"] == {"type": "STOCK_TRANSACTION", "id": movement.reference_id,
                              "number": None, "receipt_number": None}
    assert item["adjustment"] is None


def test_default_order_is_newest_first_with_stable_id_tiebreak(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    warehouse, location = _main_storage(db_session)
    same = datetime(2026, 1, 5, 9, 0, 0)
    ids = []
    for _ in range(3):
        m = InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id, location_id=location.id,
                              movement_type="STOCK_IN", quantity=Decimal("1"), balance_before=Decimal("0"),
                              balance_after=Decimal("1"), reference_type="STOCK_TRANSACTION", created_at=same)
        db_session.add(m)
        db_session.flush()
        ids.append(m.id)
    db_session.commit()

    desc = [i["id"] for i in _ledger(client, admin_headers, product_id=product["id"])["items"]]
    assert desc == sorted(ids, reverse=True)
    asc = [i["id"] for i in _ledger(client, admin_headers, product_id=product["id"], sort_order="asc")["items"]]
    assert asc == sorted(ids)
    paged = [_ledger(client, admin_headers, product_id=product["id"], page=p, page_size=1)["items"][0]["id"]
             for p in (1, 2, 3)]
    assert paged == desc


def test_legacy_date_filters_keep_their_exact_pre_14c_semantics(client, admin_headers, db_session):
    """Raw naive comparison, a bare date_to meaning midnight, and no span cap."""
    product = _create_product(client, admin_headers)
    warehouse, location = _main_storage(db_session)
    db_session.add(InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id, location_id=location.id,
                                     movement_type="STOCK_IN", quantity=Decimal("1"), balance_before=Decimal("0"),
                                     balance_after=Decimal("1"), created_at=datetime(2026, 3, 1, 12, 0, 0)))
    db_session.commit()
    pid = product["id"]
    assert _ledger(client, admin_headers, product_id=pid, date_to="2026-03-01")["pagination"]["total_items"] == 0
    assert _ledger(client, admin_headers, product_id=pid, date_from="2020-01-01",
                   date_to="2030-12-31T23:59:59")["pagination"]["total_items"] == 1


# --------------------------------------------------------------------------- #
# New filters and validation
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("params, detail", [
    ({"from_date": "2026-01-02", "to_date": "2026-01-01"}, "from_date must not be after to_date"),
    ({"from_date": "2025-01-01", "to_date": "2026-01-02"}, "limited to 366 days"),
    ({"from_date": "2026-01-01"}, "supplied together"),
    ({"to_date": "2026-01-01"}, "supplied together"),
    ({"from_date": "2026-01-01", "to_date": "2026-01-02", "date_from": "2026-01-01T00:00:00"}, "not both"),
    ({"movement_group": "NOPE"}, "Unknown movement_group"),
])
def test_new_parameter_validation(client, admin_headers, params, detail):
    response = client.get(URL, headers=admin_headers, params=params)
    assert response.status_code == 422
    assert detail in response.text


def test_span_of_exactly_366_days_is_accepted(client, admin_headers):
    response = client.get(URL, headers=admin_headers, params={"from_date": "2024-01-01", "to_date": "2024-12-31"})
    assert response.status_code == 200  # 2024 is a leap year: 366 inclusive days


def test_reference_number_length_is_capped(client, admin_headers):
    assert client.get(URL, headers=admin_headers, params={"reference_number": "x" * 101}).status_code == 422


def test_movement_groups_partition_every_written_type_exactly():
    written = {
        "STOCK_IN", "BATCH_IN", "STOCK_OUT_FIFO", "STOCK_OUT_FEFO", "STOCK_ADJUST", "PURCHASE_RECEIPT",
        "TRANSFER_OUT", "TRANSFER_TRANSIT_IN", "TRANSFER_TRANSIT_OUT", "TRANSFER_IN",
        "SALES_SHIPMENT", "SALES_RETURN",
    }
    flattened = [t for types in MOVEMENT_GROUPS.values() for t in types]
    assert len(flattened) == len(set(flattened))
    assert set(flattened) == written


def test_group_type_reference_actor_filters(client, admin_headers, admin_user, warehouse_headers, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "3.000")
    created = _create_request(client, warehouse_headers, product_id=product["id"],
                              observed="3.000", requested="1.000").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200
    pid = product["id"]

    adjustments = _ledger(client, admin_headers, product_id=pid, movement_group="adjustment")["items"]
    assert [i["movement_type"] for i in adjustments] == ["STOCK_ADJUST"]
    assert _ledger(client, admin_headers, product_id=pid, movement_group="IN",
                   movement_type="STOCK_ADJUST")["pagination"]["total_items"] == 0  # AND, not OR
    assert _ledger(client, admin_headers, movement_type="NOPE")["pagination"]["total_items"] == 0  # legacy: no 422

    ref = created["reference_number"]
    assert [i["reference_number"] for i in _ledger(client, admin_headers, reference_number=ref)["items"]] == [ref]
    assert _ledger(client, admin_headers, reference_number=ref.lower())["pagination"]["total_items"] == 0
    assert _ledger(client, admin_headers, reference_number=f"  {ref}  ")["pagination"]["total_items"] == 1

    by_actor = _ledger(client, admin_headers, product_id=pid, actor=admin_user.username)
    assert by_actor["pagination"]["total_items"] == 2  # admin did both the stock-in and the approval
    assert _ledger(client, admin_headers, product_id=pid, actor="nobody-" + uuid4().hex)["items"] == []
    denied = client.get(URL, headers=warehouse_headers, params={"actor": admin_user.username})
    assert denied.status_code == 403


def test_unauthenticated_and_unknown_role_are_rejected(client, db_session):
    assert client.get(URL).status_code == 401
    stranger = _mint(db_session, "stranger", role="viewer")
    assert client.get(URL, headers=_headers(stranger)).status_code == 403


def test_page_query_count_is_bounded_regardless_of_page_size(client, admin_headers, admin_user, warehouse_user,
                                                            db_session):
    product = _create_product(client, admin_headers)
    for i in range(6):
        request = _approved_request(db_session, product_id=product["id"], owner=warehouse_user,
                                    admin=admin_user, notes=f"n{i}")
        _adjust_rows(db_session, product_id=product["id"], actor_id=admin_user.id,
                     remark="r", request=request)

    def statements(page_size):
        seen = []
        listener = lambda *args: seen.append(1)  # noqa: E731
        event.listen(test_engine, "before_cursor_execute", listener)
        try:
            _ledger(client, admin_headers, product_id=product["id"], page_size=page_size)
        finally:
            event.remove(test_engine, "before_cursor_execute", listener)
        return len(seen)

    assert statements(1) == statements(6)


def test_inactive_history_stays_visible_and_filterable(client, admin_headers, db_session):
    product = _create_product(client, admin_headers)
    warehouse = Warehouse(warehouse_code=f"OLD-{uuid4().hex[:6]}", warehouse_name="Closed depot", is_active=True)
    db_session.add(warehouse)
    db_session.flush()
    location = WarehouseLocation(warehouse_id=warehouse.id, location_code="BIN-1", location_name=None)
    db_session.add(location)
    db_session.flush()
    db_session.add(InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id, location_id=location.id,
                                     movement_type="STOCK_IN", quantity=Decimal("2"), balance_before=Decimal("0"),
                                     balance_after=Decimal("2")))
    warehouse.is_active = False
    location.is_active = False
    db_session.get(Product, product["id"]).is_active = False
    db_session.commit()

    items = _ledger(client, admin_headers, warehouse_id=warehouse.id)["items"]
    assert len(items) == 1
    row = items[0]
    assert row["warehouse"]["is_active"] is False and row["warehouse"]["warehouse_name"] == "Closed depot"
    assert row["location"] == {"id": location.id, "location_code": "BIN-1", "location_name": None, "is_active": False}
    assert row["product"]["is_active"] is False


# --------------------------------------------------------------------------- #
# Transfers: stage-specific expectations, no double counting
# --------------------------------------------------------------------------- #
def test_transfer_stages_with_and_without_transit_legs(client, admin_headers, transfer_storage, db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "30.000")
    transactions_before = db_session.query(StockTransaction).filter_by(product_id=product["id"]).count()
    transfer = _create_draft_transfer(client, admin_headers, product["id"], transfer_storage, quantity="30.000")
    item_id = transfer["items"][0]["id"]

    def stage():
        both = _ledger(client, admin_headers, product_id=product["id"], movement_group="TRANSFER")["items"]
        operational = _ledger(client, admin_headers, product_id=product["id"], movement_group="TRANSFER",
                              include_transit="false")["items"]
        for row in both:
            assert row["is_transit_leg"] == row["movement_type"].startswith("TRANSFER_TRANSIT_")
        assert not any(row["is_transit_leg"] for row in operational)
        total = lambda rows: sum(Decimal(r["quantity"]) for r in rows)  # noqa: E731
        return len(both), total(both), len(operational), total(operational)

    assert stage() == (0, 0, 0, 0)  # draft: nothing moves
    _dispatch(client, admin_headers, transfer["id"])
    assert stage() == (2, Decimal("0"), 1, Decimal("-30.000"))
    _receive(client, admin_headers, transfer["id"], [{"transfer_item_id": item_id, "quantity": "10.000"}])
    assert stage() == (4, Decimal("0"), 2, Decimal("-20.000"))
    _receive(client, admin_headers, transfer["id"], [{"transfer_item_id": item_id, "quantity": "20.000"}])
    assert stage() == (6, Decimal("0"), 3, Decimal("0"))

    # API default keeps transit legs (legacy behavior).
    assert _ledger(client, admin_headers, product_id=product["id"],
                   movement_group="TRANSFER")["pagination"]["total_items"] == 6
    # Transfers add no StockTransaction rows; each movement is one physical change.
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == transactions_before
    db_session.expire_all()
    for balance in db_session.query(StockBalance).filter_by(product_id=product["id"]).all():
        moved = sum(
            (m.quantity for m in db_session.query(InventoryMovement).filter_by(
                product_id=product["id"], warehouse_id=balance.warehouse_id,
                location_id=balance.location_id, batch_id=balance.batch_id)),
            Decimal("0"),
        )
        assert moved == balance.on_hand_qty


# --------------------------------------------------------------------------- #
# Timezone: declared storage zone, never the session
# --------------------------------------------------------------------------- #
@pytest.fixture(params=["UTC", "Asia/Bangkok"])
def session_timezone(request):
    """Every new pooled connection runs in the given session TimeZone."""
    zone = request.param

    def set_zone(dbapi_connection, _record):
        with dbapi_connection.cursor() as cursor:
            cursor.execute(f"SET TIME ZONE '{zone}'")

    test_engine.dispose()
    event.listen(test_engine, "connect", set_zone)
    try:
        yield zone
    finally:
        event.remove(test_engine, "connect", set_zone)
        test_engine.dispose()


@pytest.mark.parametrize("declared, rows, kept, occurred", [
    # Storage declared UTC: Bangkok 2026-10-10 starts at 2026-10-09 17:00 naive.
    ("UTC", [datetime(2026, 10, 9, 16, 59, 59), datetime(2026, 10, 9, 17, 0, 0)],
     datetime(2026, 10, 9, 17, 0, 0), "2026-10-09T17:00:00Z"),
    # Storage declared Asia/Bangkok: the same business day starts at 00:00 naive.
    ("Asia/Bangkok", [datetime(2026, 10, 9, 23, 59, 59), datetime(2026, 10, 10, 0, 0, 0)],
     datetime(2026, 10, 10, 0, 0, 0), "2026-10-09T17:00:00Z"),
])
def test_business_day_boundaries_follow_the_declared_zone_under_any_session(
    client, admin_headers, db_session, monkeypatch, session_timezone, declared, rows, kept, occurred,
):
    monkeypatch.setattr(settings, "db_naive_timezone", declared)
    product = _create_product(client, admin_headers)
    warehouse, location = _main_storage(db_session)
    for stamp in rows:
        db_session.add(InventoryMovement(product_id=product["id"], warehouse_id=warehouse.id,
                                         location_id=location.id, movement_type="STOCK_IN",
                                         quantity=Decimal("1"), balance_before=Decimal("0"),
                                         balance_after=Decimal("1"), created_at=stamp))
    db_session.commit()

    items = _ledger(client, admin_headers, product_id=product["id"], from_date="2026-10-10",
                    to_date="2026-10-10")["items"]
    assert [i["created_at"] for i in items] == [kept.isoformat()]  # legacy naive value, untouched
    assert items[0]["occurred_at"] == occurred
    # Both rows are within the inclusive range 2026-10-09..2026-10-10.
    assert _ledger(client, admin_headers, product_id=product["id"], from_date="2026-10-09",
                   to_date="2026-10-10")["pagination"]["total_items"] == 2


# --------------------------------------------------------------------------- #
# Adjustment traceability: Request -> Transaction -> AuditLog
# --------------------------------------------------------------------------- #
def test_nonzero_approval_links_request_transaction_movement_and_audit(client, admin_headers, warehouse_headers,
                                                                        db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "10.000")
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="10.000",
                              requested="7.000", reason_code="LOSS_THEFT", notes="private").json()["data"]
    approved = _approve(client, admin_headers, created["id"]).json()["data"]

    request = db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one()
    transaction = db_session.get(StockTransaction, request.stock_transaction_id)
    assert (transaction.transaction_type, transaction.quantity) == ("ADJUST", Decimal("-3.000"))
    assert approved["stock_transaction_id"] == transaction.id
    movement = db_session.query(InventoryMovement).filter_by(product_id=product["id"],
                                                             movement_type="STOCK_ADJUST").one()
    assert (movement.reference_type, movement.reference_id, movement.reference_number) == (
        "STOCK_ADJUSTMENT_REQUEST", request.id, request.reference_number)
    assert movement.stock_transaction_id == transaction.id
    assert (movement.quantity, movement.balance_before, movement.balance_after) == (
        Decimal("-3.000"), Decimal("10.000"), Decimal("7.000"))
    stock_audit = db_session.query(AuditLog).filter_by(table_name="stock_transactions", record_id=transaction.id,
                                                       action="STOCK_ADJUST").one()
    assert request.reference_number in stock_audit.description
    approve_audit = db_session.query(AuditLog).filter_by(table_name="stock_adjustment_requests",
                                                         record_id=request.id,
                                                         action="APPROVE_ADJUSTMENT_REQUEST").one()
    assert f"stock_transaction_id={transaction.id}" in approve_audit.description

    row = _ledger(client, admin_headers, product_id=product["id"], movement_group="ADJUSTMENT")["items"][0]
    assert row["source"]["type"] == "STOCK_ADJUSTMENT_REQUEST"
    assert row["adjustment"]["request_id"] == request.id and row["adjustment"]["status"] == "APPROVED"


def test_zero_difference_approval_is_traceable_without_a_movement(client, admin_headers, warehouse_headers,
                                                                   db_session):
    product = _create_product(client, admin_headers)
    _stock_in(client, admin_headers, product["id"], "5.000")
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="5.000",
                              requested="5.000").json()["data"]
    assert _approve(client, admin_headers, created["id"]).status_code == 200

    request = db_session.query(StockAdjustmentRequest).filter_by(id=created["id"]).one()
    assert request.status == "APPROVED" and request.stock_transaction_id is not None
    transaction = db_session.get(StockTransaction, request.stock_transaction_id)
    assert (transaction.transaction_type, transaction.quantity) == ("ADJUST", Decimal("0.000"))
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"],
                                                         movement_type="STOCK_ADJUST").count() == 0
    assert db_session.query(AuditLog).filter_by(table_name="stock_transactions", record_id=transaction.id,
                                                action="STOCK_ADJUST").count() == 1
    assert db_session.query(AuditLog).filter_by(table_name="stock_adjustment_requests", record_id=request.id,
                                                action="APPROVE_ADJUSTMENT_REQUEST").count() == 1
    assert _ledger(client, admin_headers, product_id=product["id"],
                   movement_group="ADJUSTMENT")["pagination"]["total_items"] == 0

    findings = diagnose_inventory(test_engine)
    link = next(f for f in findings if f["check"] == "adjustment_request_transaction_link"
                and f["request_id"] == request.id)
    assert link["classification"] == "CONSISTENT" and link["movement_ids"] == []
    tx_link = next(f for f in findings if f["check"] == "transaction_movement_link"
                   and f["transaction_id"] == transaction.id)
    assert tx_link["classification"] == "EXPLAINED"


def test_replayed_approval_never_writes_a_second_transaction(client, admin_headers, warehouse_headers, db_session):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                              requested="2.000").json()["data"]
    key = _key("approve")
    first = _approve(client, admin_headers, created["id"], key=key)
    replay = _approve(client, admin_headers, created["id"], key=key)
    assert first.status_code == replay.status_code == 200
    assert replay.json()["data"] == first.json()["data"]
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"],
                                                        transaction_type="ADJUST").count() == 1
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 1


def test_adjustment_detail_exposes_the_link_only_to_authorized_viewers(client, admin_headers, warehouse_headers,
                                                                        db_session):
    product = _create_product(client, admin_headers)
    created = _create_request(client, warehouse_headers, product_id=product["id"], observed="0.000",
                              requested="1.000").json()["data"]
    _approve(client, admin_headers, created["id"])
    url = f"/api/v1/stock-adjustment-requests/{created['id']}"
    owner = client.get(url, headers=warehouse_headers).json()["data"]
    admin = client.get(url, headers=admin_headers).json()["data"]
    assert owner["stock_transaction_id"] == admin["stock_transaction_id"] is not None
    stranger = _mint(db_session, "detail_stranger")
    assert client.get(url, headers=_headers(stranger)).status_code == 403


# --------------------------------------------------------------------------- #
# Warehouse directory + timezone settings
# --------------------------------------------------------------------------- #
def test_warehouse_directory_tolerates_null_location_names(client, admin_headers, db_session):
    warehouse = Warehouse(warehouse_code=f"NUL-{uuid4().hex[:6]}", warehouse_name="Null-named bins")
    db_session.add(warehouse)
    db_session.flush()
    db_session.add(WarehouseLocation(warehouse_id=warehouse.id, location_code="A1", location_name=None))
    db_session.commit()
    response = client.get("/api/v1/warehouses", headers=admin_headers, params={"active_only": "false"})
    assert response.status_code == 200
    entry = next(w for w in response.json()["data"] if w["id"] == warehouse.id)
    assert entry["locations"][0]["location_name"] is None


def test_naive_timezone_setting_rejects_unknown_zones():
    from zoneinfo import ZoneInfoNotFoundError

    from app.core.config import Settings

    with pytest.raises((ValueError, ZoneInfoNotFoundError)):
        Settings.model_validate({**settings.model_dump(), "db_naive_timezone": "Mars/Olympus"})


def test_session_timezone_pin_is_opt_in(monkeypatch):
    from app import database

    assert settings.db_session_timezone_pin is False
    assert "TimeZone" not in database._build_connect_args()["options"]
    monkeypatch.setattr(settings, "db_session_timezone_pin", True)
    monkeypatch.setattr(settings, "db_naive_timezone", "Asia/Bangkok")
    assert database._build_connect_args()["options"].endswith("-c TimeZone=Asia/Bangkok")
