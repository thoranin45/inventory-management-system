"""V1-H3: a sales return with a long (but valid) reason must not fail.

The return writes ``Return from {so_number}. Reason: {reason}`` into
``stock_transactions.remark`` and ``inventory_movements.remark``. ``reason`` is
validated to at most 255 characters and ``so_number`` is up to 100, so the text
can reach 377 characters. ``stock_transactions.remark`` was VARCHAR(255): such a
return raised a database error and rolled back. It is TEXT since ec1a00000001;
nothing is truncated.
"""
from uuid import uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import DataError

from app.main import app
from app.models import InventoryMovement, SalesOrder, StockTransaction
from app.repositories.stock_balance_repository import StockBalanceRepository
from tests.database_support import migration_config
from tests.test_migrations import migration_engine, upgrade  # noqa: F401  (fixture reuse)
from tests.test_v1h1_return_idempotency import _item, _return, _shipped, _state

MAX_REASON = 255  # SalesReturnItemCreate.reason max_length
LONGEST_SO_NUMBER = 100  # SalesOrder.so_number String(100)


def _expected_remark(so_number, reason):
    return f"Return from {so_number}. Reason: {reason}"


def _stored_remarks(db, order_id, product_id):
    db.expire_all()
    transactions = [t.remark for t in db.query(StockTransaction).filter_by(
        product_id=product_id, transaction_type="SALE_RETURN").order_by(StockTransaction.id)]
    movements = [m.remark for m in db.query(InventoryMovement).filter_by(
        movement_type="SALES_RETURN", reference_id=order_id, product_id=product_id).order_by(InventoryMovement.id)]
    return transactions, movements


@pytest.mark.parametrize("batch", [True, False])
@pytest.mark.parametrize("reason", ["R" * MAX_REASON, "ค" * MAX_REASON], ids=["ascii", "thai"])
def test_maximum_length_reason_is_stored_in_full(client, admin_headers, db_session, batch, reason):
    order_id, product_id = _shipped(client, admin_headers, batch=batch)
    so_number = db_session.get(SalesOrder, order_id).so_number
    before = _state(db_session, order_id, product_id)

    response = _return(client, admin_headers, order_id, [_item(product_id, 2, reason=reason)], uuid4().hex)
    assert response.status_code == 200, response.text

    expected = _expected_remark(so_number, reason)
    assert len(expected) > 255  # the case that used to fail
    transactions, movements = _stored_remarks(db_session, order_id, product_id)
    assert transactions == [expected]  # full text, no truncation
    assert movements and all(m == expected for m in movements)
    assert _state(db_session, order_id, product_id)["on_hand"] == before["on_hand"] + 2


def test_longest_order_number_with_longest_reason_is_the_upper_bound(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers, batch=False)
    order = db_session.get(SalesOrder, order_id)
    order.so_number = ("SO-" + uuid4().hex.upper() * 4)[:LONGEST_SO_NUMBER]
    db_session.commit()
    reason = "x" * MAX_REASON

    response = _return(client, admin_headers, order_id, [_item(product_id, 1, reason=reason)], uuid4().hex)
    assert response.status_code == 200, response.text
    expected = _expected_remark(order.so_number, reason)
    assert len(expected) == len("Return from ") + LONGEST_SO_NUMBER + len(". Reason: ") + MAX_REASON == 377
    transactions, movements = _stored_remarks(db_session, order_id, product_id)
    assert transactions == [expected] and movements == [expected]

    # The remark-prefix lookup that caps returns still finds this return.
    second = _return(client, admin_headers, order_id, [_item(product_id, 1, reason=reason)], uuid4().hex)
    assert second.status_code == 200
    returned = second.json()["data"]["returned_items"][0]
    assert str(returned["previously_returned"]) == "1" and str(returned["total_returned"]) == "2"


