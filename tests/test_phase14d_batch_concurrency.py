"""Phase 14D -- batch approvals racing real inventory writers.

Each pair of requests is held on the product row lock until both PostgreSQL
backends visibly wait, then released together (``overlap``). Commit order is
not controlled, so every test accepts exactly the outcomes valid for EITHER
order. The ``concurrent_inventory`` fixture then asserts ledger == physical
and aggregate consistency for every product.
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.models import StockAdjustmentRequest, StockBalance, StockTransaction, User
from tests import test_sales_order as sales
from tests.test_inventory_concurrency import concurrent_inventory, overlap  # noqa: F401


def _lot_product(s, quantity="10.000"):
    product = s.client.post("/api/v1/products", json={
        "sku": f"14D-{uuid4().hex[:10].upper()}", "barcode": f"886{uuid4().hex[:10]}",
        "product_name": "14D race", "price": 1, "stock_qty": 0, "category_id": None,
        "track_batch": True, "track_expiry": True,
    })
    assert product.status_code in (200, 201), product.text
    product_id = product.json()["data"]["id"]
    batch = s.client.post("/api/v1/batches", json={
        "product_id": product_id, "lot_no": f"R-{uuid4().hex[:8]}", "quantity": quantity,
        "mfg_date": date.today().isoformat(), "expiry_date": (date.today() + timedelta(days=90)).isoformat(),
    })
    assert batch.status_code == 201, batch.text
    return product_id, batch.json()["data"]["batch"]["id"]


def _pending(s, product_id, batch_id, observed, requested, reason="CYCLE_COUNT_VARIANCE", *, destination=False):
    """A pending batch request from a different user (no self-approval)."""
    warehouse = s.storage["destination_warehouse_id" if destination else "source_warehouse_id"]
    location = s.storage["destination_location_id" if destination else "source_location_id"]
    with s.sessions() as db:
        requester = User(username=f"req_{uuid4().hex[:8]}", password_hash="unused", role="WAREHOUSE")
        db.add(requester)
        db.flush()
        request = StockAdjustmentRequest(
            product_id=product_id, warehouse_id=warehouse, location_id=location, batch_id=batch_id,
            observed_quantity=Decimal(observed), requested_quantity=Decimal(requested),
            reason_code=reason, status="PENDING", requested_by_user_id=requester.id,
        )
        db.add(request)
        db.flush()
        request.reference_number = f"ADJ-{request.id:06d}"
        db.commit()
        return request.id


def _approve_call(request_id, key=None):
    call = ("POST", f"/api/v1/stock-adjustment-requests/{request_id}/approve", None)
    return (*call, key) if key else call


def _on_hand(s, product_id, batch_id, *, destination=False):
    warehouse = s.storage["destination_warehouse_id" if destination else "source_warehouse_id"]
    with s.sessions() as db:
        balance = db.query(StockBalance).filter_by(product_id=product_id, batch_id=batch_id,
                                                  warehouse_id=warehouse).one()
        return balance.on_hand_qty, balance.reserved_qty


def _status(s, request_id):
    with s.sessions() as db:
        return db.get(StockAdjustmentRequest, request_id).status


def test_approval_vs_stock_out(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    request_id = _pending(s, product_id, batch_id, "10.000", "8.000", "DAMAGE")
    approve, out = overlap(s, [
        _approve_call(request_id),
        ("POST", "/api/v1/stock/out-fefo", {"product_id": product_id, "quantity": "1.000"}),
    ], "products", [product_id])
    assert out.status_code == 200
    if approve.status_code == 200:   # approval first: 10 -> 8, then -1
        assert _on_hand(s, product_id, batch_id)[0] == Decimal("7.000")
    else:                            # stock-out first: the count is stale
        assert approve.status_code == 409 and _status(s, request_id) == "PENDING"
        assert _on_hand(s, product_id, batch_id)[0] == Decimal("9.000")


def test_approval_vs_sales_reservation(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product_id, quantity=5, unit_price=1)
    request_id = _pending(s, product_id, batch_id, "10.000", "3.000", "DAMAGE")
    approve, confirm = overlap(s, [
        _approve_call(request_id),
        ("POST", f"/api/v1/sales-orders/{order['sales_order_id']}/confirm", None),
    ], "products", [product_id])
    on_hand, reserved = _on_hand(s, product_id, batch_id)
    if approve.status_code == 200:   # 3 left: reserving 5 must fail, nothing reserved
        assert confirm.status_code != 200
        assert (on_hand, reserved) == (Decimal("3.000"), Decimal("0.000"))
    else:                            # reservation first: approval would breach the floor
        assert confirm.status_code == 200 and approve.status_code == 409
        assert (on_hand, reserved) == (Decimal("10.000"), Decimal("5.000"))


def test_approval_vs_sales_shipment(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    customer = sales._create_customer(s.client, s.headers)
    order = sales._create_sales_order(s.client, s.headers, customer["id"], product_id, quantity=2, unit_price=1)
    sales._confirm_sales_order(s.client, s.headers, order["sales_order_id"])
    sales._ready_sales_order(s.client, s.headers, order["sales_order_id"])
    request_id = _pending(s, product_id, batch_id, "10.000", "9.000")
    approve, ship = overlap(s, [
        _approve_call(request_id),
        ("POST", f"/api/v1/sales-orders/{order['sales_order_id']}/ship", None),
    ], "products", [product_id])
    assert ship.status_code == 200
    expected = Decimal("7.000") if approve.status_code == 200 else Decimal("8.000")
    assert approve.status_code in (200, 409)
    assert _on_hand(s, product_id, batch_id) == (expected, Decimal("0.000"))


def _transfer(s, product_id, batch_id, quantity):
    response = s.client.post("/api/v1/inventory-transfers", json={
        "source_warehouse_id": s.storage["source_warehouse_id"],
        "destination_warehouse_id": s.storage["destination_warehouse_id"],
        "items": [{"product_id": product_id, "batch_id": batch_id, "quantity": quantity,
                   "from_location_id": s.storage["source_location_id"],
                   "to_location_id": s.storage["destination_location_id"]}],
    })
    assert response.status_code in (200, 201), response.text
    return response.json()


def test_approval_vs_transfer_dispatch(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    transfer = _transfer(s, product_id, batch_id, "4.000")
    request_id = _pending(s, product_id, batch_id, "10.000", "8.000", "LOSS_THEFT")
    approve, dispatch = overlap(s, [
        _approve_call(request_id),
        ("POST", f"/api/v1/inventory-transfers/{transfer['id']}/dispatch", None),
    ], "products", [product_id])
    assert dispatch.status_code == 200
    expected = Decimal("4.000") if approve.status_code == 200 else Decimal("6.000")
    assert approve.status_code in (200, 409)
    assert _on_hand(s, product_id, batch_id)[0] == expected


def test_approval_vs_transfer_receipt_at_the_destination_balance(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    first = _transfer(s, product_id, batch_id, "2.000")
    assert s.client.post(f"/api/v1/inventory-transfers/{first['id']}/dispatch").status_code == 200
    receipt = s.client.post(f"/api/v1/inventory-transfers/{first['id']}/receive",
                            headers={"Idempotency-Key": uuid4().hex},
                            json={"items": [{"transfer_item_id": first["items"][0]["id"], "quantity": "2.000"}]})
    assert receipt.status_code == 200, receipt.text
    second = _transfer(s, product_id, batch_id, "3.000")
    assert s.client.post(f"/api/v1/inventory-transfers/{second['id']}/dispatch").status_code == 200
    request_id = _pending(s, product_id, batch_id, "2.000", "1.000", destination=True)
    approve, receive = overlap(s, [
        _approve_call(request_id),
        ("POST", f"/api/v1/inventory-transfers/{second['id']}/receive",
         {"items": [{"transfer_item_id": second["items"][0]["id"], "quantity": "3.000"}]}),
    ], "products", [product_id])
    assert receive.status_code == 200
    expected = Decimal("4.000") if approve.status_code == 200 else Decimal("5.000")
    assert approve.status_code in (200, 409)
    assert _on_hand(s, product_id, batch_id, destination=True)[0] == expected


def test_two_approvals_on_one_balance_resolve_to_exactly_one(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    first = _pending(s, product_id, batch_id, "10.000", "8.000", "DAMAGE")
    second = _pending(s, product_id, batch_id, "10.000", "7.000", "DAMAGE")
    responses = overlap(s, [_approve_call(first), _approve_call(second)], "products", [product_id])
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = first if responses[0].status_code == 200 else second
    expected = Decimal("8.000") if winner == first else Decimal("7.000")
    assert _on_hand(s, product_id, batch_id)[0] == expected
    with s.sessions() as db:
        assert db.query(StockTransaction).filter_by(product_id=product_id, transaction_type="ADJUST").count() == 1


def test_repeated_approval_of_one_request_applies_once(concurrent_inventory):
    s = concurrent_inventory
    product_id, batch_id = _lot_product(s)
    request_id = _pending(s, product_id, batch_id, "10.000", "6.000", "DAMAGE")
    key = uuid4().hex
    responses = overlap(s, [_approve_call(request_id, key), _approve_call(request_id, key)],
                        "stock_adjustment_requests", [request_id])
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["data"] == responses[1].json()["data"]
    assert _on_hand(s, product_id, batch_id)[0] == Decimal("6.000")
    with s.sessions() as db:
        assert db.query(StockTransaction).filter_by(product_id=product_id, transaction_type="ADJUST").count() == 1
