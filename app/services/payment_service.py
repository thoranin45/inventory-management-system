"""F3a: payment receipts (RC-2026-0001), billing notes (BN-2026-0001) and AR aging.

Receipts (not a tax receipt while the business is not VAT-registered):

    (record) --> ISSUED --void--> VOID

- A receipt is issued when it is recorded: a payment is a fact, so there is
  no draft. It belongs to one customer and settles one or more of that
  customer's ISSUED invoices. Each allocation is cash plus optional withheld
  tax (WHT) and is at most the invoice balance at that moment.
- Locks: the customer row first (serialises receipts of one customer and
  makes ``client_request_id`` retries safe), then the invoices in id order.
  Voiding locks the invoices in id order, then the receipt. Every path that
  changes a balance takes the invoice lock, so two receipts can never both
  take the last baht of a balance.
- ``client_request_id`` (optional, unique): sending the same id again returns
  the receipt already recorded instead of a second one.

Billing notes are informational: they list a customer's unpaid invoices and
never change a balance.

    DRAFT --issue--> ISSUED --void--> VOID      (a DRAFT can be deleted)

- Each line is one ISSUED invoice of the customer with a balance left; its
  amount is the balance, refreshed when the draft is saved and again at issue.

AR aging groups the balance of every ISSUED invoice with money left by how
many days it is past its due date: not yet due, 1-30, 31-60, 61-90, over 90.
"""
from datetime import date
from decimal import Decimal
from io import BytesIO

from fastapi import status
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.document_numbers import allocate_number
from app.core.exceptions import AppException
from app.core.pagination import ListParams, paginate, paginated_body, phase8_json, resolve_ordering
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    BillingNote,
    BillingNoteItem,
    Customer,
    Invoice,
    PaymentReceipt,
    PaymentReceiptAllocation,
    User,
)
from app.schemas.payment_schema import BillingNoteInput, PaymentReceiptInput
from app.services import invoice_service, quotation_service

RECEIPT_DOC = "RC"
BILLING_DOC = "BN"
ZERO = Decimal("0.00")
AGING_BUCKETS = ("not_due", "days_1_30", "days_31_60", "days_61_90", "days_over_90")


def _error(message: str, code: int = status.HTTP_409_CONFLICT):
    raise AppException(message=message, status_code=code)


def _invalid(message: str):
    _error(message, status.HTTP_422_UNPROCESSABLE_CONTENT)


def _today() -> date:
    return batch_eligibility.business_today()


def _audit(db: Session, table: str, record_id: int, label: str, state: str, user: User,
           action: str, detail: str = "") -> None:
    db.add(AuditLog(username=user.username, action=action, table_name=table, record_id=record_id,
                    description=f"{label}: {state}. {detail}".strip()))


def _lock(db: Session, model, record_id: int, kind: str):
    row = db.execute(select(model).where(model.id == record_id).with_for_update()).scalar_one_or_none()
    if row is None:
        _error(f"{kind} not found", status.HTTP_404_NOT_FOUND)
    return row


def _lock_invoices(db: Session, invoice_ids) -> dict[int, Invoice]:
    ids = sorted(set(invoice_ids))
    rows = db.execute(select(Invoice).where(Invoice.id.in_(ids)).order_by(Invoice.id).with_for_update()).scalars()
    found = {invoice.id: invoice for invoice in rows}
    missing = [i for i in ids if i not in found]
    if missing:
        _error(f"Invoice {missing[0]} not found", status.HTTP_404_NOT_FOUND)
    return found


def _open_invoice(invoice: Invoice, customer_id: int, db: Session) -> Decimal:
    """The invoice must be ISSUED, belong to the customer and have a balance; returns the balance."""
    label = invoice.invoice_number or f"draft #{invoice.id}"
    if invoice.customer_id != customer_id:
        _invalid(f"Invoice {label} belongs to another customer")
    if invoice.status != "ISSUED":
        _invalid(f"Invoice {label} is {invoice.status}; only issued invoices can be paid or billed")
    balance = invoice_service.invoice_balance(db, invoice)
    if balance <= 0:
        _invalid(f"Invoice {label} is already fully paid")
    return balance


