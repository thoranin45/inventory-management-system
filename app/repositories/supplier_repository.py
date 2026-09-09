from sqlalchemy.orm import Session

from app.models import Supplier
from app.repositories.base_repository import BaseRepository


class SupplierRepository(BaseRepository):
    def __init__(self, db: Session):
        super().__init__(db, Supplier)

    def get_all(self):
        return self.db.query(Supplier).all()

    def list_query(self, *, search: str | None = None):
        query = self.db.query(Supplier)
        if search:
            query = query.filter(Supplier.supplier_name.ilike(f"%{search}%"))
        return query

    def get_by_id(self, supplier_id: int):
        return self.db.query(Supplier).filter(
            Supplier.id == supplier_id
        ).first()

    def get_by_name(self, supplier_name: str):
        return self.db.query(Supplier).filter(
            Supplier.supplier_name == supplier_name
        ).first()