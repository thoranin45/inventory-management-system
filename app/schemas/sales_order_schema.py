from decimal import Decimal

from pydantic import (
    BaseModel,
    Field,
    model_validator,
)


class SalesOrderItemCreate(BaseModel):
    product_id: int = Field(
        ...,
        gt=0,
    )

    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18,
        decimal_places=3,
    )

    unit_price: Decimal = Field(
        ...,
        gt=0,
        decimal_places=2,
    )


class SalesOrderCreate(BaseModel):
    customer_id: int = Field(
        ...,
        gt=0,
    )

    items: list[SalesOrderItemCreate] = Field(
        ...,
        min_length=1,
    )

    @model_validator(mode="after")
    def validate_unique_products(self):
        product_ids = [
            item.product_id
            for item in self.items
        ]

        if len(product_ids) != len(set(product_ids)):
            raise ValueError(
                "Duplicate product_id is not allowed"
            )

        return self
class FulfillmentQuantity(BaseModel):
    allocation_id: int = Field(gt=0)
    quantity: Decimal = Field(ge=0, max_digits=18, decimal_places=3, allow_inf_nan=False)


class CompleteFulfillment(BaseModel):
    allocations: list[FulfillmentQuantity] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_allocations(self):
        ids = [line.allocation_id for line in self.allocations]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate allocation_id is not allowed")
        return self


class FulfillmentScan(BaseModel):
    barcode: str = Field(min_length=1, max_length=100)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=18, decimal_places=3, allow_inf_nan=False)
    allocation_id: int | None = Field(default=None, gt=0)
