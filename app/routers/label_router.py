from app.core.dependencies import require_warehouse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from sqlalchemy.orm import Session

from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Image
)

from reportlab.lib.styles import getSampleStyleSheet

import os

from app.database import get_db
from app.models import Product

router = APIRouter(dependencies=[Depends(require_warehouse)],
    prefix="/labels",
    tags=["Labels"]
)

@router.get("/product/{product_id}")
def generate_product_label(
    product_id: int,
    db: Session = Depends(get_db)
):

    product = db.query(Product).filter(
        Product.id == product_id
    ).first()

    if not product:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    barcode_file = (
        f"app/static/barcodes/{product.barcode}.png"
    )

    qr_file = (
        f"app/static/qrcodes/{product.sku}_qr.png"
    )

    # Phase 8: self-heal missing code images so the label never renders text-only.
    if product.barcode and not os.path.exists(barcode_file):
        try:
            import barcode as _bc
            from barcode.writer import ImageWriter

            os.makedirs("app/static/barcodes", exist_ok=True)
            _bc.get("code128", product.barcode, writer=ImageWriter()).save(
                f"app/static/barcodes/{product.barcode}"
            )
        except Exception:
            pass
    if not os.path.exists(qr_file):
        try:
            import json as _json
            import qrcode as _qr

            os.makedirs("app/static/qrcodes", exist_ok=True)
            _qr.make(_json.dumps({
                "product_id": product.id, "sku": product.sku,
                "barcode": product.barcode, "product_name": product.product_name,
            })).save(qr_file)
        except Exception:
            pass

    os.makedirs(
        "app/static/labels",
        exist_ok=True
    )

    pdf_file = (
        f"app/static/labels/{product.sku}.pdf"
    )

    doc = SimpleDocTemplate(pdf_file)

    styles = getSampleStyleSheet()

    elements = []

    elements.append(
        Paragraph(
            product.product_name,
            styles["Title"]
        )
    )

    elements.append(
        Paragraph(
            f"SKU : {product.sku}",
            styles["Normal"]
        )
    )

    elements.append(
        Paragraph(
            f"Barcode : {product.barcode}",
            styles["Normal"]
        )
    )

    elements.append(
        Spacer(1, 10)
    )

    if os.path.exists(barcode_file):
        elements.append(
            Image(
                barcode_file,
                width=250,
                height=60
            )
        )

    elements.append(
        Spacer(1, 10)
    )

    if os.path.exists(qr_file):
        elements.append(
            Image(
                qr_file,
                width=120,
                height=120
            )
        )

    doc.build(elements)

    return FileResponse(
        pdf_file,
        media_type="application/pdf",
        filename=f"{product.sku}.pdf"
    )
