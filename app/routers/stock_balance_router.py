from app.core.dependencies import require_admin
from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.schemas.stock_balance_schema import (
    StockBalanceAdjust,
    StockBalanceCreate,
    StockBalanceResponse,
)
from app.services.stock_balance_service import (
    adjust_stock_balance_service,
    create_stock_balance_service,
    get_product_stock_balances_service,
    get_stock_balances_service,
)

router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/stock-balances",
    tags=["Stock Balances"],
)


@router.get(
    "",
    response_model=list[StockBalanceResponse],
)
def get_stock_balances(
    db: Session = Depends(get_db),
):
    repo = StockBalanceRepository(db)

    return get_stock_balances_service(repo)


@router.get(
    "/product/{product_id}",
    response_model=list[StockBalanceResponse],
)
def get_product_stock_balances(
    product_id: int,
    db: Session = Depends(get_db),
):
    repo = StockBalanceRepository(db)

    return get_product_stock_balances_service(
        db,
        repo,
        product_id,
    )


@router.post(
    "",
    response_model=StockBalanceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
# Phase 2: replace raw balance mutation with audited business operations.
def create_stock_balance(
    data: StockBalanceCreate,
    db: Session = Depends(get_db),
):
    repo = StockBalanceRepository(db)

    return create_stock_balance_service(
        db,
        repo,
        data,
    )


@router.patch(
    "/{balance_id}",
    dependencies=[Depends(require_admin)],
    response_model=StockBalanceResponse,
)
def adjust_stock_balance(
    balance_id: int,
    data: StockBalanceAdjust,
    db: Session = Depends(get_db),
):
    repo = StockBalanceRepository(db)

    return adjust_stock_balance_service(
        db,
        repo,
        balance_id,
        data,
    )
