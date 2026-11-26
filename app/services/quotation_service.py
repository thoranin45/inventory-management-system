"""F1a: quotations (QT-2026-0001) and conversion to a sales order.

State machine (every transition locks the quotation row and writes an audit row):

    DRAFT --issue--> ISSUED --accept--> ACCEPTED --convert--> CONVERTED
      |                |  \\--reject--> REJECTED
      delete           \\----void------> VOID   <--void-- ACCEPTED

- Only a DRAFT is edited or deleted. Issuing allocates the gapless number in
  the same transaction, recomputes the totals and stores a snapshot of the
  seller (company profile) and the customer; nothing on an issued quotation
  changes afterwards.
- "Expired" is not stored: an ISSUED quotation whose valid_until is before
  batch_eligibility.business_today() is reported as expired and can no longer be accepted.
- Revise copies an ISSUED, ACCEPTED or REJECTED quotation into a new DRAFT
  (revision_of_id). An ISSUED or ACCEPTED original is voided ("Revised").
- Convert is idempotent: it creates exactly one sales order (DRAFT) per
  quotation; a repeated or concurrent call returns the same order.
"""
from datetime import timedelta
from decimal import Decimal

from fastapi import status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.document_numbers import allocate_number
from app.core.exceptions import AppException
from app.core.money import Line, document_totals, line_amount
from app.core.pagination import ListParams, paginate, paginated_body, phase8_json, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    CompanyProfile,
    Customer,
    Product,
    Quotation,
    QuotationItem,
    SalesOrder,
    SalesOrderItem,
    User,
)
from app.schemas.quotation_schema import QuotationDraftInput

DOC_TYPE = "QT"
DEFAULT_VALID_DAYS = 30
# sales_orders / sales_order_items store money as Numeric(10, 2)
SALES_ORDER_MAX = Decimal("99999999.99")
_PROFILE_ID = 1

_SNAPSHOT_SELLER_FIELDS = (
    "legal_name_th", "legal_name_en", "tax_id", "branch_code",
    "address_th", "address_en", "phone", "email",
)


def _error(message: str, code: int = status.HTTP_409_CONFLICT):
    raise AppException(message=message, status_code=code)


def _audit(db: Session, quotation: Quotation, user: User, action: str, detail: str = "") -> None:
    label = quotation.quotation_number or f"draft #{quotation.id}"
    db.add(AuditLog(
        username=user.username,
        action=action,
        table_name="quotations",
        record_id=quotation.id,
        description=f"{label}: {quotation.status}. {detail}".strip(),
    ))


def _locked(db: Session, quotation_id: int) -> Quotation:
    quotation = db.execute(
        select(Quotation).where(Quotation.id == quotation_id).with_for_update()
    ).scalar_one_or_none()
    if quotation is None:
        _error("Quotation not found", status.HTTP_404_NOT_FOUND)
    return quotation


def _require(quotation: Quotation, *states: str) -> None:
    if quotation.status not in states:
        _error(f"Quotation is {quotation.status}; this action needs {' or '.join(states)}")


def _vat_settings(db: Session) -> dict:
    profile = db.get(CompanyProfile, _PROFILE_ID)
    if profile is None:  # defaults until the profile is first saved: VAT off
        return {"vat_registered": False, "vat_rate": Decimal("7.00"), "prices_include_vat": False}
    return {
        "vat_registered": profile.vat_registered,
        "vat_rate": profile.vat_rate,
        "prices_include_vat": profile.prices_include_vat,
    }


def _apply_totals(db: Session, quotation: Quotation) -> None:
    totals = document_totals(
        (Line(item.quantity, item.unit_price) for item in quotation.items),
        **_vat_settings(db),
    )
    if totals.grand_total > SALES_ORDER_MAX:
        _error("Quotation total is larger than a sales order can hold (99,999,999.99)",
               status.HTTP_422_UNPROCESSABLE_CONTENT)
    quotation.subtotal = totals.subtotal
    quotation.vat_base = totals.vat_base
    quotation.vat_amount = totals.vat_amount
    quotation.grand_total = totals.grand_total


