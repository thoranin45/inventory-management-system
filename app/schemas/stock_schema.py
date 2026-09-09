from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StockIn(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    product_id: int = Field(..., gt=0)

    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    remark: str | None = Field(
        default=None,
        max_length=255,
    )


class StockOut(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    product_id: int = Field(..., gt=0)

    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    remark: str | None = Field(
        default=None,
        max_length=255,
    )


class StockAdjust(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    product_id: int = Field(..., gt=0)

    new_quantity: Decimal = Field(
        ...,
        ge=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    remark: str = Field(min_length=1, max_length=255)

    @field_validator("remark")
    @classmethod
    def require_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Adjustment reason must not be blank")
        return value.strip()


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
