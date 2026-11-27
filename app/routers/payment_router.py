"""F3a: /api/v1/payment-receipts and /api/v1/billing-notes (Admin only, including reads).

The AR aging report lives under /api/v1/invoices/ar-aging (invoice_router).
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.core.dependencies import DatabaseSession, require_admin
from app.core.exceptions import AppException
from app.core.pagination import ListParams, list_params
from app.models import BillingNote, Invoice, PaymentReceipt, User
from app.schemas.invoice_schema import VoidInput
from app.schemas.payment_schema import BillingNoteInput, PaymentReceiptInput
from app.services import payment_service as service
from app.services.payment_pdf import render_billing_pdf, render_receipt_pdf

receipt_router = APIRouter(dependencies=[Depends(require_admin)], prefix="/payment-receipts",
                           tags=["Payment receipts"])
billing_router = APIRouter(dependencies=[Depends(require_admin)], prefix="/billing-notes", tags=["Billing notes"])


def _ok(message: str, data) -> dict:
    return {"success": True, "message": message, "data": data}


def _pdf(content: bytes, number: str) -> Response:
    return Response(content=content, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{number}.pdf"',
        "Cache-Control": "no-store",
    })


# ---------------------------------------------------------------- receipts


@receipt_router.get("")
def list_receipts(db: DatabaseSession, params: ListParams = Depends(list_params),
                  customer_id: int | None = Query(default=None, gt=0),
                  invoice_id: int | None = Query(default=None, gt=0)):
    return service.list_receipts_service(db, params, customer_id, invoice_id)


@receipt_router.post("", status_code=201)
def create_receipt(data: PaymentReceiptInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Receipt recorded", service.create_receipt_service(db, data, user))


@receipt_router.get("/{receipt_id}")
def get_receipt(receipt_id: int, db: DatabaseSession):
    return _ok("Receipt retrieved", service.get_receipt_service(db, receipt_id))


@receipt_router.post("/{receipt_id}/void")
def void_receipt(receipt_id: int, data: VoidInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Receipt voided", service.void_receipt_service(db, receipt_id, data.reason, user))


@receipt_router.get("/{receipt_id}/pdf")
def receipt_pdf(receipt_id: int, db: DatabaseSession):
    receipt = db.get(PaymentReceipt, receipt_id)
    if receipt is None:
        raise AppException("Receipt not found", 404)
    ids = [a.invoice_id for a in receipt.allocations]
    rows = db.execute(select(Invoice.id, Invoice.invoice_number, Invoice.issue_date)
                      .where(Invoice.id.in_(ids))).all() if ids else []
    return _pdf(render_receipt_pdf(receipt, {r.id: r.invoice_number for r in rows},
                                   {r.id: r.issue_date for r in rows}), receipt.receipt_number)


# ---------------------------------------------------------------- billing notes


@billing_router.get("")
def list_billing(db: DatabaseSession, params: ListParams = Depends(list_params),
                 customer_id: int | None = Query(default=None, gt=0)):
    return service.list_billing_service(db, params, customer_id)


@billing_router.post("", status_code=201)
def create_billing(data: BillingNoteInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Billing note draft created", service.create_billing_service(db, data, user))


@billing_router.get("/{note_id}")
def get_billing(note_id: int, db: DatabaseSession):
    return _ok("Billing note retrieved", service.get_billing_service(db, note_id))


@billing_router.put("/{note_id}")
def update_billing(note_id: int, data: BillingNoteInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Billing note draft updated", service.update_billing_service(db, note_id, data, user))


@billing_router.delete("/{note_id}")
def delete_billing(note_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Billing note draft deleted", service.delete_billing_service(db, note_id, user))


@billing_router.post("/{note_id}/issue")
def issue_billing(note_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Billing note issued", service.issue_billing_service(db, note_id, user))


@billing_router.post("/{note_id}/void")
def void_billing(note_id: int, data: VoidInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Billing note voided", service.void_billing_service(db, note_id, data.reason, user))


@billing_router.get("/{note_id}/pdf")
def billing_pdf(note_id: int, db: DatabaseSession):
    note = db.get(BillingNote, note_id)
    if note is None:
        raise AppException("Billing note not found", 404)
    if note.status not in {"ISSUED", "VOID"}:
        raise AppException("Issue the billing note before printing it", 409)
    ids = [i.invoice_id for i in note.items]
    invoices = {i.id: i for i in db.execute(select(Invoice).where(Invoice.id.in_(ids))).scalars()} if ids else {}
    return _pdf(render_billing_pdf(note, invoices), note.billing_number)
