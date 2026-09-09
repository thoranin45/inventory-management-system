# Runbook — backup & restore

> A backup that has never been restored is **not** a validated backup.

## Tooling

| Script | Purpose |
|---|---|
| `scripts/backup.sh` | `pg_dump -Fc` (compressed), timestamped, optional AES-256 (gpg), `chmod 600`, records sha256 |
| `scripts/restore.sh` | restore **into a scratch DB** + validate (archive readable, dbname guard, Alembic revision, consistency diagnostic) |
| `scripts/prune_backups.sh` | retention: 7 daily / 4 weekly / 3 monthly |
| `scripts/db_revision_check.py` | read-only: DB revision vs expected head |

All credentials come from the environment or a secret file. No script contains
a literal password.

## Scheduled backup (host cron)

```cron
# 02:15 UTC daily: dump + prune. Adjust paths / secret files.
15 2 * * *  cd /opt/inventory && \
  BACKUP_DIR=/var/backups/inventory \
  BACKUP_DATABASE_URL="$(cat /run/secrets/backup_db_url)" \
  BACKUP_KEY_FILE=/run/secrets/backup_key \
  BACKUP_REQUIRE_ENCRYPTION=1 \
  ./scripts/backup.sh >> /var/log/inventory-backup.log 2>&1 && \
  BACKUP_DIR=/var/backups/inventory ./scripts/prune_backups.sh >> /var/log/inventory-backup.log 2>&1
```

No Celery / worker — cron is sufficient for V1.

## Off-box copy (required)

After each backup, copy the encrypted `.dump.gpg` to a second location
(different host or an S3-compatible bucket):

```sh
rclone copy /var/backups/inventory/ remote:inventory-backups/ --include 'inventory_*.dump.gpg'
```

## Restore + validation (scheduled monthly game-day, and before any restore-to-prod)

```sh
RESTORE_SOURCE=/var/backups/inventory/inventory_YYYYMMDDTHHMMSSZ.dump.gpg \
RESTORE_DATABASE_URL=postgresql://u:p@localhost:5432/inventory_restore_check \
RESTORE_EXPECTED_DB=inventory_restore_check \
BACKUP_KEY_FILE=/run/secrets/backup_key \
  ./scripts/restore.sh
```

The script fails loudly unless **all** of these hold:

1. `pg_restore --list` succeeds on the archive.
2. Target dbname is not `*prod*` / `inventory_db` and matches `RESTORE_EXPECTED_DB`.
3. Restored `alembic_version` == `EXPECTED_ALEMBIC_HEAD`.
4. `check_inventory_consistency.py` reports no findings.

Record the run (date, source file, sha256, result) in the ops log. If a
monthly game-day restore fails, treat it as a Sev-2 incident.

## Generated files

`uploads/` holds irreplaceable product images — include the volume in the
backup job (`docker run --rm -v inventory-uploads:/data -v /var/backups:/b
alpine tar czf /b/uploads_$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data .`).
`exports/`, `app/static/{labels,barcodes,qrcodes,invoices}` are regenerable and
do not need backing up.

## Restoring to production (last resort)

1. Stop `api`. Keep `db`.
2. Restore the chosen encrypted dump into a **fresh** database, validate as
   above.
3. Point `DATABASE_URL` at the restored database (or rename), start `api`.
4. `/ready` must return `ready`; run `scripts/smoke.py`.
5. Post-mortem: why was a restore needed; what data window was lost.
