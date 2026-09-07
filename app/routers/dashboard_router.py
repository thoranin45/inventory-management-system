from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends

from app.core.dependencies import (
    DashboardRepositoryDependency,
    DatabaseSession,
    InventoryTransferRepositoryDependency,
    PurchaseOrderRepositoryDependency,
    SalesOrderRepositoryDependency,
    StockBalanceRepositoryDependency,
)
from app.core.response import success_response
from app.services.dashboard_service import (
    get_dashboard_service,
    get_expired_batches_service,
    get_expiring_soon_service,
    get_low_stock_products_service,
    get_recent_transactions_service,
    get_stock_summary_service,
    get_top_stock_service,
    get_total_stock_value_service,
)
from app.services.dashboard_summary_service import get_dashboard_summary_service


router = APIRouter(dependencies=[Depends(require_warehouse)], )


@router.get("/dashboard")
def get_dashboard(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_dashboard_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Dashboard retrieved successfully",
        result,
    )


@router.get("/dashboard/summary")
def get_dashboard_summary(
    db: DatabaseSession,
    balance_repo: StockBalanceRepositoryDependency,
    sales_repo: SalesOrderRepositoryDependency,
    po_repo: PurchaseOrderRepositoryDependency,
    transfer_repo: InventoryTransferRepositoryDependency,
) -> dict:
    return get_dashboard_summary_service(
        db, balance_repo, sales_repo, po_repo, transfer_repo
    )


@router.get("/dashboard/low-stock")
def get_low_stock_products(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_low_stock_products_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Low stock products retrieved successfully",
        {
            "items": result,
        },
    )


@router.get("/dashboard/recent-transactions")
def get_dashboard_recent_transactions(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_recent_transactions_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Recent transactions retrieved successfully",
        {
            "items": result,
        },
    )


@router.get("/dashboard/stock-summary")
def get_stock_summary(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_stock_summary_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Stock summary retrieved successfully",
        {
            "items": result,
        },
    )


@router.get("/dashboard/top-stock")
def get_top_stock(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_top_stock_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Top stock products retrieved successfully",
        {
            "items": result,
        },
    )


@router.get("/dashboard/stock-value")
def get_total_stock_value(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_total_stock_value_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Total stock value retrieved successfully",
        result,
    )


@router.get("/dashboard/expiring-soon")
def expiring_soon(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_expiring_soon_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Expiring batches retrieved successfully",
        {
            "items": result,
        },
    )


@router.get("/dashboard/expired")
def expired_batches(
    dashboard_repo: DashboardRepositoryDependency,
):
    result = get_expired_batches_service(
        dashboard_repo=dashboard_repo
    )

    return success_response(
        "Expired batches retrieved successfully",
        {
            "items": result,
        },
    )
