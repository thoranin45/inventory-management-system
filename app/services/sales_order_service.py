from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import status
from sqlalchemy.orm import Session

from app.core import batch_eligibility
from app.core.exceptions import AppException, InsufficientAvailableStockException
from app.core.unit_of_work import UnitOfWork
from app.models import AuditLog, InventoryMovement, SalesOrder, SalesOrderBatchAllocation, SalesOrderItem, StockTransaction
from app.repositories.sales_order_repository import SalesOrderRepository
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.repositories.inventory_movement_repository import InventoryMovementRepository
from app.repositories.product_repository import ProductRepository
from app.schemas.sales_order_schema import SalesOrderCreate
from app.schemas.sales_return_schema import SalesReturnCreate

SO_STATUS_COMPLETED = "COMPLETED"
TX_SALE_RETURN = "SALE_RETURN"


def _raise_error(message, status_code=409):
    raise AppException(message=message, status_code=status_code)


def _get_required_sales_order(sales_order_repo, sales_order_id):
    order = sales_order_repo.get_sales_order_by_id(sales_order_id)
    if order is None:
        _raise_error("Sales Order not found", 404)
    return order


def _get_required_sales_order_for_update(sales_order_repo, sales_order_id):
    order = sales_order_repo.get_sales_order_by_id_for_update(sales_order_id)
    if order is None:
        _raise_error("Sales Order not found", 404)
    return order


def _require_state(order, *states):
    if order.status not in states:
        _raise_error(f"Sales Order state conflict: {order.status}; requires {', '.join(states)}")


def _audit(db, order, user, action, previous=None, detail=""):
    db.add(AuditLog(username=user.username, action=action, table_name="sales_orders",
                    record_id=order.id, description=f"{order.so_number}: {previous or order.status} -> {order.status}. {detail}"))


def _result(order):
    return {"sales_order_id": order.id, "so_number": order.so_number, "status": order.status,
            "shipment_number": order.shipment_number}


def _validate_allocations(allocations, expected_quantity: Decimal, sales_order_item_id):
    if sum((a.quantity for a in allocations), Decimal(0)) != expected_quantity:
        _raise_error(f"Batch allocation does not match sales order item {sales_order_item_id}")


def _allocations(repo, order, items):
    if not items:
        _raise_error("Order has no items")
    rows = []
    for item in items:
        allocations = repo.get_item_allocations(order.id, item.id)
        _validate_allocations(allocations, item.quantity, item.id)
        for a in allocations:
            if a.product_id != item.product_id or a.stock_balance_id is None:
                _raise_error(f"Invalid allocation ownership/source: {a.id}")
        rows.extend(allocations)
    if {a.id for a in rows} != {a.id for a in repo.get_order_allocations(order.id)}:
        _raise_error("Invalid allocation membership")
    return rows


def _source(db, allocation):
    product = SalesOrderRepository(db).get_product_by_id(allocation.product_id)
    if product is None or bool(product.track_batch) != (allocation.batch_id is not None):
        _raise_error(f"Invalid allocation tracking identity: {allocation.id}")
    balance = StockBalanceRepository(db).get_by_id(allocation.stock_balance_id)
    if (balance is None or balance.product_id != allocation.product_id or
            balance.batch_id != allocation.batch_id):
        _raise_error(f"Invalid pinned allocation source: {allocation.id}")
    StockBalanceRepository(db).require_operational_storage(balance.warehouse_id, balance.location_id)
    if allocation.batch_id is not None:
        batch = SalesOrderRepository(db).get_batch_by_id(allocation.batch_id)
        if batch is None or batch.product_id != allocation.product_id:
            _raise_error(f"Invalid allocated batch: {allocation.id}")
    return balance


def _expiry(repo, allocation):
    if allocation.batch_id is not None:
        batch = repo.get_batch_by_id(allocation.batch_id)
        if batch_eligibility.is_expired(batch):
            _raise_error(f"Expired allocated batch: {batch.id}")


