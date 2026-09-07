from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, Header, status

from app.core.dependencies import (
    BatchRepositoryDependency,
    DatabaseSession,
    ProductRepositoryDependency,
    PurchaseOrderRepositoryDependency,
    StockRepositoryDependency,
    SupplierRepositoryDependency,
    InventoryMovementRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_admin,
)
from app.models import User
from app.schemas.purchase_order_schema import (
    PurchaseOrderActionResponse,
    PurchaseOrderCreate,
    PurchaseOrderReceiveResponse,
    PurchaseOrderResponse,
    PurchaseOrderSummaryResponse,
    ReceivePO,
)
from app.core.pagination import ListParams, list_params
from app.schemas.response import ApiResponse
from app.services.purchase_order_service import (
    cancel_purchase_order_service, confirm_purchase_order_service,
    create_purchase_order_service,
    get_purchase_order_service,
    get_purchase_orders_service,
    receive_purchase_order_service,
)


router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/purchase-orders",
    tags=["Purchase Orders"],
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[
        PurchaseOrderResponse
    ],
)
def create_purchase_order(
    data: PurchaseOrderCreate,
    db: DatabaseSession,
    po_repo: PurchaseOrderRepositoryDependency,
    supplier_repo: SupplierRepositoryDependency,
    product_repo: ProductRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[PurchaseOrderResponse]:
    purchase_order = create_purchase_order_service(
        db=db,
        po_repo=po_repo,
        supplier_repo=supplier_repo,
        product_repo=product_repo,
        data=data,
        current_user=current_user,
    )

    return ApiResponse(
        message="Purchase order created successfully",
        data=purchase_order,
    )


@router.get("")
def get_purchase_orders(
    po_repo: PurchaseOrderRepositoryDependency,
    params: ListParams = Depends(list_params),
) -> dict:
    return get_purchase_orders_service(po_repo=po_repo, params=params)


@router.get(
    "/{po_id}",
    response_model=ApiResponse[
        PurchaseOrderResponse
    ],
)
def get_purchase_order(
    po_id: int,
    po_repo: PurchaseOrderRepositoryDependency,
) -> ApiResponse[PurchaseOrderResponse]:
    purchase_order = get_purchase_order_service(
        po_repo=po_repo,
        po_id=po_id,
    )

    return ApiResponse(
        message="Purchase order retrieved successfully",
        data=purchase_order,
    )


@router.post(
    "/{po_id}/receive",
    response_model=ApiResponse[
        PurchaseOrderReceiveResponse
    ],
)
def receive_purchase_order(
    po_id: int,
    data: ReceivePO,
    db: DatabaseSession,
    po_repo: PurchaseOrderRepositoryDependency,
    product_repo: ProductRepositoryDependency,
    batch_repo: BatchRepositoryDependency,
    stock_repo: StockRepositoryDependency,
    balance_repo: StockBalanceRepositoryDependency,
    movement_repo: InventoryMovementRepositoryDependency,
    operation_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    current_user: User = Depends(
        require_warehouse
    ),
) -> ApiResponse[
    PurchaseOrderReceiveResponse
]:

    result = receive_purchase_order_service(
        db=db,
        po_repo=po_repo,
        product_repo=product_repo,
        batch_repo=batch_repo,
        stock_repo=stock_repo,
        balance_repo=balance_repo,
        movement_repo=movement_repo,
        po_id=po_id,
        data=data,
        current_user=current_user,
        operation_key=operation_key,
    )

    return ApiResponse(
        message=(
            "Purchase order received "
            "successfully"
        ),
        data=result,
    )


@router.post(
    "/{po_id}/cancel",
    response_model=ApiResponse[
        PurchaseOrderActionResponse
    ],
)
def cancel_purchase_order(
    po_id: int,
    db: DatabaseSession,
    po_repo: PurchaseOrderRepositoryDependency,
    current_user: User = Depends(require_admin),
) -> ApiResponse[PurchaseOrderActionResponse]:
    result = cancel_purchase_order_service(
        db=db,
        po_repo=po_repo,
        po_id=po_id,
        current_user=current_user,
    )

    return ApiResponse(
        message="Purchase order cancelled successfully",
        data=result,
    )


@router.post("/{po_id}/confirm", response_model=ApiResponse[PurchaseOrderActionResponse])
def confirm_purchase_order(po_id: int, db: DatabaseSession,
                           po_repo: PurchaseOrderRepositoryDependency,
                           product_repo: ProductRepositoryDependency,
                           current_user: User = Depends(require_admin)):
    result = confirm_purchase_order_service(db, po_repo, product_repo, po_id, current_user)
    return ApiResponse(message="Purchase order confirmed successfully", data=result)