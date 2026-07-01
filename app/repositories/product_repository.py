from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Product


class ProductRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, product_id: int):
        return self.db.query(Product).filter(
            Product.id == product_id,
            Product.is_active == True
        ).first()

    def get_by_sku(self, sku: str):
        return self.db.query(Product).filter(
            Product.sku == sku
        ).first()

    def get_by_barcode(self, barcode: str):
        return self.db.query(Product).filter(
            Product.barcode == barcode
        ).first()

    def create(self, product: Product):
        self.db.add(product)
        self.db.flush()
        return product

    def update(self, product: Product):
        self.db.add(product)
        self.db.flush()
        return product

    def soft_delete(self, product: Product):
        product.is_active = False
        self.db.add(product)
        self.db.flush()
        return product

    def restore(self, product: Product):
        product.is_active = True
        self.db.add(product)
        self.db.flush()
        return product

    def get_active_paginated(self, page: int, size: int):
        query = self.db.query(Product).filter(
            Product.is_active == True
        )

        total = query.count()

        products = query.offset(
            (page - 1) * size
        ).limit(
            size
        ).all()

        return total, products

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

    def get_inactive_by_id(self, product_id: int):
        return self.db.query(Product).filter(
            Product.id == product_id,
            Product.is_active == False
        ).first()