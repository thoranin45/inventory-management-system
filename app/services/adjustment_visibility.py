"""Phase 14C: the one adjustment-privacy policy every read path applies.

A stock adjustment request's ``notes`` and the identity of whoever
requested it are visible only to Admin and to the request's own requester
(the same rule ``get_adjustment_request_service`` enforces on the request
detail). Before Phase 14C, approval copied ``"<reason>: <notes>"`` into the
StockTransaction / InventoryMovement / STOCK_ADJUST audit remarks, which
the dashboard, reports, stock history and movement endpoints serve to
every warehouse user. New approvals no longer do that (see
``adjustment_public_remark``); historical rows are never rewritten, so
their remarks are redacted here, at response time, instead.

Ownership is resolved only from immutable user ids, and only through a
deterministic link:

- InventoryMovement with ``reference_type == STOCK_ADJUSTMENT_REQUEST``
  -> that request's ``requested_by_user_id``.
- StockTransaction(ADJUST) referenced by a request's
  ``stock_transaction_id`` -> that request's ``requested_by_user_id``.

Anything else that is an adjustment (a retired direct ``/stock/adjust``,
or an approval made before 14C linked anything) has *unknown* ownership:
its ``created_by`` is the operator or the approving Admin, never provably
the requester, so its remark is withheld from every non-admin viewer.
Non-adjustment rows are returned exactly as stored.

Nothing here mutates ORM instances -- callers get plain values to put into
their own response objects.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import (
    InventoryMovement,
    StockAdjustmentRequest,
    StockTransaction,
    User,
)


ADJUSTMENT_REFERENCE_TYPE = "STOCK_ADJUSTMENT_REQUEST"
ADJUSTMENT_MOVEMENT_TYPE = "STOCK_ADJUST"
ADJUSTMENT_TRANSACTION_TYPE = "ADJUST"


def is_admin(user: User) -> bool:
    return (getattr(user, "role", None) or "").lower() == "admin"


def adjustment_public_remark(reference_number: str, reason_code: str) -> str:
    """The only adjustment text safe for broadly readable rows: the request's
    reference number and reason code -- never its notes. 255 = the
    StockTransaction.remark column width."""
    return f"{reference_number}: {reason_code}"[:255]


def can_view_private(viewer: User, request: StockAdjustmentRequest | None) -> bool:
    if is_admin(viewer):
        return True
    return request is not None and request.requested_by_user_id == viewer.id


def is_adjustment_movement(movement: InventoryMovement) -> bool:
    return (
        movement.movement_type == ADJUSTMENT_MOVEMENT_TYPE
        or movement.reference_type == ADJUSTMENT_REFERENCE_TYPE
    )


def requests_for_movements(db: Session, movements) -> dict[int, StockAdjustmentRequest]:
    """request id -> request, for every linked adjustment movement. One query."""
    ids = {
        m.reference_id for m in movements
        if m.reference_type == ADJUSTMENT_REFERENCE_TYPE and m.reference_id is not None
    }
    if not ids:
        return {}
    rows = db.query(StockAdjustmentRequest).filter(StockAdjustmentRequest.id.in_(ids)).all()
    return {r.id: r for r in rows}


def requests_for_transactions(db: Session, transactions) -> dict[int, StockAdjustmentRequest]:
    """transaction id -> request, for every ADJUST transaction a request links. One query."""
    ids = {t.id for t in transactions if t.transaction_type == ADJUSTMENT_TRANSACTION_TYPE}
    if not ids:
        return {}
    rows = (
        db.query(StockAdjustmentRequest)
        .filter(StockAdjustmentRequest.stock_transaction_id.in_(ids))
        .all()
    )
    return {r.stock_transaction_id: r for r in rows}


@dataclass(frozen=True)
class VisibleRemark:
    remark: str | None
    redacted: bool


def _visible(viewer, stored: str | None, request: StockAdjustmentRequest | None) -> VisibleRemark:
    if can_view_private(viewer, request):
        return VisibleRemark(stored, False)
    if request is not None:
        public = adjustment_public_remark(request.reference_number, request.reason_code)
        return VisibleRemark(public, stored != public)
    # Unknown ownership: withhold the stored text entirely.
    return VisibleRemark(None, stored is not None)


def movement_remark(viewer: User, movement: InventoryMovement, requests: dict) -> VisibleRemark:
    if not is_adjustment_movement(movement):
        return VisibleRemark(movement.remark, False)
    request = (
        requests.get(movement.reference_id)
        if movement.reference_type == ADJUSTMENT_REFERENCE_TYPE
        else None
    )
    return _visible(viewer, movement.remark, request)


def transaction_remark(viewer: User, transaction: StockTransaction, requests: dict) -> VisibleRemark:
    if transaction.transaction_type != ADJUSTMENT_TRANSACTION_TYPE:
        return VisibleRemark(transaction.remark, False)
    return _visible(viewer, transaction.remark, requests.get(transaction.id))
