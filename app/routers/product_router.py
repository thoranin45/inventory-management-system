from app.core.dependencies import require_admin
from app.models import User
from app.core.dependencies import require_warehouse
from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    UploadFile,
    status,
)

from app.core.dependencies import (
    CategoryRepositoryDependency,
    CurrentUser,
    DatabaseSession,
    ProductRepositoryDependency,
)
from app.schemas.product_schema import (
    ProductCreate,
    ProductResponse,
    ProductUpdate,
)
from app.schemas.response import (
    ApiResponse,
    PaginatedData,
)
from app.services.product_service import (
    create_product_service,
    delete_product_service,
    get_inactive_products_service,
    get_product_by_barcode_service,
    get_product_service,
    get_products_service,
    restore_product_service,
    search_products_service,
    update_product_service,
    upload_product_image_service,
)


router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/products",
    tags=["Products"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[ProductResponse],
)
def create_product(
    data: ProductCreate,
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    category_repo: CategoryRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[ProductResponse]:
    product = create_product_service(
        db=db,
        product_repo=product_repo,
        category_repo=category_repo,
        data=data,
        current_user=current_user,
    )

    return ApiResponse(
        message="Product created successfully",
        data=product,
    )


@router.get(
    "",
    response_model=ApiResponse[
        PaginatedData[ProductResponse]
    ],
)
def get_products(
    product_repo: ProductRepositoryDependency,
    current_user: CurrentUser,
    page: int = Query(
        default=1,
        ge=1,
    ),
    size: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
) -> ApiResponse[PaginatedData[ProductResponse]]:
    result = get_products_service(
        product_repo=product_repo,
        page=page,
        size=size,
    )

    return ApiResponse(
        message="Products retrieved successfully",
        data=result,
    )


@router.get(
    "/search",
    response_model=ApiResponse[list[ProductResponse]],
)
def search_products(
    product_repo: ProductRepositoryDependency,
    current_user: CurrentUser,
    keyword: str = Query(
        min_length=1,
        max_length=100,
    ),
) -> ApiResponse[list[ProductResponse]]:
    products = search_products_service(
        product_repo=product_repo,
        keyword=keyword,
    )

    return ApiResponse(
        message="Products retrieved successfully",
        data=products,
    )


@router.get(
    "/inactive",
    response_model=ApiResponse[list[ProductResponse]],
)
def get_inactive_products(
    product_repo: ProductRepositoryDependency,
    current_user: CurrentUser,
) -> ApiResponse[list[ProductResponse]]:
    products = get_inactive_products_service(
        product_repo=product_repo,
    )

    return ApiResponse(
        message="Inactive products retrieved successfully",
        data=products,
    )


@router.get(
    "/barcode/{barcode}",
    response_model=ApiResponse[ProductResponse],
)
def get_product_by_barcode(
    barcode: str,
    product_repo: ProductRepositoryDependency,
    current_user: CurrentUser,
) -> ApiResponse[ProductResponse]:
    product = get_product_by_barcode_service(
        product_repo=product_repo,
        barcode=barcode,
    )

    return ApiResponse(
        message="Product retrieved successfully",
        data=product,
    )


@router.get(
    "/{product_id}",
    response_model=ApiResponse[ProductResponse],
)
def get_product(
    product_id: int,
    product_repo: ProductRepositoryDependency,
    current_user: CurrentUser,
) -> ApiResponse[ProductResponse]:
    product = get_product_service(
        product_repo=product_repo,
        product_id=product_id,
    )

    return ApiResponse(
        message="Product retrieved successfully",
        data=product,
    )


@router.put(
    "/{product_id}",
    response_model=ApiResponse[ProductResponse],
)
def update_product(
    product_id: int,
    data: ProductUpdate,
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    category_repo: CategoryRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[ProductResponse]:
    product = update_product_service(
        db=db,
        product_repo=product_repo,
        category_repo=category_repo,
        product_id=product_id,
        data=data,
        current_user=current_user,
    )

    return ApiResponse(
        message="Product updated successfully",
        data=product,
    )


@router.delete(
    "/{product_id}",
    response_model=ApiResponse[ProductResponse],
)
def delete_product(
    product_id: int,
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[ProductResponse]:
    product = delete_product_service(
        db=db,
        product_repo=product_repo,
        product_id=product_id,
        current_user=current_user,
    )

    return ApiResponse(
        message="Product deleted successfully",
        data=product,
    )


@router.put(
    "/{product_id}/restore",
    response_model=ApiResponse[ProductResponse],
)
def restore_product(
    product_id: int,
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[ProductResponse]:
    product = restore_product_service(
        db=db,
        product_repo=product_repo,
        product_id=product_id,
        current_user=current_user,
    )

    return ApiResponse(
        message="Product restored successfully",
        data=product,
    )


@router.post(
    "/{product_id}/upload-image",
    response_model=ApiResponse[ProductResponse],
)
def upload_product_image(
    product_id: int,
    db: DatabaseSession,
    product_repo: ProductRepositoryDependency,
    current_user: User = Depends(require_admin),
    file: UploadFile = File(...),
) -> ApiResponse[ProductResponse]:
    product = upload_product_image_service(
        db=db,
        product_repo=product_repo,
        product_id=product_id,
        file=file,
        current_user=current_user,
    )

    return ApiResponse(
        message="Product image uploaded successfully",
        data=product,
    )
