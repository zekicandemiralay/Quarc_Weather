#!/usr/bin/env bash
# ============================================================
#  Quarc Weather — Data Backup
#  Run from the project directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    weather.db  — saved cities and per-user preferences
#    .env        — all secrets and config
#
#  Note: no forecast data is backed up. Devices fetch it from the weather
#  provider themselves — only the city lists and settings live here. Every
#  device also keeps its own copy of those, so after a restore they repair
#  anything newer than the backup by themselves (see restore.sh).
# ============================================================
set -e

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR ..."

# This project's own backend. (Not `docker ps --filter label=...service=backend`: every Quarc app calls its service
# "backend", so that finds whichever app's container was built last — possibly another app's.)
BACKEND=$(docker compose ps -q backend | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not running. Start it first: docker compose up -d backend"
  exit 1
fi

# weather.db runs in WAL mode — recent writes can sit in weather.db-wal, which
# this script doesn't copy. Checkpoint it into the main file first so the
# backup is complete and doesn't depend on -wal/-shm files.
echo "  · Checkpointing WAL into weather.db ..."
docker exec "$BACKEND" node -e "require('/app/src/db').getDb().pragma('wal_checkpoint(TRUNCATE)')" 2>/dev/null || true

echo "  · Exporting weather.db ..."
docker cp "$BACKEND:/app/data/weather.db" "$BACKUP_DIR/weather.db"

echo "  · Copying .env ..."
cp .env "$BACKUP_DIR/.env"

DB_SIZE=$(du -sh "$BACKUP_DIR/weather.db" | awk '{print $1}')
# Saved (not deleted) cities. The fallback covers a server that has not been updated to the synced schema yet.
CITY_COUNT=$(docker exec "$BACKEND" node -e "const d=require('/app/src/db').getDb();let n;try{n=d.prepare('SELECT COUNT(*) c FROM cities WHERE is_deleted = 0').get().c}catch(e){n=d.prepare('SELECT COUNT(*) c FROM cities').get().c};console.log(n)" 2>/dev/null || echo "?")

echo ""
echo "Backup complete: $BACKUP_DIR"
echo "  weather.db : $DB_SIZE ($CITY_COUNT saved cities)"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Weather/"
