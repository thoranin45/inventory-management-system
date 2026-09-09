"""Application SQLAlchemy engine and session factory.

Production-safe pool defaults come from :mod:`app.core.config`. The test suite
does not use this engine (``get_db`` is dependency-overridden), so these
settings only affect the running service.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base  # noqa: F401  (kept for import side effects / callers)
from app.core.config import settings

SQLALCHEMY_DATABASE_URL = settings.database_url


def _build_connect_args() -> dict:
    """psycopg2 connection arguments: fail fast on connect, cap runaway work."""
    server_settings = (
        f"-c statement_timeout={settings.db_statement_timeout_ms} "
        f"-c lock_timeout={settings.db_lock_timeout_ms} "
        f"-c idle_in_transaction_session_timeout="
        f"{settings.db_idle_in_transaction_timeout_ms}"
    )
    args: dict = {"options": server_settings}
    if settings.db_connect_timeout_seconds > 0:
        args["connect_timeout"] = settings.db_connect_timeout_seconds
    return args


_engine_kwargs: dict = {
    "pool_pre_ping": settings.db_pool_pre_ping,
    "pool_recycle": settings.db_pool_recycle_seconds,
    "pool_size": settings.db_pool_size,
    "max_overflow": settings.db_max_overflow,
    "pool_timeout": settings.db_pool_timeout_seconds,
    "hide_parameters": settings.is_production,
}

# Server-side timeouts are a PostgreSQL feature; skip the option string for
# other backends (e.g. a sqlite URL used in a throwaway import check).
if SQLALCHEMY_DATABASE_URL.startswith("postgresql"):
    _engine_kwargs["connect_args"] = _build_connect_args()

engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# Base.metadata.create_all(bind=engine)


def get_db():
    """Yield a request-scoped session.

    A failed request is rolled back before the connection returns to the pool
    so a broken transaction never leaks into the next caller.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
