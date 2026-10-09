import hashlib
import json
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.exceptions import (
    BatchStockAdjustmentException,
    BatchTrackedAdjustmentException,
    BatchTrackedStockInException,
    IdempotencyKeyConflictException,
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
    StockOperationReceipt,
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


def _stock_in_fingerprint(data: StockIn) -> str:
    """Canonical hash of every stock-affecting field of a /stock/in request.

    Two requests with the same Idempotency-Key must carry byte-identical
    business intent or the second is rejected. Storage defaults hash as a
    stable token, never a lookup of mutable master data (mirrors PO receipts).
    """
    payload = {
        "version": 1,
        "operation": "STOCK_IN",
        "product_id": data.product_id,
        "quantity": format(data.quantity, ".3f"),
        "storage": "MAIN/DEFAULT"
        if data.warehouse_id is None and data.location_id is None
        else [data.warehouse_id, data.location_id],
        "remark": data.remark or None,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def stock_in_service(
    db: Session,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockIn,
    created_by_user_id: int | None,
    operation_key: str | None = None,
) -> StockOperationResponse:

    fingerprint = _stock_in_fingerprint(data)

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])

        # Idempotency replay/mismatch check runs *after* the per-product
        # advisory lock so a concurrent retry of the same key serialises here
        # and replays the stored response instead of applying stock twice.
        if operation_key is not None:
            existing = stock_repo.get_operation_receipt(operation_key)
            if existing is not None:
                if (
                    existing.operation_type != "STOCK_IN"
                    or existing.request_fingerprint != fingerprint
                ):
                    raise IdempotencyKeyConflictException()
                return StockOperationResponse.model_validate(existing.response_snapshot)

        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        product = (
            stock_repo
            .get_active_product_for_update(
                data.product_id
            )
        )

        if product is None:
            raise ProductNotFoundException()

        # Server-side tracking invariant: a batch-tracked product must be
        # received with a lot number (POST /batches). Direct /stock/in would
        # add un-lotted stock to the batch_id=NULL balance and permanently
        # split its inventory. Frontend routing is not the only guard.
        if product.track_batch:
            raise BatchTrackedStockInException()

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

        actor = db.get(User, created_by_user_id) if created_by_user_id is not None else None
        db.add(AuditLog(
            username=actor.username if actor else "system",
            action="STOCK_IN",
            table_name="stock_transactions",
            record_id=transaction.id,
            description=(
                f"Product {product.id}; +{data.quantity} into "
                f"{warehouse.warehouse_code}/{location.location_code}; "
                f"actor_id={created_by_user_id}"
            ),
        ))

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

        result = StockOperationResponse(
            product_id=product.id,
            product_name=product.product_name,
            previous_stock=previous_stock,
            current_stock=product.stock_qty,
            difference=data.quantity,
        )

        # Persist the durable replay record inside the same transaction as the
        # stock movement it describes, so a retry of this key can only ever
        # replay a committed result.
        if operation_key is not None:
            stock_repo.create_operation_receipt(StockOperationReceipt(
                operation_type="STOCK_IN",
                operation_key=operation_key,
                request_fingerprint=fingerprint,
                response_snapshot=result.model_dump(mode="json"),
                created_by_user_id=created_by_user_id,
            ))

    return result


def _stock_out_fingerprint(data: StockOut, operation: str) -> str:
    """Canonical hash of every stock-affecting field of a /stock/out-fifo or
    /stock/out-fefo request.

    `operation` ("STOCK_OUT_FIFO" / "STOCK_OUT_FEFO") is folded into the hash
    itself, not just stored as a separate operation_type column check — a key
    cannot be replayed across the two strategies even if every other field
    happens to match. FIFO/FEFO select batches algorithmically, so (unlike a
    batch receipt) no lot/batch_id belongs in the fingerprint — the caller
    never names one.
    """
    payload = {
        "version": 1,
        "operation": operation,
        "product_id": data.product_id,
        "quantity": format(data.quantity, ".3f"),
        "storage": "MAIN/DEFAULT"
        if data.warehouse_id is None and data.location_id is None
        else [data.warehouse_id, data.location_id],
        "remark": data.remark or None,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def stock_out_fifo_service(
    db: Session,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockOut,
    created_by_user_id: int | None,
    operation_key: str | None = None,
) -> StockOperationResponse:

    fingerprint = _stock_out_fingerprint(data, "STOCK_OUT_FIFO")

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])

        # Idempotency replay/mismatch check runs *after* the per-product
        # advisory lock so a concurrent retry of the same key serialises here
        # and replays the stored response instead of deducting stock twice.
        if operation_key is not None:
            existing = stock_repo.get_operation_receipt(operation_key)
            if existing is not None:
                if (
                    existing.operation_type != "STOCK_OUT_FIFO"
                    or existing.request_fingerprint != fingerprint
                ):
                    raise IdempotencyKeyConflictException()
                return StockOperationResponse.model_validate(existing.response_snapshot)

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

        actor = db.get(User, created_by_user_id) if created_by_user_id is not None else None
        db.add(AuditLog(
            username=actor.username if actor else "system",
            action="STOCK_OUT_FIFO",
            table_name="stock_transactions",
            record_id=transaction.id,
            description=(
                f"Product {product.id}; -{data.quantity} from "
                f"{warehouse.warehouse_code}/{location.location_code}; "
                f"actor_id={created_by_user_id}"
            ),
        ))

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

        result = StockOperationResponse(
            product_id=product.id,
            product_name=product.product_name,
            previous_stock=previous_stock,
            current_stock=product.stock_qty,
            difference=-data.quantity,
        )

        # Persist the durable replay record inside the same transaction as the
        # stock movements and audit entry it describes, so a retry of this key
        # can only ever replay a committed result.
        if operation_key is not None:
            stock_repo.create_operation_receipt(StockOperationReceipt(
                operation_type="STOCK_OUT_FIFO",
                operation_key=operation_key,
                request_fingerprint=fingerprint,
                response_snapshot=result.model_dump(mode="json"),
                created_by_user_id=created_by_user_id,
            ))

    return result


