from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class StockIn(BaseModel):
    product_id: int = Field(..., gt=0)

    quantity: Decimal = Field(
        ...,
        gt=0,
    )

    remark: str | None = Field(
        default=None,
        max_length=255,
    )


class StockOut(BaseModel):
    product_id: int = Field(..., gt=0)

    quantity: Decimal = Field(
        ...,
        gt=0,
    )

    remark: str | None = Field(
        default=None,
        max_length=255,
    )


class StockAdjust(BaseModel):
    product_id: int = Field(..., gt=0)

    new_quantity: Decimal = Field(
        ...,
        ge=0,
    )

    remark: str | None = Field(
        default=None,
        max_length=255,
    )


class StockOperationResponse(BaseModel):
    product_id: int
    product_name: str
    previous_stock: Decimal
    current_stock: Decimal
    difference: Decimal


class StockTransactionResponse(BaseModel):
    id: int
    product_id: int
    transaction_type: str
    quantity: Decimal
    remark: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )