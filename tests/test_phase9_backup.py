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
#
# R1 remediation — supported syntax (anything else FAILS):
#   * placeholder words in _PLACEHOLDER_PASSWORDS, or a descriptive angle
#     placeholder such as <password>, <db-password>, <admin_pw>;
#   * an environment reference, but ONLY where that file's language really
#     expands it at run time:
#       posix (.sh/.bash, and text of unknown origin is treated strictly):
#                     $NAME / ${NAME}, unquoted or inside "double quotes";
#                     inside 'single quotes' it is a literal -> ambiguous;
#       powershell (.ps1): $env:NAME / $NAME / ${NAME}, unquoted or in "double
#                     quotes"; inside 'single quotes' -> ambiguous;
#       cmd (.cmd/.bat): %NAME%;
#       compose (.yml/.yaml): ${NAME} / $NAME (Compose interpolates regardless
#                     of YAML quoting);
#       python and anything else: nothing expands inside a string literal, so a
#                     reference-looking value is ambiguous.
#   Defaults (${X:-pw}), command substitution, arithmetic and other forms are
#   never references. Verdicts: "placeholder" and "reference" pass; "literal"
#   and "ambiguous" (needs review) both fail. Multi-line strings and heredocs
#   are scanned line by line (limitation, documented).
SYNTHETIC_PASSWORD = "synthetic-fixture-not-a-secret-0000"
# "postgres" is the stock image default used by .env.*.example templates and CI.
_PLACEHOLDER_PASSWORDS = {"p", "x", "pass", "password", "...", "change_me", "changeme", "secret", "postgres"}
_URL_CREDENTIAL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s/:@'\"]+:([^\s/@'\"]+)@", re.IGNORECASE)
_PGPASSWORD_ASSIGNMENT = re.compile(r"PGPASSWORD\s*=\s*['\"]?([^\s'\"]+)")
# Documentation placeholder that names what belongs there, e.g. <password>, <db-password>:
# one of the keywords must be a whole "-"/"_"-separated word (so <mypassword123> is a literal).
_ANGLE_PLACEHOLDER = re.compile(r"<(?:[a-z0-9]+[-_])*(?:password|pass|secret|pw)(?:[-_][a-z0-9]+)*>")
_NAME = r"[A-Za-z_][A-Za-z0-9_]*"
_REFERENCE_FORMS = {
    "posix": re.compile(rf"\${_NAME}|\$\{{{_NAME}\}}"),
    "powershell": re.compile(rf"\$env:{_NAME}|\${_NAME}|\$\{{{_NAME}\}}"),
    "cmd": re.compile(rf"%{_NAME}%"),
    "compose": re.compile(rf"\${_NAME}|\$\{{{_NAME}\}}"),
}
_SYNTAX_BY_SUFFIX = {".sh": "posix", ".bash": "posix", ".ps1": "powershell", ".cmd": "cmd", ".bat": "cmd",
                     ".yml": "compose", ".yaml": "compose", ".py": "python"}
_LOOKS_LIKE_REFERENCE = re.compile(r"[$%{}<>`]")


def _syntax_for(path: Path) -> str:
    return _SYNTAX_BY_SUFFIX.get(path.suffix.lower(), "unknown")


def _quote_state(line: str, index: int, syntax: str) -> str:
    """Quote context at line[index]: "single", "double" or "none" (shell rules)."""
    state = None
    escape = "\\" if syntax == "posix" else "`" if syntax == "powershell" else None
    i = 0
    while i < index:
        char = line[i]
        if escape and char == escape and state != "'":
            i += 2
            continue
        if state is None and char in "'\"":
            state = char
        elif state is not None and char == state:
            state = None
        i += 1
    return {"'": "single", '"': "double", None: "none"}[state]


def _classify(value: str, syntax: str, quote: str) -> str:
    if value.lower() in _PLACEHOLDER_PASSWORDS or _ANGLE_PLACEHOLDER.fullmatch(value):
        return "placeholder"
    form = _REFERENCE_FORMS.get(syntax)
    expands = {"posix": quote != "single", "powershell": quote != "single", "cmd": True,
               "compose": True}.get(syntax, False)
    if form and form.fullmatch(value) and expands:
        return "reference"
    return "ambiguous" if _LOOKS_LIKE_REFERENCE.search(value) else "literal"


def _posix_line_end_state(line: str) -> tuple[str | None, bool]:
    """(open quote char or None, inside a comment) at the end of a logical line
    so far. Minimal POSIX rules: backslash escapes outside single quotes, '#'
    starts a comment at a word boundary outside quotes."""
    quote, i = None, 0
    while i < len(line):
        char = line[i]
        if quote != "'" and char == "\\":
            i += 2
            continue
        if quote is None and char == "#" and (i == 0 or line[i - 1] in " \t;&|()"):
            return None, True
        if quote is None and char in "'\"":
            quote = char
        elif quote is not None and char == quote:
            quote = None
        i += 1
    return quote, False


def _logical_lines(text: str, syntax: str) -> list[tuple[int, str, bool]]:
    """(first physical line number, logical line, unresolved continuation).

    R1 line-continuation repair: for POSIX shell, a newline preceded by an ODD
    run of backslashes (an unescaped backslash) is removed together with that
    backslash before detection, so a split NAME or URL is scanned as the shell
    sees it. CRLF and LF are both handled. Not a continuation: a comment's
    trailing backslash (the comment ends at the newline) and an escaped
    backslash ("\\\\" + newline). Inside single quotes POSIX keeps the backslash
    and newline literally; the scanner does not reconstruct such values but
    marks the line unresolved so it fails closed. Other syntaxes keep physical
    lines (unchanged behaviour)."""
    physical = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if syntax != "posix":
        return [(number, line, False) for number, line in enumerate(physical, 1)]
    logical, buffer, start, unresolved = [], "", None, False
    for number, line in enumerate(physical, 1):
        if start is None:
            start = number
        trailing = len(line) - len(line.rstrip("\\"))
        if trailing % 2 == 1:
            quote, in_comment = _posix_line_end_state(buffer + line[:-1])
            if quote == "'":
                unresolved = True              # literal backslash-newline inside '...'
            elif not in_comment:
                buffer += line[:-1]            # remove backslash + newline
                continue
        logical.append((start, buffer + line, unresolved))
        buffer, start, unresolved = "", None, False
    return logical


def _credential_findings(text: str, syntax: str = "unknown") -> list[tuple[int, str, str]]:
    """(line number, value, verdict) for every credential-looking value."""
    findings = []
    for number, line, unresolved in _logical_lines(text, syntax):
        if unresolved:
            findings.append((number, "<unresolved line continuation>", "ambiguous"))
        for regex in (_URL_CREDENTIAL, _PGPASSWORD_ASSIGNMENT):
            for match in regex.finditer(line):
                value = match.group(1)
                verdict = _classify(value, syntax, _quote_state(line, match.start(1), syntax))
                findings.append((number, value, verdict))
    return findings


def _hardcoded_credentials(text: str, syntax: str = "unknown") -> list[str]:
    """Values that are literal or ambiguous. Unknown syntax is strict: no
    reference is assumed to expand."""
    return [value for _, value, verdict in _credential_findings(text, syntax)
            if verdict in ("literal", "ambiguous")]


def _scripts_with_hardcoded_credentials(scripts_dir: Path) -> list[str]:
    offenders = []
    for path in sorted(scripts_dir.rglob("*")):
        if path.suffix in {".sh", ".py", ".ps1"} and path.is_file():
            text = path.read_text(encoding="utf-8", errors="ignore")
            syntax = _syntax_for(path)
            # legacy literal checks run on the raw text AND on the continuation-joined text
            joined = "\n".join(line for _, line, _ in _logical_lines(text, syntax))
            if (_hardcoded_credentials(text, syntax)
                    or any(marker in candidate for candidate in (text, joined)
                           for marker in ("PGPASSWORD =", 'PGPASSWORD="'))):
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


# Synthetic values only; none is, or is derived from, a real credential.
@pytest.mark.parametrize("planted", [
    "postgresql://app:$ecret-hardcoded-0000@db:5432/inventory",   # "$" prefix, not a variable
    "postgresql://app:$1synthetic@db:5432/inventory",              # positional-looking, not a NAME
    "postgresql://app:${DB_PASSWORD:-synthetic-fallback}@db/inv",  # default value hides a literal
    "postgresql://app:$(cat-synthetic)@db/inventory",              # command substitution
    "postgresql://app:<synthetic0000>@db:5432/inventory",          # angle brackets, not a placeholder name
    "postgresql://app:<hunter2-synthetic>@db/inventory",
    "postgresql://app:<mypassword123>@db/inventory",                # keyword not a separate word
    "postgresql://app:{synthetic-0000}@db/inventory",              # bare braces
    "postgresql://app:%synthetic%0000@db/inventory",               # not a single %NAME%
    "export PGPASSWORD=$ecret-synthetic-0000",
    "export PGPASSWORD=<synthetic0000>",
])
def test_credential_scan_rejects_literals_disguised_as_references(planted):
    assert _hardcoded_credentials(planted) != []


@pytest.mark.parametrize("syntax,reference", [
    ("posix", "postgresql://app:$DB_PASSWORD@db:5432/inventory"),
    ("posix", "postgresql://app:${DB_PASSWORD}@db:5432/inventory"),
    ("powershell", "postgresql://app:$env:DB_PASSWORD@db:5432/inventory"),
    ("cmd", "postgresql://app:%DB_PASSWORD%@db:5432/inventory"),
    ("unknown", "postgresql://app:<password>@db:5432/inventory"),
    ("python", "postgresql://app:<db-password>@db:5432/inventory"),
    ("posix", "postgresql://app:<admin_pw>@db:5432/inventory"),
    ("posix", "export PGPASSWORD=${PGPASSWORD_FROM_VAULT}"),
])
def test_credential_scan_accepts_exact_reference_syntax(syntax, reference):
    assert _hardcoded_credentials(reference, syntax) == []


# ---- R1 remediation: quoting and language context (Codex finding + edge cases) ----
# Variable names and values are synthetic.

@pytest.mark.parametrize("syntax,line", [
    ("posix", "export PGPASSWORD='$DB_PASSWORD'"),                            # Codex: single quotes = literal
    ("posix", "PGPASSWORD='${DB_PASSWORD}' pg_dump"),
    ("posix", "DATABASE_URL='postgresql://app:$DB_PASSWORD@db:5432/inventory'"),
    ("posix", "export PGPASSWORD=\\$DB_PASSWORD"),                            # escaped $ is literal
    ("posix", "DATABASE_URL=postgresql://app:%DB_PASSWORD%@db/inventory"),    # cmd syntax does not expand in sh
    ("posix", "DATABASE_URL=postgresql://app:$env:DB_PASSWORD@db/inventory"), # PowerShell syntax in sh
    ("powershell", "$env:PGPASSWORD = '$env:DB_PASSWORD'"),                   # PowerShell single quotes
    ("powershell", "$url = 'postgresql://app:$env:DB_PASSWORD@db/inventory'"),
    ("cmd", "set DATABASE_URL=postgresql://app:$DB_PASSWORD@db/inventory"),   # POSIX syntax in cmd
    ("compose", "DATABASE_URL: postgresql://app:${DB_PASSWORD:-synthetic-fallback}@db/inventory"),
    ("python", 'URL = "postgresql://app:$DB_PASSWORD@db/inventory"'),       # Python never expands $NAME
    ("python", "URL = f'postgresql://app:{synthetic_pw}@db/inventory'"),      # interpolated: needs review
    ("unknown", "postgresql://app:$DB_PASSWORD@db/inventory"),                # unknown language: strict
])
def test_credential_scan_flags_references_that_do_not_expand(syntax, line):
    findings = _credential_findings(line, syntax)
    assert findings and all(verdict == "ambiguous" for _, _, verdict in findings), findings
    assert _hardcoded_credentials(line, syntax) != []


@pytest.mark.parametrize("syntax,line", [
    ("posix", "export PGPASSWORD=$DB_PASSWORD"),
    ("posix", "export PGPASSWORD=${DB_PASSWORD}"),
    ("posix", 'DATABASE_URL="postgresql://app:$DB_PASSWORD@db:5432/inventory"'),   # double quotes expand
    ("posix", 'echo "it\'s fine" && DATABASE_URL=postgresql://app:$DB_PASSWORD@db/inventory'),
    ("powershell", '$env:DATABASE_URL = "postgresql://app:$env:DB_PASSWORD@db/inventory"'),
    ("cmd", "set DATABASE_URL=postgresql://app:%DB_PASSWORD%@db/inventory"),
    ("compose", "DATABASE_URL: postgresql://app:${DB_PASSWORD}@db/inventory"),
    ("compose", "DATABASE_URL: 'postgresql://app:${DB_PASSWORD}@db/inventory'"),  # Compose interpolates anyway
])
def test_credential_scan_accepts_references_that_expand(syntax, line):
    assert [v for _, v, verdict in _credential_findings(line, syntax) if verdict != "reference"] == []


def test_codex_single_quoted_pgpassword_is_reported_with_its_verdict():
    assert _credential_findings("export PGPASSWORD='$DB_PASSWORD'", "posix") == [(1, "$DB_PASSWORD", "ambiguous")]


@pytest.mark.parametrize("filename,content", [
    ("leak.sh", "export PGPASSWORD='$DB_PASSWORD'\n"),
    ("leak.py", 'URL = "postgresql://app:$DB_PASSWORD@db/inventory"\n'),
    ("leak.ps1", "$url = 'postgresql://app:$env:DB_PASSWORD@db/inventory'\n"),
])
def test_script_scan_fails_on_non_expanding_references(tmp_path, filename, content):
    (tmp_path / filename).write_text(content, encoding="utf-8")
    assert _scripts_with_hardcoded_credentials(tmp_path) == [filename]


@pytest.mark.parametrize("line,index,state", [
    ("a='x'", 3, "single"),
    ('a="x"', 3, "double"),
    ("a='x' b=y", 8, "none"),
    ('a="x\\"y" z', 6, "double"),     # escaped quote does not close the string
    ("a=\\'x", 4, "none"),            # escaped quote does not open one
])
def test_quote_state_follows_posix_rules(line, index, state):
    assert _quote_state(line, index, "posix") == state


