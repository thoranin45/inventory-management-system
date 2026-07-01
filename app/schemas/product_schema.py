from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class ProductCreate(BaseModel):
    sku: str = Field(..., min_length=1, max_length=50)
    barcode: str = Field(..., min_length=1, max_length=100)
    product_name: str = Field(..., min_length=1, max_length=255)
    price: float = Field(..., gt=0)
    stock_qty: int = Field(..., ge=0)
    category_id: Optional[int] = None


class ProductUpdate(BaseModel):
    sku: str = Field(..., min_length=1, max_length=50)
    barcode: str = Field(..., min_length=1, max_length=100)
    product_name: str = Field(..., min_length=1, max_length=255)
    price: float = Field(..., gt=0)
    stock_qty: int = Field(..., ge=0)
    category_id: Optional[int] = None

class ProductResponse(BaseModel):
    id: int
    sku: str
    barcode: str
    product_name: str
    price: float
    stock_qty: int
    category_id: Optional[int] = None
    image_url: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True