def create_sales_order_service(db: Session, sales_order_repo: SalesOrderRepository,
                               balance_repo: StockBalanceRepository, data: SalesOrderCreate, current_user: Any) -> dict:
    if sales_order_repo.get_customer_by_id(data.customer_id) is None:
        _raise_error("Customer not found", 404)
    with UnitOfWork(db):
        order = SalesOrder(so_number=None, customer_id=data.customer_id, status="DRAFT", total_amount=Decimal(0))
        sales_order_repo.create_sales_order(order)
        order.so_number = f"SO-{order.id:06d}"
        for line in data.items:
            if sales_order_repo.get_active_product_by_id(line.product_id) is None:
                _raise_error(f"Product not found: {line.product_id}", 404)
            amount = line.quantity * line.unit_price
            sales_order_repo.create_sales_order_item(SalesOrderItem(sales_order_id=order.id,
                product_id=line.product_id, quantity=line.quantity, unit_price=line.unit_price, total_price=amount))
            order.total_amount += amount
        _audit(db, order, current_user, "CREATE_SALES_ORDER")
    return {**_result(order), "total_amount": float(order.total_amount)}


def confirm_sales_order_service(db: Session, sales_order_repo: SalesOrderRepository,
                                balance_repo: StockBalanceRepository, sales_order_id: int, current_user: Any) -> dict:
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        _require_state(order, "DRAFT")
        items = sales_order_repo.get_order_items(order.id)
        if not items:
            _raise_error("Order has no items")
        balance_repo.lock_inventory([i.product_id for i in items])
        for item in items:
            product = sales_order_repo.get_active_product_by_id(item.product_id)
            if product is None:
                _raise_error("Product not found", 404)
            if sales_order_repo.get_item_allocations(order.id, item.id):
                _raise_error("Draft already has allocation evidence")
            if product.track_batch:
                today = batch_eligibility.business_today()
                batches = sales_order_repo.get_available_batches_fefo(product.id)
                candidates = [(b.id, balance_repo.get_default_batch_balance_for_update(product.id, b.id))
                              for b in batches if batch_eligibility.is_batch_eligible(b, today)]
            else:
                candidates = [(None, balance_repo.get_default_product_balance_for_update(product.id))]
            remaining = item.quantity
            for batch_id, balance in candidates:
                if balance is None:
                    continue
                quantity = min(remaining, balance.on_hand_qty - balance.reserved_qty)
                if quantity <= 0:
                    continue
                balance.reserved_qty += quantity
                sales_order_repo.create_batch_allocation(SalesOrderBatchAllocation(
                    sales_order_id=order.id, sales_order_item_id=item.id, product_id=item.product_id,
                    batch_id=batch_id, stock_balance_id=balance.id, quantity=quantity,
                    picked_quantity=Decimal(0), packed_quantity=Decimal(0)))
                remaining -= quantity
            if remaining:
                raise InsufficientAvailableStockException()
        order.status = "CONFIRMED"
        _audit(db, order, current_user, "CONFIRM_SALES_ORDER", "DRAFT")
    return _result(order)


def fulfillment_transition_service(db, sales_order_repo, balance_repo, sales_order_id, current_user, action, data=None):
    transitions = {"start-picking": ("CONFIRMED", "PICKING"),
                   "complete-picking": ("PICKING", "PACKING"),
                   "complete-packing": ("PACKING", "READY_TO_SHIP"), "complete": ("SHIPPED", "COMPLETED")}
    before, after = transitions[action]
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        _require_state(order, before)
        if action in {"complete-picking", "complete-packing"} and data is None:
            _raise_error("Complete allocation quantities are required", 422)
        if action != "complete":
            items = sales_order_repo.get_order_items(order.id)
            balance_repo.lock_inventory([i.product_id for i in items])
            allocations = _allocations(sales_order_repo, order, items)
            for a in allocations:
                _source(db, a)
            if data is not None:
                submitted = {line.allocation_id: line.quantity for line in data.allocations}
                if set(submitted) != {a.id for a in allocations}:
                    _raise_error("Allocation membership must exactly match this order")
                field = "picked_quantity" if action == "complete-picking" else "packed_quantity"
                for a in allocations:
                    if submitted[a.id] != a.quantity:
                        _raise_error(f"Incomplete or excessive allocation quantity: {a.id}")
                    if field == "packed_quantity" and a.picked_quantity != a.quantity:
                        _raise_error(f"Allocation is not fully picked: {a.id}")
                    setattr(a, field, submitted[a.id])
                stage = "picked" if field == "picked_quantity" else "packed"
                setattr(order, stage + "_at", datetime.now(timezone.utc))
                setattr(order, stage + "_by_user_id", current_user.id)
        order.status = after
        _audit(db, order, current_user, action.upper().replace("-", "_"), before)
    return _result(order)


