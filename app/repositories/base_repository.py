from sqlalchemy.orm import Session


class BaseRepository:
    def __init__(self, db: Session, model):
        self.db = db
        self.model = model

    def get_by_id(self, record_id: int):
        return self.db.query(self.model).filter(
            self.model.id == record_id
        ).first()

    def get_active_by_id(self, record_id: int):
        return self.db.query(self.model).filter(
            self.model.id == record_id,
            self.model.is_active == True
        ).first()

    def get_inactive_by_id(self, record_id: int):
        return self.db.query(self.model).filter(
            self.model.id == record_id,
            self.model.is_active == False
        ).first()

    def get_active_all(self):
        return self.db.query(self.model).filter(
            self.model.is_active == True
        ).all()

    def get_inactive_all(self):
        return self.db.query(self.model).filter(
            self.model.is_active == False
        ).all()

    def get_active_paginated(self, page: int, size: int):
        query = self.db.query(self.model).filter(
            self.model.is_active == True
        )

        total = query.count()

        items = query.offset(
            (page - 1) * size
        ).limit(
            size
        ).all()

        return total, items

    def create(self, obj):
        self.db.add(obj)
        self.db.flush()
        return obj

    def update(self, obj):
        self.db.add(obj)
        self.db.flush()
        return obj

    def delete(self, obj):
        self.db.delete(obj)
        self.db.flush()
        return obj

    def soft_delete(self, obj):
        obj.is_active = False
        self.update(obj)
        return obj

    def restore(self, obj):
        obj.is_active = True
        self.update(obj)
        return obj