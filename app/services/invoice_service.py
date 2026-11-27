"""F2a: invoices (INV-2026-0001) and internal adjustment notes (ADJ-2026-0001).

Invoice state machine (every transition locks the invoice row and writes an
audit row):

    (shipped sales order) --create--> DRAFT --issue--> ISSUED --void--> VOID
                                        |
                                      delete

- An invoice is created FROM a SHIPPED or COMPLETED sales order. Its lines
  copy the order's lines; quantity and unit price are locked. A draft only
  changes line discounts, descriptions, credit days and notes.
- At most one non-void invoice per sales order (row lock on the order, plus
  the partial unique index ``uq_invoices_active_sales_order``). Creating it
  again returns the existing one.
- Issuing allocates the gapless number, sets issue_date = business_today()
  and due_date = issue_date + credit_days, recomputes totals and freezes the
  seller/customer snapshots.
- An invoice with an ISSUED adjustment note cannot be voided (void the
  adjustment first).
- "Overdue" is not stored: an ISSUED invoice whose due_date is before
  business_today() is reported as overdue (payments come in F3).

Adjustment notes (not a VAT credit note) lower an ISSUED invoice:

    DRAFT --issue--> ISSUED --void--> VOID      (a DRAFT can be deleted)

- Each line takes a quantity of one invoice line at a reduction per unit.
- From a sales return receipt of the same sales order, a line's quantity
  can't exceed the returned quantity not yet adjusted from that receipt.
- A line never takes more than what is left of its invoice line, and the
  issued adjustments of an invoice never add up to more than its total.
  These limits are checked when a draft is saved and again, under the
  invoice row lock, when it is issued.
"""
from datetime import date, timedelta
from decimal import Decimal

from fastapi import status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.document_numbers import allocate_number
from app.core.exceptions import AppException
from app.core.money import Line, document_totals, line_amount, round_money
from app.core.pagination import ListParams, paginate, paginated_body, phase8_json, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AdjustmentNote,
    AdjustmentNoteItem,
    AuditLog,
    CompanyProfile,
    Customer,
    Invoice,
    InvoiceItem,
    Product,
    Quotation,
    SalesOrder,
    SalesOrderItem,
    SalesReturnReceipt,
    User,
)
from app.schemas.invoice_schema import AdjustmentDraftInput, InvoiceDraftUpdate
from app.services import quotation_service

INVOICE_DOC = "INV"
ADJUSTMENT_DOC = "ADJ"
BILLABLE_ORDER_STATUSES = {"SHIPPED", "COMPLETED"}
DEFAULT_CREDIT_DAYS = 30
VAT_THRESHOLD = Decimal("1800000.00")  # yearly revenue that requires VAT registration
VAT_WARNING_SHARE = Decimal("0.80")
_PROFILE_ID = 1
ZERO = Decimal("0.00")


def _error(message: str, code: int = status.HTTP_409_CONFLICT):
    raise AppException(message=message, status_code=code)


def _invalid(message: str):
    _error(message, status.HTTP_422_UNPROCESSABLE_CONTENT)


def _today() -> date:
    return batch_eligibility.business_today()


def _audit(db: Session, table: str, record_id: int, label: str, state: str, user: User,
           action: str, detail: str = "") -> None:
    db.add(AuditLog(
        username=user.username,
        action=action,
        table_name=table,
        record_id=record_id,
        description=f"{label}: {state}. {detail}".strip(),
    ))


def _invoice_audit(db: Session, invoice: Invoice, user: User, action: str, detail: str = "") -> None:
    _audit(db, "invoices", invoice.id, invoice.invoice_number or f"draft #{invoice.id}", invoice.status,
           user, action, detail)


def _note_audit(db: Session, note: AdjustmentNote, user: User, action: str, detail: str = "") -> None:
    _audit(db, "adjustment_notes", note.id, note.adjustment_number or f"draft #{note.id}", note.status,
           user, action, detail)


def _require(document, *states: str, kind: str) -> None:
    if document.status not in states:
        _error(f"{kind} is {document.status}; this action needs {' or '.join(states)}")


