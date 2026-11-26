"""F1a: quotations API (/api/v1/quotations) and conversion to a sales order."""
import threading
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text

import app.services.quotation_service as quotation_service
from app.models import Customer, Product, Quotation, SalesOrder, User
from app.services.quotation_pdf import baht_text
from tests.conftest import TestingSessionLocal

URL = "/api/v1/quotations"


@pytest.fixture
def customer(db_session):
    row = Customer(customer_name=f"ลูกค้า {uuid4().hex[:6]}", address="1 ถนนสุขุมวิท กรุงเทพฯ",
                   tax_id="0105536092641", branch_code="00000")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def products(db_session):
    rows = [Product(sku=f"QT-{uuid4().hex[:10]}", product_name=name, price=Decimal("10.00"), stock_qty=0)
            for name in ("น้ำดื่ม 600 มล.", "ถุงมือ")]
    db_session.add_all(rows)
    db_session.commit()
    return rows


def _draft(customer, products, **extra):
    return {
        "customer_id": customer.id,
        "items": [
            {"product_id": products[0].id, "quantity": "1.125", "unit_price": "10.01"},
            {"product_id": products[1].id, "quantity": "3", "unit_price": "250.00", "description": "ถุงมือยาง ไซซ์ M"},
        ],
        **extra,
    }


