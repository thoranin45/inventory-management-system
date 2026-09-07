# Runbook — incident response & rollback

## Triage signals

| Signal | Where | Likely meaning |
|---|---|---|
| `GET /ready` → 503 `db_unreachable` | probe / uptime monitor | DB down, network partition, pool exhausted |
| `GET /ready` → 503 `migration_mismatch` | probe | app deployed without its migration, or DB ahead of code |
| `UNHANDLED_EXCEPTION` in logs | JSON logs (stdout) | a bug reached the generic 500 handler; grab the `request_id` |
| 5xx rate climbing | `/metrics` `http_requests_total{status_class="5xx"}` | regression or dependency failure |
| `db_pool_checked_out` ≈ `db_pool_size` + overflow, sustained | `/metrics` | slow queries / connection leak |
| login 429s from many IPs | logs | brute-force in progress (rate limiter is holding) |

Every error response and log line shares a `request_id` (also the
`X-Request-ID` response header). Start every investigation from it.

## Rollback decision tree

```
Is the regression caused by code only (no migration in this release)?
├─ YES → redeploy the previous pinned image:
│        API_IMAGE=…:vX.Y-1 docker compose -f compose.prod.yml up -d api
│        Verify /ready, smoke test. Done.
└─ NO (this release included a migration)
   │
   ├─ Does the migration's downgrade() run cleanly AND no real data has been
   │  written against the new schema?
   │   ├─ YES → previous image + one-shot:
   │   │        docker compose -f compose.prod.yml --profile migrate run --rm \
   │   │          migrate alembic downgrade <previous-head>
   │   │        then deploy previous image, verify /ready + smoke.
   │   └─ NO  → the guarded downgrade will refuse (by design). Go to restore.
   │
   └─ RESTORE FROM BACKUP (integrity in doubt, or downgrade refused)
      1. Stop api. Keep db.
      2. Restore the pre-deploy encrypted dump into a fresh DB and validate
         (scripts/restore.sh). See runbook-backup-restore.md.
      3. Repoint DATABASE_URL, start the previous image.
      4. /ready must be "ready"; run scripts/smoke.py.
      5. Communicate the data-loss window (time between backup and incident).
```

### When a downgrade is unsafe

Phase 4/5/6 downgrades **refuse** once real fulfilment / receipt / transfer
history exists. Phase 9's `users.is_active` downgrade **refuses** if any
account has been disabled. If a guarded downgrade raises, do not force it —
restore from backup instead.

## DB unreachable

1. `docker compose -f compose.prod.yml ps` — is `db` healthy?
2. `docker compose -f compose.prod.yml logs --tail=200 db`.
3. Disk full? `df -h` on the volume host. PG won't start / accept writes.
4. Once DB is back, `pool_pre_ping=True` lets the API recover without a
   restart; confirm with `/ready`.

## Pool exhaustion

- Identify the slow statements (JSON logs: `SLOW_REQUEST`; PG:
  `pg_stat_activity` `state='active'` ordered by `query_start`).
- Short term: `docker compose -f compose.prod.yml restart api` clears leaked
  connections.
- The engine already sets `statement_timeout=15s`, `lock_timeout=10s`,
  `idle_in_transaction_session_timeout=30s` — a wedged query self-aborts.

## Suspected credential compromise

- Disable the affected user: `UPDATE users SET is_active = FALSE WHERE id = …;`
  Their existing JWTs stop working on the next request (authorization reloads
  the DB user).
- Rotate `SECRET_KEY` to invalidate **all** tokens at once (forces every user
  to re-login). Redeploy.
- Rotate `DB_PASSWORD` if the DB credential may be exposed.
