"""F3a: receipts (/api/v1/payment-receipts), billing notes (/api/v1/billing-notes) and AR aging."""
import threading
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from uuid import uuid4

import pytest
from openpyxl import load_workbook
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

import app.services.payment_service as payment_service
from app.core.exceptions import AppException
from app.models import AuditLog, Customer, User
from app.schemas.payment_schema import PaymentReceiptInput
from tests.conftest import TestingSessionLocal
from tests.test_invoices import ADJ, URL, _act, _draft, _issued, _note, _seq, customer, make_order  # noqa: F401

RC = "/api/v1/payment-receipts"
BN = "/api/v1/billing-notes"
TOTAL = Decimal("761.26")  # 1.125 x 10.01 (11.26) + 3 x 250.00, see tests.test_invoices.make_order


def _pay(client, headers, customer_id, lines, **extra):
    body = {"customer_id": customer_id, "method": "TRANSFER",
            "allocations": [{"invoice_id": inv_id, "amount": amount, **more} for inv_id, amount, *rest in lines
                            for more in [rest[0] if rest else {}]], **extra}
    return client.post(RC, json=body, headers=headers)


def _paid(client, headers, customer_id, lines, **extra):
    response = _pay(client, headers, customer_id, lines, **extra)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _invoice(client, headers, invoice_id):
    return client.get(f"{URL}/{invoice_id}", headers=headers).json()["data"]


# ---------------------------------------------------------------- receipts


