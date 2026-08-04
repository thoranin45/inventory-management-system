from pydantic import BaseModel, ConfigDict, EmailStr, Field


class CustomerCreate(BaseModel):
    customer_name: str = Field(
        ...,
        min_length=1,
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


class CustomerUpdate(BaseModel):
    customer_name: str | None = Field(
        default=None,
        min_length=1,
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


class CustomerResponse(BaseModel):
    id: int
    customer_name: str
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )