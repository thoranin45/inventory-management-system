"""F2a: request bodies for /api/v1/invoices and /api/v1/adjustment-notes.

Clients never send totals. Invoice lines come from the sales order (quantity
and unit price are locked); a draft only changes per-line discounts,
descriptions, credit days and notes.
"""
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_LINES = 200


def _strip_required(value: str, what: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"A reason is required to {what}")
    return value


class InvoiceFromOrderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sales_order_id: int = Field(..., gt=0)


class InvoiceLineEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_no: int = Field(..., ge=1)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    description: str | None = Field(default=None, max_length=300)


class InvoiceDraftUpdate(BaseModel):
    """PUT a draft invoice. Lines not listed keep a zero discount and their description."""

    model_config = ConfigDict(extra="forbid")

    credit_days: int = Field(..., ge=0, le=365)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[InvoiceLineEdit] = Field(default_factory=list, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _unique_lines(self):
        numbers = [line.line_no for line in self.items]
        if len(numbers) != len(set(numbers)):
            raise ValueError("Each invoice line can appear only once")
        return self


class VoidInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=1, max_length=500)

    @model_validator(mode="after")
    def _not_blank(self):
        self.reason = _strip_required(self.reason, "void a document")
        return self


class AdjustmentLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_item_id: int = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0, max_digits=18, decimal_places=3)
    unit_price: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    description: str | None = Field(default=None, max_length=300)


class AdjustmentDraftInput(BaseModel):
    """Create (POST) or fully replace (PUT) a draft adjustment note."""

    model_config = ConfigDict(extra="forbid")

    invoice_id: int = Field(..., gt=0)
    sales_return_receipt_id: int | None = Field(default=None, gt=0)
    reason: str = Field(..., min_length=1, max_length=500)
    items: list[AdjustmentLineInput] = Field(..., min_length=1, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _check(self):
        self.reason = _strip_required(self.reason, "adjust an invoice")
        ids = [line.invoice_item_id for line in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each invoice line can appear only once in an adjustment")
        return self