def test_partial_then_full_payment(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    assert invoice["payment_status"] == "UNPAID" and invoice["paid_total"] == "0.00"
    first = _paid(client, admin_headers, customer.id, [(invoice["id"], "400.00")], reference="KBank 1234")
    assert first["status"] == "ISSUED" and first["receipt_created"] is True
    assert first["amount_total"] == "400.00" and first["settled_total"] == "400.00"
    assert first["customer_snapshot"]["name"] == customer.customer_name
    after_first = _invoice(client, admin_headers, invoice["id"])
    assert after_first["payment_status"] == "PARTIAL" and after_first["balance"] == "361.26"
    second = _paid(client, admin_headers, customer.id, [(invoice["id"], "361.26")])
    year, n = _seq(first["receipt_number"], "RC")
    assert _seq(second["receipt_number"], "RC") == (year, n + 1)
    done = _invoice(client, admin_headers, invoice["id"])
    assert done["payment_status"] == "PAID" and done["balance"] == "0.00" and done["paid_total"] == "761.26"
    assert [p["receipt_number"] for p in done["payments"]] == [first["receipt_number"], second["receipt_number"]]
    assert done["is_overdue"] is False


def test_paid_invoice_is_never_overdue(client, admin_headers, make_order, customer, business_date):
    invoice = _issued(client, admin_headers, make_order())
    _paid(client, admin_headers, customer.id, [(invoice["id"], str(TOTAL))])
    business_date(date.fromisoformat(invoice["due_date"]) + timedelta(days=5))
    assert _invoice(client, admin_headers, invoice["id"])["is_overdue"] is False
    overdue = client.get(URL, params={"status": "OVERDUE", "customer_id": customer.id}, headers=admin_headers)
    assert overdue.json()["data"]["items"] == []


@pytest.mark.parametrize("amount, extra, message", [
    ("761.27", {}, "more than the balance"),
    ("0", {}, "above 0"),
])
def test_amount_limits(client, admin_headers, make_order, customer, amount, extra, message):
    invoice = _issued(client, admin_headers, make_order())
    response = _pay(client, admin_headers, customer.id, [(invoice["id"], amount, extra)])
    assert response.status_code == 422
    assert message in response.text
    assert _invoice(client, admin_headers, invoice["id"])["balance"] == str(TOTAL)


def test_receipts_refuse_wrong_invoices_and_dates(client, admin_headers, make_order, customer, db_session):
    draft = _draft(client, admin_headers, make_order())
    assert _pay(client, admin_headers, customer.id, [(draft["id"], "10")]).status_code == 422
    invoice = _issued(client, admin_headers, make_order())
    other = Customer(customer_name=f"อื่น {uuid4().hex[:6]}")
    db_session.add(other)
    db_session.commit()
    assert "another customer" in _pay(client, admin_headers, other.id, [(invoice["id"], "10")]).text
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    assert _pay(client, admin_headers, customer.id, [(invoice["id"], "10")],
                received_date=tomorrow).status_code == 422
    assert _pay(client, admin_headers, customer.id, [(invoice["id"], "10"), (invoice["id"], "5")]).status_code == 422
    assert _pay(client, admin_headers, customer.id, [(999999999, "10")]).status_code == 404
    assert _pay(client, admin_headers, customer.id, [(invoice["id"], "10")], method="CRYPTO").status_code == 422
    assert _invoice(client, admin_headers, invoice["id"])["paid_total"] == "0.00"


def test_withholding_tax_settles_the_invoice(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    receipt = _paid(client, admin_headers, customer.id, [
        (invoice["id"], "738.42", {"wht_amount": "22.84", "wht_certificate_no": " WHT-001 "})])
    assert receipt["amount_total"] == "738.42" and receipt["wht_total"] == "22.84"
    assert receipt["settled_total"] == "761.26"
    assert receipt["allocations"][0]["wht_certificate_no"] == "WHT-001"
    assert _invoice(client, admin_headers, invoice["id"])["payment_status"] == "PAID"


def test_one_receipt_pays_several_invoices(client, admin_headers, make_order, customer):
    first, second = (_issued(client, admin_headers, make_order()) for _ in range(2))
    receipt = _paid(client, admin_headers, customer.id, [(second["id"], "100.00"), (first["id"], str(TOTAL))],
                    method="CASH")
    assert [a["invoice_id"] for a in receipt["allocations"]] == [second["id"], first["id"]]
    assert receipt["amount_total"] == "861.26"
    assert _invoice(client, admin_headers, first["id"])["payment_status"] == "PAID"
    assert _invoice(client, admin_headers, second["id"])["balance"] == "661.26"
    listed = client.get(RC, params={"invoice_id": second["id"]}, headers=admin_headers).json()["data"]["items"]
    assert [r["id"] for r in listed] == [receipt["id"]]
    found = client.get(RC, params={"search": receipt["receipt_number"]}, headers=admin_headers).json()["data"]
    assert [r["id"] for r in found["items"]] == [receipt["id"]]


def test_void_receipt_restores_the_balance_and_unblocks_invoice_void(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    receipt = _paid(client, admin_headers, customer.id, [(invoice["id"], "500.00")])
    blocked = _act(client, admin_headers, URL, invoice["id"], "void", json={"reason": "ผิด"})
    assert blocked.status_code == 409 and "receipts" in blocked.text
    assert _act(client, admin_headers, RC, receipt["id"], "void", json={"reason": " "}).status_code == 422
    voided = _act(client, admin_headers, RC, receipt["id"], "void", json={"reason": "โอนซ้ำ"}).json()["data"]
    assert voided["status"] == "VOID" and voided["void_reason"] == "โอนซ้ำ"
    assert _act(client, admin_headers, RC, receipt["id"], "void", json={"reason": "x"}).status_code == 409
    assert _invoice(client, admin_headers, invoice["id"])["balance"] == str(TOTAL)
    assert _act(client, admin_headers, URL, invoice["id"], "void", json={"reason": "ผิด"}).status_code == 200


def test_adjustment_cannot_exceed_the_unpaid_balance(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    _paid(client, admin_headers, customer.id, [(invoice["id"], "700.00")])
    line = invoice["items"][1]["id"]  # 3 x 250.00
    too_much = client.post(ADJ, json=_note(invoice, [(line, "1", "100.00")]), headers=admin_headers)
    assert too_much.status_code == 422 and "unpaid balance" in too_much.text
    ok = client.post(ADJ, json=_note(invoice, [(line, "1", "61.26")]), headers=admin_headers)
    assert ok.status_code == 201
    assert _act(client, admin_headers, ADJ, ok.json()["data"]["id"], "issue").status_code == 200
    assert _invoice(client, admin_headers, invoice["id"])["payment_status"] == "PAID"


def test_client_request_id_makes_a_retry_safe(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    key = uuid4().hex
    first = _paid(client, admin_headers, customer.id, [(invoice["id"], "100.00")], client_request_id=key)
    again = _paid(client, admin_headers, customer.id, [(invoice["id"], "100.00")], client_request_id=key)
    assert again["id"] == first["id"] and again["receipt_created"] is False
    assert _invoice(client, admin_headers, invoice["id"])["paid_total"] == "100.00"
    nxt = _paid(client, admin_headers, customer.id, [(invoice["id"], "1.00")])
    year, n = _seq(first["receipt_number"], "RC")
    assert _seq(nxt["receipt_number"], "RC") == (year, n + 1)  # the retry consumed no number


def test_concurrent_receipts_cannot_both_take_the_balance(make_order, client, admin_headers, admin_user, customer):
    invoice = _issued(client, admin_headers, make_order())
    results, errors, start = [], [], threading.Barrier(3)

    def pay():
        db = TestingSessionLocal()
        try:
            user = db.get(User, admin_user.id)
            data = PaymentReceiptInput(customer_id=customer.id, method="CASH",
                                       allocations=[{"invoice_id": invoice["id"], "amount": "761.26"}])
            start.wait()
            results.append(payment_service.create_receipt_service(db, data, user))
        except AppException as exc:
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=pay) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert len(results) == 1 and len(errors) == 2
    assert _invoice(client, admin_headers, invoice["id"])["paid_total"] == "761.26"


def test_invoice_list_payment_filter_and_revenue_received(client, admin_headers, make_order, customer,
                                                          business_date):
    year = business_date.get().year
    before = client.get(f"{URL}/revenue-summary", params={"year": year}, headers=admin_headers).json()["data"]
    paid, partly, untouched = (_issued(client, admin_headers, make_order()) for _ in range(3))
    _paid(client, admin_headers, customer.id, [(paid["id"], str(TOTAL)), (partly["id"], "1.00")])

    def ids(**params):
        rows = client.get(URL, params={"customer_id": customer.id, **params}, headers=admin_headers)
        return {r["id"] for r in rows.json()["data"]["items"]}

    assert ids(payment="paid") == {paid["id"]}
    assert ids(payment="open") == {partly["id"], untouched["id"]}
    assert client.get(URL, params={"payment": "maybe"}, headers=admin_headers).status_code == 422
    after = client.get(f"{URL}/revenue-summary", params={"year": year}, headers=admin_headers).json()["data"]
    assert Decimal(after["received_total"]) - Decimal(before["received_total"]) == TOTAL + 1


def test_receipt_pdf(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    receipt = _paid(client, admin_headers, customer.id, [(invoice["id"], "761.26", {"wht_amount": "0"})])
    response = client.get(f"{RC}/{receipt['id']}/pdf", headers=admin_headers)
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert receipt["receipt_number"] in response.headers["content-disposition"]
    assert client.get(f"{RC}/999999999/pdf", headers=admin_headers).status_code == 404


# ---------------------------------------------------------------- billing notes


def test_billing_note_lifecycle(client, admin_headers, make_order, customer):
    first, second = (_issued(client, admin_headers, make_order()) for _ in range(2))
    _paid(client, admin_headers, customer.id, [(first["id"], "61.26")])
    due = (date.today() + timedelta(days=7)).isoformat()
    body = {"customer_id": customer.id, "invoice_ids": [second["id"], first["id"]], "payment_due_date": due,
            "notes": "นัดรับเช็คทุกวันศุกร์"}
    draft = client.post(BN, json=body, headers=admin_headers)
    assert draft.status_code == 201, draft.text
    note = draft.json()["data"]
    assert note["status"] == "DRAFT" and note["billing_number"] is None
    assert [i["amount"] for i in note["items"]] == ["761.26", "700.00"]
    assert note["total_amount"] == "1461.26" and note["invoice_count"] == 2
    assert client.get(f"{BN}/{note['id']}/pdf", headers=admin_headers).status_code == 409

    edited = client.put(f"{BN}/{note['id']}", json={**body, "invoice_ids": [first["id"]]}, headers=admin_headers)
    assert edited.status_code == 200 and edited.json()["data"]["total_amount"] == "700.00"
    _paid(client, admin_headers, customer.id, [(first["id"], "100.00")])  # balance moves before issue
    issued = _act(client, admin_headers, BN, note["id"], "issue").json()["data"]
    assert issued["status"] == "ISSUED" and issued["total_amount"] == "600.00"
    _seq(issued["billing_number"], "BN")
    assert issued["customer_snapshot"]["name"] == customer.customer_name
    pdf = client.get(f"{BN}/{note['id']}/pdf", headers=admin_headers)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.put(f"{BN}/{note['id']}", json=body, headers=admin_headers).status_code == 409
    # informational: the billing note never changes a balance
    assert _invoice(client, admin_headers, first["id"])["balance"] == "600.00"
    voided = _act(client, admin_headers, BN, note["id"], "void", json={"reason": "วางบิลใหม่"}).json()["data"]
    assert voided["status"] == "VOID"
    listed = client.get(BN, params={"customer_id": customer.id}, headers=admin_headers).json()["data"]["items"]
    assert [n["id"] for n in listed] == [note["id"]]


def test_billing_note_rules(client, admin_headers, make_order, customer, db_session):
    invoice = _issued(client, admin_headers, make_order())
    paid = _issued(client, admin_headers, make_order())
    _paid(client, admin_headers, customer.id, [(paid["id"], str(TOTAL))])
    draft_invoice = _draft(client, admin_headers, make_order())
    other = Customer(customer_name=f"อื่น {uuid4().hex[:6]}")
    db_session.add(other)
    db_session.commit()

    def create(**over):
        return client.post(BN, json={"customer_id": customer.id, "invoice_ids": [invoice["id"]], **over},
                           headers=admin_headers)

    assert "fully paid" in create(invoice_ids=[paid["id"]]).text
    assert create(invoice_ids=[draft_invoice["id"]]).status_code == 422
    assert "another customer" in create(customer_id=other.id).text
    assert create(invoice_ids=[invoice["id"], invoice["id"]]).status_code == 422
    assert create(payment_due_date=(date.today() - timedelta(days=3)).isoformat()).status_code == 422
    note = create().json()["data"]
    assert client.put(f"{BN}/{note['id']}", json={"customer_id": other.id, "invoice_ids": [invoice["id"]]},
                      headers=admin_headers).status_code == 422
    assert client.delete(f"{BN}/{note['id']}", headers=admin_headers).json()["data"]["deleted"] is True
    assert client.get(f"{BN}/{note['id']}", headers=admin_headers).status_code == 404


def test_billing_issue_refuses_an_invoice_paid_since_the_draft(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    note = client.post(BN, json={"customer_id": customer.id, "invoice_ids": [invoice["id"]]},
                       headers=admin_headers).json()["data"]
    _paid(client, admin_headers, customer.id, [(invoice["id"], str(TOTAL))])
    response = _act(client, admin_headers, BN, note["id"], "issue")
    assert response.status_code == 422 and "fully paid" in response.text
    assert client.get(f"{BN}/{note['id']}", headers=admin_headers).json()["data"]["status"] == "DRAFT"


# ---------------------------------------------------------------- AR aging


def _aging_row(client, headers, customer_id, as_of):
    data = client.get(f"{URL}/ar-aging", params={"as_of": as_of.isoformat()}, headers=headers).json()["data"]
    rows = [r for r in data["rows"] if r["customer_id"] == customer_id]
    return data, (rows[0] if rows else None)


def test_ar_aging_buckets(client, admin_headers, make_order, customer):
    first, second, paid = (_issued(client, admin_headers, make_order()) for _ in range(3))
    _paid(client, admin_headers, customer.id, [(paid["id"], str(TOTAL)), (second["id"], "61.26")])
    due = date.fromisoformat(first["due_date"])
    data, row = _aging_row(client, admin_headers, customer.id, due)
    assert data["buckets"] == ["not_due", "days_1_30", "days_31_60", "days_61_90", "days_over_90"]
    assert row["not_due"] == "1461.26" and row["invoice_count"] == 2 and row["total"] == "1461.26"
    _, row = _aging_row(client, admin_headers, customer.id, due + timedelta(days=30))
    assert row["days_1_30"] == "1461.26" and row["not_due"] == "0.00"
    _, row = _aging_row(client, admin_headers, customer.id, due + timedelta(days=31))
    assert row["days_31_60"] == "1461.26"
    _, row = _aging_row(client, admin_headers, customer.id, due + timedelta(days=91))
    assert row["days_over_90"] == "1461.26" and row["oldest_due_date"] == due.isoformat()
    assert Decimal(data["totals"]["total"]) >= Decimal("1461.26")


def test_ar_aging_ignores_customers_with_nothing_owed(client, admin_headers, make_order, customer):
    invoice = _issued(client, admin_headers, make_order())
    _paid(client, admin_headers, customer.id, [(invoice["id"], str(TOTAL))])
    assert _aging_row(client, admin_headers, customer.id, date.today())[1] is None


def test_ar_aging_export(client, admin_headers, make_order, customer):
    _issued(client, admin_headers, make_order())
    response = client.get(f"{URL}/ar-aging/export", params={"lang": "th"}, headers=admin_headers)
    assert response.status_code == 200
    assert "ar_aging.xlsx" in response.headers["content-disposition"]
    sheet = load_workbook(BytesIO(response.content)).active
    assert sheet["A2"].value == "ลูกค้า" and sheet["H2"].value == "รวม"
    names = [sheet.cell(row=r, column=1).value for r in range(3, sheet.max_row + 1)]
    assert customer.customer_name in names and names[-1] == "รวม"
    assert client.get(f"{URL}/ar-aging/export", params={"lang": "fr"}, headers=admin_headers).status_code == 422


# ---------------------------------------------------------------- access, audit, database


def test_warehouse_and_anonymous_users_cannot_use_payments(client, warehouse_headers, customer):
    for path in (RC, f"{RC}/1", f"{RC}/1/pdf", BN, f"{BN}/1", f"{BN}/1/pdf", f"{URL}/ar-aging",
                 f"{URL}/ar-aging/export"):
        assert client.get(path, headers=warehouse_headers).status_code == 403
        assert client.get(path).status_code == 401
    body = {"customer_id": customer.id, "method": "CASH", "allocations": [{"invoice_id": 1, "amount": "1"}]}
    assert client.post(RC, json=body, headers=warehouse_headers).status_code == 403
    assert client.post(BN, json={"customer_id": customer.id, "invoice_ids": [1]},
                       headers=warehouse_headers).status_code == 403


def test_every_payment_action_is_audited(client, admin_headers, make_order, customer, db_session):
    invoice = _issued(client, admin_headers, make_order())
    receipt = _paid(client, admin_headers, customer.id, [(invoice["id"], "10.00")])
    _act(client, admin_headers, RC, receipt["id"], "void", json={"reason": "ผิด"})
    note = client.post(BN, json={"customer_id": customer.id, "invoice_ids": [invoice["id"]]},
                       headers=admin_headers).json()["data"]
    client.put(f"{BN}/{note['id']}", json={"customer_id": customer.id, "invoice_ids": [invoice["id"]]},
               headers=admin_headers)
    _act(client, admin_headers, BN, note["id"], "issue")
    _act(client, admin_headers, BN, note["id"], "void", json={"reason": "ผิด"})
    db_session.expire_all()
    receipt_actions = db_session.execute(select(AuditLog.action).where(
        AuditLog.table_name == "payment_receipts", AuditLog.record_id == receipt["id"])).scalars().all()
    assert receipt_actions == ["CREATE_RECEIPT", "VOID_RECEIPT"]
    note_actions = db_session.execute(select(AuditLog.action).where(
        AuditLog.table_name == "billing_notes", AuditLog.record_id == note["id"]).order_by(AuditLog.id)).scalars().all()
    assert note_actions == ["CREATE_BILLING_NOTE", "UPDATE_BILLING_NOTE", "ISSUE_BILLING_NOTE", "VOID_BILLING_NOTE"]


def test_database_enforces_receipt_totals(db_session, customer, admin_user):
    with pytest.raises(IntegrityError):
        db_session.execute(text(
            "INSERT INTO payment_receipts (receipt_number, status, customer_id, received_date, method, "
            "amount_total, wht_total, settled_total, created_by_user_id) "
            "VALUES (:n, 'ISSUED', :c, '2026-01-01', 'CASH', 10, 1, 10, :u)"
        ), {"n": f"RC-T-{uuid4().hex[:8]}", "c": customer.id, "u": admin_user.id})
    db_session.rollback()
    with pytest.raises(IntegrityError):
        db_session.execute(text(
            "INSERT INTO billing_notes (billing_number, status, customer_id, total_amount, created_by_user_id) "
            "VALUES (NULL, 'ISSUED', :c, 0, :u)"
        ), {"c": customer.id, "u": admin_user.id})
    db_session.rollback()
