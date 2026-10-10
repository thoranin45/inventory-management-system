"""Phase 14C: interpreting timezone-naive ``created_at`` columns.

Naive ``now()`` values are wall-clock time in the PostgreSQL session
TimeZone active when the row was written. The application never reads the
*current* session TimeZone to interpret them -- it says nothing about when
historical rows were written.

A naive timestamp is VERIFIED only when a mechanism guaranteed its zone:
it was written while ``settings.db_session_timezone_pin`` pinned every
application connection to ``settings.db_naive_timezone``, i.e. at or after
``settings.db_timezone_pinned_since``. Everything else is UNVERIFIED -- the
declared zone is then only an assumption, so:

- no definitive ``occurred_at`` instant is given for it, and
- business-day filters match it conservatively: a row is included if it
  could fall in the range under ANY real-world UTC offset (UTC-12..UTC+14),
  so an uncertain row is never silently dropped (it may be over-included
  by up to 14 hours on either edge; callers flag it via
  ``timestamp_verified``).

Every conversion here is pure Python, so results never depend on the
session the query happens to run in. Stored values are never rewritten.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.batch_eligibility import business_day_bounds
from app.core.config import settings

# Extremes of real-world civil time: UTC-12 (Baker Island) .. UTC+14 (Kiribati).
_MAX_BEHIND_UTC = timedelta(hours=12)
_MAX_AHEAD_OF_UTC = timedelta(hours=14)


def naive_storage_timezone() -> ZoneInfo:
    return ZoneInfo(settings.db_naive_timezone)


def _to_naive_storage(value: datetime) -> datetime:
    return value.astimezone(naive_storage_timezone()).replace(tzinfo=None)


def _to_naive_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def verified_since_naive() -> datetime | None:
    """First naive storage value with a proven zone, or ``None`` if none is
    proven (pin disabled, or its start instant not declared)."""
    if not settings.db_session_timezone_pin or settings.db_timezone_pinned_since is None:
        return None
    return _to_naive_storage(settings.db_timezone_pinned_since)


def is_verified(value: datetime | None) -> bool:
    if value is None:
        return False
    if value.tzinfo is not None:
        return True  # timestamptz: the instant is stored explicitly
    since = verified_since_naive()
    return since is not None and value >= since


def to_utc(value: datetime | None) -> datetime | None:
    """A stored timestamp as an aware UTC instant, read in the declared
    storage zone. Use ``verified_occurred_at`` for anything presented as a
    definitive instant."""
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


def verified_occurred_at(value: datetime | None) -> str | None:
    """The definitive instant, or ``None`` when the storage zone is unproven."""
    return utc_iso(value) if is_verified(value) else None


@dataclass(frozen=True)
class BusinessDayBounds:
    """Half-open naive bounds for one inclusive business-day range.

    ``exact_*`` apply to verified rows (declared storage zone, proven).
    ``possible_*`` apply to unverified rows: every naive value that maps into
    the range under some UTC offset in [-12h, +14h].
    """
    exact_start: datetime
    exact_end: datetime
    possible_start: datetime
    possible_end: datetime
    verified_since: datetime | None


def business_day_range(from_date: date, to_date: date) -> BusinessDayBounds:
    start = business_day_bounds(from_date)[0]
    end = business_day_bounds(to_date)[1]
    return BusinessDayBounds(
        exact_start=_to_naive_storage(start),
        exact_end=_to_naive_storage(end),
        # wall clock w = instant + offset, offset in [-12h, +14h]
        possible_start=_to_naive_utc(start) - _MAX_BEHIND_UTC,
        possible_end=_to_naive_utc(end) + _MAX_AHEAD_OF_UTC,
        verified_since=verified_since_naive(),
    )
