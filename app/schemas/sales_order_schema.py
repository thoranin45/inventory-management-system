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

    quantity: int = Field(
        ...,
        gt=0,
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