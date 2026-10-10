from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# Phase 14C: every movement_type the application writes, partitioned by the
# workflow that wrote it. Groups never overlap; transit legs are part of
# TRANSFER and are filtered separately by ``include_transit``.
MOVEMENT_GROUPS: dict[str, tuple[str, ...]] = {
    "IN": ("STOCK_IN", "BATCH_IN"),
    "OUT": ("STOCK_OUT_FIFO", "STOCK_OUT_FEFO"),
    "ADJUSTMENT": ("STOCK_ADJUST",),
    "TRANSFER": ("TRANSFER_OUT", "TRANSFER_TRANSIT_IN", "TRANSFER_TRANSIT_OUT", "TRANSFER_IN"),
    "SALES": ("SALES_SHIPMENT", "SALES_RETURN"),
    "PURCHASE": ("PURCHASE_RECEIPT",),
}

# Maximum inclusive span of the business-day (from_date/to_date) filter.
# The legacy date_from/date_to datetime filters are deliberately uncapped.
MAX_BUSINESS_DAY_SPAN = 366


class InventoryMovementResponse(BaseModel):
    id: int

    product_id: int
    batch_id: int | None

    warehouse_id: int
    location_id: int

    movement_type: str
    quantity: Decimal

    balance_before: Decimal
    balance_after: Decimal

    reference_type: str | None
    reference_id: int | None
    reference_number: str | None

    remark: str | None

    created_by_user_id: int | None
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True,
    )

class LedgerProductRef(BaseModel):
    id: int
    sku: str | None
    product_name: str | None
    is_active: bool


class LedgerBatchRef(BaseModel):
    id: int
    lot_no: str | None
    expiry_date: date | None


class LedgerWarehouseRef(BaseModel):
    id: int
    warehouse_code: str
    warehouse_name: str
    is_active: bool


class LedgerLocationRef(BaseModel):
    id: int
    location_code: str
    location_name: str | None
    is_active: bool


class LedgerUserRef(BaseModel):
    id: int
    username: str | None


class LedgerSourceRef(BaseModel):
    type: str | None
    id: int | None
    number: str | None
    receipt_number: str | None


class LedgerAdjustmentRef(BaseModel):
    """Present on every adjustment movement. ``linked`` is false for rows
    written before Phase 14C linked movements to their request (no backfill,
    D2) -- those carry no request fields at all. ``notes`` / ``requested_by``
    are only ever populated for Admin or the request's own requester."""
    linked: bool
    request_id: int | None
    reference_number: str | None
    reason_code: str | None
    status: str | None
    requested_by: LedgerUserRef | None
    notes: str | None
    can_view_detail: bool
    redacted: bool


class InventoryLedgerItem(InventoryMovementResponse):
    """Phase 14C: the legacy item plus display context. Every inherited
    field keeps its pre-14C name and value, except ``remark``, which is
    withheld per the adjustment-visibility policy (``remark_redacted``)."""
    # Definitive UTC instant ("...Z"), or None when the row's storage zone is
    # unproven (``timestamp_verified`` false). ``created_at`` is unchanged.
    occurred_at: str | None
    timestamp_verified: bool
    direction: str
    is_transit_leg: bool
    product: LedgerProductRef
    batch: LedgerBatchRef | None
    warehouse: LedgerWarehouseRef
    location: LedgerLocationRef
    created_by: LedgerUserRef | None
    source: LedgerSourceRef
    adjustment: LedgerAdjustmentRef | None
    remark_redacted: bool


class InventoryMovementPagination(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class InventoryMovementListResponse(BaseModel):
    items: list[
        InventoryMovementResponse
    ]

    pagination: InventoryMovementPagination