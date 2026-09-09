"""Protected transit balances and durable transfer receiving.

Revision ID: e61a00000001
Revises: e51a00000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from scripts.check_phase6_preflight import require_phase6_compatible

revision = 'e61a00000001'
down_revision = 'e51a00000001'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('LOCK TABLE inventory_transfers, inventory_transfer_items, inventory_movements, warehouses, warehouse_locations, products, product_batches IN ACCESS EXCLUSIVE MODE')
    require_phase6_compatible(op.get_bind())
    op.add_column('inventory_transfers', sa.Column('dispatched_at', sa.DateTime(timezone=True)))
    op.add_column('inventory_transfers', sa.Column('dispatched_by_user_id', sa.Integer(), sa.ForeignKey('users.id')))
    op.add_column('inventory_transfers', sa.Column('legacy_completed', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    for field in ('dispatched_quantity','received_quantity'):
        op.add_column('inventory_transfer_items', sa.Column(field,sa.Numeric(18,3)))
    for field in ('source_stock_balance_id','transit_stock_balance_id'):
        op.add_column('inventory_transfer_items',sa.Column(field,sa.Integer(),sa.ForeignKey('stock_balances.id')))
    op.execute("UPDATE inventory_transfers SET legacy_completed=true WHERE status='COMPLETED'")
    op.execute("UPDATE inventory_transfer_items SET dispatched_quantity=0,received_quantity=0 WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE status IN ('DRAFT','CANCELLED'))")
    op.create_check_constraint('ck_transfer_item_progress','inventory_transfer_items', '(dispatched_quantity IS NULL AND received_quantity IS NULL) OR (dispatched_quantity IS NOT NULL AND received_quantity IS NOT NULL AND received_quantity >= 0 AND received_quantity <= dispatched_quantity AND dispatched_quantity <= quantity AND (dispatched_quantity = 0 OR dispatched_quantity = quantity))')
    op.create_table('inventory_transfer_receipts',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('transfer_id',sa.Integer(),sa.ForeignKey('inventory_transfers.id'),nullable=False),
        sa.Column('receipt_number',sa.String(100),nullable=False),
        sa.Column('operation_key',sa.String(128),nullable=False),
        sa.Column('request_fingerprint',sa.String(64),nullable=False),
        sa.Column('received_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.func.now()),
        sa.Column('received_by_user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('response_snapshot',JSONB(),nullable=False),
        sa.UniqueConstraint('receipt_number',name='inventory_transfer_receipts_receipt_number_key'),
        sa.UniqueConstraint('transfer_id','operation_key',name='uq_transfer_receipt_operation'))
    for field,table in (('transfer_item_id','inventory_transfer_items'),('transfer_receipt_id','inventory_transfer_receipts')):
        op.add_column('inventory_movements',sa.Column(field,sa.Integer(),sa.ForeignKey(table+'.id')))
    op.execute("INSERT INTO warehouses(warehouse_code,warehouse_name,warehouse_type) VALUES ('__TRANSIT__','System transit','TRANSIT')")
    op.execute("INSERT INTO warehouse_locations(warehouse_id,location_code,location_name,location_type) SELECT id,'__TRANSIT__','System transit','TRANSIT' FROM warehouses WHERE warehouse_code='__TRANSIT__'")


def downgrade():
    op.execute('LOCK TABLE inventory_transfers, inventory_transfer_items, inventory_transfer_receipts, inventory_movements, stock_balances, warehouses, warehouse_locations IN ACCESS EXCLUSIVE MODE')
    c=op.get_bind()
    if c.scalar(sa.text("SELECT count(*) FROM inventory_transfers WHERE dispatched_at IS NOT NULL OR status NOT IN ('DRAFT','CANCELLED','COMPLETED') OR (status='COMPLETED' AND NOT legacy_completed)")) or c.scalar(sa.text('SELECT count(*) FROM inventory_transfer_receipts')) or c.scalar(sa.text('SELECT count(*) FROM inventory_transfer_items WHERE dispatched_quantity > 0 OR source_stock_balance_id IS NOT NULL OR transit_stock_balance_id IS NOT NULL')) or c.scalar(sa.text('SELECT count(*) FROM inventory_movements WHERE transfer_item_id IS NOT NULL OR transfer_receipt_id IS NOT NULL')):
        raise RuntimeError('Cannot downgrade transfer lifecycle/history')
    if c.scalar(sa.text("SELECT count(*) FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE w.warehouse_code='__TRANSIT__'")):
        raise RuntimeError('Cannot downgrade transit balance history')
    op.execute("DELETE FROM warehouse_locations WHERE warehouse_id IN (SELECT id FROM warehouses WHERE warehouse_code='__TRANSIT__')")
    op.execute("DELETE FROM warehouses WHERE warehouse_code='__TRANSIT__'")
    for field in ('transfer_receipt_id','transfer_item_id'):
        op.drop_column('inventory_movements',field)
    op.drop_table('inventory_transfer_receipts')
    op.drop_constraint('ck_transfer_item_progress','inventory_transfer_items',type_='check')
    for field in ('source_stock_balance_id','transit_stock_balance_id','dispatched_quantity','received_quantity'):
        op.drop_column('inventory_transfer_items',field)
    for field in ('dispatched_at','dispatched_by_user_id','legacy_completed'):
        op.drop_column('inventory_transfers',field)
