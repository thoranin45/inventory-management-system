# Inventory Management System

Backend inventory management system built with FastAPI.

## Features

- JWT authentication (HS256, `iat`/`exp`, 12h default), role-based access
  (`ADMIN` / `WAREHOUSE`), disable-able accounts (`users.is_active`)
- Product / category / supplier / customer management
- Stock in / out (FIFO / FEFO), batch & expiry tracking, authoritative
  stock balances
- Sales fulfilment (pick / pack / ship, barcode-driven), purchase-order
  receiving (idempotent), warehouse transfers (protected transit)
- Dashboards, work queues, global search, barcode / QR / label generation,
  spreadsheet exports
- Structured JSON logging, request IDs, `/health` + `/ready`, admin-only
  `/metrics`

## Tech stack

Python 3.12 · FastAPI · SQLAlchemy 2 · PostgreSQL 18 · Alembic · Docker Compose

## Documentation

| Doc | What |
|---|---|
| [`docs/api-conventions.md`](docs/api-conventions.md) | auth, error envelope, pagination, quantity/money strings, `Idempotency-Key`, lifecycles, request IDs |
| [`docs/deployment.md`](docs/deployment.md) | V1 deploy architecture & procedure (Compose, pinned image, gated migrations) |
| [`docs/release-checklist.md`](docs/release-checklist.md) | step-by-step release checklist |
| [`docs/runbook-backup-restore.md`](docs/runbook-backup-restore.md) | backup, retention, **validated** restore |
| [`docs/runbook-incident.md`](docs/runbook-incident.md) | triage signals, rollback decision tree |
| [`docs/database-v3.md`](docs/database-v3.md) | schema & migration history |

## Local development

```sh
cp .env.api.example .env.api && cp .env.db.example .env.db
docker compose -f compose.yml up --build
```

Tests need a dedicated PostgreSQL **test** database (name must contain
`test`); put its URL in `.env.test` as `TEST_DATABASE_URL`, then:

```sh
python -m pytest -q
```

## Production

See [`docs/deployment.md`](docs/deployment.md). In short: pinned image via
`API_IMAGE`, `ENV=production` (config safety gate), migrations run as an
explicit one-shot (`--profile migrate`), never on container boot.
