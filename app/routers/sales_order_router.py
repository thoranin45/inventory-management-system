import os
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from fastapi.responses import FileResponse
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.dependencies import require_admin
from app.core.response import success_response
from app.database import get_db
from app.models import (
    AuditLog,
    Customer,
    Product,
    ProductBatch,
    SalesOrder,
    SalesOrderBatchAllocation,
    SalesOrderItem,
    StockTransaction,
)
from app.schemas.sales_order_schema import (
    SalesOrderCreate,
)
from app.schemas.sales_return_schema import (
    SalesReturnCreate,
)


router = APIRouter(
    prefix="/sales-orders",
    tags=["Sales Orders"],
)


def _get_sales_order(
    db: Session,
    sales_order_id: int,
) -> SalesOrder:
    sales_order = (
        db.query(SalesOrder)
        .filter(
            SalesOrder.id == sales_order_id
        )
        .first()
    )

    if sales_order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales Order not found",
        )

    return sales_order


def _get_order_items(
    db: Session,
    sales_order_id: int,
) -> list[SalesOrderItem]:
    return (
        db.query(SalesOrderItem)
        .filter(
            SalesOrderItem.sales_order_id
            == sales_order_id
        )
        .order_by(
            SalesOrderItem.id.asc()
        )
        .all()
    )


def _get_item_allocations(
    db: Session,
    sales_order_id: int,
    sales_order_item_id: int,
) -> list[SalesOrderBatchAllocation]:
    return (
        db.query(SalesOrderBatchAllocation)
        .filter(
            SalesOrderBatchAllocation.sales_order_id
            == sales_order_id,
            SalesOrderBatchAllocation.sales_order_item_id
            == sales_order_item_id,
        )
        .order_by(
            SalesOrderBatchAllocation.id.asc()
        )
        .all()
    )


def _get_returned_quantity(
    db: Session,
    sales_order: SalesOrder,
    product_id: int,
) -> int:
    """
    คำนวณยอดที่เคย Return ไปแล้วจาก StockTransaction

    เนื่องจาก Model ปัจจุบันยังไม่มีตาราง
    sales_returns และ sales_return_items
    จึงอ้างอิง transaction_type และ remark
    ของ Sales Order นี้ก่อน
    """

    returned_quantity = (
        db.query(
            func.coalesce(
                func.sum(StockTransaction.quantity),
                0,
            )
        )
        .filter(
            StockTransaction.product_id
            == product_id,
            StockTransaction.transaction_type
            == "SALE_RETURN",
            StockTransaction.remark.startswith(
                f"Return from {sales_order.so_number}."
            ),
        )
        .scalar()
    )

    return int(returned_quantity or 0)


def _restore_quantity_to_allocated_batches(
    db: Session,
    allocations: list[SalesOrderBatchAllocation],
    previously_returned: int,
    return_quantity: int,
) -> None:
    """
    คืนสินค้ากลับเข้า Batch เดิมตาม Allocation ตอนขาย

    previously_returned:
        จำนวนที่เคยคืนไปก่อนหน้านี้

    return_quantity:
        จำนวนที่จะคืนใน request ปัจจุบัน
    """

    remaining_previous = previously_returned
    remaining_return = return_quantity

    for allocation in allocations:
        allocation_quantity = allocation.quantity

        if remaining_previous >= allocation_quantity:
            remaining_previous -= allocation_quantity
            continue

        already_returned_in_allocation = remaining_previous
        remaining_previous = 0

        available_to_restore = (
            allocation_quantity
            - already_returned_in_allocation
        )

        quantity_to_restore = min(
            available_to_restore,
            remaining_return,
        )

        if quantity_to_restore <= 0:
            continue

        batch = (
            db.query(ProductBatch)
            .filter(
                ProductBatch.id
                == allocation.batch_id
            )
            .first()
        )

        if batch is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    "Allocated batch not found: "
                    f"{allocation.batch_id}"
                ),
            )

        batch.quantity += quantity_to_restore
        remaining_return -= quantity_to_restore

        if remaining_return <= 0:
            break

    if remaining_return > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Return quantity exceeds "
                "available batch allocation"
            ),
        )


