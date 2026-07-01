from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog
from app.core.dependencies import require_admin

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("/")
def get_audit_logs(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    return db.query(AuditLog).order_by(
        AuditLog.created_at.desc()
    ).all()


@router.get("/{audit_id}")
def get_audit_log(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin)
):
    audit = db.query(AuditLog).filter(
        AuditLog.id == audit_id
    ).first()

    if audit is None:
        raise HTTPException(
            status_code=404,
            detail="Audit log not found"
        )

    return audit