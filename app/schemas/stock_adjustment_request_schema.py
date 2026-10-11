from datetime import date, datetime
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
    """Create payload. Phase 14D adds an optional ``batch_id``: required for
    a batch-tracked product, forbidden otherwise (enforced in the service,
    which knows the product). Omitting it -- or sending null -- keeps the
    exact Phase 14B/14C non-batch behavior."""

    product_id: int = Field(..., gt=0)
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    batch_id: int | None = Field(default=None, gt=0)

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
        if self.reason_code == "EXPIRY_WRITE_OFF" and self.batch_id is None:
            # Phase 14D (D4): an expiry write-off always names the expired batch.
            raise ValueError("EXPIRY_WRITE_OFF requires a batch-level request (batch_id)")
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


class AdjustmentBatchRef(BaseModel):
    """Phase 14D: the exact batch a batch-level request targets."""
    id: int
    lot_no: str | None
    expiry_date: date | None
    is_expired: bool


class AdjustmentBalanceRef(BaseModel):
    """Phase 14D: the exact (product, warehouse, location, batch) balance as
    read when the response was built -- display context only; approval
    re-reads it under lock. ``available = on_hand - reserved``."""
    on_hand: Decimal
    reserved: Decimal
    available: Decimal


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
    batch_id: int | None = None


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
    # Phase 14D. Defaulted so pre-14D replay snapshots still validate.
    # Served only to the requester or Admin (the detail's existing rule).
    batch: AdjustmentBatchRef | None = None
    current_balance: AdjustmentBalanceRef | None = None
