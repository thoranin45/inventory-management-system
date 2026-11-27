"""F2a: invoices (/api/v1/invoices) and adjustment notes (/api/v1/adjustment-notes)."""
import threading
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import app.services.invoice_service as invoice_service
from app.models import (
    CompanyProfile, Customer, Invoice, Product, Quotation, SalesOrder, SalesOrderItem, SalesReturnReceipt, User,
)
from tests.conftest import TestingSessionLocal

URL = "/api/v1/invoices"
ADJ = "/api/v1/adjustment-notes"


@pytest.fixture
def customer(db_session):
    row = Customer(customer_name=f"ลูกค้า {uuid4().hex[:6]}", address="1 ถนนสุขุมวิท กรุงเทพฯ",
                   tax_id="0105536092641", branch_code="00000")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def make_order(db_session, customer):
    """A sales order with two lines (1.125 x 10.01 and 3 x 250.00) in the given status."""

    def _make(status="SHIPPED"):
        products = [Product(sku=f"IN-{uuid4().hex[:10]}", product_name=name, price=Decimal("10.00"), stock_qty=0)
                    for name in ("น้ำดื่ม 600 มล.", "ถุงมือ")]
        db_session.add_all(products)
        db_session.flush()
        order = SalesOrder(customer_id=customer.id, status=status, total_amount=Decimal("761.26"))
        db_session.add(order)
        db_session.flush()
        order.so_number = f"SO-{order.id:06d}"
        db_session.add_all([
            SalesOrderItem(sales_order_id=order.id, product_id=products[0].id, quantity=Decimal("1.125"),
                           unit_price=Decimal("10.01"), total_price=Decimal("11.26")),
            SalesOrderItem(sales_order_id=order.id, product_id=products[1].id, quantity=Decimal("3"),
                           unit_price=Decimal("250.00"), total_price=Decimal("750.00")),
        ])
        db_session.commit()
        order.products = products
        return order

    return _make


