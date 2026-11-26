"""F0a: gapless document numbers (app.core.document_numbers)."""
import random
import string
import threading
from datetime import date

import pytest
from sqlalchemy import text

from app.core.document_numbers import allocate_number, format_number
from tests.conftest import TestingSessionLocal


def _doc_type() -> str:
    # each test gets its own counter in the shared per-run schema
    return "T" + "".join(random.choices(string.ascii_uppercase, k=7))


def test_format_uses_gregorian_year_and_four_digits():
    assert format_number("INV", 2026, 1) == "INV-2026-0001"
    assert format_number("INV", 2026, 12345) == "INV-2026-12345"


def test_numbers_run_consecutively_and_restart_each_year(db_session):
    kind = _doc_type()
    got = [allocate_number(db_session, kind, date(2026, 12, 31)) for _ in range(3)]
    got.append(allocate_number(db_session, kind, date(2027, 1, 1)))
    db_session.commit()
    assert got == [f"{kind}-2026-0001", f"{kind}-2026-0002", f"{kind}-2026-0003", f"{kind}-2027-0001"]


def test_rolled_back_allocation_does_not_consume_a_number(db_session):
    kind = _doc_type()
    assert allocate_number(db_session, kind, date(2026, 1, 5)) == f"{kind}-2026-0001"
    db_session.commit()
    assert allocate_number(db_session, kind, date(2026, 1, 5)) == f"{kind}-2026-0002"
    db_session.rollback()  # the document that took 0002 failed
    assert allocate_number(db_session, kind, date(2026, 1, 5)) == f"{kind}-2026-0002"
    db_session.commit()


def test_fifty_concurrent_issuers_get_fifty_consecutive_numbers():
    kind = _doc_type()
    results, errors = [], []
    start = threading.Barrier(50)

    def issue():
        db = TestingSessionLocal()
        try:
            start.wait()
            number = allocate_number(db, kind, date(2026, 6, 1))
            db.commit()
            results.append(number)
        except Exception as exc:  # pragma: no cover - surfaced by the assert below
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=issue) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert errors == []
    assert sorted(results) == [f"{kind}-2026-{n:04d}" for n in range(1, 51)]


@pytest.mark.parametrize("bad", ["", "inv", "I", "INVOICES9", "IN-V"])
def test_doc_type_must_be_short_uppercase(db_session, bad):
    with pytest.raises(ValueError):
        allocate_number(db_session, bad, date(2026, 1, 1))


def test_business_date_must_be_a_date(db_session):
    with pytest.raises(TypeError):
        allocate_number(db_session, "INV", "2026-01-01")


def test_database_rejects_bad_counter_rows(db_session):
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db_session.execute(text("INSERT INTO document_sequences (doc_type, year, next_value) VALUES ('INV', 2026, 0)"))
    db_session.rollback()


def test_a_datetime_is_refused_so_utc_instants_cannot_pick_the_year(db_session):
    from datetime import datetime, timezone
    with pytest.raises(TypeError):
        allocate_number(db_session, "INV", datetime(2026, 12, 31, 18, 0, tzinfo=timezone.utc))
    with pytest.raises(ValueError):
        allocate_number(db_session, "INV", date(1999, 12, 31))
