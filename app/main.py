from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.exception_handler import (
    app_exception_handler,
    http_exception_handler,
    integrity_error_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)

from app.schemas.response import (
    ApiResponse,
    HealthData,
    RootData,
)

from app.core.exceptions import AppException
from app.core.logger import logger
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.request_logger import RequestLoggingMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware

from app.routers.attention_router import router as attention_router
from app.routers.audit_router import router as audit_router
from app.routers.auth_router import router as auth_router
from app.routers.batch_router import router as batch_router
from app.routers.category_router import router as category_router
from app.routers.code_router import router as code_router
from app.routers.customer_router import router as customer_router
from app.routers.dashboard_router import router as dashboard_router
from app.routers.health_router import router as health_router
from app.routers.system_router import router as system_router
from app.routers.label_router import router as label_router
from app.routers.product_router import router as product_router
from app.routers.purchase_order_router import router as po_router
from app.routers.report_router import router as report_router
from app.routers.sales_order_router import router as sales_order_router
from app.routers.scan_router import router as scan_router
from app.routers.search_router import router as search_router
from app.routers.stock_router import router as stock_router
from app.routers.supplier_router import router as supplier_router
from app.routers.stock_balance_router import (
    router as stock_balance_router,
)
from app.routers.inventory_transfer_router import (
    router as inventory_transfer_router,
)
from app.routers.inventory_movement_router import (
    router as inventory_movement_router,
)


# -------------------------------------------------------------------
# Application lifecycle
# -------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application Started")

    yield

    logger.info("Application Shutdown")


# -------------------------------------------------------------------
# FastAPI application
# -------------------------------------------------------------------

_docs_on = settings.docs_effective

app = FastAPI(
    title=settings.app_name,
    description=(
        "Backend API for inventory, stock, purchase orders, "
        "sales orders, FEFO batch control, reporting, "
        "and authentication.\n\n"
        "See `docs/api-conventions.md` for pagination, the fixed-scale "
        "quantity/money string contract, lifecycle transitions, the "
        "`Idempotency-Key` header, the `ErrorResponse` envelope and request "
        "IDs."
    ),
    version=settings.app_version,
    docs_url="/docs" if _docs_on else None,
    redoc_url="/redoc" if _docs_on else None,
    openapi_url="/openapi.json" if _docs_on else None,
    lifespan=lifespan,
)


# -------------------------------------------------------------------
# Middleware
# -------------------------------------------------------------------

cors_origins = settings.cors_origin_list

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=settings.cors_method_list,
    allow_headers=settings.cors_header_list,
    expose_headers=["X-Request-ID"],
)

app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.rate_limit_max_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# Outermost: seed request.state.request_id before anything else runs, and put
# X-Request-ID on every response (including those from exception handlers).
app.add_middleware(RequestIDMiddleware)


# -------------------------------------------------------------------
# Exception handlers
# -------------------------------------------------------------------

app.add_exception_handler(
    AppException,
    app_exception_handler,
)

app.add_exception_handler(
    HTTPException,
    http_exception_handler,
)

app.add_exception_handler(
    RequestValidationError,
    validation_exception_handler,
)

app.add_exception_handler(
    IntegrityError,
    integrity_error_handler,
)

app.add_exception_handler(
    StarletteHTTPException,
    http_exception_handler,
)

app.add_exception_handler(
    Exception,
    unhandled_exception_handler,
)

# -------------------------------------------------------------------
# Static files
# -------------------------------------------------------------------

UPLOAD_DIRECTORY = Path("uploads")
UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)

app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOAD_DIRECTORY)),
    name="uploads",
)


# -------------------------------------------------------------------
# Basic system endpoints
# -------------------------------------------------------------------

@app.get(
    "/",
    tags=["System"],
    summary="API information",
    response_model=ApiResponse[RootData],
)
def root() -> ApiResponse[RootData]:
    return ApiResponse(
        message="Inventory Management API is running",
        data=RootData(
            name=settings.app_name,
            version=settings.app_version,
            docs="/docs" if _docs_on else "",
            redoc="/redoc" if _docs_on else "",
            health="/api/v1/health/",
        ),
    )


# -------------------------------------------------------------------
# API routers
# -------------------------------------------------------------------

API_V1_PREFIX = "/api/v1"

app.include_router(
    auth_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    product_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    category_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    supplier_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    customer_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    stock_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    batch_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    po_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    sales_order_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    dashboard_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    report_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    audit_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    code_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    label_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    health_router,
    prefix=API_V1_PREFIX,
)

# Liveness / readiness live at the root, outside the versioned API.
app.include_router(system_router)

app.include_router(
    stock_balance_router,
    prefix="/api/v1",
)

app.include_router(
    inventory_transfer_router,
    prefix="/api/v1",
)

app.include_router(
    inventory_movement_router,
    prefix="/api/v1",
)

app.include_router(
    attention_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    search_router,
    prefix=API_V1_PREFIX,
)

app.include_router(
    scan_router,
    prefix=API_V1_PREFIX,
)