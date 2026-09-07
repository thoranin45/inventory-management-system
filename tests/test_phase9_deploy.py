"""Phase 9: deployment configuration safety (static checks, no Docker needed)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def test_prod_compose_does_not_auto_migrate_in_api_service():
    txt = _read("compose.prod.yml")
    api_block = txt.split("\n  api:", 1)[1].split("\n  migrate:", 1)[0]
    assert "alembic upgrade head" not in api_block
    # A dedicated, non-default migrate service exists instead.
    assert 'profiles: ["migrate"]' in txt
    assert '"alembic", "upgrade", "head"' in txt


def test_prod_compose_image_is_pinnable_not_latest():
    txt = _read("compose.prod.yml")
    assert "inventory-management-system:latest" not in txt
    assert "${API_IMAGE" in txt


def test_prod_compose_has_no_published_postgres_port():
    txt = _read("compose.prod.yml")
    db_block = txt.split("\n  db:", 1)[1].split("\n  api:", 1)[0]
    assert "5432:5432" not in db_block
    assert "ports:" not in db_block  # expose only


def test_prod_compose_healthcheck_uses_liveness_endpoint():
    txt = _read("compose.prod.yml")
    assert "/health" in txt
    assert "/api/v1/health/" not in txt


def test_dockerfile_enables_proxy_headers_and_non_root():
    txt = _read("Dockerfile")
    assert "--proxy-headers" in txt
    assert "--forwarded-allow-ips" in txt
    assert "USER appuser" in txt
    assert "alembic upgrade head" not in txt


def test_prod_env_example_has_only_placeholders():
    txt = _read(".env.production.example")
    assert "CHANGE_ME" in txt
    # no real-looking secret slipped in
    for line in txt.splitlines():
        if line.startswith("SECRET_KEY="):
            assert line.strip() == "SECRET_KEY=CHANGE_ME"


def test_insecure_backup_script_removed():
    assert not (ROOT / "scripts" / "backup_db.ps1").exists()
    for script in ("backup.sh", "restore.sh", "prune_backups.sh", "db_revision_check.py"):
        assert (ROOT / "scripts" / script).exists()
