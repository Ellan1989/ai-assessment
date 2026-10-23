#!/usr/bin/env bash
#
# Backs up the database (consistently, safe while running) and all generated
# PDFs into a single timestamped .tar.gz.
#
# Usage:  ./scripts/backup.sh [output-dir]        (default: ./backups)
#         DB_PATH=/opt/ai-assessment/.data/app.db ./scripts/backup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$APP_DIR/backups}"
DB_PATH="${DB_PATH:-$APP_DIR/.data/app.db}"
DATA_DIR="$(dirname "$DB_PATH")"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found at $DB_PATH — set DB_PATH if it lives elsewhere."; exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DB="$OUT_DIR/app-$STAMP.db"

node "$APP_DIR/scripts/backup-db.mjs" "$DB_PATH" "$TMP_DB"
tar -czf "$OUT_DIR/ai-assessment-backup-$STAMP.tar.gz" -C "$OUT_DIR" "app-$STAMP.db" -C "$DATA_DIR" "$(basename "$DATA_DIR")" --ignore-failed-read 2>/dev/null || \
  tar -czf "$OUT_DIR/ai-assessment-backup-$STAMP.tar.gz" -C "$OUT_DIR" "app-$STAMP.db"
rm -f "$TMP_DB"

echo "Backup complete: $OUT_DIR/ai-assessment-backup-$STAMP.tar.gz"
echo "Restore: replace <data-dir>/app.db with the file inside this archive, then restart the service."