@router.post("/")
def create_sales_order(
    data: SalesOrderCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        customer = (
            db.query(Customer)
            .filter(
                Customer.id == data.customer_id
            )
            .first()
        )

        if customer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Customer not found",
            )

        sales_order = SalesOrder(
            so_number="TEMP",
            customer_id=data.customer_id,
            status="CONFIRMED",
            total_amount=Decimal("0.00"),
        )

        db.add(sales_order)
        db.flush()

        sales_order.so_number = (
            f"SO-{sales_order.id:06d}"
        )

        total_amount = Decimal("0.00")

        for request_item in data.items:
            product = (
                db.query(Product)
                .filter(
                    Product.id
                    == request_item.product_id,
                    Product.is_active.is_(True),
                )
                .first()
            )

            if product is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "Product not found: "
                        f"{request_item.product_id}"
                    ),
                )

            if product.stock_qty < request_item.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Not enough stock for "
                        f"{product.product_name}"
                    ),
                )

            batches = (
                db.query(ProductBatch)
                .filter(
                    ProductBatch.product_id
                    == request_item.product_id,
                    ProductBatch.quantity > 0,
                )
                .order_by(
                    ProductBatch.expiry_date.asc(),
                    ProductBatch.created_at.asc(),
                    ProductBatch.id.asc(),
                )
                .all()
            )

            batch_stock_total = sum(
                batch.quantity
                for batch in batches
            )

            if batch_stock_total < request_item.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Not enough batch stock for "
                        f"{product.product_name}"
                    ),
                )

            item_total = (
                Decimal(request_item.quantity)
                * request_item.unit_price
            )

            total_amount += item_total

            sales_order_item = SalesOrderItem(
                sales_order_id=sales_order.id,
                product_id=request_item.product_id,
                quantity=request_item.quantity,
                unit_price=request_item.unit_price,
                total_price=item_total,
            )

            db.add(sales_order_item)
            db.flush()

            remaining_quantity = (
                request_item.quantity
            )

            for batch in batches:
                if remaining_quantity <= 0:
                    break

                deduct_quantity = min(
                    batch.quantity,
                    remaining_quantity,
                )

                batch.quantity -= deduct_quantity
                remaining_quantity -= deduct_quantity

                allocation = (
                    SalesOrderBatchAllocation(
                        sales_order_id=sales_order.id,
                        sales_order_item_id=(
                            sales_order_item.id
                        ),
                        product_id=request_item.product_id,
                        batch_id=batch.id,
                        quantity=deduct_quantity,
                    )
                )

                db.add(allocation)

            if remaining_quantity > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Not enough batch stock for "
                        f"{product.product_name}"
                    ),
                )

            product.stock_qty -= (
                request_item.quantity
            )

            transaction = StockTransaction(
                product_id=request_item.product_id,
                transaction_type="SALE_OUT_FEFO",
                quantity=-request_item.quantity,
                remark=(
                    f"Sales Order "
                    f"{sales_order.so_number}"
                ),
            )

            db.add(transaction)

        sales_order.total_amount = total_amount

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_SALES_ORDER_FEFO",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Create {sales_order.so_number} "
                "with FEFO allocation"
            ),
        )

        db.add(audit)
        db.commit()
        db.refresh(sales_order)

        return success_response(
            "Sales Order Created",
            {
                "sales_order_id": sales_order.id,
                "so_number": sales_order.so_number,
                "status": sales_order.status,
                "total_amount": float(
                    sales_order.total_amount
                ),
            },
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="Failed to create sales order",
        ) from exc


@router.get("/")
def get_sales_orders(
    db: Session = Depends(get_db),
):
    sales_orders = (
        db.query(SalesOrder)
        .order_by(
            SalesOrder.created_at.desc(),
            SalesOrder.id.desc(),
        )
        .all()
    )

    return success_response(
        "Sales Orders Retrieved",
        {
            "items": sales_orders,
        },
    )


@router.get("/{sales_order_id}")
def get_sales_order(
    sales_order_id: int,
    db: Session = Depends(get_db),
):
    sales_order = _get_sales_order(
        db=db,
        sales_order_id=sales_order_id,
    )

    items = _get_order_items(
        db=db,
        sales_order_id=sales_order.id,
    )

    item_results = []

    for item in items:
        allocations = _get_item_allocations(
            db=db,
            sales_order_id=sales_order.id,
            sales_order_item_id=item.id,
        )

        item_results.append(
            {
                "id": item.id,
                "sales_order_id": (
                    item.sales_order_id
                ),
                "product_id": item.product_id,
                "quantity": item.quantity,
                "unit_price": float(
                    item.unit_price
                ),
                "total_price": float(
                    item.total_price
                ),
                "batch_allocations": [
                    {
                        "id": allocation.id,
                        "batch_id": (
                            allocation.batch_id
                        ),
                        "quantity": (
                            allocation.quantity
                        ),
                    }
                    for allocation in allocations
                ],
            }
        )

    return success_response(
        "Sales Order Retrieved",
        {
            "id": sales_order.id,
            "so_number": sales_order.so_number,
            "customer_id": (
                sales_order.customer_id
            ),
            "status": sales_order.status,
            "total_amount": float(
                sales_order.total_amount
            ),
            "created_at": (
                sales_order.created_at
            ),
            "items": item_results,
        },
    )


