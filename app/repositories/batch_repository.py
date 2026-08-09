from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import ProductBatch


class BatchRepository:
    def __init__(
        self,
        db: Session,
    ):
        self.db = db

    def get_by_lot_no(
        self,
        lot_no: str,
    ) -> ProductBatch | None:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.lot_no == lot_no
            )
            .first()
        )

    def create(
        self,
        batch: ProductBatch,
    ) -> ProductBatch:
        self.db.add(batch)
        self.db.flush()

        return batch

    def get_all(
        self,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .order_by(
                ProductBatch.created_at.desc(),
                ProductBatch.id.desc(),
            )
            .all()
        )

    def get_expiring(
        self,
    ) -> list[ProductBatch]:
        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.quantity > 0
            )
            .order_by(
                ProductBatch.expiry_date.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )

    def create_if_lot_not_exists(
        self,
        batch: ProductBatch,
    ) -> ProductBatch | None:
        statement = (
            insert(ProductBatch)
            .values(
                product_id=batch.product_id,
                lot_no=batch.lot_no,
                mfg_date=batch.mfg_date,
                expiry_date=batch.expiry_date,
                quantity=batch.quantity,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    ProductBatch.lot_no,
                ]
            )
            .returning(
                ProductBatch.id
            )
        )

        batch_id = self.db.execute(
            statement
        ).scalar_one_or_none()

        if batch_id is None:
            return None

        return (
            self.db.query(ProductBatch)
            .filter(
                ProductBatch.id == batch_id
            )
            .first()
        )