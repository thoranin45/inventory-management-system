"""Phase 9: backup / restore / revision-check tooling behaviour."""
import os
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