def scan_fulfillment_service(db, sales_order_repo, balance_repo, sales_order_id, current_user, data, packing=False):
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        _require_state(order, "PACKING" if packing else "PICKING")
        product = ProductRepository(db).get_active_by_barcode(data.barcode)
        if product is None:
            _raise_error("BARCODE_NOT_FOUND", 404)
        items = sales_order_repo.get_order_items(order.id)
        if product.id not in {i.product_id for i in items}:
            _raise_error("PRODUCT_NOT_IN_ORDER")
        balance_repo.lock_inventory([i.product_id for i in items])
        allocations = _allocations(sales_order_repo, order, items)
        matches = [a for a in allocations if a.product_id == product.id]
        if data.allocation_id is not None:
            matches = [a for a in matches if a.id == data.allocation_id]
        if len(matches) != 1:
            _raise_error("ALLOCATION_IDENTIFICATION_REQUIRED")
        a = matches[0]
        _source(db, a)
        field = "packed_quantity" if packing else "picked_quantity"
        limit = a.picked_quantity if packing else a.quantity
        current = getattr(a, field)
        if current is None or limit is None or current + data.quantity > limit:
            _raise_error("ALLOCATION_SCAN_EXCEEDS_REMAINING")
        setattr(a, field, current + data.quantity)
        _audit(db, order, current_user, "SCAN_PACK" if packing else "SCAN_PICK",
               detail=f"Allocation {a.id}; increment {data.quantity}; {field}={getattr(a, field)}")
    return {**_result(order), "allocation_id": a.id, "quantity": a.quantity,
            "picked_quantity": a.picked_quantity, "packed_quantity": a.packed_quantity}


def ship_sales_order_service(db: Session, sales_order_repo: SalesOrderRepository,
                             balance_repo: StockBalanceRepository, movement_repo: InventoryMovementRepository,
                             sales_order_id: int, current_user: Any) -> dict:
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        _require_state(order, "READY_TO_SHIP")
        items = sales_order_repo.get_order_items(order.id)
        balance_repo.lock_inventory([i.product_id for i in items])
        allocations = _allocations(sales_order_repo, order, items)
        demand, sources = {}, {}
        for a in allocations:
            if a.picked_quantity != a.quantity or a.packed_quantity != a.quantity:
                _raise_error(f"Allocation not completely picked and packed: {a.id}")
            balance = _source(db, a)
            _expiry(sales_order_repo, a)
            demand[balance.id] = demand.get(balance.id, Decimal(0)) + a.quantity
            sources[balance.id] = balance
        for balance_id, quantity in demand.items():
            b = sources[balance_id]
            if b.reserved_qty < quantity or b.on_hand_qty < quantity:
                _raise_error("Insufficient reserved or on-hand stock")
        for balance_id, quantity in demand.items():
            b = sources[balance_id]
            before = b.on_hand_qty
            b.on_hand_qty -= quantity
            b.reserved_qty -= quantity
            movement_repo.create(InventoryMovement(product_id=b.product_id, batch_id=b.batch_id,
                warehouse_id=b.warehouse_id, location_id=b.location_id, movement_type="SALES_SHIPMENT",
                quantity=-quantity, balance_before=before, balance_after=b.on_hand_qty,
                reference_type="SALES_ORDER", reference_id=order.id, reference_number=order.so_number,
                remark=f"Shipment from {order.so_number}", created_by_user_id=current_user.id))
        for item in items:
            sales_order_repo.create_stock_transaction(StockTransaction(product_id=item.product_id,
                transaction_type="SALE_SHIPMENT", quantity=-item.quantity, remark=f"Shipment from {order.so_number}"))
            balance_repo.sync_aggregates(item.product_id, current_user.username)
        order.shipment_number = f"SHIP-{order.id:06d}"
        order.shipped_at = datetime.now(timezone.utc)
        order.shipped_by_user_id = current_user.id
        order.status = "SHIPPED"
        _audit(db, order, current_user, "SHIP_SALES_ORDER", "READY_TO_SHIP")
    return _result(order)


