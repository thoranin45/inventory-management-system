from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    DatabaseSession,
    InventoryMovementRepositoryDependency,
    InventoryTransferRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_warehouse,
)
from app.models import User
from app.schemas.inventory_transfer_schema import (
    InventoryTransferCreate,
    InventoryTransferResponse,
)
from app.services.inventory_transfer_service import (
    cancel_inventory_transfer_service,
    complete_inventory_transfer_service,
    create_inventory_transfer_service,
    get_inventory_transfer_service,
    get_inventory_transfers_service,
)


router = APIRouter(
    prefix="/inventory-transfers",
    tags=["Inventory Transfers"],
)


@router.post(
    "",
    response_model=InventoryTransferResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_inventory_transfer(
    data: InventoryTransferCreate,
    db: DatabaseSession,
    transfer_repo: InventoryTransferRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> InventoryTransferResponse:

    return create_inventory_transfer_service(
        db=db,
        repo=transfer_repo,
        data=data,
        requested_by_user_id=current_user.id,
    )


@router.get(
    "",
    response_model=list[InventoryTransferResponse],
)
def get_inventory_transfers(
    transfer_repo: InventoryTransferRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> list[InventoryTransferResponse]:

    return get_inventory_transfers_service(
        repo=transfer_repo,
    )


@router.get(
    "/{transfer_id}",
    response_model=InventoryTransferResponse,
)
def get_inventory_transfer(
    transfer_id: int,
    transfer_repo: InventoryTransferRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> InventoryTransferResponse:

    return get_inventory_transfer_service(
        repo=transfer_repo,
        transfer_id=transfer_id,
    )


@router.post(
    "/{transfer_id}/complete",
    response_model=InventoryTransferResponse,
)
def complete_inventory_transfer(
    transfer_id: int,
    db: DatabaseSession,
    transfer_repo: InventoryTransferRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> InventoryTransferResponse:

    return complete_inventory_transfer_service(
        db=db,
        transfer_repo=transfer_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        transfer_id=transfer_id,
        completed_by_user_id=current_user.id,
    )


@router.post(
    "/{transfer_id}/cancel",
    response_model=InventoryTransferResponse,
)
def cancel_inventory_transfer(
    transfer_id: int,
    db: DatabaseSession,
    transfer_repo: InventoryTransferRepositoryDependency,
    current_user: User = Depends(require_warehouse),
) -> InventoryTransferResponse:

    return cancel_inventory_transfer_service(
        db=db,
        transfer_repo=transfer_repo,
        transfer_id=transfer_id,
    )