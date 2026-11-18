"""Create the FIRST administrator of a fresh production database (one-shot).

`POST /auth/register` needs an existing admin, so a freshly migrated database
has no way to log in. This script closes that gap, once:

    docker compose -f compose.prod.yml run --rm --no-deps \
        -e ADMIN_USERNAME=<name> -e ADMIN_PASSWORD \
        api python scripts/create_first_admin.py

(`-e ADMIN_PASSWORD` with no value passes the variable from your shell, so the
password never appears in the command line or shell history if you set it
with `read -s` / `Read-Host -AsSecureString` first.)

Guards:
- refuses when ANY user already exists (it is a bootstrap, not a reset);
- refuses a password shorter than 12 characters or equal to the username;
- never prints the password; exits non-zero on every refusal.
Further users are created by this admin through the app.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# `python scripts/create_first_admin.py` puts scripts/ on sys.path, not the
# project root that holds the `app` package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MIN_PASSWORD_LENGTH = 12


class BootstrapError(Exception):
    pass


def validate(username: str | None, password: str | None) -> tuple[str, str]:
    username = (username or "").strip()
    if not username:
        raise BootstrapError("set ADMIN_USERNAME")
    if len(username) > 100:
        raise BootstrapError("ADMIN_USERNAME must be 100 characters or fewer")
    if not password:
        raise BootstrapError("set ADMIN_PASSWORD (it is read from the environment only)")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise BootstrapError(f"ADMIN_PASSWORD must be at least {MIN_PASSWORD_LENGTH} characters")
    if password.strip().lower() == username.lower():
        raise BootstrapError("ADMIN_PASSWORD must not equal the username")
    return username, password


def create_first_admin(session, username: str, password: str, hasher) -> None:
    """Insert the admin in the caller's transaction; refuse if any user exists."""
    from app.models import User

    if session.query(User.id).first() is not None:
        raise BootstrapError("users already exist — refusing; create further users from the app")
    session.add(User(username=username, password_hash=hasher(password), role="ADMIN", is_active=True))
    session.flush()


def main(env=os.environ) -> int:
    try:
        username, password = validate(env.get("ADMIN_USERNAME"), env.get("ADMIN_PASSWORD"))
    except BootstrapError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    from app.core.security import hash_password
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        create_first_admin(session, username, password, hash_password)
        session.commit()
    except BootstrapError as exc:
        session.rollback()
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    finally:
        session.close()
    print(f"created admin {username!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
