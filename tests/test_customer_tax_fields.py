"""F0a: optional tax/billing fields on customers stay backward compatible."""
from uuid import uuid4

URL = "/api/v1/customers"
VALID_TAX_ID = "0105536092641"


def _name():
    return f"F0a customer {uuid4().hex[:8]}"


def test_old_payload_still_works_and_new_fields_are_empty(client, admin_headers):
    response = client.post(URL, json={"customer_name": _name(), "phone": "0800000000"}, headers=admin_headers)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["phone"] == "0800000000"
    assert data["tax_id"] is None and data["branch_code"] is None
    assert data["billing_address"] is None and data["credit_term_days"] is None


def test_tax_fields_are_saved_normalized_and_returned(client, admin_headers):
    created = client.post(URL, json={
        "customer_name": _name(),
        "tax_id": "0105536092641",
        "branch_code": "00001",
        "billing_address": "แผนกบัญชี ชั้น 3",
        "credit_term_days": 30,
    }, headers=admin_headers).json()["data"]
    assert (created["tax_id"], created["branch_code"], created["credit_term_days"]) == (VALID_TAX_ID, "00001", 30)

    fetched = client.get(f"{URL}/{created['id']}", headers=admin_headers).json()["data"]
    assert fetched["billing_address"] == "แผนกบัญชี ชั้น 3"

    listed = client.get(URL, params={"search": created["customer_name"]}, headers=admin_headers).json()
    assert any(row["tax_id"] == VALID_TAX_ID for row in listed["data"]["items"])


def test_update_sets_and_clears_tax_fields(client, admin_headers):
    created = client.post(URL, json={"customer_name": _name()}, headers=admin_headers).json()["data"]
    updated = client.put(f"{URL}/{created['id']}", json={"tax_id": "0-1055-36092-64-1"}, headers=admin_headers)
    assert updated.status_code == 200 and updated.json()["data"]["tax_id"] == VALID_TAX_ID
    cleared = client.put(f"{URL}/{created['id']}", json={"tax_id": ""}, headers=admin_headers).json()["data"]
    assert cleared["tax_id"] is None
    # a partial update leaves the other fields alone
    renamed = client.put(f"{URL}/{created['id']}", json={"phone": "021234567"}, headers=admin_headers).json()["data"]
    assert renamed["customer_name"] == created["customer_name"]


def test_invalid_tax_fields_are_rejected(client, admin_headers):
    for bad in (
        {"tax_id": "0105536092640"},
        {"tax_id": "12345"},
        {"branch_code": "0000A"},
        {"credit_term_days": -1},
        {"credit_term_days": 366},
    ):
        response = client.post(URL, json={"customer_name": _name(), **bad}, headers=admin_headers)
        assert response.status_code == 422, bad


def test_warehouse_still_cannot_create_customers(client, warehouse_headers):
    response = client.post(URL, json={"customer_name": _name(), "tax_id": VALID_TAX_ID}, headers=warehouse_headers)
    assert response.status_code == 403


def test_thai_numerals_are_accepted_and_stored_as_ascii(client, admin_headers):
    created = client.post(URL, json={
        "customer_name": _name(), "tax_id": "๐๑๐๕๕๓๖๐๙๒๖๔๑", "branch_code": "๐๐๐๐๑",
    }, headers=admin_headers)
    assert created.status_code == 201, created.text
    data = created.json()["data"]
    assert (data["tax_id"], data["branch_code"]) == (VALID_TAX_ID, "00001")


def test_other_unicode_digits_get_a_field_error_not_a_database_error(client, admin_headers):
    arabic_indic = "٠١٠٥٥٣٦٠٩٢٦٤١"  # valid checksum, but not ASCII or Thai digits
    response = client.post(URL, json={"customer_name": _name(), "tax_id": arabic_indic}, headers=admin_headers)
    assert response.status_code == 422
