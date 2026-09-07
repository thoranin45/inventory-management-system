"""Application logger.

- Production: structured JSON lines on stdout (12-factor; the platform handles
  rotation and shipping).
- Development / test: human-readable lines, plus a rotating file for
  convenience.

The formatter never emits secrets. Callers pass structured fields via
``logger.info(msg, extra={"event": ..., "request_id": ...})`` and the JSON
formatter promotes a known allow-list of those keys to top-level fields.
"""
import json
import logging
import os
from logging.handlers import RotatingFileHandler

from app.core.config import settings


LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "app.log")

# Structured keys the request logger / handlers may attach via ``extra=``.
_STRUCTURED_KEYS = (
    "event",
    "request_id",
    "method",
    "path",
    "query",
    "status",
    "duration_ms",
    "user_id",
    "client_ip",
    "error_type",
    "route",
)

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in _STRUCTURED_KEYS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        # Any other explicitly-attached extras (never argv/env/secrets).
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key not in payload and key not in (
                "event", "request_id", "method", "path", "query", "status",
                "duration_ms", "user_id", "client_ip", "error_type", "route",
            ):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


_TEXT_FORMAT = "%(asctime)s | %(levelname)s | %(message)s"


def _resolve_level() -> int:
    return getattr(logging, str(settings.log_level).upper(), logging.INFO)


logger = logging.getLogger("inventory_system")
logger.setLevel(_resolve_level())
logger.propagate = False


if not logger.handlers:
    if settings.log_format_effective == "json":
        formatter: logging.Formatter = JsonFormatter()
    else:
        formatter = logging.Formatter(_TEXT_FORMAT)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # A rotating file is a bare-metal / local convenience only. Containers log
    # to stdout.
    if not settings.is_production:
        os.makedirs(LOG_DIR, exist_ok=True)
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
