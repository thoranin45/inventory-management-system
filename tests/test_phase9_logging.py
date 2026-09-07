"""Phase 9: structured logging + credential redaction."""
import json
import logging

from app.core.logger import JsonFormatter


def test_json_formatter_emits_valid_json_with_required_keys():
    fmt = JsonFormatter()
    record = logging.LogRecord(
        "inventory_system", logging.INFO, __file__, 10, "REQUEST | ...", (), None
    )
    record.event = "request"
    record.request_id = "abc123"
    record.method = "GET"
    record.path = "/api/v1/products"
    record.status = 200
    record.duration_ms = 12.5
    record.user_id = 7
    record.client_ip = "203.0.113.9"

    payload = json.loads(fmt.format(record))
    for key in ("timestamp", "level", "logger", "message", "request_id",
                "method", "path", "status", "duration_ms", "user_id", "client_ip"):
        assert key in payload
    assert payload["level"] == "INFO"
    assert payload["request_id"] == "abc123"


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record):
        self.records.append(record)


def test_request_log_line_never_contains_credentials(client, admin_user):
    logger = logging.getLogger("inventory_system")
    cap = _Capture()
    prev_level = logger.level
    logger.addHandler(cap)
    logger.setLevel(logging.INFO)
    try:
        r = client.post(
            "/api/v1/auth/login",
            headers={"Authorization": "Bearer super-secret-token-value"},
            json={"username": admin_user.username, "password": "AdminTest123!"},
        )
        assert r.status_code in (200, 403)
    finally:
        logger.removeHandler(cap)
        logger.setLevel(prev_level)

    blob = "\n".join(
        rec.getMessage() + " " + json.dumps(getattr(rec, "__dict__", {}), default=str)
        for rec in cap.records
    )
    assert cap.records, "expected at least one access-log record"
    assert "AdminTest123!" not in blob
    assert "super-secret-token-value" not in blob
    assert "Bearer " not in blob


def test_json_formatter_includes_exception_text_server_side_only():
    fmt = JsonFormatter()
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        import sys

        record = logging.LogRecord(
            "inventory_system", logging.ERROR, __file__, 1, "UNHANDLED", (), sys.exc_info()
        )
    payload = json.loads(fmt.format(record))
    assert "exc_info" in payload
    assert "RuntimeError" in payload["exc_info"]
