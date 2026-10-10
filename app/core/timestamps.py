"""Phase 14C: interpreting timezone-naive ``created_at`` columns.

Naive ``now()`` values are wall-clock time in the PostgreSQL session
TimeZone active when the row was written. The application never reads the
*current* session TimeZone to interpret them (it says nothing about when
historical rows were written); it uses the declared
``settings.db_naive_timezone`` instead, verified per environment by the
``timestamp_provenance`` diagnostic. Every conversion here is pure Python,
so results never depend on the session the query happens to run in.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.batch_eligibility import business_day_bounds
from app.core.config import settings


def naive_storage_timezone() -> ZoneInfo:
    return ZoneInfo(settings.db_naive_timezone)


def to_utc(value: datetime | None) -> datetime | None:
    """A stored timestamp as an aware UTC instant. Naive values are read in
    the declared storage zone; aware values are just normalised."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=naive_storage_timezone())
    return value.astimezone(timezone.utc)


def utc_iso(value: datetime | None) -> str | None:
    """ISO-8601 with an explicit ``Z`` -- unambiguous for every client."""
    instant = to_utc(value)
    if instant is None:
        return None
    return instant.isoformat().replace("+00:00", "Z")


def _to_naive_storage(value: datetime) -> datetime:
    return value.astimezone(naive_storage_timezone()).replace(tzinfo=None)


def business_date_range_to_naive(
    from_date: date | None, to_date: date | None,
) -> tuple[datetime | None, datetime | None]:
    """Inclusive business days -> half-open ``[start, end)`` bounds expressed
    in the naive storage zone, ready to compare against naive columns."""
    start = _to_naive_storage(business_day_bounds(from_date)[0]) if from_date else None
    end = _to_naive_storage(business_day_bounds(to_date)[1]) if to_date else None
    return start, end
