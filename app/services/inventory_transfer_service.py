from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
import hashlib
import json
from fastapi import HTTPException
from app.core import batch_eligibility
from app.models import AuditLog, InventoryTransferReceipt
from app.schemas.inventory_transfer_schema import InventoryTransferResponse, TransferReceiptResponse

from sqlalchemy.orm import Session

from app.core.exceptions import (
    BatchNotAllowedException,
    BatchNotFoundException,
    BatchRequiredException,
    DuplicateTransferItemException,
    InsufficientStockException,
    InventoryTransferAlreadyCompletedException,
    InventoryTransferCancelledException,
    InventoryTransferNotFoundException,
    InventoryTransferCannotCancelException,
    InvalidTransferLocationException,
    ProductNotFoundException,
    SameTransferLocationException,
    StockBalanceNotFoundException,
    WarehouseLocationNotFoundException,
    WarehouseNotFoundException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    InventoryMovement,
    InventoryTransfer,
    InventoryTransferItem,
    Product,
    ProductBatch,
    Warehouse,
    WarehouseLocation,
)
from app.repositories.inventory_transfer_repository import (
    InventoryTransferRepository,
)
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.schemas.inventory_transfer_schema import (
    InventoryTransferCreate,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)

def _generate_transfer_number() -> str:
    now = datetime.now()

    return (
        "TR-"
        f"{now.strftime('%Y%m%d%H%M%S%f')}"
    )


def create_inventory_transfer_service(
    db: Session,
    repo: InventoryTransferRepository,
    data: InventoryTransferCreate,
    requested_by_user_id: int | None,
) -> InventoryTransfer:

    if data.source_warehouse_id == data.destination_warehouse_id:
        raise HTTPException(409, "Source and destination warehouses must differ")
    source_warehouse = (
        db.query(Warehouse)
        .filter(
            Warehouse.id
            == data.source_warehouse_id,
            Warehouse.is_active.is_(True),
        )
        .first()
    )

    if source_warehouse is None:
        raise WarehouseNotFoundException()

    destination_warehouse = (
        db.query(Warehouse)
        .filter(
            Warehouse.id
            == data.destination_warehouse_id,
            Warehouse.is_active.is_(True),
        )
        .first()
    )

    if destination_warehouse is None:
        raise WarehouseNotFoundException()

    validated_items = []
    seen_items = set()

    for item_data in data.items:
        product = (
            db.query(Product)
            .filter(
                Product.id
                == item_data.product_id,
                Product.is_active.is_(True),
            )
            .first()
        )

        if product is None:
            raise ProductNotFoundException()

        from_location = (
            db.query(WarehouseLocation)
            .filter(
                WarehouseLocation.id
                == item_data.from_location_id,
                WarehouseLocation.is_active.is_(True),
            )
            .first()
        )

        if from_location is None:
            raise WarehouseLocationNotFoundException()

        to_location = (
            db.query(WarehouseLocation)
            .filter(
                WarehouseLocation.id
                == item_data.to_location_id,
                WarehouseLocation.is_active.is_(True),
            )
            .first()
        )

        if to_location is None:
            raise WarehouseLocationNotFoundException()

        if (
            from_location.warehouse_id
            != data.source_warehouse_id
        ):
            raise InvalidTransferLocationException()

        if (
            to_location.warehouse_id
            != data.destination_warehouse_id
        ):
            raise InvalidTransferLocationException()

        if (
            item_data.from_location_id
            == item_data.to_location_id
        ):
            raise SameTransferLocationException()

        # Phase 6: system transit storage is never operationally selectable.
        _reject_transit_storage(source_warehouse, from_location)
        _reject_transit_storage(destination_warehouse, to_location)

        if (
            product.track_batch
            and item_data.batch_id is None
        ):
            raise BatchRequiredException()

        if (
            not product.track_batch
            and item_data.batch_id is not None
        ):
            raise BatchNotAllowedException()

        if item_data.batch_id is not None:
            batch = (
                db.query(ProductBatch)
                .filter(
                    ProductBatch.id
                    == item_data.batch_id,
                    ProductBatch.product_id
                    == item_data.product_id,
                )
                .first()
            )

            if batch is None:
                raise BatchNotFoundException()

        duplicate_key = (
            item_data.product_id,
            item_data.batch_id,
            item_data.from_location_id,
            item_data.to_location_id,
        )

        if duplicate_key in seen_items:
            raise DuplicateTransferItemException()

        seen_items.add(duplicate_key)
        validated_items.append(item_data)

    transfer = InventoryTransfer(
        transfer_number=_generate_transfer_number(),
        status="DRAFT",
        source_warehouse_id=data.source_warehouse_id,
        destination_warehouse_id=(
            data.destination_warehouse_id
        ),
        requested_by_user_id=requested_by_user_id,
        remark=data.remark,
    )

    with UnitOfWork(db):
        repo.create(transfer)

        for item_data in validated_items:
            item = InventoryTransferItem(
                transfer_id=transfer.id,
                product_id=item_data.product_id,
                batch_id=item_data.batch_id,
                from_location_id=(
                    item_data.from_location_id
                ),
                to_location_id=(
                    item_data.to_location_id
                ),
                quantity=item_data.quantity,
                dispatched_quantity=Decimal(0), received_quantity=Decimal(0),
            )

            repo.create_item(item)

        _audit_transfer(db, transfer, requested_by_user_id, "CREATE_TRANSFER")
        db.flush()

    db.refresh(transfer)

    return transfer


