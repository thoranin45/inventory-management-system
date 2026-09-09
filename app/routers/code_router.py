from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import json
import os
import qrcode
import barcode
from barcode.writer import ImageWriter

from app.core.safe_paths import resolve_within
from app.database import get_db
from app.models import Product

router = APIRouter(dependencies=[Depends(require_warehouse)], prefix="/codes", tags=["Codes"])

_BARCODE_DIR = "app/static/barcodes"
_QRCODE_DIR = "app/static/qrcodes"


@router.get("/products/{product_id}/barcode")
def generate_barcode(
    product_id: int,
    db: Session = Depends(get_db)
):
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.is_active == True
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if not product.barcode:
        raise HTTPException(status_code=404, detail="Product has no barcode")

    os.makedirs(_BARCODE_DIR, exist_ok=True)

    # Server-controlled name from the numeric id; the barcode value is only a
    # payload for the image, never a path component.
    target = resolve_within(_BARCODE_DIR, f"product_{product.id}")

    code128 = barcode.get(
        "code128",
        product.barcode,
        writer=ImageWriter()
    )

    full_path = code128.save(str(target))

    return FileResponse(
        full_path,
        media_type="image/png",
        filename=f"product_{product.id}_barcode.png"
    )


@router.get("/products/{product_id}/qrcode")
def generate_qrcode(
    product_id: int,
    db: Session = Depends(get_db)
):
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.is_active == True
    ).first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    os.makedirs(_QRCODE_DIR, exist_ok=True)

    qr_data = {
        "product_id": product.id,
        "sku": product.sku,
        "barcode": product.barcode,
        "product_name": product.product_name,
    }

    img = qrcode.make(json.dumps(qr_data))

    file_path = resolve_within(_QRCODE_DIR, f"product_{product.id}_qr.png")
    img.save(str(file_path))

    return FileResponse(
        str(file_path),
        media_type="image/png",
        filename=f"product_{product.id}_qr.png"
    )
