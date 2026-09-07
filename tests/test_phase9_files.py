"""Phase 9: generated-file path containment and export concurrency safety."""
import io
from pathlib import Path
from uuid import uuid4

import pytest
from openpyxl import load_workbook

from app.core.safe_paths import resolve_within, safe_component


# ---- unit: path helpers --------------------------------------------------

@pytest.mark.parametrize("evil", [
    "../../etc/passwd", "..\\..\\win.ini", "a/b/c", "/abs/path", "....//x",
    "lot..no", "..", ".", "",
])
def test_safe_component_strips_separators_and_dots(evil):
    out = safe_component(evil, fallback="fallback")
    assert "/" not in out and "\\" not in out
    assert not out.startswith(".")
    assert out


def test_resolve_within_blocks_escape(tmp_path):
    base = tmp_path / "static"
    base.mkdir()
    inside = resolve_within(base, "product_5.pdf")
    assert str(inside).startswith(str(base.resolve()))
    with pytest.raises(ValueError):
        resolve_within(base, "..", "..", "escaped.pdf")


# ---- integration: exports are unique + cleaned up ----------------------

def _product(client, headers):
    tag = uuid4().hex[:10].upper()
    return client.post("/api/v1/products", headers=headers, json={
        "sku": f"EXP-{tag}", "barcode": f"992{tag}", "product_name": f"Exp {tag}",
        "price": 2, "stock_qty": 0, "category_id": None,
    }).json()["data"]


def test_export_writes_no_shared_file_and_cleans_up(client, admin_headers):
    _product(client, admin_headers)
    exports = Path("exports")

    r1 = client.get("/api/v1/reports/export/stock", headers=admin_headers)
    r2 = client.get("/api/v1/reports/export/stock", headers=admin_headers)
    assert r1.status_code == r2.status_code == 200
    assert r1.content.startswith(b"PK") and r2.content.startswith(b"PK")

    # The old shared filename is never created, and temp files are removed.
    assert not (exports / "stock_report.xlsx").exists()
    leftovers = list(exports.glob("stock_report_*.xlsx")) if exports.exists() else []
    assert leftovers == []

    wb = load_workbook(io.BytesIO(r1.content))
    assert wb["Stock Report"]["A1"].value == "Product ID"


def test_export_row_cap_rejects_oversized(client, admin_headers, monkeypatch):
    import app.routers.report_router as rr

    monkeypatch.setattr(rr, "_EXPORT_MAX_ROWS", 0)
    _product(client, admin_headers)
    r = client.get("/api/v1/reports/export/stock", headers=admin_headers)
    assert r.status_code == 400
    assert "narrow the filters" in r.json()["message"].lower()
