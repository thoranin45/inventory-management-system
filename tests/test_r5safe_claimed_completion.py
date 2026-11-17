"""The internal wrapper adds claim/reconciliation checks, not new completion semantics."""
import pytest
from app.core.exceptions import AppException
from app.repositories.sales_order_repository import SalesOrderRepository
from app.repositories.stock_balance_repository import StockBalanceRepository
from app.schemas.sales_order_schema import CompleteFulfillment
from app.services.fulfillment_integrity_service import complete_claimed_fulfillment
from tests import test_sales_order as sales
from tests.test_r5safe_claims import acquire, make_order, make_user, order_row
from tests.test_r5safe_release import snapshot


def complete(db, order, user, claim, payload):
    return complete_claimed_fulfillment(db, SalesOrderRepository(db), StockBalanceRepository(db),
        sales_order_id=order, current_user=user, phase=claim["phase"], claim_token=claim["claim_token"],
        expected_epoch=claim["claim_epoch"], data=CompleteFulfillment.model_validate(payload))


@pytest.mark.parametrize("phase,after", [("PICK", "PACKING"), ("PACK", "READY_TO_SHIP")])
def test_claimed_completion_preserves_business_rules(client, admin_headers, db_session, phase, after):
    _, order = make_order(client, admin_headers, state="PICKING" if phase == "PICK" else "PACKING")
    worker = make_user(db_session)
    claim = acquire(db_session, order, worker, phase=phase)
    payload = sales._fulfillment_payload(client, admin_headers, order)
    before = snapshot(db_session, order)
    with pytest.raises(AppException):
        complete(db_session, order, worker, claim, payload)
    assert snapshot(db_session, order) == before
    sales._scan_fulfillment_to_full(client, admin_headers, order, packing=phase == "PACK")
    result = complete(db_session, order, worker, claim, payload)
    assert result["status"] == after
    row = order_row(db_session, order)
    assert row.status == after and row.fulfillment_claim_epoch == 2 and row.fulfillment_claim_token_hash is None
    with pytest.raises(AppException):
        complete(db_session, order, worker, claim, payload)


def test_claimed_completion_reconciliation_gate(client, admin_headers, db_session):
    _, order = make_order(client, admin_headers)
    worker = make_user(db_session)
    acquire(db_session, order, worker)
    claim = acquire(db_session, order, worker, takeover=True, reason="device recovery")
    sales._scan_fulfillment_to_full(client, admin_headers, order)
    before = snapshot(db_session, order)
    with pytest.raises(AppException, match="FULFILLMENT_RECONCILIATION_UNRESOLVED"):
        complete(db_session, order, worker, claim, sales._fulfillment_payload(client, admin_headers, order))
    assert snapshot(db_session, order) == before
