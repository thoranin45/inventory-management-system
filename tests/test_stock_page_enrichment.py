"""Phase 12D — Stock page redesign: backend enrichment, category filter, and
the New Product Onboarding barcode-lookup contract.

Covers:
  * enrich_products() lot/location summary (StockBalanceRepository.
    lot_and_location_summary_by_product) for non-batch, single-lot, and
    multi-lot (FEFO nearest) products — bulk-query, no N+1.
  * GET /products?category_id= (newly wired filter).
  * GET /scan/resolve now also returns minimum_stock/safety_stock, and a
    lookup never mutates stock — known and unknown barcodes.
  * Warehouse cannot create a Product Master (RBAC unchanged, just asserted).
"""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient


def _unique() -> str:
    return uuid4().hex[:10].upper()


def _create_product(client: TestClient, headers: dict, **overrides) -> dict:
    u = _unique()
    payload = {
        "sku": f"TEST-{u}",
        "barcode": f"885{u}",
        "product_name": "Pytest Stock Page Product",
        "price": 10.00,
        "stock_qty": 0,
        "category_id": None,
        "track_batch": False,
        "track_expiry": False,
    }
    payload.update(overrides)
    r = client.post("/api/v1/products", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]


def _stock_in(client: TestClient, headers: dict, product_id: int, quantity: str) -> None:
    r = client.post(
        "/api/v1/stock/in",
        headers=headers,
        json={"product_id": product_id, "quantity": quantity},
    )
    assert r.status_code == 200, r.text


def _create_batch(client: TestClient, headers: dict, product_id: int, *, lot_no: str, quantity: str,
                   mfg_date: str | None = None, expiry_date: str | None = None) -> dict:
    body = {"product_id": product_id, "lot_no": lot_no, "quantity": quantity}
    if mfg_date:
        body["mfg_date"] = mfg_date
    if expiry_date:
        body["expiry_date"] = expiry_date
    r = client.post("/api/v1/batches", headers=headers, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]


def _get_product_row(client: TestClient, headers: dict, sku: str) -> dict:
    r = client.get("/api/v1/products", headers=headers, params={"search": sku, "page_size": 5})
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    assert len(items) == 1, items
    return items[0]


class TestLotAndLocationSummary:
    def test_non_batch_product_reports_no_lot_and_one_location(self, admin_client: TestClient, admin_headers):
        product = _create_product(admin_client, admin_headers, track_batch=False, track_expiry=False)
        _stock_in(admin_client, admin_headers, product["id"], "5")

        row = _get_product_row(admin_client, admin_headers, product["sku"])
        assert row["lot_count"] == 0
        assert row["nearest_lot_no"] is None
        assert row["nearest_expiry_date"] is None
        assert row["location_count"] == 1
        assert row["primary_warehouse_code"] is not None
        assert row["primary_location_code"] is not None

    def test_batch_tracked_single_lot_shows_that_lot(self, admin_client: TestClient, admin_headers, business_date):
        today = business_date.get()
        product = _create_product(admin_client, admin_headers, track_batch=True, track_expiry=True)
        exp = (today + timedelta(days=30)).isoformat()
        mfg = (today - timedelta(days=10)).isoformat()
        lot_no = f"LOT-{_unique()}"
        _create_batch(admin_client, admin_headers, product["id"], lot_no=lot_no, quantity="3", mfg_date=mfg, expiry_date=exp)

        row = _get_product_row(admin_client, admin_headers, product["sku"])
        assert row["lot_count"] == 1
        assert row["nearest_lot_no"] == lot_no
        assert row["nearest_expiry_date"] == exp
        assert row["location_count"] == 1

    def test_multiple_lots_nearest_not_yet_expired_wins_fefo(self, admin_client: TestClient, admin_headers, business_date):
        """Two lots: a far-future one and a soon-to-expire one. The soon one
        (still not expired) must be reported — never a random/first lot."""
        today = business_date.get()
        product = _create_product(admin_client, admin_headers, track_batch=True, track_expiry=True)
        far_lot = f"LOT-FAR-{_unique()}"
        soon_lot = f"LOT-SOON-{_unique()}"
        _create_batch(
            admin_client, admin_headers, product["id"], lot_no=far_lot, quantity="2",
            mfg_date=(today - timedelta(days=5)).isoformat(), expiry_date=(today + timedelta(days=200)).isoformat(),
        )
        _create_batch(
            admin_client, admin_headers, product["id"], lot_no=soon_lot, quantity="2",
            mfg_date=(today - timedelta(days=5)).isoformat(), expiry_date=(today + timedelta(days=5)).isoformat(),
        )

        row = _get_product_row(admin_client, admin_headers, product["sku"])
        assert row["lot_count"] == 2
        assert row["nearest_lot_no"] == soon_lot


