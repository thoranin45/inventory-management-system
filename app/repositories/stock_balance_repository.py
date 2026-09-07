from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Product,
    ProductBatch,
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

    def lock_inventory(self, product_ids: list[int]) -> None:
        """All inventory writers acquire product, batch, then balance locks.

        Product locks also serialize creation of previously absent balance keys.
        Call once with the complete product set, before taking inventory locks.
        """
        ids = sorted(set(product_ids))
        products = self.db.query(Product).filter(Product.id.in_(ids)).order_by(
            Product.id
        ).populate_existing().with_for_update().all()
        batches = self.db.query(ProductBatch).filter(ProductBatch.product_id.in_(ids)).order_by(
            ProductBatch.product_id, ProductBatch.id
        ).populate_existing().with_for_update().all()
        balances = self.db.query(StockBalance).filter(StockBalance.product_id.in_(ids)).order_by(
            StockBalance.product_id, StockBalance.warehouse_id, StockBalance.location_id,
            StockBalance.batch_id.nullsfirst(), StockBalance.id,
        ).populate_existing().with_for_update().all()
        for product in products:
            if product.stock_qty and not any(b.product_id == product.id for b in balances):
                raise HTTPException(409, "Inventory has stock without balance evidence; run the read-only diagnostic")
        for batch in batches:
            if batch.quantity and not any(b.batch_id == batch.id for b in balances):
                raise HTTPException(409, "Batch has stock without balance evidence; run the read-only diagnostic")

    def resolve_storage(self, warehouse_id: int | None = None, location_id: int | None = None):
        if warehouse_id is None and location_id is None:
            storage = self.get_default_storage()
            if storage is None:
                raise HTTPException(409, "Default warehouse/location not configured")
            return storage
        if warehouse_id is None or location_id is None:
            raise HTTPException(422, "warehouse_id and location_id must be supplied together")
        warehouse = self.db.query(Warehouse).filter(
            Warehouse.id == warehouse_id, Warehouse.is_active.is_(True),
        ).first()
        if warehouse is None:
            raise HTTPException(404, "Warehouse not found")
        location = self.db.query(WarehouseLocation).filter(
            WarehouseLocation.id == location_id, WarehouseLocation.warehouse_id == warehouse_id,
            WarehouseLocation.is_active.is_(True),
        ).first()
        if location is None:
            raise HTTPException(404, "Warehouse location not found")
        self.require_operational_storage(warehouse.id, location.id)
        return warehouse, location

    def product_quantity(self, product_id: int) -> Decimal:
        self.db.flush()
        return self.db.query(func.coalesce(func.sum(StockBalance.on_hand_qty), 0)).filter(
            StockBalance.product_id == product_id,
        ).scalar()

    def batch_quantity(self, batch_id: int) -> Decimal:
        self.db.flush()
        return self.db.query(func.coalesce(func.sum(StockBalance.on_hand_qty), 0)).filter(
            StockBalance.batch_id == batch_id,
        ).scalar()

    def sync_aggregates(self, product_id: int, actor: str) -> None:
        """Derive compatibility fields, retaining evidence of every changed value.

        This never changes balances, reservations, or historical ledger entries.
        The caller must hold lock_inventory's locks until its UnitOfWork ends.
        """
        product = self.db.get(Product, product_id)
        rows = [(product, "stock_qty", self.product_quantity(product_id), "products")]
        for batch in self.db.query(ProductBatch).filter_by(product_id=product_id).all():
            rows.append((batch, "quantity", self.batch_quantity(batch.id), "product_batches"))
        for row, field, derived, table in rows:
            previous = getattr(row, field)
            if previous != derived:
                self.db.add(AuditLog(
                    username=actor, action="DERIVE_INVENTORY_TOTAL", table_name=table,
                    record_id=row.id,
                    description=f"{field}: before={previous}; derived={derived}; source=StockBalance; no balance reconciliation",
                ))
                setattr(row, field, derived)

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
            .join(Warehouse, Warehouse.id == StockBalance.warehouse_id)
            .filter(Warehouse.warehouse_type.is_distinct_from("TRANSIT"), Warehouse.warehouse_code != "__TRANSIT__")
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
            .join(Warehouse, Warehouse.id == StockBalance.warehouse_id)
            .filter(Warehouse.warehouse_type.is_distinct_from("TRANSIT"), Warehouse.warehouse_code != "__TRANSIT__", StockBalance.product_id == product_id)
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

        self.require_operational_storage(warehouse.id, location.id)
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

    def get_balance_for_update(
        self,
        *,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        batch_id: int | None,
    ) -> StockBalance | None:
        return self.get_exact_for_update(
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            batch_id=batch_id,
        )

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

    def get_or_create_balance(
        self,
        *,
        product_id: int,
        warehouse_id: int,
        location_id: int,
        batch_id: int | None,
    ) -> StockBalance:
        values = {
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "batch_id": batch_id,
            "on_hand_qty": Decimal("0"),
            "reserved_qty": Decimal("0"),
        }

        statement = insert(
            StockBalance
        ).values(
            **values
        )

        if batch_id is None:
            statement = statement.on_conflict_do_nothing(
                index_elements=[
                    StockBalance.product_id,
                    StockBalance.warehouse_id,
                    StockBalance.location_id,
                ],
                index_where=(
                    StockBalance.batch_id.is_(None)
                ),
            )
        else:
            statement = statement.on_conflict_do_nothing(
                index_elements=[
                    StockBalance.product_id,
                    StockBalance.warehouse_id,
                    StockBalance.location_id,
                    StockBalance.batch_id,
                ],
                index_where=(
                    StockBalance.batch_id.is_not(None)
                ),
            )

        self.db.execute(
            statement
        )

        self.db.flush()

        balance = self.get_balance_for_update(
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            batch_id=batch_id,
        )

        if balance is None:
            raise RuntimeError(
                "Failed to get or create stock balance"
            )

        return balance

    def require_operational_storage(self, warehouse_id, location_id):
        warehouse = self.db.get(Warehouse, warehouse_id)
        location = self.db.get(WarehouseLocation, location_id)
        if warehouse is None or location is None or location.warehouse_id != warehouse_id:
            raise HTTPException(404, "Warehouse/location not found")
        if (warehouse.warehouse_type == "TRANSIT" or warehouse.warehouse_code == "__TRANSIT__" or
                location.location_type == "TRANSIT" or location.location_code == "__TRANSIT__"):
            raise HTTPException(409, "System transit storage is not operationally selectable")

    def get_transit_storage(self):
        rows = self.db.query(Warehouse, WarehouseLocation).join(
            WarehouseLocation, WarehouseLocation.warehouse_id == Warehouse.id).filter(
            Warehouse.warehouse_code == "__TRANSIT__", Warehouse.warehouse_type == "TRANSIT",
            WarehouseLocation.location_code == "__TRANSIT__", WarehouseLocation.location_type == "TRANSIT",
            Warehouse.is_active.is_(True), WarehouseLocation.is_active.is_(True)).all()
        if len(rows) != 1:
            raise HTTPException(409, "System transit configuration is missing or incompatible")
        return rows[0]

    # ------------------------------------------------------------------ #
    # Phase 7: derived operational availability. Never persisted, never a
    # replacement for Product.stock_qty (which stays total owned inventory).
    # ------------------------------------------------------------------ #
    def _operational_available_query(self, today: date):
        return (
            self.db.query(
                StockBalance.product_id.label("product_id"),
                func.coalesce(
                    func.sum(StockBalance.on_hand_qty - StockBalance.reserved_qty), 0
                ).label("available"),
            )
            .join(Warehouse, Warehouse.id == StockBalance.warehouse_id)
            .outerjoin(ProductBatch, ProductBatch.id == StockBalance.batch_id)
            .filter(
                Warehouse.warehouse_type.is_distinct_from("TRANSIT"),
                Warehouse.warehouse_code != "__TRANSIT__",
                or_(
                    StockBalance.batch_id.is_(None),
                    ProductBatch.expiry_date.is_(None),
                    ProductBatch.expiry_date >= today,
                ),
            )
            .group_by(StockBalance.product_id)
        )

    def operational_available_quantity(self, product_id: int, today: date) -> Decimal:
        """SUM(on_hand - reserved) over operational (non-transit), non-expired balances."""
        row = (
            self._operational_available_query(today)
            .filter(StockBalance.product_id == product_id)
            .first()
        )
        return Decimal(str(row.available)) if row is not None else Decimal("0")

    def operational_available_by_product(self, today: date) -> dict[int, Decimal]:
        return {
            row.product_id: Decimal(str(row.available))
            for row in self._operational_available_query(today).all()
        }
