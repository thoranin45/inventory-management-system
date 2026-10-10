from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

# Conservative CSP. The API returns JSON; Swagger/Redoc UIs need inline styles
# and their CDN script, so a relaxed policy is applied only to the docs paths.
_API_CSP = "default-src 'none'; frame-ancestors 'none'"
_DOCS_CSP = (
    "default-src 'self'; img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline' https:; "
    "script-src 'self' 'unsafe-inline' https:; "
    "worker-src 'self' blob:; frame-ancestors 'none'"
)
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
_API_PREFIX = "/api/v1/"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        path = request.url.path
        response.headers.setdefault(
            "Content-Security-Policy",
            _DOCS_CSP if path.startswith(_DOCS_PATHS) else _API_CSP,
        )

        # Phase 14C (D9): API responses are per-user (role- and
        # ownership-scoped, e.g. redacted adjustment notes), so no browser or
        # intermediary may store and replay them for someone else. Static
        # product images under /uploads are left cacheable. A route that sets
        # its own Cache-Control keeps it.
        if path.startswith(_API_PREFIX):
            response.headers.setdefault("Cache-Control", "private, no-store")

        # HSTS only makes sense once TLS terminates in front of the service.
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return response
