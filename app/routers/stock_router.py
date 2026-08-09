from fastapi import APIRouter, Depends

from app.core.dependencies import (
    DatabaseSession,
    InventoryMovementRepositoryDependency,
    StockBalanceRepositoryDependency,
    StockRepositoryDependency,
    require_warehouse,
)
from app.models import User
from app.schemas.response import ApiResponse
from app.schemas.stock_schema import (
    StockAdjust,
    StockIn,
    StockOperationResponse,
    StockOut,
    StockTransactionResponse,
)
from app.services.stock_service import (
    get_stock_history_service,
    stock_adjust_service,
    stock_in_service,
    stock_out_fefo_service,
    stock_out_fifo_service,
)


router = APIRouter(
    prefix="/stock",
    tags=["Stock"],
)


@router.post(
    "/in",
    response_model=ApiResponse[
        StockOperationResponse
    ],
)

@router.post(
    "/in",
    response_model=ApiResponse[
        StockOperationResponse
    ],
)
def stock_in(
    data: StockIn,
    db: DatabaseSession,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> ApiResponse[StockOperationResponse]:

    result = stock_in_service(
        db=db,
        stock_repo=stock_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        data=data,
        created_by_user_id=current_user.id,
    )

    return ApiResponse(
        message="Stock in completed successfully",
        data=result,
    )


@router.post(
    "/out-fifo",
    response_model=ApiResponse[
        StockOperationResponse
    ],
)
def stock_out_fifo(
    data: StockOut,
    db: DatabaseSession,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> ApiResponse[StockOperationResponse]:

    result = stock_out_fifo_service(
        db=db,
        stock_repo=stock_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        data=data,
        created_by_user_id=current_user.id,
    )

    return ApiResponse(
        message=(
            "FIFO stock out completed "
            "successfully"
        ),
        data=result,
    )


@router.post(
    "/out-fefo",
    response_model=ApiResponse[
        StockOperationResponse
    ],
)
def stock_out_fefo(
    data: StockOut,
    db: DatabaseSession,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> ApiResponse[StockOperationResponse]:

    result = stock_out_fefo_service(
        db=db,
        stock_repo=stock_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        data=data,
        created_by_user_id=current_user.id,
    )

    return ApiResponse(
        message=(
            "FEFO stock out completed "
            "successfully"
        ),
        data=result,
    )


@router.post(
    "/adjust",
    response_model=ApiResponse[
        StockOperationResponse
    ],
)
def stock_adjust(
    data: StockAdjust,
    db: DatabaseSession,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> ApiResponse[StockOperationResponse]:

    result = stock_adjust_service(
        db=db,
        stock_repo=stock_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        data=data,
        created_by_user_id=current_user.id,
    )

    return ApiResponse(
        message="Stock adjusted successfully",
        data=result,
    )


@router.get(
    "/history",
    response_model=ApiResponse[
        list[StockTransactionResponse]
    ],
)
def stock_history(
    stock_repo: StockRepositoryDependency,
) -> ApiResponse[
    list[StockTransactionResponse]
]:

    transactions = (
        get_stock_history_service(
            stock_repo=stock_repo,
        )
    )

    return ApiResponse(
        message=(
            "Stock history retrieved "
            "successfully"
        ),
        data=transactions,
    )