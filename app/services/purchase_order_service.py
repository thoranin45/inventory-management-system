from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import (
    DuplicateLotNumberException,
    InvalidBatchDateException,
    InvalidPurchaseOrderStatusException,
    MissingPurchaseOrderReceiveItemException,
    ProductNotFoundException,
    PurchaseOrderAlreadyReceivedException,
    PurchaseOrderCancelledException,
    PurchaseOrderNotFoundException,
    SupplierNotFoundException,
    UnexpectedPurchaseOrderReceiveItemException,
    PurchaseOrderOverReceiveException,
)
from app.core.unit_of_work import UnitOfWork
from app.models import (
    AuditLog,
    ProductBatch,
    PurchaseOrder,
    PurchaseOrderItem,
    StockTransaction,
    InventoryMovement,
)
from app.repositories.batch_repository import BatchRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.purchase_order_repository import (
    PurchaseOrderRepository,
)
from app.repositories.stock_repository import StockRepository
from app.repositories.supplier_repository import SupplierRepository
from app.schemas.purchase_order_schema import (
    PurchaseOrderActionResponse,
    PurchaseOrderCreate,
    PurchaseOrderItemResponse,
    PurchaseOrderReceiveResponse,
    PurchaseOrderResponse,
    PurchaseOrderSummaryResponse,
    ReceivePO,
    ReceivedBatchResponse,
)
from app.repositories.inventory_movement_repository import (
    InventoryMovementRepository,
)
from app.repositories.stock_balance_repository import (
    StockBalanceRepository,
)

PO_STATUS_PENDING = "PENDING"
PO_STATUS_PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED"
PO_STATUS_RECEIVED = "RECEIVED"
PO_STATUS_CANCELLED = "CANCELLED"


def _calculate_item_total(
    quantity: Decimal,
    unit_price: Decimal,
) -> Decimal:
    return quantity * unit_price


def _build_po_response(
    po: PurchaseOrder,
    items: list[PurchaseOrderItem],
) -> PurchaseOrderResponse:
    response_items: list[
        PurchaseOrderItemResponse
    ] = []

    total_amount = Decimal("0.00")

    for item in items:
        item_total = _calculate_item_total(
            quantity=item.quantity,
            unit_price=item.unit_price,
        )

        total_amount += item_total

        response_items.append(
            PurchaseOrderItemResponse(
                id=item.id,
                po_id=item.po_id,
                product_id=item.product_id,
                quantity=item.quantity,
                received_quantity=(
                    item.received_quantity
                ),
                remaining_quantity=(
                    item.quantity
                    - item.received_quantity
                ),
                unit_price=item.unit_price,
                total_price=item_total,
            )
        )

    return PurchaseOrderResponse(
        id=po.id,
        po_number=po.po_number,
        supplier_id=po.supplier_id,
        status=po.status,
        total_amount=total_amount,
        created_at=po.created_at,
        items=response_items,
    )


def create_purchase_order_service(
    db: Session,
    po_repo: PurchaseOrderRepository,
    supplier_repo: SupplierRepository,
    product_repo: ProductRepository,
    data: PurchaseOrderCreate,
    current_user: Any,
) -> PurchaseOrderResponse:
    supplier = supplier_repo.get_by_id(
        data.supplier_id
    )

    if supplier is None:
        raise SupplierNotFoundException()

    validated_products = {}

    for request_item in data.items:
        product = product_repo.get_by_id(
            request_item.product_id
        )

        if product is None:
            raise ProductNotFoundException()

        validated_products[
            request_item.product_id
        ] = product

    po = PurchaseOrder(
        po_number="TEMP",
        supplier_id=data.supplier_id,
        status=PO_STATUS_PENDING,
    )

    created_items: list[PurchaseOrderItem] = []

    with UnitOfWork(db) as uow:
        po_repo.create(po)

        po.po_number = f"PO-{po.id:06d}"

        for request_item in data.items:
            po_item = PurchaseOrderItem(
                po_id=po.id,
                product_id=request_item.product_id,
                quantity=request_item.quantity,
                unit_price=request_item.unit_price,
            )

            po_repo.create_item(po_item)
            created_items.append(po_item)

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_PURCHASE_ORDER",
            table_name="purchase_orders",
            record_id=po.id,
            description=(
                f"Create {po.po_number} "
                f"with {len(created_items)} item(s)"
            ),
        )

        db.add(audit)

    uow.refresh(po)

    for item in created_items:
        uow.refresh(item)

    return _build_po_response(
        po=po,
        items=created_items,
    )