def get_inventory_transfers_service(
    repo, params, *, source_warehouse_id=None, destination_warehouse_id=None
) -> dict:
    from app.core.pagination import paginate, paginated_body, resolve_ordering

    sorts = {
        "id": InventoryTransfer.id,
        "created_at": InventoryTransfer.created_at,
        "status": InventoryTransfer.status,
        "transfer_number": InventoryTransfer.transfer_number,
        "dispatched_at": InventoryTransfer.dispatched_at,
    }
    ordering = resolve_ordering(params, sorts, "created_at", InventoryTransfer.id)
    query = repo.list_query(
        search=params.search,
        status=params.status,
        source_warehouse_id=source_warehouse_id,
        destination_warehouse_id=destination_warehouse_id,
    )
    items, total = paginate(query, params, ordering)
    ids = [t.id for t in items]
    item_agg = repo.item_aggregates(ids)
    receipt_agg = repo.receipt_aggregates(ids)
    wh_names = repo.warehouse_names(
        [t.source_warehouse_id for t in items] + [t.destination_warehouse_id for t in items]
    )
    rows = []
    for t in items:
        line_count, total_qty, dispatched, received = item_agg.get(
            t.id, (0, Decimal("0"), Decimal("0"), Decimal("0"))
        )
        outstanding = dispatched - received
        progress_pct = (
            float((received / total_qty * 100).quantize(Decimal("0.1")))
            if total_qty and t.status in {"IN_TRANSIT", "PARTIALLY_RECEIVED", "COMPLETED"}
            else 0.0
        )
        rows.append({
            "id": t.id,
            "transfer_number": t.transfer_number,
            "source_warehouse_id": t.source_warehouse_id,
            "source_warehouse_name": wh_names.get(t.source_warehouse_id),
            "destination_warehouse_id": t.destination_warehouse_id,
            "destination_warehouse_name": wh_names.get(t.destination_warehouse_id),
            "status": t.status,
            "line_count": line_count,
            "total_quantity": total_qty,
            "dispatched_quantity": dispatched,
            "received_quantity": received,
            "outstanding_quantity": outstanding,
            "progress_pct": progress_pct,
            "dispatched_at": t.dispatched_at,
            "latest_receipt_at": receipt_agg.get(t.id),
            "legacy_completed": t.legacy_completed,
        })
    return paginated_body(rows, total, params, "Inventory transfers retrieved successfully")


def get_inventory_transfer_service(
    repo: InventoryTransferRepository,
    transfer_id: int,
) -> InventoryTransfer:
    transfer = repo.get_by_id(
        transfer_id
    )

    if transfer is None:
        raise InventoryTransferNotFoundException()

    return transfer