def _lock(db: Session, model, record_id: int, kind: str):
    row = db.execute(select(model).where(model.id == record_id).with_for_update()).scalar_one_or_none()
    if row is None:
        _error(f"{kind} not found", status.HTTP_404_NOT_FOUND)
    return row


def _profile_credit_days(db: Session) -> int:
    profile = db.get(CompanyProfile, _PROFILE_ID)
    return profile.default_credit_days if profile is not None else DEFAULT_CREDIT_DAYS


def _vat_from_snapshot(snapshot: dict | None) -> dict:
    snapshot = snapshot or {}
    return {
        "vat_registered": bool(snapshot.get("vat_registered", False)),
        "vat_rate": Decimal(str(snapshot.get("vat_rate") or "7.00")),
        "prices_include_vat": bool(snapshot.get("prices_include_vat", False)),
    }


# ================================================================ invoices


def _apply_invoice_totals(db: Session, invoice: Invoice, vat: dict | None = None) -> None:
    totals = document_totals(
        (Line(item.quantity, item.unit_price, item.discount_amount) for item in invoice.items),
        **(vat or quotation_service._vat_settings(db)),
    )
    invoice.subtotal = totals.subtotal
    invoice.discount_total = totals.discount_total
    invoice.vat_base = totals.vat_base
    invoice.vat_amount = totals.vat_amount
    invoice.grand_total = totals.grand_total


def _is_overdue(invoice: Invoice, today: date) -> bool:
    return invoice.status == "ISSUED" and invoice.due_date is not None and invoice.due_date < today


def _issued_adjusted_total(db: Session, invoice_id: int, exclude_note_id: int | None = None) -> Decimal:
    query = select(func.coalesce(func.sum(AdjustmentNote.grand_total), 0)).where(
        AdjustmentNote.invoice_id == invoice_id, AdjustmentNote.status == "ISSUED")
    if exclude_note_id is not None:
        query = query.where(AdjustmentNote.id != exclude_note_id)
    return Decimal(db.execute(query).scalar_one()).quantize(Decimal("0.01"))


def _invoice_summary(invoice: Invoice, customer_name: str | None, so_number: str | None,
                     adjusted: Decimal, today: date) -> dict:
    snapshot = invoice.customer_snapshot or {}
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "status": invoice.status,
        "is_overdue": _is_overdue(invoice, today),
        "sales_order_id": invoice.sales_order_id,
        "sales_order_number": so_number,
        "customer_id": invoice.customer_id,
        "customer_name": snapshot.get("name") or customer_name,
        "issue_date": invoice.issue_date,
        "due_date": invoice.due_date,
        "credit_days": invoice.credit_days,
        "grand_total": invoice.grand_total,
        "adjusted_total": adjusted,
        "balance": invoice.grand_total - adjusted,
        "created_at": invoice.created_at,
        "updated_at": invoice.updated_at,
    }


def _returned_by_product(receipt: SalesReturnReceipt) -> dict[int, Decimal]:
    totals: dict[int, Decimal] = {}
    for line in (receipt.response_snapshot or {}).get("returned_items", []):
        product_id = int(line["product_id"])
        totals[product_id] = totals.get(product_id, Decimal("0")) + Decimal(str(line["returned_quantity"]))
    return totals


def _adjusted_quantities(db: Session, receipt_id: int, exclude_note_id: int | None = None) -> dict[int, Decimal]:
    """Quantity per invoice line already adjusted (ISSUED notes) from one return receipt."""
    query = (
        select(AdjustmentNoteItem.invoice_item_id, func.sum(AdjustmentNoteItem.quantity))
        .join(AdjustmentNote, AdjustmentNote.id == AdjustmentNoteItem.adjustment_note_id)
        .where(AdjustmentNote.sales_return_receipt_id == receipt_id, AdjustmentNote.status == "ISSUED")
        .group_by(AdjustmentNoteItem.invoice_item_id)
    )
    if exclude_note_id is not None:
        query = query.where(AdjustmentNote.id != exclude_note_id)
    return {item_id: Decimal(qty) for item_id, qty in db.execute(query).all()}


