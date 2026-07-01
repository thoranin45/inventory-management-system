from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import Product, ProductBatch
from app.schemas.batch_schema import BatchCreate
from app.core.dependencies import require_warehouse

router = APIRouter(prefix="/batches", tags=["Batches"])


@router.post("/")
def create_batch(
    data: BatchCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_warehouse),
):
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.is_active == True,
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if data.expiry_date <= data.mfg_date:
        raise HTTPException(
            status_code=400,
            detail="Expiry date must be after manufacturing date",
        )

    try:
        batch = ProductBatch(
            product_id=data.product_id,
            lot_no=data.lot_no,
            mfg_date=data.mfg_date,
            expiry_date=data.expiry_date,
            quantity=data.quantity,
        )

        product.stock_qty += data.quantity

        db.add(batch)
        db.commit()
        db.refresh(batch)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Lot number already exists",
        )

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to create batch",
        )

    return {
        "message": "Batch Created",
        "batch_id": batch.id,
        "lot_no": batch.lot_no,
        "quantity": batch.quantity,
        "current_stock": product.stock_qty,
    }


@router.get("/")
def get_batches(db: Session = Depends(get_db)):
    return db.query(ProductBatch).all()


@router.get("/expiring")
def get_expiring_batches(db: Session = Depends(get_db)):
    return db.query(ProductBatch).order_by(
        ProductBatch.expiry_date.asc()
    ).all()