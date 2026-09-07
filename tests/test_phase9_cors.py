"""Phase 9: CORS is explicit, never wildcard-with-credentials."""
from app.core.config import settings


def test_allowed_origin_is_echoed_with_credentials(client):
    origin = settings.cors_origin_list[0]
    r = client.get("/health", headers={"Origin": origin})
    assert r.headers.get("access-control-allow-origin") == origin
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_disallowed_origin_is_not_reflected(client):
    r = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert r.headers.get("access-control-allow-origin") != "https://evil.example.com"


def test_preflight_advertises_configured_methods_and_headers(client):
    origin = settings.cors_origin_list[0]
    r = client.options(
        "/api/v1/products",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code in (200, 204)
    allow_methods = r.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods
    assert "*" not in allow_methods


def test_config_never_wildcards_with_credentials():
    assert "*" not in settings.cors_origin_list
    assert "*" not in settings.cors_method_list
    assert "*" not in settings.cors_header_list