def _adjusted_amounts(db: Session, invoice_id: int, exclude_note_id: int | None = None) -> dict[int, Decimal]:
    """Amount per invoice line already taken by ISSUED adjustment notes."""
    query = (
        select(AdjustmentNoteItem.invoice_item_id, func.sum(AdjustmentNoteItem.line_total))
        .join(AdjustmentNote, AdjustmentNote.id == AdjustmentNoteItem.adjustment_note_id)
        .where(AdjustmentNote.invoice_id == invoice_id, AdjustmentNote.status == "ISSUED")
        .group_by(AdjustmentNoteItem.invoice_item_id)
    )
    if exclude_note_id is not None:
        query = query.where(AdjustmentNote.id != exclude_note_id)
    return {item_id: Decimal(amount) for item_id, amount in db.execute(query).all()}


def invoice_detail(db: Session, invoice: Invoice) -> dict:
    customer = db.get(Customer, invoice.customer_id)
    order = db.get(SalesOrder, invoice.sales_order_id)
    quotation_number = None
    if invoice.quotation_id:
        quotation_number = db.execute(
            select(Quotation.quotation_number).where(Quotation.id == invoice.quotation_id)
        ).scalar_one_or_none()
    notes = db.execute(
        select(AdjustmentNote).where(AdjustmentNote.invoice_id == invoice.id).order_by(AdjustmentNote.id)
    ).scalars().all()
    adjusted = sum((n.grand_total for n in notes if n.status == "ISSUED"), ZERO)
    item_by_product = {item.product_id: item for item in invoice.items}
    receipts = db.execute(
        select(SalesReturnReceipt).where(SalesReturnReceipt.sales_order_id == invoice.sales_order_id)
        .order_by(SalesReturnReceipt.id)
    ).scalars().all()
    receipt_rows = []
    for receipt in receipts:
        done = _adjusted_quantities(db, receipt.id)
        lines = []
        for product_id, quantity in sorted(_returned_by_product(receipt).items()):
            item = item_by_product.get(product_id)
            if item is None:
                continue
            lines.append({"invoice_item_id": item.id, "product_id": product_id,
                          "returned_quantity": quantity.quantize(Decimal("0.001")),
                          "adjusted_quantity": done.get(item.id, Decimal("0")).quantize(Decimal("0.001"))})
        receipt_rows.append({"id": receipt.id, "receipt_number": receipt.receipt_number,
                             "returned_at": receipt.returned_at, "items": lines})
    amounts = _adjusted_amounts(db, invoice.id)
    today = _today()
    return phase8_json({
        **_invoice_summary(invoice, customer.customer_name if customer else None,
                           order.so_number if order else None, adjusted, today),
        "quotation_id": invoice.quotation_id,
        "quotation_number": quotation_number,
        "notes": invoice.notes,
        "customer_snapshot": invoice.customer_snapshot,
        "seller_snapshot": invoice.seller_snapshot,
        "subtotal": invoice.subtotal,
        "discount_total": invoice.discount_total,
        "vat_base": invoice.vat_base,
        "vat_amount": invoice.vat_amount,
        "void_reason": invoice.void_reason,
        "issued_at": invoice.issued_at,
        "voided_at": invoice.voided_at,
        "items": [
            {
                "id": item.id,
                "line_no": item.line_no,
                "product_id": item.product_id,
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "discount_amount": item.discount_amount,
                "line_total": item.line_total,
                "adjusted_amount": amounts.get(item.id, ZERO),
            }
            for item in invoice.items
        ],
        "adjustments": [
            {"id": n.id, "adjustment_number": n.adjustment_number, "status": n.status,
             "grand_total": n.grand_total, "issue_date": n.issue_date}
            for n in notes
        ],
        "return_receipts": receipt_rows,
    })


def get_invoice_service(db: Session, invoice_id: int) -> dict:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        _error("Invoice not found", status.HTTP_404_NOT_FOUND)
    return invoice_detail(db, invoice)


def list_invoices_service(db: Session, params: ListParams, customer_id: int | None = None,
                          sales_order_id: int | None = None) -> dict:
    query = db.query(Invoice)
    today = _today()
    if params.status:
        wanted = params.status.upper()
        if wanted == "OVERDUE":
            query = query.filter(Invoice.status == "ISSUED", Invoice.due_date < today)
        else:
            query = query.filter(Invoice.status == wanted)
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if sales_order_id:
        query = query.filter(Invoice.sales_order_id == sales_order_id)
    if params.search:
        pattern = f"%{params.search}%"
        query = query.filter(or_(
            Invoice.invoice_number.ilike(pattern),
            Invoice.customer_id.in_(select(Customer.id).where(Customer.customer_name.ilike(pattern))),
            Invoice.sales_order_id.in_(select(SalesOrder.id).where(SalesOrder.so_number.ilike(pattern))),
        ))
    ordering = resolve_ordering(params, {
        "id": Invoice.id,
        "created_at": Invoice.created_at,
        "issue_date": Invoice.issue_date,
        "due_date": Invoice.due_date,
        "invoice_number": Invoice.invoice_number,
        "grand_total": Invoice.grand_total,
        "status": Invoice.status,
    }, "created_at", Invoice.id)
    items, total = paginate(query, params, ordering)
    customer_ids = {i.customer_id for i in items}
    order_ids = {i.sales_order_id for i in items}
    invoice_ids = [i.id for i in items]
    names = dict(db.execute(select(Customer.id, Customer.customer_name)
                            .where(Customer.id.in_(customer_ids))).all()) if customer_ids else {}
    numbers = dict(db.execute(select(SalesOrder.id, SalesOrder.so_number)
                              .where(SalesOrder.id.in_(order_ids))).all()) if order_ids else {}
    adjusted = dict(db.execute(
        select(AdjustmentNote.invoice_id, func.sum(AdjustmentNote.grand_total))
        .where(AdjustmentNote.invoice_id.in_(invoice_ids), AdjustmentNote.status == "ISSUED")
        .group_by(AdjustmentNote.invoice_id)
    ).all()) if invoice_ids else {}
    rows = [_invoice_summary(i, names.get(i.customer_id), numbers.get(i.sales_order_id),
                             Decimal(adjusted.get(i.id, ZERO)).quantize(Decimal("0.01")), today)
            for i in items]
    return paginated_body(rows, total, params, "Invoices retrieved")


def create_invoice_from_order_service(db: Session, sales_order_id: int, user: User) -> dict:
    """DRAFT invoice from a shipped order. Idempotent while a non-void invoice exists."""
    with UnitOfWork(db):
        order = _lock(db, SalesOrder, sales_order_id, "Sales order")
        existing = db.execute(
            select(Invoice).where(Invoice.sales_order_id == order.id, Invoice.status != "VOID")
        ).scalar_one_or_none()
        if existing is not None:
            invoice, created = existing, False
        else:
            if order.status not in BILLABLE_ORDER_STATUSES:
                _error(f"Sales order is {order.status}; only a shipped or completed order can be invoiced")
            lines = db.execute(
                select(SalesOrderItem).where(SalesOrderItem.sales_order_id == order.id).order_by(SalesOrderItem.id)
            ).scalars().all()
            if not lines:
                _error("Sales order has no lines to invoice")
            if order.customer_id is None:
                _error("Sales order has no customer")
            quotation_id = db.execute(
                select(Quotation.id).where(Quotation.sales_order_id == order.id)
            ).scalar_one_or_none()
            invoice = Invoice(status="DRAFT", sales_order_id=order.id, customer_id=order.customer_id,
                              quotation_id=quotation_id, credit_days=_profile_credit_days(db),
                              created_by_user_id=user.id)
            db.add(invoice)
            for number, line in enumerate(lines, start=1):
                if line.unit_price is None:
                    _error(f"Sales order line {number} has no unit price")
                product = db.get(Product, line.product_id)
                invoice.items.append(InvoiceItem(
                    line_no=number,
                    product_id=line.product_id,
                    description=quotation_service._product_label(product)[:300] if product else
                    f"Product {line.product_id}",
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_amount=ZERO,
                    line_total=line_amount(line.quantity, line.unit_price),
                ))
            _apply_invoice_totals(db, invoice)
            db.flush()
            _invoice_audit(db, invoice, user, "CREATE_INVOICE", f"From sales order {order.so_number}")
            created = True
    db.refresh(invoice)
    return {**invoice_detail(db, invoice), "invoice_created": created}