def _draft(client, headers, order):
    response = client.post(URL, json={"sales_order_id": order.id}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _act(client, headers, base, doc_id, action, **kwargs):
    return client.post(f"{base}/{doc_id}/{action}", headers=headers, **kwargs)


def _issued(client, headers, order):
    draft = _draft(client, headers, order)
    response = _act(client, headers, URL, draft["id"], "issue")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _seq(number: str, prefix: str):
    kind, year, n = number.split("-")
    assert kind == prefix
    return int(year), int(n)


def _note(invoice, lines, receipt_id=None, reason="ลดราคาเพราะสินค้ามีตำหนิ"):
    return {"invoice_id": invoice["id"], "sales_return_receipt_id": receipt_id, "reason": reason,
            "items": [{"invoice_item_id": item_id, "quantity": qty, "unit_price": price}
                      for item_id, qty, price in lines]}


def _return_receipt(db_session, order, admin_user, quantities):
    receipt = SalesReturnReceipt(
        sales_order_id=order.id, receipt_number=f"SRR-{uuid4().hex}", operation_key=uuid4().hex,
        request_fingerprint=uuid4().hex, returned_by_user_id=admin_user.id,
        response_snapshot={"sales_order_id": order.id, "so_number": order.so_number, "returned_items": [
            {"product_id": product.id, "returned_quantity": qty, "previously_returned": "0.000"}
            for product, qty in quantities
        ]})
    db_session.add(receipt)
    db_session.commit()
    return receipt


# ---------------------------------------------------------------- invoices


def test_draft_copies_the_shipped_order_and_is_idempotent(client, admin_headers, make_order, db_session):
    order = make_order()
    draft = _draft(client, admin_headers, order)
    assert draft["status"] == "DRAFT" and draft["invoice_number"] is None and draft["invoice_created"] is True
    assert draft["sales_order_number"] == order.so_number
    assert draft["credit_days"] == 30
    assert [(i["quantity"], i["unit_price"], i["discount_amount"], i["line_total"]) for i in draft["items"]] == [
        ("1.125", "10.01", "0.00", "11.26"), ("3.000", "250.00", "0.00", "750.00")]
    assert (draft["subtotal"], draft["discount_total"], draft["grand_total"]) == ("761.26", "0.00", "761.26")

    again = _draft(client, admin_headers, order)
    assert again["id"] == draft["id"] and again["invoice_created"] is False
    assert db_session.execute(text("SELECT count(*) FROM invoices WHERE sales_order_id = :o"),
                              {"o": order.id}).scalar() == 1


@pytest.mark.parametrize("status_", ["DRAFT", "CONFIRMED", "PICKING", "CANCELLED"])
def test_only_shipped_or_completed_orders_can_be_invoiced(client, admin_headers, make_order, status_):
    order = make_order(status_)
    response = client.post(URL, json={"sales_order_id": order.id}, headers=admin_headers)
    assert response.status_code == 409
    assert client.post(URL, json={"sales_order_id": 99999999}, headers=admin_headers).status_code == 404


def test_completed_order_and_profile_credit_days(client, admin_headers, make_order, db_session):
    existing = db_session.get(CompanyProfile, 1)
    previous = existing.default_credit_days if existing else None
    profile = existing or CompanyProfile(id=1)
    profile.default_credit_days = 7
    db_session.merge(profile)
    db_session.commit()
    try:
        draft = _draft(client, admin_headers, make_order("COMPLETED"))
        assert draft["credit_days"] == 7
    finally:
        profile = db_session.get(CompanyProfile, 1)
        if existing is None:
            db_session.delete(profile)
        else:
            profile.default_credit_days = previous
        db_session.commit()


def test_quotation_link_is_carried_onto_the_invoice(client, admin_headers, make_order, customer, admin_user,
                                                    db_session):
    order = make_order()
    quotation = Quotation(status="CONVERTED", quotation_number=f"QT-2000-{uuid4().int % 9000 + 1000}",
                          customer_id=customer.id, subtotal=0, vat_base=0, vat_amount=0, grand_total=0,
                          sales_order_id=order.id, created_by_user_id=admin_user.id)
    db_session.add(quotation)
    db_session.commit()
    draft = _draft(client, admin_headers, order)
    assert draft["quotation_id"] == quotation.id
    assert draft["quotation_number"] == quotation.quotation_number


def test_line_discounts_change_the_totals(client, admin_headers, make_order):
    draft = _draft(client, admin_headers, make_order())
    body = {"credit_days": 15, "notes": "  ชำระโดยโอน  ",
            "items": [{"line_no": 2, "discount_amount": "50.50", "description": "ถุงมือยาง ไซซ์ M"}]}
    response = client.put(f"{URL}/{draft['id']}", json=body, headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["items"][1]["line_total"] == "699.50" and data["items"][1]["description"] == "ถุงมือยาง ไซซ์ M"
    assert (data["subtotal"], data["discount_total"], data["grand_total"]) == ("761.26", "50.50", "710.76")
    assert data["credit_days"] == 15 and data["notes"] == "ชำระโดยโอน"

    # a full PUT without line 2 resets its discount
    data = client.put(f"{URL}/{draft['id']}", json={"credit_days": 0, "items": []},
                      headers=admin_headers).json()["data"]
    assert data["discount_total"] == "0.00" and data["grand_total"] == "761.26"


@pytest.mark.parametrize("body", [
    {"credit_days": 30, "items": [{"line_no": 1, "discount_amount": "11.27"}]},  # more than the line
    {"credit_days": 30, "items": [{"line_no": 9, "discount_amount": "1.00"}]},   # no such line
    {"credit_days": 366, "items": []},
    {"credit_days": 30, "items": [{"line_no": 1, "discount_amount": "-1"}]},
    {"credit_days": 30, "items": [{"line_no": 1}, {"line_no": 1}]},
    {"credit_days": 30, "items": [], "grand_total": "1.00"},                     # totals never accepted
])
def test_invalid_draft_edits_are_refused(client, admin_headers, make_order, body):
    draft = _draft(client, admin_headers, make_order())
    assert client.put(f"{URL}/{draft['id']}", json=body, headers=admin_headers).status_code == 422


def test_issue_numbers_dates_snapshot_and_freeze(client, admin_headers, make_order, customer, db_session,
                                                 business_date):
    today = business_date.get()
    first = _issued(client, admin_headers, make_order())
    second = _issued(client, admin_headers, make_order())
    year, n = _seq(first["invoice_number"], "INV")
    assert _seq(second["invoice_number"], "INV") == (year, n + 1) and year == today.year
    assert first["issue_date"] == today.isoformat()
    assert first["due_date"] == (today + timedelta(days=30)).isoformat()
    assert first["customer_snapshot"]["name"] == customer.customer_name
    assert first["seller_snapshot"]["vat_registered"] is False
    assert first["balance"] == first["grand_total"] and first["is_overdue"] is False

    customer.customer_name = "ชื่อใหม่"
    db_session.commit()
    again = client.get(f"{URL}/{first['id']}", headers=admin_headers).json()["data"]
    assert again["customer_snapshot"]["name"] != "ชื่อใหม่"

    assert client.put(f"{URL}/{first['id']}", json={"credit_days": 1, "items": []},
                      headers=admin_headers).status_code == 409
    assert client.delete(f"{URL}/{first['id']}", headers=admin_headers).status_code == 409
    assert _act(client, admin_headers, URL, first["id"], "issue").status_code == 409

    business_date(today + timedelta(days=31))
    late = client.get(f"{URL}/{first['id']}", headers=admin_headers).json()["data"]
    assert late["is_overdue"] is True
    overdue = client.get(URL, params={"status": "OVERDUE", "search": first["invoice_number"]},
                         headers=admin_headers).json()["data"]["items"]
    assert [row["id"] for row in overdue] == [first["id"]]


def test_failed_issue_does_not_consume_a_number(client, admin_headers, make_order, monkeypatch):
    before = _issued(client, admin_headers, make_order())
    draft = _draft(client, admin_headers, make_order())

    def boom(_db, _user=None):
        raise RuntimeError("snapshot failed")

    monkeypatch.setattr(invoice_service.quotation_service, "_seller_snapshot", boom)
    with pytest.raises(RuntimeError):
        client.post(f"{URL}/{draft['id']}/issue", headers=admin_headers)
    monkeypatch.undo()
    after = _act(client, admin_headers, URL, draft["id"], "issue").json()["data"]
    year, n = _seq(before["invoice_number"], "INV")
    assert _seq(after["invoice_number"], "INV") == (year, n + 1)


def test_concurrent_create_from_one_order_makes_one_invoice(make_order, admin_user):
    order = make_order()
    results, start = [], threading.Barrier(4)

    def create():
        db = TestingSessionLocal()
        try:
            user = db.get(User, admin_user.id)
            start.wait()
            results.append(invoice_service.create_invoice_from_order_service(db, order.id, user))
        finally:
            db.close()

    threads = [threading.Thread(target=create) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert len(results) == 4
    assert len({r["id"] for r in results}) == 1
    assert sum(r["invoice_created"] for r in results) == 1


def test_void_and_reinvoice_the_same_order(client, admin_headers, make_order):
    order = make_order()
    issued = _issued(client, admin_headers, order)
    assert _act(client, admin_headers, URL, issued["id"], "void", json={"reason": "  "}).status_code == 422
    voided = _act(client, admin_headers, URL, issued["id"], "void", json={"reason": "ราคาผิด"}).json()["data"]
    assert voided["status"] == "VOID" and voided["void_reason"] == "ราคาผิด"
    assert _act(client, admin_headers, URL, issued["id"], "void", json={"reason": "x"}).status_code == 409
    fresh = _draft(client, admin_headers, order)
    assert fresh["id"] != issued["id"] and fresh["invoice_created"] is True


def test_draft_can_be_deleted(client, admin_headers, make_order):
    draft = _draft(client, admin_headers, make_order())
    assert client.delete(f"{URL}/{draft['id']}", headers=admin_headers).json()["data"] == {
        "id": draft["id"], "deleted": True}
    assert client.get(f"{URL}/{draft['id']}", headers=admin_headers).status_code == 404


def test_database_allows_one_active_invoice_per_order(db_session, make_order, admin_user):
    order = make_order()
    for status_ in ("VOID", "VOID", "DRAFT"):
        db_session.add(Invoice(status=status_, invoice_number=None if status_ == "DRAFT" else f"X-{uuid4().hex[:8]}",
                               sales_order_id=order.id, customer_id=order.customer_id, credit_days=30, subtotal=0,
                               discount_total=0, vat_base=0, vat_amount=0, grand_total=0,
                               created_by_user_id=admin_user.id))
    db_session.commit()
    db_session.add(Invoice(status="DRAFT", sales_order_id=order.id, customer_id=order.customer_id, credit_days=30,
                           subtotal=0, discount_total=0, vat_base=0, vat_amount=0, grand_total=0,
                           created_by_user_id=admin_user.id))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------- adjustment notes


def test_manual_adjustment_lowers_the_balance(client, admin_headers, make_order):
    invoice = _issued(client, admin_headers, make_order())
    gloves = invoice["items"][1]
    response = client.post(ADJ, json=_note(invoice, [(gloves["id"], "3", "20.00")]), headers=admin_headers)
    assert response.status_code == 201, response.text
    draft = response.json()["data"]
    assert draft["status"] == "DRAFT" and draft["grand_total"] == "60.00" and draft["adjustment_number"] is None
    # a draft does not count yet
    assert client.get(f"{URL}/{invoice['id']}", headers=admin_headers).json()["data"]["balance"] == "761.26"

    issued = _act(client, admin_headers, ADJ, draft["id"], "issue").json()["data"]
    assert _seq(issued["adjustment_number"], "ADJ")[0] == date.fromisoformat(issued["issue_date"]).year
    after = client.get(f"{URL}/{invoice['id']}", headers=admin_headers).json()["data"]
    assert (after["adjusted_total"], after["balance"]) == ("60.00", "701.26")
    assert after["items"][1]["adjusted_amount"] == "60.00"
    assert [a["adjustment_number"] for a in after["adjustments"]] == [issued["adjustment_number"]]

    # issued: frozen; void needs a reason and gives the amount back
    assert client.put(f"{ADJ}/{draft['id']}", json=_note(invoice, [(gloves["id"], "1", "1.00")]),
                      headers=admin_headers).status_code == 409
    assert _act(client, admin_headers, ADJ, draft["id"], "void", json={"reason": "ออกผิด"}).status_code == 200
    assert client.get(f"{URL}/{invoice['id']}", headers=admin_headers).json()["data"]["balance"] == "761.26"


def test_adjustment_limits(client, admin_headers, make_order):
    invoice = _issued(client, admin_headers, make_order())
    water, gloves = invoice["items"]
    cases = [
        [(gloves["id"], "4", "1.00")],          # more than the invoiced quantity
        [(water["id"], "1.125", "10.02")],      # 11.27 > what the line is worth (11.26)
        [(999999, "1", "1.00")],                # not a line of this invoice
    ]
    for lines in cases:
        assert client.post(ADJ, json=_note(invoice, lines), headers=admin_headers).status_code == 422
    assert client.post(ADJ, json={**_note(invoice, [(gloves["id"], "1", "1.00")]), "reason": " "},
                       headers=admin_headers).status_code == 422

    # two drafts each fit, but the second issue would go past the line: refused under the lock
    first = client.post(ADJ, json=_note(invoice, [(gloves["id"], "3", "200.00")]), headers=admin_headers).json()["data"]
    second = client.post(ADJ, json=_note(invoice, [(gloves["id"], "3", "100.00")]), headers=admin_headers).json()["data"]
    assert _act(client, admin_headers, ADJ, first["id"], "issue").status_code == 200
    assert _act(client, admin_headers, ADJ, second["id"], "issue").status_code == 422
    assert client.delete(f"{ADJ}/{second['id']}", headers=admin_headers).status_code == 200


def test_adjustments_need_an_issued_invoice_and_block_its_void(client, admin_headers, make_order):
    order = make_order()
    draft = _draft(client, admin_headers, order)
    gloves = draft["items"][1]
    assert client.post(ADJ, json=_note(draft, [(gloves["id"], "1", "1.00")]), headers=admin_headers).status_code == 409
    invoice = _act(client, admin_headers, URL, draft["id"], "issue").json()["data"]
    note = client.post(ADJ, json=_note(invoice, [(gloves["id"], "1", "1.00")]), headers=admin_headers).json()["data"]
    _act(client, admin_headers, ADJ, note["id"], "issue")
    assert _act(client, admin_headers, URL, invoice["id"], "void", json={"reason": "x"}).status_code == 409
    _act(client, admin_headers, ADJ, note["id"], "void", json={"reason": "x"})
    assert _act(client, admin_headers, URL, invoice["id"], "void", json={"reason": "x"}).status_code == 200


def test_adjustment_from_a_return_receipt(client, admin_headers, make_order, db_session, admin_user):
    order = make_order()
    invoice = _issued(client, admin_headers, order)
    water, gloves = invoice["items"]
    receipt = _return_receipt(db_session, order, admin_user, [(order.products[1], "2.000")])
    detail = client.get(f"{URL}/{invoice['id']}", headers=admin_headers).json()["data"]
    assert detail["return_receipts"] == [{
        "id": receipt.id, "receipt_number": receipt.receipt_number, "returned_at": detail["return_receipts"][0][
            "returned_at"],
        "items": [{"invoice_item_id": gloves["id"], "product_id": order.products[1].id,
                   "returned_quantity": "2.000", "adjusted_quantity": "0.000"}],
    }]

    too_many = _note(invoice, [(gloves["id"], "3", "250.00")], receipt.id, "รับคืนสินค้า")
    assert client.post(ADJ, json=too_many, headers=admin_headers).status_code == 422
    not_returned = _note(invoice, [(water["id"], "1", "1.00")], receipt.id, "รับคืนสินค้า")
    assert client.post(ADJ, json=not_returned, headers=admin_headers).status_code == 422

    ok = client.post(ADJ, json=_note(invoice, [(gloves["id"], "2", "250.00")], receipt.id, "รับคืนสินค้า"),
                     headers=admin_headers).json()["data"]
    issued = _act(client, admin_headers, ADJ, ok["id"], "issue").json()["data"]
    assert issued["grand_total"] == "500.00" and issued["sales_return_receipt_number"] == receipt.receipt_number
    detail = client.get(f"{URL}/{invoice['id']}", headers=admin_headers).json()["data"]
    assert detail["return_receipts"][0]["items"][0]["adjusted_quantity"] == "2.000"
    again = _note(invoice, [(gloves["id"], "1", "1.00")], receipt.id, "รับคืนสินค้า")
    assert client.post(ADJ, json=again, headers=admin_headers).status_code == 422

    other = make_order()
    foreign = _return_receipt(db_session, other, admin_user, [(other.products[1], "1.000")])
    wrong = _note(invoice, [(gloves["id"], "1", "1.00")], foreign.id, "รับคืนสินค้า")
    assert client.post(ADJ, json=wrong, headers=admin_headers).status_code == 422


# ---------------------------------------------------------------- reads, PDFs, RBAC, audit


def test_lists_search_and_filters(client, admin_headers, make_order):
    order = make_order()
    invoice = _issued(client, admin_headers, order)
    rows = client.get(URL, params={"search": order.so_number}, headers=admin_headers).json()["data"]["items"]
    assert [r["id"] for r in rows] == [invoice["id"]]
    rows = client.get(URL, params={"sales_order_id": order.id, "status": "DRAFT"},
                      headers=admin_headers).json()["data"]["items"]
    assert rows == []
    note = client.post(ADJ, json=_note(invoice, [(invoice["items"][1]["id"], "1", "5.00")]),
                       headers=admin_headers).json()["data"]
    rows = client.get(ADJ, params={"invoice_id": invoice["id"]}, headers=admin_headers).json()["data"]["items"]
    assert [(r["id"], r["invoice_number"], r["grand_total"]) for r in rows] == [
        (note["id"], invoice["invoice_number"], "5.00")]


def test_pdfs_only_for_issued_documents(client, admin_headers, make_order):
    draft = _draft(client, admin_headers, make_order())
    client.put(f"{URL}/{draft['id']}", json={"credit_days": 30, "items": [{"line_no": 2, "discount_amount": "10"}]},
               headers=admin_headers)
    assert client.get(f"{URL}/{draft['id']}/pdf", headers=admin_headers).status_code == 409
    invoice = _act(client, admin_headers, URL, draft["id"], "issue").json()["data"]
    response = client.get(f"{URL}/{invoice['id']}/pdf", headers=admin_headers)
    assert response.status_code == 200 and response.headers["content-type"] == "application/pdf"
    assert invoice["invoice_number"] in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"%PDF") and b"IBMPlexSansThai" in response.content

    note = client.post(ADJ, json=_note(invoice, [(invoice["items"][1]["id"], "1", "5.00")]),
                       headers=admin_headers).json()["data"]
    assert client.get(f"{ADJ}/{note['id']}/pdf", headers=admin_headers).status_code == 409
    _act(client, admin_headers, ADJ, note["id"], "issue")
    response = client.get(f"{ADJ}/{note['id']}/pdf", headers=admin_headers)
    assert response.status_code == 200 and response.content.startswith(b"%PDF")


def test_warehouse_and_anonymous_users_cannot_use_invoices(client, warehouse_headers, admin_headers, make_order):
    order = make_order()
    invoice = _issued(client, admin_headers, order)
    for path in (URL, f"{URL}/{invoice['id']}", f"{URL}/{invoice['id']}/pdf", f"{URL}/revenue-summary", ADJ):
        assert client.get(path, headers=warehouse_headers).status_code == 403
    assert client.post(URL, json={"sales_order_id": order.id}, headers=warehouse_headers).status_code == 403
    assert client.get(URL).status_code == 401


def test_revenue_summary_counts_issued_documents(client, admin_headers, make_order, business_date):
    year = business_date.get().year
    before = client.get(f"{URL}/revenue-summary", params={"year": year}, headers=admin_headers).json()["data"]
    invoice = _issued(client, admin_headers, make_order())
    _draft(client, admin_headers, make_order())  # drafts never count
    note = client.post(ADJ, json=_note(invoice, [(invoice["items"][1]["id"], "1", "61.26")]),
                       headers=admin_headers).json()["data"]
    _act(client, admin_headers, ADJ, note["id"], "issue")
    after = client.get(f"{URL}/revenue-summary", params={"year": year}, headers=admin_headers).json()["data"]
    assert Decimal(after["invoiced_total"]) - Decimal(before["invoiced_total"]) == Decimal("761.26")
    assert Decimal(after["adjusted_total"]) - Decimal(before["adjusted_total"]) == Decimal("61.26")
    assert Decimal(after["net_revenue"]) - Decimal(before["net_revenue"]) == Decimal("700.00")
    assert after["vat_threshold"] == "1800000.00" and after["year"] == year
    assert after["level"] in {"ok", "warning", "over"}
    other_year = client.get(f"{URL}/revenue-summary", params={"year": 2001}, headers=admin_headers).json()["data"]
    assert other_year["net_revenue"] == "0.00" and other_year["level"] == "ok"


def test_every_transition_is_audited(client, admin_headers, make_order, db_session):
    invoice = _issued(client, admin_headers, make_order())
    note = client.post(ADJ, json=_note(invoice, [(invoice["items"][1]["id"], "1", "5.00")]),
                       headers=admin_headers).json()["data"]
    _act(client, admin_headers, ADJ, note["id"], "issue")
    _act(client, admin_headers, ADJ, note["id"], "void", json={"reason": "ผิด"})
    _act(client, admin_headers, URL, invoice["id"], "void", json={"reason": "ผิด"})

    def actions(table, record_id):
        return db_session.execute(text(
            "SELECT action FROM audit_logs WHERE table_name = :t AND record_id = :id ORDER BY id"
        ), {"t": table, "id": record_id}).scalars().all()

    assert actions("invoices", invoice["id"]) == ["CREATE_INVOICE", "ISSUE_INVOICE", "VOID_INVOICE"]
    assert actions("adjustment_notes", note["id"]) == [
        "CREATE_ADJUSTMENT_NOTE", "ISSUE_ADJUSTMENT_NOTE", "VOID_ADJUSTMENT_NOTE"]


def test_database_enforces_number_rules(db_session, make_order, admin_user):
    order = make_order()
    bad = Invoice(status="ISSUED", invoice_number=None, sales_order_id=order.id, customer_id=order.customer_id,
                  credit_days=30, subtotal=0, discount_total=0, vat_base=0, vat_amount=0, grand_total=0,
                  created_by_user_id=admin_user.id)
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
