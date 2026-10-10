"""Phase 14C -- one adjustment-privacy policy across every read path.

A request's notes and requester identity are visible only to Admin and to
the request's own requester. Each scenario plants a unique PRIVATE sentinel
and checks the *raw response text* of every endpoint that serializes an
adjustment remark, for each viewer: Admin, the request owner, and an
unrelated warehouse user.

Scenarios:
  A  real approval through the API, notes = sentinel. New approvals never
     copy notes into broadly readable remarks, so the sentinel may appear
     only in the ledger's ``adjustment.notes`` for Admin / owner.
  B  a linked approval whose stored remarks *do* contain private text
     (the shape a pre-14C approval would have had, had it been linked).
     Owner + Admin see it everywhere; the other user gets the public
     ``ADJ-xxxxxx: REASON`` summary.
  C  a retired direct /stock/adjust row written by a warehouse operator --
     no request, so ownership is unknown: only Admin sees the remark, not
     even the operator.
  D  an approval made before 14C linked anything (request has no
     stock_transaction_id, movement references the transaction, created_by
     is the approving Admin). The approver is never assumed to be the
     requester: only Admin sees it.
"""
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.security import create_access_token
from app.models import (
    AuditLog,
    InventoryMovement,
    StockAdjustmentRequest,
    StockTransaction,
    User,
    Warehouse,
    WarehouseLocation,
)
from tests.test_stock import _create_product
from tests.test_stock_adjustment_requests import _approve, _create_request, _key


def _sentinel(label: str) -> str:
    return f"PRIVATE_SENTINEL_{label}_{uuid4().hex}"


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": "Bearer " + create_access_token({"sub": str(user.id)})}


def _mint(db, label: str, role: str = "WAREHOUSE") -> User:
    user = User(username=f"{label}_{uuid4().hex[:8]}", password_hash="unused", role=role)
    db.add(user)
    db.commit()
    return user


def _main_storage(db):
    warehouse = db.query(Warehouse).filter_by(warehouse_code="MAIN").one()
    location = db.query(WarehouseLocation).filter_by(warehouse_id=warehouse.id, location_code="DEFAULT").one()
    return warehouse, location


def _approved_request(db, *, product_id, owner, admin, notes, reason="DAMAGE"):
    warehouse, location = _main_storage(db)
    request = StockAdjustmentRequest(
        product_id=product_id, warehouse_id=warehouse.id, location_id=location.id,
        observed_quantity=Decimal("0"), requested_quantity=Decimal("4"),
        reason_code=reason, notes=notes, status="APPROVED",
        requested_by_user_id=owner.id, reviewed_by_user_id=admin.id,
    )
    db.add(request)
    db.flush()
    request.reference_number = f"ADJ-{request.id:06d}"
    return request


def _adjust_rows(db, *, product_id, actor_id, remark, request=None):
    """Write the ADJUST transaction + STOCK_ADJUST movement pair directly.
    ``request`` given -> Phase 14C linkage; ``None`` -> pre-14C shape."""
    warehouse, location = _main_storage(db)
    transaction = StockTransaction(
        product_id=product_id, transaction_type="ADJUST", quantity=Decimal("4"), remark=remark,
    )
    db.add(transaction)
    db.flush()
    if request is not None:
        request.stock_transaction_id = transaction.id
        reference = ("STOCK_ADJUSTMENT_REQUEST", request.id, request.reference_number, transaction.id)
    else:
        reference = ("STOCK_TRANSACTION", transaction.id, None, None)
    movement = InventoryMovement(
        product_id=product_id, batch_id=None, warehouse_id=warehouse.id, location_id=location.id,
        movement_type="STOCK_ADJUST", quantity=Decimal("4"),
        balance_before=Decimal("0"), balance_after=Decimal("4"),
        reference_type=reference[0], reference_id=reference[1], reference_number=reference[2],
        stock_transaction_id=reference[3], remark=remark, created_by_user_id=actor_id,
    )
    db.add(movement)
    db.commit()
    return transaction, movement


