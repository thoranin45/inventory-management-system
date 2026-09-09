from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    PurchaseOrder,
    PurchaseOrderItem, PurchaseOrderReceipt,
    Supplier,
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

    # ---------------- Phase 8 work-queue support (grouped, no N+1) --------- #
    def list_query(self, *, search: str | None = None, status: str | None = None):
        query = self.db.query(PurchaseOrder)
        if status:
            wanted = [s.strip().upper() for s in status.split(",") if s.strip()]
            query = query.filter(PurchaseOrder.status.in_(wanted))
        if search:
            like = f"%{search}%"
            query = query.outerjoin(
                Supplier, Supplier.id == PurchaseOrder.supplier_id
            ).filter(
                or_(
                    PurchaseOrder.po_number.ilike(like),
                    Supplier.supplier_name.ilike(like),
                )
            )
        return query

    def status_counts(self) -> dict[str, int]:
        return {
            row[0]: row[1]
            for row in self.db.query(PurchaseOrder.status, func.count(PurchaseOrder.id))
            .group_by(PurchaseOrder.status)
            .all()
        }

    def item_aggregates(self, po_ids: list[int]) -> dict[int, tuple]:
        if not po_ids:
            return {}
        rows = (
            self.db.query(
                PurchaseOrderItem.po_id,
                func.coalesce(func.sum(PurchaseOrderItem.quantity), 0),
                func.coalesce(func.sum(PurchaseOrderItem.received_quantity), 0),
                func.coalesce(
                    func.sum(PurchaseOrderItem.quantity * PurchaseOrderItem.unit_price), 0
                ),
            )
            .filter(PurchaseOrderItem.po_id.in_(po_ids))
            .group_by(PurchaseOrderItem.po_id)
            .all()
        )
        return {
            r[0]: (Decimal(str(r[1])), Decimal(str(r[2])), Decimal(str(r[3])))
            for r in rows
        }

    def receipt_aggregates(self, po_ids: list[int]) -> dict[int, tuple]:
        if not po_ids:
            return {}
        rows = (
            self.db.query(
                PurchaseOrderReceipt.po_id,
                func.max(PurchaseOrderReceipt.received_at),
                func.count(PurchaseOrderReceipt.id),
            )
            .filter(PurchaseOrderReceipt.po_id.in_(po_ids))
            .group_by(PurchaseOrderReceipt.po_id)
            .all()
        )
        return {r[0]: (r[1], int(r[2])) for r in rows}

    def supplier_names(self, supplier_ids: list[int]) -> dict[int, str]:
        if not supplier_ids:
            return {}
        return {
            row[0]: row[1]
            for row in self.db.query(Supplier.id, Supplier.supplier_name)
            .filter(Supplier.id.in_(supplier_ids))
            .all()
        }

    def received_today_count(self, day_start, day_end) -> int:
        return (
            self.db.query(func.count(func.distinct(PurchaseOrderReceipt.po_id)))
            .filter(
                PurchaseOrderReceipt.received_at >= day_start,
                PurchaseOrderReceipt.received_at < day_end,
            )
            .scalar()
        )