def update_invoice_service(db: Session, invoice_id: int, data: InvoiceDraftUpdate, user: User) -> dict:
    with UnitOfWork(db):
        invoice = _lock(db, Invoice, invoice_id, "Invoice")
        _require(invoice, "DRAFT", kind="Invoice")
        edits = {edit.line_no: edit for edit in data.items}
        by_number = {item.line_no: item for item in invoice.items}
        unknown = sorted(set(edits) - set(by_number))
        if unknown:
            _invalid(f"Invoice has no line {unknown[0]}")
        for number, item in by_number.items():
            edit = edits.get(number)
            discount = edit.discount_amount if edit else ZERO
            try:
                item.line_total = line_amount(item.quantity, item.unit_price, discount)
            except ValueError:
                _invalid(f"Line {number}: the discount is larger than the line amount")
            item.discount_amount = discount
            if edit and edit.description is not None and edit.description.strip():
                item.description = edit.description.strip()[:300]
        invoice.credit_days = data.credit_days
        invoice.notes = (data.notes or "").strip() or None
        _apply_invoice_totals(db, invoice)
        invoice.updated_at = func.now()
        _invoice_audit(db, invoice, user, "UPDATE_INVOICE")
    db.refresh(invoice)
    return invoice_detail(db, invoice)


def delete_invoice_service(db: Session, invoice_id: int, user: User) -> dict:
    with UnitOfWork(db):
        invoice = _lock(db, Invoice, invoice_id, "Invoice")
        _require(invoice, "DRAFT", kind="Invoice")
        _invoice_audit(db, invoice, user, "DELETE_INVOICE", "Draft deleted")
        db.delete(invoice)
    return {"id": invoice_id, "deleted": True}


def issue_invoice_service(db: Session, invoice_id: int, user: User) -> dict:
    with UnitOfWork(db):
        invoice = _lock(db, Invoice, invoice_id, "Invoice")
        _require(invoice, "DRAFT", kind="Invoice")
        order = _lock(db, SalesOrder, invoice.sales_order_id, "Sales order")
        if order.status not in BILLABLE_ORDER_STATUSES:
            _error(f"Sales order is {order.status}; only a shipped or completed order can be invoiced")
        today = _today()
        _apply_invoice_totals(db, invoice)  # current VAT settings, frozen from here on
        invoice.invoice_number = allocate_number(db, INVOICE_DOC, today)
        invoice.status = "ISSUED"
        invoice.issue_date = today
        invoice.due_date = today + timedelta(days=invoice.credit_days)
        invoice.seller_snapshot = quotation_service._seller_snapshot(db)
        invoice.customer_snapshot = quotation_service._customer_snapshot(db.get(Customer, invoice.customer_id))
        invoice.issued_at = func.now()
        invoice.issued_by_user_id = user.id
        invoice.updated_at = func.now()
        _invoice_audit(db, invoice, user, "ISSUE_INVOICE", f"Total {invoice.grand_total}")
    db.refresh(invoice)
    return invoice_detail(db, invoice)


def void_invoice_service(db: Session, invoice_id: int, reason: str, user: User) -> dict:
    with UnitOfWork(db):
        invoice = _lock(db, Invoice, invoice_id, "Invoice")
        _require(invoice, "ISSUED", kind="Invoice")
        issued_notes = db.execute(
            select(func.count()).select_from(AdjustmentNote)
            .where(AdjustmentNote.invoice_id == invoice.id, AdjustmentNote.status == "ISSUED")
        ).scalar_one()
        if issued_notes:
            _error("Invoice has issued adjustment notes; void them before voiding the invoice")
        invoice.status = "VOID"
        invoice.void_reason = reason
        invoice.voided_at = func.now()
        invoice.voided_by_user_id = user.id
        invoice.updated_at = func.now()
        _invoice_audit(db, invoice, user, "VOID_INVOICE", f"Reason: {reason}")
    db.refresh(invoice)
    return invoice_detail(db, invoice)


