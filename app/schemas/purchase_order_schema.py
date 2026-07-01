from pydantic import BaseModel, Field
from typing import List
from datetime import date


class PurchaseOrderItemCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0)
    unit_price: float = Field(..., gt=0)


class PurchaseOrderCreate(BaseModel):
    supplier_id: int = Field(..., gt=0)
    items: List[PurchaseOrderItemCreate] = Field(..., min_length=1)


class ReceivePOItem(BaseModel):
    product_id: int = Field(..., gt=0)
    lot_no: str = Field(..., min_length=1, max_length=100)
    mfg_date: date
    expiry_date: date


class ReceivePO(BaseModel):
    items: List[ReceivePOItem] = Field(..., min_length=1)