def get_purchase_orders_service(
    po_repo: PurchaseOrderRepository,
) -> list[PurchaseOrderSummaryResponse]:
    purchase_orders = po_repo.get_all()

    results: list[
        PurchaseOrderSummaryResponse
    ] = []

    for po in purchase_orders:
        items = po_repo.get_items(po.id)

        total_amount = sum(
            (
                _calculate_item_total(
                    item.quantity,
                    item.unit_price,
                )
                for item in items
            ),
            Decimal("0.00"),
        )

        results.append(
            PurchaseOrderSummaryResponse(
                id=po.id,
                po_number=po.po_number,
                supplier_id=po.supplier_id,
                status=po.status,
                total_amount=total_amount,
                created_at=po.created_at,
            )
        )

    return results


def get_purchase_order_service(
    po_repo: PurchaseOrderRepository,
    po_id: int,
) -> PurchaseOrderResponse:
    po = po_repo.get_by_id(po_id)

    if po is None:
        raise PurchaseOrderNotFoundException()

    items = po_repo.get_items(po.id)

    return _build_po_response(
        po=po,
        items=items,
    )


def receive_purchase_order_service(
    db: Session,
    po_repo: PurchaseOrderRepository,
    product_repo: ProductRepository,
    batch_repo: BatchRepository,
    stock_repo: StockRepository,
    balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository,
    po_id: int,
    data: ReceivePO,
    current_user: Any,
) -> PurchaseOrderReceiveResponse:

    received_batches: list[
        ReceivedBatchResponse
    ] = []

    with UnitOfWork(db) as uow:
        # =====================================================
        # Lock Purchase Order
        # =====================================================
        po = po_repo.get_by_id_for_update(
            po_id
        )

        if po is None:
            raise PurchaseOrderNotFoundException()

        if po.status == PO_STATUS_RECEIVED:
            raise PurchaseOrderAlreadyReceivedException()

        if po.status == PO_STATUS_CANCELLED:
            raise PurchaseOrderCancelledException()

        if po.status not in {
            PO_STATUS_PENDING,
            PO_STATUS_PARTIALLY_RECEIVED,
        }:
            raise InvalidPurchaseOrderStatusException()

        po_items = po_repo.get_items_for_update(
            po.id
        )

        po_items_by_product = {
            item.product_id: item
            for item in po_items
        }

        # =====================================================
        # Validate request
        # =====================================================
        for receive_item in data.items:
            po_item = po_items_by_product.get(
                receive_item.product_id
            )

            if po_item is None:
                raise (
                    UnexpectedPurchaseOrderReceiveItemException(
                        receive_item.product_id
                    )
                )

            remaining_quantity = (
                po_item.quantity
                - po_item.received_quantity
            )

            if (
                receive_item.quantity
                > remaining_quantity
            ):
                raise PurchaseOrderOverReceiveException(
                    receive_item.product_id
                )

            if (
                receive_item.expiry_date
                <= receive_item.mfg_date
            ):
                raise InvalidBatchDateException()

            existing_batch = (
                batch_repo.get_by_lot_no(
                    receive_item.lot_no
                )
            )

            if existing_batch is not None:
                raise DuplicateLotNumberException()

        # =====================================================
        # Apply receive
        # =====================================================
        for receive_item in data.items:
            po_item = po_items_by_product[
                receive_item.product_id
            ]

            product = product_repo.get_by_id_for_update(
                receive_item.product_id
            )

            if product is None:
                raise ProductNotFoundException()

            new_batch = ProductBatch(
                product_id=product.id,
                lot_no=receive_item.lot_no,
                mfg_date=receive_item.mfg_date,
                expiry_date=receive_item.expiry_date,
                quantity=receive_item.quantity,
            )

            batch = (
                batch_repo.create_if_lot_not_exists(
                    new_batch
                )
            )

            if batch is None:
                raise DuplicateLotNumberException()

            product.stock_qty += (
                receive_item.quantity
            )

            po_item.received_quantity += (
                receive_item.quantity
            )

            balance = (
                balance_repo
                .create_default_batch_balance(
                    product_id=product.id,
                    batch_id=batch.id,
                    on_hand_qty=(
                        receive_item.quantity
                    ),
                )
            )

            transaction = StockTransaction(
                product_id=product.id,
                transaction_type="IN_PO",
                quantity=receive_item.quantity,
                remark=(
                    f"Receive from {po.po_number}; "
                    f"Lot: {receive_item.lot_no}"
                ),
            )

            stock_repo.create_transaction(
                transaction
            )

            movement = InventoryMovement(
                product_id=product.id,
                batch_id=batch.id,
                warehouse_id=balance.warehouse_id,
                location_id=balance.location_id,
                movement_type="PURCHASE_RECEIPT",
                quantity=receive_item.quantity,
                balance_before=Decimal("0"),
                balance_after=receive_item.quantity,
                reference_type="PURCHASE_ORDER",
                reference_id=po.id,
                reference_number=po.po_number,
                remark=(
                    f"Lot: {receive_item.lot_no}"
                ),
                created_by_user_id=current_user.id,
            )

            movement_repo.create(
                movement
            )

            received_batches.append(
                ReceivedBatchResponse(
                    batch_id=batch.id,
                    product_id=product.id,
                    lot_no=batch.lot_no,
                    received_quantity=(
                        receive_item.quantity
                    ),
                    current_stock=(
                        product.stock_qty
                    ),
                )
            )

        # =====================================================
        # Update PO status
        # =====================================================
        all_received = all(
            item.received_quantity
            >= item.quantity
            for item in po_items
        )

        if all_received:
            po.status = PO_STATUS_RECEIVED
        else:
            po.status = (
                PO_STATUS_PARTIALLY_RECEIVED
            )

        po_repo.update(
            po
        )

        # =====================================================
        # Audit
        # =====================================================
        audit = AuditLog(
            username=current_user.username,
            action="RECEIVE_PURCHASE_ORDER",
            table_name="purchase_orders",
            record_id=po.id,
            description=(
                f"Receive {po.po_number}; "
                f"{len(received_batches)} "
                "batch(es); "
                f"status={po.status}"
            ),
        )

        db.add(
            audit
        )

    uow.refresh(
        po
    )

    return PurchaseOrderReceiveResponse(
        id=po.id,
        po_number=po.po_number,
        status=po.status,
        received_batches=received_batches,
    )


