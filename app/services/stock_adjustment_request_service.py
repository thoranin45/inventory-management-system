import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.exceptions import (
    AdjustmentBalanceNotFoundException,
    AdjustmentBatchRequiredException,
    AdjustmentBelowReservedException,
    AdjustmentRequestBatchNotSupportedException,
    AdjustmentRequestForbiddenException,
    AdjustmentRequestNotFoundException,
    AdjustmentRequestNotPendingException,
    AdjustmentRuleViolationException,
    BatchNotFoundException,
    IdempotencyKeyConflictException,
    ProductNotFoundException,
    SelfApprovalNotAllowedException,
    StaleQuantityConflictException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    Product,
    ProductBatch,
    StockAdjustmentRequest,
    StockBalance,
    StockOperationReceipt,
    User,
    Warehouse,
    WarehouseLocation,
)
from app.repositories.inventory_movement_repository import InventoryMovementRepository
from app.repositories.stock_adjustment_request_repository import (
    StockAdjustmentRequestRepository,
)
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.repositories.stock_repository import StockRepository
from app.schemas.stock_adjustment_request_schema import (
    AdjustmentBalanceRef,
    AdjustmentBatchRef,
    AdjustmentRequestHistoryEntry,
    LocationRef,
    ProductRef,
    StockAdjustmentRequestCreate,
    StockAdjustmentRequestDetail,
    UserRef,
    WarehouseRef,
)
from app.services.adjustment_visibility import (
    ADJUSTMENT_REFERENCE_TYPE,
    adjustment_public_remark,
    is_admin as _is_admin,
)
from app.services.stock_service import execute_adjustment_mutation


def _create_fingerprint(data: StockAdjustmentRequestCreate) -> str:
    payload = {
        "version": 1,
        "operation": "STOCK_ADJUST_REQUEST_CREATE",
        "product_id": data.product_id,
        "storage": "MAIN/DEFAULT"
        if data.warehouse_id is None and data.location_id is None
        else [data.warehouse_id, data.location_id],
        "observed_quantity": format(data.observed_quantity, ".3f"),
        "requested_quantity": format(data.requested_quantity, ".3f"),
        "reason_code": data.reason_code,
        "notes": data.notes or None,
    }
    # Phase 14D (D7): only when non-null, so every omitted/null-batch
    # fingerprint stays byte-identical to Phase 14B/14C.
    if data.batch_id is not None:
        payload["batch_id"] = data.batch_id
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


# Phase 14D (D5/B1): reasons that may only REDUCE a batch balance. Applies to
# batch-level requests only -- non-batch requests keep their 14B/14C rules.
_BATCH_DECREASE_ONLY_REASONS = frozenset({"DAMAGE", "LOSS_THEFT", "EXPIRY_WRITE_OFF"})


def _resolve_batch(db: Session, product: Product, batch_id: int | None) -> ProductBatch | None:
    """D1/D8 batch identity. A batch-tracked product needs a batch, any other
    product must not name one; a missing batch and another product's batch
    answer identically (404), so the response never reveals which exists."""
    if product.track_batch and batch_id is None:
        raise AdjustmentBatchRequiredException()
    if not product.track_batch and batch_id is not None:
        raise AdjustmentRequestBatchNotSupportedException()
    if batch_id is None:
        return None
    batch = db.get(ProductBatch, batch_id)
    if batch is None or batch.product_id != product.id:
        raise BatchNotFoundException()
    return batch


def _check_batch_rules(
    reason_code: str, observed: Decimal, requested: Decimal, batch: ProductBatch, status_code: int,
) -> None:
    """D4/D5 for a BATCH request. 422 when creating, 409 when an existing
    pending request is no longer eligible at approval."""
    if reason_code in _BATCH_DECREASE_ONLY_REASONS and not requested < observed:
        raise AdjustmentRuleViolationException(
            f"{reason_code} on a batch must reduce the quantity "
            "(requested quantity below observed quantity)",
            status_code,
        )
    if reason_code == "EXPIRY_WRITE_OFF" and not batch_eligibility.is_expired(batch):
        raise AdjustmentRuleViolationException(
            "EXPIRY_WRITE_OFF requires a batch whose expiry date is before today's "
            "business date (Asia/Bangkok); a batch expiring today is still usable",
            status_code,
        )


