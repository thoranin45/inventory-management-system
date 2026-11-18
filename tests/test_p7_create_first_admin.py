"""P7: the one-shot first-admin bootstrap for a fresh production database."""
import uuid

import pytest

from app.core.security import verify_password
from app.models import User
from scripts.create_first_admin import (
    BootstrapError,
    create_first_admin,
    main,
    validate,
)
from tests.conftest import TestingSessionLocal

GOOD = "correct-horse-battery"


@pytest.mark.parametrize(
    "username,password,why",
    [
        (None, GOOD, "ADMIN_USERNAME"),
        ("   ", GOOD, "ADMIN_USERNAME"),
        ("x" * 101, GOOD, "100 characters"),
        ("owner", None, "ADMIN_PASSWORD"),
        ("owner", "short", "at least 12"),
        ("administrator", "Administrator", "must not equal"),
    ],
)
def test_validate_refuses_bad_input(username, password, why):
    with pytest.raises(BootstrapError, match=why):
        validate(username, password)


def test_validate_trims_the_username():
    assert validate("  owner ", GOOD) == ("owner", GOOD)


class _Query:
    def __init__(self, existing):
        self.existing = existing

    def first(self):
        return self.existing


class _Session:
    def __init__(self, existing=None):
        self.existing = existing
        self.added = []

    def query(self, *_):
        return _Query(self.existing)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass


def test_creates_one_active_admin_with_a_hashed_password():
    session = _Session()
    create_first_admin(session, "owner", GOOD, lambda p: f"hashed:{p}")
    [user] = session.added
    assert (user.username, user.role, user.is_active) == ("owner", "ADMIN", True)
    assert user.password_hash == f"hashed:{GOOD}"


def test_refuses_when_any_user_exists():
    session = _Session(existing=(1,))
    with pytest.raises(BootstrapError, match="already exist"):
        create_first_admin(session, "owner", GOOD, lambda p: p)
    assert session.added == []


def test_main_refuses_on_a_database_that_already_has_users(capsys):
    db = TestingSessionLocal()
    try:
        if db.query(User.id).first() is None:
            db.add(User(username=f"seed-{uuid.uuid4().hex[:8]}", password_hash="x", role="WAREHOUSE"))
            db.commit()
        name = f"boot-{uuid.uuid4().hex[:8]}"
        assert main({"ADMIN_USERNAME": name, "ADMIN_PASSWORD": GOOD}) == 2
        assert db.query(User).filter(User.username == name).first() is None
    finally:
        db.close()
    err = capsys.readouterr().err
    assert "already exist" in err
    assert GOOD not in err


def test_main_never_prints_the_password_on_refusal(capsys):
    assert main({"ADMIN_USERNAME": "owner", "ADMIN_PASSWORD": "tiny-secret"}) == 2
    out = capsys.readouterr()
    assert "tiny-secret" not in out.out + out.err


def test_hash_is_verifiable_with_the_app_hasher():
    from app.core.security import hash_password

    session = _Session()
    create_first_admin(session, "owner", GOOD, hash_password)
    assert verify_password(GOOD, session.added[0].password_hash)
