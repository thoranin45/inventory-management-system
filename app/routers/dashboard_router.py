from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Product, StockTransaction, ProductBatch
from datetime import date, timedelta

router = APIRouter()


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    return {
        "total_products": db.query(Product).count(),
        "total_stock": db.query(func.coalesce(func.sum(Product.stock_qty), 0)).scalar(),
        "total_stock_in": db.query(func.coalesce(func.sum(StockTransaction.quantity), 0))
        .filter(StockTransaction.transaction_type == "IN")
        .scalar(),
        "total_stock_out": db.query(func.coalesce(func.sum(StockTransaction.quantity), 0))
        .filter(StockTransaction.transaction_type == "OUT")
        .scalar(),
        "low_stock_products": db.query(Product).filter(Product.stock_qty <= 10).count(),
    }


@router.get("/dashboard/low-stock")
def get_low_stock_products(db: Session = Depends(get_db)):
    return db.query(Product).filter(Product.stock_qty <= 10).all()


@router.get("/dashboard/recent-transactions")
def get_dashboard_recent_transactions(db: Session = Depends(get_db)):
    return db.query(StockTransaction).order_by(
        StockTransaction.created_at.desc()
    ).limit(10).all()


@router.get("/dashboard/stock-summary")
def get_stock_summary(db: Session = Depends(get_db)):
    products = db.query(Product).all()

    return [
        {
            "product_id": product.id,
            "sku": product.sku,
            "barcode": product.barcode,
            "product_name": product.product_name,
            "price": float(product.price),
            "stock_qty": product.stock_qty,
            "stock_value": float(product.price) * product.stock_qty,
        }
        for product in products
    ]


@router.get("/dashboard/top-stock")
def get_top_stock(db: Session = Depends(get_db)):
    return db.query(Product).order_by(Product.stock_qty.desc()).limit(10).all()


@router.get("/dashboard/stock-value")
def get_total_stock_value(db: Session = Depends(get_db)):
    products = db.query(Product).all()

    total_value = sum(
        float(product.price) * product.stock_qty
        for product in products
    )

    return {"total_stock_value": total_value}

@router.get("/dashboard/expiring-soon")
def expiring_soon(db: Session = Depends(get_db)):

    target_date = date.today() + timedelta(days=90)

    batches = db.query(ProductBatch).filter(
        ProductBatch.expiry_date <= target_date
    ).all()

    return batches

@router.get("/dashboard/expired")
def expired_batches(db: Session = Depends(get_db)):

    today = date.today()

    batches = db.query(ProductBatch).filter(
        ProductBatch.expiry_date < today
    ).all()

    return batches