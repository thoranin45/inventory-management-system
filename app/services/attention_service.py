"""Phase 8: read-only "Needs Attention" counts and drill-down queues.

Never runs the full inventory diagnostic in the request path. No locks.
"""
from decimal import Decimal

from app.core.batch_eligibility import business_today
from app.core.config import settings
from app.core.pagination import paginate, paginated_body, resolve_ordering, phase8_json
from app.models import Product

QUEUE_TYPES = {
    "low_stock",
    "expired",
    "near_expiry",
    "sales_blocked",
    "sales_picking",
    "sales_packing",
    "sales_ready",
    "po_partial",
    "transfer_in_transit",
    "transfer_partial",
}

_LOW_STOCK_FALLBACK = Decimal("10")
_SALES_STATUS_FOR_QUEUE = {
    "sales_picking": "PICKING",
    "sales_packing": "PACKING",
    "sales_ready": "READY_TO_SHIP",
}


def _low_stock_threshold(product) -> Decimal:
    safety = Decimal(str(product.safety_stock or 0))
    if safety > 0:
        return safety
    minimum = Decimal(str(product.minimum_stock or 0))
    if minimum > 0:
        return minimum
    return _LOW_STOCK_FALLBACK


def _low_stock_products(db, balance_repo, today):
    available = balance_repo.operational_available_by_product(today)
    products = db.query(Product).filter(Product.is_active.is_(True)).all()
    out = []
    for p in products:
        avail = available.get(p.id, Decimal("0"))
        if avail < _low_stock_threshold(p):
            out.append((p, avail))
    return out


def get_attention_summary_service(db, balance_repo, sales_repo, po_repo, transfer_repo) -> dict:
    today = business_today()
    categories = balance_repo.inventory_categories_by_product(today, settings.near_expiry_days)
    expired_products = sum(1 for c in categories.values() if c["expired_quantity"] > 0)
    near_products = sum(1 for c in categories.values() if c["near_expiry_quantity"] > 0)

    sales_counts = sales_repo.status_counts()
    po_counts = po_repo.status_counts()
    transfer_counts = transfer_repo.status_counts()
    blocked = sales_repo.all_blocked_by_expiry_ids(
        today, ["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP"]
    )

    body = {
        "low_operational_stock": len(_low_stock_products(db, balance_repo, today)),
        "expired_inventory_products": expired_products,
        "near_expiry_products": near_products,
        "sales_blocked_by_expiry": len(blocked),
        "sales_awaiting_picking": sales_counts.get("PICKING", 0),
        "sales_awaiting_packing": sales_counts.get("PACKING", 0),
        "sales_ready_to_ship": sales_counts.get("READY_TO_SHIP", 0),
        "po_partially_received": po_counts.get("PARTIALLY_RECEIVED", 0),
        "transfers_in_transit": transfer_counts.get("IN_TRANSIT", 0),
        "transfers_partially_received": transfer_counts.get("PARTIALLY_RECEIVED", 0),
        "as_of_date": today,
    }
    return {
        "success": True,
        "message": "Attention summary retrieved successfully",
        "data": phase8_json(body),
    }


def get_attention_queue_service(
    db, balance_repo, sales_repo, po_repo, transfer_repo, queue_type, params
) -> dict:
    from app.services.sales_order_service import get_sales_orders_service
    from app.services.purchase_order_service import get_purchase_orders_service
    from app.services.inventory_transfer_service import get_inventory_transfers_service

    today = business_today()

    if queue_type in _SALES_STATUS_FOR_QUEUE:
        params.status = _SALES_STATUS_FOR_QUEUE[queue_type]
        return get_sales_orders_service(sales_repo, params)
    if queue_type == "sales_blocked":
        params.status = "DRAFT,CONFIRMED,PICKING,PACKING,READY_TO_SHIP"
        body = get_sales_orders_service(sales_repo, params)
        body["data"]["items"] = [
            r for r in body["data"]["items"] if r["attention_reason"] == "expired_allocation"
        ]
        body["data"]["pagination"]["total_items"] = len(body["data"]["items"])
        body["message"] = "Attention queue retrieved successfully"
        return body
    if queue_type == "po_partial":
        params.status = "PARTIALLY_RECEIVED"
        return get_purchase_orders_service(po_repo, params)
    if queue_type == "transfer_in_transit":
        params.status = "IN_TRANSIT"
        return get_inventory_transfers_service(transfer_repo, params)
    if queue_type == "transfer_partial":
        params.status = "PARTIALLY_RECEIVED"
        return get_inventory_transfers_service(transfer_repo, params)

    # product-based queues
    categories = balance_repo.inventory_categories_by_product(today, settings.near_expiry_days)
    if queue_type == "expired":
        pids = [pid for pid, c in categories.items() if c["expired_quantity"] > 0]
    elif queue_type == "near_expiry":
        pids = [pid for pid, c in categories.items() if c["near_expiry_quantity"] > 0]
    else:  # low_stock
        pids = [p.id for p, _ in _low_stock_products(db, balance_repo, today)]

    ordering = resolve_ordering(params, {"id": Product.id, "product_name": Product.product_name}, "id", Product.id)
    query = db.query(Product).filter(Product.id.in_(pids or [-1]))
    items, total = paginate(query, params, ordering)
    available = balance_repo.operational_available_by_product(today)
    rows = []
    for p in items:
        cat = categories.get(p.id, {})
        rows.append({
            "type": "product",
            "id": p.id,
            "label": p.product_name,
            "sublabel": p.sku,
            "status": queue_type,
            "operational_available_quantity": available.get(p.id, Decimal("0")),
            "expired_quantity": cat.get("expired_quantity", Decimal("0")),
            "near_expiry_quantity": cat.get("near_expiry_quantity", Decimal("0")),
            "threshold": _low_stock_threshold(p) if queue_type == "low_stock" else None,
        })
    return paginated_body(rows, total, params, "Attention queue retrieved successfully")