def _customer_name(db: Session, customer_id: int) -> str | None:
    return db.execute(select(Customer.customer_name).where(Customer.id == customer_id)).scalar_one_or_none()


# ================================================================ receipts


def _receipt_summary(receipt: PaymentReceipt, customer_name: str | None) -> dict:
    return {
        "id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "status": receipt.status,
        "customer_id": receipt.customer_id,
        "customer_name": (receipt.customer_snapshot or {}).get("name") or customer_name,
        "received_date": receipt.received_date,
        "method": receipt.method,
        "reference": receipt.reference,
        "amount_total": receipt.amount_total,
        "wht_total": receipt.wht_total,
        "settled_total": receipt.settled_total,
        "created_at": receipt.created_at,
    }


def receipt_detail(db: Session, receipt: PaymentReceipt) -> dict:
    invoice_ids = [a.invoice_id for a in receipt.allocations]
    invoices = {i.id: i for i in db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids))).scalars()} \
        if invoice_ids else {}
    return phase8_json({
        **_receipt_summary(receipt, _customer_name(db, receipt.customer_id)),
        "notes": receipt.notes,
        "customer_snapshot": receipt.customer_snapshot,
        "seller_snapshot": receipt.seller_snapshot,
        "void_reason": receipt.void_reason,
        "voided_at": receipt.voided_at,
        "allocations": [
            {
                "id": a.id,
                "line_no": a.line_no,
                "invoice_id": a.invoice_id,
                "invoice_number": invoices[a.invoice_id].invoice_number if a.invoice_id in invoices else None,
                "invoice_issue_date": invoices[a.invoice_id].issue_date if a.invoice_id in invoices else None,
                "invoice_total": invoices[a.invoice_id].grand_total if a.invoice_id in invoices else None,
                "amount": a.amount,
                "wht_amount": a.wht_amount,
                "wht_certificate_no": a.wht_certificate_no,
            }
            for a in receipt.allocations
        ],
    })


def get_receipt_service(db: Session, receipt_id: int) -> dict:
    receipt = db.get(PaymentReceipt, receipt_id)
    if receipt is None:
        _error("Receipt not found", status.HTTP_404_NOT_FOUND)
    return receipt_detail(db, receipt)


def list_receipts_service(db: Session, params: ListParams, customer_id: int | None = None,
                          invoice_id: int | None = None) -> dict:
    query = db.query(PaymentReceipt)
    if params.status:
        query = query.filter(PaymentReceipt.status == params.status.upper())
    if customer_id:
        query = query.filter(PaymentReceipt.customer_id == customer_id)
    if invoice_id:
        query = query.filter(PaymentReceipt.id.in_(
            select(PaymentReceiptAllocation.payment_receipt_id).where(PaymentReceiptAllocation.invoice_id == invoice_id)))
    if params.search:
        pattern = f"%{params.search}%"
        query = query.filter(or_(
            PaymentReceipt.receipt_number.ilike(pattern),
            PaymentReceipt.reference.ilike(pattern),
            PaymentReceipt.customer_id.in_(select(Customer.id).where(Customer.customer_name.ilike(pattern))),
            PaymentReceipt.id.in_(
                select(PaymentReceiptAllocation.payment_receipt_id)
                .join(Invoice, Invoice.id == PaymentReceiptAllocation.invoice_id)
                .where(Invoice.invoice_number.ilike(pattern))),
        ))
    ordering = resolve_ordering(params, {
        "id": PaymentReceipt.id,
        "created_at": PaymentReceipt.created_at,
        "received_date": PaymentReceipt.received_date,
        "receipt_number": PaymentReceipt.receipt_number,
        "settled_total": PaymentReceipt.settled_total,
        "status": PaymentReceipt.status,
    }, "created_at", PaymentReceipt.id)
    items, total = paginate(query, params, ordering)
    customer_ids = {r.customer_id for r in items}
    names = dict(db.execute(select(Customer.id, Customer.customer_name)
                            .where(Customer.id.in_(customer_ids))).all()) if customer_ids else {}
    return paginated_body([_receipt_summary(r, names.get(r.customer_id)) for r in items], total, params,
                          "Receipts retrieved")