def cancel_purchase_order_service(
    db: Session,
    po_repo: PurchaseOrderRepository,
    po_id: int,
    current_user: Any,
) -> PurchaseOrderActionResponse:

    with UnitOfWork(db) as uow:
        po = po_repo.get_by_id_for_update(
            po_id
        )

        if po is None:
            raise PurchaseOrderNotFoundException()

        if po.status == PO_STATUS_RECEIVED:
            raise PurchaseOrderAlreadyReceivedException()

        if po.status == PO_STATUS_CANCELLED:
            raise PurchaseOrderCancelledException()

        # PO ที่รับของไปบางส่วนแล้ว
        # ไม่ควร Cancel ตรง ๆ เพราะมี stock เข้าไปแล้ว
        if po.status == PO_STATUS_PARTIALLY_RECEIVED:
            raise InvalidPurchaseOrderStatusException()

        if po.status != PO_STATUS_PENDING:
            raise InvalidPurchaseOrderStatusException()

        po.status = PO_STATUS_CANCELLED

        po_repo.update(
            po
        )

        audit = AuditLog(
            username=current_user.username,
            action="CANCEL_PURCHASE_ORDER",
            table_name="purchase_orders",
            record_id=po.id,
            description=(
                f"Cancel {po.po_number}"
            ),
        )

        db.add(
            audit
        )

    uow.refresh(
        po
    )

    return PurchaseOrderActionResponse(
        id=po.id,
        po_number=po.po_number,
        status=po.status,
    )