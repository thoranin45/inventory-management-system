"""In-memory sliding-window rate limiting for a single API instance.

Two independent buckets:

* **auth** — credential endpoints (login / token / register). Strict, to blunt
  brute-force. Default: 5 requests / 5 min / client IP.
* **general** — everything else. Generous, so barcode scanning and normal
  warehouse traffic are never throttled. Default: 300 requests / 60s / IP.

Liveness / readiness probes are exempt. Client IP is resolved through the
trusted-proxy configuration, not a raw ``X-Forwarded-For``.

State is per-process; acceptable because V1 runs one API instance. No Redis.
"""
import os
import time

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.middleware.client_ip import resolve_client_ip
from app.schemas.response import ErrorDetail, ErrorResponse

_EXEMPT_PATHS = {
    "/health",
    "/ready",
    "/api/v1/health",
    "/api/v1/health/",
}

_AUTH_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/token",
    "/api/v1/auth/register",
}

_MAX_TRACKED_IPS = 10_000

# Module-level so tests can reset it and so multiple middleware instances
# (should never happen in practice) share one view.
_BUCKETS: dict[str, list[float]] = {}


def reset_rate_limit_state() -> None:
    """Test helper: clear all sliding-window counters."""
    _BUCKETS.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        max_requests: int | None = None,
        window_seconds: int | None = None,
    ):
        super().__init__(app)
        self.max_requests = (
            max_requests
            if max_requests is not None
            else settings.rate_limit_max_requests
        )
        self.window_seconds = (
            window_seconds
            if window_seconds is not None
            else settings.rate_limit_window_seconds
        )
        self.auth_max_requests = settings.auth_rate_limit_max_requests
        self.auth_window_seconds = settings.auth_rate_limit_window_seconds
        self._buckets = _BUCKETS

    def _prune(self, now: float) -> None:
        if len(self._buckets) <= _MAX_TRACKED_IPS:
            return
        horizon = now - max(self.window_seconds, self.auth_window_seconds)
        stale = [
            key for key, hits in self._buckets.items()
            if not hits or hits[-1] < horizon
        ]
        for key in stale:
            del self._buckets[key]
        # Hard cap: if still oversized, drop oldest-touched buckets.
        if len(self._buckets) > _MAX_TRACKED_IPS:
            ordered = sorted(self._buckets.items(), key=lambda kv: kv[1][-1])
            for key, _ in ordered[: len(self._buckets) - _MAX_TRACKED_IPS]:
                del self._buckets[key]

    def _check(self, key: str, limit: int, window: int, now: float) -> bool:
        hits = [t for t in self._buckets.get(key, []) if now - t < window]
        if len(hits) >= limit:
            self._buckets[key] = hits
            return False
        hits.append(now)
        self._buckets[key] = hits
        return True

    async def dispatch(self, request: Request, call_next):
        if (
            os.getenv("PYTEST_CURRENT_TEST")
            and os.getenv("RATE_LIMIT_TEST_ENABLED") != "1"
        ):
            return await call_next(request)

        path = request.url.path
        if path in _EXEMPT_PATHS:
            return await call_next(request)

        now = time.time()
        self._prune(now)
        client_ip = resolve_client_ip(request)

        if path in _AUTH_PATHS:
            allowed = self._check(
                f"auth:{client_ip}",
                self.auth_max_requests,
                self.auth_window_seconds,
                now,
            )
            retry_after = self.auth_window_seconds
        else:
            allowed = self._check(
                f"gen:{client_ip}",
                self.max_requests,
                self.window_seconds,
                now,
            )
            retry_after = self.window_seconds

        if allowed:
            return await call_next(request)

        payload = ErrorResponse(
            success=False,
            message="Too many requests",
            errors=[
                ErrorDetail(
                    message="Rate limit exceeded; retry later",
                    error_type="rate_limited",
                )
            ],
            request_id=getattr(request.state, "request_id", None),
        )
        return JSONResponse(
            status_code=429,
            content=jsonable_encoder(payload),
            headers={"Retry-After": str(retry_after)},
        )
