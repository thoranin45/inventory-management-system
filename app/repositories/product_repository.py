from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Product, ProductBatch, StockBalance, InventoryMovement, StockTransaction, SalesOrderBatchAllocation, SalesOrderItem
from app.repositories.base_repository import BaseRepository


class ProductRepository(BaseRepository):
    def has_inventory_evidence(self, product_id: int) -> bool:
        return any(
            self.db.query(model.id).filter(model.product_id == product_id).first() is not None
            for model in (ProductBatch, StockBalance, InventoryMovement, StockTransaction,
                          SalesOrderBatchAllocation, SalesOrderItem)
        )

    def __init__(self, db: Session):
        super().__init__(
            db,
            Product
        )

    def get_by_id(self, product_id: int):
        return self.get_active_by_id(product_id)

    def get_by_id_for_update(
        self,
        product_id: int,
    ) -> Product | None:
        return (
            self.db.query(Product)
            .filter(
                Product.id == product_id,
                Product.is_active.is_(True),
            )
            .with_for_update()
            .first()
        )

    def get_by_sku(self, sku: str):
        return self.db.query(Product).filter(
            Product.sku == sku
        ).first()

    def get_by_barcode(self, barcode: str):
        return self.db.query(Product).filter(
            Product.barcode == barcode
        ).first()

    def search_active(self, keyword: str):
        return self.db.query(Product).filter(
            Product.is_active == True
        ).filter(
            or_(
                Product.product_name.ilike(f"%{keyword}%"),
                Product.sku.ilike(f"%{keyword}%"),
                Product.barcode.ilike(f"%{keyword}%")
            )
        ).all()

    def get_active_by_barcode(self, barcode: str):
        return self.db.query(Product).filter(
            Product.barcode == barcode,
            Product.is_active == True
        ).first()

    def get_inactive_all(self):
        return self.db.query(Product).filter(
            Product.is_active == False
        ).all()

