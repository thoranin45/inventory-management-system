"""R5-SAFE.1B — non-routable fulfilment integrity core.

NON-RELEASE-READY. Nothing in this module is reachable through HTTP: the legacy
``/sales-orders/{id}/scan-*`` / ``undo-*`` routes still call the unkeyed
services in ``sales_order_service``. A later, separately approved integration
gate connects these services to the API together with a compatible frontend.
Until then this is not active duplicate-scan protection.

What it provides (service level, exercised by internal tests):

* ``acquire_fulfillment_claim`` — one active authorized claim per order/phase.
  The server issues an unpredictable token; only its SHA-256 is stored. A
  takeover increments the fencing epoch, invalidates the older claim and opens
  a REQUIRED reconciliation. Cross-user takeover is admin-only with a reason.
* ``submit_fulfillment_attempt`` — a keyed SCAN_PICK / SCAN_PACK / UNDO_PICK /
  UNDO_PACK attempt, applied at most once per (sales order, Idempotency-Key):

    1. authorize (warehouse/admin, active) and validate key + payload;
    2. lock the sales-order row;
    3. existing receipt -> exact replay to its original actor, or a conflict;
    4. verify the claim (token, epoch, holder, phase, order state);
    5. inside a SAVEPOINT: the reconciliation gate, then the shared legacy
       business core (``apply_fulfillment_scan`` / ``apply_fulfillment_undo``);
    6. success: APPLIED receipt + the core's audit row + counter, one commit;
       an allowlisted terminal business rejection: roll back the savepoint,
       commit a REJECTED receipt, and raise the held error only after commit;
       anything else (data-integrity errors, unexpected exceptions, receipt
       write failures): the whole transaction rolls back, no receipt.

R5-SAFE.2 adds non-routable lifecycle and audited release operations.
Target-bounded corrections remain deferred to R5-SAFE.4, so
CORRECTION_IN_PROGRESS fails closed like REQUIRED and ESCALATED.
"""
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.core.exceptions import AppException
from app.core.fulfillment_claim import claim_token_matches, generate_claim_token, hash_claim_token
from app.core.quantity import encode_quantities, quantity_text
from app.core.unit_of_work import UnitOfWork
from app.models import AuditLog, FulfillmentAttemptReceipt, FulfillmentReconciliation
from app.schemas.sales_order_schema import FulfillmentScan, FulfillmentUndo
from app.services.sales_order_service import (
    IDEMPOTENCY_CONFLICT,
    _get_required_sales_order_for_update,
    _result,
    apply_fulfillment_scan,
    apply_fulfillment_undo,
    apply_fulfillment_transition,
    _allocations,
)

PHASE_STATUS = {"PICK": "PICKING", "PACK": "PACKING"}
FULFILLMENT_ROLES = frozenset({"warehouse", "admin"})
KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")  # same rule as the Sales Return Idempotency-Key


@dataclass(frozen=True)
class FulfillmentOperation:
    kind: str  # "scan" | "undo"
    packing: bool
    phase: str
    payload_type: type


OPERATIONS = {
    "SCAN_PICK": FulfillmentOperation("scan", False, "PICK", FulfillmentScan),
    "SCAN_PACK": FulfillmentOperation("scan", True, "PACK", FulfillmentScan),
    "UNDO_PICK": FulfillmentOperation("undo", False, "PICK", FulfillmentUndo),
    "UNDO_PACK": FulfillmentOperation("undo", True, "PACK", FulfillmentUndo),
}

# Definitive operator-facing business rejections of an ACCEPTED attempt, verified
# against apply_fulfillment_scan / apply_fulfillment_undo (all raised before any
# write). Exact values only — no substring matching.
TERMINAL_REJECTION_CODES = frozenset({
    "BARCODE_NOT_FOUND",
    "PRODUCT_NOT_IN_ORDER",
    "ALLOCATION_NOT_IN_ORDER",
    "SCANNED_PRODUCT_MISMATCHES_LINE",
    "ALLOCATION_IDENTIFICATION_REQUIRED",
    "ALLOCATION_SCAN_EXCEEDS_REMAINING",
    "UNDO_BELOW_ZERO",
    "UNDO_BELOW_PACKED",
    "FULFILLMENT_RECONCILIATION_UNRESOLVED",
})
_STATE_CONFLICT = re.compile(r"Sales Order state conflict: [A-Z_]+; requires (PICKING|PACKING)")
# Deliberately NOT terminal (rolled back with no receipt, so a repaired order can
# still apply the same key): "Order has no items", "Invalid allocation
# ownership/source: …", "Invalid allocation membership", "Invalid allocation
# tracking identity: …", "Invalid pinned allocation source: …", "Invalid
# allocated batch: …" (data integrity), and "ALLOCATION_NOT_FULFILLABLE" (a
# legacy allocation without fulfilment counters).