def _approve_fingerprint(request_id: int) -> str:
    payload = {"version": 1, "operation": "STOCK_ADJUST_REQUEST_APPROVAL", "request_id": request_id}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _build_detail_response(
    db: Session,
    request: StockAdjustmentRequest,
    *,
    product: Product | None = None,
    warehouse: Warehouse | None = None,
    location: WarehouseLocation | None = None,
) -> StockAdjustmentRequestDetail:
    product = product or db.get(Product, request.product_id)
    warehouse = warehouse or db.get(Warehouse, request.warehouse_id)
    location = location or db.get(WarehouseLocation, request.location_id)
    requested_by = db.get(User, request.requested_by_user_id)
    reviewed_by = db.get(User, request.reviewed_by_user_id) if request.reviewed_by_user_id else None
    batch = db.get(ProductBatch, request.batch_id) if request.batch_id is not None else None
    balance = (
        db.query(StockBalance)
        .filter(
            StockBalance.product_id == request.product_id,
            StockBalance.warehouse_id == request.warehouse_id,
            StockBalance.location_id == request.location_id,
            StockBalance.batch_id.is_(None) if request.batch_id is None
            else StockBalance.batch_id == request.batch_id,
        )
        .first()
    )

    history_rows = (
        db.query(AuditLog)
        .filter_by(table_name="stock_adjustment_requests", record_id=request.id)
        .order_by(AuditLog.created_at, AuditLog.id)
        .all()
    )

    return StockAdjustmentRequestDetail(
        id=request.id,
        reference_number=request.reference_number,
        status=request.status,
        product=ProductRef.model_validate(product),
        warehouse=WarehouseRef.model_validate(warehouse),
        location=LocationRef.model_validate(location),
        observed_quantity=request.observed_quantity,
        requested_quantity=request.requested_quantity,
        reason_code=request.reason_code,
        notes=request.notes,
        requested_by=UserRef.model_validate(requested_by),
        reviewed_by=UserRef.model_validate(reviewed_by) if reviewed_by else None,
        rejection_reason=request.rejection_reason,
        created_at=request.created_at,
        reviewed_at=request.reviewed_at,
        completed_at=request.completed_at,
        stock_transaction_id=request.stock_transaction_id,
        batch=(
            AdjustmentBatchRef(
                id=batch.id, lot_no=batch.lot_no, expiry_date=batch.expiry_date,
                is_expired=batch_eligibility.is_expired(batch),
            )
            if batch is not None else None
        ),
        current_balance=(
            AdjustmentBalanceRef(
                on_hand=balance.on_hand_qty, reserved=balance.reserved_qty,
                available=balance.on_hand_qty - balance.reserved_qty,
            )
            if balance is not None else None
        ),
        history=[
            AdjustmentRequestHistoryEntry(
                action=row.action, actor=row.username or "system",
                at=row.created_at, detail=row.description or "",
            )
            for row in history_rows
        ],
    )


