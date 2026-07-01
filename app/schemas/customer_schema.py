from pydantic import BaseModel, Field, EmailStr
from typing import Optional


class CustomerCreate(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    phone: Optional[str] = Field(default="", max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default="", max_length=500)


class CustomerUpdate(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    phone: Optional[str] = Field(default="", max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default="", max_length=500)