from decimal import Decimal

from pydantic import BaseModel, Field


class SalesReturnItemCreate(BaseModel):
    product_id: int = Field(
        ...,
        gt=0,
    )

    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    reason: str = Field(
        default="",
        max_length=255,
    )


class SalesReturnCreate(BaseModel):
    items: list[SalesReturnItemCreate] = Field(
        ...,
        min_length=1,
    )
