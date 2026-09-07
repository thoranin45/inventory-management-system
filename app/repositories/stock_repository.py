from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from decimal import Decimal

from app.models import (
    Product,
    ProductBatch,
    StockBalance,
    StockTransaction,
)


def _eligible_batch_clause(today: date):
    """A batch is eligible when it never expires or has not expired yet (Phase 7)."""
    return or_(
        ProductBatch.expiry_date.is_(None),
        ProductBatch.expiry_date >= today,
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
        *,
        eligible_only: bool = False,
        today: date | None = None,
    ) -> list[ProductBatch]:
        query = (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
            )
        )
        if eligible_only:
            query = query.filter(_eligible_batch_clause(today))
        return (
            query.order_by(
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
        *,
        eligible_only: bool = False,
        today: date | None = None,
    ) -> list[ProductBatch]:
        query = (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.product_id == product_id,
            )
        )
        if eligible_only:
            query = query.filter(_eligible_batch_clause(today))
        return (
            query.order_by(
                ProductBatch.expiry_date.asc().nulls_last(),
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .with_for_update()
            .all()
        )

    def get_eligible_batch_stock_total(
        self,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        today: date,
    ) -> Decimal:
        """SUM(on_hand_qty) over batch balances whose batch is not expired.

        Mirrors ``get_batch_stock_total`` but excludes expired lots, so the
        FEFO/FIFO sufficiency check can never be satisfied by expired stock.
        Reserved quantity is still enforced per-batch inside the deduction loop.
        """
        self.db.flush()
        total = (
            self.db.query(
                func.coalesce(func.sum(StockBalance.on_hand_qty), 0)
            )
            .join(ProductBatch, ProductBatch.id == StockBalance.batch_id)
            .filter(
                StockBalance.product_id == product_id,
                StockBalance.warehouse_id == warehouse_id,
                StockBalance.location_id == location_id,
                StockBalance.batch_id.is_not(None),
                _eligible_batch_clause(today),
            )
            .scalar()
        )
        return Decimal(str(total or 0))

    def get_batch_stock_total(
        self,
        product_id: int,
        warehouse_id: int | None = None,
        location_id: int | None = None,
    ) -> Decimal:
        self.db.flush()
        query = (
            self.db.query(
                func.coalesce(
                    func.sum(StockBalance.on_hand_qty),
                    0,
                )
            )
            .filter(
                StockBalance.product_id == product_id,
                StockBalance.batch_id.is_not(None),
            )
        )
        if warehouse_id is not None:
            query = query.filter(StockBalance.warehouse_id == warehouse_id)
        if location_id is not None:
            query = query.filter(StockBalance.location_id == location_id)
        total = query.scalar()

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
