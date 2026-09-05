import asyncio
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_current_user, verify_password
from app.core import exception_handler
from app.core.exceptions import AppException
from app.main import app
from app.models import AuditLog, InventoryMovement, Product, StockBalance, StockTransaction, User
from app.repositories.inventory_movement_repository import InventoryMovementRepository
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.repositories.stock_repository import StockRepository
from app.schemas.stock_schema import StockAdjust
from app.services.stock_service import stock_adjust_service
from app.routers.auth_router import authenticate_user
from tests.test_stock import _create_product


# Include every business route, including aliases, exports, labels, and invoices.
# Expectations below are independent of the application's dependency declarations.
PUBLIC_PATHS = {"/api/v1/auth/login", "/api/v1/auth/token", "/api/v1/health/"}
BUSINESS_ROUTES = sorted({
    (method, route.path)
    for route in app.routes
    if isinstance(route, APIRoute)
    and route.path.startswith("/api/v1/")
    and route.path not in PUBLIC_PATHS
    for method in route.methods
})


def _admin_only(method: str, path: str) -> bool:
    if path.startswith("/api/v1/audit-logs") or path == "/api/v1/auth/register":
        return True
    if method == "GET":
        return False
    if any(path.startswith(f"/api/v1/{resource}") for resource in (
        "products", "categories", "customers", "suppliers", "stock-balances",
    )):
        return True
    if path.startswith("/api/v1/purchase-orders"):
        return not path.endswith("/receive")
    return path == "/api/v1/sales-orders/"


def _missing_resource_url(path: str) -> str:
    import re

    return re.sub(
        r"\{([^}]+)\}",
        lambda match: "999999999" if match[1].endswith("id") else "phase1-missing",
        path,
    )


@pytest.mark.parametrize("method,path", BUSINESS_ROUTES)
def test_business_routes_reject_anonymous(client: TestClient, method: str, path: str):
    response = client.request(method, _missing_resource_url(path))
    assert response.status_code == 401, (method, path, response.text)
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method,path", BUSINESS_ROUTES)
def test_business_route_permission_matrix(
    client: TestClient, admin_headers, warehouse_headers, method: str, path: str,
):
    # Missing resources/bodies safely exercise authorization without mutations.
    url = _missing_resource_url(path)
    admin_response = client.request(method, url, headers=admin_headers)
    assert admin_response.status_code in {200, 404, 422}, (method, path, admin_response.text)
    warehouse_response = client.request(method, url, headers=warehouse_headers)
    expected = 403 if _admin_only(method, path) else admin_response.status_code
    assert warehouse_response.status_code == expected, (method, path, warehouse_response.text)


@pytest.mark.parametrize("role", ["ADMIN", "WAREHOUSE", "admin", "warehouse"])
def test_admin_registers_only_supported_roles(client, admin_headers, db_session, role):
    username = f"registered_{uuid4().hex[:12]}"
    response = client.post("/api/v1/auth/register", headers=admin_headers, json={
        "username": username, "password": "RegisterTest123!", "role": role,
    })
    assert response.status_code == 201
    assert response.json()["data"]["role"] == role.upper()
    assert "password" not in response.text
    user = db_session.query(User).filter_by(username=username).one()
    assert user.role == role.upper()
    assert verify_password("RegisterTest123!", user.password_hash)


@pytest.mark.parametrize("role", ["SUPERADMIN", "viewer", "", None])
def test_registration_rejects_unknown_roles(client, admin_headers, db_session, role):
    username = f"rejected_{uuid4().hex[:12]}"
    response = client.post("/api/v1/auth/register", headers=admin_headers, json={
        "username": username, "password": "RegisterTest123!", "role": role,
    })
    assert response.status_code == 422
    assert db_session.query(User).filter_by(username=username).first() is None


@pytest.mark.parametrize("headers_fixture,expected", [(None, 401), ("warehouse_headers", 403)])
def test_registration_cannot_self_grant_admin(client, db_session, request, headers_fixture, expected):
    username = f"escalation_{uuid4().hex[:12]}"
    headers = request.getfixturevalue(headers_fixture) if headers_fixture else {}
    response = client.post("/api/v1/auth/register", headers=headers, json={
        "username": username, "password": "RegisterTest123!", "role": "ADMIN",
    })
    assert response.status_code == expected
    assert db_session.query(User).filter_by(username=username).first() is None