def create_receipt_service(db: Session, data: PaymentReceiptInput, user: User) -> dict:
    with UnitOfWork(db):
        customer = _lock(db, Customer, data.customer_id, "Customer")
        if data.client_request_id:
            existing = db.execute(select(PaymentReceipt).where(
                PaymentReceipt.client_request_id == data.client_request_id)).scalar_one_or_none()
            if existing is not None:
                if existing.customer_id != customer.id:
                    _error("This request id was already used for another customer")
                return {**receipt_detail(db, existing), "receipt_created": False}
        today = _today()
        received = data.received_date or today
        if received > today:
            _invalid("The received date can't be in the future")
        invoices = _lock_invoices(db, (a.invoice_id for a in data.allocations))
        receipt = PaymentReceipt(
            status="ISSUED", customer_id=customer.id, received_date=received, method=data.method,
            reference=data.reference, notes=(data.notes or "").strip() or None,
            client_request_id=data.client_request_id, created_by_user_id=user.id,
        )
        amount_total = wht_total = ZERO
        for number, line in enumerate(data.allocations, start=1):
            invoice = invoices[line.invoice_id]
            balance = _open_invoice(invoice, customer.id, db)
            settled = line.amount + line.wht_amount
            if settled > balance:
                _invalid(f"Invoice {invoice.invoice_number}: {settled} is more than the balance {balance}")
            receipt.allocations.append(PaymentReceiptAllocation(
                line_no=number, invoice_id=invoice.id, amount=line.amount, wht_amount=line.wht_amount,
                wht_certificate_no=line.wht_certificate_no))
            amount_total += line.amount
            wht_total += line.wht_amount
        receipt.amount_total = amount_total
        receipt.wht_total = wht_total
        receipt.settled_total = amount_total + wht_total
        receipt.receipt_number = allocate_number(db, RECEIPT_DOC, today)
        receipt.seller_snapshot = quotation_service._seller_snapshot(db)
        receipt.customer_snapshot = quotation_service._customer_snapshot(customer)
        db.add(receipt)
        db.flush()
        numbers = ", ".join(invoices[a.invoice_id].invoice_number for a in data.allocations)
        _audit(db, "payment_receipts", receipt.id, receipt.receipt_number, receipt.status, user,
               "CREATE_RECEIPT", f"Received {receipt.amount_total}, WHT {receipt.wht_total}; invoices {numbers}")
        created = True
    db.refresh(receipt)
    return {**receipt_detail(db, receipt), "receipt_created": created}


def void_receipt_service(db: Session, receipt_id: int, reason: str, user: User) -> dict:
    with UnitOfWork(db):
        peek = db.get(PaymentReceipt, receipt_id)
        if peek is None:
            _error("Receipt not found", status.HTTP_404_NOT_FOUND)
        _lock_invoices(db, [a.invoice_id for a in peek.allocations])
        receipt = _lock(db, PaymentReceipt, receipt_id, "Receipt")
        if receipt.status != "ISSUED":
            _error(f"Receipt is {receipt.status}; only an issued receipt can be voided")
        receipt.status = "VOID"
        receipt.void_reason = reason
        receipt.voided_at = func.now()
        receipt.voided_by_user_id = user.id
        _audit(db, "payment_receipts", receipt.id, receipt.receipt_number, receipt.status, user,
               "VOID_RECEIPT", f"Reason: {reason}")
    db.refresh(receipt)
    return receipt_detail(db, receipt)


# ================================================================ billing notes


