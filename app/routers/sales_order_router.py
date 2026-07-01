from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db

from app.models import (
    Customer,
    Product,
    ProductBatch,
    SalesOrder,
    SalesOrderItem,
    SalesOrderBatchAllocation,
    StockTransaction,
    AuditLog,
)

from app.schemas.sales_order_schema import SalesOrderCreate
from app.schemas.sales_return_schema import SalesReturnCreate
from app.core.dependencies import require_admin
from app.core.response import success_response

from fastapi.responses import FileResponse
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

import os

router = APIRouter(prefix="/sales-orders", tags=["Sales Orders"])


@router.post("/")
def create_sales_order(
    data: SalesOrderCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        customer = db.query(Customer).filter(
            Customer.id == data.customer_id
        ).first()

        if customer is None:
            raise HTTPException(
                status_code=404,
                detail="Customer not found"
            )

        sales_order = SalesOrder(
            so_number="TEMP",
            customer_id=data.customer_id,
            status="CONFIRMED",
            total_amount=0,
        )

        db.add(sales_order)
        db.flush()

        sales_order.so_number = f"SO-{sales_order.id:06d}"

        total_amount = 0

        for item in data.items:
            product = db.query(Product).filter(
                Product.id == item.product_id,
                Product.is_active == True,
            ).first()

            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail="Product not found"
                )

            if product.stock_qty < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Not enough stock for {product.product_name}"
                )

            remaining_qty = item.quantity
            allocated_batches = []

            batches = db.query(ProductBatch).filter(
                ProductBatch.product_id == item.product_id,
                ProductBatch.quantity > 0,
            ).order_by(
                ProductBatch.expiry_date.asc()
            ).all()

            for batch in batches:
                if remaining_qty <= 0:
                    break

                deduct_qty = min(
                    batch.quantity,
                    remaining_qty
                )

                batch.quantity -= deduct_qty
                remaining_qty -= deduct_qty

                allocated_batches.append({
                    "batch": batch,
                    "quantity": deduct_qty
                })

            if remaining_qty > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Not enough batch stock for {product.product_name}"
                )

            item_total = item.quantity * item.unit_price
            total_amount += item_total

            product.stock_qty -= item.quantity

            so_item = SalesOrderItem(
                sales_order_id=sales_order.id,
                product_id=item.product_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                total_price=item_total,
            )

            db.add(so_item)
            db.flush()

            for allocated in allocated_batches:
                allocation = SalesOrderBatchAllocation(
                    sales_order_id=sales_order.id,
                    sales_order_item_id=so_item.id,
                    product_id=item.product_id,
                    batch_id=allocated["batch"].id,
                    quantity=allocated["quantity"],
                )

                db.add(allocation)

            transaction = StockTransaction(
                product_id=item.product_id,
                transaction_type="SALE_OUT_FEFO",
                quantity=item.quantity,
                remark=f"Sales Order {sales_order.so_number}",
            )

            db.add(transaction)

        sales_order.total_amount = total_amount

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_SALES_ORDER_FEFO",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=f"Create {sales_order.so_number} with FEFO allocation",
        )

        db.add(audit)
        db.commit()
        db.refresh(sales_order)

        return success_response(
            "Sales Order Created",
            {
                "sales_order_id": sales_order.id,
                "so_number": sales_order.so_number,
                "total_amount": float(sales_order.total_amount),
            }
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to create sales order"
        )

@router.get("/")
def get_sales_orders(db: Session = Depends(get_db)):
    return db.query(SalesOrder).all()


@router.get("/{sales_order_id}")
def get_sales_order(
    sales_order_id: int,
    db: Session = Depends(get_db),
):
    sales_order = db.query(SalesOrder).filter(
        SalesOrder.id == sales_order_id
    ).first()

    if sales_order is None:
        raise HTTPException(status_code=404, detail="Sales Order not found")

    items = db.query(SalesOrderItem).filter(
        SalesOrderItem.sales_order_id == sales_order.id
    ).all()

    return {
        "id": sales_order.id,
        "so_number": sales_order.so_number,
        "customer_id": sales_order.customer_id,
        "status": sales_order.status,
        "total_amount": float(sales_order.total_amount),
        "created_at": sales_order.created_at,
        "items": items,
    }


