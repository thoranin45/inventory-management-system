"""Pure-ASGI request-ID middleware.

Runs before every other middleware and route handler. Guarantees:

* ``scope["state"]["request_id"]`` is set before downstream execution, so the
  exception handlers and the request logger all read the same value.
* A sane inbound ``X-Request-ID`` (proxy-supplied) is honoured; otherwise a
  fresh id is generated.
* Every response carries the ``X-Request-ID`` header.

``BaseHTTPMiddleware`` is deliberately avoided here: a raw ASGI middleware is
the reliable place to seed ``scope["state"]`` and to rewrite response headers
even for responses produced by exception handlers.
"""
import re
from uuid import uuid4

_SANE_ID = re.compile(r"^[A-Za-z0-9_.-]{8,128}$")
_HEADER = b"x-request-id"


def generate_request_id() -> str:
    return uuid4().hex


def _inbound_id(headers) -> str | None:
    for key, value in headers:
        if key.lower() == _HEADER:
            try:
                candidate = value.decode("latin-1").strip()
            except Exception:
                return None
            if _SANE_ID.match(candidate):
                return candidate
            return None
    return None


class RequestIDMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        request_id = _inbound_id(scope.get("headers", [])) or generate_request_id()
        state = scope.setdefault("state", {})
        state["request_id"] = request_id

        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers = [
                    (k, v) for k, v in headers if k.lower() != _HEADER
                ]
                headers.append((_HEADER, request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_request_id)