def complete_inventory_transfer_service(
    db: Session,
    transfer_repo: InventoryTransferRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    transfer_id: int,
    completed_by_user_id: int | None,
) -> InventoryTransfer:

    # Phase 6: immediate completion is retired. The route stays authenticated and
    # reports a missing transfer as 404, otherwise directs clients to dispatch/receive.
    if transfer_repo.get_by_id(transfer_id) is None:
        raise InventoryTransferNotFoundException()
    raise HTTPException(
        409,
        "Immediate transfer completion is retired; dispatch this transfer then receive it",
    )


def cancel_inventory_transfer_service(
    db: Session,
    transfer_repo: InventoryTransferRepository,
    transfer_id: int,
    actor_id: int | None = None,
) -> InventoryTransfer:
    with UnitOfWork(db) as uow:
        transfer = (
            transfer_repo.get_by_id_for_update(
                transfer_id
            )
        )

        if transfer is None:
            raise InventoryTransferNotFoundException()

        if transfer.status == "COMPLETED":
            raise (
                InventoryTransferAlreadyCompletedException()
            )

        if transfer.status == "CANCELLED":
            raise InventoryTransferCancelledException()

        if transfer.status != "DRAFT":
            raise InventoryTransferCancelledException()

        items = transfer_repo.get_items_for_update(transfer.id)
        if not items or any(i.dispatched_quantity != 0 or i.received_quantity != 0 for i in items):
            raise HTTPException(409, "Transfer progress conflicts with draft cancellation")
        transfer.status = "CANCELLED"
        _audit_transfer(db, transfer, actor_id, "CANCEL_TRANSFER")

        db.flush()

    uow.refresh(
        transfer
    )

    return transfer

def _reject_transit_storage(warehouse, location):
    """Phase 6: guard already-resolved storage against the system transit warehouse/location."""
    if (warehouse.warehouse_type == "TRANSIT" or warehouse.warehouse_code == "__TRANSIT__" or
            location.location_type == "TRANSIT" or location.location_code == "__TRANSIT__"):
        raise HTTPException(409, "System transit storage is not operationally selectable")


def _audit_transfer(db, transfer, actor_id, action, detail=""):
    from app.models import User
    user = db.get(User, actor_id) if actor_id else None
    db.add(AuditLog(username=user.username if user else "system", action=action,
                    table_name="inventory_transfers", record_id=transfer.id,
                    description=f"{transfer.transfer_number}: {transfer.status}; {detail}"))


def _locked_transfer(repo, transfer_id, states):
    transfer = repo.get_by_id_for_update(transfer_id)
    if transfer is None:
        raise InventoryTransferNotFoundException()
    if transfer.status not in states or transfer.legacy_completed:
        raise HTTPException(409, f"Transfer state conflict: {transfer.status}")
    items = repo.get_items_for_update(transfer_id)
    if not items:
        raise HTTPException(409, "Transfer has no items")
    return transfer, items


def _validate_transfer_item(db, balances, transfer, item):
    if transfer.source_warehouse_id == transfer.destination_warehouse_id or item.from_location_id == item.to_location_id:
        raise HTTPException(409, "Invalid transfer source/destination")
    balances.resolve_storage(transfer.source_warehouse_id, item.from_location_id)
    balances.resolve_storage(transfer.destination_warehouse_id, item.to_location_id)
    product = db.get(Product, item.product_id)
    if product is None or not product.is_active or bool(product.track_batch) != (item.batch_id is not None):
        raise HTTPException(409, "Invalid transfer product/tracking identity")
    if item.batch_id is not None:
        batch = db.get(ProductBatch, item.batch_id)
        if batch is None or batch.product_id != item.product_id:
            raise HTTPException(409, "Invalid transfer batch identity")
        # Phase 7: an ordinary transfer must not become an expiry bypass. Same-day
        # expiry is still usable; only strictly-past expiry is rejected at dispatch.
        if batch_eligibility.is_expired(batch):
            raise HTTPException(409, f"Cannot dispatch expired batch: {batch.id}")
    if item.quantity <= 0 or item.dispatched_quantity is None or item.received_quantity is None:
        raise HTTPException(409, "Invalid transfer item progress")


