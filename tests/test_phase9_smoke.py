"""Phase 9: read-mostly smoke checks + /metrics endpoint."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_smoke_script_parses_and_exposes_checks():
    spec = importlib.util.spec_from_file_location(
        "phase9_smoke", ROOT / "scripts" / "smoke.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert hasattr(module, "run")
    assert hasattr(module, "CHECKS")
    names = {name for name, _ in module.CHECKS}
    assert {"health", "ready", "login", "auth_me", "product_list"} <= names


def test_smoke_run_against_test_client(client, admin_user, monkeypatch):
    import scripts.smoke as smoke

    results = smoke.run(
        base_client=client,
        username=admin_user.username,
        password="AdminTest123!",
    )
    by_name = {r["name"]: r for r in results}
    assert by_name["health"]["ok"] is True
    assert by_name["ready"]["ok"] is True
    assert by_name["login"]["ok"] is True
    assert by_name["auth_me"]["ok"] is True
    # smoke test never mutates inventory
    assert all("delete" not in r["name"] and "create" not in r["name"] for r in results)


# ---- /metrics ---------------------------------------------------------

def test_metrics_requires_admin(client, warehouse_headers):
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers=warehouse_headers).status_code == 403


def test_metrics_returns_prometheus_text(client, admin_headers):
    client.get("/api/v1/products", headers=admin_headers)
    r = client.get("/metrics", headers=admin_headers)
    assert r.status_code == 200
    body = r.text
    assert "http_requests_total{" in body
    assert "http_request_duration_seconds_count" in body
    # low cardinality: no path labels, no ids
    assert "/api/v1/products" not in body


def test_metrics_business_counter_and_reset():
    from app.core import metrics

    metrics.reset()
    metrics.inc("stock_conflict")
    metrics.inc("stock_conflict", 2)
    assert "app_stock_conflict_total 3" in metrics.render()
    metrics.reset()
    assert "app_stock_conflict_total" not in metrics.render()


def test_client_ip_trusts_only_configured_proxy_hops(monkeypatch):
    from types import SimpleNamespace

    from app.middleware import client_ip

    def fake_request(xff, peer="10.0.0.1"):
        return SimpleNamespace(
            client=SimpleNamespace(host=peer),
            headers={"x-forwarded-for": xff} if xff else {},
        )

    monkeypatch.setattr(client_ip.settings, "trusted_proxy_count", 0)
    assert client_ip.resolve_client_ip(fake_request("1.2.3.4")) == "10.0.0.1"

    monkeypatch.setattr(client_ip.settings, "trusted_proxy_count", 1)
    # With one trusted proxy, the address that proxy appended (rightmost hop)
    # is the real client; a spoofed left entry is ignored.
    assert client_ip.resolve_client_ip(
        fake_request("203.0.113.7, 172.16.0.9")
    ) == "172.16.0.9"
    # Chain shorter than the trusted depth: fall back to the left-most entry.
    assert client_ip.resolve_client_ip(fake_request("9.9.9.9")) == "9.9.9.9"
    # No XFF at all -> socket peer.
    assert client_ip.resolve_client_ip(fake_request(None)) == "10.0.0.1"
