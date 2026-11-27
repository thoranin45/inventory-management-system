from app.core.dependencies import require_warehouse

from fastapi import (
    APIRouter,
    Depends,
    Header,
)

from app.core.dependencies import (
    DatabaseSession,
    InventoryMovementRepositoryDependency,
    SalesOrderRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_admin,
)
from app.core.response import success_response
from app.core.pagination import ListParams, list_params
from app.models import User
from app.schemas.sales_order_schema import (
    SalesOrderCreate, CompleteFulfillment, FulfillmentScan, FulfillmentUndo,
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
    confirm_sales_order_service, fulfillment_transition_service, scan_fulfillment_service,
    undo_fulfillment_service,
)


router = APIRouter(dependencies=[Depends(require_warehouse)],
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
    params: ListParams = Depends(list_params),
):
    return get_sales_orders_service(sales_order_repo=sales_order_repo, params=params)


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


@router.get("/{sales_order_id}/packing-slip-data")
def packing_slip_data(
    sales_order_id: int,
    sales_order_repo: SalesOrderRepositoryDependency,
):
    order = get_sales_order_service(
        sales_order_repo=sales_order_repo, sales_order_id=sales_order_id
    )
    customer = sales_order_repo.get_customer_by_id(order["customer_id"])
    return success_response("Packing slip data", {
        "so_number": order["so_number"],
        "status": order["status"],
        "created_at": order["created_at"],
        "shipment_number": order.get("shipment_number"),
        "customer": {
            "id": order["customer_id"],
            "name": getattr(customer, "customer_name", None),
            "address": getattr(customer, "address", None),
            "phone": getattr(customer, "phone", None),
        },
        "items": [
            {
                "product_id": item["product_id"],
                "quantity": item["quantity"],
                "batch_allocations": item["batch_allocations"],
                "fulfillment_allocations": item["fulfillment_allocations"],
            }
            for item in order["items"]
        ],
    })


@router.get("/{sales_order_id}/shipping-label-data")
def shipping_label_data(
    sales_order_id: int,
    sales_order_repo: SalesOrderRepositoryDependency,
):
    order = get_sales_order_service(
        sales_order_repo=sales_order_repo, sales_order_id=sales_order_id
    )
    customer = sales_order_repo.get_customer_by_id(order["customer_id"])
    return success_response("Shipping label data", {
        "so_number": order["so_number"],
        "shipment_number": order.get("shipment_number"),
        "status": order["status"],
        "shipped_at": order.get("shipped_at"),
        "ship_to": {
            "name": getattr(customer, "customer_name", None),
            "address": getattr(customer, "address", None),
            "phone": getattr(customer, "phone", None),
        },
        "total_quantity": sum(
            (item["quantity"] for item in order["items"]), 0
        ),
        "order_barcode": order["so_number"],
    })


@router.put("/{sales_order_id}/cancel")
def cancel_sales_order(
    sales_order_id: int,
    db: DatabaseSession,
    sales_order_repo: SalesOrderRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    current_user: User = Depends(require_warehouse),
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
    # V1-H1: required, same rules as PO/transfer receiving. Missing/invalid -> 422.
    operation_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                pattern=r"^[A-Za-z0-9._:-]+$"),
    current_user: User = Depends(require_warehouse),
):
    result = return_sales_order_items_service(
        db=db,
        sales_order_repo=sales_order_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        sales_order_id=sales_order_id,
        data=data,
        current_user=current_user,
        operation_key=operation_key,
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
    current_user: User = Depends(require_warehouse),
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

# Fulfillment actions retain the router's Phase 1 authentication boundary.


@router.post("/{sales_order_id}/confirm")
def confirm_sales_order(sales_order_id: int, db: DatabaseSession,
                        sales_order_repo: SalesOrderRepositoryDependency,
                        balance_repo: StockBalanceRepositoryDependency,
                        current_user: User = Depends(require_admin)):
    return success_response("Sales Order Confirmed", confirm_sales_order_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user))


@router.post("/{sales_order_id}/start-picking")
def start_picking(sales_order_id: int, db: DatabaseSession,
                  sales_order_repo: SalesOrderRepositoryDependency,
                  balance_repo: StockBalanceRepositoryDependency,
                  current_user: User = Depends(require_warehouse)):
    return success_response("Picking Started", fulfillment_transition_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, "start-picking"))


@router.post("/{sales_order_id}/complete-picking")
def complete_picking(sales_order_id: int, data: CompleteFulfillment, db: DatabaseSession,
                     sales_order_repo: SalesOrderRepositoryDependency,
                     balance_repo: StockBalanceRepositoryDependency,
                     current_user: User = Depends(require_warehouse)):
    return success_response("Picking Completed", fulfillment_transition_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, "complete-picking", data))


@router.post("/{sales_order_id}/complete-packing")
def complete_packing(sales_order_id: int, data: CompleteFulfillment, db: DatabaseSession,
                     sales_order_repo: SalesOrderRepositoryDependency,
                     balance_repo: StockBalanceRepositoryDependency,
                     current_user: User = Depends(require_warehouse)):
    return success_response("Packing Completed", fulfillment_transition_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, "complete-packing", data))


@router.post("/{sales_order_id}/scan-pick")
def scan_pick(sales_order_id: int, data: FulfillmentScan, db: DatabaseSession,
              sales_order_repo: SalesOrderRepositoryDependency,
              balance_repo: StockBalanceRepositoryDependency,
              current_user: User = Depends(require_warehouse)):
    return success_response("Picking Progress", scan_fulfillment_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, data))


@router.post("/{sales_order_id}/scan-pack")
def scan_pack(sales_order_id: int, data: FulfillmentScan, db: DatabaseSession,
              sales_order_repo: SalesOrderRepositoryDependency,
              balance_repo: StockBalanceRepositoryDependency,
              current_user: User = Depends(require_warehouse)):
    return success_response("Packing Progress", scan_fulfillment_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, data, packing=True))


@router.post("/{sales_order_id}/undo-pick")
def undo_pick(sales_order_id: int, data: FulfillmentUndo, db: DatabaseSession,
              sales_order_repo: SalesOrderRepositoryDependency,
              balance_repo: StockBalanceRepositoryDependency,
              current_user: User = Depends(require_warehouse)):
    return success_response("Pick Undone", undo_fulfillment_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, data))


@router.post("/{sales_order_id}/undo-pack")
def undo_pack(sales_order_id: int, data: FulfillmentUndo, db: DatabaseSession,
              sales_order_repo: SalesOrderRepositoryDependency,
              balance_repo: StockBalanceRepositoryDependency,
              current_user: User = Depends(require_warehouse)):
    return success_response("Pack Undone", undo_fulfillment_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, data, packing=True))


@router.post("/{sales_order_id}/complete")
def complete_sales_order(sales_order_id: int, db: DatabaseSession,
                         sales_order_repo: SalesOrderRepositoryDependency,
                         balance_repo: StockBalanceRepositoryDependency,
                         current_user: User = Depends(require_admin)):
    return success_response("Sales Order Completed", fulfillment_transition_service(
        db, sales_order_repo, balance_repo, sales_order_id, current_user, "complete"))
