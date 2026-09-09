from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class StockBalanceCreate(BaseModel):
    product_id: int = Field(..., gt=0)

    warehouse_id: int = Field(..., gt=0)

    location_id: int = Field(..., gt=0)

    batch_id: int | None = Field(
        default=None,
        gt=0,
    )

    on_hand_qty: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    reserved_qty: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )


class StockBalanceAdjust(BaseModel):
    on_hand_qty: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    reserved_qty: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )


class StockBalanceResponse(BaseModel):
    id: int

    product_id: int
    warehouse_id: int
    location_id: int
    batch_id: int | None = None

    on_hand_qty: Decimal
    reserved_qty: Decimal
    available_qty: Decimal

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )
