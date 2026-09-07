# Release checklist

## Pre-flight (CI / local)

- [ ] `git status` clean; on `main`; release commit tagged `vX.Y.Z`.
- [ ] `python -m pytest -q` — full suite green.
- [ ] Migration suites green:
      `pytest -q tests/test_migrations.py tests/test_phase5_migrations.py tests/test_phase6_migrations.py tests/test_phase8_migrations.py tests/test_phase9_migration.py`
- [ ] `python -m compileall app tests scripts`.
- [ ] `python -c "from app.main import app"` OK.
- [ ] `pip-audit` reviewed. Known/accepted: `passlib==1.7.4` unmaintained
      (migrate off in V1.5); transitive `ecdsa` advisories do not affect
      HS256. No new unreviewed critical findings.
- [ ] `docker build` OK; image pushed as `…:vX.Y.Z` **and** `…:<sha>`
      (never `:latest` alone).
- [ ] `docker compose -f compose.yml config` and
      `API_IMAGE=… docker compose -f compose.prod.yml config` both valid.
- [ ] `compose.prod.yml`: `api` service has no `alembic upgrade`; image is
      `${API_IMAGE}`; Postgres has no published port.
- [ ] `.env.production` present on host, `chmod 600`, `ENV=production`,
      strong `SECRET_KEY` (≥32, not placeholder), `CORS_ORIGINS` = real
      `https://` origins.

## Deploy window

- [ ] **Backup**: `scripts/backup.sh` → `pg_restore --list` OK → encrypt →
      copy off-box. Record filename + size + sha256.
- [ ] **Preflight**: relevant `scripts/check_phaseN_preflight.py` with its
      explicit `*_PREFLIGHT_DATABASE_URL` → zero findings.
- [ ] Announce maintenance; stop `api` if tables are large.
- [ ] **Migrate (one-shot)**:
      `docker compose -f compose.prod.yml --profile migrate run --rm migrate`.
- [ ] `python scripts/db_revision_check.py` → `OK` (expected head).
- [ ] **Deploy**: `API_IMAGE=…:vX.Y.Z docker compose -f compose.prod.yml up -d`.
- [ ] **Readiness**: `GET /ready` → `{"status":"ready", migration == expected}`.
- [ ] **Smoke**: `python scripts/smoke.py` — all checks pass. No inventory
      mutated.
- [ ] **Logs**: no `CRITICAL` / `UNHANDLED_EXCEPTION` / `migration_mismatch`
      in the last few minutes; HTTP 5xx rate < 1%.
- [ ] Resume traffic.

## Post-deploy

- [ ] Watch `/metrics` (or JSON logs) 30–60 min: request rate, 5xx count,
      p95 latency, DB pool `checked_out` vs size.
- [ ] **Rollback decision point** — see `runbook-incident.md`.
- [ ] Update the ops log: version, migration revision, backup id, anomalies.

## First production deploy only

- [ ] **Rotate the PostgreSQL password** — the old value was committed to git
      history (`scripts/backup_db.ps1`, since removed).
