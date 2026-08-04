from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    BatchRepositoryDependency,
    DatabaseSession,
    ProductRepositoryDependency,
    PurchaseOrderRepositoryDependency,
    StockRepositoryDependency,
    SupplierRepositoryDependency,
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
from app.schemas.response import ApiResponse
from app.services.purchase_order_service import (
    cancel_purchase_order_service,
    create_purchase_order_service,
    get_purchase_order_service,
    get_purchase_orders_service,
    receive_purchase_order_service,
)


router = APIRouter(
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


@router.get(
    "",
    response_model=ApiResponse[
        list[PurchaseOrderSummaryResponse]
    ],
)
def get_purchase_orders(
    po_repo: PurchaseOrderRepositoryDependency,
) -> ApiResponse[
    list[PurchaseOrderSummaryResponse]
]:
    purchase_orders = get_purchase_orders_service(
        po_repo=po_repo
    )

    return ApiResponse(
        message=(
            "Purchase orders retrieved successfully"
        ),
        data=purchase_orders,
    )


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
    current_user: User = Depends(require_admin),
) -> ApiResponse[PurchaseOrderReceiveResponse]:
    result = receive_purchase_order_service(
        db=db,
        po_repo=po_repo,
        product_repo=product_repo,
        batch_repo=batch_repo,
        stock_repo=stock_repo,
        po_id=po_id,
        data=data,
        current_user=current_user,
    )

    return ApiResponse(
        message="Purchase order received successfully",
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