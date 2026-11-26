"""F1a: request bodies for /api/v1/quotations.

Clients send lines and dates only. Line totals and document totals are always
computed on the server (app.core.money); a client total is never accepted.
"""
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_LINES = 200


class QuotationLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0, max_digits=18, decimal_places=3)
    # Same bounds as sales order lines, so an accepted quotation always converts.
    unit_price: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    description: str | None = Field(default=None, max_length=300)


class QuotationDraftInput(BaseModel):
    """Create a draft, or replace a draft's content in full (PUT)."""

    model_config = ConfigDict(extra="forbid")

    customer_id: int = Field(..., gt=0)
    valid_until: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    items: list[QuotationLineInput] = Field(..., min_length=1, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _unique_products(self):
        ids = [line.product_id for line in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each product can appear only once in a quotation")
        return self


class QuotationVoidInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=1, max_length=500)

    @model_validator(mode="after")
    def _not_blank(self):
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("A reason is required to void a quotation")
        return self
