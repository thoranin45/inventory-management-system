from datetime import datetime

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
            )

            repo.create_item(item)

        db.flush()

    db.refresh(transfer)

    return transfer


def get_inventory_transfers_service(
    repo: InventoryTransferRepository,
) -> list[InventoryTransfer]:
    return repo.get_all()


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

        for item in transfer.items:
            source_balance = (
                balance_repo.get_balance_for_update(
                    product_id=item.product_id,
                    warehouse_id=(
                        transfer.source_warehouse_id
                    ),
                    location_id=item.from_location_id,
                    batch_id=item.batch_id,
                )
            )

            if source_balance is None:
                raise StockBalanceNotFoundException()

            available_qty = (
                source_balance.on_hand_qty
                - source_balance.reserved_qty
            )

            if available_qty < item.quantity:
                raise InsufficientStockException()

            destination_balance = (
                balance_repo.get_or_create_balance(
                    product_id=item.product_id,
                    warehouse_id=(
                        transfer.destination_warehouse_id
                    ),
                    location_id=item.to_location_id,
                    batch_id=item.batch_id,
                )
            )

            source_before = (
                source_balance.on_hand_qty
            )

            destination_before = (
                destination_balance.on_hand_qty
            )

            source_balance.on_hand_qty -= (
                item.quantity
            )

            destination_balance.on_hand_qty += (
                item.quantity
            )

            source_movement = InventoryMovement(
                product_id=item.product_id,
                batch_id=item.batch_id,
                warehouse_id=(
                    transfer.source_warehouse_id
                ),
                location_id=item.from_location_id,
                movement_type="TRANSFER_OUT",
                quantity=-item.quantity,
                balance_before=source_before,
                balance_after=(
                    source_balance.on_hand_qty
                ),
                reference_type=(
                    "INVENTORY_TRANSFER"
                ),
                reference_id=transfer.id,
                reference_number=(
                    transfer.transfer_number
                ),
                remark=transfer.remark,
                created_by_user_id=(
                    completed_by_user_id
                ),
            )

            movement_repo.create(
                source_movement
            )

            destination_movement = (
                InventoryMovement(
                    product_id=item.product_id,
                    batch_id=item.batch_id,
                    warehouse_id=(
                        transfer.destination_warehouse_id
                    ),
                    location_id=item.to_location_id,
                    movement_type="TRANSFER_IN",
                    quantity=item.quantity,
                    balance_before=(
                        destination_before
                    ),
                    balance_after=(
                        destination_balance.on_hand_qty
                    ),
                    reference_type=(
                        "INVENTORY_TRANSFER"
                    ),
                    reference_id=transfer.id,
                    reference_number=(
                        transfer.transfer_number
                    ),
                    remark=transfer.remark,
                    created_by_user_id=(
                        completed_by_user_id
                    ),
                )
            )

            movement_repo.create(
                destination_movement
            )

        transfer.status = "COMPLETED"
        transfer.completed_by_user_id = (
            completed_by_user_id
        )
        transfer.completed_at = datetime.now()

        db.flush()

    uow.refresh(
        transfer
    )

    return transfer

def cancel_inventory_transfer_service(
    db: Session,
    transfer_repo: InventoryTransferRepository,
    transfer_id: int,
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

        transfer.status = "CANCELLED"

        db.flush()

    uow.refresh(
        transfer
    )

    return transfer