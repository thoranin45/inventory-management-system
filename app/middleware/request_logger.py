import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logger import logger


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start_time = time.time()

        response = await call_next(request)

        process_time = round(
            (time.time() - start_time) * 1000,
            2
        )

        client_ip = request.client.host if request.client else "-"
        method = request.method
        path = request.url.path
        query = request.url.query if request.url.query else "-"
        user_agent = request.headers.get("user-agent", "-")
        status_code = response.status_code

        log_message = (
            f"request_id={request_id} | "
            f"method={method} | "
            f"path={path} | "
            f"query={query} | "
            f"status={status_code} | "
            f"time={process_time}ms | "
            f"client={client_ip} | "
            f"user_agent={user_agent}"
        )

        if process_time > 500:
            logger.warning(f"SLOW_REQUEST | {log_message}")
        elif status_code >= 400:
            logger.warning(f"ERROR_REQUEST | {log_message}")
        else:
            logger.info(f"REQUEST | {log_message}")

        response.headers["X-Request-ID"] = request_id

        return response