from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.exception_handler import (
    app_exception_handler,
    http_exception_handler,
    integrity_error_handler,
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
from app.middleware.request_logger import RequestLoggingMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware

from app.routers.audit_router import router as audit_router
from app.routers.auth_router import router as auth_router
from app.routers.batch_router import router as batch_router
from app.routers.category_router import router as category_router
from app.routers.code_router import router as code_router
from app.routers.customer_router import router as customer_router
from app.routers.dashboard_router import router as dashboard_router
from app.routers.health_router import router as health_router
from app.routers.label_router import router as label_router
from app.routers.product_router import router as product_router
from app.routers.purchase_order_router import router as po_router
from app.routers.report_router import router as report_router
from app.routers.sales_order_router import router as sales_order_router
from app.routers.stock_router import router as stock_router
from app.routers.supplier_router import router as supplier_router


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

app = FastAPI(
    title=settings.app_name,
    description=(
        "Backend API for inventory, stock, purchase orders, "
        "sales orders, FEFO batch control, reporting, "
        "and authentication."
    ),
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


# -------------------------------------------------------------------
# Middleware
# -------------------------------------------------------------------

cors_origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.rate_limit_max_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


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
            docs="/docs",
            redoc="/redoc",
            health="/api/v1/health/",
        ),
    )


@app.get(
    "/health",
    tags=["System"],
    summary="Basic application health check",
    response_model=ApiResponse[HealthData],
)
def basic_health_check() -> ApiResponse[HealthData]:
    return ApiResponse(
        message="Application is healthy",
        data=HealthData(
            status="ok",
            service=settings.app_name,
            version=settings.app_version,
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