def revenue_summary_service(db: Session, year: int | None = None) -> dict:
    """Issued invoices minus issued adjustments in one calendar year, against the VAT threshold."""
    year = year or _today().year
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    invoiced = Decimal(db.execute(
        select(func.coalesce(func.sum(Invoice.grand_total), 0))
        .where(Invoice.status == "ISSUED", Invoice.issue_date >= start, Invoice.issue_date < end)
    ).scalar_one())
    adjusted = Decimal(db.execute(
        select(func.coalesce(func.sum(AdjustmentNote.grand_total), 0))
        .where(AdjustmentNote.status == "ISSUED", AdjustmentNote.issue_date >= start, AdjustmentNote.issue_date < end)
    ).scalar_one())
    net = round_money(invoiced - adjusted)
    share = net / VAT_THRESHOLD
    level = "over" if share >= 1 else "warning" if share >= VAT_WARNING_SHARE else "ok"
    return phase8_json({
        "year": year,
        "invoiced_total": round_money(invoiced),
        "adjusted_total": round_money(adjusted),
        "net_revenue": net,
        "vat_threshold": VAT_THRESHOLD,
        "threshold_percent": (share * 100).quantize(Decimal("0.01")),
        "level": level,
    })


# ================================================================ adjustment notes


def _note_summary(note: AdjustmentNote, invoice_number: str | None, customer_name: str | None) -> dict:
    return {
        "id": note.id,
        "adjustment_number": note.adjustment_number,
        "status": note.status,
        "invoice_id": note.invoice_id,
        "invoice_number": invoice_number,
        "customer_name": (note.customer_snapshot or {}).get("name") or customer_name,
        "sales_return_receipt_id": note.sales_return_receipt_id,
        "reason": note.reason,
        "issue_date": note.issue_date,
        "grand_total": note.grand_total,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


def note_detail(db: Session, note: AdjustmentNote) -> dict:
    invoice = db.get(Invoice, note.invoice_id)
    customer = db.get(Customer, invoice.customer_id) if invoice else None
    receipt_number = None
    if note.sales_return_receipt_id:
        receipt_number = db.execute(
            select(SalesReturnReceipt.receipt_number).where(SalesReturnReceipt.id == note.sales_return_receipt_id)
        ).scalar_one_or_none()
    return phase8_json({
        **_note_summary(note, invoice.invoice_number if invoice else None,
                        customer.customer_name if customer else None),
        "sales_return_receipt_number": receipt_number,
        "customer_snapshot": note.customer_snapshot,
        "seller_snapshot": note.seller_snapshot,
        "subtotal": note.subtotal,
        "vat_base": note.vat_base,
        "vat_amount": note.vat_amount,
        "void_reason": note.void_reason,
        "issued_at": note.issued_at,
        "voided_at": note.voided_at,
        "items": [
            {"id": i.id, "line_no": i.line_no, "invoice_item_id": i.invoice_item_id, "description": i.description,
             "quantity": i.quantity, "unit_price": i.unit_price, "line_total": i.line_total}
            for i in note.items
        ],
    })


def _apply_note_totals(note: AdjustmentNote, invoice: Invoice) -> None:
    totals = document_totals((Line(i.quantity, i.unit_price) for i in note.items),
                             **_vat_from_snapshot(invoice.seller_snapshot))
    note.subtotal = totals.subtotal
    note.vat_base = totals.vat_base
    note.vat_amount = totals.vat_amount
    note.grand_total = totals.grand_total


def _check_limits(db: Session, note: AdjustmentNote, invoice: Invoice) -> None:
    """Every limit an adjustment must respect, given the ISSUED adjustments other than this one."""
    exclude = note.id
    items = {item.id: item for item in invoice.items}
    taken = _adjusted_amounts(db, invoice.id, exclude)
    returned = done = None
    if note.sales_return_receipt_id:
        receipt = db.get(SalesReturnReceipt, note.sales_return_receipt_id)
        if receipt is None or receipt.sales_order_id != invoice.sales_order_id:
            _invalid("The return receipt does not belong to this invoice's sales order")
        returned = _returned_by_product(receipt)
        done = _adjusted_quantities(db, receipt.id, exclude)
    for line in note.items:
        item = items.get(line.invoice_item_id)
        if item is None:
            _invalid(f"Line {line.line_no}: not a line of invoice {invoice.invoice_number}")
        if line.quantity > item.quantity:
            _invalid(f"Line {line.line_no}: quantity is more than the invoiced quantity ({item.quantity})")
        if returned is not None:
            left = returned.get(item.product_id, Decimal("0")) - done.get(item.id, Decimal("0"))
            if line.quantity > left:
                _invalid(f"Line {line.line_no}: only {left.quantize(Decimal('0.001'))} returned and not yet adjusted")
        if line.line_total > item.line_total - taken.get(item.id, ZERO):
            _invalid(f"Line {line.line_no}: the adjustment is larger than what is left of the invoice line")
    if note.grand_total > invoice.grand_total - _issued_adjusted_total(db, invoice.id, exclude):
        _invalid("Adjustments would be larger than the invoice total")


def _replace_note_lines(db: Session, note: AdjustmentNote, invoice: Invoice, data: AdjustmentDraftInput) -> None:
    items = {item.id: item for item in invoice.items}
    note.sales_return_receipt_id = data.sales_return_receipt_id
    note.reason = data.reason
    note.items.clear()
    db.flush()
    for number, line in enumerate(data.items, start=1):
        item = items.get(line.invoice_item_id)
        if item is None:
            _invalid(f"Line {number}: not a line of invoice {invoice.invoice_number}")
        description = (line.description or "").strip() or item.description
        note.items.append(AdjustmentNoteItem(
            line_no=number, invoice_item_id=item.id, description=description[:300],
            quantity=line.quantity, unit_price=line.unit_price,
            line_total=line_amount(line.quantity, line.unit_price),
        ))
    _apply_note_totals(note, invoice)
    db.flush()
    _check_limits(db, note, invoice)


def get_note_service(db: Session, note_id: int) -> dict:
    note = db.get(AdjustmentNote, note_id)
    if note is None:
        _error("Adjustment note not found", status.HTTP_404_NOT_FOUND)
    return note_detail(db, note)


def list_notes_service(db: Session, params: ListParams, invoice_id: int | None = None) -> dict:
    query = db.query(AdjustmentNote)
    if params.status:
        query = query.filter(AdjustmentNote.status == params.status.upper())
    if invoice_id:
        query = query.filter(AdjustmentNote.invoice_id == invoice_id)
    if params.search:
        pattern = f"%{params.search}%"
        query = query.filter(or_(
            AdjustmentNote.adjustment_number.ilike(pattern),
            AdjustmentNote.invoice_id.in_(select(Invoice.id).where(Invoice.invoice_number.ilike(pattern))),
        ))
    ordering = resolve_ordering(params, {
        "id": AdjustmentNote.id,
        "created_at": AdjustmentNote.created_at,
        "issue_date": AdjustmentNote.issue_date,
        "adjustment_number": AdjustmentNote.adjustment_number,
        "grand_total": AdjustmentNote.grand_total,
        "status": AdjustmentNote.status,
    }, "created_at", AdjustmentNote.id)
    items, total = paginate(query, params, ordering)
    invoice_ids = {n.invoice_id for n in items}
    invoices = {i.id: i for i in db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids))).scalars()} \
        if invoice_ids else {}
    customer_ids = {i.customer_id for i in invoices.values()}
    names = dict(db.execute(select(Customer.id, Customer.customer_name)
                            .where(Customer.id.in_(customer_ids))).all()) if customer_ids else {}
    rows = []
    for note in items:
        invoice = invoices.get(note.invoice_id)
        rows.append(_note_summary(note, invoice.invoice_number if invoice else None,
                                  names.get(invoice.customer_id) if invoice else None))
    return paginated_body(rows, total, params, "Adjustment notes retrieved")


