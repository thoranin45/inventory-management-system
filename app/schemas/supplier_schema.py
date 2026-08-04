from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SupplierCreate(BaseModel):
    supplier_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
    )

    contact_name: str | None = Field(
        default=None,
        max_length=255,
    )

    phone: str | None = Field(
        default=None,
        max_length=50,
    )

    email: EmailStr | None = None

    address: str | None = Field(
        default=None,
        max_length=500,
    )


class SupplierUpdate(BaseModel):
    supplier_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
    )

    contact_name: str | None = Field(
        default=None,
        max_length=255,
    )

    phone: str | None = Field(
        default=None,
        max_length=50,
    )

    email: EmailStr | None = None

    address: str | None = Field(
        default=None,
        max_length=500,
    )


class SupplierResponse(BaseModel):
    id: int
    supplier_name: str
    contact_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )