from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from decimal import Decimal

from app.core.exceptions import IdempotencyKeyConflictException
from app.models import (
    Product,
    ProductBatch,
    StockBalance,
    StockOperationReceipt,
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

    # ------------------------------------------------------------------ #
    # Phase 12C.0: parent-less stock-intake idempotency
    # ------------------------------------------------------------------ #
    def get_operation_receipt(
        self,
        operation_key: str,
    ) -> StockOperationReceipt | None:
        return (
            self.db.query(StockOperationReceipt)
            .filter(StockOperationReceipt.operation_key == operation_key)
            .first()
        )

    def create_operation_receipt(
        self,
        receipt: StockOperationReceipt,
    ) -> StockOperationReceipt:
        """Insert the durable idempotency record, racing safely.

        ``operation_key`` is globally unique with no parent row to lock
        (unlike PO/transfer receipts, scoped by their parent id). Two
        concurrent requests that reuse the same key for *different* products
        lock different rows in `lock_inventory` and so are not serialised
        against each other there — both can pass the caller's synchronous
        "no existing receipt" check and race to this INSERT. The nested
        transaction (SAVEPOINT) means a lost race raises and rolls back only
        this insert, not the whole session, so we can convert the unique
        violation into the same clean 409 the synchronous mismatch path
        raises; the caller's outer UnitOfWork then rolls back the rest of
        the operation too (no partial stock apply either way).
        """
        try:
            with self.db.begin_nested():
                self.db.add(receipt)
                self.db.flush()
        except IntegrityError as exc:
            if "uq_stock_operation_receipt_key" in str(exc.orig).lower():
                raise IdempotencyKeyConflictException() from exc
            raise

        return receipt
