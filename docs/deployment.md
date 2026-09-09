# Deployment (V1)

Single VM, Docker Compose. No Kubernetes.

```
Internet ──HTTPS──▶ nginx (TLS termination, HSTS, gzip, X-Forwarded-*)
                      │  proxy_pass http://api:8081
                      ▼
                 FastAPI / uvicorn  (--proxy-headers, non-root, no auto-migrate)
                      │
                      ▼
                 PostgreSQL 18  (named volume, no published host port)
                 + backup cron  (pg_dump -Fc | gpg | off-box copy)
```

## TLS termination

TLS terminates at nginx (or an upstream load balancer). nginx must forward
`X-Forwarded-For` and `X-Forwarded-Proto` (the bundled `nginx/default.conf`
already does). The image starts uvicorn with
`--proxy-headers --forwarded-allow-ips "*"` so `request.client.host` is the
real client and the request scheme is correct behind TLS. Add a `listen 443
ssl; http2 on;` server block plus `Strict-Transport-Security` and an
`80 → 443` redirect when provisioning certificates (certbot / platform LB).

## Configuration

`.env.production` (git-ignored, `chmod 600`, owned by the deploy user):

- `ENV=production` — turns on the config safety gate.
- `SECRET_KEY` — random, ≥ 32 chars, not a placeholder. The app **refuses to
  start** otherwise.
- `CORS_ORIGINS` — explicit `https://` frontend origin(s). No `*`.
- `DATABASE_URL`, `DB_*`, `POSTGRES_*`.
- `DOCS_ENABLED=1` only if you want `/docs` public in production (default: off).
- Optional: `LOG_LEVEL`, `TRUSTED_PROXY_COUNT`, `MAX_UPLOAD_BYTES`,
  `ACCESS_TOKEN_EXPIRE_MINUTES`, DB pool knobs (`DB_POOL_SIZE`, …).

Prefer Docker secrets / a secrets manager for `SECRET_KEY`, `DB_PASSWORD` and
`BACKUP_KEY`.

## Image

`API_IMAGE` must be a **pinned** tag:

```
API_IMAGE=ghcr.io/<owner>/inventory-management-system:v1.0.0   # or :<git-sha>
```

`compose.prod.yml` fails fast if `API_IMAGE` is unset and never uses `:latest`.
CI publishes an immutable `:<sha>` for every push and a `:vX.Y.Z` for every
`v*` git tag — those are your rollback anchors.

## Deploy procedure

The API container **does not run migrations**. Migrations are a separate,
gated step.

1. **Freeze & build**
   - `git` clean; tag `vX.Y.Z`; CI builds & pushes `…:vX.Y.Z` + `…:<sha>`.
   - Full test suite + migration suites green.
2. **Backup** — `scripts/backup.sh`; verify with `pg_restore --list`; copy the
   encrypted dump off-box. Record filename + size + sha256. See
   `runbook-backup-restore.md`.
3. **Preflight** — run the relevant read-only preflight against the prod DB
   with its explicit `*_PREFLIGHT_DATABASE_URL`; abort on any finding.
   (Phase 9's migration is additive — no dedicated preflight — but keep the
   habit for future phases.)
4. **Pause writers** (only needed once tables are large): `docker compose -f
   compose.prod.yml stop api`.
5. **Migrate (one-shot)**:
   ```
   docker compose -f compose.prod.yml --profile migrate run --rm migrate
   ```
   Confirm: `DB_REVISION_CHECK_DATABASE_URL=… python scripts/db_revision_check.py`
   prints `OK`.
6. **Deploy** the pinned image:
   ```
   API_IMAGE=ghcr.io/<owner>/inventory-management-system:vX.Y.Z \
     docker compose -f compose.prod.yml up -d
   ```
7. **Readiness** — poll `GET /ready` until `{"status":"ready"}` with
   `migration == expected`.
8. **Smoke test** — `SMOKE_BASE_URL=… SMOKE_USERNAME=… SMOKE_PASSWORD=…
   python scripts/smoke.py` (read-only).
9. **Log check** — no `CRITICAL` / `UNHANDLED_EXCEPTION` / `migration_mismatch`
   in the last few minutes; error rate < 1%.
10. **Resume traffic** — `docker compose -f compose.prod.yml up -d api` /
    re-enable the nginx upstream.
11. Watch `/metrics` (or the JSON logs) for 30–60 min.

## Rollback decision

See `runbook-incident.md`. Short version:

- App-only regression, no migration this release → redeploy the previous
  `:vX.Y-1` image.
- Migration this release with a safe guarded downgrade and no real data
  written → previous image + `alembic downgrade <prev head>`.
- Otherwise (guarded downgrade refuses, or data integrity in doubt) →
  **restore from the pre-deploy backup**.

## ⚠️ Credential rotation (required before first production deploy)

The database password `01072545` was committed to git history in the original
`scripts/backup_db.ps1` (since removed). **Rotate the PostgreSQL password**
(and any environment that reused it) before this system holds real data. Git
history is intentionally not rewritten here.
