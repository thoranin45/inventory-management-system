"""Phase 8: PostgreSQL-native bounded global search. No external engine,
no pg_trgm. Exact/prefix identifier matches + bounded name substring.

Never returns users, audit logs, credentials, or admin-only write fields.
"""
from sqlalchemy import case, or_

from app.core.pagination import phase8_json
from app.models import (
    Customer,
    InventoryTransfer,
    ProductBatch,
    PurchaseOrder,
    Product,
    SalesOrder,
    Supplier,
)

ALL_TYPES = ["product", "sales_order", "purchase_order", "transfer", "batch", "customer", "supplier"]
_PER_TYPE = 8


def _rank(*pairs):
    return case(*pairs, else_=90)


def _products(db, q, limit):
    like_prefix, like_sub = f"{q}%", f"%{q}%"
    rank = _rank(
        (Product.barcode == q, 0),
        (Product.sku == q, 1),
        (Product.sku.ilike(like_prefix), 5),
        (Product.barcode.ilike(like_prefix), 6),
        (Product.product_name.ilike(like_prefix), 10),
        (Product.product_name.ilike(like_sub), 20),
    )
    rows = (
        db.query(Product, rank.label("rank"))
        .filter(
            Product.is_active.is_(True),
            or_(
                Product.barcode == q,
                Product.sku.ilike(like_prefix),
                Product.barcode.ilike(like_prefix),
                Product.product_name.ilike(like_sub),
            ),
        )
        .order_by("rank", Product.id)
        .limit(limit)
        .all()
    )
    return [
        (r, {
            "type": "product",
            "id": p.id,
            "label": p.product_name,
            "sublabel": p.sku,
            "status": "active" if p.is_active else "inactive",
            "url_hint": f"/products/{p.id}",
        })
        for p, r in rows
    ]


def _by_number(db, model, number_col, type_name, url_prefix, q, limit, label_col=None, status_col=None):
    like_prefix, like_sub = f"{q}%", f"%{q}%"
    rank = _rank((number_col == q, 0), (number_col.ilike(like_prefix), 5), (number_col.ilike(like_sub), 20))
    conds = [number_col.ilike(like_sub)]
    if label_col is not None:
        conds.append(label_col.ilike(like_sub))
    rows = (
        db.query(model, rank.label("rank"))
        .filter(or_(*conds))
        .order_by("rank", model.id)
        .limit(limit)
        .all()
    )
    out = []
    for obj, r in rows:
        out.append((r, {
            "type": type_name,
            "id": obj.id,
            "label": getattr(obj, number_col.key) or (getattr(obj, label_col.key) if label_col is not None else str(obj.id)),
            "sublabel": (getattr(obj, label_col.key) if label_col is not None else None),
            "status": getattr(obj, status_col.key) if status_col is not None else None,
            "url_hint": f"{url_prefix}/{obj.id}",
        }))
    return out


def global_search_service(db, q: str, types: list[str] | None, limit: int) -> dict:
    q = (q or "").strip()
    if len(q) < 2:
        return {
            "success": True,
            "message": "Global search results",
            "data": {"query": q, "results": [], "truncated": False},
        }

    wanted = set(types) if types else set(ALL_TYPES)
    per_type = min(_PER_TYPE, limit)
    ranked: list[tuple[int, dict]] = []
    truncated = False

    def collect(rows):
        nonlocal truncated
        if len(rows) >= per_type:
            truncated = True
        ranked.extend(rows)

    if "product" in wanted:
        collect(_products(db, q, per_type))
    if "sales_order" in wanted:
        collect(_by_number(db, SalesOrder, SalesOrder.so_number, "sales_order", "/sales-orders", q, per_type, status_col=SalesOrder.status))
    if "purchase_order" in wanted:
        collect(_by_number(db, PurchaseOrder, PurchaseOrder.po_number, "purchase_order", "/purchase-orders", q, per_type, status_col=PurchaseOrder.status))
    if "transfer" in wanted:
        collect(_by_number(db, InventoryTransfer, InventoryTransfer.transfer_number, "transfer", "/inventory-transfers", q, per_type, status_col=InventoryTransfer.status))
    if "batch" in wanted:
        collect(_by_number(db, ProductBatch, ProductBatch.lot_no, "batch", "/batches", q, per_type))
    if "customer" in wanted:
        collect(_by_number(db, Customer, Customer.customer_name, "customer", "/customers", q, per_type))
    if "supplier" in wanted:
        collect(_by_number(db, Supplier, Supplier.supplier_name, "supplier", "/suppliers", q, per_type))

    ranked.sort(key=lambda pair: pair[0])
    results = [row for _, row in ranked][:limit]
    if len(ranked) > limit:
        truncated = True

    return {
        "success": True,
        "message": "Global search results",
        "data": phase8_json({"query": q, "results": results, "truncated": truncated}),
    }
