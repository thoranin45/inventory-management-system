from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class InventoryMovementResponse(BaseModel):
    id: int

    product_id: int
    batch_id: int | None

    warehouse_id: int
    location_id: int

    movement_type: str
    quantity: Decimal

    balance_before: Decimal
    balance_after: Decimal

    reference_type: str | None
    reference_id: int | None
    reference_number: str | None

    remark: str | None

    created_by_user_id: int | None
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )

class InventoryMovementPagination(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class InventoryMovementListResponse(BaseModel):
    items: list[
        InventoryMovementResponse
    ]

    pagination: InventoryMovementPagination