def test_reason_longer_than_the_contract_is_rejected_not_truncated(client, admin_headers, db_session):
    order_id, product_id = _shipped(client, admin_headers)
    before = _state(db_session, order_id, product_id)
    response = _return(client, admin_headers, order_id, [_item(product_id, 1, reason="R" * (MAX_REASON + 1))],
                       uuid4().hex)
    assert response.status_code == 422  # request contract unchanged
    assert _state(db_session, order_id, product_id) == before


def test_failure_after_a_long_remark_rolls_everything_back(admin_headers, db_session, monkeypatch):
    with TestClient(app) as setup:
        order_id, product_id = _shipped(setup, admin_headers)
    before = _state(db_session, order_id, product_id)
    key = uuid4().hex
    long_reason = "R" * MAX_REASON

    def explode(self, product_id, actor):
        raise RuntimeError("simulated failure after the remark rows were written")
    with monkeypatch.context() as patch:
        patch.setattr(StockBalanceRepository, "sync_aggregates", explode)
        with TestClient(app, raise_server_exceptions=False) as failing:
            response = _return(failing, admin_headers, order_id, [_item(product_id, 1, reason=long_reason)], key)
    assert response.status_code == 500
    assert _state(db_session, order_id, product_id) == before
    assert _stored_remarks(db_session, order_id, product_id) == ([], [])

    with TestClient(app) as retrying:
        assert _return(retrying, admin_headers, order_id, [_item(product_id, 1, reason=long_reason)],
                       key).status_code == 200
    assert _state(db_session, order_id, product_id)["transactions"] == before["transactions"] + 1


# --------------------------------------------------------------------------------------------
# Migration ec1a00000001
# --------------------------------------------------------------------------------------------
PRE = "eb1a00000001"
REVISION = "ec1a00000001"
LONG = "Return from SO-000001. Reason: " + "R" * 255  # 286 characters


def _insert_remark(connection, remark):
    connection.execute(text("INSERT INTO stock_transactions(transaction_type, quantity, remark) "
                            "VALUES ('SALE_RETURN', 1, :r)"), {"r": remark})


def _remark_type(connection):
    return next(c for c in inspect(connection).get_columns("stock_transactions") if c["name"] == "remark")["type"]


def test_before_the_migration_a_long_remark_is_rejected(migration_engine):
    upgrade(migration_engine, PRE)
    with pytest.raises(DataError):
        with migration_engine.begin() as connection:
            _insert_remark(connection, LONG)


def test_upgrade_widens_to_text_without_touching_existing_rows(migration_engine):
    upgrade(migration_engine, PRE)
    with migration_engine.begin() as connection:
        _insert_remark(connection, "Return from SO-000001. Reason: short")
    upgrade(migration_engine, REVISION)
    with migration_engine.begin() as connection:
        assert type(_remark_type(connection)).__name__ == "TEXT"
        assert connection.scalar(text("SELECT remark FROM stock_transactions")) == \
            "Return from SO-000001. Reason: short"
        _insert_remark(connection, LONG)
        assert connection.scalar(text("SELECT max(char_length(remark)) FROM stock_transactions")) == len(LONG)
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION


def test_downgrade_refuses_to_truncate_long_remarks(migration_engine):
    upgrade(migration_engine, REVISION)
    with migration_engine.begin() as connection:
        _insert_remark(connection, LONG)
    with pytest.raises(RuntimeError, match="Refusing to downgrade ec1a00000001"):
        with migration_engine.begin() as connection:
            command.downgrade(migration_config(connection), PRE)
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert connection.scalar(text("SELECT remark FROM stock_transactions")) == LONG


def test_downgrade_restores_varchar_255_when_every_remark_fits(migration_engine):
    upgrade(migration_engine, REVISION)
    with migration_engine.begin() as connection:
        _insert_remark(connection, "Return from SO-000001. Reason: short")
    with migration_engine.begin() as connection:
        command.downgrade(migration_config(connection), PRE)
    with migration_engine.connect() as connection:
        remark_type = _remark_type(connection)
        assert type(remark_type).__name__ == "VARCHAR" and remark_type.length == 255
        assert connection.scalar(text("SELECT remark FROM stock_transactions")) == \
            "Return from SO-000001. Reason: short"