@pytest.fixture
def scenarios(client, admin_headers, admin_user, warehouse_headers, warehouse_user, db_session):
    """Owner = ``warehouse_user``; ``other`` = an unrelated warehouse user."""
    other = _mint(db_session, "other_wh")
    s = {
        "admin": admin_headers, "owner": warehouse_headers, "other": _headers(other),
        "owner_user": warehouse_user, "other_user": other,
    }

    # A -- the real API path.
    s["A"] = _sentinel("A")
    product_a = _create_product(client, admin_headers)
    created = _create_request(
        client, warehouse_headers, product_id=product_a["id"], observed="0.000", requested="6.000",
        reason_code="DAMAGE", notes=s["A"],
    ).json()["data"]
    approved = _approve(client, admin_headers, created["id"])
    assert approved.status_code == 200, approved.text
    s["A_product"], s["A_request"] = product_a["id"], created["id"]

    # B -- linked, private text in stored remarks.
    s["B"] = _sentinel("B")
    product_b = _create_product(client, admin_headers)
    request_b = _approved_request(db_session, product_id=product_b["id"], owner=warehouse_user,
                                  admin=admin_user, notes=s["B"])
    tx_b, _ = _adjust_rows(db_session, product_id=product_b["id"], actor_id=admin_user.id,
                           remark=f"DAMAGE: {s['B']}", request=request_b)
    s["B_product"], s["B_request"], s["B_public"] = product_b["id"], request_b.id, f"{request_b.reference_number}: DAMAGE"

    # C -- retired direct /stock/adjust by the warehouse operator (no request).
    s["C"] = _sentinel("C")
    product_c = _create_product(client, admin_headers)
    tx_c, _ = _adjust_rows(db_session, product_id=product_c["id"], actor_id=warehouse_user.id, remark=s["C"])
    s["C_product"], s["C_tx"] = product_c["id"], tx_c.id

    # D -- approved before 14C linkage; created_by is the approving Admin.
    s["D"] = _sentinel("D")
    product_d = _create_product(client, admin_headers)
    request_d = _approved_request(db_session, product_id=product_d["id"], owner=warehouse_user,
                                  admin=admin_user, notes=s["D"])
    db_session.commit()
    tx_d, _ = _adjust_rows(db_session, product_id=product_d["id"], actor_id=admin_user.id,
                           remark=f"DAMAGE: {s['D']}")
    s["D_product"], s["D_tx"] = product_d["id"], tx_d.id
    return s


def _endpoint_texts(client, headers, s) -> dict[str, str]:
    """Raw response text of every adjustment-remark-serializing endpoint."""
    products = [s["A_product"], s["B_product"], s["C_product"], s["D_product"]]
    calls = {
        "ledger": [("/api/v1/inventory-movements", {"product_id": p, "page_size": 100}) for p in products],
        "by_product": [(f"/api/v1/inventory-movements/product/{p}", None) for p in products],
        "by_reference": [
            (f"/api/v1/inventory-movements/reference/STOCK_ADJUSTMENT_REQUEST/{s['A_request']}", None),
            (f"/api/v1/inventory-movements/reference/STOCK_ADJUSTMENT_REQUEST/{s['B_request']}", None),
            (f"/api/v1/inventory-movements/reference/STOCK_TRANSACTION/{s['C_tx']}", None),
            (f"/api/v1/inventory-movements/reference/STOCK_TRANSACTION/{s['D_tx']}", None),
        ],
        "report": [("/api/v1/reports/stock-movement", {"transaction_type": "ADJUST", "page_size": 100})],
        "dashboard": [("/api/v1/dashboard/recent-transactions", None)],
        "history": [("/api/v1/stock/history", None)],
    }
    texts = {}
    for name, requests in calls.items():
        chunks = []
        for path, params in requests:
            response = client.get(path, headers=headers, params=params)
            assert response.status_code == 200, (name, path, response.text)
            assert response.headers["cache-control"] == "private, no-store"
            chunks.append(response.text)
        texts[name] = "\n".join(chunks)
    return texts


