"""Application configuration with explicit environment semantics.

Three environments are recognised: ``development``, ``test`` and ``production``.
Only ``production`` applies the hardened validation gate (see
``_validate_production_safety``).  Development and test stay convenient and
never fail on placeholder values.

Secret values are never logged or echoed by this module.
"""
from __future__ import annotations

from enum import Enum

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnv(str, Enum):
    development = "development"
    test = "test"
    production = "production"


# Secret values that must never reach a production deployment.
_PLACEHOLDER_SECRETS = {
    "example-secret-key",
    "change_me",
    "changeme",
    "secret",
    "secret_key",
    "your-secret-key",
    "test-secret-key",
    "github-actions-test-secret-key",
}

_PLACEHOLDER_FRAGMENTS = (
    "example",
    "change_me",
    "changeme",
    "placeholder",
    "your-domain",
    "your-secret",
    "dummy",
)

_MIN_PRODUCTION_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Required infrastructure -------------------------------------------
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str = Field(repr=False)

    # Contains credentials; keep it out of reprs / logs.
    database_url: str = Field(repr=False)
    secret_key: str = Field(repr=False)

    # ---- Auth -------------------------------------------------------------
    # Production default is 12 hours; env-overridable.
    access_token_expire_minutes: int = 720

    # ---- Identity -------------------------------------------------------------
    app_name: str = "Inventory Management API"
    app_version: str = "1.0.0"
    env: str = "development"

    # ---- Business calendar --------------------------------------------------
    # Never rely on the process-local date: the deployment runs UTC while the
    # business is UTC+7.
    timezone: str = "Asia/Bangkok"
    near_expiry_days: int = 90

    # ---- Observability ----------------------------------------------------
    log_level: str = "INFO"
    # ``json`` in production, ``text`` (human-readable) otherwise. ``auto``
    # resolves per environment.
    log_format: str = "auto"

    # ---- API surface -----------------------------------------------------
    # ``None`` -> docs are enabled outside production, disabled in production.
    docs_enabled: bool | None = None
    metrics_enabled: bool = False

    # ---- Uploads -------------------------------------------------------------
    max_upload_bytes: int = 5 * 1024 * 1024

    # ---- Rate limiting -------------------------------------------------------
    rate_limit_max_requests: int = 300
    rate_limit_window_seconds: int = 60
    # Stricter bucket for credential endpoints (brute-force protection).
    auth_rate_limit_max_requests: int = 5
    auth_rate_limit_window_seconds: int = 300
    # Number of trusted reverse proxies in front of the app. 0 means the
    # socket peer is the real client; 1 means honour the last X-Forwarded-For
    # hop (nginx). Never trust an arbitrary public X-Forwarded-For.
    trusted_proxy_count: int = 0

    # ---- CORS -------------------------------------------------------------
    cors_origins: str = (
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173"
    )
    cors_allow_methods: str = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    cors_allow_headers: str = (
        "Authorization,Content-Type,Idempotency-Key,X-Request-ID"
    )

    # ---- Database engine tuning (safe V1 defaults) -----------------------
    db_pool_pre_ping: bool = True
    db_pool_recycle_seconds: int = 1800
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout_seconds: int = 10
    db_connect_timeout_seconds: int = 5
    db_statement_timeout_ms: int = 15000
    db_lock_timeout_ms: int = 10000
    db_idle_in_transaction_timeout_ms: int = 30000

    # ------------------------------------------------------------------
    # Normalisation
    # ------------------------------------------------------------------
    @field_validator("env", mode="before")
    @classmethod
    def _normalize_env(cls, value):
        if not isinstance(value, str):
            return value
        alias = value.strip().lower()
        return {
            "dev": "development",
            "develop": "development",
            "local": "development",
            "prod": "production",
            "production": "production",
            "staging": "production",
            "test": "test",
            "testing": "test",
            "ci": "test",
        }.get(alias, alias)

    @field_validator("log_level", mode="before")
    @classmethod
    def _normalize_log_level(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    # ------------------------------------------------------------------
    # Derived accessors
    # ------------------------------------------------------------------
    @property
    def app_env(self) -> AppEnv:
        try:
            return AppEnv(self.env)
        except ValueError:
            return AppEnv.development

    @property
    def is_production(self) -> bool:
        return self.app_env is AppEnv.production

    @property
    def is_development(self) -> bool:
        return self.app_env is AppEnv.development

    @property
    def is_test(self) -> bool:
        return self.app_env is AppEnv.test

    @property
    def docs_effective(self) -> bool:
        if self.docs_enabled is not None:
            return self.docs_enabled
        return not self.is_production

    @property
    def log_format_effective(self) -> str:
        if self.log_format and self.log_format.lower() != "auto":
            return self.log_format.lower()
        return "text" if self.is_development else "json"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_method_list(self) -> list[str]:
        return [m.strip() for m in self.cors_allow_methods.split(",") if m.strip()]

    @property
    def cors_header_list(self) -> list[str]:
        return [h.strip() for h in self.cors_allow_headers.split(",") if h.strip()]

    # ------------------------------------------------------------------
    # Production safety gate
    # ------------------------------------------------------------------
    @model_validator(mode="after")
    def _validate_production_safety(self) -> "Settings":
        if self.app_env is not AppEnv.production:
            return self

        errors: list[str] = []

        secret = self.secret_key or ""
        lowered = secret.lower()
        if not secret:
            errors.append("SECRET_KEY is required in production")
        elif len(secret) < _MIN_PRODUCTION_SECRET_LENGTH:
            errors.append(
                "SECRET_KEY must be at least "
                f"{_MIN_PRODUCTION_SECRET_LENGTH} characters in production"
            )
        elif lowered in _PLACEHOLDER_SECRETS or any(
            fragment in lowered for fragment in _PLACEHOLDER_FRAGMENTS
        ):
            errors.append(
                "SECRET_KEY looks like an example/placeholder value; "
                "generate a strong random secret for production"
            )

        origins = self.cors_origin_list
        if not origins:
            errors.append(
                "CORS_ORIGINS must list the explicit production frontend "
                "origin(s)"
            )
        if "*" in origins:
            errors.append(
                "CORS_ORIGINS must not use the wildcard '*' in production "
                "(credentials are enabled)"
            )
        insecure = [
            o for o in origins
            if not o.startswith("https://")
            and not o.startswith("http://localhost")
            and not o.startswith("http://127.0.0.1")
        ]
        if insecure:
            errors.append(
                "Production CORS origins must use https:// "
                f"(offending: {insecure})"
            )

        if errors:
            raise ValueError(
                "Insecure production configuration:\n- " + "\n- ".join(errors)
            )

        return self


settings = Settings()