@router.get("/{sales_order_id}/invoice")
def generate_invoice(
    sales_order_id: int,
    db: Session = Depends(get_db),
):
    sales_order = _get_sales_order(
        db=db,
        sales_order_id=sales_order_id,
    )

    customer = (
        db.query(Customer)
        .filter(
            Customer.id
            == sales_order.customer_id
        )
        .first()
    )

    items = _get_order_items(
        db=db,
        sales_order_id=sales_order.id,
    )

    invoice_directory = os.path.join(
        "app",
        "static",
        "invoices",
    )

    os.makedirs(
        invoice_directory,
        exist_ok=True,
    )

    pdf_path = os.path.join(
        invoice_directory,
        f"{sales_order.so_number}.pdf",
    )

    document = SimpleDocTemplate(
        pdf_path
    )

    styles = getSampleStyleSheet()
    elements = []

    elements.append(
        Paragraph(
            "INVOICE",
            styles["Title"],
        )
    )

    elements.append(
        Spacer(
            1,
            12,
        )
    )

    elements.append(
        Paragraph(
            (
                "Invoice No: "
                f"{sales_order.so_number}"
            ),
            styles["Normal"],
        )
    )

    elements.append(
        Paragraph(
            f"Customer: {customer.customer_name if customer else '-'}",
            styles["Normal"],
        )
    )

    elements.append(
        Paragraph(
            f"Date: {sales_order.created_at}",
            styles["Normal"],
        )
    )

    elements.append(
        Paragraph(
            f"Status: {sales_order.status}",
            styles["Normal"],
        )
    )

    elements.append(
        Spacer(
            1,
            12,
        )
    )

    table_data = [
        [
            "Product",
            "Qty",
            "Unit Price",
            "Total",
        ]
    ]

    for item in items:
        product = (
            db.query(Product)
            .filter(
                Product.id == item.product_id
            )
            .first()
        )

        table_data.append(
            [
                (
                    product.product_name
                    if product
                    else "-"
                ),
                item.quantity,
                f"{item.unit_price:.2f}",
                f"{item.total_price:.2f}",
            ]
        )

    table_data.append(
        [
            "",
            "",
            "Grand Total",
            f"{sales_order.total_amount:.2f}",
        ]
    )

    table = Table(
        table_data
    )

    table.setStyle(
        TableStyle(
            [
                (
                    "BACKGROUND",
                    (0, 0),
                    (-1, 0),
                    colors.lightgrey,
                ),
                (
                    "GRID",
                    (0, 0),
                    (-1, -1),
                    1,
                    colors.black,
                ),
                (
                    "ALIGN",
                    (1, 1),
                    (-1, -1),
                    "CENTER",
                ),
                (
                    "FONTNAME",
                    (0, 0),
                    (-1, 0),
                    "Helvetica-Bold",
                ),
            ]
        )
    )

    elements.append(table)
    document.build(elements)

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=(
            f"{sales_order.so_number}.pdf"
        ),
    )


@router.put("/{sales_order_id}/cancel")
def cancel_sales_order(
    sales_order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        sales_order = _get_sales_order(
            db=db,
            sales_order_id=sales_order_id,
        )

        if sales_order.status == "CANCELLED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Sales Order already cancelled"
                ),
            )

        if sales_order.status not in {
            "CONFIRMED",
            "COMPLETED",
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Sales Order cannot be cancelled"
                ),
            )

        returned_transaction = (
            db.query(StockTransaction)
            .filter(
                StockTransaction.transaction_type
                == "SALE_RETURN",
                StockTransaction.remark.startswith(
                    f"Return from "
                    f"{sales_order.so_number}."
                ),
            )
            .first()
        )

        if returned_transaction is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot cancel a sales order "
                    "that already has returned items"
                ),
            )

        items = _get_order_items(
            db=db,
            sales_order_id=sales_order.id,
        )

        for item in items:
            product = (
                db.query(Product)
                .filter(
                    Product.id == item.product_id
                )
                .first()
            )

            if product is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "Product not found: "
                        f"{item.product_id}"
                    ),
                )

            allocations = _get_item_allocations(
                db=db,
                sales_order_id=sales_order.id,
                sales_order_item_id=item.id,
            )

            allocated_total = sum(
                allocation.quantity
                for allocation in allocations
            )

            if allocated_total != item.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Batch allocation does not "
                        "match sales order item "
                        f"{item.id}"
                    ),
                )

            for allocation in allocations:
                batch = (
                    db.query(ProductBatch)
                    .filter(
                        ProductBatch.id
                        == allocation.batch_id
                    )
                    .first()
                )

                if batch is None:
                    raise HTTPException(
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                        detail=(
                            "Allocated batch not found: "
                            f"{allocation.batch_id}"
                        ),
                    )

                batch.quantity += (
                    allocation.quantity
                )

            product.stock_qty += item.quantity

            transaction = StockTransaction(
                product_id=item.product_id,
                transaction_type="SALE_CANCEL",
                quantity=item.quantity,
                remark=(
                    f"Cancel "
                    f"{sales_order.so_number}"
                ),
            )

            db.add(transaction)

        sales_order.status = "CANCELLED"

        audit = AuditLog(
            username=current_user.username,
            action="CANCEL_SALES_ORDER",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Cancel {sales_order.so_number}"
            ),
        )

        db.add(audit)
        db.commit()
        db.refresh(sales_order)

        return success_response(
            "Sales Order Cancelled",
            {
                "sales_order_id": (
                    sales_order.id
                ),
                "so_number": (
                    sales_order.so_number
                ),
                "status": sales_order.status,
            },
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="Failed to cancel sales order",
        ) from exc


