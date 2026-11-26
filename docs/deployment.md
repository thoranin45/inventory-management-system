# Deployment (V1)

Single host, Docker Compose, published through **Tailscale Funnel**. No
Kubernetes, no inbound database or API ports.

```
 browser (anywhere)
        │  HTTPS  https://<host>.<tailnet>.ts.net
        ▼
 Tailscale Funnel        (host process; terminates TLS at the edge)
        │  http://127.0.0.1:8090
        ▼
 nginx  (compose: 127.0.0.1:8090 → :80)   nginx/prod.conf, loopback-only
        │  http://frontend:3000
        ▼
 Next.js 16 + BFF        (HttpOnly Secure wc_session cookie)
        │  http://api:8081        (private compose network)
        ▼
 FastAPI / uvicorn --proxy-headers        (no host port, no auto-migrate)
        │
        ▼
 PostgreSQL 18           (named volume, no host port)
```

Files: `compose.prod.yml`, `nginx/prod.conf`, `.env.production.example`,
`.env.production.app.example`, `Dockerfile` (API), `frontend/Dockerfile`,
`scripts/create_first_admin.py`, `scripts/app_db_role.py`.

The stack is **isolated by name**: project `inventory-prod`, containers
`inventory-prod-*`, network `inventory-prod`, volumes `inventory-prod-*`. It
cannot adopt or replace the dev stack (`compose.yml`, project
`inventory-system`, container `inventory-postgres`) or the demo stack
(`compose.demo.yml`). Always pass `-f compose.prod.yml`, and never pass
`--remove-orphans` with another compose file.

The demo stack (`docs/demo-deployment.md`) uses the same topology on
`127.0.0.1:8080`. Both can run at once, but one Funnel can serve only one of
them on port 443.

## TLS termination

Funnel terminates TLS at the Tailscale edge and gives a valid certificate for
`<host>.<tailnet>.ts.net`. nginx and everything behind it speak plain HTTP on
the private network. The real-client-IP handling is the same as the demo's
(see "Security posture" in `docs/demo-deployment.md`): nginx trusts only the
Docker bridge hop, writes the vetted address to `X-Real-IP`, and the BFF
forwards only that to FastAPI.

A custom domain later: point Funnel at the same `127.0.0.1:8090`, or put a TLS
proxy (certbot) in front of nginx as described at the end of
`docs/demo-deployment.md`. Either way set `CORS_ORIGINS` to the new origin.

## Configuration

`.env.production` (git-ignored, `chmod 600` / readable only by your user):

- `ENV=production` — turns on the config safety gate.
- `SECRET_KEY` — random, ≥ 32 chars, not a placeholder. The app **refuses to
  start** otherwise.
- `CORS_ORIGINS=https://<host>.<tailnet>.ts.net` — explicit `https://`
  origin. No `*`. (The browser only talks to the Next BFF, same-origin, but the
  gate still requires one real origin.)
- `DATABASE_URL`, `DB_*`, `POSTGRES_*` — host `db`, never `localhost`. These
  are the **migrator** credentials. The postgres image makes `POSTGRES_USER`
  a superuser that owns the schema; only `db` and the one-shot `migrate`
  service use it.

`.env.production.app` (git-ignored, `chmod 600`, template
`.env.production.app.example`) holds the API's **runtime** credentials:
`DB_USER`, `DB_PASSWORD`, `DATABASE_URL` for the role `inventory_app`. The
`api` service loads it after `.env.production`, so these values win there.
That role can read and write rows but is not a superuser, owns nothing, cannot
change the schema and cannot write `alembic_version` (P10 finding F2).
`scripts/app_db_role.py provision` creates it; `check` proves it.
- `DOCS_ENABLED=1` only if you want `/docs` (it is not reachable from the
  Internet anyway: nginx never proxies FastAPI).
- Optional: `LOG_LEVEL`, `MAX_UPLOAD_BYTES`, `ACCESS_TOKEN_EXPIRE_MINUTES`,
  DB pool knobs (`DB_POOL_SIZE`, …). Leave `TRUSTED_PROXY_COUNT` at `0`.