def _billing_summary(note: BillingNote, customer_name: str | None, count: int) -> dict:
    return {
        "id": note.id,
        "billing_number": note.billing_number,
        "status": note.status,
        "customer_id": note.customer_id,
        "customer_name": (note.customer_snapshot or {}).get("name") or customer_name,
        "issue_date": note.issue_date,
        "payment_due_date": note.payment_due_date,
        "total_amount": note.total_amount,
        "invoice_count": count,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


def billing_detail(db: Session, note: BillingNote) -> dict:
    invoice_ids = [i.invoice_id for i in note.items]
    invoices = {i.id: i for i in db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids))).scalars()} \
        if invoice_ids else {}
    items = []
    for item in note.items:
        invoice = invoices.get(item.invoice_id)
        items.append({
            "id": item.id,
            "line_no": item.line_no,
            "invoice_id": item.invoice_id,
            "invoice_number": invoice.invoice_number if invoice else None,
            "invoice_status": invoice.status if invoice else None,
            "issue_date": invoice.issue_date if invoice else None,
            "due_date": invoice.due_date if invoice else None,
            "invoice_total": invoice.grand_total if invoice else None,
            "amount": item.amount,
            "current_balance": invoice_service.invoice_balance(db, invoice) if invoice else None,
        })
    return phase8_json({
        **_billing_summary(note, _customer_name(db, note.customer_id), len(note.items)),
        "notes": note.notes,
        "customer_snapshot": note.customer_snapshot,
        "seller_snapshot": note.seller_snapshot,
        "void_reason": note.void_reason,
        "issued_at": note.issued_at,
        "voided_at": note.voided_at,
        "items": items,
    })


def get_billing_service(db: Session, note_id: int) -> dict:
    note = db.get(BillingNote, note_id)
    if note is None:
        _error("Billing note not found", status.HTTP_404_NOT_FOUND)
    return billing_detail(db, note)


def list_billing_service(db: Session, params: ListParams, customer_id: int | None = None) -> dict:
    query = db.query(BillingNote)
    if params.status:
        query = query.filter(BillingNote.status == params.status.upper())
    if customer_id:
        query = query.filter(BillingNote.customer_id == customer_id)
    if params.search:
        pattern = f"%{params.search}%"
        query = query.filter(or_(
            BillingNote.billing_number.ilike(pattern),
            BillingNote.customer_id.in_(select(Customer.id).where(Customer.customer_name.ilike(pattern))),
        ))
    ordering = resolve_ordering(params, {
        "id": BillingNote.id,
        "created_at": BillingNote.created_at,
        "issue_date": BillingNote.issue_date,
        "billing_number": BillingNote.billing_number,
        "total_amount": BillingNote.total_amount,
        "status": BillingNote.status,
    }, "created_at", BillingNote.id)
    items, total = paginate(query, params, ordering)
    customer_ids = {n.customer_id for n in items}
    names = dict(db.execute(select(Customer.id, Customer.customer_name)
                            .where(Customer.id.in_(customer_ids))).all()) if customer_ids else {}
    note_ids = [n.id for n in items]
    counts = dict(db.execute(select(BillingNoteItem.billing_note_id, func.count())
                             .where(BillingNoteItem.billing_note_id.in_(note_ids))
                             .group_by(BillingNoteItem.billing_note_id)).all()) if note_ids else {}
    rows = [_billing_summary(n, names.get(n.customer_id), counts.get(n.id, 0)) for n in items]
    return paginated_body(rows, total, params, "Billing notes retrieved")


def _fill_billing(db: Session, note: BillingNote, invoice_ids: list[int]) -> None:
    """(Re)build the lines from the invoices' current balances, keeping the given order."""
    invoices = {i.id: i for i in db.execute(select(Invoice).where(Invoice.id.in_(invoice_ids))).scalars()}
    note.items.clear()
    db.flush()
    total = ZERO
    for number, invoice_id in enumerate(invoice_ids, start=1):
        invoice = invoices.get(invoice_id)
        if invoice is None:
            _error(f"Invoice {invoice_id} not found", status.HTTP_404_NOT_FOUND)
        balance = _open_invoice(invoice, note.customer_id, db)
        note.items.append(BillingNoteItem(line_no=number, invoice_id=invoice.id, amount=balance))
        total += balance
    note.total_amount = total


