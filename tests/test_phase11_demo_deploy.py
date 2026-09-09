"""Phase 11.1: demo deployment configuration safety.

Static checks on the additive demo-deployment files plus black-box checks on
the demo seed's refusal guards. No Docker and no database required. These are
additive — they do not touch the Phase 9 deployment tests
(``tests/test_phase9_deploy.py`` / ``tests/test_phase9_backup.py``).
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


_SERVICES = ("db", "migrate", "api", "seed", "frontend", "nginx")


def _service_block(compose_text: str, name: str) -> list[str]:
    """The YAML lines belonging to one top-level service (up to the next one)."""
    marker = f"\n  {name}:\n"
    assert marker in compose_text, f"service {name!r} not found in compose file"
    rest = compose_text.split(marker, 1)[1]
    out = []
    for line in rest.splitlines():
        if any(line == f"  {other}:" for other in _SERVICES):
            break
        if line and not line[0].isspace():  # left the services: mapping
            break
        out.append(line)
    return out


def _has_key(block_lines: list[str], key: str) -> bool:
    return any(ln.strip() == f"{key}:" for ln in block_lines)


def _svc_text(compose_text: str, name: str) -> str:
    return "\n".join(_service_block(compose_text, name))


def _image_lines(compose_text: str) -> list[str]:
    return [ln.strip() for ln in compose_text.splitlines()
            if ln.strip().startswith("image:")]


# --------------------------------------------------------------------------- #
# compose.demo.yml
# --------------------------------------------------------------------------- #

def test_demo_compose_exists_and_names_the_stack():
    txt = _read("compose.demo.yml")
    assert "name: inventory-demo" in txt


def test_demo_compose_only_nginx_publishes_a_host_port_and_only_on_loopback():
    txt = _read("compose.demo.yml")
    for svc in ("db", "api", "frontend", "migrate", "seed"):
        assert not _has_key(_service_block(txt, svc), "ports"), \
            f"{svc} must not publish a host port"
    nginx = _service_block(txt, "nginx")
    assert _has_key(nginx, "ports")
    assert '"127.0.0.1:8080:80"' in "\n".join(nginx)


def test_demo_compose_db_is_internal_only():
    block = _service_block(_read("compose.demo.yml"), "db")
    assert _has_key(block, "expose")
    assert "5432:5432" not in "\n".join(block)


def test_demo_compose_api_does_not_run_migrations_on_start():
    api = _svc_text(_read("compose.demo.yml"), "api")
    assert "alembic" not in api, "api service must not run alembic"
    assert not _has_key(api.splitlines(), "command"), "api must use the image CMD"


def test_demo_compose_has_one_shot_migrate_profile():
    migrate = _svc_text(_read("compose.demo.yml"), "migrate")
    assert 'profiles: ["migrate"]' in migrate
    assert '"alembic", "upgrade", "head"' in migrate
    assert 'restart: "no"' in migrate


def test_demo_compose_has_one_shot_seed_profile():
    seed = _svc_text(_read("compose.demo.yml"), "seed")
    assert 'profiles: ["seed"]' in seed
    assert "scripts/seed_demo.py" in seed
    assert 'restart: "no"' in seed


def test_demo_compose_images_are_pinned_not_latest():
    txt = _read("compose.demo.yml")
    assert "${API_IMAGE" in txt
    assert "${FRONTEND_IMAGE" in txt
    for line in _image_lines(txt):
        assert ":latest" not in line, line


def test_demo_compose_frontend_talks_to_api_over_the_internal_network():
    block = _svc_text(_read("compose.demo.yml"), "frontend")
    assert "API_BASE_URL: http://api:8081" in block
    assert "COOKIE_SECURE" in block


def test_demo_compose_healthcheck_uses_liveness_not_legacy_health():
    txt = _read("compose.demo.yml")
    assert "/health" in txt
    assert "/api/v1/health/" not in txt


# --------------------------------------------------------------------------- #
# nginx/demo.conf
# --------------------------------------------------------------------------- #

def test_demo_nginx_never_proxies_the_api_directly():
    txt = _read("nginx/demo.conf")
    code = "\n".join(ln for ln in txt.splitlines() if not ln.lstrip().startswith("#"))
    assert "location /api/v1" not in code
    assert "api:8081" not in code
    assert "proxy_pass http://demo_frontend" in code  # it proxies only the frontend


def test_demo_nginx_restores_the_real_client_ip():
    txt = _read("nginx/demo.conf")
    assert "set_real_ip_from" in txt
    assert "real_ip_header X-Forwarded-For" in txt
    assert "real_ip_recursive on" in txt
    assert "X-Forwarded-For" in txt and "$proxy_add_x_forwarded_for" in txt


def test_demo_nginx_realip_trust_is_the_docker_hop_not_spoofable_ranges():
    """Trust only the private bridge-gateway hop; never the CGNAT range a
    tailnet client's own address falls in (that would let it be seen through)."""
    directives = [ln.strip() for ln in _read("nginx/demo.conf").splitlines()
                  if ln.strip().startswith("set_real_ip_from")]
    joined = " ".join(directives)
    assert "100.64.0.0/10" not in joined, "must not trust the Tailscale CGNAT range"
    assert "172.16.0.0/12" in joined and "10.0.0.0/8" in joined and "192.168.0.0/16" in joined