@router.get("/{sales_order_id}/invoice")
def generate_invoice(
    sales_order_id: int,
    db: Session = Depends(get_db),
):
    sales_order = db.query(SalesOrder).filter(
        SalesOrder.id == sales_order_id
    ).first()

    if sales_order is None:
        raise HTTPException(status_code=404, detail="Sales Order not found")

    customer = db.query(Customer).filter(
        Customer.id == sales_order.customer_id
    ).first()

    items = db.query(SalesOrderItem).filter(
        SalesOrderItem.sales_order_id == sales_order.id
    ).all()

    os.makedirs("app/static/invoices", exist_ok=True)

    pdf_path = f"app/static/invoices/{sales_order.so_number}.pdf"

    doc = SimpleDocTemplate(pdf_path)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph("INVOICE", styles["Title"]))
    elements.append(Spacer(1, 12))

    elements.append(Paragraph(f"Invoice No: {sales_order.so_number}", styles["Normal"]))
    elements.append(Paragraph(f"Customer: {customer.customer_name if customer else '-'}", styles["Normal"]))
    elements.append(Paragraph(f"Date: {sales_order.created_at}", styles["Normal"]))
    elements.append(Spacer(1, 12))

    table_data = [["Product", "Qty", "Unit Price", "Total"]]

    for item in items:
        product = db.query(Product).filter(
            Product.id == item.product_id
        ).first()

        table_data.append([
            product.product_name if product else "-",
            item.quantity,
            float(item.unit_price),
            float(item.total_price),
        ])

    table_data.append([
        "",
        "",
        "Grand Total",
        float(sales_order.total_amount),
    ])

    table = Table(table_data)

    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("GRID", (0, 0), (-1, -1), 1, colors.black),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ]))

    elements.append(table)
    doc.build(elements)

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{sales_order.so_number}.pdf",
    )


@router.put("/{sales_order_id}/cancel")
def cancel_sales_order(
    sales_order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        sales_order = db.query(SalesOrder).filter(
            SalesOrder.id == sales_order_id
        ).first()

        if sales_order is None:
            raise HTTPException(
                status_code=404,
                detail="Sales Order not found",
            )

        if sales_order.status == "CANCELLED":
            raise HTTPException(
                status_code=400,
                detail="Sales Order already cancelled",
            )

        items = db.query(SalesOrderItem).filter(
            SalesOrderItem.sales_order_id == sales_order.id
        ).all()

        for item in items:
            product = db.query(Product).filter(
                Product.id == item.product_id
            ).first()

            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {item.product_id}",
                )

            product.stock_qty += item.quantity

            batch = db.query(ProductBatch).filter(
                ProductBatch.product_id == item.product_id
            ).order_by(
                ProductBatch.expiry_date.asc()
            ).first()

            if batch:
                batch.quantity += item.quantity

            transaction = StockTransaction(
                product_id=item.product_id,
                transaction_type="SALE_CANCEL",
                quantity=item.quantity,
                remark=f"Cancel {sales_order.so_number}",
            )

            db.add(transaction)

        sales_order.status = "CANCELLED"

        audit = AuditLog(
            username=current_user.username,
            action="CANCEL_SALES_ORDER",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=f"Cancel {sales_order.so_number}",
        )

        db.add(audit)
        db.commit()

        return {
            "message": "Sales Order Cancelled",
            "so_number": sales_order.so_number,
        }

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to cancel sales order",
        )
    
@router.post("/{sales_order_id}/return")
def return_sales_order_items(
    sales_order_id: int,
    data: SalesReturnCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        sales_order = db.query(SalesOrder).filter(
            SalesOrder.id == sales_order_id
        ).first()

        if sales_order is None:
            raise HTTPException(
                status_code=404,
                detail="Sales Order not found"
            )

        if sales_order.status == "CANCELLED":
            raise HTTPException(
                status_code=400,
                detail="Cannot return cancelled sales order"
            )

        returned_count = 0

        for return_item in data.items:
            sold_item = db.query(SalesOrderItem).filter(
                SalesOrderItem.sales_order_id == sales_order.id,
                SalesOrderItem.product_id == return_item.product_id
            ).first()

            if sold_item is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Product {return_item.product_id} not found in this sales order"
                )

            if return_item.quantity > sold_item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail="Return quantity cannot be greater than sold quantity"
                )

            product = db.query(Product).filter(
                Product.id == return_item.product_id,
                Product.is_active == True
            ).first()

            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail="Product not found"
                )

            product.stock_qty += return_item.quantity

            batch = db.query(ProductBatch).filter(
                ProductBatch.product_id == return_item.product_id
            ).order_by(
                ProductBatch.expiry_date.asc()
            ).first()

            if batch:
                batch.quantity += return_item.quantity

            transaction = StockTransaction(
                product_id=return_item.product_id,
                transaction_type="SALE_RETURN",
                quantity=return_item.quantity,
                remark=(
                    f"Return from {sales_order.so_number}. "
                    f"Reason: {return_item.reason}"
                )
            )

            db.add(transaction)
            returned_count += 1

        audit = AuditLog(
            username=current_user.username,
            action="SALES_RETURN",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=f"Return items from {sales_order.so_number}"
        )

        db.add(audit)
        db.commit()

        return success_response(
            "Sales return completed",
            {
                "sales_order_id": sales_order.id,
                "so_number": sales_order.so_number,
                "returned_items": returned_count
            }
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to return sales order items"
        )