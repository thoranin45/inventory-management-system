from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    category_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
    )


class CategoryUpdate(BaseModel):
    category_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
    )


class CategoryResponse(BaseModel):
    id: int
    category_name: str

    model_config = ConfigDict(
        from_attributes=True,
    )