## Images

Both images must be **pinned**:

```
API_IMAGE=ghcr.io/<owner>/inventory-management-system:vX.Y.Z            # or :<git-sha>
FRONTEND_IMAGE=ghcr.io/<owner>/inventory-management-system-frontend:vX.Y.Z
```

`compose.prod.yml` fails fast if either is unset and never uses `:latest`.

Pushing a `vX.Y.Z` git tag runs the **Publish images** job in
`.github/workflows/tests.yml` after the full test job passes. It pushes both
images with two immutable tags, `:<git-sha>` and `:vX.Y.Z`; those are the
rollback anchors. Nothing is published from branches or pull requests.

New GHCR packages start **private**. Either log in on the host
(`docker login ghcr.io` with a token that has `read:packages`) or make the two
packages public in GitHub → Packages.

To run without GHCR, build the same images locally from the tagged commit:

```bash
docker build -t inventory-api:vX.Y.Z .
docker build -t inventory-frontend:vX.Y.Z frontend/
```

## First deploy (fresh database)

Run from the repository checkout at the release tag, with `API_IMAGE` and
`FRONTEND_IMAGE` set in your shell (or in a git-ignored `.env` next to the
compose file).

1. `cp .env.production.example .env.production`, fill every `CHANGE_ME`.
2. `docker compose -f compose.prod.yml config --quiet` — no output means valid.
3. Start PostgreSQL:
   ```bash
   docker compose -f compose.prod.yml up -d db
   docker compose -f compose.prod.yml ps        # wait for db "healthy"
   ```
4. Migrate (one-shot):
   ```bash
   docker compose -f compose.prod.yml --profile migrate run --rm migrate
   ```
5. Create the API's runtime role (one-shot; idempotent). Generate a password
   (≥ 16 chars), put it in `.env.production.app` (both `DB_PASSWORD` and the
   `DATABASE_URL`), then:
   ```bash
   read -rs APP_DB_PASSWORD && export APP_DB_PASSWORD   # PowerShell: $env:APP_DB_PASSWORD = Read-Host
   docker compose -f compose.prod.yml --profile migrate run --rm \
     -e APP_DB_PASSWORD migrate python scripts/app_db_role.py provision
   ```
   Expect `OK  role inventory_app created; ...`. Clear the variable afterwards.
6. Create the first administrator (one-shot; refuses if any user exists):
   ```bash
   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD     # PowerShell: $env:ADMIN_PASSWORD = Read-Host
   docker compose -f compose.prod.yml run --rm --no-deps \
     -e ADMIN_USERNAME=<name> -e ADMIN_PASSWORD api python scripts/create_first_admin.py
   ```
   The password needs at least 12 characters. Clear it afterwards
   (`unset ADMIN_PASSWORD`). Create every other user from the app.
7. Start everything:
   ```bash
   docker compose -f compose.prod.yml up -d
   docker compose -f compose.prod.yml ps        # all "healthy"
   ```
8. Readiness:
   ```bash
   docker compose -f compose.prod.yml exec api \
     python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8081/ready')))"
   ```
   Expect `{'status': 'ready', ...}`. Then prove the API is not the superuser:
   `docker compose -f compose.prod.yml exec api python scripts/app_db_role.py check`
   → `OK  API connects as inventory_app ...`.
9. Local check: open `http://127.0.0.1:8090/login`, log in as the admin, and
   click through the main screens. In dev-tools → Network, every request is
   same-origin (`/api/auth/*`, `/api/bff/*`), never `:8081`.
10. Publish through Funnel:
   ```bash
   tailscale funnel status          # Funnel must be allowed for this node
   tailscale funnel --bg 8090
   ```
   Open `https://<host>.<tailnet>.ts.net/login` from a phone on cellular data
   and log in. To stop serving: `tailscale funnel --https=443 off`.

## Upgrade procedure

The API container **does not run migrations**. Migrations are a separate,
gated step.

1. **Freeze & build** — `git` clean on `main`; tag `vX.Y.Z`; CI's **Publish
   images** job pushes both images. Full test suite + migration suites green.
