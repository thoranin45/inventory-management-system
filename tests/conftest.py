import os
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

from app.core.security import hash_password
from app.models import Base, User
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db
from app.main import app
from app.models import Base


PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEST_ENV_FILE = PROJECT_ROOT / ".env.test"

load_dotenv(TEST_ENV_FILE)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

if not TEST_DATABASE_URL:
    raise RuntimeError(
        "TEST_DATABASE_URL is missing from .env.test"
    )

if "test" not in TEST_DATABASE_URL.lower():
    raise RuntimeError(
        "Refusing to run tests because the database URL "
        "does not appear to be a test database"
    )


test_engine = create_engine(
    TEST_DATABASE_URL,
    pool_pre_ping=True,
)

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


@pytest.fixture(scope="session", autouse=True)
def prepare_test_database():
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    yield

    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    db = TestingSessionLocal()

    try:
        yield db
    finally:
        db.rollback()
        db.close()


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

    db_session.delete(user)
    db_session.commit()


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