def _replace_lines(db: Session, quotation: Quotation, data: QuotationDraftInput) -> None:
    if db.get(Customer, data.customer_id) is None:
        _error("Customer not found", status.HTTP_404_NOT_FOUND)
    quotation.customer_id = data.customer_id
    quotation.valid_until = data.valid_until
    quotation.notes = (data.notes or "").strip() or None

    quotation.items.clear()
    db.flush()  # delete old lines before re-inserting (unique line_no / product)
    for number, line in enumerate(data.items, start=1):
        product = db.get(Product, line.product_id)
        if product is None or not product.is_active:
            _error(f"Product not found: {line.product_id}", status.HTTP_404_NOT_FOUND)
        total = line_amount(line.quantity, line.unit_price)
        if total > SALES_ORDER_MAX:
            _error(f"Line {number} is larger than a sales order line can hold (99,999,999.99)",
                   status.HTTP_422_UNPROCESSABLE_CONTENT)
        description = (line.description or "").strip() or _product_label(product)
        quotation.items.append(QuotationItem(
            line_no=number,
            product_id=product.id,
            description=description[:300],
            quantity=line.quantity,
            unit_price=line.unit_price,
            line_total=total,
        ))
    _apply_totals(db, quotation)


def _product_label(product: Product) -> str:
    name = product.product_name or f"Product {product.id}"
    return f"{product.sku} {name}" if product.sku else name


# ---------------------------------------------------------------- read


def _is_expired(quotation: Quotation, today) -> bool:
    return (quotation.status == "ISSUED" and quotation.valid_until is not None
            and quotation.valid_until < today)


def _summary(quotation: Quotation, customer_name: str | None, today) -> dict:
    snapshot = quotation.customer_snapshot or {}
    return {
        "id": quotation.id,
        "quotation_number": quotation.quotation_number,
        "status": quotation.status,
        "is_expired": _is_expired(quotation, today),
        "customer_id": quotation.customer_id,
        "customer_name": snapshot.get("name") or customer_name,
        "issue_date": quotation.issue_date,
        "valid_until": quotation.valid_until,
        "grand_total": quotation.grand_total,
        "sales_order_id": quotation.sales_order_id,
        "created_at": quotation.created_at,
        "updated_at": quotation.updated_at,
    }


def detail(db: Session, quotation: Quotation) -> dict:
    customer = db.get(Customer, quotation.customer_id)
    so_number = None
    if quotation.sales_order_id:
        so_number = db.execute(
            select(SalesOrder.so_number).where(SalesOrder.id == quotation.sales_order_id)
        ).scalar_one_or_none()
    revised_by = db.execute(
        select(Quotation.id).where(Quotation.revision_of_id == quotation.id).order_by(Quotation.id.desc())
    ).scalars().first()
    today = batch_eligibility.business_today()
    return phase8_json({
        **_summary(quotation, customer.customer_name if customer else None, today),
        "notes": quotation.notes,
        "customer_snapshot": quotation.customer_snapshot,
        "seller_snapshot": quotation.seller_snapshot,
        "subtotal": quotation.subtotal,
        "vat_base": quotation.vat_base,
        "vat_amount": quotation.vat_amount,
        "sales_order_number": so_number,
        "revision_of_id": quotation.revision_of_id,
        "revised_by_id": revised_by,
        "void_reason": quotation.void_reason,
        "issued_at": quotation.issued_at,
        "decided_at": quotation.decided_at,
        "voided_at": quotation.voided_at,
        "converted_at": quotation.converted_at,
        "items": [
            {
                "id": item.id,
                "line_no": item.line_no,
                "product_id": item.product_id,
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "line_total": item.line_total,
            }
            for item in quotation.items
        ],
    })


def get_quotation_service(db: Session, quotation_id: int) -> dict:
    quotation = db.get(Quotation, quotation_id)
    if quotation is None:
        _error("Quotation not found", status.HTTP_404_NOT_FOUND)
    return detail(db, quotation)


