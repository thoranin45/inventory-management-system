import hashlib
import json
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.exceptions import (
    DefaultStorageNotConfiguredException,
    DuplicateLotNumberException,
    IdempotencyKeyConflictException,
    InvalidBatchDateException,
    MissingBatchDatesException,
    NonBatchProductBatchException,
    PartialBatchDatesException,
    ProductNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    InventoryMovement,
    ProductBatch,
    StockOperationReceipt,
    StockTransaction,
    User,
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


def _batch_in_fingerprint(data: BatchCreate) -> str:
    """Canonical hash of every stock-affecting field of a POST /batches request."""
    payload = {
        "version": 1,
        "operation": "BATCH_IN",
        "product_id": data.product_id,
        "lot_no": data.lot_no,
        "mfg_date": data.mfg_date.isoformat() if data.mfg_date else None,
        "expiry_date": data.expiry_date.isoformat() if data.expiry_date else None,
        "quantity": format(data.quantity, ".3f"),
        "storage": "MAIN/DEFAULT"
        if data.warehouse_id is None and data.location_id is None
        else [data.warehouse_id, data.location_id],
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def create_batch_service(
    db: Session,
    stock_repo: StockRepository,
    batch_repo: BatchRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    data: BatchCreate,
    created_by_user_id: int | None,
    operation_key: str | None = None,
) -> BatchCreateResponse:
    fingerprint = _batch_in_fingerprint(data)

    balance_repo.lock_inventory([data.product_id])

    # Idempotency replay/mismatch check, serialised behind the per-product
    # advisory lock: a retried Save-once Stock-In session replays the stored
    # response instead of creating a second lot.
    if operation_key is not None:
        existing = stock_repo.get_operation_receipt(operation_key)
        if existing is not None:
            if (
                existing.operation_type != "BATCH_IN"
                or existing.request_fingerprint != fingerprint
            ):
                raise IdempotencyKeyConflictException()
            return BatchCreateResponse.model_validate(existing.response_snapshot)

    warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
    product = stock_repo.get_active_product(
        data.product_id
    )

    if product is None:
        raise ProductNotFoundException()

    # Server-side tracking invariant: a batch only exists for a batch-tracked
    # product. A batch on a non-batch product would strand stock on a batch
    # balance and break direct adjustment. Frontend routing is not the only
    # guard.
    if not product.track_batch:
        raise NonBatchProductBatchException()

    # Date requirements follow the tracking mode (mirrors PO receiving):
    #   track_expiry=True  -> both dates required
    #   track_expiry=False -> both optional, but all-or-nothing
    if product.track_expiry:
        if data.mfg_date is None or data.expiry_date is None:
            raise MissingBatchDatesException()
    else:
        if (data.mfg_date is None) != (data.expiry_date is None):
            raise PartialBatchDatesException()
    if (
        data.mfg_date is not None
        and data.expiry_date is not None
        and data.expiry_date <= data.mfg_date
    ):
        raise InvalidBatchDateException()

    existing_batch = batch_repo.get_by_lot_no(
        data.product_id, data.lot_no
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

        actor = db.get(User, created_by_user_id) if created_by_user_id is not None else None
        db.add(AuditLog(
            username=actor.username if actor else "system",
            action="BATCH_IN",
            table_name="product_batches",
            record_id=batch.id,
            description=(
                f"Product {product.id}; lot {data.lot_no}; +{data.quantity} "
                f"into {warehouse.warehouse_code}/{location.location_code}; "
                f"actor_id={created_by_user_id}"
            ),
        ))

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

        # Flush the in-memory aggregate writes before reloading, so the refresh
        # reads the derived stock_qty back instead of discarding it.
        db.flush()
        uow.refresh(batch)
        uow.refresh(product)

        result = BatchCreateResponse(
            batch=BatchResponse.model_validate(batch),
            current_stock=product.stock_qty,
        )

        # Durable replay record, committed with the lot it describes.
        if operation_key is not None:
            stock_repo.create_operation_receipt(StockOperationReceipt(
                operation_type="BATCH_IN",
                operation_key=operation_key,
                request_fingerprint=fingerprint,
                response_snapshot=result.model_dump(mode="json"),
                created_by_user_id=created_by_user_id,
            ))

    return result


def enrich_batches(balance_repo, batches, today, near_expiry_days: int) -> list[dict]:
    """Phase 8: batch rows + derived operational/expiry fields. One grouped query."""
    from app.core import batch_eligibility

    categories = balance_repo.inventory_categories_by_batch(
        today, near_expiry_days, [b.id for b in batches]
    )
    rows = []
    for b in batches:
        cat = categories.get(b.id, {})
        rows.append({
            "id": b.id,
            "product_id": b.product_id,
            "lot_no": b.lot_no,
            "mfg_date": b.mfg_date,
            "expiry_date": b.expiry_date,
            "quantity": b.quantity,
            "created_at": b.created_at,
            "owned_quantity": b.quantity,
            "operational_available_quantity": cat.get("operational_available_quantity", Decimal("0")),
            "transit_quantity": cat.get("transit_quantity", Decimal("0")),
            "days_to_expiry": batch_eligibility.days_to_expiry(b, today),
            "is_expired": batch_eligibility.is_expired(b, today),
            "is_near_expiry": batch_eligibility.is_near_expiry(b, today, near_expiry_days),
            "as_of_date": today,
        })
    return rows


def get_batches_service(
    batch_repo: BatchRepository,
    balance_repo,
    params,
) -> dict:
    from app.core.batch_eligibility import business_today
    from app.core.config import settings
    from app.core.pagination import paginate, paginated_body, resolve_ordering
    from app.models import ProductBatch as _PB

    sorts = {
        "id": _PB.id,
        "created_at": _PB.created_at,
        "expiry_date": _PB.expiry_date,
        "lot_no": _PB.lot_no,
    }
    ordering = resolve_ordering(params, sorts, "created_at", _PB.id)
    items, total = paginate(
        batch_repo.list_query(search=params.search), params, ordering
    )
    today = business_today()
    rows = enrich_batches(balance_repo, items, today, settings.near_expiry_days)
    return paginated_body(rows, total, params, "Batches retrieved successfully")


def get_expiring_batches_service(
    batch_repo: BatchRepository,
) -> list[ProductBatch]:
    return batch_repo.get_expiring()
