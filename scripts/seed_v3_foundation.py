from app.database import SessionLocal
from app.models import Unit, Warehouse, WarehouseLocation


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
    db = SessionLocal()

    try:
        seed_units(db)
        seed_main_warehouse(db)

        db.commit()

        print("V3 foundation seed completed.")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    main()