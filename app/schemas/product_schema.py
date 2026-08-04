from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


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

    stock_qty: int = Field(
        default=0,
        ge=0,
    )

    category_id: int | None = None


class ProductUpdate(BaseModel):
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

    stock_qty: int | None = Field(
        default=None,
        ge=0,
    )

    category_id: int | None = None


class ProductResponse(BaseModel):
    id: int
    sku: str
    barcode: str | None = None
    product_name: str
    price: Decimal
    stock_qty: int
    category_id: int | None = None
    image_url: str | None = None
    is_active: bool
    created_at: datetime | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )