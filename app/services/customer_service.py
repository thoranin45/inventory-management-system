from sqlalchemy.orm import Session

from app.core.exceptions import (
    CustomerAlreadyExistsException,
    CustomerNotFoundException,
)
from app.core.pagination import ListParams, paginate, paginated_body, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import Customer
from app.repositories.customer_repository import CustomerRepository
from app.schemas.customer_schema import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
)

_CUSTOMER_SORTS = {"id": Customer.id, "customer_name": Customer.customer_name}


def create_customer_service(
    db: Session,
    customer_repo: CustomerRepository,
    data: CustomerCreate,
) -> Customer:
    existing_customer = customer_repo.get_by_name(
        data.customer_name
    )

    if existing_customer is not None:
        raise CustomerAlreadyExistsException()

    customer = Customer(
        customer_name=data.customer_name,
        phone=data.phone,
        email=data.email,
        address=data.address,
    )

    with UnitOfWork(db) as uow:
        customer_repo.create(customer)

    uow.refresh(customer)

    return customer


def get_customers_service(
    customer_repo: CustomerRepository,
    params: ListParams,
) -> dict:
    ordering = resolve_ordering(params, _CUSTOMER_SORTS, "id", Customer.id)
    items, total = paginate(
        customer_repo.list_query(search=params.search), params, ordering
    )
    return paginated_body(
        [CustomerResponse.model_validate(row) for row in items],
        total,
        params,
        "Customers retrieved successfully",
    )


def get_customer_service(
    customer_repo: CustomerRepository,
    customer_id: int,
) -> Customer:
    customer = customer_repo.get_by_id(
        customer_id
    )

    if customer is None:
        raise CustomerNotFoundException()

    return customer


def update_customer_service(
    db: Session,
    customer_repo: CustomerRepository,
    customer_id: int,
    data: CustomerUpdate,
) -> Customer:
    customer = customer_repo.get_by_id(
        customer_id
    )

    if customer is None:
        raise CustomerNotFoundException()

    if data.customer_name is not None:
        existing_customer = customer_repo.get_by_name(
            data.customer_name
        )

        if (
            existing_customer is not None
            and existing_customer.id != customer.id
        ):
            raise CustomerAlreadyExistsException()

    update_data = data.model_dump(
        exclude_unset=True
    )

    for field_name, field_value in update_data.items():
        setattr(
            customer,
            field_name,
            field_value,
        )

    with UnitOfWork(db) as uow:
        customer_repo.update(customer)

    uow.refresh(customer)

    return customer


def delete_customer_service(
    db: Session,
    customer_repo: CustomerRepository,
    customer_id: int,
) -> Customer:
    customer = customer_repo.get_by_id(
        customer_id
    )

    if customer is None:
        raise CustomerNotFoundException()

    with UnitOfWork(db):
        customer_repo.delete(customer)

    return customer