2. **Backup** — see "Backups" below; verify with `pg_restore --list`; copy the
   dump off-box. Record filename + size + sha256.
3. **Preflight** — run the relevant read-only preflight, if the release has
   one; abort on any finding.
4. **Pause writers**: `docker compose -f compose.prod.yml stop frontend api`.
5. **Migrate (one-shot)** with the NEW `API_IMAGE`:
   ```bash
   docker compose -f compose.prod.yml --profile migrate run --rm migrate
   ```
   Then refresh the runtime role's grants (idempotent; default privileges
   already cover new tables, this also covers anything created another way):
   `docker compose -f compose.prod.yml --profile migrate run --rm -e APP_DB_PASSWORD migrate python scripts/app_db_role.py provision`
6. **Deploy** the pinned images:
   ```bash
   docker compose -f compose.prod.yml up -d
   ```
   This recreates `api` and `frontend` with new container IPs. nginx
   re-resolves `frontend` through Docker DNS (`resolve` in `nginx/prod.conf`),
   so it can return 502 for up to ~10 s and then recovers by itself. If
   `http://127.0.0.1:8090/login` still returns 502 after 30 s, run
   `docker compose -f compose.prod.yml restart nginx`.
7. **Readiness** — as in first-deploy step 8; `migration` must equal the
   expected head, and `scripts/app_db_role.py check` prints `OK`.
8. **Smoke test** (read-only, from inside the API container):
   ```bash
   docker compose -f compose.prod.yml exec \
     -e SMOKE_BASE_URL=http://127.0.0.1:8081 -e SMOKE_USERNAME=<admin> -e SMOKE_PASSWORD \
     api python scripts/smoke.py
   ```
9. **Log check** — `docker compose -f compose.prod.yml logs --since 10m api`:
   no `CRITICAL` / `UNHANDLED_EXCEPTION` / `migration_mismatch`.
10. Watch the logs (or `/metrics`) for 30–60 min.

## Backups

PostgreSQL has no host port, so the dump runs inside the `db` container and is
copied out:

```bash
docker compose -f compose.prod.yml exec -T db sh -c \
  'pg_dump -Fc -Z6 --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/inventory.dump'
docker cp inventory-prod-postgres:/tmp/inventory.dump ./inventory_$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose -f compose.prod.yml exec -T db rm /tmp/inventory.dump
```

Keep the dump on an encrypted disk (BitLocker / FileVault) and copy it
off-box. Product images live in the `inventory-prod-uploads` volume; back that
up too (see `docs/runbook-backup-restore.md`). Validate a dump by restoring it
into a scratch database with `scripts/restore.sh`.

Dumps are taken with `--no-privileges`, so a restore brings back no grants.
After restoring into the production database, run
`scripts/app_db_role.py provision` again (as above) before starting the API,
or the API will get `permission denied`.

## Switching an existing deployment to the runtime role

For a stack that was deployed before `.env.production.app` existed (the API
then connected as the superuser):

1. Back up (see "Backups").
2. Create `.env.production.app` from the template with a new password.
3. Provision the role (first-deploy step 5).
4. `docker compose -f compose.prod.yml up -d api` — compose recreates only the
   API with the new credentials. Then readiness, `scripts/app_db_role.py check`,
   and `scripts/smoke.py`.

Rollback: the `api` service always loads `.env.production.app`, so put the
migrator's three values from `.env.production` into it and run `up -d api`
again. The role can stay; unused, it is harmless.

## Rollback decision

See `runbook-incident.md`. Short version:

- App-only regression, no migration this release → redeploy the previous
  `:vX.Y-1` images.
- Migration this release with a safe guarded downgrade and no real data
  written → previous images + `alembic downgrade <prev head>`.
- Otherwise (guarded downgrade refuses, or data integrity in doubt) →
  **restore from the pre-deploy backup**.

## ⚠️ Credential rotation (required before first production deploy)

A database password was committed to git history in the original
`scripts/backup_db.ps1` (since removed). Use a **new** password in
`.env.production` (and in any environment that reused the old one). Git history
is intentionally not rewritten here.
