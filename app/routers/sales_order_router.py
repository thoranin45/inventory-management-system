import os

from fastapi import (
    APIRouter,
    Depends,
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

from app.core.dependencies import (
    DatabaseSession,
    InventoryMovementRepositoryDependency,
    SalesOrderRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_admin,
)
from app.core.response import success_response
from app.models import User
from app.schemas.sales_order_schema import (
    SalesOrderCreate,
)
from app.schemas.sales_return_schema import (
    SalesReturnCreate,
)
from app.services.sales_order_service import (
    cancel_sales_order_service,
    create_sales_order_service,
    get_sales_order_service,
    get_sales_orders_service,
    return_sales_order_items_service,
    ship_sales_order_service,
)


router = APIRouter(
    prefix="/sales-orders",
    tags=["Sales Orders"],
)


@router.post("/")
def create_sales_order(
    data: SalesOrderCreate,
    db: DatabaseSession,
    sales_order_repo: SalesOrderRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    current_user: User = Depends(require_admin),
):
    result = create_sales_order_service(
        db=db,
        sales_order_repo=sales_order_repo,
        balance_repo=balance_repo,
        data=data,
        current_user=current_user,
    )

    return success_response(
        "Sales Order Created",
        result,
    )


@router.get("/")
def get_sales_orders(
    sales_order_repo: SalesOrderRepositoryDependency,
):
    result = get_sales_orders_service(
        sales_order_repo=sales_order_repo,
    )

    return success_response(
        "Sales Orders Retrieved",
        result,
    )


@router.get("/{sales_order_id}")
def get_sales_order(
    sales_order_id: int,
    sales_order_repo: SalesOrderRepositoryDependency,
):
    result = get_sales_order_service(
        sales_order_repo=sales_order_repo,
        sales_order_id=sales_order_id,
    )

    return success_response(
        "Sales Order Retrieved",
        result,
    )


@router.get("/{sales_order_id}/invoice")
def generate_invoice(
    sales_order_id: int,
    sales_order_repo: SalesOrderRepositoryDependency,
):
    sales_order_data = get_sales_order_service(
        sales_order_repo=sales_order_repo,
        sales_order_id=sales_order_id,
    )

    customer = sales_order_repo.get_customer_by_id(
        sales_order_data["customer_id"]
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
        f"{sales_order_data['so_number']}.pdf",
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
                f"{sales_order_data['so_number']}"
            ),
            styles["Normal"],
        )
    )

    customer_name = (
        customer.customer_name
        if customer is not None
        else "-"
    )

    elements.append(
        Paragraph(
            f"Customer: {customer_name}",
            styles["Normal"],
        )
    )

    elements.append(
        Paragraph(
            (
                "Date: "
                f"{sales_order_data['created_at']}"
            ),
            styles["Normal"],
        )
    )

    elements.append(
        Paragraph(
            (
                "Status: "
                f"{sales_order_data['status']}"
            ),
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

    for item in sales_order_data["items"]:
        product = sales_order_repo.get_product_by_id(
            item["product_id"]
        )

        product_name = (
            product.product_name
            if product is not None
            else "-"
        )

        table_data.append(
            [
                product_name,
                item["quantity"],
                f"{item['unit_price']:.2f}",
                f"{item['total_price']:.2f}",
            ]
        )

    table_data.append(
        [
            "",
            "",
            "Grand Total",
            f"{sales_order_data['total_amount']:.2f}",
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
            f"{sales_order_data['so_number']}.pdf"
        ),
    )


@router.put("/{sales_order_id}/cancel")
def cancel_sales_order(
    sales_order_id: int,
    db: DatabaseSession,
    sales_order_repo: SalesOrderRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    current_user: User = Depends(require_admin),
):
    result = cancel_sales_order_service(
        db=db,
        sales_order_repo=sales_order_repo,
        balance_repo=balance_repo,
        sales_order_id=sales_order_id,
        current_user=current_user,
    )

    return success_response(
        "Sales Order Cancelled",
        result,
    )

@router.post("/{sales_order_id}/return")
def return_sales_order_items(
    sales_order_id: int,
    data: SalesReturnCreate,
    db: DatabaseSession,
    sales_order_repo: SalesOrderRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(require_admin),
):
    result = return_sales_order_items_service(
        db=db,
        sales_order_repo=sales_order_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        sales_order_id=sales_order_id,
        data=data,
        current_user=current_user,
    )

    return success_response(
        "Sales return completed",
        result,
    )

@router.post("/{sales_order_id}/ship")
def ship_sales_order(
    sales_order_id: int,
    db: DatabaseSession,
    sales_order_repo: SalesOrderRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    current_user: User = Depends(require_admin),
):
    result = ship_sales_order_service(
        db=db,
        sales_order_repo=sales_order_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        sales_order_id=sales_order_id,
        current_user=current_user,
    )

    return success_response(
        "Sales Order Shipped",
        result,
    )