def list_quotations_service(db: Session, params: ListParams, customer_id: int | None = None) -> dict:
    query = db.query(Quotation)
    today = batch_eligibility.business_today()
    if params.status:
        wanted = params.status.upper()
        if wanted == "EXPIRED":
            query = query.filter(Quotation.status == "ISSUED", Quotation.valid_until < today)
        else:
            query = query.filter(Quotation.status == wanted)
    if customer_id:
        query = query.filter(Quotation.customer_id == customer_id)
    if params.search:
        pattern = f"%{params.search}%"
        matching_customers = select(Customer.id).where(Customer.customer_name.ilike(pattern))
        query = query.filter(or_(
            Quotation.quotation_number.ilike(pattern),
            Quotation.customer_id.in_(matching_customers),
        ))
    ordering = resolve_ordering(params, {
        "id": Quotation.id,
        "created_at": Quotation.created_at,
        "issue_date": Quotation.issue_date,
        "quotation_number": Quotation.quotation_number,
        "grand_total": Quotation.grand_total,
        "status": Quotation.status,
    }, "created_at", Quotation.id)
    items, total = paginate(query, params, ordering)
    ids = {q.customer_id for q in items}
    names = dict(db.execute(
        select(Customer.id, Customer.customer_name).where(Customer.id.in_(ids))
    ).all()) if ids else {}
    rows = [_summary(q, names.get(q.customer_id), today) for q in items]
    return paginated_body(rows, total, params, "Quotations retrieved")


# ---------------------------------------------------------------- drafts


def create_quotation_service(db: Session, data: QuotationDraftInput, user: User) -> dict:
    with UnitOfWork(db):
        quotation = Quotation(status="DRAFT", created_by_user_id=user.id, customer_id=data.customer_id)
        db.add(quotation)
        _replace_lines(db, quotation, data)
        db.flush()
        _audit(db, quotation, user, "CREATE_QUOTATION")
    db.refresh(quotation)
    return detail(db, quotation)


def update_quotation_service(db: Session, quotation_id: int, data: QuotationDraftInput, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "DRAFT")
        _replace_lines(db, quotation, data)
        quotation.updated_at = func.now()
        _audit(db, quotation, user, "UPDATE_QUOTATION")
    db.refresh(quotation)
    return detail(db, quotation)


def delete_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "DRAFT")
        _audit(db, quotation, user, "DELETE_QUOTATION", "Draft deleted")
        db.delete(quotation)
    return {"id": quotation_id, "deleted": True}


# ---------------------------------------------------------------- transitions


def _seller_snapshot(db: Session) -> dict:
    profile = db.get(CompanyProfile, _PROFILE_ID)
    snapshot = {name: getattr(profile, name, None) if profile else None for name in _SNAPSHOT_SELLER_FIELDS}
    vat = _vat_settings(db)
    snapshot.update(vat_registered=vat["vat_registered"], vat_rate=format(vat["vat_rate"], "f"),
                    prices_include_vat=vat["prices_include_vat"])
    return snapshot


def _customer_snapshot(customer: Customer) -> dict:
    return {
        "name": customer.customer_name,
        "tax_id": customer.tax_id,
        "branch_code": customer.branch_code,
        "address": customer.billing_address or customer.address,
        "phone": customer.phone,
        "email": customer.email,
    }


def issue_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "DRAFT")
        if not quotation.items:
            _error("A quotation needs at least one line before it is issued")
        for item in quotation.items:
            product = db.get(Product, item.product_id)
            if product is None or not product.is_active:
                _error(f"Line {item.line_no}: product is no longer active")
        today = batch_eligibility.business_today()
        valid_until = quotation.valid_until or today + timedelta(days=DEFAULT_VALID_DAYS)
        if valid_until < today:
            _error("Valid-until date is before the issue date", status.HTTP_422_UNPROCESSABLE_CONTENT)
        _apply_totals(db, quotation)  # current VAT settings, frozen from here on
        quotation.quotation_number = allocate_number(db, DOC_TYPE, today)
        quotation.status = "ISSUED"
        quotation.issue_date = today
        quotation.valid_until = valid_until
        quotation.seller_snapshot = _seller_snapshot(db)
        quotation.customer_snapshot = _customer_snapshot(db.get(Customer, quotation.customer_id))
        quotation.issued_at = func.now()
        quotation.issued_by_user_id = user.id
        quotation.updated_at = func.now()
        _audit(db, quotation, user, "ISSUE_QUOTATION", f"Total {quotation.grand_total}")
    db.refresh(quotation)
    return detail(db, quotation)


