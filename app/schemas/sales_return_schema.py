from pydantic import BaseModel, Field
from typing import List


class SalesReturnItem(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0)
    reason: str = Field(default="", max_length=255)


class SalesReturnCreate(BaseModel):
    items: List[SalesReturnItem] = Field(..., min_length=1)