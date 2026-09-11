#!/usr/bin/env bash

# Daily SQLite backups for the production and development gym instances.
# Configure cron to run this script at 02:00; do not run cron installation here.
set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/backup.log"
REMOTE="gdrive-backup:lauyim-backups/"
RETENTION_DAYS=7
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M')"

INSTANCES=(
  "prod|lauyim-api-1"
  "dev|lauyim-dev-api-1"
)

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  return 1
}

overall_status=0

log "===== Backup started (timestamp=${TIMESTAMP}) ====="

# Remove stale local backup artifacts older than the retention period.
if find /tmp -maxdepth 1 -type f \( \
  -name 'prod_*.db' -o -name 'prod_*.db.gz' -o \
  -name 'dev_*.db' -o -name 'dev_*.db.gz' \
  \) -mtime +"$RETENTION_DAYS" -delete; then
  log "Local retention cleanup completed (older than ${RETENTION_DAYS} days)."
else
  fail "Local retention cleanup failed."
  overall_status=1
fi

for entry in "${INSTANCES[@]}"; do
  instance="${entry%%|*}"
  container="${entry#*|}"
  db_file="/tmp/${instance}_${TIMESTAMP}.db"
  gz_file="${db_file}.gz"

  log "Starting instance=${instance}, container=${container}."

  # Avoid VACUUM INTO failing because a previous interrupted run left its
  # fixed temporary file behind. This does not stop/restart the container.
  if docker exec "$container" rm -f /tmp/backup_tmp.db; then
    log "${instance}: stale container temp file cleared."
  else
    fail "${instance}: could not clear container temp file; skipping instance."
    overall_status=1
    continue
  fi

  if docker exec "$container" node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/data/gym.db'); db.exec(\"VACUUM INTO '/tmp/backup_tmp.db'\"); db.close();"; then
    log "${instance}: consistent SQLite dump created."
  else
    fail "${instance}: docker exec/VACUUM INTO failed; skipping instance."
    overall_status=1
    continue
  fi

  if docker cp "$container:/tmp/backup_tmp.db" "$db_file"; then
    log "${instance}: dump copied to ${db_file}."
  else
    fail "${instance}: docker cp failed; skipping compression/upload."
    overall_status=1
    # Best-effort cleanup of the container temp file after a failed copy.
    if docker exec "$container" rm -f /tmp/backup_tmp.db; then
      log "${instance}: container temp file removed after failed copy."
    else
      fail "${instance}: could not remove container temp file after failed copy."
    fi
    continue
  fi

  if docker exec "$container" rm -f /tmp/backup_tmp.db; then
    log "${instance}: container temp file removed."
  else
    fail "${instance}: could not remove container temp file."
    overall_status=1
  fi

  if gzip -f "$db_file"; then
    log "${instance}: compressed to ${gz_file}."
  else
    fail "${instance}: gzip failed; local dump retained at ${db_file}."
    overall_status=1
    continue
  fi

  if rclone copy "$gz_file" "$REMOTE"; then
    log "${instance}: upload succeeded to ${REMOTE}."
    if rm -f "$gz_file"; then
      log "${instance}: local compressed backup removed after successful upload."
    else
      fail "${instance}: uploaded successfully but local cleanup failed; file retained at ${gz_file}."
      overall_status=1
    fi
  else
    fail "${instance}: rclone copy failed; local backup retained at ${gz_file}."
    overall_status=1
  fi
done

# Remote retention is intentionally performed after all instance uploads.
if rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d"; then
  log "Remote retention cleanup completed (older than ${RETENTION_DAYS} days)."
else
  fail "Remote retention cleanup failed."
  overall_status=1
fi

log "===== Backup finished (status=${overall_status}) ====="
exit "$overall_status"

# Cron (add manually with `crontab -e`):
# 0 2 * * * /home/lauyyii/hub/scripts/backup.sh >> /home/lauyyii/hub/scripts/backup.log 2>&1