def create_adjustment_request_service(
    db: Session,
    request_repo: StockAdjustmentRequestRepository,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    data: StockAdjustmentRequestCreate,
    operation_key: str | None,
    current_user: User,
) -> StockAdjustmentRequestDetail:
    """No stock mutation here, ever -- only metadata. Idempotency check runs
    before any other validation, mirroring stock_in_service's own ordering
    (see execute_adjustment_mutation's caller, approve_adjustment_request_service,
    for why this order matters for replay correctness).

    CREATE is reachable by any warehouse-or-admin user (a broad set), but a
    request's detail is only ever visible to its own creator or an admin (a
    narrow set) -- see get_adjustment_request_service's ownership check.
    Stock In/Out's own replay precedent has no such narrower visibility
    concept to bypass, so copying its "return the snapshot to whoever
    matches the key+payload" shape verbatim was wrong here: a stranger who
    somehow obtained another user's Idempotency-Key and could reconstruct
    their exact payload would otherwise see data a direct GET already
    correctly denies them. Every replay return point below re-applies the
    exact same ownership check as the GET path, never a new or different
    one, and only after operation_type + fingerprint are already confirmed
    to match -- a mismatch is still always a conflict, checked first."""
    created_by_user_id = current_user.id
    fingerprint = _create_fingerprint(data)

    def _authorized_replay(receipt: StockOperationReceipt) -> StockAdjustmentRequestDetail:
        if not _is_admin(current_user) and receipt.created_by_user_id != current_user.id:
            raise AdjustmentRequestForbiddenException()
        return StockAdjustmentRequestDetail.model_validate(receipt.response_snapshot)

    with UnitOfWork(db):
        if operation_key is not None:
            existing = stock_repo.get_operation_receipt(operation_key)
            if existing is not None:
                if (
                    existing.operation_type != "STOCK_ADJUST_REQUEST_CREATE"
                    or existing.request_fingerprint != fingerprint
                ):
                    raise IdempotencyKeyConflictException()
                return _authorized_replay(existing)

        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)

        product = stock_repo.get_active_product(data.product_id)
        if product is None:
            raise ProductNotFoundException()

        # Phase 14D (D1-D6): batch identity, then -- for a batch request --
        # the EXACT (product, warehouse, location, batch) balance, reason
        # rules and an early reserved-floor check. Never a fallback to
        # another batch, location or the unbatched row, and never creating a
        # balance. Approve re-checks all of it under lock. A non-batch request
        # keeps its Phase 14B/14C behavior exactly.
        batch = _resolve_batch(db, product, data.batch_id)
        if batch is not None:
            balance = balance_repo.get_exact(
                product_id=product.id, warehouse_id=warehouse.id, location_id=location.id,
                batch_id=batch.id,
            )
            if balance is None:
                raise AdjustmentBalanceNotFoundException()
            _check_batch_rules(
                data.reason_code, data.observed_quantity, data.requested_quantity, batch, 422,
            )
            if data.requested_quantity < balance.reserved_qty:
                raise AdjustmentBelowReservedException(balance.reserved_qty)

        # CREATE takes no row lock (it never touches StockBalance, unlike
        # every mutating endpoint whose lock_inventory() already serialises
        # a same-product retry before this point) -- so a genuinely
        # concurrent, identical-key CREATE can still race another one to
        # stock_operation_receipts' unique constraint. The nested
        # transaction below widens Phase 13's existing per-insert SAVEPOINT
        # to cover this request's own row and audit entry too: a lost race
        # discards all of it (pure metadata, nothing stock-related, safe to
        # throw away) rather than just the receipt insert, so the except
        # branch below can cleanly re-check what actually won and decide
        # replay-or-conflict with nothing of this attempt left dangling.
        try:
            with db.begin_nested():
                request = StockAdjustmentRequest(
                    reference_number=None,
                    product_id=product.id,
                    warehouse_id=warehouse.id,
                    location_id=location.id,
                    batch_id=batch.id if batch is not None else None,
                    observed_quantity=data.observed_quantity,
                    requested_quantity=data.requested_quantity,
                    reason_code=data.reason_code,
                    notes=data.notes,
                    status="PENDING",
                    requested_by_user_id=created_by_user_id,
                    create_operation_key=operation_key,
                )
                request_repo.create(request)
                request.reference_number = f"ADJ-{request.id:06d}"

                actor = db.get(User, created_by_user_id)
                db.add(AuditLog(
                    username=actor.username if actor else "system",
                    action="CREATE_ADJUSTMENT_REQUEST",
                    table_name="stock_adjustment_requests",
                    record_id=request.id,
                    description=(
                        f"{request.reference_number}: -> PENDING. "
                        f"Product {product.id}; observed={data.observed_quantity}; "
                        f"requested={data.requested_quantity}; reason={data.reason_code}"
                    ),
                ))

                response = _build_detail_response(db, request, product=product, warehouse=warehouse, location=location)

                if operation_key is not None:
                    stock_repo.create_operation_receipt(StockOperationReceipt(
                        operation_type="STOCK_ADJUST_REQUEST_CREATE",
                        operation_key=operation_key,
                        request_fingerprint=fingerprint,
                        response_snapshot=response.model_dump(mode="json"),
                        created_by_user_id=created_by_user_id,
                    ))
        except IdempotencyKeyConflictException:
            # Lost a genuine race at the INSERT. Re-query under READ
            # COMMITTED -- the winner's transaction has committed by the
            # time this exception reaches us (create_operation_receipt's
            # own nested block only raises after the blocked INSERT's
            # unique-violation resolves, which only happens once the
            # blocking transaction is gone), so this SELECT sees it.
            # Validate operation_type + fingerprint exactly like the
            # synchronous check above -- a genuine match replays the
            # winner's result (same contract as that check, not a new or
            # looser one); anything else (different payload, different
            # operation_type, or no committed receipt at all -- defensive,
            # shouldn't happen) is a real conflict, unchanged.
            winner = stock_repo.get_operation_receipt(operation_key)
            if (
                winner is None
                or winner.operation_type != "STOCK_ADJUST_REQUEST_CREATE"
                or winner.request_fingerprint != fingerprint
            ):
                raise
            # Same authorization gate as the synchronous check above --
            # a genuinely different user who merely raced to an identical
            # payload is not entitled to see the winner's result just
            # because they happened to lose the race to create it.
            return _authorized_replay(winner)

    return response


