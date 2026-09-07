from sqlalchemy.orm import Session

from app.models import (
    InventoryTransfer,
    InventoryTransferItem,
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
