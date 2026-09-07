"""Read-only Phase 6 migration checks; no application settings or reconciliation."""
import json
import os
from decimal import Decimal
from sqlalchemy import create_engine, text


def inspect_phase6_data(connection):
    if connection.dialect.name != "postgresql":
        raise RuntimeError("Phase 6 requires PostgreSQL")
    findings = []
    def fail(check, ids):
        findings.append({"check": check, "ids": list(ids)})
    orders = connection.execute(text("SELECT * FROM inventory_transfers ORDER BY id")).mappings().all()
    items = connection.execute(text("SELECT * FROM inventory_transfer_items ORDER BY id")).mappings().all()
    locations = {r['id']:r for r in connection.execute(text("SELECT * FROM warehouse_locations")).mappings()}
    warehouses = {r['id']:r for r in connection.execute(text("SELECT * FROM warehouses")).mappings()}
    products = {r['id']:r for r in connection.execute(text("SELECT * FROM products")).mappings()}
    batches = {r['id']:r for r in connection.execute(text("SELECT * FROM product_batches")).mappings()}
    movements = connection.execute(text("SELECT * FROM inventory_movements WHERE reference_type='INVENTORY_TRANSFER'")).mappings().all()
    order_ids = {o['id'] for o in orders}
    for item in items:
        if item['transfer_id'] not in order_ids:
            fail('item_ownership', [item['id']])
    for order in orders:
        rows = [i for i in items if i['transfer_id'] == order['id']]
        if order['status'] not in {'DRAFT','COMPLETED','CANCELLED'}:
            fail('unknown_status', [order['id']])
        if not rows:
            fail('empty_transfer', [order['id']])
        if order['source_warehouse_id'] == order['destination_warehouse_id']:
            fail('same_warehouse', [order['id']])
        seen = set()
        for item in rows:
            q = item['quantity']
            if q is None or not q.is_finite() or q <= 0 or q > Decimal('999999999999999.999') or q != q.quantize(Decimal('.001')):
                fail('quantity', [item['id']])
            key = tuple(item[k] for k in ('product_id','batch_id','from_location_id','to_location_id'))
            if key in seen:
                fail('duplicate_item', [item['id']])
            seen.add(key)
            for loc, wh in ((item['from_location_id'], order['source_warehouse_id']), (item['to_location_id'],order['destination_warehouse_id'])):
                if wh not in warehouses or loc not in locations or locations[loc]['warehouse_id'] != wh:
                    fail('storage_identity', [item['id']])
            if item['from_location_id'] == item['to_location_id']:
                fail('same_location', [item['id']])
            p = products.get(item['product_id'])
            b = batches.get(item['batch_id'])
            if p is None or bool(p['track_batch']) != (item['batch_id'] is not None) or (item['batch_id'] is not None and (b is None or b['product_id'] != item['product_id'])):
                fail('batch_product_identity', [item['id']])
        history = [m for m in movements if m['reference_id'] == order['id']]
        if order['status'] != 'COMPLETED' and history:
            fail('unexpected_movement_history', [order['id']])
        if order['status'] == 'COMPLETED':
            expected = []
            for i in rows:
                expected.extend([(i['product_id'], i['batch_id'], order['source_warehouse_id'],i['from_location_id'],'TRANSFER_OUT',-i['quantity']),
                                 (i['product_id'], i['batch_id'], order['destination_warehouse_id'],i['to_location_id'],'TRANSFER_IN',i['quantity'])])
            actual = [tuple(m[k] for k in ('product_id','batch_id','warehouse_id','location_id','movement_type','quantity')) for m in history]
            # Matching exact signed legs avoids guessing which item produced a movement.
            if len(set(expected)) != len(expected) or sorted(map(str,actual)) != sorted(map(str,expected)):
                fail('ambiguous_movement_history', [order['id']])
    for m in movements:
        if m['reference_id'] not in order_ids:
            fail('orphan_transfer_movement', [m['id']])
        if m['balance_before'] + m['quantity'] != m['balance_after']:
            fail('movement_arithmetic', [m['id']])
    conflicts = [w['id'] for w in warehouses.values() if w['warehouse_code'] == '__TRANSIT__' or w['warehouse_type'] == 'TRANSIT']
    conflicts += [l['id'] for l in locations.values() if l['location_code'] == '__TRANSIT__' or l['location_type'] == 'TRANSIT']
    if conflicts:
        fail('transit_configuration_conflict', conflicts)
    return findings


def require_phase6_compatible(connection):
    findings = inspect_phase6_data(connection)
    if findings:
        raise RuntimeError('Phase 6 preflight refused: ' + json.dumps(findings))


def main():
    url = os.environ.get('PHASE6_PREFLIGHT_DATABASE_URL')
    if not url:
        print('Explicit PHASE6_PREFLIGHT_DATABASE_URL required')
        return 2
    engine = None
    try:
        engine = create_engine(url, hide_parameters=True)
        with engine.connect().execution_options(isolation_level='REPEATABLE READ') as c:
            with c.begin():
                c.execute(text('SET TRANSACTION READ ONLY'))
                findings = inspect_phase6_data(c)
        print(json.dumps(findings, indent=2))
        return int(bool(findings))
    except Exception:
        print('Read-only preflight could not complete; no data was changed')
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
