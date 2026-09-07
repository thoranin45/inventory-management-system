"""Phase 9: production configuration gating."""
import pytest
from pydantic import ValidationError

from app.core.config import AppEnv, Settings

_BASE = dict(
    db_host="db",
    db_port=5432,
    db_name="inventory_db",
    db_user="u",
    db_password="p",
    database_url="postgresql+psycopg2://u:p@db:5432/inventory_db",
)

_STRONG_SECRET = "x7Q2" + "a" * 40  # >= 32 chars, no placeholder fragment


def _settings(**over):
    data = {**_BASE, "secret_key": _STRONG_SECRET, **over}
    return Settings(_env_file=None, **data)


# ---- development / test stay permissive ---------------------------------

def test_development_allows_placeholder_secret_and_localhost_cors():
    s = _settings(env="development", secret_key="example-secret-key")
    assert s.app_env is AppEnv.development
    assert s.is_production is False
    assert s.docs_effective is True


def test_env_aliases_normalise():
    assert _settings(env="prod", secret_key=_STRONG_SECRET,
                     cors_origins="https://app.example.com").app_env is AppEnv.production
    assert _settings(env="dev").app_env is AppEnv.development
    assert _settings(env="ci").app_env is AppEnv.test


# ---- production gate ---------------------------------------------------

def test_production_rejects_short_secret():
    with pytest.raises(ValidationError, match="at least 32"):
        _settings(env="production", secret_key="tooshort",
                  cors_origins="https://app.example.com")


def test_production_rejects_placeholder_secret():
    with pytest.raises(ValidationError, match="example/placeholder"):
        _settings(env="production", secret_key="example-secret-key-padding-1234567890",
                  cors_origins="https://app.example.com")


def test_production_rejects_missing_cors():
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        _settings(env="production", cors_origins="")


def test_production_rejects_wildcard_cors():
    with pytest.raises(ValidationError, match="wildcard"):
        _settings(env="production", cors_origins="*")


def test_production_rejects_non_https_cors():
    with pytest.raises(ValidationError, match="https://"):
        _settings(env="production", cors_origins="http://app.example.com")


def test_production_accepts_strong_config():
    s = _settings(
        env="production",
        secret_key=_STRONG_SECRET,
        cors_origins="https://app.example.com,https://admin.example.com",
    )
    assert s.is_production is True
    assert s.docs_effective is False  # docs disabled in prod by default
    assert s.log_format_effective == "json"
    assert s.cors_origin_list == [
        "https://app.example.com",
        "https://admin.example.com",
    ]
    assert s.access_token_expire_minutes == 720


def test_docs_can_be_explicitly_enabled_in_production():
    s = _settings(env="production", secret_key=_STRONG_SECRET,
                  cors_origins="https://app.example.com", docs_enabled=True)
    assert s.docs_effective is True


def test_cors_method_and_header_lists_default():
    s = _settings()
    assert "OPTIONS" in s.cors_method_list
    assert "Authorization" in s.cors_header_list
    assert "X-Request-ID" in s.cors_header_list


def test_secret_values_not_in_repr():
    s = _settings(env="development")
    assert _STRONG_SECRET not in repr(s)