@router.post("/{sales_order_id}/return")
def return_sales_order_items(
    sales_order_id: int,
    data: SalesReturnCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        sales_order = _get_sales_order(
            db=db,
            sales_order_id=sales_order_id,
        )

        if sales_order.status == "CANCELLED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot return cancelled "
                    "sales order"
                ),
            )

        if sales_order.status not in {
            "CONFIRMED",
            "COMPLETED",
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Sales Order cannot be returned"
                ),
            )

        returned_items = []

        for return_item in data.items:
            sold_item = (
                db.query(SalesOrderItem)
                .filter(
                    SalesOrderItem.sales_order_id
                    == sales_order.id,
                    SalesOrderItem.product_id
                    == return_item.product_id,
                )
                .first()
            )

            if sold_item is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Product "
                        f"{return_item.product_id} "
                        "not found in this sales order"
                    ),
                )

            previously_returned = (
                _get_returned_quantity(
                    db=db,
                    sales_order=sales_order,
                    product_id=(
                        return_item.product_id
                    ),
                )
            )

            remaining_returnable = (
                sold_item.quantity
                - previously_returned
            )

            if (
                return_item.quantity
                > remaining_returnable
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Return quantity exceeds "
                        "remaining returnable quantity "
                        f"for product "
                        f"{return_item.product_id}. "
                        f"Remaining: "
                        f"{remaining_returnable}"
                    ),
                )

            product = (
                db.query(Product)
                .filter(
                    Product.id
                    == return_item.product_id
                )
                .first()
            )

            if product is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Product not found",
                )

            allocations = _get_item_allocations(
                db=db,
                sales_order_id=sales_order.id,
                sales_order_item_id=sold_item.id,
            )

            allocated_total = sum(
                allocation.quantity
                for allocation in allocations
            )

            if allocated_total != sold_item.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Batch allocation does not "
                        "match the sold quantity"
                    ),
                )

            _restore_quantity_to_allocated_batches(
                db=db,
                allocations=allocations,
                previously_returned=(
                    previously_returned
                ),
                return_quantity=(
                    return_item.quantity
                ),
            )

            product.stock_qty += (
                return_item.quantity
            )

            transaction = StockTransaction(
                product_id=return_item.product_id,
                transaction_type="SALE_RETURN",
                quantity=return_item.quantity,
                remark=(
                    f"Return from "
                    f"{sales_order.so_number}. "
                    f"Reason: {return_item.reason}"
                ),
            )

            db.add(transaction)

            returned_items.append(
                {
                    "product_id": (
                        return_item.product_id
                    ),
                    "returned_quantity": (
                        return_item.quantity
                    ),
                    "previously_returned": (
                        previously_returned
                    ),
                    "total_returned": (
                        previously_returned
                        + return_item.quantity
                    ),
                    "remaining_returnable": (
                        remaining_returnable
                        - return_item.quantity
                    ),
                }
            )

        audit = AuditLog(
            username=current_user.username,
            action="SALES_RETURN",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Return items from "
                f"{sales_order.so_number}"
            ),
        )

        db.add(audit)
        db.commit()

        return success_response(
            "Sales return completed",
            {
                "sales_order_id": (
                    sales_order.id
                ),
                "so_number": (
                    sales_order.so_number
                ),
                "returned_items": returned_items,
            },
        )

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Failed to return "
                "sales order items"
            ),
        ) from exc