from decimal import Decimal

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

        balance_repo.sync_aggregates(product.id, f"user_id={created_by_user_id}")

    uow.refresh(batch)
    uow.refresh(product)

    return BatchCreateResponse(
        batch=BatchResponse.model_validate(batch),
        current_stock=product.stock_qty,
    )


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
