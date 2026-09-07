"""Pure unit tests for the Phase 7 batch-eligibility helpers.

No database, no persisted status. Business date is injected, never read from the
system clock.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

import app.core.batch_eligibility as be
from app.core.batch_eligibility import (
    days_to_expiry,
    is_batch_eligible,
    is_expired,
    is_near_expiry,
)


class _Batch:
    def __init__(self, expiry_date):
        self.expiry_date = expiry_date


TODAY = date(2026, 6, 15)


# --------------------------------------------------------------------------- #
# business_today(): configured timezone, not process-local / UTC
# --------------------------------------------------------------------------- #
def test_business_today_uses_configured_timezone(monkeypatch):
    class _FrozenDatetime:
        @staticmethod
        def now(tz=None):
            # 2026-01-01 22:00 UTC == 2026-01-02 05:00 Asia/Bangkok
            base = datetime(2026, 1, 1, 22, 0, tzinfo=timezone.utc)
            return base.astimezone(tz) if tz is not None else base

    monkeypatch.setattr(be, "datetime", _FrozenDatetime)
    # Bangkok business day, one ahead of the UTC calendar day.
    assert be.business_today() == date(2026, 1, 2)


def test_business_timezone_is_overridable(monkeypatch):
    monkeypatch.setattr(be.settings, "timezone", "UTC")

    class _FrozenDatetime:
        @staticmethod
        def now(tz=None):
            base = datetime(2026, 1, 1, 22, 0, tzinfo=timezone.utc)
            return base.astimezone(tz) if tz is not None else base

    monkeypatch.setattr(be, "datetime", _FrozenDatetime)
    assert be.business_today() == date(2026, 1, 1)


# --------------------------------------------------------------------------- #
# expiry boundary
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("delta,expired", [(-1, True), (0, False), (1, False), (365, False)])
def test_is_expired_boundary(delta, expired):
    batch = _Batch(TODAY + timedelta(days=delta))
    assert is_expired(batch, TODAY) is expired
    assert is_batch_eligible(batch, TODAY) is (not expired)


def test_null_expiry_never_expires():
    assert is_expired(_Batch(None), TODAY) is False
    assert is_batch_eligible(_Batch(None), TODAY) is True
    assert days_to_expiry(_Batch(None), TODAY) is None
    assert is_near_expiry(_Batch(None), TODAY) is False


def test_days_to_expiry_values():
    assert days_to_expiry(_Batch(TODAY + timedelta(days=5)), TODAY) == 5
    assert days_to_expiry(_Batch(TODAY), TODAY) == 0
    assert days_to_expiry(_Batch(TODAY - timedelta(days=3)), TODAY) == -3


def test_helpers_accept_bare_date_and_mapping():
    assert is_expired(TODAY - timedelta(days=1), TODAY) is True
    assert is_batch_eligible({"expiry_date": TODAY}, TODAY) is True
    assert days_to_expiry({"expiry_date": None}, TODAY) is None


def test_helpers_fall_back_to_business_today(business_date):
    business_date(TODAY)
    assert is_expired(_Batch(TODAY - timedelta(days=1))) is True
    assert is_batch_eligible(_Batch(TODAY)) is True


# --------------------------------------------------------------------------- #
# near expiry
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("delta,near", [
    (-1, False),   # already expired -> not "near", it's gone
    (0, True),
    (1, True),
    (90, True),    # exact threshold
    (91, False),   # threshold + 1
])
def test_is_near_expiry_default_threshold(delta, near):
    assert is_near_expiry(_Batch(TODAY + timedelta(days=delta)), TODAY) is near


def test_near_expiry_threshold_is_configurable(monkeypatch):
    monkeypatch.setattr(be.settings, "near_expiry_days", 30)
    assert is_near_expiry(_Batch(TODAY + timedelta(days=30)), TODAY) is True
    assert is_near_expiry(_Batch(TODAY + timedelta(days=31)), TODAY) is False


def test_near_expiry_explicit_threshold_argument():
    assert is_near_expiry(_Batch(TODAY + timedelta(days=7)), TODAY, threshold_days=7) is True
    assert is_near_expiry(_Batch(TODAY + timedelta(days=8)), TODAY, threshold_days=7) is False
