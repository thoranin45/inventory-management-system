from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

REASON_CODES = (
    "CYCLE_COUNT_VARIANCE",
    "DAMAGE",
    "LOSS_THEFT",
    "SYSTEM_ERROR_CORRECTION",
    "EXPIRY_WRITE_OFF",
    "OTHER",
)

ReasonCode = Literal[
    "CYCLE_COUNT_VARIANCE",
    "DAMAGE",
    "LOSS_THEFT",
    "SYSTEM_ERROR_CORRECTION",
    "EXPIRY_WRITE_OFF",
    "OTHER",
]


class StockAdjustmentRequestCreate(BaseModel):
    """Phase 14B create payload. No ``batch_id`` field at all -- 14B is
    product-level only; Phase 14D adds the batch-level variant on its own
    schema rather than this one growing an optional field nobody can use
    yet."""

    product_id: int = Field(..., gt=0)
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)

    observed_quantity: Decimal = Field(
        ..., ge=0, max_digits=18, decimal_places=3, allow_inf_nan=False,
    )
    requested_quantity: Decimal = Field(
        ..., ge=0, max_digits=18, decimal_places=3, allow_inf_nan=False,
    )

    reason_code: ReasonCode
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_reason(self):
        if self.reason_code == "OTHER" and not (self.notes and self.notes.strip()):
            raise ValueError("notes is required when reason_code is OTHER")
        if self.reason_code == "EXPIRY_WRITE_OFF":
            raise ValueError(
                "EXPIRY_WRITE_OFF requires a batch-level request "
                "(Phase 14D, not yet supported)"
            )
        return self


class StockAdjustmentRequestReject(BaseModel):
    rejection_reason: str = Field(min_length=1, max_length=500)

    @field_validator("rejection_reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Rejection reason must not be blank")
        return value.strip()


class _Ref(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProductRef(_Ref):
    id: int
    sku: str
    product_name: str


class WarehouseRef(_Ref):
    id: int
    warehouse_code: str
    warehouse_name: str


class LocationRef(_Ref):
    id: int
    location_code: str
    # warehouse_locations.location_name is a nullable column.
    location_name: str | None


class UserRef(_Ref):
    id: int
    username: str


class AdjustmentRequestHistoryEntry(BaseModel):
    action: str
    actor: str
    at: datetime
    detail: str


class StockAdjustmentRequestListItem(BaseModel):
    id: int
    reference_number: str
    status: str
    product_id: int
    warehouse_id: int
    location_id: int
    observed_quantity: Decimal
    requested_quantity: Decimal
    reason_code: str
    requested_by_user_id: int
    created_at: datetime


class StockAdjustmentRequestDetail(BaseModel):
    id: int
    reference_number: str
    status: str
    product: ProductRef
    warehouse: WarehouseRef
    location: LocationRef
    observed_quantity: Decimal
    requested_quantity: Decimal
    reason_code: str
    notes: str | None
    requested_by: UserRef
    reviewed_by: UserRef | None
    rejection_reason: str | None
    created_at: datetime
    reviewed_at: datetime | None
    completed_at: datetime | None
    history: list[AdjustmentRequestHistoryEntry] = Field(default_factory=list)
    # Phase 14C (D7). Defaulted so replay snapshots stored before 14C still
    # validate; this detail is only ever served to the requester or Admin.
    stock_transaction_id: int | None = None