RECONCILIATION_UNRESOLVED = "FULFILLMENT_RECONCILIATION_UNRESOLVED"
PERMISSION_DENIED = "Warehouse permission required"


class FulfillmentAttemptRejected(AppException):
    """A terminal business rejection of a keyed attempt (first time or replayed).

    ``attempt`` carries the receipt identity; it never contains claim credentials.
    Subclasses AppException so the existing handler renders the usual envelope.
    """

    def __init__(self, message: str, status_code: int, attempt: dict):
        super().__init__(message=message, status_code=status_code)
        self.attempt = attempt


class FulfillmentClaimHeld(AppException):
    """Another active claim exists and no takeover was requested. Never carries a token."""

    def __init__(self, holder_user_id: int, acquired_at: datetime | None, held_by_you: bool):
        super().__init__(message="FULFILLMENT_CLAIM_HELD", status_code=409)
        self.holder_user_id = holder_user_id
        self.acquired_at = acquired_at
        self.held_by_you = held_by_you


def is_terminal_rejection(exc: BaseException) -> bool:
    """Exact-class, exact-value test. Subclasses (e.g. stock exceptions) never qualify."""
    if type(exc) is not AppException:
        return False
    if exc.message in TERMINAL_REJECTION_CODES:
        expected = 404 if exc.message in {"BARCODE_NOT_FOUND", "ALLOCATION_NOT_IN_ORDER"} else 409
        return exc.status_code == expected
    return exc.status_code == 409 and _STATE_CONFLICT.fullmatch(exc.message or "") is not None


def _role(user) -> str:
    return str(getattr(user, "role", "") or "").strip().lower()


def _require_fulfillment_role(user) -> None:
    if user is None or getattr(user, "id", None) is None or getattr(user, "is_active", True) is False:
        raise AppException(PERMISSION_DENIED, 403)
    if _role(user) not in FULFILLMENT_ROLES:
        raise AppException(PERMISSION_DENIED, 403)


