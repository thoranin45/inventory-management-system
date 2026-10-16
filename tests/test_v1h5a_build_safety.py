"""V1-H5A: tracked-secret sanitation, Alembic target safety, Docker build context.

Offline: no database, no network, no Docker. The build-context checks evaluate
the real .dockerignore files with Docker's matching rules (root-relative
patterns, ``**``, last match wins, ``!`` re-includes, an excluded parent
directory excludes its contents).
"""
import io
import os
import re
import subprocess
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from app.core.db_revision import describe_migration_target, migration_target
from tests.test_phase9_backup import SYNTHETIC_PASSWORD, _hardcoded_credentials

ROOT = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------- #
# Docker .dockerignore semantics
# --------------------------------------------------------------------------- #

def _pattern_regex(pattern: str) -> re.Pattern:
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        elif pattern[i] == "[":
            end = pattern.index("]", i)
            out, i = out + pattern[i:end + 1], end + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(out)


def _rules(dockerignore: Path):
    rules = []
    for raw in dockerignore.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        pattern = line[1:].strip() if negate else line
        pattern = pattern.strip("/")
        rules.append((negate, _pattern_regex(pattern)))
    return rules


def _excluded(path: str, rules) -> bool:
    parts = path.split("/")
    candidates = ["/".join(parts[:n]) for n in range(1, len(parts) + 1)]
    excluded = False
    for negate, regex in rules:
        if any(regex.fullmatch(c) for c in candidates):
            excluded = not negate
    return excluded


API_RULES = _rules(ROOT / ".dockerignore")
FRONTEND_RULES = _rules(ROOT / "frontend" / ".dockerignore")


def _context_files(base: Path, rules):
    """Files Docker would send: walks the tree, pruning excluded directories
    (as Docker's walker does when no ``!`` rule re-includes inside them)."""
    reincludes = any(negate and "/" in regex.pattern for negate, regex in rules)
    files = []
    for directory, subdirs, names in os.walk(base):
        rel_dir = Path(directory).relative_to(base).as_posix()
        prefix = "" if rel_dir == "." else rel_dir + "/"
        subdirs[:] = [d for d in subdirs if not (
            _excluded(prefix + d, rules) and (not reincludes or d in {"node_modules", ".next", ".git"}))]
        files += [prefix + n for n in names]
    return files


@pytest.mark.parametrize("path", [
    ".env", ".env.demo", ".env.test", ".env.production", "app/.env", "scripts/.env.local",
    "alembic/.env", "deploy/keys/server.pem", "certs/tls.key", "backups/inventory.dump",
    "dump/inventory.sql", "data/old.sqlite3", "inventory.db", "app/__pycache__/main.cpython-312.pyc",
    "app/core/__pycache__/x.pyc", ".coverage", ".coverage.host.123", "logs/app.log",
    "uploads/product_1.png", "exports/report.xlsx", "app/static/barcodes/p1.png",
    "app/static/invoices/INV-1.pdf", "app/static/qrcodes/p1.png", "tests/test_x.py",
    "frontend/.env.local", "frontend/node_modules/x/index.js", "frontend-prototype/index.html",
    "docs/deployment.md", "scripts/e2e/build-context-manifest.json", "scripts/e2e/seed.py",
    "compose.e2e.yml", ".gitattributes", "venv/Scripts/python.exe", ".claude/settings.json",
    "frontend/tsconfig.tsbuildinfo", "x.patch",
])
def test_api_context_excludes_secrets_evidence_and_local_artefacts(path):
    assert _excluded(path, API_RULES), path


@pytest.mark.parametrize("path", [
    "Dockerfile", "requirements.txt", "alembic.ini", "alembic/env.py", "alembic/script.py.mako",
    "alembic/versions/eb1a00000001_sales_return_receipts.py",
    "alembic/versions/ec1a00000001_stock_transaction_remark_text.py",
    "app/main.py", "app/core/db_revision.py", "app/models.py",
    "scripts/__init__.py", "scripts/seed_demo.py", "scripts/check_inventory_consistency.py",
    "scripts/check_phase3_preflight.py", "scripts/db_revision_check.py", ".env.demo.example",
])
def test_api_context_keeps_what_the_image_needs(path):
    assert not _excluded(path, API_RULES), path


