import hashlib
import json
from uuid import uuid4
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import (
    AppException, DuplicateLotNumberException,
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
    AuditLog, PurchaseOrderReceipt,
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
    ReceivedBatchResponse, ReceivedItemResponse,
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
        po_number=None,
        supplier_id=data.supplier_id,
        status="DRAFT",
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


def _receipt_fingerprint(po_id: int, data: ReceivePO) -> str:
    # Defaults are a stable request token, not a lookup of mutable master data.
    payload = {"version": 1, "po_id": po_id,
               "storage": "MAIN/DEFAULT" if data.warehouse_id is None and data.location_id is None else [data.warehouse_id, data.location_id],
               "items": [{"product_id": i.product_id, "quantity": format(i.quantity, ".3f"),
                          "lot_no": i.lot_no, "mfg_date": i.mfg_date.isoformat() if i.mfg_date else None,
                          "expiry_date": i.expiry_date.isoformat() if i.expiry_date else None}
                         for i in sorted(data.items, key=lambda i: i.product_id)]}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def confirm_purchase_order_service(db, po_repo, product_repo, po_id, current_user):
    with UnitOfWork(db):
        po = po_repo.get_by_id_for_update(po_id)
        if po is None:
            raise PurchaseOrderNotFoundException()
        if po.status != "DRAFT":
            raise InvalidPurchaseOrderStatusException()
        items = po_repo.get_items_for_update(po.id)
        if not items or len({i.product_id for i in items}) != len(items):
            raise InvalidPurchaseOrderStatusException()
        for item in items:
            if item.quantity <= 0 or item.received_quantity != 0:
                raise InvalidPurchaseOrderStatusException()
            if product_repo.get_by_id(item.product_id) is None:
                raise ProductNotFoundException()
        po.status = "CONFIRMED"
        db.add(AuditLog(username=current_user.username, action="CONFIRM_PURCHASE_ORDER", table_name="purchase_orders",
                        record_id=po.id, description=f"Confirm {po.po_number}: DRAFT -> CONFIRMED"))
    return PurchaseOrderActionResponse(id=po.id, po_number=po.po_number, status=po.status)


def receive_purchase_order_service(
    db: Session, po_repo: PurchaseOrderRepository, product_repo: ProductRepository,
    batch_repo: BatchRepository, stock_repo: StockRepository, balance_repo: StockBalanceRepository,
    movement_repo: InventoryMovementRepository, po_id: int, data: ReceivePO, current_user: Any,
    operation_key: str,
) -> PurchaseOrderReceiveResponse:
    fingerprint = _receipt_fingerprint(po_id, data)
    with UnitOfWork(db):
        po = po_repo.get_by_id_for_update(po_id)
        if po is None:
            raise PurchaseOrderNotFoundException()
        existing = po_repo.get_receipt(po.id, operation_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise AppException(message="Idempotency-Key already used with a different payload", status_code=409)
            return PurchaseOrderReceiveResponse.model_validate(existing.response_snapshot)
        if po.status == PO_STATUS_RECEIVED:
            raise PurchaseOrderAlreadyReceivedException()
        if po.status == PO_STATUS_CANCELLED:
            raise PurchaseOrderCancelledException()
        if po.status not in {"CONFIRMED", PO_STATUS_PARTIALLY_RECEIVED}:
            raise InvalidPurchaseOrderStatusException()
        po_items = po_repo.get_items_for_update(po.id)
        by_product = {i.product_id: i for i in po_items}
        if not po_items or len(by_product) != len(po_items):
            raise InvalidPurchaseOrderStatusException()
        for line in data.items:
            item = by_product.get(line.product_id)
            if item is None:
                raise UnexpectedPurchaseOrderReceiveItemException(line.product_id)
            if line.quantity > item.quantity - item.received_quantity:
                raise PurchaseOrderOverReceiveException(line.product_id)
        balance_repo.lock_inventory([line.product_id for line in data.items])
        warehouse, location = balance_repo.resolve_storage(data.warehouse_id, data.location_id)
        products = {}
        for line in data.items:
            product = product_repo.get_by_id_for_update(line.product_id)
            if product is None:
                raise ProductNotFoundException()
            products[product.id] = product
            if product.track_expiry and not product.track_batch:
                raise AppException(message="Invalid product tracking configuration", status_code=409)
            if not product.track_batch:
                if any(v is not None for v in (line.lot_no, line.mfg_date, line.expiry_date)):
                    raise AppException(message="Non-batch products cannot receive lot or date metadata", status_code=422)
            else:
                if line.lot_no is None:
                    raise AppException(message="Batch product requires lot_no", status_code=422)
                if product.track_expiry and (line.mfg_date is None or line.expiry_date is None):
                    raise AppException(message="Expiry-tracked product requires manufacturing and expiry dates", status_code=422)
                if line.expiry_date is not None and line.mfg_date is not None and line.expiry_date <= line.mfg_date:
                    raise InvalidBatchDateException()
                if batch_repo.get_by_lot_no(product.id, line.lot_no) is not None:
                    raise DuplicateLotNumberException()
        receipt = po_repo.create_receipt(PurchaseOrderReceipt(po_id=po.id,
            receipt_number="POR-" + uuid4().hex, operation_key=operation_key,
            request_fingerprint=fingerprint, received_by_user_id=current_user.id, response_snapshot={}))
        received_batches, received_items = [], []
        for line in data.items:
            product = products[line.product_id]
            item = by_product[product.id]
            batch = None
            if product.track_batch:
                batch = batch_repo.create_if_lot_not_exists(ProductBatch(product_id=product.id,
                    lot_no=line.lot_no, mfg_date=line.mfg_date, expiry_date=line.expiry_date, quantity=Decimal(0)))
                if batch is None:
                    raise DuplicateLotNumberException()
            balance = balance_repo.get_or_create_balance(product_id=product.id, warehouse_id=warehouse.id,
                location_id=location.id, batch_id=batch.id if batch else None)
            before = balance.on_hand_qty
            balance.on_hand_qty += line.quantity
            item.received_quantity += line.quantity
            transaction = stock_repo.create_transaction(StockTransaction(product_id=product.id,
                transaction_type="IN_PO", quantity=line.quantity,
                remark=f"Receive from {po.po_number}; Receipt: {receipt.receipt_number}"))
            movement_repo.create(InventoryMovement(product_id=product.id, batch_id=batch.id if batch else None,
                warehouse_id=balance.warehouse_id, location_id=balance.location_id, movement_type="PURCHASE_RECEIPT",
                quantity=line.quantity, balance_before=before, balance_after=balance.on_hand_qty,
                reference_type="PURCHASE_ORDER", reference_id=po.id, reference_number=po.po_number,
                remark=f"Receipt: {receipt.receipt_number}", created_by_user_id=current_user.id,
                purchase_receipt_id=receipt.id, purchase_order_item_id=item.id, stock_transaction_id=transaction.id))
            balance_repo.sync_aggregates(product.id, current_user.username)
            received_items.append(ReceivedItemResponse(po_item_id=item.id, product_id=product.id,
                batch_id=batch.id if batch else None, stock_balance_id=balance.id,
                received_quantity=line.quantity, current_stock=product.stock_qty))
            if batch:
                received_batches.append(ReceivedBatchResponse(batch_id=batch.id, product_id=product.id,
                    lot_no=batch.lot_no, received_quantity=line.quantity, current_stock=product.stock_qty))
        po.status = PO_STATUS_RECEIVED if all(i.received_quantity == i.quantity for i in po_items) else PO_STATUS_PARTIALLY_RECEIVED
        result = PurchaseOrderReceiveResponse(id=po.id, po_number=po.po_number, status=po.status,
            receipt_id=receipt.id, receipt_number=receipt.receipt_number,
            received_batches=received_batches, received_items=received_items)
        receipt.response_snapshot = result.model_dump(mode="json")
        db.add(AuditLog(username=current_user.username, action="RECEIVE_PURCHASE_ORDER", table_name="purchase_orders",
            record_id=po.id, description=f"Receive {po.po_number}; {receipt.receipt_number}; status={po.status}"))
    return result


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

        if po.status not in {"DRAFT", "CONFIRMED"}:
            raise InvalidPurchaseOrderStatusException()

        items = po_repo.get_items_for_update(po.id)
        if not items or any(item.received_quantity != 0 for item in items):
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