def approve_adjustment_request_service(
    db: Session,
    request_repo: StockAdjustmentRequestRepository,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    request_id: int,
    operation_key: str | None,
    current_user: User,
) -> StockAdjustmentRequestDetail:
    """Lock order: request row, then product (lock_inventory) -- never the
    reverse, anywhere. Idempotency lookup runs before the status check, so a
    replayed key on an already-APPROVED request returns the stored success
    instead of a confusing "already decided" -- a *different* key on that
    same terminal request still correctly 409s at the status check, since a
    fresh key has no receipt to match."""
    fingerprint = _approve_fingerprint(request_id)

    with UnitOfWork(db):
        request = request_repo.get_for_update(request_id)
        if request is None:
            raise AdjustmentRequestNotFoundException()

        balance_repo.lock_inventory([request.product_id])

        if operation_key is not None:
            existing = stock_repo.get_operation_receipt(operation_key)
            if existing is not None:
                if (
                    existing.operation_type != "STOCK_ADJUST_REQUEST_APPROVAL"
                    or existing.request_fingerprint != fingerprint
                ):
                    raise IdempotencyKeyConflictException()
                return StockAdjustmentRequestDetail.model_validate(existing.response_snapshot)

        if request.status != "PENDING":
            raise AdjustmentRequestNotPendingException(request.status)

        if request.requested_by_user_id == current_user.id:
            raise SelfApprovalNotAllowedException()

        # Revalidate warehouse/location (active + transit exclusion +
        # consistency) -- could have changed since the request was created.
        warehouse, location = balance_repo.resolve_storage(request.warehouse_id, request.location_id)

        if request.batch_id is None:
            # Non-batch: exactly the Phase 14B/14C check (an absent unbatched
            # balance reads as 0 and may still be initialised by the core).
            current_balance = balance_repo.get_balance_for_update(
                product_id=request.product_id, warehouse_id=warehouse.id, location_id=location.id,
                batch_id=None,
            )
            actual_quantity = current_balance.on_hand_qty if current_balance is not None else Decimal("0")
            if actual_quantity != Decimal(str(request.observed_quantity)):
                raise StaleQuantityConflictException(actual_quantity)
        else:
            # Phase 14D batch request, re-validated AFTER the inventory locks
            # (product -> batches -> balances, taken by lock_inventory above):
            # identity, the exact balance, stale count, reason rules and the
            # reserved floor. Anything no longer eligible is a 409.
            product = db.get(Product, request.product_id)
            batch = db.get(ProductBatch, request.batch_id)
            if product is None or not product.track_batch or batch is None or batch.product_id != product.id:
                raise AdjustmentRuleViolationException(
                    "This batch request is no longer valid for the product", 409,
                )
            current_balance = balance_repo.get_balance_for_update(
                product_id=request.product_id, warehouse_id=warehouse.id, location_id=location.id,
                batch_id=request.batch_id,
            )
            if current_balance is None:
                raise AdjustmentBalanceNotFoundException()
            if current_balance.on_hand_qty != Decimal(str(request.observed_quantity)):
                raise StaleQuantityConflictException(current_balance.on_hand_qty)
            _check_batch_rules(
                request.reason_code, Decimal(str(request.observed_quantity)),
                Decimal(str(request.requested_quantity)), batch, 409,
            )
            if Decimal(str(request.requested_quantity)) < current_balance.reserved_qty:
                raise AdjustmentBelowReservedException(current_balance.reserved_qty)

        # Phase 14C: the StockTransaction / InventoryMovement / STOCK_ADJUST
        # audit remark is readable far more broadly than the request itself
        # (dashboard, reports, ledger), so it carries only the public
        # reference + reason code -- never the request's private notes,
        # which stay on the access-controlled request row.
        remark = adjustment_public_remark(request.reference_number, request.reason_code)

        # The tested mutation core (product-active + batch-tracked guard +
        # balance/transaction/AuditLog(STOCK_ADJUST)/InventoryMovement) --
        # reused verbatim, not duplicated. Re-validates product eligibility
        # and the batch-tracked guard again on its own.
        _, transaction = execute_adjustment_mutation(
            db, stock_repo, balance_repo, movement_repo,
            product_id=request.product_id, warehouse=warehouse, location=location,
            new_quantity=request.requested_quantity, remark=remark,
            created_by_user_id=current_user.id,
            reference_type=ADJUSTMENT_REFERENCE_TYPE,
            reference_id=request.id,
            reference_number=request.reference_number,
            batch_id=request.batch_id,
        )

        now = datetime.now(timezone.utc)
        request.status = "APPROVED"
        request.reviewed_by_user_id = current_user.id
        request.reviewed_at = now
        request.completed_at = now
        # D7: recorded on every approval -- a zero-difference one writes no
        # movement, so this is its only deterministic transaction link.
        request.stock_transaction_id = transaction.id

        db.add(AuditLog(
            username=current_user.username,
            action="APPROVE_ADJUSTMENT_REQUEST",
            table_name="stock_adjustment_requests",
            record_id=request.id,
            description=(
                f"{request.reference_number}: PENDING -> APPROVED; "
                f"stock_transaction_id={transaction.id}"
            ),
        ))

        response = _build_detail_response(db, request, warehouse=warehouse, location=location)

        if operation_key is not None:
            stock_repo.create_operation_receipt(StockOperationReceipt(
                operation_type="STOCK_ADJUST_REQUEST_APPROVAL",
                operation_key=operation_key,
                request_fingerprint=fingerprint,
                response_snapshot=response.model_dump(mode="json"),
                created_by_user_id=current_user.id,
            ))

    return response


