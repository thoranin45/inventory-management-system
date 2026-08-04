from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app.core.response import success_response


router = APIRouter(
    prefix="/health",
    tags=["Health Check"]
)


@router.get("/")
def health_check(
    db: Session = Depends(get_db)
):
    db.execute(text("SELECT 1"))

    return success_response(
        "System healthy",
        {
            "api": "ok",
            "database": "ok"
        }
    )