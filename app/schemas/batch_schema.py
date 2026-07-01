from pydantic import BaseModel, Field
from datetime import date


class BatchCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    lot_no: str = Field(..., min_length=1, max_length=100)
    mfg_date: date
    expiry_date: date
    quantity: int = Field(..., gt=0)