def stock_out_fefo_service(
    db: Session,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: StockOut,
    created_by_user_id: int | None,
    operation_key: str | None = None,
) -> StockOperationResponse:

    fingerprint = _stock_out_fingerprint(data, "STOCK_OUT_FEFO")

    with UnitOfWork(db):
        balance_repo.lock_inventory([data.product_id])

        # Idempotency replay/mismatch check runs *after* the per-product
        # advisory lock so a concurrent retry of the same key serialises here
        # and replays the stored response instead of deducting stock twice.
        if operation_key is not None:
            existing = stock_repo.get_operation_receipt(operation_key)
            if existing is not None:
                if (
                    existing.operation_type != "STOCK_OUT_FEFO"
                    or existing.request_fingerprint != fingerprint
                ):
                    raise IdempotencyKeyConflictException()
                return StockOperationResponse.model_validate(existing.response_snapshot)

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

        actor = db.get(User, created_by_user_id) if created_by_user_id is not None else None
        db.add(AuditLog(
            username=actor.username if actor else "system",
            action="STOCK_OUT_FEFO",
            table_name="stock_transactions",
            record_id=transaction.id,
            description=(
                f"Product {product.id}; -{data.quantity} from "
                f"{warehouse.warehouse_code}/{location.location_code}; "
                f"actor_id={created_by_user_id}"
            ),
        ))

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

        result = StockOperationResponse(
            product_id=product.id,
            product_name=product.product_name,
            previous_stock=previous_stock,
            current_stock=product.stock_qty,
            difference=-data.quantity,
        )

        # Persist the durable replay record inside the same transaction as the
        # stock movements and audit entry it describes, so a retry of this key
        # can only ever replay a committed result.
        if operation_key is not None:
            stock_repo.create_operation_receipt(StockOperationReceipt(
                operation_type="STOCK_OUT_FEFO",
                operation_key=operation_key,
                request_fingerprint=fingerprint,
                response_snapshot=result.model_dump(mode="json"),
                created_by_user_id=created_by_user_id,
            ))

    return result


def execute_adjustment_mutation(
    db: Session,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    *,
    product_id: int,
    warehouse,
    location,
    new_quantity: Decimal,
    remark: str | None,
    created_by_user_id: int,
) -> StockOperationResponse:
    """The tested stock-mutation core, shared by every caller that is
    allowed to actually move stock for an adjustment.

    Formerly the body of the direct ``stock_adjust_service`` (Phase 13),
    now also the mutation Phase 14B's ``approve_adjustment_request_service``
    reuses verbatim -- same batch-tracking guard, same locking expectations
    (the caller must already hold ``lock_inventory([product_id])``), same
    decimal handling, same AuditLog/InventoryMovement shape. Takes no new
    transaction of its own; the caller's ``UnitOfWork`` covers this and
    whatever else it does alongside it (e.g. the request's own status flip).
    """
    product = (
        stock_repo
        .get_active_product_for_update(
            product_id
        )
    )

    if product is None:
        raise ProductNotFoundException()

    # Server-side tracking invariant: a batch-tracked product is never
    # adjusted directly, even with zero current batch stock — otherwise a
    # positive adjustment would land on the unbatched (batch_id=None)
    # balance with no lot/expiry, for a product whose tracking mode
    # requires both. Mirrors the track_batch guard on /stock/in and
    # /batches; frontend routing is not the only guard. Re-run at approval
    # time too (not just at request-creation time), in case track_batch
    # flipped in between — Phase 14D must extend this guard, never loosen it.
    if product.track_batch:
        raise BatchTrackedAdjustmentException()

    # Kept as a safety net for pre-existing data: product_service.py
    # already blocks flipping track_batch off while a product carries
    # stock/inventory evidence, so this should be unreachable for data
    # created under that guard — but it still catches anything that
    # predates it or was written directly to the database.
    batch_stock_total = stock_repo.get_batch_stock_total(product_id)

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
        new_quantity
        < balance.reserved_qty
    ):
        raise InsufficientStockException()

    balance_before = (
        balance.on_hand_qty
    )

    difference = (
        Decimal(str(new_quantity))
        - Decimal(str(balance_before))
    )

    balance.on_hand_qty = (
        new_quantity
    )

    transaction = StockTransaction(
        product_id=product.id,
        transaction_type="ADJUST",
        quantity=difference,
        remark=remark,
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
            f"before={balance_before}; after={new_quantity}; "
            f"reason={remark}"
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
            remark=remark,
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
