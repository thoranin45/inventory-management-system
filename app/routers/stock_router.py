from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Product, StockTransaction, ProductBatch
from app.schemas.stock_schema import StockIn, StockOut, StockAdjust
from app.core.dependencies import require_warehouse

router = APIRouter(prefix="/stock", tags=["Stock"])


@router.post("/in")
def stock_in(
    data: StockIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_warehouse),
):
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.is_active == True,
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        product.stock_qty += data.quantity

        transaction = StockTransaction(
            product_id=data.product_id,
            transaction_type="IN",
            quantity=data.quantity,
            remark=data.remark,
        )

        db.add(transaction)
        db.commit()
        db.refresh(product)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to stock in",
        )

    return {
        "message": "Stock In Success",
        "product_id": product.id,
        "product_name": product.product_name,
        "current_stock": product.stock_qty,
    }


@router.post("/out-fifo")
def stock_out_fifo(
    data: StockOut,
    db: Session = Depends(get_db),
    current_user=Depends(require_warehouse),
):
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.is_active == True,
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if product.stock_qty < data.quantity:
        raise HTTPException(status_code=400, detail="Not enough stock")

    try:
        remaining_qty = data.quantity

        batches = db.query(ProductBatch).filter(
            ProductBatch.product_id == data.product_id,
            ProductBatch.quantity > 0,
        ).order_by(
            ProductBatch.created_at.asc()
        ).all()

        for batch in batches:
            if remaining_qty <= 0:
                break

            if batch.quantity >= remaining_qty:
                batch.quantity -= remaining_qty
                remaining_qty = 0
            else:
                remaining_qty -= batch.quantity
                batch.quantity = 0

        if remaining_qty > 0:
            raise HTTPException(
                status_code=400,
                detail="Not enough batch stock",
            )

        product.stock_qty -= data.quantity

        transaction = StockTransaction(
            product_id=data.product_id,
            transaction_type="OUT_FIFO",
            quantity=data.quantity,
            remark=data.remark,
        )

        db.add(transaction)
        db.commit()
        db.refresh(product)

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to stock out FIFO",
        )

    return {
        "message": "Stock Out FIFO Success",
        "product_id": product.id,
        "product_name": product.product_name,
        "current_stock": product.stock_qty,
    }


@router.post("/out-fefo")
def stock_out_fefo(
    data: StockOut,
    db: Session = Depends(get_db),
    current_user=Depends(require_warehouse),
):
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.is_active == True,
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if product.stock_qty < data.quantity:
        raise HTTPException(status_code=400, detail="Not enough stock")

    try:
        remaining_qty = data.quantity

        batches = db.query(ProductBatch).filter(
            ProductBatch.product_id == data.product_id,
            ProductBatch.quantity > 0,
        ).order_by(
            ProductBatch.expiry_date.asc()
        ).all()

        for batch in batches:
            if remaining_qty <= 0:
                break

            if batch.quantity >= remaining_qty:
                batch.quantity -= remaining_qty
                remaining_qty = 0
            else:
                remaining_qty -= batch.quantity
                batch.quantity = 0

        if remaining_qty > 0:
            raise HTTPException(
                status_code=400,
                detail="Not enough batch stock",
            )

        product.stock_qty -= data.quantity

        transaction = StockTransaction(
            product_id=data.product_id,
            transaction_type="OUT_FEFO",
            quantity=data.quantity,
            remark=data.remark,
        )

        db.add(transaction)
        db.commit()
        db.refresh(product)

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to stock out FEFO",
        )

    return {
        "message": "Stock Out FEFO Success",
        "product_id": product.id,
        "product_name": product.product_name,
        "current_stock": product.stock_qty,
    }


@router.post("/adjust")
def stock_adjust(
    data: StockAdjust,
    db: Session = Depends(get_db),
    current_user=Depends(require_warehouse),
):
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.is_active == True,
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if data.new_quantity < 0:
        raise HTTPException(
            status_code=400,
            detail="Stock cannot be negative",
        )

    try:
        difference = data.new_quantity - product.stock_qty
        product.stock_qty = data.new_quantity

        transaction = StockTransaction(
            product_id=data.product_id,
            transaction_type="ADJUST",
            quantity=difference,
            remark=data.remark,
        )

        db.add(transaction)
        db.commit()
        db.refresh(product)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to adjust stock",
        )

    return {
        "message": "Stock Adjust Success",
        "product_id": product.id,
        "product_name": product.product_name,
        "new_stock": product.stock_qty,
        "difference": difference,
    }


@router.get("/history")
def stock_history(db: Session = Depends(get_db)):
    return db.query(StockTransaction).order_by(
        StockTransaction.created_at.desc()
    ).all()