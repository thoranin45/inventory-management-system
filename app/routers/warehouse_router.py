from fastapi import APIRouter, Depends, Query

from app.core.dependencies import StockBalanceRepositoryDependency, require_warehouse
from app.schemas.response import ApiResponse
from app.schemas.warehouse_schema import WarehouseResponse

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/warehouses",
    tags=["Warehouses"],
)


@router.get("", response_model=ApiResponse[list[WarehouseResponse]])
def list_warehouses(
    balance_repo: StockBalanceRepositoryDependency,
    active_only: bool = Query(default=True),
) -> ApiResponse[list[WarehouseResponse]]:
    warehouses = balance_repo.list_warehouses(active_only=active_only)
    return ApiResponse(
        message="Warehouses retrieved successfully",
        data=[WarehouseResponse.model_validate(w) for w in warehouses],
    )
