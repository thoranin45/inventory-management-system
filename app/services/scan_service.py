"""Phase 8: read-only barcode resolver for the frontend Scan button.

Uses the SAME ProductRepository barcode lookup as scan-pick / scan-pack — no
duplicate barcode truth. Never mutates stock.
"""
from decimal import Decimal

from app.core import batch_eligibility
from app.core.config import settings
from app.core.exceptions import ProductNotFoundException
from app.core.pagination import phase8_json
from app.models import ProductBatch


def resolve_barcode_service(db, product_repo, balance_repo, barcode: str, context: str) -> dict:
    product = product_repo.get_active_by_barcode(barcode)
    if product is None:
        raise ProductNotFoundException()

    today = batch_eligibility.business_today()
    near_days = settings.near_expiry_days

    op_available = balance_repo.operational_available_quantity(product.id, today)

    batches = []
    if product.track_batch:
        rows = (
            db.query(ProductBatch)
            .filter(ProductBatch.product_id == product.id)
            .order_by(
                ProductBatch.expiry_date.asc().nulls_last(),
                ProductBatch.created_at.asc(),
                ProductBatch.id.asc(),
            )
            .all()
        )
        cat = balance_repo.inventory_categories_by_batch(today, near_days, [b.id for b in rows])
        for b in rows:
            bc = cat.get(b.id, {})
            batches.append({
                "id": b.id,
                "lot_no": b.lot_no,
                "expiry_date": b.expiry_date,
                "days_to_expiry": batch_eligibility.days_to_expiry(b, today),
                "is_expired": batch_eligibility.is_expired(b, today),
                "is_near_expiry": batch_eligibility.is_near_expiry(b, today, near_days),
                "operational_available_quantity": bc.get("operational_available_quantity", Decimal("0")),
            })

    body = {
        "barcode": barcode,
        "context": context,
        "product": {
            "id": product.id,
            "sku": product.sku,
            "product_name": product.product_name,
            "track_batch": product.track_batch,
            "track_expiry": product.track_expiry,
            "operational_available_quantity": op_available,
        },
        "batches": batches,
        "as_of_date": today,
    }
    return {
        "success": True,
        "message": "Barcode resolved",
        "data": phase8_json(body),
    }
