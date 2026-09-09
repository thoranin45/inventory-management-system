"""Phase 8: one standard collection contract for the Web App.

Every targeted list endpoint returns::

    {"success": true, "message": "...",
     "data": {"items": [...],
              "pagination": {"page", "page_size", "total_items", "total_pages"}}}

Quantity/money Decimals are emitted as fixed-scale JSON strings (the DB scale is
preserved: Numeric(18,3) -> "20.000", Numeric(10,2) -> "120.00"). Business
arithmetic stays Decimal internally; only the serialization boundary changes.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException, Query
from fastapi.encoders import jsonable_encoder

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def phase8_json(value):
    """jsonable_encoder with fixed-scale string Decimals for the frontend contract."""
    return jsonable_encoder(
        value,
        custom_encoder={Decimal: lambda d: format(d, "f")},
    )


@dataclass
class ListParams:
    page: int
    page_size: int
    search: str | None
    status: str | None
    sort_by: str | None
    sort_order: str


def list_params(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, max_length=50),
    sort_by: str | None = Query(default=None, max_length=40),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> ListParams:
    return ListParams(
        page=page,
        page_size=page_size,
        search=(search.strip() or None) if search else None,
        status=(status.strip() or None) if status else None,
        sort_by=(sort_by.strip() or None) if sort_by else None,
        sort_order=sort_order,
    )


def resolve_ordering(params: ListParams, allowed: dict, default_key: str, id_column):
    """Return an ORDER BY list from an explicit per-endpoint allow-list.

    ``id`` is always appended as a deterministic tiebreaker. Unknown sort field -> 422.
    """
    key = params.sort_by or default_key
    if key not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown sort field: {params.sort_by}",
        )
    column = allowed[key]
    direction = (lambda c: c.asc()) if params.sort_order == "asc" else (lambda c: c.desc())
    ordering = [direction(column)]
    if key != "id":
        ordering.append(direction(id_column))
    return ordering


def paginate(query, params: ListParams, ordering):
    """(items, total) for a SQLAlchemy query, bounded by page_size."""
    total = query.order_by(None).count()
    items = (
        query.order_by(*ordering)
        .offset((params.page - 1) * params.page_size)
        .limit(params.page_size)
        .all()
    )
    return items, total


def paginated_body(items, total: int, params: ListParams, message: str) -> dict:
    total_pages = math.ceil(total / params.page_size) if total else 0
    return {
        "success": True,
        "message": message,
        "data": {
            "items": phase8_json(items),
            "pagination": {
                "page": params.page,
                "page_size": params.page_size,
                "total_items": total,
                "total_pages": total_pages,
            },
        },
    }