class TestCategoryFilter:
    def test_category_id_filters_the_product_list(self, admin_client: TestClient, admin_headers):
        cat = admin_client.post(
            "/api/v1/categories", headers=admin_headers, json={"category_name": f"Cat-{_unique()}"}
        )
        assert cat.status_code in (200, 201), cat.text
        category_id = cat.json()["data"]["id"]

        in_cat = _create_product(admin_client, admin_headers, category_id=category_id)
        _create_product(admin_client, admin_headers, category_id=None)

        r = admin_client.get("/api/v1/products", headers=admin_headers, params={"category_id": category_id, "page_size": 100})
        assert r.status_code == 200, r.text
        ids = {item["id"] for item in r.json()["data"]["items"]}
        assert in_cat["id"] in ids
        # every returned row genuinely belongs to the requested category
        assert all(item["category_id"] == category_id for item in r.json()["data"]["items"])


class TestScanResolveLookupOnly:
    def test_known_barcode_includes_threshold_fields_for_status_classification(self, admin_client: TestClient, admin_headers):
        product = _create_product(admin_client, admin_headers)
        r = admin_client.get("/api/v1/scan/resolve", headers=admin_headers, params={"barcode": product["barcode"], "context": "lookup"})
        assert r.status_code == 200, r.text
        body = r.json()["data"]["product"]
        assert body["id"] == product["id"]
        assert "minimum_stock" in body
        assert "safety_stock" in body
        assert Decimal(str(body["minimum_stock"])) == Decimal("0")

    def test_unknown_barcode_is_a_clean_404_not_a_generic_error(self, admin_client: TestClient, admin_headers):
        r = admin_client.get(
            "/api/v1/scan/resolve", headers=admin_headers, params={"barcode": f"NOPE-{_unique()}", "context": "lookup"}
        )
        assert r.status_code == 404

    def test_lookup_never_mutates_stock_known_barcode(self, admin_client: TestClient, admin_headers):
        product = _create_product(admin_client, admin_headers)
        _stock_in(admin_client, admin_headers, product["id"], "7")
        before = _get_product_row(admin_client, admin_headers, product["sku"])["operational_available_quantity"]

        for _ in range(3):
            r = admin_client.get(
                "/api/v1/scan/resolve", headers=admin_headers,
                params={"barcode": product["barcode"], "context": "lookup"},
            )
            assert r.status_code == 200

        after = _get_product_row(admin_client, admin_headers, product["sku"])["operational_available_quantity"]
        assert Decimal(str(after)) == Decimal(str(before))

    def test_lookup_of_unknown_barcode_never_mutates_or_creates_anything(self, admin_client: TestClient, admin_headers):
        code = f"NOPE-{_unique()}"
        before = admin_client.get("/api/v1/products", headers=admin_headers, params={"page_size": 1}).json()["data"]["pagination"]["total_items"]

        r = admin_client.get("/api/v1/scan/resolve", headers=admin_headers, params={"barcode": code, "context": "lookup"})
        assert r.status_code == 404

        # still not found — proves the failed lookup created no Product Master
        r2 = admin_client.get("/api/v1/products/barcode/" + code, headers=admin_headers)
        assert r2.status_code == 404
        after = admin_client.get("/api/v1/products", headers=admin_headers, params={"page_size": 1}).json()["data"]["pagination"]["total_items"]
        assert after == before


class TestNewProductOnboardingRbac:
    def test_warehouse_cannot_create_product_master(self, warehouse_client: TestClient, warehouse_headers):
        u = _unique()
        r = warehouse_client.post(
            "/api/v1/products",
            headers=warehouse_headers,
            json={
                "sku": f"TEST-{u}",
                "barcode": f"885{u}",
                "product_name": "Should Be Rejected",
                "price": 5.00,
                "stock_qty": 0,
            },
        )
        assert r.status_code == 403

    def test_warehouse_can_still_look_up_by_barcode(self, admin_client: TestClient, admin_headers,
                                                      warehouse_client: TestClient, warehouse_headers):
        product = _create_product(admin_client, admin_headers)
        r = warehouse_client.get(
            "/api/v1/scan/resolve", headers=warehouse_headers,
            params={"barcode": product["barcode"], "context": "lookup"},
        )
        assert r.status_code == 200


class TestBarcodeDoesNotDetermineLot:
    """A product barcode identifies the Product Master only — never a lot or
    expiry — unless the physical barcode format itself encodes one (not the
    case here: plain EAN/UPC-style codes). scan/resolve must enumerate every
    lot the product has, not silently pick "the" lot for the scanned code."""

    def test_scan_resolve_lists_every_lot_not_a_single_implied_one(self, admin_client: TestClient, admin_headers, business_date):
        today = business_date.get()
        product = _create_product(admin_client, admin_headers, track_batch=True, track_expiry=True)
        lot_a = f"LOT-A-{_unique()}"
        lot_b = f"LOT-B-{_unique()}"
        for lot in (lot_a, lot_b):
            _create_batch(
                admin_client, admin_headers, product["id"], lot_no=lot, quantity="1",
                mfg_date=today.isoformat(), expiry_date=(today + timedelta(days=60)).isoformat(),
            )

        r = admin_client.get(
            "/api/v1/scan/resolve", headers=admin_headers,
            params={"barcode": product["barcode"], "context": "lookup"},
        )
        assert r.status_code == 200
        lot_nos = {b["lot_no"] for b in r.json()["data"]["batches"]}
        # the SAME barcode resolves to BOTH lots — the barcode never asserts
        # which one is physically in hand; that choice stays with the operator.
        assert {lot_a, lot_b} <= lot_nos
