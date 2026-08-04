from sqlalchemy.orm import Session

from app.models import Category
from app.repositories.base_repository import BaseRepository


class CategoryRepository(BaseRepository):
    def __init__(self, db: Session):
        super().__init__(db, Category)

    def get_all(self):
        return self.db.query(Category).all()

    def get_by_id(self, category_id: int):
        return self.db.query(Category).filter(
            Category.id == category_id
        ).first()

    def get_by_name(self, category_name: str):
        return self.db.query(Category).filter(
            Category.category_name == category_name
        ).first()