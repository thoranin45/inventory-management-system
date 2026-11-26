"""F0a: company profile API (/api/v1/company-profile)."""
from sqlalchemy import text

from app.schemas.company_profile_schema import thai_tax_id_is_valid

URL = "/api/v1/company-profile"
VALID_TAX_ID = "0105536092641"   # check digit valid
PROFILE = {
    "legal_name_th": "บริษัท ตัวอย่าง จำกัด",
    "legal_name_en": "Example Co., Ltd.",
    "tax_id": "0-1055-36092-64-1",
    "branch_code": "00000",
    "address_th": "99 ถนนพระราม 9 กรุงเทพฯ 10310",
    "address_en": "99 Rama 9 Rd, Bangkok 10310",
    "phone": "02-000-0000",
    "email": "billing@example.com",
    "vat_registered": False,
    "vat_rate": "7.00",
    "prices_include_vat": False,
}


def test_thai_tax_id_checksum():
    assert thai_tax_id_is_valid(VALID_TAX_ID)
    assert not thai_tax_id_is_valid("0105536092640")
    assert not thai_tax_id_is_valid("010553609264")
    assert not thai_tax_id_is_valid("01055360926411")


def test_admin_saves_profile_and_everyone_signed_in_can_read_it(client, admin_headers, warehouse_headers, db_session):
    saved = client.put(URL, json=PROFILE, headers=admin_headers)
    assert saved.status_code == 200, saved.text
    data = saved.json()["data"]
    assert data["tax_id"] == VALID_TAX_ID           # dashes stripped
    assert data["legal_name_th"] == PROFILE["legal_name_th"]
    assert data["vat_registered"] is False and data["vat_rate"] == "7.00"
    assert data["updated_at"]

    read = client.get(URL, headers=warehouse_headers)
    assert read.status_code == 200
    assert read.json()["data"]["tax_id"] == VALID_TAX_ID

    rows = db_session.execute(text("SELECT count(*) FROM company_profile")).scalar()
    assert rows == 1
    audit = db_session.execute(text(
        "SELECT action, description FROM audit_logs WHERE table_name = 'company_profile' ORDER BY id DESC LIMIT 1"
    )).one()
    assert audit.action in {"CREATE_COMPANY_PROFILE", "UPDATE_COMPANY_PROFILE"}


def test_second_save_updates_the_same_row_and_logs_changed_fields(client, admin_headers, db_session):
    assert client.put(URL, json=PROFILE, headers=admin_headers).status_code == 200
    changed = {**PROFILE, "phone": "02-111-1111", "vat_registered": True}
    assert client.put(URL, json=changed, headers=admin_headers).json()["data"]["vat_registered"] is True
    assert db_session.execute(text("SELECT count(*) FROM company_profile")).scalar() == 1
    audit = db_session.execute(text(
        "SELECT action, description FROM audit_logs WHERE table_name = 'company_profile' ORDER BY id DESC LIMIT 1"
    )).one()
    assert audit.action == "UPDATE_COMPANY_PROFILE"
    assert audit.description == "Changed: phone, vat_registered"
    client.put(URL, json=PROFILE, headers=admin_headers)  # leave VAT off for other tests


def test_warehouse_cannot_change_profile(client, warehouse_headers):
    assert client.put(URL, json=PROFILE, headers=warehouse_headers).status_code == 403


def test_profile_requires_sign_in(client):
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=PROFILE).status_code == 401


def test_invalid_values_are_rejected(client, admin_headers):
    for bad in (
        {"tax_id": "0105536092640"},   # wrong check digit
        {"branch_code": "1"},
        {"vat_rate": "100.01"},
        {"vat_rate": "7.001"},
        {"unknown_field": "x"},
    ):
        response = client.put(URL, json={**PROFILE, **bad}, headers=admin_headers)
        assert response.status_code == 422, bad


def test_blank_tax_fields_are_stored_as_empty(client, admin_headers):
    data = client.put(URL, json={**PROFILE, "tax_id": " ", "branch_code": ""}, headers=admin_headers).json()["data"]
    assert data["tax_id"] is None and data["branch_code"] is None
    client.put(URL, json=PROFILE, headers=admin_headers)


def test_database_keeps_a_single_profile_row(db_session):
    from sqlalchemy.exc import IntegrityError
    import pytest
    with pytest.raises(IntegrityError):
        db_session.execute(text("INSERT INTO company_profile (id) VALUES (2)"))
    db_session.rollback()
