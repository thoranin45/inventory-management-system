"""Seed V3 foundation master data (units + MAIN warehouse/location).

Idempotent, but it writes to a real database. Phase 9 guard: it will not run
against the application ``DATABASE_URL`` silently.

    SEED_CONFIRM=1 python scripts/seed_v3_foundation.py            # app DATABASE_URL
    SEED_CONFIRM=1 SEED_DATABASE_URL=postgresql://... python scripts/seed_v3_foundation.py

Without SEED_CONFIRM=1 the script prints the target database name and exits.
"""
import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database import SessionLocal as AppSessionLocal
from app.database import engine as app_engine
from app.models import Unit, Warehouse, WarehouseLocation


def _session_factory():
    override = os.environ.get("SEED_DATABASE_URL")
    if override:
        engine = create_engine(override)
        return sessionmaker(bind=engine, autoflush=False, autocommit=False), engine
    return AppSessionLocal, app_engine


SessionLocal, _seed_bind = _session_factory()


UNITS = [
    {
        "code": "KG",
        "name": "Kilogram",
        "unit_type": "WEIGHT",
        "decimal_places": 3,
    },
    {
        "code": "G",
        "name": "Gram",
        "unit_type": "WEIGHT",
        "decimal_places": 3,
    },
    {
        "code": "PCS",
        "name": "Piece",
        "unit_type": "QUANTITY",
        "decimal_places": 0,
    },
    {
        "code": "BOX",
        "name": "Box",
        "unit_type": "PACKAGING",
        "decimal_places": 0,
    },
    {
        "code": "BAG",
        "name": "Bag",
        "unit_type": "PACKAGING",
        "decimal_places": 0,
    },
    {
        "code": "L",
        "name": "Liter",
        "unit_type": "VOLUME",
        "decimal_places": 3,
    },
    {
        "code": "ML",
        "name": "Milliliter",
        "unit_type": "VOLUME",
        "decimal_places": 3,
    },
]


def seed_units(db):
    for unit_data in UNITS:
        existing = (
            db.query(Unit)
            .filter(Unit.code == unit_data["code"])
            .first()
        )

        if existing is None:
            db.add(Unit(**unit_data))
            print(f"Created unit: {unit_data['code']}")
        else:
            print(f"Unit already exists: {unit_data['code']}")


def seed_main_warehouse(db):
    warehouse = (
        db.query(Warehouse)
        .filter(Warehouse.warehouse_code == "MAIN")
        .first()
    )

    if warehouse is None:
        warehouse = Warehouse(
            warehouse_code="MAIN",
            warehouse_name="Main Warehouse",
            warehouse_type="MAIN",
            is_active=True,
        )

        db.add(warehouse)
        db.flush()

        print("Created warehouse: MAIN")
    else:
        print("Warehouse already exists: MAIN")

    location = (
        db.query(WarehouseLocation)
        .filter(
            WarehouseLocation.warehouse_id == warehouse.id,
            WarehouseLocation.location_code == "DEFAULT",
        )
        .first()
    )

    if location is None:
        db.add(
            WarehouseLocation(
                warehouse_id=warehouse.id,
                location_code="DEFAULT",
                location_name="Default Location",
                location_type="STORAGE",
                is_active=True,
            )
        )

        print("Created location: DEFAULT")
    else:
        print("Location already exists: DEFAULT")


def main():
    try:
        db_name = make_url(str(_seed_bind.url)).database
    except Exception:
        db_name = "<unknown>"

    if os.environ.get("SEED_CONFIRM") != "1":
        print(
            "Refusing to seed without confirmation.\n"
            f"  Target database: {db_name}\n"
            "  Re-run with SEED_CONFIRM=1 (and optionally SEED_DATABASE_URL=...)."
        )
        return 2

    print(f"Seeding V3 foundation into database: {db_name}")
    db = SessionLocal()

    try:
        seed_units(db)
        seed_main_warehouse(db)

        db.commit()

        print("V3 foundation seed completed.")
        return 0

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main() or 0)