def cancel_sales_order_service(db: Session, sales_order_repo: SalesOrderRepository,
                               balance_repo: StockBalanceRepository, sales_order_id: int, current_user: Any) -> dict:
    with UnitOfWork(db):
        order = _get_required_sales_order_for_update(sales_order_repo, sales_order_id)
        if order.status == "CANCELLED":
            _raise_error("Sales Order already cancelled")
        if order.status in {"SHIPPED", "COMPLETED"}:
            _raise_error("Completed Sales Order cannot be cancelled. Use sales return instead.")
        _require_state(order, "DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP")
        previous = order.status
        if previous != "DRAFT":
            items = sales_order_repo.get_order_items(order.id)
            balance_repo.lock_inventory([i.product_id for i in items])
            allocations = _allocations(sales_order_repo, order, items)
            demand, sources = {}, {}
            for a in allocations:
                b = _source(db, a)
                demand[b.id] = demand.get(b.id, Decimal(0)) + a.quantity
                sources[b.id] = b
            for balance_id, quantity in demand.items():
                if sources[balance_id].reserved_qty < quantity:
                    _raise_error("Reserved stock is lower than allocated quantity")
                sources[balance_id].reserved_qty -= quantity
        order.status = "CANCELLED"
        _audit(db, order, current_user, "CANCEL_SALES_ORDER", previous)
    return _result(order)


def get_sales_orders_service(sales_order_repo):
    return {"items": sales_order_repo.get_all_sales_orders()}


def get_sales_order_service(sales_order_repo, sales_order_id):
    order = _get_required_sales_order(sales_order_repo, sales_order_id)
    items = []
    for item in sales_order_repo.get_order_items(order.id):
        allocations = sales_order_repo.get_item_allocations(order.id, item.id)
        items.append({"id": item.id, "sales_order_id": order.id, "product_id": item.product_id,
                      "quantity": item.quantity, "unit_price": float(item.unit_price), "total_price": float(item.total_price),
                      "batch_allocations": [{"id": a.id, "batch_id": a.batch_id, "quantity": a.quantity}
                                            for a in allocations if a.batch_id is not None],
                      "fulfillment_allocations": [{"id": a.id, "batch_id": a.batch_id, "stock_balance_id": a.stock_balance_id,
                          "quantity": a.quantity, "picked_quantity": a.picked_quantity, "packed_quantity": a.packed_quantity}
                          for a in allocations]})
    return {"id": order.id, "so_number": order.so_number, "customer_id": order.customer_id,
            "status": order.status, "total_amount": float(order.total_amount), "created_at": order.created_at,
            "items": items, **{field: getattr(order, field) for field in ("picked_at", "picked_by_user_id",
                "packed_at", "packed_by_user_id", "shipped_at", "shipped_by_user_id", "shipment_number")}}


def _return_source(db, balance_repo, sales_order_repo, order, item, allocation=None):
    if allocation is None:
        rows = sales_order_repo.get_item_allocations(order.id, item.id)
        if rows:
            _validate_allocations(rows, item.quantity, item.id)
            if len(rows) != 1:
                _raise_error("Ambiguous non-batch return source")
            allocation = rows[0]
    if allocation is not None and allocation.stock_balance_id is not None:
        if allocation.product_id != item.product_id:
            _raise_error("Invalid return allocation ownership")
        return _source(db, allocation)
    if order.shipment_number is not None:
        _raise_error("Missing shipment source evidence")
    # Pre-Phase-4 completed orders used MAIN/DEFAULT exclusively. Retain that
    # existing return path without inventing fulfillment metadata or balances.
    if order.status != "COMPLETED":
        _raise_error("Missing legacy shipment evidence")
    if allocation is not None:
        return balance_repo.get_default_batch_balance_for_update(item.product_id, allocation.batch_id)
    return balance_repo.get_default_product_balance_for_update(item.product_id)

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

        if sales_order.status not in {"SHIPPED", "COMPLETED"}:
            _raise_error(
                message=(
                    "Only completed Sales Order "
                    "can be returned"
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        balance_repo.lock_inventory([item.product_id for item in data.items])

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

                    balance = _return_source(db, balance_repo, sales_order_repo, sales_order, sold_item, allocation)

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

                    balance.on_hand_qty += (
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
                balance = _return_source(db, balance_repo, sales_order_repo, sales_order, sold_item)

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

            balance_repo.sync_aggregates(product.id, current_user.username)

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
