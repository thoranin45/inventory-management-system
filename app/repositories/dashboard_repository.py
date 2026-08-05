from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Product,
    ProductBatch,
    StockTransaction,
)


class DashboardRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    def count_active_products(
        self,
    ) -> int:
        return (
            self.db.query(Product)
            .filter(
                Product.is_active.is_(True)
            )
            .count()
        )

    def get_total_stock(
        self,
    ) -> int:
        result = (
            self.db.query(
                func.coalesce(
                    func.sum(Product.stock_qty),
                    0,
                )
            )
            .filter(
                Product.is_active.is_(True)
            )
            .scalar()
        )

        return int(result or 0)

    def get_transaction_quantity_sum(
        self,
        transaction_types: set[str],
    ) -> int:
        result = (
            self.db.query(
                func.coalesce(
                    func.sum(StockTransaction.quantity),
                    0,
                )
            )
            .filter(
                StockTransaction.transaction_type.in_(
                    transaction_types
                )
            )
            .scalar()
        )

        return int(result or 0)

    def count_low_stock_products(
        self,
        threshold: int,
    ) -> int:
        return (
            self.db.query(Product)
            .filter(
                Product.is_active.is_(True),
                Product.stock_qty <= threshold,
            )
            .count()
        )

    def get_low_stock_products(
        self,
        threshold: int,
    ) -> list[Product]:
        return (
            self.db.query(Product)
            .filter(
                Product.is_active.is_(True),
                Product.stock_qty <= threshold,
            )
            .order_by(
                Product.stock_qty.asc(),
                Product.id.asc(),
            )
            .all()
        )

    def get_recent_transactions(
        self,
        limit: int,
    ) -> list[StockTransaction]:
        return (
            self.db.query(StockTransaction)
            .order_by(
                StockTransaction.created_at.desc(),
                StockTransaction.id.desc(),
            )
            .limit(limit)
            .all()
        )

    def get_active_products(
        self,
    ) -> list[Product]:
        return (
            self.db.query(Product)
            .filter(
                Product.is_active.is_(True)
            )
            .order_by(
                Product.id.asc()
            )
            .all()
        )

    def get_top_stock_products(
        self,
        limit: int,
    ) -> list[Product]:
        return (
            self.db.query(Product)
            .filter(
                Product.is_active.is_(True)
            )
            .order_by(
                Product.stock_qty.desc(),
                Product.id.asc(),
            )
            .limit(limit)
            .all()
        )

    def get_batches_expiring_between(
        self,
        start_date: date,
        end_date: date,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.expiry_date
                >= start_date,
                ProductBatch.expiry_date
                <= end_date,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )

    def get_expired_batches(
        self,
        today: date,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.expiry_date < today,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )