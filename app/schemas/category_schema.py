from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    category_name: str = Field(..., min_length=1, max_length=255)


class CategoryUpdate(BaseModel):
    category_name: str = Field(..., min_length=1, max_length=255)