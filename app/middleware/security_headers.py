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

        # HSTS only makes sense once TLS terminates in front of the service.
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return response