def accept_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "ISSUED")
        if _is_expired(quotation, batch_eligibility.business_today()):
            _error("Quotation has expired; revise it to send a new one")
        _decide(quotation, "ACCEPTED", user)
        _audit(db, quotation, user, "ACCEPT_QUOTATION")
    db.refresh(quotation)
    return detail(db, quotation)


def reject_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "ISSUED")
        _decide(quotation, "REJECTED", user)
        _audit(db, quotation, user, "REJECT_QUOTATION")
    db.refresh(quotation)
    return detail(db, quotation)


def _decide(quotation: Quotation, new_status: str, user: User) -> None:
    quotation.status = new_status
    quotation.decided_at = func.now()
    quotation.decided_by_user_id = user.id
    quotation.updated_at = func.now()


def _void(quotation: Quotation, reason: str, user: User) -> None:
    quotation.status = "VOID"
    quotation.void_reason = reason
    quotation.voided_at = func.now()
    quotation.voided_by_user_id = user.id
    quotation.updated_at = func.now()


def void_quotation_service(db: Session, quotation_id: int, reason: str, user: User) -> dict:
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        _require(quotation, "ISSUED", "ACCEPTED")
        _void(quotation, reason, user)
        _audit(db, quotation, user, "VOID_QUOTATION", f"Reason: {reason}")
    db.refresh(quotation)
    return detail(db, quotation)


def revise_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    with UnitOfWork(db):
        original = _locked(db, quotation_id)
        _require(original, "ISSUED", "ACCEPTED", "REJECTED")
        draft = Quotation(
            status="DRAFT",
            customer_id=original.customer_id,
            notes=original.notes,
            revision_of_id=original.id,
            created_by_user_id=user.id,
        )
        db.add(draft)
        for item in original.items:
            draft.items.append(QuotationItem(
                line_no=item.line_no, product_id=item.product_id, description=item.description,
                quantity=item.quantity, unit_price=item.unit_price, line_total=item.line_total,
            ))
        _apply_totals(db, draft)
        db.flush()
        if original.status in {"ISSUED", "ACCEPTED"}:
            _void(original, f"Revised as draft #{draft.id}", user)
            _audit(db, original, user, "VOID_QUOTATION", f"Revised as draft #{draft.id}")
        _audit(db, draft, user, "REVISE_QUOTATION", f"Revision of {original.quotation_number}")
    db.refresh(draft)
    return detail(db, draft)


def convert_quotation_service(db: Session, quotation_id: int, user: User) -> dict:
    """ACCEPTED -> CONVERTED with one new sales order (DRAFT). Idempotent."""
    with UnitOfWork(db):
        quotation = _locked(db, quotation_id)
        if quotation.status == "CONVERTED":
            created = False
        else:
            _require(quotation, "ACCEPTED")
            for item in quotation.items:
                product = db.get(Product, item.product_id)
                if product is None or not product.is_active:
                    _error(f"Line {item.line_no}: product is no longer active")
                if item.line_total > SALES_ORDER_MAX:  # defensive: blocked when saved
                    _error(f"Line {item.line_no} is larger than a sales order line can hold")
            order = SalesOrder(so_number=None, customer_id=quotation.customer_id, status="DRAFT",
                               total_amount=Decimal("0.00"))
            db.add(order)
            db.flush()
            order.so_number = f"SO-{order.id:06d}"
            for item in quotation.items:
                # Rounded line totals, so the order total equals the quotation total.
                db.add(SalesOrderItem(sales_order_id=order.id, product_id=item.product_id,
                                      quantity=item.quantity, unit_price=item.unit_price,
                                      total_price=item.line_total))
                order.total_amount += item.line_total
            db.add(AuditLog(username=user.username, action="CREATE_SALES_ORDER", table_name="sales_orders",
                            record_id=order.id,
                            description=f"{order.so_number}: DRAFT. From quotation {quotation.quotation_number}"))
            quotation.status = "CONVERTED"
            quotation.sales_order_id = order.id
            quotation.converted_at = func.now()
            quotation.converted_by_user_id = user.id
            quotation.updated_at = func.now()
            _audit(db, quotation, user, "CONVERT_QUOTATION", f"Sales order {order.so_number}")
            created = True
    db.refresh(quotation)
    return {**detail(db, quotation), "sales_order_created": created}