def _valid_epoch(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def attempt_fingerprint(sales_order_id: int, operation_type: str, claim_epoch: int, data) -> str:
    """Canonical attempt identity. Actor and claim token are authorization metadata, not identity."""
    op = OPERATIONS[operation_type]
    allocation_id = getattr(data, "allocation_id", None)
    payload = {
        "version": 1,
        "sales_order_id": sales_order_id,
        "operation_type": operation_type,
        "phase": op.phase,
        "claim_epoch": claim_epoch,
        "barcode": data.barcode if op.kind == "scan" else None,
        "allocation_specified": allocation_id is not None,
        "allocation_id": allocation_id,
        "quantity": quantity_text(data.quantity),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def verify_fulfillment_claim(order, current_user, claim_token: str | None, claim_epoch: int, phase: str) -> None:
    """Must be called with the sales-order row lock held. Raises on any mismatch."""
    if order.fulfillment_claim_token_hash is None:
        raise AppException("FULFILLMENT_CLAIM_REQUIRED", 409)
    # Evaluate every credential check before deciding, so the outcome does not
    # reveal which one failed.
    token_ok = claim_token_matches(claim_token, order.fulfillment_claim_token_hash)
    epoch_ok = order.fulfillment_claim_epoch == claim_epoch
    holder_ok = order.fulfillment_claim_user_id == current_user.id
    if not (token_ok and epoch_ok and holder_ok):
        raise AppException("FULFILLMENT_CLAIM_INVALID", 409)
    if order.fulfillment_claim_phase != phase or order.status != PHASE_STATUS[phase]:
        raise AppException("FULFILLMENT_CLAIM_PHASE_MISMATCH", 409)


def _audit_claim(db, order, user, action: str, detail: str) -> None:
    db.add(AuditLog(username=user.username, action=action, table_name="sales_orders", record_id=order.id,
                    description=f"{order.so_number}: {detail}"[:500]))


def _check_epoch(order, expected_epoch):
    if not _valid_epoch(expected_epoch):
        raise AppException("Invalid claim epoch", 422)
    if order.fulfillment_claim_epoch != expected_epoch:
        raise AppException("FULFILLMENT_EPOCH_CONFLICT", 409)
    if expected_epoch >= 2147483647:
        raise AppException("FULFILLMENT_EPOCH_EXHAUSTED", 409)


def _reason(value, error="FULFILLMENT_REASON_REQUIRED"):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 200:
        raise AppException(error, 422)
    return value.strip()


def _phase(phase):
    if phase not in PHASE_STATUS:
        raise AppException("Invalid fulfillment phase", 422)


def _ordinary_transition_allowed(record):
    if record is not None and record.status != "REQUIRED":
        raise AppException("FULFILLMENT_RECONCILIATION_TRANSITION_BLOCKED", 409)


def _open_reconciliation(db, repo, order, user, phase, reason_code, reason, previous, supervisor=None):
    """Preserve evidence and link both sides of an atomic REQUIRED supersession."""
    now = datetime.now(timezone.utc)
    if previous is not None:
        _ordinary_transition_allowed(previous)
        previous.status = "SUPERSEDED"
        previous.resolved_at = now
        previous.resolved_by_user_id = user.id
        db.flush()  # release the partial-unique-index slot
    record = repo.create_reconciliation(FulfillmentReconciliation(
        sales_order_id=order.id, phase=phase, opened_epoch=order.fulfillment_claim_epoch,
        reason_code=reason_code, status="REQUIRED", opened_by_user_id=user.id,
        supervisor_user_id=supervisor, notes=reason))
    if previous is not None:
        # Existing notes, physical counts, targets and resolution evidence are retained.
        link = f"Superseded by reconciliation #{record.id} at epoch {order.fulfillment_claim_epoch}"
        previous.resolution_notes = (previous.resolution_notes + "\n" if previous.resolution_notes else "") + link
        record.notes += f"\nPredecessor reconciliation #{previous.id}"
        _audit_claim(db, order, user, "FULFILLMENT_RECONCILIATION_SUPERSEDED",
                     f"reconciliation #{previous.id} -> #{record.id}; epoch {order.fulfillment_claim_epoch}")
    return record


def acquire_fulfillment_claim(db, sales_order_repo, *, sales_order_id: int, current_user, phase: str,
                              expected_epoch: int, takeover: bool = False, reason: str | None = None) -> dict:
    """One-time token delivery. Lost responses require explicit takeover, never replay."""
    _require_fulfillment_role(current_user)
    _phase(phase)
    if type(takeover) is not bool:
        raise AppException("Explicit takeover confirmation required", 422)
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        _check_epoch(order, expected_epoch)
        if order.status != PHASE_STATUS[phase]:
            raise AppException("FULFILLMENT_PHASE_MISMATCH", 409)
        unresolved = sales_order_repo.get_unresolved_reconciliation(order.id)
        _ordinary_transition_allowed(unresolved)
        active = order.fulfillment_claim_token_hash is not None
        previous = None
        if active:
            same_user = order.fulfillment_claim_user_id == current_user.id
            if not takeover:
                raise FulfillmentClaimHeld(order.fulfillment_claim_user_id, order.fulfillment_claim_acquired_at,
                                           held_by_you=same_user)
            if not same_user and _role(current_user) != "admin":
                raise AppException("FULFILLMENT_TAKEOVER_FORBIDDEN", 403)
            reason = _reason(reason, "FULFILLMENT_TAKEOVER_REASON_REQUIRED")
            previous = (order.fulfillment_claim_user_id, order.fulfillment_claim_epoch, same_user)
        elif takeover:
            raise AppException("FULFILLMENT_CLAIM_REQUIRED", 409)
        now = datetime.now(timezone.utc)
        token = generate_claim_token()
        order.fulfillment_claim_epoch += 1
        order.fulfillment_claim_token_hash = hash_claim_token(token)
        order.fulfillment_claim_user_id = current_user.id
        order.fulfillment_claim_phase = phase
        order.fulfillment_claim_acquired_at = now
        epoch = order.fulfillment_claim_epoch
        if previous is None:
            _audit_claim(db, order, current_user, "FULFILLMENT_CLAIM_ACQUIRED", f"{phase} claim acquired at epoch {epoch}")
        else:
            previous_user_id, previous_epoch, same_user = previous
            _open_reconciliation(db, sales_order_repo, order, current_user, phase,
                                 "SELF_TAKEOVER" if same_user else "TAKEOVER", reason, unresolved,
                                 None if same_user else current_user.id)
            # The complete reason lives in reconciliation.notes, never truncated.
            _audit_claim(db, order, current_user, "FULFILLMENT_CLAIM_TAKEOVER",
                         f"{phase} epoch {previous_epoch} -> {epoch}; previous holder #{previous_user_id}; reconciliation required")
        result = {"claim_token": token, "claim_epoch": epoch, "phase": phase, "sales_order_id": order.id,
                  "holder_user_id": current_user.id, "acquired_at": now,
                  "reconciliation_required": sales_order_repo.get_unresolved_reconciliation(order.id) is not None}
    return result


def _status(order, repo):
    record = repo.get_unresolved_reconciliation(order.id)
    return {"sales_order_id": order.id, "claim_epoch": order.fulfillment_claim_epoch,
            "phase": order.fulfillment_claim_phase, "holder_user_id": order.fulfillment_claim_user_id,
            "acquired_at": order.fulfillment_claim_acquired_at,
            "reconciliation_required": record is not None,
            "reconciliation_status": record.status if record else None}


def fulfillment_claim_status(db, repo, *, sales_order_id, current_user):
    _require_fulfillment_role(current_user)
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(repo, sales_order_id)
        result = _status(order, repo)
    return result


def validate_fulfillment_claim(db, repo, *, sales_order_id, current_user, phase, claim_token, expected_epoch):
    _require_fulfillment_role(current_user)
    _phase(phase)
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(repo, sales_order_id)
        if not _valid_epoch(expected_epoch):
            raise AppException("Invalid claim epoch", 422)
        verify_fulfillment_claim(order, current_user, claim_token, expected_epoch, phase)
        result = _status(order, repo)
    return result


def _fence(order):
    order.fulfillment_claim_epoch += 1
    order.fulfillment_claim_token_hash = None
    order.fulfillment_claim_user_id = None
    order.fulfillment_claim_phase = None
    order.fulfillment_claim_acquired_at = None


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _release_evidence(db, order, user, action, evidence):
    text = _canonical(evidence)
    if len(text) > 500:
        raise AppException("FULFILLMENT_RELEASE_EVIDENCE_TOO_LARGE", 409)
    db.add(AuditLog(username=user.username, action=action, table_name="sales_orders",
                    record_id=order.id, description=text))


def _count(value):
    # Accept exact decimal text/Decimal only, never a binary floating-point approximation.
    if not isinstance(value, (str, Decimal)):
        raise AppException("Invalid physical quantity", 422)
    try:
        number = Decimal(value)
        if not number.is_finite() or number < 0 or number >= Decimal("1000000000000000"):
            raise ValueError()
        quantity_text(number)
    except (ValueError, ArithmeticError):
        raise AppException("Invalid physical quantity", 422) from None
    return number


def release_fulfillment_claim(db, repo, *, sales_order_id, current_user, phase, claim_token,
                              expected_epoch, mode, allocations=None, physical_count_attested=False, reason=None):
    """Physical attestation is an operator assertion, not automated per-item verification.

    VERIFIED v1 audit contract: each JSON line repeats correlation/actor/order/phase/
    old-new epochs and allocation identity. Summary SHA256 covers the complete ordered
    line array encoded with _canonical (ASCII, sorted keys, compact separators).
    Missing, duplicate or altered lines invalidate the count/digest. No truncation.
    """
    _require_fulfillment_role(current_user)
    _phase(phase)
    if mode not in {"VERIFIED", "UNVERIFIED"}:
        raise AppException("Invalid release mode", 422)
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(repo, sales_order_id)
        _check_epoch(order, expected_epoch)
        verify_fulfillment_claim(order, current_user, claim_token, expected_epoch, phase)
        unresolved = repo.get_unresolved_reconciliation(order.id)
        _ordinary_transition_allowed(unresolved)
        if mode == "VERIFIED":
            if unresolved is not None:
                raise AppException(RECONCILIATION_UNRESOLVED, 409)
            if physical_count_attested is not True or not isinstance(allocations, list):
                raise AppException("Physical count attestation required", 422)
            rows = sorted(_allocations(repo, order, repo.get_order_items(order.id)), key=lambda a: a.id)
            supplied = {}
            for line in allocations:
                if not isinstance(line, dict) or set(line) != {"allocation_id", "picked_quantity", "packed_quantity"}:
                    raise AppException("Invalid physical count fields", 422)
                identity = line["allocation_id"]
                if type(identity) is not int or identity in supplied:
                    raise AppException("Invalid or duplicate physical allocation", 422)
                supplied[identity] = (_count(line["picked_quantity"]), _count(line["packed_quantity"]))
            if set(supplied) != {a.id for a in rows}:
                raise AppException("Physical allocation membership must exactly match this order", 409)
            correlation = uuid4().hex
            common = {"v": 1, "release": correlation, "actor": current_user.id, "order": order.id,
                      "phase": phase, "old_epoch": expected_epoch, "new_epoch": expected_epoch + 1}
            evidence = []
            for a in rows:
                if (a.picked_quantity is None or a.packed_quantity is None or
                        not Decimal(0) <= a.packed_quantity <= a.picked_quantity <= a.quantity or
                        (phase == "PICK" and a.packed_quantity != 0)):
                    raise AppException("Invalid fulfillment counters", 409)
                picked, packed = supplied[a.id]
                if (picked, packed) != (a.picked_quantity, a.packed_quantity):
                    raise AppException("Physical count does not match authoritative counters", 409)
                evidence.append({**common, "allocation": a.id, "allocated": quantity_text(a.quantity),
                                 "picked": quantity_text(picked), "packed": quantity_text(packed),
                                 "attested": True})
            for line in evidence:
                _release_evidence(db, order, current_user, "FULFILLMENT_RELEASE_LINE", line)
            digest = hashlib.sha256(_canonical(evidence).encode("utf-8")).hexdigest()
            _release_evidence(db, order, current_user, "FULFILLMENT_RELEASE_VERIFIED",
                              {**common, "lines": len(evidence), "sha256": digest, "mode": mode})
            _fence(order)
            result = {"sales_order_id": order.id, "claim_epoch": order.fulfillment_claim_epoch,
                      "mode": mode, "release_id": correlation, "evidence_sha256": digest,
                      "reconciliation_required": False}
        else:
            reason = _reason(reason)
            if allocations is not None or physical_count_attested is not False:
                raise AppException("Unverified release cannot attest counts", 422)
            _fence(order)
            record = _open_reconciliation(db, repo, order, current_user, phase, "RELEASE_UNVERIFIED",
                                          reason, unresolved)
            _audit_claim(db, order, current_user, "FULFILLMENT_RELEASE_UNVERIFIED",
                         f"{phase} epoch {expected_epoch} -> {order.fulfillment_claim_epoch}; reconciliation #{record.id}")
            result = {"sales_order_id": order.id, "claim_epoch": order.fulfillment_claim_epoch,
                      "mode": mode, "reconciliation_required": True, "reconciliation_id": record.id}
    return result


def complete_claimed_fulfillment(db, repo, balance_repo, *, sales_order_id, current_user, phase,
                                 claim_token, expected_epoch, data):
    _require_fulfillment_role(current_user)
    _phase(phase)
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(repo, sales_order_id)
        _check_epoch(order, expected_epoch)
        verify_fulfillment_claim(order, current_user, claim_token, expected_epoch, phase)
        if repo.get_unresolved_reconciliation(order.id) is not None:
            raise AppException(RECONCILIATION_UNRESOLVED, 409)
        result = apply_fulfillment_transition(db, repo, balance_repo, order, current_user,
                                             "complete-picking" if phase == "PICK" else "complete-packing", data)
        _fence(order)
        _audit_claim(db, order, current_user, "FULFILLMENT_CLAIM_COMPLETED",
                     f"{phase} epoch {expected_epoch} -> {order.fulfillment_claim_epoch}")
    return result


def _attempt_view(receipt: FulfillmentAttemptReceipt, replayed: bool) -> dict:
    return {
        "operation_key": receipt.operation_key,
        "operation_type": receipt.operation_type,
        "outcome": receipt.outcome,
        "claim_epoch": receipt.claim_epoch,
        "replayed": replayed,
        # A replay is a historical outcome, not current allocation progress.
        "historical": replayed,
        "recorded_at": receipt.created_at.isoformat() if receipt.created_at else None,
    }


def submit_fulfillment_attempt(db, sales_order_repo, balance_repo, *, sales_order_id: int, operation_type: str,
                               data, operation_key: str, claim_token: str | None, claim_epoch: int,
                               current_user) -> dict:
    """Apply one keyed scan/undo attempt at most once. Returns ``{"data": ..., "attempt": ...}``.

    Raises FulfillmentAttemptRejected for a terminal business rejection (recorded,
    committed) or its replay; AppException for pre-acceptance failures (nothing
    recorded); anything else rolls back.
    """
    _require_fulfillment_role(current_user)
    op = OPERATIONS.get(operation_type)
    if op is None:
        raise AppException("Invalid fulfillment operation", 422)
    if not isinstance(operation_key, str) or not KEY_PATTERN.fullmatch(operation_key):
        raise AppException("Invalid Idempotency-Key", 422)
    if not _valid_epoch(claim_epoch):
        raise AppException("Invalid claim epoch", 422)
    if not isinstance(data, op.payload_type):
        raise AppException("Invalid fulfillment payload", 422)
    try:
        fingerprint = attempt_fingerprint(sales_order_id, operation_type, claim_epoch, data)
    except ValueError:
        raise AppException("Invalid fulfillment payload", 422) from None

    held: FulfillmentAttemptRejected | None = None
    result: dict | None = None
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        existing = sales_order_repo.get_fulfillment_receipt(order.id, operation_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise AppException(IDEMPOTENCY_CONFLICT, 409)
            if existing.created_by_user_id != current_user.id:
                raise AppException("FULFILLMENT_ATTEMPT_FORBIDDEN", 403)
            if existing.outcome == "REJECTED":
                raise FulfillmentAttemptRejected(existing.error_code, existing.http_status,
                                                 _attempt_view(existing, replayed=True))
            result = {"data": existing.response_snapshot, "attempt": _attempt_view(existing, replayed=True)}
        else:
            verify_fulfillment_claim(order, current_user, claim_token, claim_epoch, op.phase)
            unresolved = sales_order_repo.get_unresolved_reconciliation(order.id)
            core = apply_fulfillment_scan if op.kind == "scan" else apply_fulfillment_undo
            savepoint = db.begin_nested()
            try:
                if unresolved is not None:
                    # Fail closed: corrections (CORRECTION_IN_PROGRESS) arrive in R5-SAFE.4.
                    raise AppException(RECONCILIATION_UNRESOLVED, 409)
                allocation = core(db, sales_order_repo, balance_repo, order, current_user, data, op.packing)
                savepoint.commit()
            except AppException as exc:
                savepoint.rollback()
                if not is_terminal_rejection(exc):
                    raise
                receipt = sales_order_repo.create_fulfillment_receipt(FulfillmentAttemptReceipt(
                    sales_order_id=order.id, operation_key=operation_key, operation_type=operation_type,
                    claim_epoch=claim_epoch, request_fingerprint=fingerprint, outcome="REJECTED",
                    error_code=exc.message, http_status=exc.status_code, allocation_id=None,
                    response_snapshot={"message": exc.message, "status_code": exc.status_code},
                    created_by_user_id=current_user.id,
                    reconciliation_id=unresolved.id if unresolved is not None else None))
                held = FulfillmentAttemptRejected(exc.message, exc.status_code, _attempt_view(receipt, replayed=False))
            else:
                snapshot = encode_quantities({
                    **_result(order), "allocation_id": allocation.id, "quantity": allocation.quantity,
                    "picked_quantity": allocation.picked_quantity, "packed_quantity": allocation.packed_quantity})
                receipt = sales_order_repo.create_fulfillment_receipt(FulfillmentAttemptReceipt(
                    sales_order_id=order.id, operation_key=operation_key, operation_type=operation_type,
                    claim_epoch=claim_epoch, request_fingerprint=fingerprint, outcome="APPLIED",
                    allocation_id=allocation.id, response_snapshot=snapshot, created_by_user_id=current_user.id))
                result = {"data": snapshot, "attempt": _attempt_view(receipt, replayed=False)}
    if held is not None:
        raise held  # only after the REJECTED receipt has committed
    return result
