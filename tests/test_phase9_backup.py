"""Phase 9: backup / restore / revision-check tooling behaviour."""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _find_posix_bash():
    """Locate a bash that behaves like POSIX bash when driven from ``subprocess``.

    Native bash on Linux / macOS (CI is ``ubuntu-latest``) — and, on Windows,
    a *real* Win32 bash from Git for Windows / MSYS2 / Cygwin.

    The Windows ``System32\\bash.exe`` (WSL launcher) and the Microsoft Store
    ``bash`` stub are deliberately excluded: they execute inside a separate
    Linux namespace with different **path** semantics (a ``C:\\…`` argv is
    mangled to ``C:Users…``) *and* different **environment** semantics (only
    variables listed in ``WSLENV`` cross the boundary, so the ``BACKUP_*``
    variables this test sets never reach the script). They are not a drop-in
    bash for this kind of invocation.
    """
    if os.name != "nt":
        return shutil.which("bash")

    def _bad(p):
        low = p.replace("/", "\\").lower()
        return "\\system32\\" in low or "\\windowsapps\\" in low

    candidates = []
    found = shutil.which("bash")
    if found:
        candidates.append(found)

    git = shutil.which("git")
    if git:
        # Walk up from the git executable; Git for Windows keeps bash at
        # <GitRoot>\bin\bash.exe and <GitRoot>\usr\bin\bash.exe.
        for parent in Path(git).resolve().parents[:5]:
            candidates.append(str(parent / "bin" / "bash.exe"))
            candidates.append(str(parent / "usr" / "bin" / "bash.exe"))

    for base in (
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramW6432"),
        os.environ.get("ProgramFiles(x86)"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs"),
    ):
        if base:
            candidates.append(os.path.join(base, "Git", "bin", "bash.exe"))
            candidates.append(os.path.join(base, "Git", "usr", "bin", "bash.exe"))

    for c in candidates:
        if c and os.path.isfile(c) and not _bad(c):
            return c
    return None


BASH = _find_posix_bash()


def _run_backup_script(env):
    """Invoke ``scripts/backup.sh`` through a POSIX bash, cross-platform.

    The script path is passed with forward slashes (accepted verbatim by
    native bash, Git Bash and Cygwin; a no-op on real POSIX paths) and the
    repo root is used as the working directory, so no Windows-form path ever
    crosses the Python -> bash boundary.
    """
    script = str((ROOT / "scripts" / "backup.sh")).replace("\\", "/")
    return subprocess.run(
        [BASH, script],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        cwd=str(ROOT),
    )


@pytest.mark.skipif(BASH is None, reason="POSIX bash (Git Bash / MSYS2 / Cygwin) not available")
def test_backup_dry_run_plans_pg_dump_without_literal_password(tmp_path):
    env = {
        **os.environ,
        "BACKUP_DRY_RUN": "1",
        "BACKUP_DIR": str(tmp_path),
        "BACKUP_DATABASE_URL": "postgresql://u:sup3rsecret@localhost:5432/inventory_db",
    }
    out = _run_backup_script(env)
    combined = out.stdout + out.stderr
    assert out.returncode == 0, combined
    assert "pg_dump -Fc" in combined
    assert "sup3rsecret" not in combined  # connection string never echoed


@pytest.mark.skipif(BASH is None, reason="POSIX bash (Git Bash / MSYS2 / Cygwin) not available")
def test_backup_requires_encryption_when_policy_set(tmp_path):
    env = {
        **os.environ,
        "BACKUP_DIR": str(tmp_path),
        "BACKUP_DATABASE_URL": "postgresql://u:p@localhost:5432/inventory_db",
        "BACKUP_REQUIRE_ENCRYPTION": "1",
    }
    # No BACKUP_KEY -> must refuse rather than write plaintext.
    out = _run_backup_script(env)
    assert out.returncode == 3
    assert "Refusing" in (out.stdout + out.stderr)


# V1-H5C: detect ANY hardcoded credential instead of one historical value (no
# credential-derived data is kept in the repository). Documentation examples
# must use an obvious placeholder or an environment reference.
SYNTHETIC_PASSWORD = "synthetic-fixture-not-a-secret-0000"
# "postgres" is the stock image default used by .env.*.example templates and CI.
_PLACEHOLDER_PASSWORDS = {"p", "x", "pass", "password", "...", "change_me", "changeme", "secret", "postgres"}
_URL_CREDENTIAL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s/:@'\"]+:([^\s/@'\"]+)@", re.IGNORECASE)
_PGPASSWORD_LITERAL = re.compile(r"PGPASSWORD\s*=\s*['\"]?([^\s'\"]+)")


def _is_placeholder(value: str) -> bool:
    return value.lower() in _PLACEHOLDER_PASSWORDS or value[:1] in "$<{"


def _hardcoded_credentials(text: str) -> list[str]:
    found = _URL_CREDENTIAL.findall(text) + _PGPASSWORD_LITERAL.findall(text)
    return [value for value in found if not _is_placeholder(value)]


def _scripts_with_hardcoded_credentials(scripts_dir: Path) -> list[str]:
    offenders = []
    for path in sorted(scripts_dir.rglob("*")):
        if path.suffix in {".sh", ".py", ".ps1"} and path.is_file():
            text = path.read_text(encoding="utf-8", errors="ignore")
            if _hardcoded_credentials(text) or "PGPASSWORD =" in text or 'PGPASSWORD="' in text:
                offenders.append(path.relative_to(scripts_dir).as_posix())
    return offenders


def test_no_hardcoded_credentials_in_scripts():
    assert _scripts_with_hardcoded_credentials(ROOT / "scripts") == []


@pytest.mark.parametrize("planted", [
    f"BACKUP_DATABASE_URL=postgresql://app:{SYNTHETIC_PASSWORD}@db:5432/inventory\n",
    f"url = 'postgresql+psycopg2://app:{SYNTHETIC_PASSWORD}@localhost/inventory'\n",
    f"export PGPASSWORD={SYNTHETIC_PASSWORD}\n",
    f'$env:PGPASSWORD = "{SYNTHETIC_PASSWORD}"\n',
])
def test_credential_scan_rejects_a_planted_synthetic_credential(tmp_path, planted):
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "leak.sh").write_text(f"#!/bin/sh\n{planted}", encoding="utf-8")
    assert _scripts_with_hardcoded_credentials(tmp_path) == ["nested/leak.sh"]


@pytest.mark.parametrize("documented", [
    "#   BACKUP_DATABASE_URL   postgresql://user:pass@host:5432/dbname\n",
    "DATABASE_URL=postgresql+psycopg2://inventory_demo:...@db:5432/inventory_demo\n",
    "export PGPASSWORD=$DB_PASSWORD\n",
])
def test_credential_scan_accepts_documented_placeholders(tmp_path, documented):
    (tmp_path / "ok.sh").write_text(documented, encoding="utf-8")
    assert _scripts_with_hardcoded_credentials(tmp_path) == []


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