def test_demo_nginx_keeps_the_upload_ceiling_compatible_with_the_backend():
    txt = _read("nginx/demo.conf")
    assert "client_max_body_size" in txt


# --------------------------------------------------------------------------- #
# frontend image
# --------------------------------------------------------------------------- #

def test_frontend_dockerfile_is_non_root_and_standalone():
    txt = _read("frontend/Dockerfile")
    assert "USER nextjs" in txt
    assert "/app/.next/standalone" in txt
    assert "alembic" not in txt


def test_frontend_next_config_emits_standalone_bundle():
    txt = _read("frontend/next.config.ts")
    assert 'output: "standalone"' in txt


def test_frontend_dockerignore_excludes_real_env_files_but_keeps_examples():
    txt = _read("frontend/.dockerignore")
    assert ".env" in txt
    assert "!.env*.example" in txt


# --------------------------------------------------------------------------- #
# .env.demo.example  /  .gitignore
# --------------------------------------------------------------------------- #

def test_demo_env_example_has_only_placeholders():
    txt = _read(".env.demo.example")
    assert "CHANGE_ME" in txt
    for line in txt.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        if key in {"SECRET_KEY", "POSTGRES_PASSWORD", "DB_PASSWORD",
                   "DEMO_ADMIN_PASSWORD", "DEMO_WH_PASSWORD"}:
            assert value == "CHANGE_ME", f"{key} must be the literal placeholder"
        assert "sup3rsecret" not in value  # the password once committed to history


def test_demo_env_example_uses_internal_service_hostnames():
    txt = _read(".env.demo.example")
    assert "API_BASE_URL=http://api:8081" in txt
    assert "@db:5432/" in txt


def test_real_demo_env_is_git_ignored():
    txt = _read(".gitignore")
    assert any(line.strip() == ".env.demo" for line in txt.splitlines())
    # An operator following docs/demo-deployment.md WILL have a local
    # .env.demo (cp from the template). The invariant is that it is never
    # tracked — not that it is absent from disk.
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".env.demo"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    assert tracked.returncode != 0, "a real .env.demo must never be git-tracked"
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", ".env.demo"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    assert ignored.returncode == 0, ".env.demo must be matched by .gitignore"


# --------------------------------------------------------------------------- #
# scripts/seed_demo.py  — refusal guards (black box)
# --------------------------------------------------------------------------- #

DEMO_URL = "postgresql+psycopg2://inventory_demo:x@db:5432/inventory_demo"


def _run_seed(**env_overrides):
    import os

    env = {k: v for k, v in os.environ.items()
           if k not in ("SEED_CONFIRM", "DATABASE_URL", "SEED_DATABASE_URL",
                        "DEMO_ADMIN_PASSWORD", "DEMO_WH_PASSWORD", "DEMO_API",
                        "SEED_I_UNDERSTAND_THIS_IS_NOT_PRODUCTION")}
    env.update({k: v for k, v in env_overrides.items() if v is not None})
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "seed_demo.py")],
        capture_output=True, text=True, env=env, cwd=str(ROOT), timeout=60,
    )