def create_note_service(db: Session, data: AdjustmentDraftInput, user: User) -> dict:
    with UnitOfWork(db):
        invoice = _lock(db, Invoice, data.invoice_id, "Invoice")
        _require(invoice, "ISSUED", kind="Invoice")
        note = AdjustmentNote(status="DRAFT", invoice_id=invoice.id, reason=data.reason,
                              created_by_user_id=user.id)
        db.add(note)
        db.flush()
        _replace_note_lines(db, note, invoice, data)
        _note_audit(db, note, user, "CREATE_ADJUSTMENT_NOTE", f"For invoice {invoice.invoice_number}")
    db.refresh(note)
    return note_detail(db, note)


def _locked_note_with_invoice(db: Session, note_id: int) -> tuple[AdjustmentNote, Invoice]:
    """Lock the invoice first, then the note (same order everywhere, so no deadlock)."""
    peek = db.get(AdjustmentNote, note_id)
    if peek is None:
        _error("Adjustment note not found", status.HTTP_404_NOT_FOUND)
    invoice = _lock(db, Invoice, peek.invoice_id, "Invoice")
    note = _lock(db, AdjustmentNote, note_id, "Adjustment note")
    return note, invoice


def update_note_service(db: Session, note_id: int, data: AdjustmentDraftInput, user: User) -> dict:
    with UnitOfWork(db):
        note, invoice = _locked_note_with_invoice(db, note_id)
        _require(note, "DRAFT", kind="Adjustment note")
        if data.invoice_id != note.invoice_id:
            _invalid("An adjustment note can't move to another invoice")
        _require(invoice, "ISSUED", kind="Invoice")
        _replace_note_lines(db, note, invoice, data)
        note.updated_at = func.now()
        _note_audit(db, note, user, "UPDATE_ADJUSTMENT_NOTE")
    db.refresh(note)
    return note_detail(db, note)


