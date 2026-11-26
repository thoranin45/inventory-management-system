from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def thai_tax_id_is_valid(value: str) -> bool:
    """13 digits with the Revenue Department / national ID check digit."""
    if len(value) != 13 or not value.isdigit():
        return False
    total = sum(int(digit) * (13 - index) for index, digit in enumerate(value[:12]))
    return (11 - total % 11) % 10 == int(value[12])


def normalize_tax_id(value: str | None) -> str | None:
    """Blank -> None; otherwise digits only (spaces/dashes removed), checksum-validated."""
    if value is None:
        return None
    digits = value.replace("-", "").replace(" ", "")
    if digits == "":
        return None
    if not thai_tax_id_is_valid(digits):
        raise ValueError("tax_id must be a valid 13-digit Thai tax ID")
    return digits


def normalize_branch_code(value: str | None) -> str | None:
    """Blank -> None; otherwise exactly 5 digits (00000 = head office)."""
    if value is None:
        return None
    code = value.strip()
    if code == "":
        return None
    if len(code) != 5 or not code.isdigit():
        raise ValueError("branch_code must be 5 digits (00000 = head office)")
    return code


class CompanyProfileUpdate(BaseModel):
    """Full replacement of the company profile (PUT)."""

    model_config = ConfigDict(extra="forbid")

    legal_name_th: str | None = Field(default=None, max_length=255)
    legal_name_en: str | None = Field(default=None, max_length=255)
    tax_id: str | None = Field(default=None, max_length=20)
    branch_code: str | None = Field(default=None, max_length=5)
    address_th: str | None = Field(default=None, max_length=1000)
    address_en: str | None = Field(default=None, max_length=1000)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    vat_registered: bool = False
    vat_rate: Decimal = Field(default=Decimal("7.00"), ge=0, le=100, max_digits=5, decimal_places=2)
    prices_include_vat: bool = False

    _tax_id = field_validator("tax_id")(normalize_tax_id)
    _branch_code = field_validator("branch_code")(normalize_branch_code)


class CompanyProfileResponse(BaseModel):
    legal_name_th: str | None = None
    legal_name_en: str | None = None
    tax_id: str | None = None
    branch_code: str | None = None
    address_th: str | None = None
    address_en: str | None = None
    phone: str | None = None
    email: str | None = None
    vat_registered: bool = False
    vat_rate: Decimal = Decimal("7.00")
    prices_include_vat: bool = False
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
