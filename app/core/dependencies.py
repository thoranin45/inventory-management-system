from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.core.service_dependencies import (
    get_batch_repository,
    get_category_repository,
    get_customer_repository,
    get_dashboard_repository,
    get_product_repository,
    get_purchase_order_repository,
    get_sales_order_repository,
    get_stock_repository,
    get_supplier_repository,
)
from app.database import get_db
from app.models import User
from app.repositories.batch_repository import BatchRepository
from app.repositories.category_repository import CategoryRepository
from app.repositories.customer_repository import CustomerRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.purchase_order_repository import (
    PurchaseOrderRepository,
)
from app.repositories.sales_order_repository import (
    SalesOrderRepository,
)
from app.repositories.dashboard_repository import (
    DashboardRepository,
)
from app.repositories.stock_repository import StockRepository
from app.repositories.supplier_repository import SupplierRepository


DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

CurrentUser = Annotated[
    User,
    Depends(get_current_user),
]


def _get_role_name(
    user: User,
) -> str:
    role = getattr(
        user,
        "role",
        None,
    )

    if role is None:
        return ""

    if hasattr(role, "value"):
        return str(role.value).lower()

    return str(role).lower()


def require_warehouse(
    current_user: CurrentUser,
) -> User:
    role = _get_role_name(
        current_user
    )

    if role not in {
        "warehouse",
        "admin",
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse permission required",
        )

    return current_user


def require_admin(
    current_user: CurrentUser,
) -> User:
    role = _get_role_name(
        current_user
    )

    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permission required",
        )

    return current_user


ProductRepositoryDependency = Annotated[
    ProductRepository,
    Depends(get_product_repository),
]

CategoryRepositoryDependency = Annotated[
    CategoryRepository,
    Depends(get_category_repository),
]

SupplierRepositoryDependency = Annotated[
    SupplierRepository,
    Depends(get_supplier_repository),
]

CustomerRepositoryDependency = Annotated[
    CustomerRepository,
    Depends(get_customer_repository),
]

StockRepositoryDependency = Annotated[
    StockRepository,
    Depends(get_stock_repository),
]

BatchRepositoryDependency = Annotated[
    BatchRepository,
    Depends(get_batch_repository),
]

PurchaseOrderRepositoryDependency = Annotated[
    PurchaseOrderRepository,
    Depends(get_purchase_order_repository),
]

SalesOrderRepositoryDependency = Annotated[
    SalesOrderRepository,
    Depends(get_sales_order_repository),
]

DashboardRepositoryDependency = Annotated[
    DashboardRepository,
    Depends(get_dashboard_repository),
]