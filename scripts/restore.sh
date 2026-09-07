#!/usr/bin/env bash
#
# Restore + VALIDATE a backup produced by scripts/backup.sh.
#
# A backup that has never been restored is not a validated backup. This script
# restores into a caller-provided target and then verifies:
#   1. the archive is readable (pg_restore --list)
#   2. the target database matches RESTORE_EXPECTED_DB (guard against pointing
#      at production by accident)
#   3. the restored Alembic revision matches EXPECTED_ALEMBIC_HEAD (or the
#      value passed in RESTORE_EXPECTED_REVISION)
#   4. the read-only inventory consistency diagnostic is clean
#
# NEVER point RESTORE_DATABASE_URL at a live production database. Use a scratch
# / staging database.
#
# Required env:
#   RESTORE_SOURCE           path to inventory_*.dump[.gpg]
#   RESTORE_DATABASE_URL     scratch DB, e.g. postgresql://u:p@host:5432/restore_check
# Optional env:
#   RESTORE_EXPECTED_DB          refuse if the URL's dbname differs
#   RESTORE_EXPECTED_REVISION    default: read from app/core/db_revision.py
#   BACKUP_KEY / BACKUP_KEY_FILE decrypt a .gpg archive
#   RESTORE_DRY_RUN             "1" to print the plan and exit
#
set -euo pipefail

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

SRC="${RESTORE_SOURCE:?set RESTORE_SOURCE to the .dump/.dump.gpg file}"
URL="${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL to a SCRATCH database}"
[ -r "${SRC}" ] || die "cannot read ${SRC}"

DBNAME="$(printf '%s' "${URL}" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
case "${DBNAME}" in
  *prod*|*production*|inventory_db)
    die "target dbname '${DBNAME}' looks like production; refuse."
    ;;
esac
if [ -n "${RESTORE_EXPECTED_DB:-}" ] && [ "${DBNAME}" != "${RESTORE_EXPECTED_DB}" ]; then
  die "target dbname '${DBNAME}' != RESTORE_EXPECTED_DB '${RESTORE_EXPECTED_DB}'"
fi

EXPECTED_REV="${RESTORE_EXPECTED_REVISION:-$(
  sed -nE 's/^EXPECTED_ALEMBIC_HEAD *= *"([^"]+)".*/\1/p' \
    "$(dirname "$0")/../app/core/db_revision.py"
)}"
[ -n "${EXPECTED_REV}" ] || die "could not determine expected Alembic revision"

resolve_key() {
  if [ -n "${BACKUP_KEY_FILE:-}" ] && [ -r "${BACKUP_KEY_FILE}" ]; then cat "${BACKUP_KEY_FILE}";
  elif [ -n "${BACKUP_KEY:-}" ]; then printf '%s' "${BACKUP_KEY}"; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
ARCHIVE="${SRC}"
if printf '%s' "${SRC}" | grep -q '\.gpg$'; then
  KEY="$(resolve_key || true)"
  [ -n "${KEY}" ] || die "encrypted archive but no BACKUP_KEY / BACKUP_KEY_FILE"
  ARCHIVE="${WORK}/archive.dump"
  gpg --batch --yes --decrypt --passphrase-fd 3 -o "${ARCHIVE}" "${SRC}" 3<<<"${KEY}"
fi

log "step 1/4  archive readable?"
pg_restore --list "${ARCHIVE}" >/dev/null || die "pg_restore --list failed"

if [ "${RESTORE_DRY_RUN:-0}" = "1" ]; then
  log "DRY RUN — would restore ${ARCHIVE} into ${DBNAME} then verify revision=${EXPECTED_REV}"
  exit 0
fi

log "step 2/4  restore into scratch db '${DBNAME}'"
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "${URL}" "${ARCHIVE}"

log "step 3/4  Alembic revision check (expect ${EXPECTED_REV})"
ACTUAL_REV="$(psql "${URL}" -tAc 'SELECT version_num FROM alembic_version' | tr -d '[:space:]')"
[ "${ACTUAL_REV}" = "${EXPECTED_REV}" ] || die "restored revision '${ACTUAL_REV}' != expected '${EXPECTED_REV}'"

log "step 4/4  inventory consistency diagnostic (read-only)"
INVENTORY_DIAGNOSTIC_DATABASE_URL="${URL}" \
  python "$(dirname "$0")/check_inventory_consistency.py" || die "diagnostic reported findings"

log "RESTORE VALIDATED  source=${SRC}  db=${DBNAME}  revision=${ACTUAL_REV}"
