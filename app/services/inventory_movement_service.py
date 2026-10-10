from datetime import date, datetime
import math

from app.models import (
    InventoryMovement,
    InventoryTransferReceipt,
    PurchaseOrderReceipt,
    User,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)
from app.schemas.inventory_movement_schema import (
    InventoryLedgerItem,
    InventoryMovementListResponse,
    InventoryMovementPagination,
    InventoryMovementResponse,
    LedgerAdjustmentRef,
    LedgerBatchRef,
    LedgerLocationRef,
    LedgerProductRef,
    LedgerSourceRef,
    LedgerUserRef,
    LedgerWarehouseRef,
    MOVEMENT_GROUPS,
)
from app.services import adjustment_visibility as visibility


def get_inventory_movements_service(
    repo: InventoryMovementRepository,
) -> list[InventoryMovement]:
    return repo.get_all()


def _redacted_legacy_items(
    repo: InventoryMovementRepository,
    movements: list[InventoryMovement],
    current_user: User,
) -> list[InventoryMovementResponse]:
    """Same bare-array shape and ordering as before Phase 14C; only an
    adjustment ``remark`` the viewer may not see is replaced (on a copy --
    the ORM rows are never touched)."""
    requests = visibility.requests_for_movements(repo.db, movements)
    items = []
    for m in movements:
        visible = visibility.movement_remark(current_user, m, requests)
        item = InventoryMovementResponse.model_validate(m)
        if visible.redacted:
            item = item.model_copy(update={"remark": visible.remark})
        items.append(item)
    return items


def get_product_inventory_movements_service(
    repo: InventoryMovementRepository,
    product_id: int,
    current_user: User,
) -> list[InventoryMovementResponse]:
    return _redacted_legacy_items(repo, repo.get_by_product(product_id), current_user)


def get_reference_inventory_movements_service(
    repo: InventoryMovementRepository,
    reference_type: str,
    reference_id: int,
    current_user: User,
) -> list[InventoryMovementResponse]:
    movements = repo.get_by_reference(
        reference_type=reference_type,
        reference_id=reference_id,
    )
    return _redacted_legacy_items(repo, movements, current_user)


def _is_transit(warehouse) -> bool:
    return warehouse.warehouse_code == "__TRANSIT__" or warehouse.warehouse_type == "TRANSIT"


