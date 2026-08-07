from decimal import Decimal
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BatchStockAdjustmentException,
    InsufficientBatchStockException,
    InsufficientStockException,
    ProductNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import ProductBatch, StockTransaction
from app.repositories.stock_repository import StockRepository
from app.schemas.stock_schema import (
    StockAdjust,
    StockIn,
    StockOperationResponse,
    StockOut,
)


def _deduct_from_batches(
    batches: list[ProductBatch],
    requested_quantity: Decimal,
) -> None:
    remaining_quantity = requested_quantity

    for batch in batches:
        if remaining_quantity <= 0:
            break

        quantity_to_deduct = min(
            batch.quantity,
            remaining_quantity,
        )

        batch.quantity -= quantity_to_deduct
        remaining_quantity -= quantity_to_deduct

    if remaining_quantity > 0:
        raise InsufficientBatchStockException()


def stock_in_service(
    db: Session,
    stock_repo: StockRepository,
    data: StockIn,
) -> StockOperationResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    previous_stock = product.stock_qty

    with UnitOfWork(db):
        product.stock_qty += data.quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="IN",
            quantity=data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(transaction)

    return StockOperationResponse(
        product_id=product.id,
        product_name=product.product_name,
        previous_stock=previous_stock,
        current_stock=product.stock_qty,
        difference=data.quantity,
    )


def stock_out_fifo_service(
    db: Session,
    stock_repo: StockRepository,
    data: StockOut,
) -> StockOperationResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    if product.stock_qty < data.quantity:
        raise InsufficientStockException()

    batches = stock_repo.get_fifo_batches(
        data.product_id
    )

    batch_stock_total = sum(
        batch.quantity
        for batch in batches
    )

    if batch_stock_total < data.quantity:
        raise InsufficientBatchStockException()

    previous_stock = product.stock_qty

    with UnitOfWork(db):
        _deduct_from_batches(
            batches=batches,
            requested_quantity=data.quantity,
        )

        product.stock_qty -= data.quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="OUT_FIFO",
            quantity=-data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(transaction)

    return StockOperationResponse(
        product_id=product.id,
        product_name=product.product_name,
        previous_stock=previous_stock,
        current_stock=product.stock_qty,
        difference=-data.quantity,
    )


def stock_out_fefo_service(
    db: Session,
    stock_repo: StockRepository,
    data: StockOut,
) -> StockOperationResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    if product.stock_qty < data.quantity:
        raise InsufficientStockException()

    batches = stock_repo.get_fefo_batches(
        data.product_id
    )

    batch_stock_total = sum(
        batch.quantity
        for batch in batches
    )

    if batch_stock_total < data.quantity:
        raise InsufficientBatchStockException()

    previous_stock = product.stock_qty

    with UnitOfWork(db):
        _deduct_from_batches(
            batches=batches,
            requested_quantity=data.quantity,
        )

        product.stock_qty -= data.quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="OUT_FEFO",
            quantity=-data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(transaction)

    return StockOperationResponse(
        product_id=product.id,
        product_name=product.product_name,
        previous_stock=previous_stock,
        current_stock=product.stock_qty,
        difference=-data.quantity,
    )


def stock_adjust_service(
    db: Session,
    stock_repo: StockRepository,
    data: StockAdjust,
) -> StockOperationResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    batch_stock_total = (
        stock_repo.get_batch_stock_total(
            data.product_id
        )
    )

    if batch_stock_total > 0:
        raise BatchStockAdjustmentException()

    previous_stock = product.stock_qty
    difference = data.new_quantity - previous_stock

    with UnitOfWork(db):
        product.stock_qty = data.new_quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="ADJUST",
            quantity=difference,
            remark=data.remark,
        )

        stock_repo.create_transaction(transaction)

    return StockOperationResponse(
        product_id=product.id,
        product_name=product.product_name,
        previous_stock=previous_stock,
        current_stock=product.stock_qty,
        difference=difference,
    )


def get_stock_history_service(
    stock_repo: StockRepository,
) -> list[StockTransaction]:
    return stock_repo.get_history()