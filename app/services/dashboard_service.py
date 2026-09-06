from datetime import date, timedelta
from decimal import Decimal

from app.repositories.dashboard_repository import (
    DashboardRepository,
)


LOW_STOCK_THRESHOLD = 10
RECENT_TRANSACTION_LIMIT = 10
TOP_STOCK_LIMIT = 10
EXPIRING_SOON_DAYS = 90

STOCK_IN_TRANSACTION_TYPES = {
    "IN",
    "IN_BATCH",
    "IN_PO",
    "PO_RECEIVE",
}

STOCK_OUT_TRANSACTION_TYPES = {
    "OUT",
    "OUT_FIFO",
    "OUT_FEFO",
    "SALE_OUT_FEFO",
}


def get_dashboard_service(
    dashboard_repo: DashboardRepository,
) -> dict:
    total_stock_in = (
        dashboard_repo.get_transaction_quantity_sum(
            STOCK_IN_TRANSACTION_TYPES
        )
    )

    total_stock_out_raw = (
        dashboard_repo.get_transaction_quantity_sum(
            STOCK_OUT_TRANSACTION_TYPES
        )
    )

    # Stock-out รุ่นใหม่บันทึกเป็นค่าติดลบ
    # Dashboard แสดงยอดออกเป็นจำนวนบวก
    total_stock_out = abs(total_stock_out_raw)

    return {
        "total_products": (
            dashboard_repo.count_active_products()
        ),
        "total_stock": (
            dashboard_repo.get_total_stock()
        ),
        "total_stock_in": total_stock_in,
        "total_stock_out": total_stock_out,
        "low_stock_products": (
            dashboard_repo.count_low_stock_products(
                LOW_STOCK_THRESHOLD
            )
        ),
    }


def get_low_stock_products_service(
    dashboard_repo: DashboardRepository,
) -> list:
    return dashboard_repo.get_low_stock_products(
        LOW_STOCK_THRESHOLD
    )


def get_recent_transactions_service(
    dashboard_repo: DashboardRepository,
) -> list:
    return dashboard_repo.get_recent_transactions(
        RECENT_TRANSACTION_LIMIT
    )


def get_stock_summary_service(
    dashboard_repo: DashboardRepository,
) -> list[dict]:
    products = dashboard_repo.get_active_products()

    results = []

    for product in products:
        price = Decimal(product.price or 0)
        stock_qty = Decimal(product.stock_qty or 0)
        stock_value = price * stock_qty

        results.append(
            {
                "product_id": product.id,
                "sku": product.sku,
                "barcode": product.barcode,
                "product_name": product.product_name,
                "price": float(price),
                "stock_qty": stock_qty,
                "stock_value": float(stock_value),
            }
        )

    return results


def get_top_stock_service(
    dashboard_repo: DashboardRepository,
) -> list:
    return dashboard_repo.get_top_stock_products(
        TOP_STOCK_LIMIT
    )


def get_total_stock_value_service(
    dashboard_repo: DashboardRepository,
) -> dict:
    products = dashboard_repo.get_active_products()

    total_value = sum(
        (
            Decimal(product.price or 0)
            * Decimal(product.stock_qty or 0)
        )
        for product in products
    )

    return {
        "total_stock_value": float(total_value),
    }


def get_expiring_soon_service(
    dashboard_repo: DashboardRepository,
) -> list:
    today = date.today()

    target_date = today + timedelta(
        days=EXPIRING_SOON_DAYS
    )

    return dashboard_repo.get_batches_expiring_between(
        start_date=today,
        end_date=target_date,
    )


def get_expired_batches_service(
    dashboard_repo: DashboardRepository,
) -> list:
    return dashboard_repo.get_expired_batches(
        today=date.today()
    )
