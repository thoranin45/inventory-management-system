"""Phase 9: SQLAlchemy engine production-safe configuration."""
import app.database as db
from app.core.config import settings


def test_engine_kwargs_have_pool_safety_defaults():
    kw = db._engine_kwargs
    assert kw["pool_pre_ping"] is True
    assert kw["pool_recycle"] == settings.db_pool_recycle_seconds == 1800
    assert kw["pool_size"] == settings.db_pool_size
    assert kw["max_overflow"] == settings.db_max_overflow
    assert kw["pool_timeout"] == settings.db_pool_timeout_seconds


def test_connect_args_apply_server_side_timeouts():
    args = db._build_connect_args()
    opts = args["options"]
    assert f"statement_timeout={settings.db_statement_timeout_ms}" in opts
    assert f"lock_timeout={settings.db_lock_timeout_ms}" in opts
    assert "idle_in_transaction_session_timeout=" in opts
    assert args["connect_timeout"] == settings.db_connect_timeout_seconds


def test_get_db_rolls_back_on_exception():
    class FakeSession:
        def __init__(self):
            self.rolled_back = False
            self.closed = False

        def rollback(self):
            self.rolled_back = True

        def close(self):
            self.closed = True

    import contextlib

    fake = FakeSession()
    orig = db.SessionLocal
    db.SessionLocal = lambda: fake
    try:
        g = db.get_db()
        next(g)
        with contextlib.suppress(RuntimeError):
            g.throw(RuntimeError("boom"))
    finally:
        db.SessionLocal = orig
    assert fake.rolled_back is True
    assert fake.closed is True
