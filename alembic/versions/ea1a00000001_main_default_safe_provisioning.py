"""Phase 14B: safe, idempotent MAIN/DEFAULT warehouse/location provisioning.

Every Stock In/Out/Adjust call that omits explicit warehouse_id/location_id
resolves to the warehouse coded "MAIN" and its location coded "DEFAULT"
(see StockBalanceRepository.get_default_storage). Until now that row was
seeded only by a standalone manual script (scripts/seed_v3_foundation.py),
never by a migration -- unlike "__TRANSIT__", which e61a00000001 seeds
unconditionally. A fresh environment that skips the script breaks every
stock mutation that relies on the default.

This migration is NOT a bare INSERT like e61a00000001's, and deliberately
so: unlike __TRANSIT__, MAIN/DEFAULT may already exist in an already-seeded
environment (this exact history). ON CONFLICT DO NOTHING makes this
idempotent and inert on an existing row -- it never updates is_active,
warehouse_name, or any other column of a row that's already there. It only
ever fills in the row's absence.

Downgrade is intentionally a no-op: upgrade() never unconditionally creates
anything (unlike __TRANSIT__'s migration, which can therefore safely delete
what it unconditionally created on downgrade), so this migration cannot
distinguish a row it created from one that pre-dated it. Deleting real
business data on that guess is not acceptable, so downgrade reverses
nothing.

Revision ID: ea1a00000001
Revises: e91a00000001
"""
from alembic import op

revision = "ea1a00000001"
down_revision = "e91a00000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO warehouses (warehouse_code, warehouse_name, warehouse_type, is_active)
        VALUES ('MAIN', 'Main Warehouse', 'MAIN', true)
        ON CONFLICT (warehouse_code) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO warehouse_locations (warehouse_id, location_code, location_name, location_type, is_active)
        SELECT id, 'DEFAULT', 'Default Location', 'STORAGE', true
        FROM warehouses WHERE warehouse_code = 'MAIN'
        ON CONFLICT (warehouse_id, location_code) DO NOTHING
        """
    )


def downgrade() -> None:
    # Intentionally irreversible -- see rationale in the module docstring.
    pass
