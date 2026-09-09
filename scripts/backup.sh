#!/usr/bin/env bash
#
# PostgreSQL backup for the inventory system.
#
# - Custom-format dump (pg_dump -Fc), compressed.
# - Timestamped, unique filename.
# - Credentials come from the environment / a secret file. No literal password
#   is ever written here or printed.
# - Optional AES-256 encryption when BACKUP_KEY (or BACKUP_KEY_FILE) is set.
#   If BACKUP_REQUIRE_ENCRYPTION=1 and no key is configured, the script fails
#   instead of silently producing an unencrypted "production" backup.
# - Restrictive file permissions (0600).
#
# Required env:
#   BACKUP_DATABASE_URL   postgresql://user:pass@host:5432/dbname
#     (or PGHOST/PGPORT/PGUSER/PGDATABASE + PGPASSWORD / ~/.pgpass)
# Optional env:
#   BACKUP_DIR                  default: ./backups
#   BACKUP_KEY / BACKUP_KEY_FILE   gpg symmetric passphrase (enables encryption)
#   BACKUP_REQUIRE_ENCRYPTION   "1" to refuse an unencrypted backup
#   BACKUP_DRY_RUN              "1" to print the plan and exit
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="inventory_${STAMP}.dump"
DEST="${BACKUP_DIR}/${BASENAME}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

resolve_key() {
  if [ -n "${BACKUP_KEY_FILE:-}" ] && [ -r "${BACKUP_KEY_FILE}" ]; then
    cat "${BACKUP_KEY_FILE}"
  elif [ -n "${BACKUP_KEY:-}" ]; then
    printf '%s' "${BACKUP_KEY}"
  fi
}

ENC_KEY="$(resolve_key || true)"
ENCRYPT=0
if [ -n "${ENC_KEY}" ]; then
  ENCRYPT=1
  DEST="${DEST}.gpg"
elif [ "${BACKUP_REQUIRE_ENCRYPTION:-0}" = "1" ]; then
  log "ERROR: BACKUP_REQUIRE_ENCRYPTION=1 but no BACKUP_KEY / BACKUP_KEY_FILE configured. Refusing to write an unencrypted backup."
  exit 3
fi

if [ -z "${BACKUP_DATABASE_URL:-}" ] && [ -z "${PGDATABASE:-}" ]; then
  log "ERROR: set BACKUP_DATABASE_URL (or PGHOST/PGDATABASE/... with PGPASSWORD/.pgpass)."
  exit 2
fi

DUMP_TARGET=()
[ -n "${BACKUP_DATABASE_URL:-}" ] && DUMP_TARGET=(--dbname "${BACKUP_DATABASE_URL}")

if [ "${BACKUP_DRY_RUN:-0}" = "1" ]; then
  # Never echo the connection string (it carries the password).
  TARGET_DESC="<from BACKUP_DATABASE_URL>"
  [ -z "${BACKUP_DATABASE_URL:-}" ] && TARGET_DESC="<from PG* env / .pgpass>"
  log "DRY RUN"
  log "  pg_dump -Fc -Z6 --no-owner --no-privileges --dbname ${TARGET_DESC} -> ${DEST}$( [ "${ENCRYPT}" = "1" ] && echo ' (gpg AES-256)' )"
  log "  chmod 600 ${DEST}"
  log "  credentials: from environment / secret file only (no literal password in this script)"
  exit 0
fi

mkdir -p "${BACKUP_DIR}"
umask 077

if [ "${ENCRYPT}" = "1" ]; then
  pg_dump -Fc -Z6 --no-owner --no-privileges "${DUMP_TARGET[@]}" \
    | gpg --batch --yes --symmetric --cipher-algo AES256 \
          --passphrase-fd 3 -o "${DEST}" 3<<<"${ENC_KEY}"
else
  pg_dump -Fc -Z6 --no-owner --no-privileges "${DUMP_TARGET[@]}" -f "${DEST}"
fi

chmod 600 "${DEST}"
SIZE="$(wc -c < "${DEST}" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "${DEST}" | awk '{print $1}')"
  printf '%s  %s\n' "${SHA}" "${BASENAME}" >> "${BACKUP_DIR}/SHA256SUMS"
fi

log "OK  ${DEST}  bytes=${SIZE}${SHA:+  sha256=${SHA}}"
log "Next: copy ${DEST} off-box (rclone/scp to a second host or object store) and run scripts/restore.sh against a scratch DB to validate it."