@pytest.mark.parametrize("path", [
    ".env", ".env.local", ".env.production", "src/.env", "src/app/.env.local", "node_modules/next/x.js",
    ".next/cache/x", "coverage/index.html", "tsconfig.tsbuildinfo", "test-results/r.json",
    "playwright-report/index.html", "certs/dev.pem", "certs/dev.key", ".turbo/cache",
])
def test_frontend_context_excludes_secrets_and_build_artefacts(path):
    assert _excluded(path, FRONTEND_RULES), path


@pytest.mark.parametrize("path", [
    "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "public/favicon.ico",
    "src/app/layout.tsx", "src/app/api/bff/[...path]/route.ts", "src/components/sales/return-form.tsx",
    ".env.example",
])
def test_frontend_context_keeps_sources(path):
    assert not _excluded(path, FRONTEND_RULES), path


SENSITIVE = re.compile(
    r"(^|/)\.env(?!\.[^/]*\.?example$)(\.[^/]*)?$|\.(pem|key|p12|pfx|dump|sql|sqlite3?|db)$|"
    r"(^|/)(backups|uploads|exports|logs|venv|venv_py38_backup|__pycache__|node_modules|\.next)(/|$)|"
    r"(^|/)scripts/e2e/|(^|/)compose\.e2e\.yml$|(^|/)tests/|(^|/)app/static/")


def test_effective_api_context_of_this_checkout_has_no_sensitive_file():
    included = [p for p in _context_files(ROOT, API_RULES) if not _excluded(p, API_RULES)]
    leaked = [p for p in included if SENSITIVE.search(p) or p.startswith("frontend/")]
    assert leaked == []
    for required in ("alembic.ini", "alembic/env.py", "app/main.py", "scripts/seed_demo.py", "requirements.txt"):
        assert required in included


def test_effective_frontend_context_of_this_checkout_has_no_sensitive_file():
    included = [p for p in _context_files(ROOT / "frontend", FRONTEND_RULES) if not _excluded(p, FRONTEND_RULES)]
    leaked = [p for p in included if SENSITIVE.search(p)]
    assert leaked == []
    assert "package-lock.json" in included and "next.config.ts" in included


# --------------------------------------------------------------------------- #
# No tracked credential
# --------------------------------------------------------------------------- #

def _ini_url():
    return re.search(r"^sqlalchemy\.url\s*=\s*(\S+)", (ROOT / "alembic.ini").read_text(encoding="utf-8"),
                     re.M).group(1)


def test_alembic_ini_carries_no_credential_and_no_real_host():
    url = _ini_url()
    assert "@" not in url and ":" not in url.split("://", 1)[1]  # no userinfo, no port
    assert re.fullmatch(r"postgresql://[a-z0-9.-]+\.invalid/no_database", url)


def _context_files_with_credentials(base: Path, rules) -> list[str]:
    hits = []
    for rel in _context_files(base, rules):
        path = base / rel
        if not _excluded(rel, rules) and path.stat().st_size < 2_000_000:
            if _hardcoded_credentials(path.read_text(encoding="utf-8", errors="ignore")):
                hits.append(rel)
    return hits


def test_no_file_sent_to_either_docker_build_carries_a_hardcoded_credential():
    """V1-H5C: replaces the historical-password hash check. Any non-placeholder
    user:password@ URL or PGPASSWORD literal in either build context fails."""
    assert _context_files_with_credentials(ROOT, API_RULES) == []
    frontend_hits = _context_files_with_credentials(ROOT / "frontend", FRONTEND_RULES)
    # The only allowed hits: the live-test guard's own negative fixtures, which
    # assert that credential-bearing URLs are REJECTED. Any other file -- or a
    # new fixture file -- fails here and needs review.
    assert [h for h in frontend_hits if not re.search(r"\.test\.tsx?$", h)] == []
    assert [h for h in frontend_hits if re.search(r"\.test\.tsx?$", h)] == ["src/test/live-guard.test.ts"]


