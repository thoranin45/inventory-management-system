from datetime import datetime
import math

from app.models import InventoryMovement
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)
from app.schemas.inventory_movement_schema import (
    InventoryMovementListResponse,
    InventoryMovementPagination,
)


def get_inventory_movements_service(
    repo: InventoryMovementRepository,
) -> list[InventoryMovement]:
    return repo.get_all()


def get_product_inventory_movements_service(
    repo: InventoryMovementRepository,
    product_id: int,
) -> list[InventoryMovement]:
    return repo.get_by_product(
        product_id
    )


def get_reference_inventory_movements_service(
    repo: InventoryMovementRepository,
    reference_type: str,
    reference_id: int,
) -> list[InventoryMovement]:
    return repo.get_by_reference(
        reference_type=reference_type,
        reference_id=reference_id,
    )


def search_inventory_movements_service(
    repo: InventoryMovementRepository,
    *,
    page: int,
    size: int,
    product_id: int | None,
    warehouse_id: int | None,
    location_id: int | None,
    batch_id: int | None,
    movement_type: str | None,
    reference_type: str | None,
    reference_id: int | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> InventoryMovementListResponse:

    items, total = repo.search(
        page=page,
        size=size,
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

    from app.core.pagination import phase8_json
    from app.schemas.inventory_movement_schema import InventoryMovementResponse

    total_pages = math.ceil(total / size) if total > 0 else 0
    return {
        "success": True,
        "message": "Inventory movements retrieved successfully",
        "data": {
            "items": phase8_json(
                [InventoryMovementResponse.model_validate(m) for m in items]
            ),
            "pagination": {
                "page": page,
                "page_size": size,
                "total_items": total,
                "total_pages": total_pages,
            },
        },
    }