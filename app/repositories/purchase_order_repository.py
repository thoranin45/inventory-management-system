from sqlalchemy.orm import Session

from app.models import (
    PurchaseOrder,
    PurchaseOrderItem, PurchaseOrderReceipt,
)


class PurchaseOrderRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    def create(
        self,
        purchase_order: PurchaseOrder,
    ) -> PurchaseOrder:
        self.db.add(purchase_order)
        self.db.flush()

        return purchase_order

    def create_item(
        self,
        item: PurchaseOrderItem,
    ) -> PurchaseOrderItem:
        self.db.add(item)
        self.db.flush()

        return item

    def get_by_id(
        self,
        po_id: int,
    ) -> PurchaseOrder | None:
        return (
            self.db.query(PurchaseOrder)
            .filter(
                PurchaseOrder.id == po_id
            )
            .first()
        )

    def get_by_id_for_update(
        self,
        po_id: int,
    ) -> PurchaseOrder | None:
        return (
            self.db.query(PurchaseOrder)
            .filter(
                PurchaseOrder.id == po_id
            )
            .populate_existing().with_for_update()
            .first()
        )

    def get_all(
        self,
    ) -> list[PurchaseOrder]:
        return (
            self.db.query(PurchaseOrder)
            .order_by(
                PurchaseOrder.created_at.desc(),
                PurchaseOrder.id.desc(),
            )
            .all()
        )

    def get_items(
        self,
        po_id: int,
    ) -> list[PurchaseOrderItem]:
        return (
            self.db.query(PurchaseOrderItem)
            .filter(
                PurchaseOrderItem.po_id == po_id
            )
            .order_by(
                PurchaseOrderItem.id.asc()
            )
            .all()
        )

    def get_items_for_update(
        self,
        po_id: int,
    ) -> list[PurchaseOrderItem]:
        return (
            self.db.query(PurchaseOrderItem)
            .filter(
                PurchaseOrderItem.po_id == po_id
            )
            .order_by(
                PurchaseOrderItem.id.asc()
            )
            .populate_existing().with_for_update()
            .all()
        )
    
    def update(
        self,
        purchase_order: PurchaseOrder,
    ) -> PurchaseOrder:
        self.db.add(purchase_order)

        return purchase_order

    def get_receipt(self, po_id: int, operation_key: str):
        return (self.db.query(PurchaseOrderReceipt)
                .filter_by(po_id=po_id, operation_key=operation_key).first())

    def create_receipt(self, receipt: PurchaseOrderReceipt):
        self.db.add(receipt)
        self.db.flush()
        return receipt