def test_build_context_credential_scan_catches_a_planted_synthetic_credential(tmp_path):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "settings.py").write_text(
        f'DATABASE_URL = "postgresql://app:{SYNTHETIC_PASSWORD}@db/inventory"\n', encoding="utf-8")
    assert _context_files_with_credentials(tmp_path, API_RULES) == ["app/settings.py"]


# --------------------------------------------------------------------------- #
# Alembic online target: DATABASE_URL only, fail closed, never echoed
# --------------------------------------------------------------------------- #
SECRET = "s3cr%t-pw"


@pytest.mark.parametrize("raw,env,message", [
    (None, "development", "DATABASE_URL is required"),
    ("   ", "development", "DATABASE_URL is required"),
    ("not a url", "development", "not a valid database URL"),
    (f"sqlite:///inventory.db", "development", "require PostgreSQL"),
    ("postgresql://offline-sql-only.invalid/no_database", "development", "placeholder"),
    (f"postgresql+psycopg2://u:{SECRET}@db:5432/", "development", "placeholder"),
    (f"postgresql+psycopg2://u:{SECRET}@db:5432/inventory_test_db", "production", "is a test database"),
    (f"postgresql+psycopg2://u:{SECRET}@db:5432/inventory_production", "development", "looks like production"),
    (f"postgresql+psycopg2://u:{SECRET}@db:5432/inventory_prod", "test", "looks like production"),
    (f"postgresql+psycopg2://u:{SECRET}@db:5432/inventory_prod", "", "looks like production"),
])
def test_migration_target_fails_closed_without_echoing_the_url(raw, env, message):
    with pytest.raises(RuntimeError, match=message) as refused:
        migration_target(raw, env)
    assert SECRET not in str(refused.value) and "u:" not in str(refused.value)


@pytest.mark.parametrize("raw,env", [
    ("postgresql+psycopg2://inventory_demo:x@db:5432/inventory_demo", "production"),
    ("postgresql+psycopg2://app:x@db:5432/inventory_db", "production"),
    ("postgresql+psycopg2://app:x@localhost:5432/inventory_db", "development"),
    ("postgresql+psycopg2://app:x@localhost:5432/inventory_db", "test"),
    ("postgresql+psycopg2://ci:x@localhost:5432/inventory_test_db", "test"),
])
def test_existing_deployment_targets_are_accepted(raw, env):
    assert migration_target(raw, env).database


def test_target_description_has_no_password():
    url = migration_target(f"postgresql+psycopg2://inventory_demo:{SECRET}@db:5432/inventory_demo", "production")
    text = describe_migration_target(url)
    assert text == "database 'inventory_demo' on db:5432 as 'inventory_demo'" and SECRET not in text


def test_env_py_uses_only_the_validated_target():
    env_py = (ROOT / "alembic" / "env.py").read_text(encoding="utf-8")
    online = env_py.split("def run_migrations_online", 1)[1].split("def migrate_connection", 1)[0]
    assert "migration_target(settings.database_url, environment)" in online
    assert "set_main_option" not in online  # the URL never enters the ini parser
    assert "config.get_section" not in online  # alembic.ini is never the connection source
    assert "hide_parameters=True" in online


def test_offline_sql_renders_from_the_stock_ini_without_any_connection():
    buffer = io.StringIO()
    config = Config(str(ROOT / "alembic.ini"), output_buffer=buffer)
    config.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(config, "eb1a00000001:ec1a00000001", sql=True)
    assert "ALTER TABLE stock_transactions ALTER COLUMN remark TYPE TEXT" in buffer.getvalue()
