#!/usr/bin/env bash
# ============================================================
#  Quarc Weather — Data Restore
#  Run on the target server from the Quarc_Weather directory:
#    bash restore.sh ./backup_20240101_120000
# ============================================================
set -e

BACKUP_DIR="$1"

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
  echo "Usage: bash restore.sh <backup-dir>"
  echo "  e.g. bash restore.sh ./backup_20240101_120000"
  exit 1
fi

if [ ! -f "$BACKUP_DIR/weather.db" ] || [ ! -f "$BACKUP_DIR/.env" ]; then
  echo "ERROR: backup directory must contain weather.db and .env"
  exit 1
fi

echo "Restoring from $BACKUP_DIR ..."

echo "  · Restoring .env ..."
cp "$BACKUP_DIR/.env" .env

echo "  · Initializing Docker volume ..."
docker compose up -d backend 2>/dev/null || true
sleep 3
docker compose stop backend

echo "  · Restoring weather.db ..."
# This project's own backend, running or not. (Not `docker ps --filter label=...service=backend`: every Quarc app
# calls its service "backend", so that could pick another app's container and copy this database into it.)
BACKEND=$(docker compose ps -aq backend | head -1)
if [ -z "$BACKEND" ]; then
  echo "ERROR: backend container not found. Run 'docker compose up -d backend' first."
  exit 1
fi
docker cp "$BACKUP_DIR/weather.db" "$BACKEND:/app/data/weather.db"

echo "  · Starting all services ..."
bash deploy.sh

# The devices keep their own copy of the cities and settings, and remember how far they have synced. A backup is
# older than what they hold, so without this they would never send the server what it lost. Renewing the epoch
# tells every device "the server's data was replaced": each one re-sends everything it has (the newest edit of
# every city still wins) the next time it reaches the server. Nothing on the devices is lost or overwritten.
echo "  · Renewing the sync epoch so devices re-send anything newer than this backup ..."
docker compose exec -T backend node src/scripts/new-epoch.js

echo ""
echo "Restore complete. Check status: bash check.sh"
echo "Devices bring the server back up to date by themselves the next time they connect."
