import logging
import os
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import text
from alembic import command
from tests.database_support import make_schema_engine, migration_config
from sqlalchemy.orm import Session, sessionmaker

# Keep test logging out of the production logs directory.
logging.getLogger("inventory_system").addHandler(logging.NullHandler())

from app.core.security import hash_password
from app.database import get_db
from app.main import app
from app.models import (
    Base,
    User,
    Warehouse,
    WarehouseLocation,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEST_ENV_FILE = PROJECT_ROOT / ".env.test"

load_dotenv(TEST_ENV_FILE)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

if not TEST_DATABASE_URL:
    raise RuntimeError(
        "TEST_DATABASE_URL is missing from .env.test"
    )

TEST_SCHEMA = "test_" + uuid4().hex
test_engine = make_schema_engine(TEST_DATABASE_URL, TEST_SCHEMA)

TestingSessionLocal = sessionmaker(
    bind=test_engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def override_get_db() -> Generator[Session, None, None]:
    db = TestingSessionLocal()

    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


def seed_test_foundation() -> None:
    db = TestingSessionLocal()

    try:
        warehouse = (
            db.query(Warehouse)
            .filter(
                Warehouse.warehouse_code == "MAIN"
            )
            .first()
        )

        if warehouse is None:
            warehouse = Warehouse(
                warehouse_code="MAIN",
                warehouse_name="Main Warehouse",
                warehouse_type="MAIN",
                is_active=True,
            )

            db.add(warehouse)
            db.flush()

        location = (
            db.query(WarehouseLocation)
            .filter(
                WarehouseLocation.warehouse_id
                == warehouse.id,
                WarehouseLocation.location_code
                == "DEFAULT",
            )
            .first()
        )

        if location is None:
            location = WarehouseLocation(
                warehouse_id=warehouse.id,
                location_code="DEFAULT",
                location_name="Default Location",
                location_type="STORAGE",
                is_active=True,
            )

            db.add(location)

        db.commit()

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@pytest.fixture(
    scope="session",
    autouse=True,
)
def prepare_test_database():
    try:
        with test_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{TEST_SCHEMA}"'))
            command.upgrade(migration_config(connection), "head")
        seed_test_foundation()
        yield
    finally:
        with test_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE'))
        test_engine.dispose()


@pytest.fixture(autouse=True)
def isolated_generated_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Keep report, invoice, and image output inside each test's temp directory."""
    monkeypatch.chdir(tmp_path)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    db = TestingSessionLocal()

    try:
        yield db
    finally:
        db.rollback()
        db.close()


@pytest.fixture
def business_date(monkeypatch):
    """Deterministically pin the business calendar for Phase 7 expiry tests.

    Patches ``app.core.batch_eligibility.business_today`` — the single function
    every expiry decision routes through, directly or via ``is_expired`` /
    ``is_batch_eligible``. Never manipulates the system clock.
    """
    import app.core.batch_eligibility as be

    state = {"today": be.business_today()}
    monkeypatch.setattr(be, "business_today", lambda: state["today"])

    def _set(value):
        state["today"] = value
        return value

    _set.get = lambda: state["today"]
    return _set


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin_user(
    db_session: Session,
) -> User:
    username = f"admin_test_{uuid4().hex[:8]}"

    user = User(
        username=username,
        password_hash=hash_password(
            "AdminTest123!"
        ),
        role="admin",
    )

    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    yield user


@pytest.fixture
def admin_headers(
    client: TestClient,
    admin_user: User,
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/token",
        data={
            "username": admin_user.username,
            "password": "AdminTest123!",
        },
    )

    assert response.status_code == 200

    body = response.json()

    access_token = body["access_token"]

    return {
        "Authorization": (
            f"Bearer {access_token}"
        )
    }


@pytest.fixture
def warehouse_user(db_session: Session) -> User:
    user = User(
        username=f"warehouse_test_{uuid4().hex[:8]}",
        password_hash=hash_password("WarehouseTest123!"),
        role="WAREHOUSE",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def warehouse_headers(
    client: TestClient,
    warehouse_user: User,
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/token",
        data={
            "username": warehouse_user.username,
            "password": "WarehouseTest123!",
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin_client(admin_headers: dict[str, str]) -> Generator[TestClient, None, None]:
    with TestClient(app, headers=admin_headers) as test_client:
        yield test_client


@pytest.fixture
def warehouse_client(
    warehouse_headers: dict[str, str],
) -> Generator[TestClient, None, None]:
    with TestClient(app, headers=warehouse_headers) as test_client:
        yield test_client