@pytest.mark.parametrize("password", ["", "a" * 73, "\u0e01" * 25])
def test_registration_password_validation(client, admin_headers, password):
    response = client.post("/api/v1/auth/register", headers=admin_headers, json={
        "username": f"password_{uuid4().hex[:12]}", "password": password, "role": "ADMIN",
    })
    assert response.status_code == 422


@pytest.mark.parametrize("endpoint", ["token", "login"])
@pytest.mark.parametrize("account_state", ["unsupported_role", "inactive"])
def test_login_rejects_unauthorized_accounts(client, admin_user, db_session, endpoint, account_state):
    if account_state == "unsupported_role":
        admin_user.role = "VIEWER"
    else:
        # User has no persisted is_active column yet; exercise the optional guard directly.
        admin_user.is_active = False
        db = Mock()
        db.query.return_value.filter.return_value.first.return_value = admin_user
        with pytest.raises(HTTPException) as error:
            authenticate_user(db, admin_user.username, "AdminTest123!")
        assert error.value.status_code == 403
        return
    db_session.commit()
    credentials = {"username": admin_user.username, "password": "AdminTest123!"}
    response = client.post(
        f"/api/v1/auth/{endpoint}",
        **({"data": credentials} if endpoint == "token" else {"json": credentials}),
    )
    assert response.status_code == 403
    assert "access_token" not in response.json()


