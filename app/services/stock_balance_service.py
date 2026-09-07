from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BatchNotAllowedException,
    BatchNotFoundException,
    BatchRequiredException,
    InvalidStockReservationException,
    ProductNotFoundException,
    StockBalanceAlreadyExistsException,
    StockBalanceNotFoundException,
    WarehouseLocationNotFoundException,
    WarehouseNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    Product,
    ProductBatch,
    StockBalance,
    Warehouse,
    WarehouseLocation,
)
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.schemas.stock_balance_schema import (
    StockBalanceAdjust,
    StockBalanceCreate,
)


def get_stock_balances_service(
    repo: StockBalanceRepository,
) -> list[StockBalance]:
    return repo.get_all()


def get_product_stock_balances_service(
    db: Session,
    repo: StockBalanceRepository,
    product_id: int,
) -> list[StockBalance]:

    product = (
        db.query(Product)
        .filter(
            Product.id == product_id,
            Product.is_active.is_(True),
        )
        .first()
    )

    if product is None:
        raise ProductNotFoundException()

    return repo.get_by_product(
        product_id
    )

def create_stock_balance_service(
    db: Session,
    repo: StockBalanceRepository,
    data: StockBalanceCreate,
) -> StockBalance:

    product = (
        db.query(Product)
        .filter(
            Product.id == data.product_id,
            Product.is_active.is_(True),
        )
        .first()
    )

    if product is None:
        raise ProductNotFoundException()

    warehouse = (
        db.query(Warehouse)
        .filter(
            Warehouse.id == data.warehouse_id,
            Warehouse.is_active.is_(True),
        )
        .first()
    )

    if warehouse is None:
        raise WarehouseNotFoundException()

    location = (
        db.query(WarehouseLocation)
        .filter(
            WarehouseLocation.id
            == data.location_id,
            WarehouseLocation.warehouse_id
            == data.warehouse_id,
            WarehouseLocation.is_active.is_(True),
        )
        .first()
    )

    if location is None:
        raise WarehouseLocationNotFoundException()

    repo.require_operational_storage(data.warehouse_id, data.location_id)

    if product.track_batch and data.batch_id is None:
        raise BatchRequiredException()

    if not product.track_batch and data.batch_id is not None:
        raise BatchNotAllowedException()

    if data.batch_id is not None:
        batch = (
            db.query(ProductBatch)
            .filter(
                ProductBatch.id
                == data.batch_id,
                ProductBatch.product_id
                == data.product_id,
            )
            .first()
        )
        
        if batch is None:
            raise BatchNotFoundException()

    if (
        data.reserved_qty
        > data.on_hand_qty
    ):
        raise InvalidStockReservationException()

    existing = repo.get_exact(
        product_id=data.product_id,
        warehouse_id=data.warehouse_id,
        location_id=data.location_id,
        batch_id=data.batch_id,
    )

    if existing is not None:
        raise StockBalanceAlreadyExistsException()

    if data.on_hand_qty != 0 or data.reserved_qty != 0:
        raise HTTPException(409, "Only zero-balance initialization is allowed; use audited stock operations")
    
    balance = StockBalance(
        product_id=data.product_id,
        warehouse_id=data.warehouse_id,
        location_id=data.location_id,
        batch_id=data.batch_id,
        on_hand_qty=data.on_hand_qty,
        reserved_qty=data.reserved_qty,
    )

    with UnitOfWork(db):
        repo.lock_inventory([data.product_id])
        # A competing initializer may have committed while this request waited.
        if repo.get_exact(
            product_id=data.product_id, warehouse_id=data.warehouse_id,
            location_id=data.location_id, batch_id=data.batch_id,
        ) is not None:
            raise StockBalanceAlreadyExistsException()
        repo.add(balance)

        db.flush()
        db.refresh(balance)

    return balance


def adjust_stock_balance_service(
    db: Session,
    repo: StockBalanceRepository,
    balance_id: int,
    data: StockBalanceAdjust,
) -> StockBalance:

    balance = repo.get_by_id(
        balance_id
    )

    if balance is None:
        raise StockBalanceNotFoundException()

    new_on_hand = (
        data.on_hand_qty
        if data.on_hand_qty is not None
        else balance.on_hand_qty
    )

    new_reserved = (
        data.reserved_qty
        if data.reserved_qty is not None
        else balance.reserved_qty
    )

    if new_reserved > new_on_hand:
        raise InvalidStockReservationException()

    raise HTTPException(409, "Balance quantities are read-only; use audited stock and reservation operations")
