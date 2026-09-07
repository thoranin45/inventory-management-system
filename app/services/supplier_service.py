from sqlalchemy.orm import Session

from app.core.exceptions import (
    SupplierAlreadyExistsException,
    SupplierNotFoundException,
)
from app.core.pagination import ListParams, paginate, paginated_body, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import Supplier
from app.repositories.supplier_repository import SupplierRepository
from app.schemas.supplier_schema import (
    SupplierCreate,
    SupplierResponse,
    SupplierUpdate,
)

_SUPPLIER_SORTS = {"id": Supplier.id, "supplier_name": Supplier.supplier_name}


def create_supplier_service(
    db: Session,
    supplier_repo: SupplierRepository,
    data: SupplierCreate,
) -> Supplier:
    """
    Create a new supplier.
    """

    existing_supplier = supplier_repo.get_by_name(
        data.supplier_name
    )

    if existing_supplier is not None:
        raise SupplierAlreadyExistsException()

    supplier = Supplier(
        supplier_name=data.supplier_name,
        contact_name=data.contact_name,
        phone=data.phone,
        email=data.email,
        address=data.address,
    )

    with UnitOfWork(db) as uow:
        supplier_repo.create(supplier)

    uow.refresh(supplier)

    return supplier


def get_suppliers_service(
    supplier_repo: SupplierRepository,
    params: ListParams,
) -> dict:
    ordering = resolve_ordering(params, _SUPPLIER_SORTS, "id", Supplier.id)
    items, total = paginate(
        supplier_repo.list_query(search=params.search), params, ordering
    )
    return paginated_body(
        [SupplierResponse.model_validate(row) for row in items],
        total,
        params,
        "Suppliers retrieved successfully",
    )


def get_supplier_service(
    supplier_repo: SupplierRepository,
    supplier_id: int,
) -> Supplier:
    """
    Get supplier by ID.
    """

    supplier = supplier_repo.get_by_id(
        supplier_id
    )

    if supplier is None:
        raise SupplierNotFoundException()

    return supplier


def update_supplier_service(
    db: Session,
    supplier_repo: SupplierRepository,
    supplier_id: int,
    data: SupplierUpdate,
) -> Supplier:
    """
    Update an existing supplier.
    """

    supplier = supplier_repo.get_by_id(
        supplier_id
    )

    if supplier is None:
        raise SupplierNotFoundException()

    if data.supplier_name is not None:
        existing_supplier = supplier_repo.get_by_name(
            data.supplier_name
        )

        if (
            existing_supplier is not None
            and existing_supplier.id != supplier.id
        ):
            raise SupplierAlreadyExistsException()

    update_data = data.model_dump(
        exclude_unset=True
    )

    for field_name, field_value in update_data.items():
        setattr(
            supplier,
            field_name,
            field_value,
        )

    with UnitOfWork(db) as uow:
        supplier_repo.update(supplier)

    uow.refresh(supplier)

    return supplier


def delete_supplier_service(
    db: Session,
    supplier_repo: SupplierRepository,
    supplier_id: int,
) -> Supplier:
    """
    Delete supplier.
    """

    supplier = supplier_repo.get_by_id(
        supplier_id
    )

    if supplier is None:
        raise SupplierNotFoundException()

    with UnitOfWork(db):
        supplier_repo.delete(supplier)

    return supplier