from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class BatchCreate(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    product_id: int = Field(..., gt=0)

    lot_no: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    mfg_date: date
    expiry_date: date
    quantity: Decimal = Field(..., gt=0, max_digits=18, decimal_places=3)


class BatchResponse(BaseModel):
    id: int
    product_id: int
    lot_no: str
    mfg_date: date
    expiry_date: date
    quantity: Decimal
    created_at: datetime | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )


class BatchCreateResponse(BaseModel):
    batch: BatchResponse
    current_stock: Decimal
