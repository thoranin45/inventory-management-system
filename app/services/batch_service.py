from sqlalchemy.orm import Session

from app.core.exceptions import (
    DefaultStorageNotConfiguredException,
    DuplicateLotNumberException,
    InvalidBatchDateException,
    ProductNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    InventoryMovement,
    ProductBatch,
    StockTransaction,
)
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
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)


def create_batch_service(
    db: Session,
    stock_repo: StockRepository,
    batch_repo: BatchRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: BatchCreate,
    created_by_user_id: int | None,
) -> BatchCreateResponse:
    balance_repo.lock_inventory([data.product_id])
    warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
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

    batch = ProductBatch(
        product_id=data.product_id,
        lot_no=data.lot_no,
        mfg_date=data.mfg_date,
        expiry_date=data.expiry_date,
        quantity=data.quantity,
    )

    with UnitOfWork(db) as uow:
        batch_repo.create(batch)

        balance = (
            balance_repo.get_or_create_balance(
                product_id=product.id, warehouse_id=warehouse.id, location_id=location.id,
                batch_id=batch.id,
            )
        )

        balance.on_hand_qty += data.quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="IN_BATCH",
            quantity=data.quantity,
            remark=f"Lot: {data.lot_no}",
        )

        stock_repo.create_transaction(
            transaction
        )

        movement = InventoryMovement(
            product_id=product.id,
            batch_id=batch.id,
            warehouse_id=balance.warehouse_id,
            location_id=balance.location_id,
            movement_type="BATCH_IN",
            quantity=data.quantity,
            balance_before=0,
            balance_after=data.quantity,
            reference_type="STOCK_TRANSACTION",
            reference_id=transaction.id,
            reference_number=data.lot_no,
            remark=f"Lot: {data.lot_no}",
            created_by_user_id=(
                created_by_user_id
            ),
        )

        movement_repo.create(
            movement
        )

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

    uow.refresh(batch)
    uow.refresh(product)

    return BatchCreateResponse(
        batch=BatchResponse.model_validate(batch),
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