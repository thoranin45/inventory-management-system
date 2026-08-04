from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class BatchCreate(BaseModel):
    product_id: int = Field(..., gt=0)

    lot_no: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    mfg_date: date
    expiry_date: date
    quantity: int = Field(..., gt=0)


class BatchResponse(BaseModel):
    id: int
    product_id: int
    lot_no: str
    mfg_date: date
    expiry_date: date
    quantity: int
    created_at: datetime | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )


class BatchCreateResponse(BaseModel):
    batch: BatchResponse
    current_stock: int