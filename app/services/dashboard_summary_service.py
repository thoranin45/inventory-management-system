"""Phase 8: additive operational dashboard summary. Read-only, READ COMMITTED,
no locks. Never changes GET /dashboard semantics or Product.stock_qty."""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func

from app.core.batch_eligibility import business_day_bounds, business_today
from app.core.config import settings
from app.core.pagination import phase8_json
from app.models import Product

_SALES_ACTIVE = {"DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP"}


def get_dashboard_summary_service(db, balance_repo, sales_repo, po_repo, transfer_repo) -> dict:
    today = business_today()
    day_start, day_end = business_day_bounds(today)

    owned = db.query(
        func.coalesce(func.sum(Product.stock_qty), 0)
    ).filter(Product.is_active.is_(True)).scalar()
    inv = balance_repo.inventory_category_totals(today, settings.near_expiry_days)

    sales_counts = sales_repo.status_counts()
    po_counts = po_repo.status_counts()
    transfer_counts = transfer_repo.status_counts()

    blocked = sales_repo.all_blocked_by_expiry_ids(today, sorted(_SALES_ACTIVE))
    po_pending = po_counts.get("CONFIRMED", 0) + po_counts.get("PARTIALLY_RECEIVED", 0)

    body = {
        "inventory": {
            "owned_quantity": Decimal(str(owned)),
            "operational_available_quantity": inv["operational_available_quantity"],
            "reserved_quantity": inv["reserved_quantity"],
            "expired_quantity": inv["expired_quantity"],
            "near_expiry_quantity": inv["near_expiry_quantity"],
            "in_transit_quantity": inv["in_transit_quantity"],
        },
        "sales": {
            "DRAFT": sales_counts.get("DRAFT", 0),
            "CONFIRMED": sales_counts.get("CONFIRMED", 0),
            "PICKING": sales_counts.get("PICKING", 0),
            "PACKING": sales_counts.get("PACKING", 0),
            "READY_TO_SHIP": sales_counts.get("READY_TO_SHIP", 0),
            "shipped_today": sales_repo.shipped_today_count(day_start, day_end),
            "attention_required": len(blocked),
        },
        "purchase_orders": {
            "DRAFT": po_counts.get("DRAFT", 0),
            "CONFIRMED": po_counts.get("CONFIRMED", 0),
            "PARTIALLY_RECEIVED": po_counts.get("PARTIALLY_RECEIVED", 0),
            "received_today": po_repo.received_today_count(day_start, day_end),
            "pending_receiving": po_pending,
        },
        "transfers": {
            "DRAFT": transfer_counts.get("DRAFT", 0),
            "IN_TRANSIT": transfer_counts.get("IN_TRANSIT", 0),
            "PARTIALLY_RECEIVED": transfer_counts.get("PARTIALLY_RECEIVED", 0),
            "completed_today": transfer_repo.completed_today_count(day_start, day_end),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of_date": today,
    }
    return {
        "success": True,
        "message": "Dashboard summary retrieved successfully",
        "data": phase8_json(body),
    }
