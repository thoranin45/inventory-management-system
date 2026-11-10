from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


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

    @model_validator(mode="after")
    def _distinct_products(self) -> "SalesReturnCreate":
        # V1-H1: one line per product, so a request has one unambiguous
        # fingerprint and the remaining-returnable check sees each product once.
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Duplicate product_id in return items")
        return self
