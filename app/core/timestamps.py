"""Phase 14C: row-level timestamp provenance for inventory movements.

``inventory_movements.created_at`` is a naive ``now()`` -- wall-clock time in
the session TimeZone of whichever writer inserted the row, which is recorded
nowhere. No setting, cutover date or current-session lookup can prove that
zone for an individual row, so none is used.

Proof is per row instead: ``recorded_at_utc`` (TIMESTAMPTZ, migration
ea1a00000004) is stamped by the DATABASE's ``DEFAULT now()`` on every new
row -- an explicit instant, whatever the writer's session zone.

- VERIFIED row (``recorded_at_utc`` set): its instant is known exactly;
  ``occurred_at`` comes from it, and business-day filters use it with exact
  Asia/Bangkok day boundaries.
- UNVERIFIED row (``recorded_at_utc`` NULL -- all history from before the
  revision): no instant is claimed (``occurred_at`` is None). Business-day
  filters match its naive ``created_at`` conservatively: included if it could
  fall in the range under ANY real-world UTC offset (UTC-12..UTC+14), so an
  uncertain row is never silently dropped (it may be over-included by up to
  14 hours on either edge, and is flagged ``timestamp_verified=false``).

Nothing here rewrites stored values; ``created_at`` and the legacy
``date_from``/``date_to`` filters are untouched.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.core.batch_eligibility import business_day_bounds

# Extremes of real-world civil time: UTC-12 (Baker Island) .. UTC+14 (Kiribati).
_MAX_BEHIND_UTC = timedelta(hours=12)
_MAX_AHEAD_OF_UTC = timedelta(hours=14)


def utc_iso(instant: datetime | None) -> str | None:
    """An AWARE instant as ISO-8601 with an explicit ``Z``. Naive values are
    refused (``None``): their zone is unknown, so no instant may be claimed."""
    if instant is None or instant.tzinfo is None:
        return None
    return instant.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class BusinessDayBounds:
    """One inclusive business-day range.

    ``exact_*`` are aware instants, compared with ``recorded_at_utc`` (verified
    rows). ``possible_*`` are naive wall-clock bounds, compared with
    ``created_at`` of unverified rows: every value that maps into the range
    under some UTC offset in [-12h, +14h].
    """
    exact_start: datetime
    exact_end: datetime
    possible_start: datetime
    possible_end: datetime


def business_day_range(from_date: date, to_date: date) -> BusinessDayBounds:
    start = business_day_bounds(from_date)[0]
    end = business_day_bounds(to_date)[1]
    utc_wall = lambda value: value.astimezone(timezone.utc).replace(tzinfo=None)  # noqa: E731
    return BusinessDayBounds(
        exact_start=start,
        exact_end=end,
        # wall clock = instant + offset, offset in [-12h, +14h]
        possible_start=utc_wall(start) - _MAX_BEHIND_UTC,
        possible_end=utc_wall(end) + _MAX_AHEAD_OF_UTC,
    )
