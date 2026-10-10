from sqlalchemy.orm import Session

from app.models import StockAdjustmentRequest


class StockAdjustmentRequestRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, request: StockAdjustmentRequest) -> StockAdjustmentRequest:
        self.db.add(request)
        self.db.flush()
        return request

    def get_for_update(self, request_id: int) -> StockAdjustmentRequest | None:
        return (
            self.db.query(StockAdjustmentRequest)
            .filter(StockAdjustmentRequest.id == request_id)
            .with_for_update()
            .first()
        )

    def get_by_id(self, request_id: int) -> StockAdjustmentRequest | None:
        return (
            self.db.query(StockAdjustmentRequest)
            .filter(StockAdjustmentRequest.id == request_id)
            .first()
        )

    def list_query(self, *, status: str | None = None, requested_by_user_id: int | None = None):
        """``requested_by_user_id=None`` means "every requester" (admin's
        queue). A non-admin caller must always pass their own id here --
        enforced by the service, this repository just applies whatever
        scope it's given."""
        query = self.db.query(StockAdjustmentRequest)
        if status:
            wanted = [s.strip().upper() for s in status.split(",") if s.strip()]
            query = query.filter(StockAdjustmentRequest.status.in_(wanted))
        if requested_by_user_id is not None:
            query = query.filter(StockAdjustmentRequest.requested_by_user_id == requested_by_user_id)
        return query

    def count_other_pending(
        self, *, product_id: int, warehouse_id: int, location_id: int, exclude_id: int,
    ) -> int:
        """Non-blocking UI hint only (D5) -- never a gate on create or approve."""
        return (
            self.db.query(StockAdjustmentRequest)
            .filter(
                StockAdjustmentRequest.product_id == product_id,
                StockAdjustmentRequest.warehouse_id == warehouse_id,
                StockAdjustmentRequest.location_id == location_id,
                StockAdjustmentRequest.status == "PENDING",
                StockAdjustmentRequest.id != exclude_id,
            )
            .count()
        )