def _create(client, headers, customer, products, **extra):
    response = client.post(URL, json=_draft(customer, products, **extra), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _act(client, headers, quotation_id, action, **kwargs):
    return client.post(f"{URL}/{quotation_id}/{action}", headers=headers, **kwargs)


def _issued(client, headers, customer, products, **extra):
    draft = _create(client, headers, customer, products, **extra)
    response = _act(client, headers, draft["id"], "issue")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _seq(number: str) -> tuple[int, int]:
    prefix, year, value = number.split("-")
    assert prefix == "QT"
    return int(year), int(value)


# ---------------------------------------------------------------- drafts


def test_draft_totals_are_computed_on_the_server(client, admin_headers, customer, products):
    data = _create(client, admin_headers, customer, products, notes="  ส่งภายใน 7 วัน  ")
    assert data["status"] == "DRAFT" and data["quotation_number"] is None
    first, second = data["items"]
    assert first["line_total"] == "11.26"            # 1.125 x 10.01 = 11.26125, half up
    assert first["description"].endswith("น้ำดื่ม 600 มล.")   # defaults to SKU + product name
    assert second["description"] == "ถุงมือยาง ไซซ์ M"
    assert second["line_total"] == "750.00"
    assert data["subtotal"] == "761.26"
    assert data["vat_amount"] == "0.00"              # not VAT-registered
    assert data["grand_total"] == "761.26"
    assert data["notes"] == "ส่งภายใน 7 วัน"


def test_client_cannot_send_totals_or_unknown_fields(client, admin_headers, customer, products):
    body = _draft(customer, products)
    body["grand_total"] = "1.00"
    assert client.post(URL, json=body, headers=admin_headers).status_code == 422
    body = _draft(customer, products)
    body["items"][0]["discount"] = "1.00"            # no discounts in F1 (Owner, 26 Nov)
    assert client.post(URL, json=body, headers=admin_headers).status_code == 422


@pytest.mark.parametrize("change, code", [
    (lambda b: b["items"].append(dict(b["items"][0])), 422),                 # same product twice
    (lambda b: b["items"][0].update(quantity="1.0001"), 422),                # > 3 decimals
    (lambda b: b["items"][0].update(unit_price="0"), 422),
    (lambda b: b["items"][0].update(unit_price="1.001"), 422),
    (lambda b: b["items"][0].update(product_id=999999999), 404),
    (lambda b: b.update(customer_id=999999999), 404),
    (lambda b: b.update(items=[]), 422),
    (lambda b: b["items"][0].update(quantity="10000000", unit_price="10.00"), 422),  # > 99,999,999.99
])
def test_invalid_drafts_are_refused(client, admin_headers, customer, products, change, code):
    body = _draft(customer, products)
    change(body)
    response = client.post(URL, json=body, headers=admin_headers)
    assert response.status_code == code, response.text


def test_update_replaces_the_draft_and_delete_removes_it(client, admin_headers, customer, products, db_session):
    draft = _create(client, admin_headers, customer, products)
    body = {"customer_id": customer.id, "items": [{"product_id": products[1].id, "quantity": "2", "unit_price": "5.50"}]}
    updated = client.put(f"{URL}/{draft['id']}", json=body, headers=admin_headers)
    assert updated.status_code == 200, updated.text
    assert [i["line_total"] for i in updated.json()["data"]["items"]] == ["11.00"]
    assert updated.json()["data"]["grand_total"] == "11.00"

    assert client.delete(f"{URL}/{draft['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"{URL}/{draft['id']}", headers=admin_headers).status_code == 404
    assert db_session.execute(text("SELECT count(*) FROM quotation_items WHERE quotation_id = :id"),
                              {"id": draft["id"]}).scalar() == 0


# ---------------------------------------------------------------- issue


def test_issue_allocates_consecutive_numbers_and_freezes_a_snapshot(
    client, admin_headers, customer, products, db_session,
):
    first = _issued(client, admin_headers, customer, products)
    second = _issued(client, admin_headers, customer, products)
    year, n = _seq(first["quotation_number"])
    assert _seq(second["quotation_number"]) == (year, n + 1)
    assert first["status"] == "ISSUED"
    assert first["issue_date"] and first["valid_until"]
    from datetime import date
    issue, valid = date.fromisoformat(first["issue_date"]), date.fromisoformat(first["valid_until"])
    assert valid - issue == timedelta(days=30)
    assert year == issue.year
    assert first["customer_snapshot"]["name"] == customer.customer_name
    assert first["customer_snapshot"]["tax_id"] == "0105536092641"
    assert first["seller_snapshot"]["vat_registered"] is False

    # later edits to master data never change an issued quotation
    customer.customer_name = "ชื่อใหม่"
    db_session.commit()
    again = client.get(f"{URL}/{first['id']}", headers=admin_headers).json()["data"]
    assert again["customer_snapshot"]["name"] != "ชื่อใหม่"
    assert again["customer_name"] == first["customer_name"]

    # an issued quotation can no longer be edited or deleted
    assert client.put(f"{URL}/{first['id']}", json=_draft(customer, products), headers=admin_headers).status_code == 409
    assert client.delete(f"{URL}/{first['id']}", headers=admin_headers).status_code == 409
    assert _act(client, admin_headers, first["id"], "issue").status_code == 409


def test_failed_issue_does_not_consume_a_number(client, admin_headers, customer, products, monkeypatch):
    before = _issued(client, admin_headers, customer, products)
    draft = _create(client, admin_headers, customer, products)

    def boom(_customer):
        raise RuntimeError("snapshot failed after the number was allocated")

    monkeypatch.setattr(quotation_service, "_customer_snapshot", boom)
    with pytest.raises(RuntimeError):
        _act(client, admin_headers, draft["id"], "issue")
    monkeypatch.undo()

    assert client.get(f"{URL}/{draft['id']}", headers=admin_headers).json()["data"]["status"] == "DRAFT"
    after = _act(client, admin_headers, draft["id"], "issue").json()["data"]
    year, n = _seq(before["quotation_number"])
    assert _seq(after["quotation_number"]) == (year, n + 1)


def test_valid_until_before_today_is_refused(client, admin_headers, customer, products, business_date):
    today = business_date.get()
    draft = _create(client, admin_headers, customer, products, valid_until=str(today - timedelta(days=1)))
    assert _act(client, admin_headers, draft["id"], "issue").status_code == 422


def test_concurrent_issue_of_one_draft_issues_it_once(client, admin_headers, customer, products, admin_user):
    draft = _create(client, admin_headers, customer, products)
    outcomes, start = [], threading.Barrier(2)

    def issue():
        db = TestingSessionLocal()
        try:
            user = db.get(User, admin_user.id)
            start.wait()
            outcomes.append(quotation_service.issue_quotation_service(db, draft["id"], user)["quotation_number"])
        except Exception as exc:
            outcomes.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=issue) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    numbers = [o for o in outcomes if isinstance(o, str)]
    errors = [o for o in outcomes if not isinstance(o, str)]
    assert len(numbers) == 1 and len(errors) == 1
    assert getattr(errors[0], "status_code", None) == 409


# ---------------------------------------------------------------- decisions


def test_accept_then_convert_creates_one_matching_sales_order(client, admin_headers, customer, products, db_session):
    issued = _issued(client, admin_headers, customer, products)
    assert _act(client, admin_headers, issued["id"], "convert").status_code == 409   # not accepted yet
    accepted = _act(client, admin_headers, issued["id"], "accept")
    assert accepted.status_code == 200 and accepted.json()["data"]["status"] == "ACCEPTED"

    converted = _act(client, admin_headers, issued["id"], "convert").json()["data"]
    assert converted["status"] == "CONVERTED" and converted["sales_order_created"] is True
    order = db_session.get(SalesOrder, converted["sales_order_id"])
    assert order.status == "DRAFT" and order.customer_id == customer.id
    assert converted["sales_order_number"] == order.so_number
    assert order.total_amount == Decimal(issued["grand_total"])        # 761.26, rounded per line
    totals = db_session.execute(text(
        "SELECT total_price FROM sales_order_items WHERE sales_order_id = :id ORDER BY total_price"
    ), {"id": order.id}).scalars().all()
    assert totals == [Decimal("11.26"), Decimal("750.00")]

    again = _act(client, admin_headers, issued["id"], "convert").json()["data"]
    assert again["sales_order_id"] == order.id and again["sales_order_created"] is False
    assert db_session.execute(text("SELECT count(*) FROM quotations WHERE sales_order_id = :id"),
                              {"id": order.id}).scalar() == 1
    # the order is an ordinary draft order: the existing sales order API reads it
    so = client.get(f"/api/v1/sales-orders/{order.id}", headers=admin_headers)
    assert so.status_code == 200, so.text


def test_concurrent_convert_creates_exactly_one_sales_order(client, admin_headers, customer, products, admin_user,
                                                            db_session):
    issued = _issued(client, admin_headers, customer, products)
    _act(client, admin_headers, issued["id"], "accept")
    results, start = [], threading.Barrier(4)

    def convert():
        db = TestingSessionLocal()
        try:
            user = db.get(User, admin_user.id)
            start.wait()
            results.append(quotation_service.convert_quotation_service(db, issued["id"], user))
        finally:
            db.close()

    threads = [threading.Thread(target=convert) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert len(results) == 4
    assert len({r["sales_order_id"] for r in results}) == 1
    assert sum(r["sales_order_created"] for r in results) == 1
    orders = db_session.execute(text(
        "SELECT count(*) FROM audit_logs WHERE action = 'CREATE_SALES_ORDER' AND description LIKE :d"
    ), {"d": f"%From quotation {issued['quotation_number']}"}).scalar()
    assert orders == 1


def test_reject_void_and_their_guards(client, admin_headers, customer, products):
    draft = _create(client, admin_headers, customer, products)
    assert _act(client, admin_headers, draft["id"], "void", json={"reason": "x"}).status_code == 409   # drafts are deleted
    rejected = _issued(client, admin_headers, customer, products)
    assert _act(client, admin_headers, rejected["id"], "reject").json()["data"]["status"] == "REJECTED"
    assert _act(client, admin_headers, rejected["id"], "accept").status_code == 409
    assert _act(client, admin_headers, rejected["id"], "void", json={"reason": "x"}).status_code == 409

    accepted = _issued(client, admin_headers, customer, products)
    _act(client, admin_headers, accepted["id"], "accept")
    assert _act(client, admin_headers, accepted["id"], "void", json={"reason": "   "}).status_code == 422
    assert _act(client, admin_headers, accepted["id"], "void").status_code == 422
    voided = _act(client, admin_headers, accepted["id"], "void", json={"reason": " ลูกค้ายกเลิก "}).json()["data"]
    assert voided["status"] == "VOID" and voided["void_reason"] == "ลูกค้ายกเลิก"
    assert _act(client, admin_headers, accepted["id"], "convert").status_code == 409


def test_expired_quotation_cannot_be_accepted_and_is_listed_as_expired(
    client, admin_headers, customer, products, business_date,
):
    today = business_date.get()
    issued = _issued(client, admin_headers, customer, products, valid_until=str(today))
    assert issued["is_expired"] is False
    business_date(today + timedelta(days=1))
    detail = client.get(f"{URL}/{issued['id']}", headers=admin_headers).json()["data"]
    assert detail["is_expired"] is True and detail["status"] == "ISSUED"
    assert _act(client, admin_headers, issued["id"], "accept").status_code == 409
    listed = client.get(URL, params={"status": "expired", "page_size": 100}, headers=admin_headers).json()["data"]
    assert issued["id"] in {row["id"] for row in listed["items"]}
    assert all(row["is_expired"] for row in listed["items"])


def test_revise_copies_into_a_new_draft(client, admin_headers, customer, products):
    issued = _issued(client, admin_headers, customer, products)
    revision = _act(client, admin_headers, issued["id"], "revise")
    assert revision.status_code == 201, revision.text
    draft = revision.json()["data"]
    assert draft["status"] == "DRAFT" and draft["revision_of_id"] == issued["id"]
    assert [(i["product_id"], i["quantity"], i["unit_price"]) for i in draft["items"]] == \
        [(i["product_id"], i["quantity"], i["unit_price"]) for i in issued["items"]]
    original = client.get(f"{URL}/{issued['id']}", headers=admin_headers).json()["data"]
    assert original["status"] == "VOID" and original["void_reason"] == f"Revised as draft #{draft['id']}"
    assert original["revised_by_id"] == draft["id"]
    assert _act(client, admin_headers, issued["id"], "revise").status_code == 409   # void cannot be revised

    rejected = _issued(client, admin_headers, customer, products)
    _act(client, admin_headers, rejected["id"], "reject")
    assert _act(client, admin_headers, rejected["id"], "revise").status_code == 201
    assert client.get(f"{URL}/{rejected['id']}", headers=admin_headers).json()["data"]["status"] == "REJECTED"


# ---------------------------------------------------------------- list, pdf, rbac, audit


def test_list_search_and_filters(client, admin_headers, customer, products):
    issued = _issued(client, admin_headers, customer, products)
    by_number = client.get(URL, params={"search": issued["quotation_number"]}, headers=admin_headers).json()["data"]
    assert [row["id"] for row in by_number["items"]] == [issued["id"]]
    by_customer = client.get(URL, params={"customer_id": customer.id, "status": "ISSUED"},
                             headers=admin_headers).json()["data"]
    assert issued["id"] in {row["id"] for row in by_customer["items"]}
    assert client.get(URL, params={"sort_by": "nope"}, headers=admin_headers).status_code == 422


def test_pdf_only_for_issued_quotations(client, admin_headers, customer, products):
    draft = _create(client, admin_headers, customer, products)
    assert client.get(f"{URL}/{draft['id']}/pdf", headers=admin_headers).status_code == 409
    issued = _issued(client, admin_headers, customer, products, notes="ราคานี้รวมค่าขนส่งแล้ว")
    response = client.get(f"{URL}/{issued['id']}/pdf", headers=admin_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert issued["quotation_number"] in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF") and b"IBMPlexSansThai" in response.content


def test_warehouse_and_anonymous_users_cannot_use_quotations(client, warehouse_headers, admin_headers, customer,
                                                             products):
    issued = _issued(client, admin_headers, customer, products)
    assert client.get(URL, headers=warehouse_headers).status_code == 403
    assert client.get(f"{URL}/{issued['id']}", headers=warehouse_headers).status_code == 403
    assert client.get(f"{URL}/{issued['id']}/pdf", headers=warehouse_headers).status_code == 403
    assert client.post(URL, json=_draft(customer, products), headers=warehouse_headers).status_code == 403
    assert client.get(URL).status_code == 401


def test_every_transition_is_audited(client, admin_headers, customer, products, db_session):
    issued = _issued(client, admin_headers, customer, products)
    _act(client, admin_headers, issued["id"], "accept")
    _act(client, admin_headers, issued["id"], "convert")
    actions = db_session.execute(text(
        "SELECT action FROM audit_logs WHERE table_name = 'quotations' AND record_id = :id ORDER BY id"
    ), {"id": issued["id"]}).scalars().all()
    assert actions == ["CREATE_QUOTATION", "ISSUE_QUOTATION", "ACCEPT_QUOTATION", "CONVERT_QUOTATION"]


def test_database_enforces_number_and_order_link_rules(db_session, customer, admin_user):
    from sqlalchemy.exc import IntegrityError
    for status_, number in (("DRAFT", "QT-2026-9999"), ("ISSUED", None), ("CONVERTED", "QT-2026-9998"),
                            ("PENDING", "QT-2026-9997"), ("draft", None)):
        db_session.add(Quotation(status=status_, quotation_number=number, customer_id=customer.id,
                                 created_by_user_id=admin_user.id))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()


# ---------------------------------------------------------------- baht text


@pytest.mark.parametrize("amount, words", [
    ("0", "ศูนย์บาทถ้วน"),
    ("1", "หนึ่งบาทถ้วน"),
    ("11", "สิบเอ็ดบาทถ้วน"),
    ("21.50", "ยี่สิบเอ็ดบาทห้าสิบสตางค์"),
    ("101", "หนึ่งร้อยเอ็ดบาทถ้วน"),
    ("761.26", "เจ็ดร้อยหกสิบเอ็ดบาทยี่สิบหกสตางค์"),
    ("0.01", "หนึ่งสตางค์"),
    ("1000000", "หนึ่งล้านบาทถ้วน"),
    ("1000001", "หนึ่งล้านเอ็ดบาทถ้วน"),
    ("21000000", "ยี่สิบเอ็ดล้านบาทถ้วน"),
    ("99999999.99", "เก้าสิบเก้าล้านเก้าแสนเก้าหมื่นเก้าพันเก้าร้อยเก้าสิบเก้าบาทเก้าสิบเก้าสตางค์"),
])
def test_baht_text(amount, words):
    assert baht_text(Decimal(amount)) == words
