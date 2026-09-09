"""Structured per-request access logging.

Reads the request id seeded by :class:`RequestIDMiddleware`. Emits one record
per request with method, path, status, duration and — when available — the
authenticated user id. Never logs headers, bodies, query values beyond the
raw query string, or credentials.
"""
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logger import logger
from app.core.metrics import observe_request
from app.middleware.client_ip import resolve_client_ip
from app.middleware.request_id import generate_request_id

_SLOW_MS = 500


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = getattr(request.state, "request_id", None)
        if not request_id:
            request_id = generate_request_id()
            request.state.request_id = request_id

        start = time.perf_counter()
        response = await call_next(request)
        elapsed = time.perf_counter() - start
        duration_ms = round(elapsed * 1000, 2)
        observe_request(request.method, response.status_code, elapsed)

        user_id = getattr(request.state, "user_id", None)
        client_ip = resolve_client_ip(request)
        status_code = response.status_code

        fields = {
            "event": "request",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "query": request.url.query or "-",
            "status": status_code,
            "duration_ms": duration_ms,
            "user_id": user_id,
            "client_ip": client_ip,
        }
        message = (
            f"request_id={request_id} method={request.method} "
            f"path={request.url.path} status={status_code} "
            f"duration_ms={duration_ms} user_id={user_id} client={client_ip}"
        )

        if duration_ms > _SLOW_MS:
            logger.warning("SLOW_REQUEST | " + message, extra=fields)
        elif status_code >= 500:
            logger.error("ERROR_REQUEST | " + message, extra=fields)
        elif status_code >= 400:
            logger.warning("ERROR_REQUEST | " + message, extra=fields)
        else:
            logger.info("REQUEST | " + message, extra=fields)

        response.headers["X-Request-ID"] = request_id
        return response