def test_seed_refuses_without_explicit_confirmation():
    r = _run_seed(DATABASE_URL=DEMO_URL, DEMO_ADMIN_PASSWORD="demopass123",
                  DEMO_WH_PASSWORD="demopass123")
    assert r.returncode != 0
    assert "SEED_CONFIRM" in r.stderr


def test_seed_refuses_without_an_explicit_database_target():
    r = _run_seed(SEED_CONFIRM="1", DEMO_ADMIN_PASSWORD="demopass123",
                  DEMO_WH_PASSWORD="demopass123")
    assert r.returncode != 0
    assert "EXPLICIT" in r.stderr or "explicit" in r.stderr


def test_seed_refuses_a_production_like_target():
    r = _run_seed(SEED_CONFIRM="1", DEMO_ADMIN_PASSWORD="demopass123",
                  DEMO_WH_PASSWORD="demopass123",
                  DATABASE_URL="postgresql+psycopg2://u:x@db:5432/inventory_production")
    assert r.returncode != 0
    assert "production" in r.stderr


def test_seed_refuses_a_non_demo_target_without_the_override():
    r = _run_seed(SEED_CONFIRM="1", DEMO_ADMIN_PASSWORD="demopass123",
                  DEMO_WH_PASSWORD="demopass123",
                  DATABASE_URL="postgresql+psycopg2://u:x@db:5432/inventory_main")
    assert r.returncode != 0
    assert "demo" in r.stderr.lower()


def test_seed_refuses_placeholder_passwords():
    r = _run_seed(SEED_CONFIRM="1", DATABASE_URL=DEMO_URL,
                  DEMO_ADMIN_PASSWORD="CHANGE_ME", DEMO_WH_PASSWORD="CHANGE_ME")
    assert r.returncode != 0
    assert "placeholder" in r.stderr.lower()


def test_seed_source_has_no_settings_fallback_and_no_hardcoded_password():
    src = _read("scripts/seed_demo.py")
    assert "from app.core.config import settings" not in src
    assert "settings.database_url" not in src
    assert "sup3rsecret" not in src
    # passwords only ever come from the environment
    assert 'os.environ.get("DEMO_ADMIN_PASSWORD"' in src
    assert 'os.environ.get("DEMO_WH_PASSWORD"' in src


def test_seed_has_a_required_state_gate_that_exits_non_zero():
    src = _read("scripts/seed_demo.py")
    assert "REQUIRED DEMO STATE CHECK: FAIL" in src
    assert "raise SystemExit(1)" in src
    assert "_verify_static" in src and "_verify_lifecycle" in src
    # the gate is actually invoked at the end of the run
    assert "_finish(_verify_static() + _verify_lifecycle(" in src


def test_bff_forwards_only_the_vetted_x_real_ip():
    """The BFF must not read the attacker-controllable X-Forwarded-For chain
    to derive the client IP — only nginx's authoritative X-Real-IP."""
    src = _read("frontend/src/lib/api/server.ts")
    fn = src.split("forwardedClientHeaders", 1)[1].split("\n}\n", 1)[0]
    assert 'h.get("x-real-ip")' in fn
    assert 'h.get("x-forwarded-for")' not in fn   # never read the raw XFF chain
    assert 'xff' not in fn                        # no left-most-hop fallback var


def test_bff_does_not_forward_x_forwarded_proto_to_fastapi():
    """Forwarding the browser-facing HTTPS scheme makes Starlette emit absolute
    https://api:8081/... trailing-slash redirects that rawRequest's fetch can't
    follow (api is plain HTTP) -> BFF 502 on /sales-orders and /audit-logs."""
    src = _read("frontend/src/lib/api/server.ts")
    fn = src.split("forwardedClientHeaders", 1)[1].split("\n}\n", 1)[0]
    assert 'out["x-forwarded-proto"]' not in fn
    assert 'h.get("x-forwarded-proto")' not in fn
