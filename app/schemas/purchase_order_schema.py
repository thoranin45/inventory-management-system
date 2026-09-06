from datetime import date, datetime
from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)


class PurchaseOrderItemCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18,
        decimal_places=3,
    )
    unit_price: Decimal = Field(..., ge=0)


class PurchaseOrderCreate(BaseModel):
    supplier_id: int = Field(..., gt=0)

    items: list[PurchaseOrderItemCreate] = Field(
        ...,
        min_length=1,
    )

    @model_validator(mode="after")
    def validate_unique_products(self):
        product_ids = [
            item.product_id
            for item in self.items
        ]

        if len(product_ids) != len(set(product_ids)):
            raise ValueError(
                "Duplicate product_id is not allowed"
            )

        return self


class ReceivePOItem(BaseModel):
    product_id: int = Field(
        ...,
        gt=0,
    )

    quantity: Decimal = Field(
        ...,
        gt=0,
        max_digits=18,
        decimal_places=3,
    )

    lot_no: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    mfg_date: date
    expiry_date: date


class ReceivePO(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    location_id: int | None = Field(default=None, gt=0)
    items: list[ReceivePOItem] = Field(
        ...,
        min_length=1,
    )

    @model_validator(mode="after")
    def validate_unique_receive_products(self):
        product_ids = [
            item.product_id
            for item in self.items
        ]

        if len(product_ids) != len(set(product_ids)):
            raise ValueError(
                "Duplicate product_id is not allowed"
            )

        lot_numbers = [
            item.lot_no.strip().lower()
            for item in self.items
        ]

        if len(lot_numbers) != len(set(lot_numbers)):
            raise ValueError(
                "Duplicate lot_no is not allowed"
            )

        return self


class PurchaseOrderItemResponse(BaseModel):
    id: int
    po_id: int
    product_id: int
    quantity: Decimal
    received_quantity: Decimal
    remaining_quantity: Decimal
    unit_price: Decimal
    total_price: Decimal

    model_config = ConfigDict(
        from_attributes=True,
    )


class PurchaseOrderResponse(BaseModel):
    id: int
    po_number: str
    supplier_id: int
    status: str
    total_amount: Decimal
    created_at: datetime | None = None
    items: list[PurchaseOrderItemResponse]


class PurchaseOrderSummaryResponse(BaseModel):
    id: int
    po_number: str
    supplier_id: int
    status: str
    total_amount: Decimal
    created_at: datetime | None = None


class PurchaseOrderActionResponse(BaseModel):
    id: int
    po_number: str
    status: str


class ReceivedBatchResponse(BaseModel):
    batch_id: int
    product_id: int
    lot_no: str
    received_quantity: Decimal
    current_stock: Decimal


class PurchaseOrderReceiveResponse(BaseModel):
    id: int
    po_number: str
    status: str
    received_batches: list[ReceivedBatchResponse]
