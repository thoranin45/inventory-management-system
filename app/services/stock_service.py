from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.exceptions import (
    BatchStockAdjustmentException,
    DefaultStorageNotConfiguredException,
    InsufficientBatchStockException,
    InsufficientStockException,
    ProductNotFoundException,
    StockBalanceNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    InventoryMovement,
    ProductBatch,
    StockTransaction,
)
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.repositories.stock_repository import (
    StockRepository,
)
from app.schemas.stock_schema import (
    StockAdjust,
    StockIn,
    StockOperationResponse,
    StockOut,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
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
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockIn,
    created_by_user_id: int | None,
) -> StockOperationResponse:
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    previous_stock = product.stock_qty

    with UnitOfWork(db):
        balance = (
            balance_repo.get_default_product_balance(
                product.id
            )
        )

        if balance is None:
            storage = balance_repo.get_default_storage()

            if storage is None:
                raise DefaultStorageNotConfiguredException()

            balance = (
                balance_repo.create_default_product_balance(
                    product.id
                )
            )

        balance_before = balance.on_hand_qty

        product.stock_qty += data.quantity
        balance.on_hand_qty += data.quantity

        balance_after = balance.on_hand_qty

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="IN",
            quantity=data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(
            transaction
        )

        movement = InventoryMovement(
            product_id=product.id,
            batch_id=None,
            warehouse_id=balance.warehouse_id,
            location_id=balance.location_id,
            movement_type="STOCK_IN",
            quantity=data.quantity,
            balance_before=balance_before,
            balance_after=balance_after,
            reference_type="STOCK_TRANSACTION",
            reference_id=transaction.id,
            reference_number=None,
            remark=data.remark,
            created_by_user_id=created_by_user_id,
        )

        movement_repo.create(
            movement
        )

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
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockOut,
    created_by_user_id: int | None,
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
        (
            batch.quantity
            for batch in batches
        ),
        Decimal("0"),
    )

    if batch_stock_total < data.quantity:
        raise InsufficientBatchStockException()

    previous_stock = product.stock_qty
    remaining_quantity = data.quantity

    with UnitOfWork(db):
        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="OUT_FIFO",
            quantity=-data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(
            transaction
        )

        for batch in batches:
            if remaining_quantity <= 0:
                break

            balance = (
                balance_repo.get_default_batch_balance(
                    product_id=product.id,
                    batch_id=batch.id,
                )
            )

            if balance is None:
                raise StockBalanceNotFoundException()

            quantity_to_deduct = min(
                batch.quantity,
                remaining_quantity,
            )

            available_qty = (
                balance.on_hand_qty
                - balance.reserved_qty
            )

            if available_qty < quantity_to_deduct:
                raise InsufficientStockException()

            balance_before = balance.on_hand_qty

            batch.quantity -= quantity_to_deduct
            balance.on_hand_qty -= quantity_to_deduct

            balance_after = balance.on_hand_qty

            movement = InventoryMovement(
                product_id=product.id,
                batch_id=batch.id,
                warehouse_id=balance.warehouse_id,
                location_id=balance.location_id,
                movement_type="STOCK_OUT_FIFO",
                quantity=-quantity_to_deduct,
                balance_before=balance_before,
                balance_after=balance_after,
                reference_type="STOCK_TRANSACTION",
                reference_id=transaction.id,
                reference_number=None,
                remark=data.remark,
                created_by_user_id=created_by_user_id,
            )

            movement_repo.create(
                movement
            )

            remaining_quantity -= quantity_to_deduct

        if remaining_quantity > 0:
            raise InsufficientBatchStockException()

        product.stock_qty -= data.quantity

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
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockOut,
    created_by_user_id: int | None,
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
        (
            batch.quantity
            for batch in batches
        ),
        Decimal("0"),
    )

    if batch_stock_total < data.quantity:
        raise InsufficientBatchStockException()

    previous_stock = product.stock_qty
    remaining_quantity = data.quantity

    with UnitOfWork(db):
        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="OUT_FEFO",
            quantity=-data.quantity,
            remark=data.remark,
        )

        stock_repo.create_transaction(
            transaction
        )

        for batch in batches:
            if remaining_quantity <= 0:
                break

            balance = (
                balance_repo.get_default_batch_balance(
                    product_id=product.id,
                    batch_id=batch.id,
                )
            )

            if balance is None:
                raise StockBalanceNotFoundException()

            quantity_to_deduct = min(
                batch.quantity,
                remaining_quantity,
            )

            available_qty = (
                balance.on_hand_qty
                - balance.reserved_qty
            )

            if available_qty < quantity_to_deduct:
                raise InsufficientStockException()

            balance_before = balance.on_hand_qty

            batch.quantity -= quantity_to_deduct
            balance.on_hand_qty -= quantity_to_deduct

            balance_after = balance.on_hand_qty

            movement = InventoryMovement(
                product_id=product.id,
                batch_id=batch.id,
                warehouse_id=balance.warehouse_id,
                location_id=balance.location_id,
                movement_type="STOCK_OUT_FEFO",
                quantity=-quantity_to_deduct,
                balance_before=balance_before,
                balance_after=balance_after,
                reference_type="STOCK_TRANSACTION",
                reference_id=transaction.id,
                reference_number=None,
                remark=data.remark,
                created_by_user_id=created_by_user_id,
            )

            movement_repo.create(
                movement
            )

            remaining_quantity -= quantity_to_deduct

        if remaining_quantity > 0:
            raise InsufficientBatchStockException()

        product.stock_qty -= data.quantity

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
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockAdjust,
    created_by_user_id: int | None,
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

    balance = (
        balance_repo.get_default_product_balance(
            product.id
        )
    )

    if balance is None:
        raise StockBalanceNotFoundException()

    previous_stock = product.stock_qty
    difference = (
        data.new_quantity
        - previous_stock
    )

    balance_before = balance.on_hand_qty

    with UnitOfWork(db):
        product.stock_qty = data.new_quantity
        balance.on_hand_qty = data.new_quantity

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="ADJUST",
            quantity=difference,
            remark=data.remark,
        )

        stock_repo.create_transaction(
            transaction
        )

        # ถ้า quantity ไม่เปลี่ยน ไม่ควรสร้าง
        # InventoryMovement เพราะ DB กำหนด
        # quantity <> 0
        if difference != Decimal("0"):
            movement = InventoryMovement(
                product_id=product.id,
                batch_id=None,
                warehouse_id=balance.warehouse_id,
                location_id=balance.location_id,
                movement_type="STOCK_ADJUST",
                quantity=difference,
                balance_before=balance_before,
                balance_after=balance.on_hand_qty,
                reference_type="STOCK_TRANSACTION",
                reference_id=transaction.id,
                reference_number=None,
                remark=data.remark,
                created_by_user_id=(
                    created_by_user_id
                ),
            )

            movement_repo.create(
                movement
            )

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