# Expected sentinel visibility: (scenario, endpoint) -> set of viewers who may see it.
_ALL_ENDPOINTS = ("ledger", "by_product", "by_reference", "report", "dashboard", "history")
EXPECTED = {
    # A: notes live only on the request; the ledger surfaces them to Admin/owner.
    **{("A", e): set() for e in _ALL_ENDPOINTS},
    ("A", "ledger"): {"admin", "owner"},
    # B: linked -> owner resolvable everywhere.
    **{("B", e): {"admin", "owner"} for e in _ALL_ENDPOINTS},
    # C / D: unknown ownership -> Admin only, even for the operator / requester.
    **{("C", e): {"admin"} for e in _ALL_ENDPOINTS},
    **{("D", e): {"admin"} for e in _ALL_ENDPOINTS},
}


def test_private_sentinel_matrix_across_every_endpoint_and_role(client, scenarios):
    s = scenarios
    observed = {}
    for viewer in ("admin", "owner", "other"):
        texts = _endpoint_texts(client, s[viewer], s)
        for scenario in "ABCD":
            for endpoint, text in texts.items():
                if s[scenario] in text:
                    observed.setdefault((scenario, endpoint), set()).add(viewer)
    for key, allowed in EXPECTED.items():
        assert observed.get(key, set()) == allowed, key


def test_redacted_rows_carry_only_the_public_summary(client, scenarios):
    s = scenarios
    other = client.get("/api/v1/inventory-movements", headers=s["other"],
                       params={"product_id": s["B_product"]}).json()["data"]["items"]
    assert len(other) == 1
    row = other[0]
    assert row["remark"] == s["B_public"]
    assert row["remark_redacted"] is True
    adj = row["adjustment"]
    assert adj["linked"] is True and adj["redacted"] is True and adj["can_view_detail"] is False
    assert adj["notes"] is None and adj["requested_by"] is None
    assert adj["reference_number"] == s["B_public"].split(":")[0]

    owner = client.get("/api/v1/inventory-movements", headers=s["owner"],
                       params={"product_id": s["B_product"]}).json()["data"]["items"][0]
    assert owner["remark_redacted"] is False
    assert owner["adjustment"]["can_view_detail"] is True
    assert owner["adjustment"]["notes"] == s["B"]
    assert owner["adjustment"]["requested_by"]["id"] == s["owner_user"].id

    # Unknown ownership: remark withheld outright and labelled unlinked.
    legacy = client.get("/api/v1/inventory-movements", headers=s["owner"],
                        params={"product_id": s["C_product"]}).json()["data"]["items"][0]
    assert legacy["remark"] is None and legacy["remark_redacted"] is True
    assert legacy["adjustment"]["linked"] is False
    assert legacy["adjustment"]["can_view_detail"] is False


def test_requester_identity_never_reaches_unrelated_warehouse_users(client, scenarios):
    s = scenarios
    username = s["owner_user"].username
    for product in (s["A_product"], s["B_product"], s["D_product"]):
        response = client.get("/api/v1/inventory-movements", headers=s["other"],
                              params={"product_id": product})
        assert username not in response.text
        for item in response.json()["data"]["items"]:
            assert item["adjustment"]["requested_by"] is None


