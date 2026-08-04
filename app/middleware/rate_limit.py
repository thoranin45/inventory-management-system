import time

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = 100, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.clients = {}

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()

        request_times = self.clients.get(client_ip, [])

        request_times = [
            request_time
            for request_time in request_times
            if now - request_time < self.window_seconds
        ]

        if len(request_times) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "message": "Too many requests",
                    "data": None
                }
            )

        request_times.append(now)
        self.clients[client_ip] = request_times

        return await call_next(request)