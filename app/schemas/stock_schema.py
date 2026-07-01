from pydantic import BaseModel, Field
from typing import Optional


class StockIn(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0)
    remark: Optional[str] = Field(default="", max_length=255)


class StockOut(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0)
    remark: Optional[str] = Field(default="", max_length=255)


class StockAdjust(BaseModel):
    product_id: int = Field(..., gt=0)
    new_quantity: int = Field(..., ge=0)
    remark: Optional[str] = Field(default="", max_length=255)