def delete_note_service(db: Session, note_id: int, user: User) -> dict:
    with UnitOfWork(db):
        note, _invoice = _locked_note_with_invoice(db, note_id)
        _require(note, "DRAFT", kind="Adjustment note")
        _note_audit(db, note, user, "DELETE_ADJUSTMENT_NOTE", "Draft deleted")
        db.delete(note)
    return {"id": note_id, "deleted": True}


def issue_note_service(db: Session, note_id: int, user: User) -> dict:
    with UnitOfWork(db):
        note, invoice = _locked_note_with_invoice(db, note_id)
        _require(note, "DRAFT", kind="Adjustment note")
        _require(invoice, "ISSUED", kind="Invoice")
        _apply_note_totals(note, invoice)
        _check_limits(db, note, invoice)  # again, now under the invoice lock
        today = _today()
        note.adjustment_number = allocate_number(db, ADJUSTMENT_DOC, today)
        note.status = "ISSUED"
        note.issue_date = today
        note.seller_snapshot = quotation_service._seller_snapshot(db)
        note.customer_snapshot = invoice.customer_snapshot
        note.issued_at = func.now()
        note.issued_by_user_id = user.id
        note.updated_at = func.now()
        _note_audit(db, note, user, "ISSUE_ADJUSTMENT_NOTE",
                    f"Invoice {invoice.invoice_number}, total {note.grand_total}")
    db.refresh(note)
    return note_detail(db, note)


def void_note_service(db: Session, note_id: int, reason: str, user: User) -> dict:
    with UnitOfWork(db):
        note, _invoice = _locked_note_with_invoice(db, note_id)
        _require(note, "ISSUED", kind="Adjustment note")
        note.status = "VOID"
        note.void_reason = reason
        note.voided_at = func.now()
        note.voided_by_user_id = user.id
        note.updated_at = func.now()
        _note_audit(db, note, user, "VOID_ADJUSTMENT_NOTE", f"Reason: {reason}")
    db.refresh(note)
    return note_detail(db, note)
