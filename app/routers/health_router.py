"""Compatibility alias for the pre-Phase-9 health endpoint.

New clients should use ``GET /health`` (liveness) and ``GET /ready``
(readiness). This route is kept because existing clients and the Docker
healthcheck call ``/api/v1/health/``. It performs a lightweight database
check and, unlike the previous version, returns a clean 503 instead of an
unhandled 500 when the database is down.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.response import success_response


router = APIRouter(
    prefix="/health",
    tags=["Health Check"],
)


@router.get("/")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "db_unreachable"},
        )

    return success_response(
        "System healthy",
        {
            "api": "ok",
            "database": "ok",
        },
    )
