from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class InventoryTransferItemCreate(BaseModel):
    product_id: int = Field(..., gt=0)

    batch_id: int | None = Field(
        default=None,
        gt=0,
    )

    from_location_id: int = Field(..., gt=0)

    to_location_id: int = Field(..., gt=0)

    quantity: Decimal = Field(
        ...,
        gt=0,
    )


class InventoryTransferCreate(BaseModel):
    source_warehouse_id: int = Field(..., gt=0)

    destination_warehouse_id: int = Field(..., gt=0)

    remark: str | None = Field(
        default=None,
        max_length=500,
    )

    items: list[InventoryTransferItemCreate] = Field(
        ...,
        min_length=1,
    )


class InventoryTransferItemResponse(BaseModel):
    id: int
    transfer_id: int
    product_id: int
    batch_id: int | None

    from_location_id: int
    to_location_id: int

    quantity: Decimal
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )


class InventoryTransferResponse(BaseModel):
    id: int

    transfer_number: str
    status: str

    source_warehouse_id: int
    destination_warehouse_id: int

    requested_by_user_id: int | None
    completed_by_user_id: int | None

    remark: str | None

    created_at: datetime
    completed_at: datetime | None
    updated_at: datetime

    items: list[
        InventoryTransferItemResponse
    ]

    model_config = ConfigDict(
        from_attributes=True,
    )