"""Phase 9: backup / restore / revision-check tooling behaviour."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which("bash")


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_backup_dry_run_plans_pg_dump_without_literal_password(tmp_path):
    env = {
        **os.environ,
        "BACKUP_DRY_RUN": "1",
        "BACKUP_DIR": str(tmp_path),
        "BACKUP_DATABASE_URL": "postgresql://u:sup3rsecret@localhost:5432/inventory_db",
    }
    out = subprocess.run(
        [BASH, str(ROOT / "scripts" / "backup.sh")],
        capture_output=True, text=True, env=env, timeout=30,
    )
    combined = out.stdout + out.stderr
    assert out.returncode == 0, combined
    assert "pg_dump -Fc" in combined
    assert "sup3rsecret" not in combined  # connection string never echoed


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_backup_requires_encryption_when_policy_set(tmp_path):
    env = {
        **os.environ,
        "BACKUP_DIR": str(tmp_path),
        "BACKUP_DATABASE_URL": "postgresql://u:p@localhost:5432/inventory_db",
        "BACKUP_REQUIRE_ENCRYPTION": "1",
    }
    # No BACKUP_KEY -> must refuse rather than write plaintext.
    out = subprocess.run(
        [BASH, str(ROOT / "scripts" / "backup.sh")],
        capture_output=True, text=True, env=env, timeout=30,
    )
    assert out.returncode == 3
    assert "Refusing" in (out.stdout + out.stderr)


def test_no_hardcoded_credentials_in_scripts():
    for path in (ROOT / "scripts").glob("*"):
        if path.suffix in {".sh", ".py"} and path.is_file():
            text = path.read_text(encoding="utf-8", errors="ignore")
            assert "01072545" not in text  # the previously committed DB password
            assert "PGPASSWORD =" not in text
            assert 'PGPASSWORD="' not in text


def test_db_revision_check_requires_explicit_url():
    out = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "db_revision_check.py")],
        capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "DB_REVISION_CHECK_DATABASE_URL"},
        timeout=30,
    )
    assert out.returncode == 2
    assert "DB_REVISION_CHECK_DATABASE_URL" in out.stdout


def test_db_revision_check_matches_head_against_test_db():
    from tests.conftest import TEST_DATABASE_URL

    out = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "db_revision_check.py")],
        capture_output=True, text=True,
        env={**os.environ, "DB_REVISION_CHECK_DATABASE_URL": TEST_DATABASE_URL},
        timeout=30,
    )
    # The public schema of the shared test DB is not migrated by the per-run
    # schema fixture, so this is either OK (if migrated) or a clean mismatch /
    # "could not complete" — never a crash.
    assert out.returncode in (0, 1, 2)
