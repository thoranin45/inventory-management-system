"""Liveness and readiness endpoints.

Both are unauthenticated (probes, load balancers and uptime monitors need
them) and neither leaks configuration: no database URL, credentials, host
names or exception text.

* ``GET /health`` — liveness. The process is up. No database access.
* ``GET /ready``  — readiness. The database answers and its schema revision
  matches the revision this code was built against.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db_revision import EXPECTED_ALEMBIC_HEAD, current_db_revision
from app.core.dependencies import require_admin
from app.core.logger import logger
from app.core.metrics import render as render_metrics
from app.database import get_db
from app.schemas.response import ApiResponse, HealthData

router = APIRouter(tags=["System"])


@router.get(
    "/health",
    summary="Liveness probe",
    description="Returns 200 while the process is alive. Never touches the database.",
    response_model=ApiResponse[HealthData],
)
def health() -> ApiResponse[HealthData]:
    return ApiResponse(
        message="Application is healthy",
        data=HealthData(
            status="ok",
            service=settings.app_name,
            version=settings.app_version,
        ),
    )


@router.get(
    "/ready",
    summary="Readiness probe",
    description=(
        "Returns 200 only when the database is reachable and its Alembic "
        "revision matches the revision this build expects. Otherwise 503 with "
        "a machine-readable `reason` (`db_unreachable` or `migration_mismatch`)."
    ),
)
def ready(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
        revision = current_db_revision(db.connection())
    except SQLAlchemyError:
        logger.warning("READINESS | reason=db_unreachable")
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "db_unreachable"},
        )

    if revision != EXPECTED_ALEMBIC_HEAD:
        logger.warning(
            "READINESS | reason=migration_mismatch "
            f"actual={revision} expected={EXPECTED_ALEMBIC_HEAD}"
        )
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "reason": "migration_mismatch",
                "migration": revision,
                "expected": EXPECTED_ALEMBIC_HEAD,
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "ready",
            "database": "ok",
            "migration": revision,
            "expected": EXPECTED_ALEMBIC_HEAD,
        },
    )


@router.get(
    "/metrics",
    summary="Prometheus metrics (admin only)",
    description=(
        "In-process counters in Prometheus text format: HTTP requests by "
        "method + status class, request-duration sum/count, DB pool gauges, "
        "and any opt-in business counters. Low-cardinality by design."
    ),
    include_in_schema=False,
)
def metrics(_: object = Depends(require_admin)) -> PlainTextResponse:
    return PlainTextResponse(render_metrics(), media_type="text/plain; version=0.0.4")
