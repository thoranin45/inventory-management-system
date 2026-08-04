from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Product
from app.repositories.base_repository import BaseRepository


class ProductRepository(BaseRepository):
    def __init__(self, db: Session):
        super().__init__(
            db,
            Product
        )

    def get_by_id(self, product_id: int):
        return self.get_active_by_id(product_id)

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

    