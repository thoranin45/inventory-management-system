from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import (
    StockBalance,
    Warehouse,
    WarehouseLocation,
)


class StockBalanceRepository:
    def __init__(
        self,
        db: Session,
    ) -> None:
        self.db = db

    def get_by_id(
        self,
        balance_id: int,
    ) -> StockBalance | None:
        return (
            self.db.query(StockBalance)
            .filter(
                StockBalance.id == balance_id
            )
            .first()
        )

    def get_all(
        self,
    ) -> list[StockBalance]:
        return (
            self.db.query(StockBalance)
            .order_by(
                StockBalance.product_id,
                StockBalance.warehouse_id,
                StockBalance.location_id,
                StockBalance.batch_id,
            )
            .all()
        )

    def get_by_product(
        self,
        product_id: int,
    ) -> list[StockBalance]:
        return (
            self.db.query(StockBalance)
            .filter(
                StockBalance.product_id
                == product_id
            )
            .order_by(
                StockBalance.warehouse_id,
                StockBalance.location_id,
                StockBalance.batch_id,
            )
            .all()
        )

    def get_exact(
        self,
        *,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        batch_id: int | None,
    ) -> StockBalance | None:

        query = (
            self.db.query(StockBalance)
            .filter(
                StockBalance.product_id
                == product_id,
                StockBalance.warehouse_id
                == warehouse_id,
                StockBalance.location_id
                == location_id,
            )
        )

        if batch_id is None:
            query = query.filter(
                StockBalance.batch_id.is_(None)
            )
        else:
            query = query.filter(
                StockBalance.batch_id
                == batch_id
            )

        return query.first()

    def add(
        self,
        balance: StockBalance,
    ) -> StockBalance:
        self.db.add(balance)

        return balance

    def get_default_storage(
        self,
    ) -> tuple[Warehouse, WarehouseLocation] | None:
        warehouse = (
            self.db.query(Warehouse)
            .filter(
                Warehouse.warehouse_code == "MAIN",
                Warehouse.is_active.is_(True),
            )
            .first()
        )

        if warehouse is None:
            return None

        location = (
            self.db.query(WarehouseLocation)
            .filter(
                WarehouseLocation.warehouse_id
                == warehouse.id,
                WarehouseLocation.location_code
                == "DEFAULT",
                WarehouseLocation.is_active.is_(True),
            )
            .first()
        )

        if location is None:
            return None

        return warehouse, location

    def get_default_product_balance(
        self,
        product_id: int,
    ) -> StockBalance | None:
        storage = self.get_default_storage()

        if storage is None:
            return None

        warehouse, location = storage

        return self.get_exact(
            product_id=product_id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            batch_id=None,
        )

    def create_default_product_balance(
        self,
        product_id: int,
    ) -> StockBalance:
        storage = self.get_default_storage()

        if storage is None:
            raise RuntimeError(
                "Default warehouse/location not configured"
            )

        warehouse, location = storage

        balance = StockBalance(
            product_id=product_id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            batch_id=None,
            on_hand_qty=0,
            reserved_qty=0,
        )

        self.db.add(balance)
        self.db.flush()

        return balance

    def get_default_batch_balance(
        self,
        product_id: int,
        batch_id: int,
    ) -> StockBalance | None:
        storage = self.get_default_storage()

        if storage is None:
            return None

        warehouse, location = storage

        return self.get_exact(
            product_id=product_id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            batch_id=batch_id,
        )


    def create_default_batch_balance(
        self,
        product_id: int,
        batch_id: int,
        on_hand_qty,
    ) -> StockBalance:
        storage = self.get_default_storage()

        if storage is None:
            raise RuntimeError(
                "Default warehouse/location not configured"
            )

        warehouse, location = storage

        balance = StockBalance(
            product_id=product_id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            batch_id=batch_id,
            on_hand_qty=on_hand_qty,
            reserved_qty=0,
        )

        self.db.add(balance)
        self.db.flush()

        return balance

    def get_balance(
        self,
        *,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        batch_id: int | None,
    ) -> StockBalance | None:
        return self.get_exact(
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            batch_id=batch_id,
        )

    def create_balance(
        self,
        *,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        batch_id: int | None,
    ) -> StockBalance:
        balance = StockBalance(
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            batch_id=batch_id,
            on_hand_qty=Decimal("0"),
            reserved_qty=Decimal("0"),
        )

        self.db.add(balance)
        self.db.flush()

        return balance

def get_exact_for_update(
    self,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    batch_id: int | None,
) -> StockBalance | None:

    query = (
        self.db.query(StockBalance)
        .filter(
            StockBalance.product_id
            == product_id,
            StockBalance.warehouse_id
            == warehouse_id,
            StockBalance.location_id
            == location_id,
        )
        .with_for_update()
    )

    if batch_id is None:
        query = query.filter(
            StockBalance.batch_id.is_(None)
        )
    else:
        query = query.filter(
            StockBalance.batch_id
            == batch_id
        )

    return query.first()

def get_default_batch_balance_for_update(
    self,
    product_id: int,
    batch_id: int,
) -> StockBalance | None:
    storage = self.get_default_storage()

    if storage is None:
        return None

    warehouse, location = storage

    return self.get_exact_for_update(
        product_id=product_id,
        warehouse_id=warehouse.id,
        location_id=location.id,
        batch_id=batch_id,
    )

def get_default_product_balance_for_update(
    self,
    product_id: int,
) -> StockBalance | None:
    storage = self.get_default_storage()

    if storage is None:
        return None

    warehouse, location = storage

    return self.get_exact_for_update(
        product_id=product_id,
        warehouse_id=warehouse.id,
        location_id=location.id,
        batch_id=None,
    )