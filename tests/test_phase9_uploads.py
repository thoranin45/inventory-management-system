"""Phase 9: product image upload safety."""
import io
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image

from app.core.config import settings


def _png_bytes(size=(4, 4)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _make_product(client, headers) -> int:
    tag = uuid4().hex[:10].upper()
    r = client.post("/api/v1/products", headers=headers, json={
        "sku": f"IMG-{tag}", "barcode": f"991{tag}", "product_name": f"Img {tag}",
        "price": 1, "stock_qty": 0, "category_id": None,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]["id"]


def test_valid_png_upload_succeeds(client, admin_headers):
    pid = _make_product(client, admin_headers)
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("photo.png", _png_bytes(), "image/png")},
    )
    assert r.status_code == 200, r.text
    stored = Path("uploads/products") / f"product_{pid}.png"
    assert stored.exists()
    # containment: nothing was written outside uploads/products
    assert stored.resolve().parent == (Path("uploads/products").resolve())


def test_oversize_upload_rejected_with_413(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 16)
    pid = _make_product(client, admin_headers)
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("big.png", _png_bytes((64, 64)), "image/png")},
    )
    assert r.status_code == 413


def test_non_image_bytes_rejected(client, admin_headers):
    pid = _make_product(client, admin_headers)
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("evil.png", b"this is not an image", "image/png")},
    )
    assert r.status_code == 400
    assert "valid image" in r.json()["message"].lower()


def test_missing_or_wrong_content_type_rejected(client, admin_headers):
    pid = _make_product(client, admin_headers)
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("photo.png", _png_bytes(), "application/octet-stream")},
    )
    assert r.status_code == 400


def test_filename_path_traversal_cannot_escape(client, admin_headers):
    pid = _make_product(client, admin_headers)
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("../../../../etc/passwd.png", _png_bytes(), "image/png")},
    )
    # Accepted (bytes are a real png) but stored under the server-controlled name.
    assert r.status_code == 200
    assert (Path("uploads/products") / f"product_{pid}.png").exists()
    assert not Path("uploads/etc").exists()


def test_extension_swap_removes_stale_variant(client, admin_headers):
    pid = _make_product(client, admin_headers)
    client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("a.png", _png_bytes(), "image/png")},
    )
    jpg = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(jpg, format="JPEG")
    r = client.post(
        f"/api/v1/products/{pid}/upload-image",
        headers=admin_headers,
        files={"file": ("a.jpg", jpg.getvalue(), "image/jpeg")},
    )
    assert r.status_code == 200
    assert (Path("uploads/products") / f"product_{pid}.jpg").exists()
    assert not (Path("uploads/products") / f"product_{pid}.png").exists()
