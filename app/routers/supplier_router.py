from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Supplier
from app.schemas.supplier_schema import SupplierCreate, SupplierUpdate
from app.core.dependencies import require_admin

router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


@router.post("/")
def create_supplier(
    data: SupplierCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    supplier = Supplier(
        supplier_name=data.supplier_name,
        contact_name=data.contact_name,
        phone=data.phone,
        email=data.email,
        address=data.address,
    )

    db.add(supplier)
    db.commit()
    db.refresh(supplier)

    return {
        "message": "Supplier Created",
        "id": supplier.id,
        "supplier_name": supplier.supplier_name,
    }


@router.get("/")
def get_suppliers(db: Session = Depends(get_db)):
    return db.query(Supplier).all()


@router.get("/{supplier_id}")
def get_supplier(supplier_id: int, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()

    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")

    return supplier


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()

    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.supplier_name = data.supplier_name
    supplier.contact_name = data.contact_name
    supplier.phone = data.phone
    supplier.email = data.email
    supplier.address = data.address

    db.commit()
    db.refresh(supplier)

    return {"message": "Supplier Updated", "id": supplier.id}


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()

    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")

    db.delete(supplier)
    db.commit()

    return {"message": "Supplier Deleted"}