def _check_due(due: date | None, today: date) -> None:
    if due is not None and due < today:
        _invalid("The payment due date can't be before today")


def create_billing_service(db: Session, data: BillingNoteInput, user: User) -> dict:
    with UnitOfWork(db):
        customer = db.get(Customer, data.customer_id)
        if customer is None:
            _error("Customer not found", status.HTTP_404_NOT_FOUND)
        _check_due(data.payment_due_date, _today())
        note = BillingNote(status="DRAFT", customer_id=customer.id, payment_due_date=data.payment_due_date,
                           notes=(data.notes or "").strip() or None, created_by_user_id=user.id)
        db.add(note)
        db.flush()
        _fill_billing(db, note, data.invoice_ids)
        _audit(db, "billing_notes", note.id, f"draft #{note.id}", note.status, user, "CREATE_BILLING_NOTE",
               f"{len(data.invoice_ids)} invoices")
    db.refresh(note)
    return billing_detail(db, note)


def _locked_draft(db: Session, note_id: int, *states: str) -> BillingNote:
    note = _lock(db, BillingNote, note_id, "Billing note")
    if note.status not in states:
        _error(f"Billing note is {note.status}; this action needs {' or '.join(states)}")
    return note


def update_billing_service(db: Session, note_id: int, data: BillingNoteInput, user: User) -> dict:
    with UnitOfWork(db):
        note = _locked_draft(db, note_id, "DRAFT")
        if data.customer_id != note.customer_id:
            _invalid("A billing note can't move to another customer")
        _check_due(data.payment_due_date, _today())
        note.payment_due_date = data.payment_due_date
        note.notes = (data.notes or "").strip() or None
        _fill_billing(db, note, data.invoice_ids)
        note.updated_at = func.now()
        _audit(db, "billing_notes", note.id, f"draft #{note.id}", note.status, user, "UPDATE_BILLING_NOTE")
    db.refresh(note)
    return billing_detail(db, note)


def delete_billing_service(db: Session, note_id: int, user: User) -> dict:
    with UnitOfWork(db):
        note = _locked_draft(db, note_id, "DRAFT")
        _audit(db, "billing_notes", note.id, f"draft #{note.id}", note.status, user, "DELETE_BILLING_NOTE",
               "Draft deleted")
        db.delete(note)
    return {"id": note_id, "deleted": True}


def issue_billing_service(db: Session, note_id: int, user: User) -> dict:
    with UnitOfWork(db):
        note = _locked_draft(db, note_id, "DRAFT")
        today = _today()
        _check_due(note.payment_due_date, today)
        _fill_billing(db, note, [item.invoice_id for item in note.items])  # balances as of now
        note.billing_number = allocate_number(db, BILLING_DOC, today)
        note.status = "ISSUED"
        note.issue_date = today
        note.seller_snapshot = quotation_service._seller_snapshot(db)
        note.customer_snapshot = quotation_service._customer_snapshot(db.get(Customer, note.customer_id))
        note.issued_at = func.now()
        note.issued_by_user_id = user.id
        note.updated_at = func.now()
        _audit(db, "billing_notes", note.id, note.billing_number, note.status, user, "ISSUE_BILLING_NOTE",
               f"Total {note.total_amount}")
    db.refresh(note)
    return billing_detail(db, note)


def void_billing_service(db: Session, note_id: int, reason: str, user: User) -> dict:
    with UnitOfWork(db):
        note = _locked_draft(db, note_id, "ISSUED")
        note.status = "VOID"
        note.void_reason = reason
        note.voided_at = func.now()
        note.voided_by_user_id = user.id
        note.updated_at = func.now()
        _audit(db, "billing_notes", note.id, note.billing_number, note.status, user, "VOID_BILLING_NOTE",
               f"Reason: {reason}")
    db.refresh(note)
    return billing_detail(db, note)


