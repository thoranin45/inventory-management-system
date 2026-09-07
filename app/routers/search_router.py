from fastapi import APIRouter, Depends, Query

from app.core.dependencies import DatabaseSession, require_warehouse
from app.services.search_service import ALL_TYPES, global_search_service

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/search",
    tags=["Search"],
)


@router.get("")
def global_search(
    db: DatabaseSession,
    q: str = Query(..., min_length=1, max_length=100),
    types: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
) -> dict:
    selected = None
    if types:
        selected = [t.strip() for t in types.split(",") if t.strip() in ALL_TYPES]
    return global_search_service(db, q, selected, limit)
