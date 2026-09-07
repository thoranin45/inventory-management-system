#!/usr/bin/env bash
#
# Retention for scripts/backup.sh output.
#
# Baseline: keep 7 daily, 4 weekly (Mondays), 3 monthly (1st of month).
# Anything older that is not covered by one of those buckets is deleted.
#
# Env:
#   BACKUP_DIR         default: ./backups
#   KEEP_DAILY         default: 7
#   KEEP_WEEKLY        default: 4
#   KEEP_MONTHLY       default: 3
#   PRUNE_DRY_RUN      "1" to list what would be removed and exit
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-3}"
DRY="${PRUNE_DRY_RUN:-0}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
[ -d "${BACKUP_DIR}" ] || { log "no backup dir ${BACKUP_DIR}"; exit 0; }

# Filenames look like inventory_20260907T031500Z.dump[.gpg]
mapfile -t FILES < <(ls -1 "${BACKUP_DIR}"/inventory_*.dump* 2>/dev/null | sort -r || true)
[ "${#FILES[@]}" -gt 0 ] || { log "nothing to prune"; exit 0; }

declare -A KEEP
daily=0 ; declare -A weekly_seen monthly_seen

for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  ts="$(printf '%s' "$base" | sed -nE 's/^inventory_([0-9]{8}T[0-9]{6}Z)\.dump.*/\1/p')"
  [ -n "$ts" ] || continue
  day="${ts:0:8}"
  # portable-ish: derive weekday / month bucket from the date
  iso="${ts:0:4}-${ts:4:2}-${ts:6:2}"
  wk="$(date -u -d "$iso" +%G-%V 2>/dev/null || date -u -j -f %Y-%m-%d "$iso" +%G-%V 2>/dev/null || echo "$day")"
  mo="${ts:0:6}"

  if [ "$daily" -lt "$KEEP_DAILY" ]; then KEEP["$f"]=1; daily=$((daily+1)); continue; fi
  if [ -z "${weekly_seen[$wk]:-}" ] && [ "${#weekly_seen[@]}" -lt "$KEEP_WEEKLY" ]; then
    weekly_seen[$wk]=1; KEEP["$f"]=1; continue
  fi
  if [ -z "${monthly_seen[$mo]:-}" ] && [ "${#monthly_seen[@]}" -lt "$KEEP_MONTHLY" ]; then
    monthly_seen[$mo]=1; KEEP["$f"]=1; continue
  fi
done

removed=0
for f in "${FILES[@]}"; do
  [ -n "${KEEP[$f]:-}" ] && continue
  if [ "$DRY" = "1" ]; then log "would remove $(basename "$f")";
  else rm -f -- "$f"; log "removed $(basename "$f")"; fi
  removed=$((removed+1))
done
log "kept=${#KEEP[@]} removed=${removed} (dry_run=${DRY})"