# ================================================================ AR aging


def _bucket(days_past_due: int) -> str:
    if days_past_due <= 0:
        return "not_due"
    if days_past_due <= 30:
        return "days_1_30"
    if days_past_due <= 60:
        return "days_31_60"
    if days_past_due <= 90:
        return "days_61_90"
    return "days_over_90"


def ar_aging_service(db: Session, as_of: date | None = None) -> dict:
    """Outstanding balance per customer, by days past due on ``as_of`` (default today)."""
    as_of = as_of or _today()
    balance = invoice_service.balance_expression().label("balance")
    rows = db.execute(
        select(Invoice.id, Invoice.customer_id, Invoice.due_date, Invoice.customer_snapshot, balance)
        .where(Invoice.status == "ISSUED", invoice_service.balance_expression() > 0)
    ).all()
    names = dict(db.execute(select(Customer.id, Customer.customer_name)
                            .where(Customer.id.in_({r.customer_id for r in rows}))).all()) if rows else {}
    by_customer: dict[int, dict] = {}
    for row in rows:
        entry = by_customer.setdefault(row.customer_id, {
            "customer_id": row.customer_id,
            "customer_name": (row.customer_snapshot or {}).get("name") or names.get(row.customer_id),
            **{bucket: ZERO for bucket in AGING_BUCKETS},
            "total": ZERO,
            "invoice_count": 0,
            "oldest_due_date": None,
        })
        days = (as_of - row.due_date).days if row.due_date else 0
        amount = Decimal(row.balance).quantize(Decimal("0.01"))
        entry[_bucket(days)] += amount
        entry["total"] += amount
        entry["invoice_count"] += 1
        if row.due_date and (entry["oldest_due_date"] is None or row.due_date < entry["oldest_due_date"]):
            entry["oldest_due_date"] = row.due_date
    customers = sorted(by_customer.values(), key=lambda e: (-e["total"], e["customer_name"] or ""))
    totals = {bucket: sum((c[bucket] for c in customers), ZERO) for bucket in (*AGING_BUCKETS, "total")}
    totals["invoice_count"] = sum(c["invoice_count"] for c in customers)
    return phase8_json({"as_of": as_of, "buckets": list(AGING_BUCKETS), "rows": customers, "totals": totals})


_AGING_HEADERS = {
    "en": ["Customer", "Invoices", "Not yet due", "1-30 days", "31-60 days", "61-90 days", "Over 90 days", "Total"],
    "th": ["ลูกค้า", "จำนวนใบ", "ยังไม่ถึงกำหนด", "1-30 วัน", "31-60 วัน", "61-90 วัน", "เกิน 90 วัน", "รวม"],
}


def ar_aging_xlsx(db: Session, as_of: date | None, lang: str) -> bytes:
    report = ar_aging_service(db, as_of)
    wb = Workbook()
    ws = wb.active
    ws.title = "AR aging"
    ws.append([("ลูกหนี้ค้างชำระ ณ วันที่" if lang == "th" else "Accounts receivable aging as of"),
               report["as_of"]])
    ws.append(_AGING_HEADERS[lang])
    for cell in ws[2]:
        cell.font = Font(bold=True)
    for row in report["rows"]:
        ws.append([row["customer_name"], row["invoice_count"],
                   *[float(Decimal(row[b])) for b in AGING_BUCKETS], float(Decimal(row["total"]))])
    totals = report["totals"]
    ws.append(["รวม" if lang == "th" else "Total", totals["invoice_count"],
               *[float(Decimal(totals[b])) for b in AGING_BUCKETS], float(Decimal(totals["total"]))])
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)
    for column in "CDEFGH":
        for cell in ws[column][2:]:
            cell.number_format = "#,##0.00"
        ws.column_dimensions[column].width = 15
    ws.column_dimensions["A"].width = 36
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
