from sqlalchemy import func
from sqlalchemy.orm import Session

from decimal import Decimal

from app.models import (
    Product,
    ProductBatch,
    StockTransaction,
)


class StockRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    def get_active_product(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id,
                Product.is_active.is_(True),
            )
            .first()
        )

    def get_active_product_for_update(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id,
                Product.is_active.is_(True),
            )
            .with_for_update()
            .first()
        )

    def get_fifo_batches(
        self,
        product_id: int,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )

    def get_fifo_batches_for_update(
        self,
        product_id: int,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .with_for_update()
            .all()
        )

    def get_fefo_batches(
        self,
        product_id: int,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )

    def get_fefo_batches_for_update(
        self,
        product_id: int,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
                ProductBatch.quantity > 0,
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .with_for_update()
            .all()
        )

    def get_batch_stock_total(
        self,
        product_id: int,
    ) -> Decimal:
        total = (
            self.db.query(
                func.coalesce(
                    func.sum(ProductBatch.quantity),
                    0,
                )
            )
            .filter(
                ProductBatch.product_id == product_id,
                ProductBatch.quantity > 0,
            )
            .scalar()
        )

        return Decimal(str(total or 0))

    def create_transaction(
        self,
        transaction: StockTransaction,
    ) -> StockTransaction:
        self.db.add(transaction)
        self.db.flush()

        return transaction

    def get_history(
        self,
    ) -> list[StockTransaction]:
        return (
            self.db.query(StockTransaction)
            .order_by(
                StockTransaction.created_at.desc(),
                StockTransaction.id.desc(),
            )
            .all()
        )