from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    DatabaseSession,
    SupplierRepositoryDependency,
    require_admin,
)
from app.models import User
from app.schemas.response import ApiResponse
from app.schemas.supplier_schema import (
    SupplierCreate,
    SupplierResponse,
    SupplierUpdate,
)
from app.services.supplier_service import (
    create_supplier_service,
    delete_supplier_service,
    get_supplier_service,
    get_suppliers_service,
    update_supplier_service,
)


router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/suppliers",
    tags=["Suppliers"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[SupplierResponse],
)
def create_supplier(
    data: SupplierCreate,
    db: DatabaseSession,
    supplier_repo: SupplierRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[SupplierResponse]:
    supplier = create_supplier_service(
        db=db,
        supplier_repo=supplier_repo,
        data=data,
    )

    return ApiResponse(
        message="Supplier created successfully",
        data=supplier,
    )


@router.get(
    "",
    response_model=ApiResponse[list[SupplierResponse]],
)
def get_suppliers(
    supplier_repo: SupplierRepositoryDependency,
) -> ApiResponse[list[SupplierResponse]]:
    suppliers = get_suppliers_service(
        supplier_repo=supplier_repo,
    )

    return ApiResponse(
        message="Suppliers retrieved successfully",
        data=suppliers,
    )


@router.get(
    "/{supplier_id}",
    response_model=ApiResponse[SupplierResponse],
)
def get_supplier(
    supplier_id: int,
    supplier_repo: SupplierRepositoryDependency,
) -> ApiResponse[SupplierResponse]:
    supplier = get_supplier_service(
        supplier_repo=supplier_repo,
        supplier_id=supplier_id,
    )

    return ApiResponse(
        message="Supplier retrieved successfully",
        data=supplier,
    )


@router.put(
    "/{supplier_id}",
    response_model=ApiResponse[SupplierResponse],
)
def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    db: DatabaseSession,
    supplier_repo: SupplierRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[SupplierResponse]:
    supplier = update_supplier_service(
        db=db,
        supplier_repo=supplier_repo,
        supplier_id=supplier_id,
        data=data,
    )

    return ApiResponse(
        message="Supplier updated successfully",
        data=supplier,
    )


@router.delete(
    "/{supplier_id}",
    response_model=ApiResponse[SupplierResponse],
)
def delete_supplier(
    supplier_id: int,
    db: DatabaseSession,
    supplier_repo: SupplierRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[SupplierResponse]:
    supplier = delete_supplier_service(
        db=db,
        supplier_repo=supplier_repo,
        supplier_id=supplier_id,
    )

    return ApiResponse(
        message="Supplier deleted successfully",
        data=supplier,
    )