def _receipt_numbers(db, model, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = db.query(model.id, model.receipt_number).filter(model.id.in_(ids)).all()
    return {row.id: row.receipt_number for row in rows}


def _ledger_items(
    repo: InventoryMovementRepository,
    movements: list[InventoryMovement],
    current_user: User,
) -> list[InventoryLedgerItem]:
    """Bounded lookups for the whole page: adjustment requests, their
    requesters, and PO / transfer receipt numbers -- at most four queries,
    whatever the page size."""
    from app.core.timestamps import utc_iso

    db = repo.db
    requests = visibility.requests_for_movements(db, movements)
    requester_ids = {r.requested_by_user_id for r in requests.values()}
    requesters = (
        {u.id: u for u in db.query(User).filter(User.id.in_(requester_ids)).all()}
        if requester_ids else {}
    )
    po_receipts = _receipt_numbers(
        db, PurchaseOrderReceipt, {m.purchase_receipt_id for m in movements if m.purchase_receipt_id},
    )
    transfer_receipts = _receipt_numbers(
        db, InventoryTransferReceipt, {m.transfer_receipt_id for m in movements if m.transfer_receipt_id},
    )

    items = []
    for m in movements:
        visible = visibility.movement_remark(current_user, m, requests)

        adjustment = None
        if visibility.is_adjustment_movement(m):
            request = (
                requests.get(m.reference_id)
                if m.reference_type == visibility.ADJUSTMENT_REFERENCE_TYPE
                else None
            )
            allowed = visibility.can_view_private(current_user, request)
            if request is None:
                adjustment = LedgerAdjustmentRef(
                    linked=False, request_id=None, reference_number=None, reason_code=None,
                    status=None, requested_by=None, notes=None,
                    can_view_detail=False, redacted=not allowed,
                )
            else:
                requester = requesters.get(request.requested_by_user_id)
                adjustment = LedgerAdjustmentRef(
                    linked=True,
                    request_id=request.id,
                    reference_number=request.reference_number,
                    reason_code=request.reason_code,
                    status=request.status,
                    requested_by=(
                        LedgerUserRef(id=requester.id, username=requester.username)
                        if allowed and requester is not None else None
                    ),
                    notes=request.notes if allowed else None,
                    can_view_detail=allowed,
                    redacted=not allowed,
                )

        receipt_number = None
        if m.purchase_receipt_id:
            receipt_number = po_receipts.get(m.purchase_receipt_id)
        elif m.transfer_receipt_id:
            receipt_number = transfer_receipts.get(m.transfer_receipt_id)

        base = InventoryMovementResponse.model_validate(m).model_dump()
        base["remark"] = visible.remark
        items.append(InventoryLedgerItem(
            **base,
            occurred_at=utc_iso(m.created_at),
            direction="IN" if m.quantity > 0 else "OUT",
            is_transit_leg=_is_transit(m.warehouse),
            product=LedgerProductRef(
                id=m.product.id, sku=m.product.sku, product_name=m.product.product_name,
                is_active=bool(m.product.is_active),
            ),
            batch=(
                LedgerBatchRef(id=m.batch.id, lot_no=m.batch.lot_no, expiry_date=m.batch.expiry_date)
                if m.batch is not None else None
            ),
            warehouse=LedgerWarehouseRef(
                id=m.warehouse.id, warehouse_code=m.warehouse.warehouse_code,
                warehouse_name=m.warehouse.warehouse_name, is_active=bool(m.warehouse.is_active),
            ),
            location=LedgerLocationRef(
                id=m.location.id, location_code=m.location.location_code,
                location_name=m.location.location_name, is_active=bool(m.location.is_active),
            ),
            created_by=(
                LedgerUserRef(id=m.created_by.id, username=m.created_by.username)
                if m.created_by is not None else None
            ),
            source=LedgerSourceRef(
                type=m.reference_type, id=m.reference_id, number=m.reference_number,
                receipt_number=receipt_number,
            ),
            adjustment=adjustment,
            remark_redacted=visible.redacted,
        ))
    return items


def search_inventory_movements_service(
    repo: InventoryMovementRepository,
    *,
    current_user: User,
    page: int,
    size: int,
    product_id: int | None,
    warehouse_id: int | None,
    location_id: int | None,
    batch_id: int | None,
    movement_type: str | None,
    reference_type: str | None,
    reference_id: int | None,
    date_from: datetime | None,
    date_to: datetime | None,
    from_date: date | None = None,
    to_date: date | None = None,
    movement_group: str | None = None,
    reference_number: str | None = None,
    actor: str | None = None,
    include_transit: bool = True,
    sort_order: str = "desc",
) -> InventoryMovementListResponse:
    """Validation of the new parameters lives in the router; this layer
    trusts it. ``actor`` is already restricted to Admin there.

    ``occurred_at`` and the business-day bounds interpret naive
    ``created_at`` in the declared ``settings.db_naive_timezone`` -- an
    explicit, verified-per-environment assumption, never inferred from the
    current session (see app/core/timestamps.py)."""
    from app.core.timestamps import business_date_range_to_naive

    naive_start, naive_end = business_date_range_to_naive(from_date, to_date)

    items, total = repo.search(
        page=page,
        size=size,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        batch_id=batch_id,
        movement_type=movement_type,
        reference_type=reference_type,
        reference_id=reference_id,
        date_from=date_from,
        date_to=date_to,
        naive_start=naive_start,
        naive_end=naive_end,
        movement_types=MOVEMENT_GROUPS[movement_group] if movement_group else None,
        reference_number=reference_number,
        actor_username=actor,
        include_transit=include_transit,
        ascending=sort_order == "asc",
    )

    from app.core.pagination import phase8_json

    total_pages = math.ceil(total / size) if total > 0 else 0
    return {
        "success": True,
        "message": "Inventory movements retrieved successfully",
        "data": {
            "items": phase8_json(_ledger_items(repo, items, current_user)),
            "pagination": {
                "page": page,
                "page_size": size,
                "total_items": total,
                "total_pages": total_pages,
            },
        },
    }
