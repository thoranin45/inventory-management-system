"""F0a: gapless running numbers for finance documents.

``allocate_number(db, "INV", date(2026, 11, 26))`` -> ``"INV-2026-0001"``.

- One counter per (doc_type, calendar year, Gregorian); each year starts at 1.
- The counter row is locked (``SELECT ... FOR UPDATE``) and advanced inside
  the CALLER's transaction. The caller commits the document and the counter
  together; if it rolls back, the number is released with it, so issued
  numbers never skip. A PostgreSQL SEQUENCE would skip on rollback.
- Concurrent issuers of the same type and year queue on the row lock (one at
  a time); different types or years do not block each other.
- The date passed in must be the document's business date (Asia/Bangkok,
  ``business_today()``), never a UTC timestamp.
"""
import re
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

_DOC_TYPE = re.compile(r"[A-Z]{2,8}")


def format_number(doc_type: str, year: int, value: int) -> str:
    return f"{doc_type}-{year:04d}-{value:04d}"


def allocate_number(db: Session, doc_type: str, business_date: date) -> str:
    if not _DOC_TYPE.fullmatch(doc_type or ""):
        raise ValueError("doc_type must be 2-8 uppercase letters")
    if not isinstance(business_date, date):
        raise TypeError("business_date must be a date")
    year = business_date.year

    db.execute(
        text(
            "INSERT INTO document_sequences (doc_type, year, next_value) "
            "VALUES (:doc_type, :year, 1) ON CONFLICT (doc_type, year) DO NOTHING"
        ),
        {"doc_type": doc_type, "year": year},
    )
    value = db.execute(
        text(
            "SELECT next_value FROM document_sequences "
            "WHERE doc_type = :doc_type AND year = :year FOR UPDATE"
        ),
        {"doc_type": doc_type, "year": year},
    ).scalar_one()
    db.execute(
        text(
            "UPDATE document_sequences SET next_value = next_value + 1 "
            "WHERE doc_type = :doc_type AND year = :year"
        ),
        {"doc_type": doc_type, "year": year},
    )
    return format_number(doc_type, year, value)
