from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from datetime import date, timedelta
from app.models import Product, SalesOrder, StockTransaction, ProductBatch

from fastapi.responses import FileResponse
from openpyxl import Workbook
import os

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/stock-balance")
def stock_balance(db: Session = Depends(get_db)):
    products = db.query(Product).filter(
        Product.is_active == True
    ).all()

    return [
        {
            "product_id": p.id,
            "sku": p.sku,
            "product_name": p.product_name,
            "stock_qty": p.stock_qty,
            "price": float(p.price),
            "stock_value": float(p.price) * p.stock_qty,
            "category_id": p.category_id,
        }
        for p in products
    ]


@router.get("/sales-summary")
def sales_summary(db: Session = Depends(get_db)):
    total_orders = db.query(SalesOrder).count()

    total_sales_amount = db.query(
        func.coalesce(func.sum(SalesOrder.total_amount), 0)
    ).scalar()

    return {
        "total_orders": total_orders,
        "total_sales_amount": float(total_sales_amount)
    }


@router.get("/stock-movement")
def stock_movement(db: Session = Depends(get_db)):
    transactions = db.query(StockTransaction).order_by(
        StockTransaction.created_at.desc()
    ).all()

    return transactions

@router.get("/low-stock")
def low_stock_report(
    threshold: int = 10,
    db: Session = Depends(get_db)
):
    products = db.query(Product).filter(
        Product.is_active == True,
        Product.stock_qty <= threshold
    ).all()

    return [
        {
            "product_id": p.id,
            "sku": p.sku,
            "product_name": p.product_name,
            "stock_qty": p.stock_qty,
            "threshold": threshold
        }
        for p in products
    ]

@router.get("/expiring")
def expiring_report(
    days: int = 90,
    db: Session = Depends(get_db)
):
    today = date.today()
    target_date = today + timedelta(days=days)

    batches = db.query(ProductBatch).filter(
        ProductBatch.quantity > 0,
        ProductBatch.expiry_date <= target_date
    ).order_by(
        ProductBatch.expiry_date.asc()
    ).all()

    return [
        {
            "batch_id": b.id,
            "product_id": b.product_id,
            "lot_no": b.lot_no,
            "quantity": b.quantity,
            "mfg_date": b.mfg_date,
            "expiry_date": b.expiry_date,
            "days_left": (b.expiry_date - today).days
        }
        for b in batches
    ]

@router.get("/chart/sales")
def sales_chart(db: Session = Depends(get_db)):
    data = db.query(
        func.date(SalesOrder.created_at).label("date"),
        func.count(SalesOrder.id).label("orders"),
        func.coalesce(func.sum(SalesOrder.total_amount), 0).label("sales")
    ).group_by(
        func.date(SalesOrder.created_at)
    ).order_by(
        func.date(SalesOrder.created_at)
    ).all()

    return [
        {
            "date": str(row.date),
            "orders": row.orders,
            "sales": float(row.sales)
        }
        for row in data
    ]


@router.get("/chart/stock")
def stock_chart(db: Session = Depends(get_db)):
    products = db.query(Product).filter(
        Product.is_active == True
    ).order_by(
        Product.stock_qty.desc()
    ).all()

    return [
        {
            "product_name": p.product_name,
            "stock_qty": p.stock_qty
        }
        for p in products
    ]


@router.get("/chart/expiry")
def expiry_chart(db: Session = Depends(get_db)):
    batches = db.query(ProductBatch).filter(
        ProductBatch.quantity > 0
    ).order_by(
        ProductBatch.expiry_date.asc()
    ).all()

    return [
        {
            "lot_no": b.lot_no,
            "quantity": b.quantity,
            "expiry_date": str(b.expiry_date)
        }
        for b in batches
    ]

@router.get("/export/stock")
def export_stock_report(
    db: Session = Depends(get_db)
):

    products = db.query(Product).filter(
        Product.is_active == True
    ).all()

    os.makedirs(
        "exports",
        exist_ok=True
    )

    file_path = "exports/stock_report.xlsx"

    wb = Workbook()
    ws = wb.active

    ws.title = "Stock Report"

    ws.append([
        "Product ID",
        "SKU",
        "Product Name",
        "Stock Qty",
        "Price",
        "Stock Value"
    ])

    for p in products:

        ws.append([
            p.id,
            p.sku,
            p.product_name,
            p.stock_qty,
            float(p.price),
            float(p.price) * p.stock_qty
        ])

    wb.save(file_path)

    return FileResponse(
        file_path,
        filename="stock_report.xlsx"
    )

@router.get("/export/sales")
def export_sales_report(
    db: Session = Depends(get_db)
):

    orders = db.query(SalesOrder).all()

    os.makedirs(
        "exports",
        exist_ok=True
    )

    file_path = "exports/sales_report.xlsx"

    wb = Workbook()
    ws = wb.active

    ws.title = "Sales Report"

    ws.append([
        "SO Number",
        "Customer ID",
        "Status",
        "Total Amount",
        "Created At"
    ])

    for so in orders:

        ws.append([
            so.so_number,
            so.customer_id,
            so.status,
            float(so.total_amount),
            str(so.created_at)
        ])

    wb.save(file_path)

    return FileResponse(
        file_path,
        filename="sales_report.xlsx"
    )

@router.get("/export/low-stock")
def export_low_stock_report(
    threshold: int = 10,
    db: Session = Depends(get_db)
):
    products = db.query(Product).filter(
        Product.is_active == True,
        Product.stock_qty <= threshold
    ).all()

    os.makedirs("exports", exist_ok=True)
    file_path = "exports/low_stock_report.xlsx"

    wb = Workbook()
    ws = wb.active
    ws.title = "Low Stock Report"

    ws.append([
        "Product ID",
        "SKU",
        "Product Name",
        "Stock Qty",
        "Threshold"
    ])

    for p in products:
        ws.append([
            p.id,
            p.sku,
            p.product_name,
            p.stock_qty,
            threshold
        ])

    wb.save(file_path)

    return FileResponse(
        file_path,
        filename="low_stock_report.xlsx"
    )


@router.get("/export/expiring")
def export_expiring_report(
    days: int = 90,
    db: Session = Depends(get_db)
):
    today = date.today()
    target_date = today + timedelta(days=days)

    batches = db.query(ProductBatch).filter(
        ProductBatch.quantity > 0,
        ProductBatch.expiry_date <= target_date
    ).order_by(
        ProductBatch.expiry_date.asc()
    ).all()

    os.makedirs("exports", exist_ok=True)
    file_path = "exports/expiring_report.xlsx"

    wb = Workbook()
    ws = wb.active
    ws.title = "Expiring Report"

    ws.append([
        "Batch ID",
        "Product ID",
        "Lot No",
        "Quantity",
        "MFG Date",
        "Expiry Date",
        "Days Left"
    ])

    for b in batches:
        ws.append([
            b.id,
            b.product_id,
            b.lot_no,
            b.quantity,
            str(b.mfg_date),
            str(b.expiry_date),
            (b.expiry_date - today).days
        ])

    wb.save(file_path)

    return FileResponse(
        file_path,
        filename="expiring_report.xlsx"
    )