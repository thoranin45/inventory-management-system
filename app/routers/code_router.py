from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os
import qrcode
import barcode
from barcode.writer import ImageWriter

from app.database import get_db
from app.models import Product

router = APIRouter(prefix="/codes", tags=["Codes"])


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

    folder = "app/static/barcodes"
    os.makedirs(folder, exist_ok=True)

    filename = f"{folder}/{product.barcode}"

    code128 = barcode.get(
        "code128",
        product.barcode,
        writer=ImageWriter()
    )

    full_path = code128.save(filename)

    return FileResponse(
        full_path,
        media_type="image/png",
        filename=f"{product.barcode}.png"
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

    folder = "app/static/qrcodes"
    os.makedirs(folder, exist_ok=True)

    qr_data = {
        "product_id": product.id,
        "sku": product.sku,
        "barcode": product.barcode,
        "product_name": product.product_name,
    }

    img = qrcode.make(str(qr_data))

    file_path = f"{folder}/{product.sku}_qr.png"
    img.save(file_path)

    return FileResponse(
        file_path,
        media_type="image/png",
        filename=f"{product.sku}_qr.png"
    )