def reject_adjustment_request_service(
    db: Session,
    request_repo: StockAdjustmentRequestRepository,
    request_id: int,
    rejection_reason: str,
    current_user: User,
) -> StockAdjustmentRequestDetail:
    with UnitOfWork(db):
        request = request_repo.get_for_update(request_id)
        if request is None:
            raise AdjustmentRequestNotFoundException()

        if request.status != "PENDING":
            raise AdjustmentRequestNotPendingException(request.status)

        now = datetime.now(timezone.utc)
        request.status = "REJECTED"
        request.reviewed_by_user_id = current_user.id
        request.rejection_reason = rejection_reason
        request.reviewed_at = now
        request.completed_at = now

        db.add(AuditLog(
            username=current_user.username,
            action="REJECT_ADJUSTMENT_REQUEST",
            table_name="stock_adjustment_requests",
            record_id=request.id,
            description=f"{request.reference_number}: PENDING -> REJECTED. {rejection_reason}",
        ))

        response = _build_detail_response(db, request)

    return response


def cancel_adjustment_request_service(
    db: Session,
    request_repo: StockAdjustmentRequestRepository,
    request_id: int,
    current_user: User,
) -> StockAdjustmentRequestDetail:
    with UnitOfWork(db):
        request = request_repo.get_for_update(request_id)
        if request is None:
            raise AdjustmentRequestNotFoundException()

        if not _is_admin(current_user) and request.requested_by_user_id != current_user.id:
            raise AdjustmentRequestForbiddenException()

        if request.status != "PENDING":
            raise AdjustmentRequestNotPendingException(request.status)

        now = datetime.now(timezone.utc)
        request.status = "CANCELLED"
        request.reviewed_by_user_id = current_user.id
        request.reviewed_at = now
        request.completed_at = now

        db.add(AuditLog(
            username=current_user.username,
            action="CANCEL_ADJUSTMENT_REQUEST",
            table_name="stock_adjustment_requests",
            record_id=request.id,
            description=f"{request.reference_number}: PENDING -> CANCELLED",
        ))

        response = _build_detail_response(db, request)

    return response


def get_adjustment_request_service(
    db: Session,
    request_repo: StockAdjustmentRequestRepository,
    request_id: int,
    current_user: User,
) -> StockAdjustmentRequestDetail:
    request = request_repo.get_by_id(request_id)
    if request is None:
        raise AdjustmentRequestNotFoundException()

    if not _is_admin(current_user) and request.requested_by_user_id != current_user.id:
        raise AdjustmentRequestForbiddenException()

    return _build_detail_response(db, request)


def list_adjustment_requests_service(
    request_repo: StockAdjustmentRequestRepository,
    params,
    current_user: User,
) -> dict:
    from app.core.pagination import paginate, paginated_body, resolve_ordering

    sorts = {
        "id": StockAdjustmentRequest.id,
        "created_at": StockAdjustmentRequest.created_at,
        "status": StockAdjustmentRequest.status,
    }
    ordering = resolve_ordering(params, sorts, "created_at", StockAdjustmentRequest.id)
    scope_user_id = None if _is_admin(current_user) else current_user.id
    items, total = paginate(
        request_repo.list_query(status=params.status, requested_by_user_id=scope_user_id),
        params, ordering,
    )
    rows = [
        {
            "id": r.id, "reference_number": r.reference_number, "status": r.status,
            "product_id": r.product_id, "warehouse_id": r.warehouse_id, "location_id": r.location_id,
            "observed_quantity": r.observed_quantity, "requested_quantity": r.requested_quantity,
            "reason_code": r.reason_code, "requested_by_user_id": r.requested_by_user_id,
            "created_at": r.created_at, "batch_id": r.batch_id,
        }
        for r in items
    ]
    return paginated_body(rows, total, params, "Stock adjustment requests retrieved successfully")
