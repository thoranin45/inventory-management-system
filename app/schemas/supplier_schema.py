from pydantic import BaseModel, Field, EmailStr
from typing import Optional


class SupplierCreate(BaseModel):
    supplier_name: str = Field(..., min_length=1, max_length=255)
    contact_name: Optional[str] = Field(default="", max_length=255)
    phone: Optional[str] = Field(default="", max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default="", max_length=500)


class SupplierUpdate(BaseModel):
    supplier_name: str = Field(..., min_length=1, max_length=255)
    contact_name: Optional[str] = Field(default="", max_length=255)
    phone: Optional[str] = Field(default="", max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default="", max_length=500)