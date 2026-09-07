from datetime import datetime

from fastapi import (
    APIRouter,
    Depends,
    Query,
)

from app.core.dependencies import (
    InventoryMovementRepositoryDependency,
    require_warehouse,
)
from app.models import User
from app.schemas.inventory_movement_schema import (
    InventoryMovementListResponse,
    InventoryMovementResponse,
)
from app.services.inventory_movement_service import (
    get_product_inventory_movements_service,
    get_reference_inventory_movements_service,
    search_inventory_movements_service,
)


router = APIRouter(
    prefix="/inventory-movements",
    tags=["Inventory Movements"],
)


@router.get("")
def get_inventory_movements(
    movement_repo: InventoryMovementRepositoryDependency,

    page: int = Query(
        default=1,
        ge=1,
    ),

    page_size: int = Query(
        default=50,
        ge=1,
        le=100,
        alias="page_size",
    ),

    product_id: int | None = Query(
        default=None,
        gt=0,
    ),

    warehouse_id: int | None = Query(
        default=None,
        gt=0,
    ),

    location_id: int | None = Query(
        default=None,
        gt=0,
    ),

    batch_id: int | None = Query(
        default=None,
        gt=0,
    ),

    movement_type: str | None = Query(
        default=None,
    ),

    reference_type: str | None = Query(
        default=None,
    ),

    reference_id: int | None = Query(
        default=None,
        gt=0,
    ),

    date_from: datetime | None = Query(
        default=None,
    ),

    date_to: datetime | None = Query(
        default=None,
    ),

    current_user: User = Depends(
        require_warehouse
    ),
) -> dict:

    return search_inventory_movements_service(
        repo=movement_repo,
        page=page,
        size=page_size,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        batch_id=batch_id,
        movement_type=movement_type,
        reference_type=reference_type,
        reference_id=reference_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/product/{product_id}",
    response_model=list[
        InventoryMovementResponse
    ],
)
def get_product_inventory_movements(
    product_id: int,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> list[InventoryMovementResponse]:

    return get_product_inventory_movements_service(
        repo=movement_repo,
        product_id=product_id,
    )


@router.get(
    "/reference/{reference_type}/{reference_id}",
    response_model=list[
        InventoryMovementResponse
    ],
)
def get_reference_inventory_movements(
    reference_type: str,
    reference_id: int,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(
        require_warehouse
    ),
) -> list[InventoryMovementResponse]:

    return get_reference_inventory_movements_service(
        repo=movement_repo,
        reference_type=reference_type,
        reference_id=reference_id,
    )