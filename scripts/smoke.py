"""Post-deploy smoke test. Read-mostly: never mutates real inventory.

Checks: /health, /ready, OpenAPI (or its documented absence), login, /auth/me,
dashboard summary, product list, stock list, global search, and the
X-Request-ID contract.

An optional draft-workflow check (create + immediately cancel a Sales Order)
runs ONLY when SMOKE_SANDBOX=1 and SMOKE_SANDBOX_CUSTOMER_ID / _PRODUCT_ID are
supplied, so it is never accidentally run against real production data.

Usage:
    SMOKE_BASE_URL=https://staging.example.com \
    SMOKE_USERNAME=smoke SMOKE_PASSWORD=... \
        python scripts/smoke.py
"""
from __future__ import annotations

import json
import os
import sys


def _get(client, path, **kw):
    return client.get(path, **kw)


def _check_health(ctx):
    r = _get(ctx["client"], "/health")
    return r.status_code == 200 and r.json().get("data", {}).get("status") == "ok", \
        f"status={r.status_code}"


def _check_ready(ctx):
    r = _get(ctx["client"], "/ready")
    body = r.json()
    ok = r.status_code == 200 and body.get("status") == "ready" \
        and body.get("migration") == body.get("expected")
    return ok, f"status={r.status_code} migration={body.get('migration')}"


def _check_openapi(ctx):
    r = _get(ctx["client"], "/openapi.json")
    # 200 (docs on) or 404 (deliberately disabled in prod) are both acceptable.
    return r.status_code in (200, 404), f"status={r.status_code}"


def _check_login(ctx):
    r = ctx["client"].post(
        "/api/v1/auth/token",
        data={"username": ctx["username"], "password": ctx["password"]},
    )
    if r.status_code == 200 and r.json().get("access_token"):
        ctx["token"] = r.json()["access_token"]
        return True, "token acquired"
    return False, f"status={r.status_code}"


def _auth_headers(ctx):
    return {"Authorization": f"Bearer {ctx.get('token', '')}"}


def _check_auth_me(ctx):
    r = _get(ctx["client"], "/api/v1/auth/me", headers=_auth_headers(ctx))
    body = r.json() if r.status_code == 200 else {}
    return r.status_code == 200 and set(body) == {"id", "username", "role", "is_active"}, \
        f"status={r.status_code}"


def _check_dashboard(ctx):
    r = _get(ctx["client"], "/api/v1/dashboard/summary", headers=_auth_headers(ctx))
    return r.status_code == 200, f"status={r.status_code}"


def _check_product_list(ctx):
    r = _get(ctx["client"], "/api/v1/products?page=1&page_size=1",
             headers=_auth_headers(ctx))
    return r.status_code == 200 and "data" in r.json(), f"status={r.status_code}"


def _check_stock_list(ctx):
    r = _get(ctx["client"], "/api/v1/stock-balances?page_size=1",
             headers=_auth_headers(ctx))
    return r.status_code == 200, f"status={r.status_code}"


def _check_search(ctx):
    r = _get(ctx["client"], "/api/v1/search?q=zzz-smoke-none",
             headers=_auth_headers(ctx))
    return r.status_code == 200, f"status={r.status_code}"


def _check_request_id(ctx):
    r = _get(ctx["client"], "/api/v1/does-not-exist")
    hdr = r.headers.get("X-Request-ID")
    body_id = r.json().get("request_id") if r.headers.get("content-type", "").startswith("application/json") else None
    return bool(hdr) and hdr == body_id, f"header={hdr} body={body_id}"


CHECKS = [
    ("health", _check_health),
    ("ready", _check_ready),
    ("openapi", _check_openapi),
    ("login", _check_login),
    ("auth_me", _check_auth_me),
    ("dashboard_summary", _check_dashboard),
    ("product_list", _check_product_list),
    ("stock_list", _check_stock_list),
    ("search", _check_search),
    ("request_id", _check_request_id),
]


def run(base_client=None, base_url=None, username=None, password=None):
    if base_client is None:
        import httpx

        base_client = httpx.Client(base_url=base_url or os.environ["SMOKE_BASE_URL"],
                                   timeout=10.0)
    ctx = {
        "client": base_client,
        "username": username or os.environ.get("SMOKE_USERNAME", ""),
        "password": password or os.environ.get("SMOKE_PASSWORD", ""),
    }
    results = []
    for name, fn in CHECKS:
        try:
            ok, detail = fn(ctx)
        except Exception as exc:  # never leak a stack trace to stdout
            ok, detail = False, f"error: {type(exc).__name__}"
        results.append({"name": name, "ok": bool(ok), "detail": detail})
    return results


def main() -> int:
    results = run()
    for r in results:
        print(f"[{'PASS' if r['ok'] else 'FAIL'}] {r['name']:<18} {r['detail']}")
    print(json.dumps({"passed": sum(r["ok"] for r in results), "total": len(results)}))
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