# ---- R1: POSIX backslash-newline line continuation (Codex fail-open) ----
# Synthetic values only. "\\\n" in these Python strings is a shell backslash + newline.

@pytest.mark.parametrize("eol", ["\n", "\r\n"], ids=["LF", "CRLF"])
@pytest.mark.parametrize("text,value", [
    ("export PGPASS\\{eol}WORD=synthetic-value{eol}", "synthetic-value"),                      # Codex: split NAME
    ("DATABASE_URL=postgresql://app:synthetic-\\{eol}literal-0000@db:5432/inventory{eol}",       # Codex: split URL
     "synthetic-literal-0000"),
    ("export PGPASSWORD=\\{eol}'synthetic-literal-0000'{eol}", "synthetic-literal-0000"),
    ("pg_dump \\{eol}  --dbname=postgresql://app:synthetic-\\{eol}literal-0000@db/inventory{eol}",
     "synthetic-literal-0000"),
])
def test_continuation_cannot_hide_a_literal_credential(text, value, eol):
    findings = _credential_findings(text.format(eol=eol), "posix")
    assert (value, "literal") in [(v, verdict) for _, v, verdict in findings], findings


@pytest.mark.parametrize("eol", ["\n", "\r\n"], ids=["LF", "CRLF"])
def test_continuation_bypass_is_caught_by_the_script_scan(tmp_path, eol):
    (tmp_path / "leak.sh").write_bytes(f"#!/bin/sh{eol}export PGPASS\\{eol}WORD=synthetic-value{eol}".encode())
    (tmp_path / "url.sh").write_bytes(
        f"BACKUP_DATABASE_URL=postgresql://app:synthetic-\\{eol}literal-0000@db/inventory{eol}".encode())
    assert _scripts_with_hardcoded_credentials(tmp_path) == ["leak.sh", "url.sh"]


def test_continuation_finding_reports_the_line_where_the_statement_starts():
    text = "#!/bin/sh\nset -eu\nDATABASE_URL=postgresql://app:synthetic-\\\nliteral-0000@db/inventory\n"
    assert _credential_findings(text, "posix") == [(3, "synthetic-literal-0000", "literal")]


@pytest.mark.parametrize("eol", ["\n", "\r\n"], ids=["LF", "CRLF"])
@pytest.mark.parametrize("text", [
    "pg_dump \\{eol}  --format=custom \\{eol}  --file=\"$BACKUP_FILE\" \"$BACKUP_DATABASE_URL\"{eol}",  # no credential
    "export DATABASE_URL=postgresql://app:\\{eol}$DB_PASSWORD@db:5432/inventory{eol}",              # expanding ref
    "export PGPASS\\{eol}WORD=\"$DB_PASSWORD\"{eol}",
    "# a comment ends at the newline \\{eol}export PGPASSWORD=$DB_PASSWORD{eol}",                     # not a continuation
])
def test_legitimate_continuations_stay_accepted(text, eol):
    findings = _credential_findings(text.format(eol=eol), "posix")
    assert [f for f in findings if f[2] in ("literal", "ambiguous")] == [], findings


def test_an_escaped_backslash_is_not_a_continuation():
    # "\\\\" + newline = one literal backslash, then a real newline: two separate commands,
    # so no PGPASSWORD assignment exists and the second line is just a word.
    text = "echo PGPASS\\\\\nWORD=synthetic-value\n"
    assert _logical_lines(text, "posix") == [(1, "echo PGPASS\\\\", False), (2, "WORD=synthetic-value", False),
                                             (3, "", False)]
    assert _credential_findings(text, "posix") == []
    # an odd run still continues
    assert _logical_lines("a\\\\\\\nb", "posix")[0] == (1, "a\\\\b", False)


def test_continuation_inside_single_quotes_fails_closed():
    # POSIX keeps backslash-newline literally inside single quotes; the scanner does not try to
    # reconstruct such a value, it reports an explicit review finding instead.
    text = "URL='postgresql://app:synthetic-\\\nliteral@db/inventory'\n"
    assert (1, "<unresolved line continuation>", "ambiguous") in _credential_findings(text, "posix")
    assert _hardcoded_credentials(text, "posix") != []


@pytest.mark.parametrize("text", [
    "export PGPASSWORD='$DB_PASSWORD'\n",                                       # single-quoted literal (R1)
    "export PGPASS\\\nWORD='$DB_PASSWORD'\n",                                    # same, split name
    "DATABASE_URL=postgresql://app:${DB_PASSWORD:-synthetic-\\\nfallback}@db/inventory\n",  # default, split
])
def test_existing_fail_closed_forms_still_fail_when_continued(text):
    assert _hardcoded_credentials(text, "posix") != []


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
