from pydantic import BaseModel, Field
from typing import List


class SalesOrderItemCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0)
    unit_price: float = Field(..., gt=0)


class SalesOrderCreate(BaseModel):
    customer_id: int = Field(..., gt=0)
    items: List[SalesOrderItemCreate] = Field(..., min_length=1)