def _capacity(balance, quantity):
    if balance.on_hand_qty + quantity > Decimal("999999999999999.999"):
        raise HTTPException(409, "Destination quantity exceeds Numeric(18,3) capacity")


def _transfer_movement(repo, transfer, item, balance, quantity, movement_type, actor_id, receipt_id=None):
    before = balance.on_hand_qty
    balance.on_hand_qty += quantity
    repo.create(InventoryMovement(product_id=item.product_id, batch_id=item.batch_id,
        warehouse_id=balance.warehouse_id, location_id=balance.location_id,
        movement_type=movement_type, quantity=quantity, balance_before=before,
        balance_after=balance.on_hand_qty, reference_type="INVENTORY_TRANSFER",
        reference_id=transfer.id, reference_number=transfer.transfer_number,
        transfer_item_id=item.id, transfer_receipt_id=receipt_id,
        remark=transfer.remark, created_by_user_id=actor_id))


def dispatch_inventory_transfer_service(db, transfer_repo, balance_repo, movement_repo, transfer_id, current_user):
    with UnitOfWork(db):
        transfer, items = _locked_transfer(transfer_repo, transfer_id, {"DRAFT"})
        balance_repo.lock_inventory([i.product_id for i in items])
        transit_warehouse, transit_location = balance_repo.get_transit_storage()
        sources, demand = {}, {}
        for item in items:
            _validate_transfer_item(db, balance_repo, transfer, item)
            if item.dispatched_quantity != 0 or item.received_quantity != 0:
                raise HTTPException(409, "Draft transfer already has progress")
            source = balance_repo.get_balance_for_update(product_id=item.product_id,
                warehouse_id=transfer.source_warehouse_id, location_id=item.from_location_id, batch_id=item.batch_id)
            if source is None:
                raise StockBalanceNotFoundException()
            sources[item.id] = source
            demand[source.id] = demand.get(source.id, Decimal(0)) + item.quantity
        for source in sources.values():
            if source.on_hand_qty - source.reserved_qty < demand[source.id]:
                raise InsufficientStockException()
        for item in items:
            source = sources[item.id]
            transit = balance_repo.get_or_create_balance(product_id=item.product_id,
                warehouse_id=transit_warehouse.id, location_id=transit_location.id, batch_id=item.batch_id)
            if transit.reserved_qty != 0:
                raise HTTPException(409, "Transit has incompatible reservation evidence")
            _capacity(transit, item.quantity)
            item.source_stock_balance_id = source.id
            item.transit_stock_balance_id = transit.id
            _transfer_movement(movement_repo, transfer, item, source, -item.quantity, "TRANSFER_OUT", current_user.id)
            _transfer_movement(movement_repo, transfer, item, transit, item.quantity, "TRANSFER_TRANSIT_IN", current_user.id)
            item.dispatched_quantity = item.quantity
        for product_id in sorted({i.product_id for i in items}):
            balance_repo.sync_aggregates(product_id, current_user.username)
        transfer.status = "IN_TRANSIT"
        transfer.dispatched_at = datetime.now(timezone.utc)
        transfer.dispatched_by_user_id = current_user.id
        _audit_transfer(db, transfer, current_user.id, "DISPATCH_TRANSFER")
    db.refresh(transfer)
    return transfer


