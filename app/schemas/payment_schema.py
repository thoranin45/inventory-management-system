"""F3a: request bodies for /api/v1/payment-receipts and /api/v1/billing-notes.

Clients never send totals; the server adds up the allocations.
"""
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_INVOICES = 100


class AllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_id: int = Field(..., gt=0)
    amount: Decimal = Field(..., ge=0, max_digits=14, decimal_places=2)
    wht_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    wht_certificate_no: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def _positive(self):
        if self.amount + self.wht_amount <= 0:
            raise ValueError("Each invoice needs an amount above 0")
        self.wht_certificate_no = (self.wht_certificate_no or "").strip() or None
        return self


class PaymentReceiptInput(BaseModel):
    """Record (and issue) a receipt. ``client_request_id`` makes a retry return the same receipt."""

    model_config = ConfigDict(extra="forbid")

    customer_id: int = Field(..., gt=0)
    received_date: date | None = None
    method: Literal["CASH", "TRANSFER", "CHEQUE", "OTHER"]
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)
    client_request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    allocations: list[AllocationInput] = Field(..., min_length=1, max_length=MAX_INVOICES)

    @model_validator(mode="after")
    def _unique(self):
        ids = [a.invoice_id for a in self.allocations]
        if len(ids) != len(set(ids)):
            raise ValueError("Each invoice can appear only once on a receipt")
        self.reference = (self.reference or "").strip() or None
        return self


class BillingNoteInput(BaseModel):
    """Create (POST) or fully replace (PUT) a draft billing note."""

    model_config = ConfigDict(extra="forbid")

    customer_id: int = Field(..., gt=0)
    invoice_ids: list[int] = Field(..., min_length=1, max_length=MAX_INVOICES)
    payment_due_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _unique(self):
        if any(i <= 0 for i in self.invoice_ids):
            raise ValueError("Invoice ids must be positive")
        if len(self.invoice_ids) != len(set(self.invoice_ids)):
            raise ValueError("Each invoice can appear only once on a billing note")
        return self
