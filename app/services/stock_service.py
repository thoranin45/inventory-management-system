from decimal import Decimal

from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.exceptions import (
    BatchStockAdjustmentException,
    InsufficientBatchStockException,
    InsufficientStockException,
    ProductNotFoundException,
    StockBalanceNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    User,
    InventoryMovement,
    ProductBatch,
    StockTransaction,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
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


def stock_in_service(
    db: Session,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockIn,
    created_by_user_id: int | None,
) -> StockOperationResponse:

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])
        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        product = (
            stock_repo
            .get_active_product_for_update(
                data.product_id
            )
        )

        if product is None:
            raise ProductNotFoundException()

        previous_stock = balance_repo.product_quantity(product.id)

        balance = (
            balance_repo
            .get_balance_for_update(
                product_id=product.id, warehouse_id=warehouse.id, location_id=location.id, batch_id=None,
            )
        )

        if balance is None:
            balance = (
                balance_repo
                .get_or_create_balance(
                    product_id=product.id, warehouse_id=warehouse.id, location_id=location.id, batch_id=None,
                )
            )

        balance_before = (
            balance.on_hand_qty
        )

        balance.on_hand_qty += (
            data.quantity
        )

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

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

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

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])
        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        product = (
            stock_repo
            .get_active_product_for_update(
                data.product_id
            )
        )

        if product is None:
            raise ProductNotFoundException()

        previous_stock = balance_repo.product_quantity(product.id)

        today = batch_eligibility.business_today()

        # FIFO must never become an expiry bypass: expired dated lots are skipped;
        # NULL-expiry / non-expiry-tracked lots keep their existing FIFO behavior.
        batches = (
            stock_repo
            .get_fifo_batches_for_update(
                product.id, eligible_only=True, today=today,
            )
        )

        if previous_stock < data.quantity:
            raise InsufficientStockException()
        if stock_repo.get_eligible_batch_stock_total(product.id, warehouse.id, location.id, today) < data.quantity:
            raise InsufficientBatchStockException()

        remaining_quantity = (
            data.quantity
        )

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
                balance_repo
                .get_balance_for_update(
                    product_id=product.id, warehouse_id=warehouse.id, location_id=location.id,
                    batch_id=batch.id,
                )
            )

            if balance is None:
                continue

            available_qty = (
                balance.on_hand_qty
                - balance.reserved_qty
            )

            if available_qty <= 0:
                continue

            quantity_to_deduct = min(
                available_qty,
                remaining_quantity,
            )

            if quantity_to_deduct <= 0:
                continue

            balance_before = (
                balance.on_hand_qty
            )

            balance.on_hand_qty -= (
                quantity_to_deduct
            )

            movement = InventoryMovement(
                product_id=product.id,
                batch_id=batch.id,
                warehouse_id=(
                    balance.warehouse_id
                ),
                location_id=(
                    balance.location_id
                ),
                movement_type=(
                    "STOCK_OUT_FIFO"
                ),
                quantity=(
                    -quantity_to_deduct
                ),
                balance_before=(
                    balance_before
                ),
                balance_after=(
                    balance.on_hand_qty
                ),
                reference_type=(
                    "STOCK_TRANSACTION"
                ),
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

            remaining_quantity -= (
                quantity_to_deduct
            )

        if remaining_quantity > 0:
            raise InsufficientStockException()

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

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

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])
        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        product = (
            stock_repo
            .get_active_product_for_update(
                data.product_id
            )
        )

        if product is None:
            raise ProductNotFoundException()

        previous_stock = balance_repo.product_quantity(product.id)

        today = batch_eligibility.business_today()

        # FEFO selects First Expired First Out among eligible lots only; expired
        # lots are never selected even though they would sort first.
        batches = (
            stock_repo
            .get_fefo_batches_for_update(
                product.id, eligible_only=True, today=today,
            )
        )

        if previous_stock < data.quantity:
            raise InsufficientStockException()
        if stock_repo.get_eligible_batch_stock_total(product.id, warehouse.id, location.id, today) < data.quantity:
            raise InsufficientBatchStockException()

        remaining_quantity = (
            data.quantity
        )

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
                balance_repo
                .get_balance_for_update(
                    product_id=product.id, warehouse_id=warehouse.id, location_id=location.id,
                    batch_id=batch.id,
                )
            )

            if balance is None:
                continue

            available_qty = (
                balance.on_hand_qty
                - balance.reserved_qty
            )

            if available_qty <= 0:
                continue

            quantity_to_deduct = min(
                available_qty,
                remaining_quantity,
            )

            if quantity_to_deduct <= 0:
                continue

            balance_before = (
                balance.on_hand_qty
            )

            balance.on_hand_qty -= (
                quantity_to_deduct
            )

            movement = InventoryMovement(
                product_id=product.id,
                batch_id=batch.id,
                warehouse_id=(
                    balance.warehouse_id
                ),
                location_id=(
                    balance.location_id
                ),
                movement_type=(
                    "STOCK_OUT_FEFO"
                ),
                quantity=(
                    -quantity_to_deduct
                ),
                balance_before=(
                    balance_before
                ),
                balance_after=(
                    balance.on_hand_qty
                ),
                reference_type=(
                    "STOCK_TRANSACTION"
                ),
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

            remaining_quantity -= (
                quantity_to_deduct
            )

        if remaining_quantity > 0:
            raise InsufficientStockException()

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

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
    created_by_user_id: int,
) -> StockOperationResponse:

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])
        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        product = (
            stock_repo
            .get_active_product_for_update(
                data.product_id
            )
        )

        if product is None:
            raise ProductNotFoundException()

        batch_stock_total = stock_repo.get_batch_stock_total(data.product_id)

        if batch_stock_total > 0:
            raise BatchStockAdjustmentException()

        previous_stock = balance_repo.product_quantity(product.id)

        balance = (
            balance_repo
            .get_balance_for_update(
                product_id=product.id, warehouse_id=warehouse.id, location_id=location.id, batch_id=None,
            )
        )

        if balance is None:
            balance = (
                balance_repo
                .get_or_create_balance(
                    product_id=product.id, warehouse_id=warehouse.id, location_id=location.id, batch_id=None,
                )
            )

        if (
            data.new_quantity
            < balance.reserved_qty
        ):
            raise InsufficientStockException()

        balance_before = (
            balance.on_hand_qty
        )

        difference = (
            Decimal(str(data.new_quantity))
            - Decimal(str(balance_before))
        )

        balance.on_hand_qty = (
            data.new_quantity
        )

        transaction = StockTransaction(
            product_id=product.id,
            transaction_type="ADJUST",
            quantity=difference,
            remark=data.remark,
        )

        stock_repo.create_transaction(
            transaction
        )

        actor = db.get(User, created_by_user_id) if created_by_user_id is not None else None
        if actor is None:
            raise ValueError("Authenticated adjustment actor is required")

        db.add(AuditLog(
            username=actor.username,
            action="STOCK_ADJUST",
            table_name="stock_transactions",
            record_id=transaction.id,
            description=(
                f"Product {product.id}; actor_id={actor.id}; "
                f"before={balance_before}; after={data.new_quantity}; "
                f"reason={data.remark}"
            ),
        ))

        if difference != Decimal("0"):
            movement = InventoryMovement(
                product_id=product.id,
                batch_id=None,
                warehouse_id=(
                    balance.warehouse_id
                ),
                location_id=(
                    balance.location_id
                ),
                movement_type="STOCK_ADJUST",
                quantity=difference,
                balance_before=(
                    balance_before
                ),
                balance_after=(
                    balance.on_hand_qty
                ),
                reference_type=(
                    "STOCK_TRANSACTION"
                ),
                reference_id=(
                    transaction.id
                ),
                reference_number=None,
                remark=data.remark,
                created_by_user_id=(
                    created_by_user_id
                ),
            )

            movement_repo.create(
                movement
            )

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

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
