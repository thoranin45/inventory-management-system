"""Tiny in-process metrics. No external dependency, no client library.

Deliberately low-cardinality: HTTP counters are keyed by method + status
class only (never by path/id), so the series count stays bounded. Business
counters are opt-in via :func:`inc` and must likewise use static names.

Exposed at ``GET /metrics`` (admin-only) in Prometheus text format.
"""
from __future__ import annotations

import threading

_lock = threading.Lock()

# method+class -> count
_http_requests: dict[tuple[str, str], int] = {}
_http_duration_sum: float = 0.0
_http_duration_count: int = 0
# static-name business counters
_counters: dict[str, int] = {}


def _status_class(status_code: int) -> str:
    return f"{status_code // 100}xx"


def observe_request(method: str, status_code: int, duration_seconds: float) -> None:
    global _http_duration_sum, _http_duration_count
    key = (method.upper(), _status_class(status_code))
    with _lock:
        _http_requests[key] = _http_requests.get(key, 0) + 1
        _http_duration_sum += duration_seconds
        _http_duration_count += 1


def inc(name: str, amount: int = 1) -> None:
    """Increment a static-named business counter (e.g. ``stock_conflict``)."""
    with _lock:
        _counters[name] = _counters.get(name, 0) + amount


def _pool_lines() -> list[str]:
    try:
        from app.database import engine

        pool = engine.pool
        return [
            f'db_pool_checked_out {getattr(pool, "checkedout", lambda: 0)()}',
            f'db_pool_size {getattr(pool, "size", lambda: 0)()}',
            f'db_pool_overflow {getattr(pool, "overflow", lambda: 0)()}',
        ]
    except Exception:
        return []


def render() -> str:
    with _lock:
        requests = dict(_http_requests)
        duration_sum = _http_duration_sum
        duration_count = _http_duration_count
        counters = dict(_counters)

    lines: list[str] = []
    lines.append("# HELP http_requests_total HTTP requests by method and status class")
    lines.append("# TYPE http_requests_total counter")
    for (method, klass), count in sorted(requests.items()):
        lines.append(
            f'http_requests_total{{method="{method}",status_class="{klass}"}} {count}'
        )
    lines.append("# HELP http_request_duration_seconds_sum Total request seconds")
    lines.append("# TYPE http_request_duration_seconds_sum counter")
    lines.append(f"http_request_duration_seconds_sum {duration_sum:.6f}")
    lines.append("# HELP http_request_duration_seconds_count Observed requests")
    lines.append("# TYPE http_request_duration_seconds_count counter")
    lines.append(f"http_request_duration_seconds_count {duration_count}")
    for name, count in sorted(counters.items()):
        lines.append(f"# TYPE app_{name}_total counter")
        lines.append(f"app_{name}_total {count}")
    lines.extend(_pool_lines())
    return "\n".join(lines) + "\n"


def reset() -> None:
    """Test helper."""
    global _http_duration_sum, _http_duration_count
    with _lock:
        _http_requests.clear()
        _counters.clear()
        _http_duration_sum = 0.0
        _http_duration_count = 0