def receive_inventory_transfer_service(db, transfer_repo, balance_repo, movement_repo, transfer_id, data, operation_key, current_user):
    payload = {"version": 1, "transfer_id": transfer_id,
               "items": [{"transfer_item_id": i.transfer_item_id, "quantity": format(i.quantity, ".3f")}
                         for i in sorted(data.items, key=lambda i: i.transfer_item_id)]}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with UnitOfWork(db):
        transfer = transfer_repo.get_by_id_for_update(transfer_id)
        if transfer is None:
            raise InventoryTransferNotFoundException()
        existing = db.query(InventoryTransferReceipt).filter_by(transfer_id=transfer_id, operation_key=operation_key).first()
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency-Key already used with a different payload")
            return TransferReceiptResponse.model_validate(existing.response_snapshot)
        transfer, items = _locked_transfer(transfer_repo, transfer_id, {"IN_TRANSIT", "PARTIALLY_RECEIVED"})
        by_id = {i.id: i for i in items}
        for line in data.items:
            item = by_id.get(line.transfer_item_id)
            if item is None:
                raise HTTPException(409, "Transfer item does not belong to this transfer")
            if item.dispatched_quantity != item.quantity or item.received_quantity is None or line.quantity > item.outstanding_quantity:
                raise HTTPException(409, "Receipt exceeds outstanding dispatched quantity")
        balance_repo.lock_inventory([by_id[line.transfer_item_id].product_id for line in data.items])
        transit_warehouse, transit_location = balance_repo.get_transit_storage()
        validated = []
        demand = {}
        for line in data.items:
            item = by_id[line.transfer_item_id]
            # Source identity stays pinned; inactive source does not block physical destination receipt.
            balance_repo.resolve_storage(transfer.destination_warehouse_id, item.to_location_id)
            source = balance_repo.get_by_id(item.source_stock_balance_id)
            transit = balance_repo.get_by_id(item.transit_stock_balance_id)
            if (source is None or (source.product_id, source.batch_id, source.warehouse_id, source.location_id) !=
                    (item.product_id,item.batch_id,transfer.source_warehouse_id,item.from_location_id) or
                    transit is None or (transit.product_id,transit.batch_id,transit.warehouse_id,transit.location_id) !=
                    (item.product_id,item.batch_id,transit_warehouse.id,transit_location.id) or transit.reserved_qty != 0):
                raise HTTPException(409, "Invalid pinned transfer balance identity")
            if item.batch_id is not None:
                batch = db.get(ProductBatch,item.batch_id)
                if batch is None or batch.product_id != item.product_id:
                    raise HTTPException(409, "Invalid batch identity")
            demand[transit.id] = demand.get(transit.id,Decimal(0)) + line.quantity
            validated.append((item, line.quantity, transit))
        for _, _, transit in validated:
            if transit.on_hand_qty < demand[transit.id]:
                raise HTTPException(409, "Insufficient transit evidence; no reconciliation performed")
        receipt = InventoryTransferReceipt(transfer_id=transfer.id, receipt_number="TRR-"+uuid4().hex,
            operation_key=operation_key, request_fingerprint=fingerprint, received_by_user_id=current_user.id, response_snapshot={})
        db.add(receipt)
        db.flush()
        for item, quantity, transit in validated:
            destination = balance_repo.get_or_create_balance(product_id=item.product_id,
                warehouse_id=transfer.destination_warehouse_id, location_id=item.to_location_id,batch_id=item.batch_id)
            _capacity(destination, quantity)
            _transfer_movement(movement_repo, transfer, item, transit, -quantity, "TRANSFER_TRANSIT_OUT", current_user.id, receipt.id)
            _transfer_movement(movement_repo, transfer, item, destination, quantity, "TRANSFER_IN", current_user.id, receipt.id)
            item.received_quantity += quantity
        for product_id in sorted({i.product_id for i, _, _ in validated}):
            balance_repo.sync_aggregates(product_id,current_user.username)
        transfer.status = "COMPLETED" if all(i.received_quantity == i.quantity for i in items) else "PARTIALLY_RECEIVED"
        if transfer.status == "COMPLETED":
            transfer.completed_at = datetime.now()
            transfer.completed_by_user_id = current_user.id
        _audit_transfer(db,transfer,current_user.id,"RECEIVE_TRANSFER",receipt.receipt_number)
        db.flush()
        db.expire(transfer, ["items"])
        result = TransferReceiptResponse(receipt_id=receipt.id,receipt_number=receipt.receipt_number,
                                         transfer=InventoryTransferResponse.model_validate(transfer))
        receipt.response_snapshot = result.model_dump(mode="json")
    return result