@pytest.mark.parametrize("state,expected", [
    ("invalid", 401), ("expired", 401), ("deleted", 401),
    ("inactive", 403), ("unsupported_role", 403),
])
def test_existing_tokens_do_not_bypass_account_checks(client, admin_user, db_session, state, expected):
    token = create_access_token(
        {"sub": str(admin_user.id)},
        expires_delta=timedelta(seconds=-1) if state == "expired" else timedelta(minutes=5),
    )
    if state == "invalid":
        token = "invalid-token"
    elif state == "deleted":
        db_session.delete(admin_user)
    elif state == "inactive":
        # This optional guard cannot be exercised through a new database session yet.
        admin_user.is_active = False
        db = Mock()
        db.get.return_value = admin_user
        with pytest.raises(HTTPException) as error:
            get_current_user(token, db)
        assert error.value.status_code == expected
        return
    elif state == "unsupported_role":
        admin_user.role = "VIEWER"
    db_session.commit()
    response = client.get("/api/v1/products", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == expected


def test_role_change_revokes_admin_access_for_existing_token(client, admin_user, admin_headers, db_session):
    admin_user.role = "WAREHOUSE"
    db_session.commit()
    response = client.post("/api/v1/products", headers=admin_headers)
    assert response.status_code == 403
    response = client.get("/api/v1/products", headers=admin_headers)
    assert response.status_code == 200


@pytest.mark.parametrize("reason", [None, "", "  \t\n ", "x" * 256, "missing"])
def test_stock_adjust_requires_reason_without_mutation(client, admin_headers, db_session, reason):
    product = _create_product(client, admin_headers)
    payload = {"product_id": product["id"], "new_quantity": "5.000"}
    if reason != "missing":
        payload["remark"] = reason
    response = client.post("/api/v1/stock/adjust", headers=admin_headers, json=payload)
    assert response.status_code == 422
    db_session.expire_all()
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("0")
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"], transaction_type="ADJUST").count() == 0
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 0


@pytest.mark.parametrize("actor_fixture,headers_fixture", [
    ("admin_user", "admin_headers"), ("warehouse_user", "warehouse_headers"),
])
@pytest.mark.parametrize("new_quantity", ["15.000", "5.000", "10.000"])
def test_adjustment_records_reason_and_authenticated_actor(
    client, admin_headers, db_session, request, actor_fixture, headers_fixture, new_quantity,
):
    actor = request.getfixturevalue(actor_fixture)
    headers = request.getfixturevalue(headers_fixture)
    product = _create_product(client, admin_headers)
    response = client.post("/api/v1/stock/in", headers=headers, json={
        "product_id": product["id"], "quantity": "10.000", "remark": "Prepare adjustment",
    })
    assert response.status_code == 200
    response = client.post("/api/v1/stock/adjust", headers=headers, json={
        "product_id": product["id"], "new_quantity": new_quantity,
        "remark": "  Physical count verified  ", "created_by_user_id": 999999999,
    })
    assert response.status_code == 200
    db_session.expire_all()
    transaction = db_session.query(StockTransaction).filter_by(
        product_id=product["id"], transaction_type="ADJUST",
    ).one()
    assert transaction.remark == "Physical count verified"
    assert transaction.quantity == Decimal(new_quantity) - Decimal("10")
    audit = db_session.query(AuditLog).filter_by(
        action="STOCK_ADJUST", table_name="stock_transactions", record_id=transaction.id,
    ).one()
    assert audit.username == actor.username
    assert f"actor_id={actor.id};" in audit.description
    assert "before=10.000;" in audit.description
    assert f"after={new_quantity};" in audit.description
    assert "reason=Physical count verified" in audit.description
    assert db_session.get(Product, product["id"]).stock_qty == Decimal(new_quantity)
    balance = db_session.query(StockBalance).filter_by(product_id=product["id"], batch_id=None).one()
    assert balance.on_hand_qty == Decimal(new_quantity)
    movements = db_session.query(InventoryMovement).filter_by(
        product_id=product["id"], movement_type="STOCK_ADJUST",
    ).all()
    if new_quantity == "10.000":
        assert movements == []
    else:
        assert len(movements) == 1
        assert movements[0].created_by_user_id == actor.id
        assert movements[0].reference_id == transaction.id
        assert movements[0].remark == transaction.remark
        assert movements[0].quantity == transaction.quantity


@pytest.mark.parametrize("actor_id", [None, 999999999])
def test_adjustment_missing_actor_rolls_back(client, admin_headers, db_session, actor_id):
    product = _create_product(client, admin_headers)
    with pytest.raises(ValueError, match="Authenticated adjustment actor is required"):
        stock_adjust_service(
            db=db_session, stock_repo=StockRepository(db_session),
            balance_repo=StockBalanceRepository(db_session),
            movement_repo=InventoryMovementRepository(db_session),
            data=StockAdjust(product_id=product["id"], new_quantity=5, remark="Count correction"),
            created_by_user_id=actor_id,
        )
    db_session.expire_all()
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("0")
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 0


def test_adjustment_ledger_failure_rolls_back_audit_and_stock(
    client, admin_headers, admin_user, db_session, monkeypatch,
):
    product = _create_product(client, admin_headers)
    audit_count = db_session.query(AuditLog).count()
    movement_repo = InventoryMovementRepository(db_session)
    monkeypatch.setattr(movement_repo, "create", Mock(side_effect=RuntimeError("Ledger unavailable")))
    with pytest.raises(RuntimeError, match="Ledger unavailable"):
        stock_adjust_service(
            db=db_session, stock_repo=StockRepository(db_session),
            balance_repo=StockBalanceRepository(db_session), movement_repo=movement_repo,
            data=StockAdjust(product_id=product["id"], new_quantity=5, remark="Count correction"),
            created_by_user_id=admin_user.id,
        )
    db_session.expire_all()
    assert db_session.get(Product, product["id"]).stock_qty == Decimal("0")
    assert db_session.query(StockBalance).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(StockTransaction).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(InventoryMovement).filter_by(product_id=product["id"]).count() == 0
    assert db_session.query(AuditLog).count() == audit_count


@pytest.mark.parametrize("kind", ["business", "http", "validation", "integrity"])
def test_exception_logs_exclude_request_and_database_values(monkeypatch, kind):
    secret = "phase1-sensitive-value"
    request = Request({
        "type": "http", "path": f"/products/{secret}", "headers": [],
        "route": SimpleNamespace(path="/products/{product_id}"),
    })
    logger = Mock()
    monkeypatch.setattr(exception_handler, "logger", logger)
    handlers = {
        "business": (exception_handler.app_exception_handler, AppException(secret)),
        "http": (exception_handler.http_exception_handler, HTTPException(400, secret)),
        "validation": (exception_handler.validation_exception_handler, RequestValidationError([
            {"type": "value_error", "loc": ("body", "password"), "msg": secret, "input": secret},
        ])),
        "integrity": (exception_handler.integrity_error_handler, IntegrityError(
            f"INSERT {secret}", {"password": secret}, Exception(secret),
        )),
    }
    handler, error = handlers[kind]
    asyncio.run(handler(request, error))
    logger.warning.assert_called_once()
    assert "/products/{product_id}" in str(logger.warning.call_args)
    assert secret not in str(logger.mock_calls)
    logger.exception.assert_not_called()
