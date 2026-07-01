from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models import (
    Supplier,
    Product,
    ProductBatch,
    StockTransaction,
    PurchaseOrder,
    PurchaseOrderItem,
    AuditLog,
)
from app.schemas.purchase_order_schema import PurchaseOrderCreate, ReceivePO
from app.core.dependencies import require_admin

router = APIRouter(
    prefix="/purchase-orders",
    tags=["Purchase Orders"],
)


@router.post("/")
def create_po(
    data: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    supplier = db.query(Supplier).filter(
        Supplier.id == data.supplier_id
    ).first()

    if supplier is None:
        raise HTTPException(
            status_code=404,
            detail="Supplier not found",
        )

    try:
        po = PurchaseOrder(
            po_number="TEMP",
            supplier_id=data.supplier_id,
            status="PENDING",
        )

        db.add(po)
        db.flush()

        po.po_number = f"PO-{po.id:06d}"

        for item in data.items:
            product = db.query(Product).filter(
                Product.id == item.product_id,
                Product.is_active == True,
            ).first()

            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {item.product_id}",
                )

            po_item = PurchaseOrderItem(
                po_id=po.id,
                product_id=item.product_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
            )

            db.add(po_item)

        audit = AuditLog(
            username=current_user.username,
            action="CREATE_PURCHASE_ORDER",
            table_name="purchase_orders",
            record_id=po.id,
            description=f"Create {po.po_number}",
        )

        db.add(audit)
        db.commit()
        db.refresh(po)

    except HTTPException:
        db.rollback()
        raise

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Purchase order duplicate data",
        )

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to create purchase order",
        )

    return {
        "message": "PO Created",
        "po_id": po.id,
        "po_number": po.po_number,
    }


@router.get("/")
def get_purchase_orders(db: Session = Depends(get_db)):
    return db.query(PurchaseOrder).all()


@router.get("/{po_id}")
def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
):
    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.id == po_id
    ).first()

    if po is None:
        raise HTTPException(
            status_code=404,
            detail="Purchase Order not found",
        )

    items = db.query(PurchaseOrderItem).filter(
        PurchaseOrderItem.po_id == po.id
    ).all()

    return {
        "id": po.id,
        "po_number": po.po_number,
        "supplier_id": po.supplier_id,
        "status": po.status,
        "created_at": po.created_at,
        "items": items,
    }


@router.post("/{po_id}/receive")
def receive_purchase_order(
    po_id: int,
    data: ReceivePO,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.id == po_id
    ).first()

    if po is None:
        raise HTTPException(
            status_code=404,
            detail="Purchase Order not found",
        )

    if po.status == "RECEIVED":
        raise HTTPException(
            status_code=400,
            detail="PO already received",
        )

    po_items = db.query(PurchaseOrderItem).filter(
        PurchaseOrderItem.po_id == po.id
    ).all()

    try:
        for po_item in po_items:
            product = db.query(Product).filter(
                Product.id == po_item.product_id,
                Product.is_active == True,
            ).first()

            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {po_item.product_id}",
                )

            receive_item = next(
                (
                    item for item in data.items
                    if item.product_id == po_item.product_id
                ),
                None,
            )

            if receive_item is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing receive data for product_id {po_item.product_id}",
                )

            if receive_item.expiry_date <= receive_item.mfg_date:
                raise HTTPException(
                    status_code=400,
                    detail="Expiry date must be after manufacturing date",
                )

            existing_lot = db.query(ProductBatch).filter(
                ProductBatch.lot_no == receive_item.lot_no
            ).first()

            if existing_lot:
                raise HTTPException(
                    status_code=400,
                    detail=f"Lot number already exists: {receive_item.lot_no}",
                )

            batch = ProductBatch(
                product_id=po_item.product_id,
                lot_no=receive_item.lot_no,
                mfg_date=receive_item.mfg_date,
                expiry_date=receive_item.expiry_date,
                quantity=po_item.quantity,
            )

            product.stock_qty += po_item.quantity

            transaction = StockTransaction(
                product_id=po_item.product_id,
                transaction_type="PO_RECEIVE",
                quantity=po_item.quantity,
                remark=f"Receive from {po.po_number}",
            )

            db.add(batch)
            db.add(transaction)

        po.status = "RECEIVED"

        audit = AuditLog(
            username=current_user.username,
            action="RECEIVE_PURCHASE_ORDER",
            table_name="purchase_orders",
            record_id=po.id,
            description=f"Receive {po.po_number}",
        )

        db.add(audit)
        db.commit()

    except HTTPException:
        db.rollback()
        raise

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Receive PO duplicate data",
        )

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to receive purchase order",
        )

    return {
        "message": "PO Received",
        "po_id": po.id,
        "status": po.status,
    }