from decimal import Decimal
from typing import Any

from fastapi import status
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    ProductBatch,
    SalesOrder,
    SalesOrderBatchAllocation,
    SalesOrderItem,
    StockTransaction,
)
from app.repositories.sales_order_repository import (
    SalesOrderRepository,
)
from app.schemas.sales_order_schema import (
    SalesOrderCreate,
)
from app.schemas.sales_return_schema import (
    SalesReturnCreate,
)


SO_STATUS_CONFIRMED = "CONFIRMED"
SO_STATUS_COMPLETED = "COMPLETED"
SO_STATUS_CANCELLED = "CANCELLED"

TX_SALE_OUT_FEFO = "SALE_OUT_FEFO"
TX_SALE_CANCEL = "SALE_CANCEL"
TX_SALE_RETURN = "SALE_RETURN"


def _raise_error(
    message: str,
    status_code: int,
) -> None:
    raise AppException(
        message=message,
        status_code=status_code,
    )


def _get_required_sales_order(
    sales_order_repo: SalesOrderRepository,
    sales_order_id: int,
) -> SalesOrder:
    sales_order = (
        sales_order_repo.get_sales_order_by_id(
            sales_order_id
        )
    )

    if sales_order is None:
        _raise_error(
            message="Sales Order not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    return sales_order


def _validate_allocations(
    allocations: list[SalesOrderBatchAllocation],
    expected_quantity: int,
    sales_order_item_id: int,
) -> None:
    allocated_total = sum(
        allocation.quantity
        for allocation in allocations
    )

    if allocated_total != expected_quantity:
        _raise_error(
            message=(
                "Batch allocation does not match "
                f"sales order item {sales_order_item_id}"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


def _restore_quantity_to_allocated_batches(
    sales_order_repo: SalesOrderRepository,
    allocations: list[SalesOrderBatchAllocation],
    previously_returned: int,
    return_quantity: int,
) -> None:
    remaining_previous = previously_returned
    remaining_return = return_quantity

    for allocation in allocations:
        allocation_quantity = allocation.quantity

        if remaining_previous >= allocation_quantity:
            remaining_previous -= allocation_quantity
            continue

        already_returned_in_allocation = (
            remaining_previous
        )

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

        batch = sales_order_repo.get_batch_by_id(
            allocation.batch_id
        )

        if batch is None:
            _raise_error(
                message=(
                    "Allocated batch not found: "
                    f"{allocation.batch_id}"
                ),
                status_code=status.HTTP_404_NOT_FOUND,
            )

        batch.quantity += quantity_to_restore
        remaining_return -= quantity_to_restore

        if remaining_return <= 0:
            break

    if remaining_return > 0:
        _raise_error(
            message=(
                "Return quantity exceeds "
                "available batch allocation"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )


def create_sales_order_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    data: SalesOrderCreate,
    current_user: Any,
) -> dict:
    customer = sales_order_repo.get_customer_by_id(
        data.customer_id
    )

    if customer is None:
        _raise_error(
            message="Customer not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    sales_order = SalesOrder(
        so_number="TEMP",
        customer_id=data.customer_id,
        status=SO_STATUS_CONFIRMED,
        total_amount=Decimal("0.00"),
    )

    total_amount = Decimal("0.00")

    with UnitOfWork(db) as uow:
        sales_order_repo.create_sales_order(
            sales_order
        )

        sales_order.so_number = (
            f"SO-{sales_order.id:06d}"
        )

        for request_item in data.items:
            product = (
                sales_order_repo
                .get_active_product_by_id(
                    request_item.product_id
                )
            )

            if product is None:
                _raise_error(
                    message=(
                        "Product not found: "
                        f"{request_item.product_id}"
                    ),
                    status_code=(
                        status.HTTP_404_NOT_FOUND
                    ),
                )

            if product.stock_qty < request_item.quantity:
                _raise_error(
                    message=(
                        "Not enough stock for "
                        f"{product.product_name}"
                    ),
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                )

            batches = (
                sales_order_repo
                .get_available_batches_fefo(
                    request_item.product_id
                )
            )

            batch_stock_total = sum(
                batch.quantity
                for batch in batches
            )

            if (
                batch_stock_total
                < request_item.quantity
            ):
                _raise_error(
                    message=(
                        "Not enough batch stock for "
                        f"{product.product_name}"
                    ),
                    status_code=(
                        status.HTTP_409_CONFLICT
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

            sales_order_repo.create_sales_order_item(
                sales_order_item
            )

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
                        product_id=(
                            request_item.product_id
                        ),
                        batch_id=batch.id,
                        quantity=deduct_quantity,
                    )
                )

                sales_order_repo.create_batch_allocation(
                    allocation
                )

            if remaining_quantity > 0:
                _raise_error(
                    message=(
                        "Not enough batch stock for "
                        f"{product.product_name}"
                    ),
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                )

            product.stock_qty -= (
                request_item.quantity
            )

            transaction = StockTransaction(
                product_id=request_item.product_id,
                transaction_type=TX_SALE_OUT_FEFO,
                quantity=-request_item.quantity,
                remark=(
                    f"Sales Order "
                    f"{sales_order.so_number}"
                ),
            )

            sales_order_repo.create_stock_transaction(
                transaction
            )

        sales_order.total_amount = total_amount

        sales_order_repo.update_sales_order(
            sales_order
        )

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

    uow.refresh(sales_order)

    return {
        "sales_order_id": sales_order.id,
        "so_number": sales_order.so_number,
        "status": sales_order.status,
        "total_amount": float(
            sales_order.total_amount
        ),
    }


def get_sales_orders_service(
    sales_order_repo: SalesOrderRepository,
) -> dict:
    sales_orders = (
        sales_order_repo.get_all_sales_orders()
    )

    return {
        "items": sales_orders,
    }


def get_sales_order_service(
    sales_order_repo: SalesOrderRepository,
    sales_order_id: int,
) -> dict:
    sales_order = _get_required_sales_order(
        sales_order_repo=sales_order_repo,
        sales_order_id=sales_order_id,
    )

    items = sales_order_repo.get_order_items(
        sales_order.id
    )

    item_results = []

    for item in items:
        allocations = (
            sales_order_repo.get_item_allocations(
                sales_order_id=sales_order.id,
                sales_order_item_id=item.id,
            )
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

    return {
        "id": sales_order.id,
        "so_number": sales_order.so_number,
        "customer_id": sales_order.customer_id,
        "status": sales_order.status,
        "total_amount": float(
            sales_order.total_amount
        ),
        "created_at": sales_order.created_at,
        "items": item_results,
    }


def cancel_sales_order_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    sales_order_id: int,
    current_user: Any,
) -> dict:
    sales_order = _get_required_sales_order(
        sales_order_repo=sales_order_repo,
        sales_order_id=sales_order_id,
    )

    if sales_order.status == SO_STATUS_CANCELLED:
        _raise_error(
            message="Sales Order already cancelled",
            status_code=status.HTTP_409_CONFLICT,
        )

    if sales_order.status not in {
        SO_STATUS_CONFIRMED,
        SO_STATUS_COMPLETED,
    }:
        _raise_error(
            message=(
                "Sales Order cannot be cancelled"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

    if sales_order_repo.has_return_transaction(
        sales_order.so_number
    ):
        _raise_error(
            message=(
                "Cannot cancel a sales order "
                "that already has returned items"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

    items = sales_order_repo.get_order_items(
        sales_order.id
    )

    with UnitOfWork(db) as uow:
        for item in items:
            product = (
                sales_order_repo.get_product_by_id(
                    item.product_id
                )
            )

            if product is None:
                _raise_error(
                    message=(
                        "Product not found: "
                        f"{item.product_id}"
                    ),
                    status_code=(
                        status.HTTP_404_NOT_FOUND
                    ),
                )

            allocations = (
                sales_order_repo.get_item_allocations(
                    sales_order_id=sales_order.id,
                    sales_order_item_id=item.id,
                )
            )

            _validate_allocations(
                allocations=allocations,
                expected_quantity=item.quantity,
                sales_order_item_id=item.id,
            )

            for allocation in allocations:
                batch = (
                    sales_order_repo.get_batch_by_id(
                        allocation.batch_id
                    )
                )

                if batch is None:
                    _raise_error(
                        message=(
                            "Allocated batch not found: "
                            f"{allocation.batch_id}"
                        ),
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                    )

                batch.quantity += (
                    allocation.quantity
                )

            product.stock_qty += item.quantity

            transaction = StockTransaction(
                product_id=item.product_id,
                transaction_type=TX_SALE_CANCEL,
                quantity=item.quantity,
                remark=(
                    f"Cancel "
                    f"{sales_order.so_number}"
                ),
            )

            sales_order_repo.create_stock_transaction(
                transaction
            )

        sales_order.status = SO_STATUS_CANCELLED

        sales_order_repo.update_sales_order(
            sales_order
        )

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

    uow.refresh(sales_order)

    return {
        "sales_order_id": sales_order.id,
        "so_number": sales_order.so_number,
        "status": sales_order.status,
    }


def return_sales_order_items_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    sales_order_id: int,
    data: SalesReturnCreate,
    current_user: Any,
) -> dict:
    sales_order = _get_required_sales_order(
        sales_order_repo=sales_order_repo,
        sales_order_id=sales_order_id,
    )

    if sales_order.status == SO_STATUS_CANCELLED:
        _raise_error(
            message=(
                "Cannot return cancelled sales order"
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

    if sales_order.status not in {
        SO_STATUS_CONFIRMED,
        SO_STATUS_COMPLETED,
    }:
        _raise_error(
            message="Sales Order cannot be returned",
            status_code=status.HTTP_409_CONFLICT,
        )

    returned_items = []

    with UnitOfWork(db) as uow:
        for return_item in data.items:
            sold_item = (
                sales_order_repo
                .get_order_item_by_product(
                    sales_order_id=sales_order.id,
                    product_id=return_item.product_id,
                )
            )

            if sold_item is None:
                _raise_error(
                    message=(
                        f"Product "
                        f"{return_item.product_id} "
                        "not found in this sales order"
                    ),
                    status_code=(
                        status.HTTP_400_BAD_REQUEST
                    ),
                )

            previously_returned = (
                sales_order_repo.get_returned_quantity(
                    so_number=sales_order.so_number,
                    product_id=return_item.product_id,
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
                _raise_error(
                    message=(
                        "Return quantity exceeds "
                        "remaining returnable quantity "
                        f"for product "
                        f"{return_item.product_id}. "
                        f"Remaining: "
                        f"{remaining_returnable}"
                    ),
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                )

            product = (
                sales_order_repo.get_product_by_id(
                    return_item.product_id
                )
            )

            if product is None:
                _raise_error(
                    message="Product not found",
                    status_code=(
                        status.HTTP_404_NOT_FOUND
                    ),
                )

            allocations = (
                sales_order_repo.get_item_allocations(
                    sales_order_id=sales_order.id,
                    sales_order_item_id=sold_item.id,
                )
            )

            _validate_allocations(
                allocations=allocations,
                expected_quantity=sold_item.quantity,
                sales_order_item_id=sold_item.id,
            )

            _restore_quantity_to_allocated_batches(
                sales_order_repo=sales_order_repo,
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
                transaction_type=TX_SALE_RETURN,
                quantity=return_item.quantity,
                remark=(
                    f"Return from "
                    f"{sales_order.so_number}. "
                    f"Reason: {return_item.reason}"
                ),
            )

            sales_order_repo.create_stock_transaction(
                transaction
            )

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

    return {
        "sales_order_id": sales_order.id,
        "so_number": sales_order.so_number,
        "returned_items": returned_items,
    }