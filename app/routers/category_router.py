from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    CategoryRepositoryDependency,
    DatabaseSession,
    require_admin,
)
from app.models import User
from app.schemas.category_schema import (
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
)
from app.schemas.response import ApiResponse
from app.services.category_service import (
    create_category_service,
    delete_category_service,
    get_categories_service,
    get_category_service,
    update_category_service,
)


router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/categories",
    tags=["Categories"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[CategoryResponse],
)
def create_category(
    data: CategoryCreate,
    db: DatabaseSession,
    category_repo: CategoryRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CategoryResponse]:
    category = create_category_service(
        db=db,
        category_repo=category_repo,
        data=data,
    )

    return ApiResponse(
        message="Category created successfully",
        data=category,
    )


@router.get(
    "",
    response_model=ApiResponse[list[CategoryResponse]],
)
def get_categories(
    category_repo: CategoryRepositoryDependency,
) -> ApiResponse[list[CategoryResponse]]:
    categories = get_categories_service(
        category_repo=category_repo,
    )

    return ApiResponse(
        message="Categories retrieved successfully",
        data=categories,
    )


@router.get(
    "/{category_id}",
    response_model=ApiResponse[CategoryResponse],
)
def get_category(
    category_id: int,
    category_repo: CategoryRepositoryDependency,
) -> ApiResponse[CategoryResponse]:
    category = get_category_service(
        category_repo=category_repo,
        category_id=category_id,
    )

    return ApiResponse(
        message="Category retrieved successfully",
        data=category,
    )


@router.put(
    "/{category_id}",
    response_model=ApiResponse[CategoryResponse],
)
def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: DatabaseSession,
    category_repo: CategoryRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CategoryResponse]:
    category = update_category_service(
        db=db,
        category_repo=category_repo,
        category_id=category_id,
        data=data,
    )

    return ApiResponse(
        message="Category updated successfully",
        data=category,
    )


@router.delete(
    "/{category_id}",
    response_model=ApiResponse[CategoryResponse],
)
def delete_category(
    category_id: int,
    db: DatabaseSession,
    category_repo: CategoryRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CategoryResponse]:
    category = delete_category_service(
        db=db,
        category_repo=category_repo,
        category_id=category_id,
    )

    return ApiResponse(
        message="Category deleted successfully",
        data=category,
    )
