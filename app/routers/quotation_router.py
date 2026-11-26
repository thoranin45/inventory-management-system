"""F1a: /api/v1/quotations (Admin only, including reads)."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.core.dependencies import DatabaseSession, require_admin
from app.core.exceptions import AppException
from app.core.pagination import ListParams, list_params
from app.models import Quotation, User
from app.schemas.quotation_schema import QuotationDraftInput, QuotationVoidInput
from app.services import quotation_service as service
from app.services.quotation_pdf import render_quotation_pdf

router = APIRouter(
    dependencies=[Depends(require_admin)],
    prefix="/quotations",
    tags=["Quotations"],
)

PRINTABLE = {"ISSUED", "ACCEPTED", "REJECTED", "CONVERTED", "VOID"}


def _ok(message: str, data) -> dict:
    return {"success": True, "message": message, "data": data}


@router.get("")
def list_quotations(
    db: DatabaseSession,
    params: ListParams = Depends(list_params),
    customer_id: int | None = Query(default=None, gt=0),
):
    return service.list_quotations_service(db, params, customer_id)


@router.post("", status_code=201)
def create_quotation(data: QuotationDraftInput, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation draft created", service.create_quotation_service(db, data, user))


@router.get("/{quotation_id}")
def get_quotation(quotation_id: int, db: DatabaseSession):
    return _ok("Quotation retrieved", service.get_quotation_service(db, quotation_id))


@router.put("/{quotation_id}")
def update_quotation(quotation_id: int, data: QuotationDraftInput, db: DatabaseSession,
                     user: User = Depends(require_admin)):
    return _ok("Quotation draft updated", service.update_quotation_service(db, quotation_id, data, user))


@router.delete("/{quotation_id}")
def delete_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation draft deleted", service.delete_quotation_service(db, quotation_id, user))


@router.post("/{quotation_id}/issue")
def issue_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation issued", service.issue_quotation_service(db, quotation_id, user))


@router.post("/{quotation_id}/accept")
def accept_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation accepted", service.accept_quotation_service(db, quotation_id, user))


@router.post("/{quotation_id}/reject")
def reject_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation rejected", service.reject_quotation_service(db, quotation_id, user))


@router.post("/{quotation_id}/void")
def void_quotation(quotation_id: int, data: QuotationVoidInput, db: DatabaseSession,
                   user: User = Depends(require_admin)):
    return _ok("Quotation voided", service.void_quotation_service(db, quotation_id, data.reason, user))


@router.post("/{quotation_id}/revise", status_code=201)
def revise_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation revision drafted", service.revise_quotation_service(db, quotation_id, user))


@router.post("/{quotation_id}/convert")
def convert_quotation(quotation_id: int, db: DatabaseSession, user: User = Depends(require_admin)):
    return _ok("Quotation converted to a sales order", service.convert_quotation_service(db, quotation_id, user))


@router.get("/{quotation_id}/pdf")
def quotation_pdf(quotation_id: int, db: DatabaseSession):
    quotation = db.get(Quotation, quotation_id)
    if quotation is None:
        raise AppException("Quotation not found", 404)
    if quotation.status not in PRINTABLE:
        raise AppException("Issue the quotation before printing it", 409)
    return Response(
        content=render_quotation_pdf(quotation),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{quotation.quotation_number}.pdf"',
            "Cache-Control": "no-store",
        },
    )