def test_redaction_never_changes_counts_and_no_filter_searches_hidden_text(client, scenarios):
    """Counts are computed before (and independent of) redaction, and no
    parameter of any endpoint matches against remark text -- so a hidden
    note can never be probed by filtering."""
    s = scenarios
    for product in (s["B_product"], s["C_product"], s["D_product"]):
        totals = {
            viewer: client.get("/api/v1/inventory-movements", headers=s[viewer],
                               params={"product_id": product}).json()["data"]["pagination"]["total_items"]
            for viewer in ("admin", "owner", "other")
        }
        assert set(totals.values()) == {1}

    for sentinel in (s["B"], s["C"], s["D"]):
        # reference_number is exact-match on the document number, never remark text.
        hit = client.get("/api/v1/inventory-movements", headers=s["other"],
                         params={"reference_number": sentinel}).json()["data"]["pagination"]["total_items"]
        assert hit == 0
        # Unknown parameters (remark=, search=) are ignored, not applied as filters.
        for params in ({"remark": sentinel}, {"search": sentinel}):
            baseline = client.get("/api/v1/reports/stock-movement", headers=s["other"],
                                  params={"transaction_type": "ADJUST"}).json()["data"]["pagination"]["total_items"]
            probed = client.get("/api/v1/reports/stock-movement", headers=s["other"],
                                params={"transaction_type": "ADJUST", **params}).json()["data"]["pagination"]["total_items"]
            assert probed == baseline


def test_new_approval_never_copies_notes_into_broad_rows(client, scenarios, db_session):
    s = scenarios
    request = db_session.query(StockAdjustmentRequest).filter_by(id=s["A_request"]).one()
    transaction = db_session.get(StockTransaction, request.stock_transaction_id)
    movement = db_session.query(InventoryMovement).filter_by(product_id=s["A_product"],
                                                             movement_type="STOCK_ADJUST").one()
    public = f"{request.reference_number}: DAMAGE"
    assert transaction.remark == public
    assert movement.remark == public
    audit_rows = db_session.query(AuditLog).filter(
        ((AuditLog.table_name == "stock_transactions") & (AuditLog.record_id == transaction.id))
        | ((AuditLog.table_name == "stock_adjustment_requests") & (AuditLog.record_id == request.id))
    ).all()
    assert audit_rows
    assert all(s["A"] not in (row.description or "") for row in audit_rows)
    # The notes themselves are intact on the protected request.
    assert request.notes == s["A"]


def test_redaction_never_mutates_stored_rows(client, scenarios, db_session):
    s = scenarios
    _endpoint_texts(client, s["other"], s)
    db_session.expire_all()
    stored = db_session.get(StockTransaction, s["C_tx"])
    assert stored.remark == s["C"]
    movement = db_session.query(InventoryMovement).filter_by(product_id=s["D_product"]).one()
    assert s["D"] in movement.remark


def test_role_is_re_read_per_request_so_demotion_revokes_access(client, scenarios, db_session):
    """Authorization reloads the user every request: an admin demoted to
    warehouse immediately loses legacy remark visibility."""
    s = scenarios
    admin = _mint(db_session, "demoted_admin", role="admin")
    headers = _headers(admin)
    url, params = "/api/v1/inventory-movements", {"product_id": s["C_product"]}
    assert s["C"] in client.get(url, headers=headers, params=params).text
    admin.role = "WAREHOUSE"
    db_session.commit()
    assert s["C"] not in client.get(url, headers=headers, params=params).text


def test_ownership_follows_user_id_not_username(client, scenarios, db_session):
    s = scenarios
    owner = db_session.get(User, s["owner_user"].id)
    owner.username = f"renamed_{uuid4().hex[:8]}"
    db_session.commit()
    text = client.get("/api/v1/inventory-movements", headers=s["owner"],
                      params={"product_id": s["B_product"]}).text
    assert s["B"] in text


def test_cache_control_is_private_no_store_only_under_the_api_prefix(client, admin_headers):
    api = client.get("/api/v1/inventory-movements", headers=admin_headers)
    assert api.headers["cache-control"] == "private, no-store"
    # Errors are per-user too.
    denied = client.get("/api/v1/inventory-movements")
    assert denied.status_code == 401
    assert denied.headers["cache-control"] == "private, no-store"
    # Outside /api/v1 (root info, static /uploads images) is left untouched.
    root = client.get("/")
    assert "cache-control" not in root.headers
