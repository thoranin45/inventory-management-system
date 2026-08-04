from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    CustomerRepositoryDependency,
    DatabaseSession,
    require_admin,
)
from app.models import User
from app.schemas.customer_schema import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
)
from app.schemas.response import ApiResponse
from app.services.customer_service import (
    create_customer_service,
    delete_customer_service,
    get_customer_service,
    get_customers_service,
    update_customer_service,
)


router = APIRouter(
    prefix="/customers",
    tags=["Customers"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[CustomerResponse],
)
def create_customer(
    data: CustomerCreate,
    db: DatabaseSession,
    customer_repo: CustomerRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CustomerResponse]:
    customer = create_customer_service(
        db=db,
        customer_repo=customer_repo,
        data=data,
    )

    return ApiResponse(
        message="Customer created successfully",
        data=customer,
    )


@router.get(
    "",
    response_model=ApiResponse[list[CustomerResponse]],
)
def get_customers(
    customer_repo: CustomerRepositoryDependency,
) -> ApiResponse[list[CustomerResponse]]:
    customers = get_customers_service(
        customer_repo=customer_repo,
    )

    return ApiResponse(
        message="Customers retrieved successfully",
        data=customers,
    )


@router.get(
    "/{customer_id}",
    response_model=ApiResponse[CustomerResponse],
)
def get_customer(
    customer_id: int,
    customer_repo: CustomerRepositoryDependency,
) -> ApiResponse[CustomerResponse]:
    customer = get_customer_service(
        customer_repo=customer_repo,
        customer_id=customer_id,
    )

    return ApiResponse(
        message="Customer retrieved successfully",
        data=customer,
    )


@router.put(
    "/{customer_id}",
    response_model=ApiResponse[CustomerResponse],
)
def update_customer(
    customer_id: int,
    data: CustomerUpdate,
    db: DatabaseSession,
    customer_repo: CustomerRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CustomerResponse]:
    customer = update_customer_service(
        db=db,
        customer_repo=customer_repo,
        customer_id=customer_id,
        data=data,
    )

    return ApiResponse(
        message="Customer updated successfully",
        data=customer,
    )


@router.delete(
    "/{customer_id}",
    response_model=ApiResponse[CustomerResponse],
)
def delete_customer(
    customer_id: int,
    db: DatabaseSession,
    customer_repo: CustomerRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[CustomerResponse]:
    customer = delete_customer_service(
        db=db,
        customer_repo=customer_repo,
        customer_id=customer_id,
    )

    return ApiResponse(
        message="Customer deleted successfully",
        data=customer,
    )