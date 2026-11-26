from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.company_profile_schema import normalize_branch_code, normalize_tax_id


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

    # F0a: optional billing/tax data. Omitted fields keep the old behaviour.
    tax_id: str | None = Field(default=None, max_length=20)
    branch_code: str | None = Field(default=None, max_length=5)
    billing_address: str | None = Field(default=None, max_length=1000)
    credit_term_days: int | None = Field(default=None, ge=0, le=365)

    _tax_id = field_validator("tax_id")(normalize_tax_id)
    _branch_code = field_validator("branch_code")(normalize_branch_code)


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

    # F0a: optional billing/tax data. Omitted fields keep the old behaviour.
    tax_id: str | None = Field(default=None, max_length=20)
    branch_code: str | None = Field(default=None, max_length=5)
    billing_address: str | None = Field(default=None, max_length=1000)
    credit_term_days: int | None = Field(default=None, ge=0, le=365)

    _tax_id = field_validator("tax_id")(normalize_tax_id)
    _branch_code = field_validator("branch_code")(normalize_branch_code)


class CustomerResponse(BaseModel):
    id: int
    customer_name: str
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    tax_id: str | None = None
    branch_code: str | None = None
    billing_address: str | None = None
    credit_term_days: int | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )