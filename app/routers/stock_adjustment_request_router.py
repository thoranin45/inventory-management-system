from fastapi import APIRouter, Depends, Header

from app.core.dependencies import (
    DatabaseSession,
    InventoryMovementRepositoryDependency,
    StockAdjustmentRequestRepositoryDependency,
    StockBalanceRepositoryDependency,
    StockRepositoryDependency,
    require_admin,
    require_warehouse,
)
from app.core.pagination import ListParams, list_params
from app.models import User
from app.schemas.response import ApiResponse
from app.schemas.stock_adjustment_request_schema import (
    StockAdjustmentRequestCreate,
    StockAdjustmentRequestDetail,
    StockAdjustmentRequestReject,
)
from app.services.stock_adjustment_request_service import (
    approve_adjustment_request_service,
    cancel_adjustment_request_service,
    create_adjustment_request_service,
    get_adjustment_request_service,
    list_adjustment_requests_service,
    reject_adjustment_request_service,
)

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/stock-adjustment-requests",
    tags=["Stock Adjustment Requests"],
)


@router.post(
    "",
    response_model=ApiResponse[StockAdjustmentRequestDetail],
    status_code=201,
)
def create_adjustment_request(
    data: StockAdjustmentRequestCreate,
    db: DatabaseSession,
    request_repo: StockAdjustmentRequestRepositoryDependency,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    operation_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    current_user: User = Depends(require_warehouse),
) -> ApiResponse[StockAdjustmentRequestDetail]:
    result = create_adjustment_request_service(
        db, request_repo, stock_repo, balance_repo, data, operation_key, current_user,
    )
    return ApiResponse(message="Stock adjustment request submitted", data=result)


@router.get("")
def list_adjustment_requests(
    request_repo: StockAdjustmentRequestRepositoryDependency,
    current_user: User = Depends(require_warehouse),
    params: ListParams = Depends(list_params),
) -> dict:
    return list_adjustment_requests_service(request_repo, params, current_user)


@router.get(
    "/{request_id}",
    response_model=ApiResponse[StockAdjustmentRequestDetail],
)
def get_adjustment_request(
    request_id: int,
    db: DatabaseSession,
    request_repo: StockAdjustmentRequestRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> ApiResponse[StockAdjustmentRequestDetail]:
    result = get_adjustment_request_service(db, request_repo, request_id, current_user)
    return ApiResponse(message="Stock adjustment request retrieved", data=result)


@router.post(
    "/{request_id}/approve",
    response_model=ApiResponse[StockAdjustmentRequestDetail],
)
def approve_adjustment_request(
    request_id: int,
    db: DatabaseSession,
    request_repo: StockAdjustmentRequestRepositoryDependency,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    operation_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    current_user: User = Depends(require_admin),
) -> ApiResponse[StockAdjustmentRequestDetail]:
    result = approve_adjustment_request_service(
        db, request_repo, stock_repo, balance_repo, movement_repo, request_id, operation_key, current_user,
    )
    return ApiResponse(message="Stock adjustment request approved", data=result)


@router.post(
    "/{request_id}/reject",
    response_model=ApiResponse[StockAdjustmentRequestDetail],
)
def reject_adjustment_request(
    request_id: int,
    data: StockAdjustmentRequestReject,
    db: DatabaseSession,
    request_repo: StockAdjustmentRequestRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[StockAdjustmentRequestDetail]:
    result = reject_adjustment_request_service(
        db, request_repo, request_id, data.rejection_reason, current_user,
    )
    return ApiResponse(message="Stock adjustment request rejected", data=result)


@router.post(
    "/{request_id}/cancel",
    response_model=ApiResponse[StockAdjustmentRequestDetail],
)
def cancel_adjustment_request(
    request_id: int,
    db: DatabaseSession,
    request_repo: StockAdjustmentRequestRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> ApiResponse[StockAdjustmentRequestDetail]:
    result = cancel_adjustment_request_service(db, request_repo, request_id, current_user)
    return ApiResponse(message="Stock adjustment request cancelled", data=result)
