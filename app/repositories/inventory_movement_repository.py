from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models import InventoryMovement, User, Warehouse


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
        naive_start: datetime | None = None,
        naive_end: datetime | None = None,
        movement_types: tuple[str, ...] | None = None,
        reference_number: str | None = None,
        actor_username: str | None = None,
        include_transit: bool = True,
        ascending: bool = False,
    ) -> tuple[
        list[InventoryMovement],
        int,
    ]:
        """Legacy filters keep their exact pre-14C semantics (including raw
        naive ``date_from``/``date_to`` comparison). Phase 14C adds:

        - ``naive_start``/``naive_end``: half-open ``[start, end)`` bounds the
          service already converted from business days into the declared
          naive storage zone.
        - ``movement_types`` (from ``movement_group``), ``reference_number``
          (exact), ``actor_username`` (exact, current username of
          ``created_by``), ``include_transit`` and ``ascending``.

        Product/batch/warehouse/location/actor are eager-loaded in the page
        query itself (all many-to-one), so a page costs one count + one
        select regardless of size. No ``is_active`` predicate is applied to
        any related entity: inactive history stays visible.
        """
        query = self.db.query(
            InventoryMovement
        )

        if not include_transit:
            transit_ids = (
                self.db.query(Warehouse.id)
                .filter(or_(
                    Warehouse.warehouse_code == "__TRANSIT__",
                    Warehouse.warehouse_type == "TRANSIT",
                ))
            )
            query = query.filter(
                InventoryMovement.warehouse_id.not_in(transit_ids.scalar_subquery())
            )

        if movement_types is not None:
            query = query.filter(
                InventoryMovement.movement_type.in_(movement_types)
            )

        if reference_number is not None:
            query = query.filter(
                InventoryMovement.reference_number == reference_number
            )

        if actor_username is not None:
            actor_ids = self.db.query(User.id).filter(User.username == actor_username)
            query = query.filter(
                InventoryMovement.created_by_user_id.in_(actor_ids.scalar_subquery())
            )

        if naive_start is not None:
            query = query.filter(InventoryMovement.created_at >= naive_start)

        if naive_end is not None:
            query = query.filter(InventoryMovement.created_at < naive_end)

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

        ordering = (
            (InventoryMovement.created_at.asc(), InventoryMovement.id.asc())
            if ascending
            else (InventoryMovement.created_at.desc(), InventoryMovement.id.desc())
        )

        items = (
            query
            .options(
                joinedload(InventoryMovement.product),
                joinedload(InventoryMovement.batch),
                joinedload(InventoryMovement.warehouse),
                joinedload(InventoryMovement.location),
                joinedload(InventoryMovement.created_by),
            )
            .order_by(*ordering)
            .offset(
                (page - 1) * size
            )
            .limit(size)
            .all()
        )

        return items, total