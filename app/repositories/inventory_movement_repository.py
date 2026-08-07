from datetime import datetime

from sqlalchemy.orm import Session

from app.models import InventoryMovement


class InventoryMovementRepository:
    def __init__(
        self,
        db: Session,
    ) -> None:
        self.db = db

    def create(
        self,
        movement: InventoryMovement,
    ) -> InventoryMovement:
        self.db.add(movement)
        self.db.flush()

        return movement

    def get_all(
        self,
    ) -> list[InventoryMovement]:
        return (
            self.db.query(InventoryMovement)
            .order_by(
                InventoryMovement.created_at.desc(),
                InventoryMovement.id.desc(),
            )
            .all()
        )

    def get_by_product(
        self,
        product_id: int,
    ) -> list[InventoryMovement]:
        return (
            self.db.query(InventoryMovement)
            .filter(
                InventoryMovement.product_id
                == product_id
            )
            .order_by(
                InventoryMovement.created_at.desc(),
                InventoryMovement.id.desc(),
            )
            .all()
        )

    def get_by_reference(
        self,
        reference_type: str,
        reference_id: int,
    ) -> list[InventoryMovement]:
        return (
            self.db.query(InventoryMovement)
            .filter(
                InventoryMovement.reference_type
                == reference_type,
                InventoryMovement.reference_id
                == reference_id,
            )
            .order_by(
                InventoryMovement.id.asc()
            )
            .all()
        )

    def search(
        self,
        *,
        page: int = 1,
        size: int = 50,
        product_id: int | None = None,
        warehouse_id: int | None = None,
        location_id: int | None = None,
        batch_id: int | None = None,
        movement_type: str | None = None,
        reference_type: str | None = None,
        reference_id: int | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
    ) -> tuple[
        list[InventoryMovement],
        int,
    ]:
        query = self.db.query(
            InventoryMovement
        )

        if product_id is not None:
            query = query.filter(
                InventoryMovement.product_id
                == product_id
            )

        if warehouse_id is not None:
            query = query.filter(
                InventoryMovement.warehouse_id
                == warehouse_id
            )

        if location_id is not None:
            query = query.filter(
                InventoryMovement.location_id
                == location_id
            )

        if batch_id is not None:
            query = query.filter(
                InventoryMovement.batch_id
                == batch_id
            )

        if movement_type is not None:
            query = query.filter(
                InventoryMovement.movement_type
                == movement_type
            )

        if reference_type is not None:
            query = query.filter(
                InventoryMovement.reference_type
                == reference_type
            )

        if reference_id is not None:
            query = query.filter(
                InventoryMovement.reference_id
                == reference_id
            )

        if date_from is not None:
            query = query.filter(
                InventoryMovement.created_at
                >= date_from
            )

        if date_to is not None:
            query = query.filter(
                InventoryMovement.created_at
                <= date_to
            )

        total = query.count()

        items = (
            query
            .order_by(
                InventoryMovement.created_at.desc(),
                InventoryMovement.id.desc(),
            )
            .offset(
                (page - 1) * size
            )
            .limit(size)
            .all()
        )

        return items, total