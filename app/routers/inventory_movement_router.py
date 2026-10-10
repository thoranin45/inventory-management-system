from datetime import date, datetime

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
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
    MAX_BUSINESS_DAY_SPAN,
    MOVEMENT_GROUPS,
)
from app.services.adjustment_visibility import is_admin
from app.services.inventory_movement_service import (
    get_product_inventory_movements_service,
    get_reference_inventory_movements_service,
    search_inventory_movements_service,
)


router = APIRouter(
    prefix="/inventory-movements",
    tags=["Inventory Movements"],
)


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


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

    # ---- Phase 14C (all optional; omitting them keeps pre-14C behavior) ----
    from_date: date | None = Query(
        default=None,
        description="First business day (Asia/Bangkok), inclusive.",
    ),

    to_date: date | None = Query(
        default=None,
        description="Last business day (Asia/Bangkok), inclusive.",
    ),

    movement_group: str | None = Query(
        default=None,
        description="One of: " + ", ".join(MOVEMENT_GROUPS),
    ),

    reference_number: str | None = Query(
        default=None,
        max_length=100,
    ),

    actor: str | None = Query(
        default=None,
        max_length=100,
        description="Exact username of the operator. Admin only.",
    ),

    include_transit: bool = Query(
        default=True,
    ),

    sort_order: str = Query(
        default="desc",
        pattern="^(asc|desc)$",
    ),

    current_user: User = Depends(
        require_warehouse
    ),
) -> dict:

    if (from_date or to_date) and (date_from or date_to):
        raise HTTPException(
            status_code=422,
            detail="Use either from_date/to_date or date_from/date_to, not both",
        )
    if (from_date is None) != (to_date is None):
        # An open-ended business-day range would bypass the span cap.
        raise HTTPException(
            status_code=422,
            detail="from_date and to_date must be supplied together",
        )
    if from_date and to_date:
        if from_date > to_date:
            raise HTTPException(status_code=422, detail="from_date must not be after to_date")
        if (to_date - from_date).days + 1 > MAX_BUSINESS_DAY_SPAN:
            raise HTTPException(
                status_code=422,
                detail=f"Business-day range is limited to {MAX_BUSINESS_DAY_SPAN} days",
            )

    group = _blank_to_none(movement_group)
    if group is not None:
        group = group.upper()
        if group not in MOVEMENT_GROUPS:
            raise HTTPException(status_code=422, detail="Unknown movement_group")

    actor = _blank_to_none(actor)
    if actor is not None and not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Filtering by actor requires admin permission")

    return search_inventory_movements_service(
        repo=movement_repo,
        current_user=current_user,
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
        from_date=from_date,
        to_date=to_date,
        movement_group=group,
        reference_number=_blank_to_none(reference_number),
        actor=actor,
        include_transit=include_transit,
        sort_order=sort_order,
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
        current_user=current_user,
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
        current_user=current_user,
    )
