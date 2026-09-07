from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 1440

    app_name: str = "Inventory Management API"
    app_version: str = "1.0.0"
    env: str = "development"

    # Business calendar used for every inventory expiry decision. Never rely on the
    # process-local date: the deployment runs UTC while the business is UTC+7.
    timezone: str = "Asia/Bangkok"
    # Derived near-expiry window (days). Read-only concept, never persisted.
    near_expiry_days: int = 90

    rate_limit_max_requests: int = 100
    rate_limit_window_seconds: int = 60

    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173"

    class Config:
        env_file = ".env"


settings = Settings()