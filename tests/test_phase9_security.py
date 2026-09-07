"""Phase 9: auth hardening — /auth/me, iat claim, disabled accounts."""
import base64
import json
from datetime import timedelta

from jose import jwt

from app.core.security import ALGORITHM, SECRET_KEY, create_access_token


def _b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def test_auth_me_returns_safe_fields_only(client, admin_headers):
    r = client.get("/api/v1/auth/me", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"id", "username", "role", "is_active"}
    assert body["is_active"] is True
    assert "password_hash" not in body
    assert "token" not in body
    assert "access_token" not in body


def test_auth_me_requires_auth(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_token_carries_iat_and_exp(client, admin_user):
    r = client.post(
        "/api/v1/auth/token",
        data={"username": admin_user.username, "password": "AdminTest123!"},
    )
    token = r.json()["access_token"]
    claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    assert "iat" in claims
    assert "exp" in claims
    assert claims["exp"] > claims["iat"]


def test_disabled_user_is_rejected_through_the_api(client, admin_user, db_session):
    headers = {
        "Authorization": "Bearer "
        + client.post(
            "/api/v1/auth/token",
            data={"username": admin_user.username, "password": "AdminTest123!"},
        ).json()["access_token"]
    }
    assert client.get("/api/v1/products", headers=headers).status_code == 200

    admin_user.is_active = False
    db_session.commit()

    # Existing token no longer works: authorization reloads the DB user.
    assert client.get("/api/v1/products", headers=headers).status_code == 403
    # Fresh login is also refused.
    login = client.post(
        "/api/v1/auth/login",
        json={"username": admin_user.username, "password": "AdminTest123!"},
    )
    assert login.status_code == 403


def test_tampered_and_alg_none_tokens_rejected(client, admin_user):
    good = create_access_token({"sub": str(admin_user.id)})
    # tamper
    assert client.get(
        "/api/v1/products", headers={"Authorization": f"Bearer {good}x"}
    ).status_code == 401
    # alg=none (hand-crafted; decode pins algorithms=["HS256"])
    none_token = _b64({"alg": "none", "typ": "JWT"}) + "." + _b64({"sub": str(admin_user.id)}) + "."
    assert client.get(
        "/api/v1/products", headers={"Authorization": f"Bearer {none_token}"}
    ).status_code == 401
    # expired
    expired = create_access_token({"sub": str(admin_user.id)}, expires_delta=timedelta(seconds=-1))
    assert client.get(
        "/api/v1/products", headers={"Authorization": f"Bearer {expired}"}
    ).status_code == 401
