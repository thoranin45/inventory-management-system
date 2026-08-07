from sqlalchemy.orm import Session

from app.core.exceptions import (
    DefaultStorageNotConfiguredException,
    DuplicateLotNumberException,
    InvalidBatchDateException,
    ProductNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import ProductBatch, StockTransaction
from app.repositories.batch_repository import (
    BatchRepository,
)
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.repositories.stock_repository import (
    StockRepository,
)
from app.schemas.batch_schema import (
    BatchCreate,
    BatchCreateResponse,
    BatchResponse,
)


def create_batch_service(
    db: Session,
    stock_repo: StockRepository,
    batch_repo: BatchRepository,
    balance_repo: StockBalanceRepository,
    data: BatchCreate,
) -> BatchCreateResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    if data.expiry_date <= data.mfg_date:
        raise InvalidBatchDateException()

    existing_batch = batch_repo.get_by_lot_no(
        data.lot_no
    )

    if existing_batch is not None:
        raise DuplicateLotNumberException()

    storage = balance_repo.get_default_storage()

    if storage is None:
        raise DefaultStorageNotConfiguredException()

    batch = ProductBatch(
        product_id=data.product_id,
        lot_no=data.lot_no,
        mfg_date=data.mfg_date,
        expiry_date=data.expiry_date,
        quantity=data.quantity,
    )

    with UnitOfWork(db) as uow:
        batch_repo.create(batch)

        # ต้องมี batch.id ก่อนสร้าง StockBalance
        db.flush()

        balance_repo.create_default_batch_balance(
            product_id=product.id,
            batch_id=batch.id,
            on_hand_qty=data.quantity,
        )

        product.stock_qty += data.quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="IN_BATCH",
            quantity=data.quantity,
            remark=f"Lot: {data.lot_no}",
        )

        stock_repo.create_transaction(
            transaction
        )

    uow.refresh(batch)
    uow.refresh(product)

    return BatchCreateResponse(
        batch=BatchResponse.model_validate(
            batch
        ),
        current_stock=product.stock_qty,
    )


def get_batches_service(
    batch_repo: BatchRepository,
) -> list[ProductBatch]:
    return batch_repo.get_all()


def get_expiring_batches_service(
    batch_repo: BatchRepository,
) -> list[ProductBatch]:
    return batch_repo.get_expiring()