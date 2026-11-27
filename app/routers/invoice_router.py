"""F2a: /api/v1/invoices and /api/v1/adjustment-notes (Admin only, including reads)."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.core.dependencies import DatabaseSession, require_admin
from app.core.exceptions import AppException
from app.core.pagination import ListParams, list_params
from app.models import AdjustmentNote, Invoice, Quotation, SalesOrder, SalesReturnReceipt, User
from app.schemas.invoice_schema import AdjustmentDraftInput, InvoiceDraftUpdate, InvoiceFromOrderInput, VoidInput
from app.services import invoice_service as service
from app.services.invoice_pdf import render_adjustment_pdf, render_invoice_pdf

PRINTABLE = {"ISSUED", "VOID"}

router = APIRouter(dependencies=[Depends(require_admin)], prefix="/invoices", tags=["Invoices"])
adjustment_router = APIRouter(dependencies=[Depends(require_admin)], prefix="/adjustment-notes",
                              tags=["Adjustment notes"])


def _ok(message: str, data) -> dict:
    return {"success": True, "message": message, "data": data}


def _pdf(content: bytes, number: str) -> Response:
    return Response(content=content, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{number}.pdf"',
        "Cache-Control": "no-store",
    })


# ---------------------------------------------------------------- invoices


@router.get("")
def list_invoices(
    db: DatabaseSession,
    params: ListParams = Depends(list_params),
    customer_id: int | None = Query(default=None, gt=0),
    sales_order_id: int | None = Query(default=None, gt=0),
):
    return service.list_invoices_service(db, params, customer_id, sales_order_id)


@router.get("/revenue-summary")
def revenue_summary(db: DatabaseSession, year: int | None = Query(default=None, ge=2000, le=9999)):
    return _ok("Revenue summary retrieved", service.revenue_summary_service(db, year))


@router.post("", status_code=201)
def create_invoice(data: InvoiceFromOrderInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Invoice draft ready", service.create_invoice_from_order_service(db, data.sales_order_id, user))


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, db: DatabaseSession):
    return _ok("Invoice retrieved", service.get_invoice_service(db, invoice_id))


@router.put("/{invoice_id}")
def update_invoice(invoice_id: int, data: InvoiceDraftUpdate, db: DatabaseSession,
                   user: User = Depends(require_admin)):
    return _ok("Invoice draft updated", service.update_invoice_service(db, invoice_id, data, user))


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Invoice draft deleted", service.delete_invoice_service(db, invoice_id, user))


@router.post("/{invoice_id}/issue")
def issue_invoice(invoice_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Invoice issued", service.issue_invoice_service(db, invoice_id, user))


@router.post("/{invoice_id}/void")
def void_invoice(invoice_id: int, data: VoidInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Invoice voided", service.void_invoice_service(db, invoice_id, data.reason, user))


@router.get("/{invoice_id}/pdf")
def invoice_pdf(invoice_id: int, db: DatabaseSession):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise AppException("Invoice not found", 404)
    if invoice.status not in PRINTABLE:
        raise AppException("Issue the invoice before printing it", 409)
    so_number = db.execute(select(SalesOrder.so_number).where(SalesOrder.id == invoice.sales_order_id)).scalar()
    qt_number = db.execute(select(Quotation.quotation_number).where(Quotation.id == invoice.quotation_id)).scalar() \
        if invoice.quotation_id else None
    return _pdf(render_invoice_pdf(invoice, so_number, qt_number), invoice.invoice_number)


# ---------------------------------------------------------------- adjustment notes


@adjustment_router.get("")
def list_notes(db: DatabaseSession, params: ListParams = Depends(list_params),
               invoice_id: int | None = Query(default=None, gt=0)):
    return service.list_notes_service(db, params, invoice_id)


@adjustment_router.post("", status_code=201)
def create_note(data: AdjustmentDraftInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Adjustment note draft created", service.create_note_service(db, data, user))


@adjustment_router.get("/{note_id}")
def get_note(note_id: int, db: DatabaseSession):
    return _ok("Adjustment note retrieved", service.get_note_service(db, note_id))


@adjustment_router.put("/{note_id}")
def update_note(note_id: int, data: AdjustmentDraftInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Adjustment note draft updated", service.update_note_service(db, note_id, data, user))


@adjustment_router.delete("/{note_id}")
def delete_note(note_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Adjustment note draft deleted", service.delete_note_service(db, note_id, user))


@adjustment_router.post("/{note_id}/issue")
def issue_note(note_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Adjustment note issued", service.issue_note_service(db, note_id, user))


@adjustment_router.post("/{note_id}/void")
def void_note(note_id: int, data: VoidInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Adjustment note voided", service.void_note_service(db, note_id, data.reason, user))


@adjustment_router.get("/{note_id}/pdf")
def note_pdf(note_id: int, db: DatabaseSession):
    note = db.get(AdjustmentNote, note_id)
    if note is None:
        raise AppException("Adjustment note not found", 404)
    if note.status not in PRINTABLE:
        raise AppException("Issue the adjustment note before printing it", 409)
    invoice = db.get(Invoice, note.invoice_id)
    receipt_number = db.execute(
        select(SalesReturnReceipt.receipt_number).where(SalesReturnReceipt.id == note.sales_return_receipt_id)
    ).scalar() if note.sales_return_receipt_id else None
    return _pdf(render_adjustment_pdf(note, invoice, receipt_number), note.adjustment_number)
