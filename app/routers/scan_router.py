from fastapi import APIRouter, Depends, Query

from app.core.dependencies import (
    DatabaseSession,
    ProductRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_warehouse,
)
from app.services.scan_service import resolve_barcode_service

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/scan",
    tags=["Scan"],
)


@router.get("/resolve")
def scan_resolve(
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    barcode: str = Query(..., min_length=1, max_length=100),
    context: str = Query(default="lookup", pattern="^(lookup|stock_in|pick|pack)$"),
) -> dict:
    return resolve_barcode_service(db, product_repo, balance_repo, barcode, context)
