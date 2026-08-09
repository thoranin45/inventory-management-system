from decimal import Decimal
from typing import Any

from fastapi import status
from sqlalchemy.orm import Session

from app.core.exceptions import (
    AppException,
    InsufficientAvailableStockException,
    SalesOrderAlreadyCompletedException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    InventoryMovement,
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
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)

SO_STATUS_CONFIRMED = "CONFIRMED"
SO_STATUS_COMPLETED = "COMPLETED"
SO_STATUS_CANCELLED = "CANCELLED"

TX_SALE_OUT_FEFO = "SALE_OUT_FEFO"
TX_SALE_CANCEL = "SALE_CANCEL"
TX_SALE_RETURN = "SALE_RETURN"
TX_SALE_SHIPMENT = "SALE_SHIPMENT"

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

def _get_required_sales_order_for_update(
    sales_order_repo: SalesOrderRepository,
    sales_order_id: int,
) -> SalesOrder:
    sales_order = (
        sales_order_repo
        .get_sales_order_by_id_for_update(
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

def ship_sales_order_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    sales_order_id: int,
    current_user: Any,
) -> dict:

    with UnitOfWork(db) as uow:
        sales_order = (
            _get_required_sales_order_for_update(
                sales_order_repo=sales_order_repo,
                sales_order_id=sales_order_id,
            )
        )

        if sales_order.status == SO_STATUS_COMPLETED:
            raise SalesOrderAlreadyCompletedException()

        if sales_order.status == SO_STATUS_CANCELLED:
            _raise_error(
                message=(
                    "Cannot ship cancelled sales order"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        if sales_order.status != SO_STATUS_CONFIRMED:
            _raise_error(
                message=(
                    "Sales Order cannot be shipped"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        items = sales_order_repo.get_order_items(
            sales_order.id
        )

        for item in items:
            product = (
                sales_order_repo.get_product_by_id_for_update(
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

            # =============================================
            # Batch product
            # =============================================
            if product.track_batch:
                allocations = (
                    sales_order_repo
                    .get_item_allocations(
                        sales_order_id=(
                            sales_order.id
                        ),
                        sales_order_item_id=(
                            item.id
                        ),
                    )
                )

                _validate_allocations(
                    allocations=allocations,
                    expected_quantity=(
                        item.quantity
                    ),
                    sales_order_item_id=item.id,
                )

                shipment_total = Decimal("0")

                for allocation in allocations:
                    batch = (
                        sales_order_repo
                        .get_batch_by_id_for_update(
                            allocation.batch_id
                        )
                    )

                    if batch is None:
                        _raise_error(
                            message=(
                                "Allocated batch "
                                "not found: "
                                f"{allocation.batch_id}"
                            ),
                            status_code=(
                                status.HTTP_404_NOT_FOUND
                            ),
                        )

                    balance = (
                        balance_repo
                        .get_default_batch_balance_for_update(
                            product_id=(
                                item.product_id
                            ),
                            batch_id=batch.id,
                        )
                    )

                    if balance is None:
                        _raise_error(
                            message=(
                                "Stock balance "
                                "not found"
                            ),
                            status_code=(
                                status.HTTP_404_NOT_FOUND
                            ),
                        )

                    quantity = (
                        allocation.quantity
                    )

                    if (
                        balance.reserved_qty
                        < quantity
                    ):
                        _raise_error(
                            message=(
                                "Reserved stock is "
                                "lower than allocated "
                                "quantity"
                            ),
                            status_code=(
                                status.HTTP_409_CONFLICT
                            ),
                        )

                    if (
                        balance.on_hand_qty
                        < quantity
                    ):
                        _raise_error(
                            message=(
                                "Insufficient "
                                "on-hand stock"
                            ),
                            status_code=(
                                status.HTTP_409_CONFLICT
                            ),
                        )

                    if (
                        batch.quantity
                        < quantity
                    ):
                        _raise_error(
                            message=(
                                "Insufficient "
                                "batch stock"
                            ),
                            status_code=(
                                status.HTTP_409_CONFLICT
                            ),
                        )

                    balance_before = (
                        balance.on_hand_qty
                    )

                    # Release reservation
                    balance.reserved_qty -= (
                        quantity
                    )

                    # Remove physical stock
                    balance.on_hand_qty -= (
                        quantity
                    )

                    batch.quantity -= (
                        quantity
                    )

                    movement = InventoryMovement(
                        product_id=(
                            item.product_id
                        ),
                        batch_id=batch.id,
                        warehouse_id=(
                            balance.warehouse_id
                        ),
                        location_id=(
                            balance.location_id
                        ),
                        movement_type=(
                            "SALES_SHIPMENT"
                        ),
                        quantity=-quantity,
                        balance_before=(
                            balance_before
                        ),
                        balance_after=(
                            balance.on_hand_qty
                        ),
                        reference_type=(
                            "SALES_ORDER"
                        ),
                        reference_id=(
                            sales_order.id
                        ),
                        reference_number=(
                            sales_order.so_number
                        ),
                        remark=(
                            "Shipment from "
                            f"{sales_order.so_number}"
                        ),
                        created_by_user_id=(
                            current_user.id
                        ),
                    )

                    movement_repo.create(
                        movement
                    )

                    shipment_total += (
                        quantity
                    )

                if (
                    shipment_total
                    != item.quantity
                ):
                    _raise_error(
                        message=(
                            "Shipment quantity does "
                            "not match sales order item"
                        ),
                        status_code=(
                            status.HTTP_409_CONFLICT
                        ),
                    )

            # =============================================
            # Non-batch product
            # =============================================
            else:
                balance = (
                    balance_repo
                    .get_default_product_balance_for_update(
                        product.id
                    )
                )

                if balance is None:
                    _raise_error(
                        message=(
                            "Stock balance not found "
                            f"for product {product.id}"
                        ),
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                    )

                if (
                    balance.reserved_qty
                    < item.quantity
                ):
                    _raise_error(
                        message=(
                            "Reserved stock is lower "
                            "than sales order quantity"
                        ),
                        status_code=(
                            status.HTTP_409_CONFLICT
                        ),
                    )

                if (
                    balance.on_hand_qty
                    < item.quantity
                ):
                    _raise_error(
                        message=(
                            "Insufficient "
                            "on-hand stock"
                        ),
                        status_code=(
                            status.HTTP_409_CONFLICT
                        ),
                    )

                balance_before = (
                    balance.on_hand_qty
                )

                # Release reservation
                balance.reserved_qty -= (
                    item.quantity
                )

                # Remove physical stock
                balance.on_hand_qty -= (
                    item.quantity
                )

                movement = InventoryMovement(
                    product_id=item.product_id,
                    batch_id=None,
                    warehouse_id=(
                        balance.warehouse_id
                    ),
                    location_id=(
                        balance.location_id
                    ),
                    movement_type=(
                        "SALES_SHIPMENT"
                    ),
                    quantity=-item.quantity,
                    balance_before=(
                        balance_before
                    ),
                    balance_after=(
                        balance.on_hand_qty
                    ),
                    reference_type=(
                        "SALES_ORDER"
                    ),
                    reference_id=(
                        sales_order.id
                    ),
                    reference_number=(
                        sales_order.so_number
                    ),
                    remark=(
                        "Shipment from "
                        f"{sales_order.so_number}"
                    ),
                    created_by_user_id=(
                        current_user.id
                    ),
                )

                movement_repo.create(
                    movement
                )

            # =============================================
            # Product total stock
            # Batch / Non-batch both reach here
            # =============================================
            if (
                product.stock_qty
                < item.quantity
            ):
                _raise_error(
                    message=(
                        "Product stock is lower "
                        "than shipment quantity"
                    ),
                    status_code=(
                        status.HTTP_409_CONFLICT
                    ),
                )

            product.stock_qty -= (
                item.quantity
            )

            transaction = StockTransaction(
                product_id=item.product_id,
                transaction_type=(
                    TX_SALE_SHIPMENT
                ),
                quantity=-item.quantity,
                remark=(
                    "Shipment from "
                    f"{sales_order.so_number}"
                ),
            )

            sales_order_repo.create_stock_transaction(
                transaction
            )

        sales_order.status = (
            SO_STATUS_COMPLETED
        )

        sales_order_repo.update_sales_order(
            sales_order
        )

        audit = AuditLog(
            username=current_user.username,
            action="SHIP_SALES_ORDER",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Ship {sales_order.so_number}"
            ),
        )

        db.add(
            audit
        )

    uow.refresh(
        sales_order
    )

    return {
        "sales_order_id": sales_order.id,
        "so_number": sales_order.so_number,
        "status": sales_order.status,
    }

def create_sales_order_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    balance_repo: StockBalanceRepository,
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

            item_total = (
                request_item.quantity
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

            # =================================================
            # Batch product
            # =================================================
            if product.track_batch:
                batches = (
                    sales_order_repo
                    .get_available_batches_fefo(
                        request_item.product_id
                    )
                )

                available_total = Decimal("0")
                batch_balances = []

                for batch in batches:
                    balance = (
                        balance_repo
                        .get_default_batch_balance_for_update(
                            product_id=product.id,
                            batch_id=batch.id,
                        )
                    )

                    if balance is None:
                        continue

                    available_qty = (
                        balance.on_hand_qty
                        - balance.reserved_qty
                    )

                    if available_qty <= 0:
                        continue

                    available_total += (
                        available_qty
                    )

                    batch_balances.append(
                        (
                            batch,
                            balance,
                            available_qty,
                        )
                    )

                if (
                    available_total
                    < request_item.quantity
                ):
                    raise (
                        InsufficientAvailableStockException()
                    )

                remaining_quantity = (
                    request_item.quantity
                )

                for (
                    batch,
                    balance,
                    available_qty,
                ) in batch_balances:

                    if remaining_quantity <= 0:
                        break

                    reserve_quantity = min(
                        available_qty,
                        remaining_quantity,
                    )

                    balance.reserved_qty += (
                        reserve_quantity
                    )

                    allocation = (
                        SalesOrderBatchAllocation(
                            sales_order_id=(
                                sales_order.id
                            ),
                            sales_order_item_id=(
                                sales_order_item.id
                            ),
                            product_id=product.id,
                            batch_id=batch.id,
                            quantity=reserve_quantity,
                        )
                    )

                    (
                        sales_order_repo
                        .create_batch_allocation(
                            allocation
                        )
                    )

                    remaining_quantity -= (
                        reserve_quantity
                    )

                if remaining_quantity > 0:
                    raise (
                        InsufficientAvailableStockException()
                    )

            # =================================================
            # Non-batch product
            # =================================================
            else:
                balance = (
                    balance_repo
                    .get_default_product_balance_for_update(
                        product.id
                    )
                )

                if balance is None:
                    _raise_error(
                        message=(
                            "Stock balance not found "
                            f"for product {product.id}"
                        ),
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                    )

                available_qty = (
                    balance.on_hand_qty
                    - balance.reserved_qty
                )

                if (
                    available_qty
                    < request_item.quantity
                ):
                    raise (
                        InsufficientAvailableStockException()
                    )

                balance.reserved_qty += (
                    request_item.quantity
                )

        sales_order.total_amount = total_amount

        sales_order_repo.update_sales_order(
            sales_order
        )

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_SALES_ORDER",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Create {sales_order.so_number} "
                "and reserve stock"
            ),
        )

        db.add(
            audit
        )

    uow.refresh(
        sales_order
    )

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
    balance_repo: StockBalanceRepository,
    sales_order_id: int,
    current_user: Any,
) -> dict:
    with UnitOfWork(db) as uow:
        sales_order = (
            _get_required_sales_order_for_update(
                sales_order_repo=sales_order_repo,
                sales_order_id=sales_order_id,
            )
        )

        if sales_order.status == SO_STATUS_CANCELLED:
            _raise_error(
                message=(
                    "Sales Order already cancelled"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        if sales_order.status == SO_STATUS_COMPLETED:
            _raise_error(
                message=(
                    "Completed Sales Order cannot "
                    "be cancelled. "
                    "Use sales return instead."
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        if sales_order.status != SO_STATUS_CONFIRMED:
            _raise_error(
                message=(
                    "Sales Order cannot be cancelled"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        items = sales_order_repo.get_order_items(
            sales_order.id
        )

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

            # =============================================
            # Batch product
            # =============================================
            if product.track_batch:
                allocations = (
                    sales_order_repo
                    .get_item_allocations(
                        sales_order_id=(
                            sales_order.id
                        ),
                        sales_order_item_id=(
                            item.id
                        ),
                    )
                )

                _validate_allocations(
                    allocations=allocations,
                    expected_quantity=item.quantity,
                    sales_order_item_id=item.id,
                )

                for allocation in allocations:
                    balance = (
                        balance_repo
                        .get_default_batch_balance_for_update(
                            product_id=item.product_id,
                            batch_id=(
                                allocation.batch_id
                            ),
                        )
                    )

                    if balance is None:
                        _raise_error(
                            message=(
                                "Stock balance not found "
                                f"for product "
                                f"{item.product_id}, "
                                f"batch "
                                f"{allocation.batch_id}"
                            ),
                            status_code=(
                                status.HTTP_404_NOT_FOUND
                            ),
                        )

                    if (
                        balance.reserved_qty
                        < allocation.quantity
                    ):
                        _raise_error(
                            message=(
                                "Reserved stock is lower "
                                "than allocated quantity"
                            ),
                            status_code=(
                                status.HTTP_409_CONFLICT
                            ),
                        )

                    balance.reserved_qty -= (
                        allocation.quantity
                    )

            # =============================================
            # Non-batch product
            # =============================================
            else:
                balance = (
                    balance_repo
                    .get_default_product_balance_for_update(
                        product.id
                    )
                )

                if balance is None:
                    _raise_error(
                        message=(
                            "Stock balance not found "
                            f"for product {product.id}"
                        ),
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                    )

                if (
                    balance.reserved_qty
                    < item.quantity
                ):
                    _raise_error(
                        message=(
                            "Reserved stock is lower "
                            "than sales order quantity"
                        ),
                        status_code=(
                            status.HTTP_409_CONFLICT
                        ),
                    )

                balance.reserved_qty -= (
                    item.quantity
                )

        sales_order.status = (
            SO_STATUS_CANCELLED
        )

        sales_order_repo.update_sales_order(
            sales_order
        )

        audit = AuditLog(
            username=current_user.username,
            action="CANCEL_SALES_ORDER",
            table_name="sales_orders",
            record_id=sales_order.id,
            description=(
                f"Cancel {sales_order.so_number} "
                "and release reserved stock"
            ),
        )

        db.add(
            audit
        )

    uow.refresh(
        sales_order
    )

    return {
        "sales_order_id": sales_order.id,
        "so_number": sales_order.so_number,
        "status": sales_order.status,
    }

def return_sales_order_items_service(
    db: Session,
    sales_order_repo: SalesOrderRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    sales_order_id: int,
    data: SalesReturnCreate,
    current_user: Any,
) -> dict:

    returned_items = []

    with UnitOfWork(db):
        sales_order = (
            _get_required_sales_order_for_update(
                sales_order_repo=sales_order_repo,
                sales_order_id=sales_order_id,
            )
        )

        if sales_order.status != SO_STATUS_COMPLETED:
            _raise_error(
                message=(
                    "Only completed Sales Order "
                    "can be returned"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

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
                    status_code=status.HTTP_400_BAD_REQUEST,
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
                    status_code=status.HTTP_409_CONFLICT,
                )

            product = (
                sales_order_repo.get_product_by_id_for_update(
                    return_item.product_id
                )
            )

            if product is None:
                _raise_error(
                    message="Product not found",
                    status_code=status.HTTP_404_NOT_FOUND,
                )

            # =================================================
            # Batch product
            # =================================================
            if product.track_batch:
                allocations = (
                    sales_order_repo
                    .get_item_allocations(
                        sales_order_id=sales_order.id,
                        sales_order_item_id=sold_item.id,
                    )
                )

                _validate_allocations(
                    allocations=allocations,
                    expected_quantity=sold_item.quantity,
                    sales_order_item_id=sold_item.id,
                )

                remaining_previous = (
                    previously_returned
                )

                remaining_return = (
                    return_item.quantity
                )

                for allocation in allocations:
                    allocation_quantity = (
                        allocation.quantity
                    )

                    if (
                        remaining_previous
                        >= allocation_quantity
                    ):
                        remaining_previous -= (
                            allocation_quantity
                        )
                        continue

                    already_returned_in_allocation = (
                        remaining_previous
                    )

                    remaining_previous = Decimal("0")

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
                        sales_order_repo
                        .get_batch_by_id_for_update(
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

                    balance = (
                        balance_repo
                        .get_default_batch_balance_for_update(
                            product_id=(
                                return_item.product_id
                            ),
                            batch_id=(
                                allocation.batch_id
                            ),
                        )
                    )

                    if balance is None:
                        _raise_error(
                            message=(
                                "Stock balance not found"
                            ),
                            status_code=(
                                status.HTTP_404_NOT_FOUND
                            ),
                        )

                    balance_before = (
                        balance.on_hand_qty
                    )

                    batch.quantity += (
                        quantity_to_restore
                    )

                    balance.on_hand_qty += (
                        quantity_to_restore
                    )

                    product.stock_qty += (
                        quantity_to_restore
                    )

                    movement = InventoryMovement(
                        product_id=(
                            return_item.product_id
                        ),
                        batch_id=batch.id,
                        warehouse_id=(
                            balance.warehouse_id
                        ),
                        location_id=(
                            balance.location_id
                        ),
                        movement_type=(
                            "SALES_RETURN"
                        ),
                        quantity=(
                            quantity_to_restore
                        ),
                        balance_before=(
                            balance_before
                        ),
                        balance_after=(
                            balance.on_hand_qty
                        ),
                        reference_type=(
                            "SALES_ORDER"
                        ),
                        reference_id=(
                            sales_order.id
                        ),
                        reference_number=(
                            sales_order.so_number
                        ),
                        remark=(
                            f"Return from "
                            f"{sales_order.so_number}. "
                            f"Reason: "
                            f"{return_item.reason}"
                        ),
                        created_by_user_id=(
                            current_user.id
                        ),
                    )

                    movement_repo.create(
                        movement
                    )

                    remaining_return -= (
                        quantity_to_restore
                    )

                    if remaining_return <= 0:
                        break

                if remaining_return > 0:
                    _raise_error(
                        message=(
                            "Return quantity exceeds "
                            "available batch allocation"
                        ),
                        status_code=(
                            status.HTTP_409_CONFLICT
                        ),
                    )

            # =================================================
            # Non-batch product
            # =================================================
            else:
                balance = (
                    balance_repo
                    .get_default_product_balance_for_update(
                        product.id
                    )
                )

                if balance is None:
                    _raise_error(
                        message=(
                            "Stock balance not found "
                            f"for product {product.id}"
                        ),
                        status_code=(
                            status.HTTP_404_NOT_FOUND
                        ),
                    )

                balance_before = (
                    balance.on_hand_qty
                )

                balance.on_hand_qty += (
                    return_item.quantity
                )

                product.stock_qty += (
                    return_item.quantity
                )

                movement = InventoryMovement(
                    product_id=(
                        return_item.product_id
                    ),
                    batch_id=None,
                    warehouse_id=(
                        balance.warehouse_id
                    ),
                    location_id=(
                        balance.location_id
                    ),
                    movement_type=(
                        "SALES_RETURN"
                    ),
                    quantity=(
                        return_item.quantity
                    ),
                    balance_before=(
                        balance_before
                    ),
                    balance_after=(
                        balance.on_hand_qty
                    ),
                    reference_type=(
                        "SALES_ORDER"
                    ),
                    reference_id=(
                        sales_order.id
                    ),
                    reference_number=(
                        sales_order.so_number
                    ),
                    remark=(
                        f"Return from "
                        f"{sales_order.so_number}. "
                        f"Reason: "
                        f"{return_item.reason}"
                    ),
                    created_by_user_id=(
                        current_user.id
                    ),
                )

                movement_repo.create(
                    movement
                )

            # =================================================
            # Stock transaction
            # =================================================
            transaction = StockTransaction(
                product_id=return_item.product_id,
                transaction_type=(
                    TX_SALE_RETURN
                ),
                quantity=(
                    return_item.quantity
                ),
                remark=(
                    f"Return from "
                    f"{sales_order.so_number}. "
                    f"Reason: "
                    f"{return_item.reason}"
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