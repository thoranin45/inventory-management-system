from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

class ProductCreate(BaseModel):
    sku: str = Field(
        ...,
        min_length=1,
        max_length=50,
    )

    barcode: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )

    product_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
    )

    price: Decimal = Field(
        ...,
        gt=0,
    )

    stock_qty: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        le=0,
    )

    category_id: int | None = None

    track_batch: bool = False
    track_expiry: bool = False

    @model_validator(mode="after")
    def validate_tracking(self):
        if self.track_expiry and not self.track_batch:
            raise ValueError(
                "track_expiry requires track_batch=True"
            )

        return self


class ProductUpdate(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def reject_stock_update(cls, values):
        if isinstance(values, dict) and "stock_qty" in values:
            raise ValueError("stock_qty is read-only; use audited stock operations")
        return values

    sku: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
    )

    barcode: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
    )

    product_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
    )

    price: Decimal | None = Field(
        default=None,
        gt=0,
    )

    stock_qty: Decimal | None = Field(
        default=None,
        ge=0,
    )

    category_id: int | None = None

    track_batch: bool | None = None
    track_expiry: bool | None = None


class ProductResponse(BaseModel):
    id: int
    sku: str
    barcode: str | None = None
    product_name: str
    price: Decimal
    stock_qty: Decimal
    category_id: int | None = None
    image_url: str | None = None
    is_active: bool
    created_at: datetime | None = None
    track_batch: bool = False
    track_expiry: bool = False
    model_config = ConfigDict(
        from_attributes=True,
    )
