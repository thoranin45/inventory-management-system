"""Single source of truth for batch expiry / FEFO eligibility (Phase 7).

Pure helpers only. Nothing here reads or writes the database, and no derived
status is ever persisted. Every inventory expiry decision in the system routes
through ``business_today`` so the rule is timezone-correct and consistent:

    expiry_date <  business_today()  -> expired / operationally ineligible
    expiry_date == business_today()  -> usable
    expiry_date >  business_today()  -> usable
    expiry_date is None              -> usable (never expires)

``Product.stock_qty`` and ``ProductBatch.quantity`` keep their Phase 2 meaning
(total owned physical inventory, including expired and in-transit stock); these
helpers only classify individual batches.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings


def business_timezone() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def business_today() -> date:
    """Current business-calendar date in the configured timezone (default Asia/Bangkok)."""
    return datetime.now(business_timezone()).date()


def business_day_bounds(day: date | None = None) -> tuple[datetime, datetime]:
    """[start, end) timezone-aware datetimes for a business calendar day."""
    tz = business_timezone()
    day = day or business_today()
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def _expiry_of(batch) -> date | None:
    """Accept an ORM ``ProductBatch``, a mapping row, or a bare date/None."""
    if batch is None:
        return None
    if isinstance(batch, date):
        return batch
    if isinstance(batch, dict):
        return batch.get("expiry_date")
    return getattr(batch, "expiry_date", None)


def days_to_expiry(batch, today: date | None = None) -> int | None:
    """Whole days from ``today`` to the batch expiry. ``None`` when expiry is unknown.

    Negative once expired. ``0`` on the last usable day.
    """
    expiry = _expiry_of(batch)
    if expiry is None:
        return None
    if today is None:
        today = business_today()
    return (expiry - today).days


def is_expired(batch, today: date | None = None) -> bool:
    """True only when a known expiry date is strictly before the business date."""
    expiry = _expiry_of(batch)
    if expiry is None:
        return False
    if today is None:
        today = business_today()
    return expiry < today


def is_batch_eligible(batch, today: date | None = None) -> bool:
    """Operationally selectable for Sales / Stock Out. NULL expiry stays eligible."""
    return not is_expired(batch, today)


def is_near_expiry(batch, today: date | None = None, threshold_days: int | None = None) -> bool:
    """Not yet expired, but within the configured near-expiry window."""
    remaining = days_to_expiry(batch, today)
    if remaining is None or remaining < 0:
        return False
    if threshold_days is None:
        threshold_days = settings.near_expiry_days
    return remaining <= threshold_days
