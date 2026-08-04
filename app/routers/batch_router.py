from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    BatchRepositoryDependency,
    DatabaseSession,
    StockRepositoryDependency,
    require_warehouse,
)
from app.models import User
from app.schemas.batch_schema import (
    BatchCreate,
    BatchCreateResponse,
    BatchResponse,
)
from app.schemas.response import ApiResponse
from app.services.batch_service import (
    create_batch_service,
    get_batches_service,
    get_expiring_batches_service,
)


router = APIRouter(
    prefix="/batches",
    tags=["Batches"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[BatchCreateResponse],
)
def create_batch(
    data: BatchCreate,
    db: DatabaseSession,
    stock_repo: StockRepositoryDependency,
    batch_repo: BatchRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> ApiResponse[BatchCreateResponse]:
    result = create_batch_service(
        db=db,
        stock_repo=stock_repo,
        batch_repo=batch_repo,
        data=data,
    )

    return ApiResponse(
        message="Batch created successfully",
        data=result,
    )


@router.get(
    "",
    response_model=ApiResponse[list[BatchResponse]],
)
def get_batches(
    batch_repo: BatchRepositoryDependency,
) -> ApiResponse[list[BatchResponse]]:
    batches = get_batches_service(
        batch_repo=batch_repo,
    )

    return ApiResponse(
        message="Batches retrieved successfully",
        data=batches,
    )


@router.get(
    "/expiring",
    response_model=ApiResponse[list[BatchResponse]],
)
def get_expiring_batches(
    batch_repo: BatchRepositoryDependency,
) -> ApiResponse[list[BatchResponse]]:
    batches = get_expiring_batches_service(
        batch_repo=batch_repo,
    )

    return ApiResponse(
        message="Expiring batches retrieved successfully",
        data=batches,
    )