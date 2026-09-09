from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    InventoryTransfer,
    InventoryTransferItem,
    InventoryTransferReceipt,
    Warehouse,
)


class InventoryTransferRepository:
    def __init__(
        self,
        db: Session,
    ) -> None:
        self.db = db

    def get_by_id(
        self,
        transfer_id: int,
    ) -> InventoryTransfer | None:
        return (
            self.db.query(InventoryTransfer)
            .filter(
                InventoryTransfer.id
                == transfer_id
            )
            .first()
        )

    def get_by_id_for_update(
        self,
        transfer_id: int,
    ) -> InventoryTransfer | None:
        return (
            self.db.query(InventoryTransfer)
            .filter(
                InventoryTransfer.id == transfer_id
            )
            .populate_existing().with_for_update()
            .first()
        )

    def get_by_transfer_number(
        self,
        transfer_number: str,
    ) -> InventoryTransfer | None:
        return (
            self.db.query(InventoryTransfer)
            .filter(
                InventoryTransfer.transfer_number
                == transfer_number
            )
            .first()
        )

    def get_all(
        self,
    ) -> list[InventoryTransfer]:
        return (
            self.db.query(InventoryTransfer)
            .order_by(
                InventoryTransfer.created_at.desc(),
                InventoryTransfer.id.desc(),
            )
            .all()
        )

    # ---------------- Phase 8 work-queue support (grouped, no N+1) --------- #
    def list_query(self, *, search: str | None = None, status: str | None = None,
                   source_warehouse_id: int | None = None,
                   destination_warehouse_id: int | None = None):
        query = self.db.query(InventoryTransfer)
        if status:
            wanted = [s.strip().upper() for s in status.split(",") if s.strip()]
            query = query.filter(InventoryTransfer.status.in_(wanted))
        if source_warehouse_id is not None:
            query = query.filter(InventoryTransfer.source_warehouse_id == source_warehouse_id)
        if destination_warehouse_id is not None:
            query = query.filter(
                InventoryTransfer.destination_warehouse_id == destination_warehouse_id
            )
        if search:
            query = query.filter(InventoryTransfer.transfer_number.ilike(f"%{search}%"))
        return query

    def status_counts(self) -> dict[str, int]:
        return {
            row[0]: row[1]
            for row in self.db.query(
                InventoryTransfer.status, func.count(InventoryTransfer.id)
            )
            .group_by(InventoryTransfer.status)
            .all()
        }

    def item_aggregates(self, transfer_ids: list[int]) -> dict[int, tuple]:
        if not transfer_ids:
            return {}
        rows = (
            self.db.query(
                InventoryTransferItem.transfer_id,
                func.count(InventoryTransferItem.id),
                func.coalesce(func.sum(InventoryTransferItem.quantity), 0),
                func.coalesce(func.sum(InventoryTransferItem.dispatched_quantity), 0),
                func.coalesce(func.sum(InventoryTransferItem.received_quantity), 0),
            )
            .filter(InventoryTransferItem.transfer_id.in_(transfer_ids))
            .group_by(InventoryTransferItem.transfer_id)
            .all()
        )
        return {
            r[0]: (
                int(r[1]),
                Decimal(str(r[2])),
                Decimal(str(r[3])),
                Decimal(str(r[4])),
            )
            for r in rows
        }

    def receipt_aggregates(self, transfer_ids: list[int]) -> dict[int, object]:
        if not transfer_ids:
            return {}
        rows = (
            self.db.query(
                InventoryTransferReceipt.transfer_id,
                func.max(InventoryTransferReceipt.received_at),
            )
            .filter(InventoryTransferReceipt.transfer_id.in_(transfer_ids))
            .group_by(InventoryTransferReceipt.transfer_id)
            .all()
        )
        return {r[0]: r[1] for r in rows}

    def warehouse_names(self, warehouse_ids: list[int]) -> dict[int, str]:
        ids = [w for w in warehouse_ids if w]
        if not ids:
            return {}
        return {
            row[0]: row[1]
            for row in self.db.query(Warehouse.id, Warehouse.warehouse_name)
            .filter(Warehouse.id.in_(ids))
            .all()
        }

    def completed_today_count(self, day_start, day_end) -> int:
        return (
            self.db.query(func.count(InventoryTransfer.id))
            .filter(
                InventoryTransfer.completed_at.isnot(None),
                InventoryTransfer.completed_at >= day_start,
                InventoryTransfer.completed_at < day_end,
            )
            .scalar()
        )

    def create(
        self,
        transfer: InventoryTransfer,
    ) -> InventoryTransfer:
        self.db.add(transfer)
        self.db.flush()

        return transfer

    def create_item(
        self,
        item: InventoryTransferItem,
    ) -> InventoryTransferItem:
        self.db.add(item)
        self.db.flush()

        return item
    def get_items_for_update(self, transfer_id):
        return self.db.query(InventoryTransferItem).filter_by(transfer_id=transfer_id).order_by(
            InventoryTransferItem.id).populate_existing().with_for_update().all()
