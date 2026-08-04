from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.repositories.batch_repository import BatchRepository
from app.repositories.category_repository import CategoryRepository
from app.repositories.customer_repository import CustomerRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.purchase_order_repository import (
    PurchaseOrderRepository,
)
from app.repositories.stock_repository import StockRepository
from app.repositories.supplier_repository import SupplierRepository


def get_product_repository(
    db: Session = Depends(get_db),
) -> ProductRepository:
    return ProductRepository(db)


def get_category_repository(
    db: Session = Depends(get_db),
) -> CategoryRepository:
    return CategoryRepository(db)


def get_supplier_repository(
    db: Session = Depends(get_db),
) -> SupplierRepository:
    return SupplierRepository(db)


def get_customer_repository(
    db: Session = Depends(get_db),
) -> CustomerRepository:
    return CustomerRepository(db)


def get_stock_repository(
    db: Session = Depends(get_db),
) -> StockRepository:
    return StockRepository(db)


def get_batch_repository(
    db: Session = Depends(get_db),
) -> BatchRepository:
    return BatchRepository(db)


def get_purchase_order_repository(
    db: Session = Depends(get_db)
) -> PurchaseOrderRepository:
    return PurchaseOrderRepository(db)