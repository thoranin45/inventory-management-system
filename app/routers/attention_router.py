from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.dependencies import (
    DatabaseSession,
    InventoryTransferRepositoryDependency,
    PurchaseOrderRepositoryDependency,
    SalesOrderRepositoryDependency,
    StockBalanceRepositoryDependency,
    require_warehouse,
)
from app.core.pagination import ListParams, list_params
from app.services.attention_service import (
    QUEUE_TYPES,
    get_attention_queue_service,
    get_attention_summary_service,
)

router = APIRouter(
    dependencies=[Depends(require_warehouse)],
    prefix="/attention",
    tags=["Attention"],
)


@router.get("/summary")
def attention_summary(
    db: DatabaseSession,
    balance_repo: StockBalanceRepositoryDependency,
    sales_repo: SalesOrderRepositoryDependency,
    po_repo: PurchaseOrderRepositoryDependency,
    transfer_repo: InventoryTransferRepositoryDependency,
) -> dict:
    return get_attention_summary_service(db, balance_repo, sales_repo, po_repo, transfer_repo)


@router.get("/queues")
def attention_queues(
    db: DatabaseSession,
    balance_repo: StockBalanceRepositoryDependency,
    sales_repo: SalesOrderRepositoryDependency,
    po_repo: PurchaseOrderRepositoryDependency,
    transfer_repo: InventoryTransferRepositoryDependency,
    type: str = Query(..., min_length=1),
    params: ListParams = Depends(list_params),
) -> dict:
    if type not in QUEUE_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown attention queue type: {type}")
    return get_attention_queue_service(
        db, balance_repo, sales_repo, po_repo, transfer_repo, type, params
    )
