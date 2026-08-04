from pydantic import BaseModel, Field


class SalesReturnItemCreate(BaseModel):
    product_id: int = Field(
        ...,
        gt=0,
    )

    quantity: int = Field(
        ...,
        gt=0,
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