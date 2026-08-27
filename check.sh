#!/usr/bin/env bash
# ============================================================
#  Quarc Weather — Health Check
#    bash check.sh
#
#  Verifies containers, the shared auth wiring, SSL, the database,
#  and live upstream reachability to Open-Meteo.
#
#  Run this on the server (Linux). Under Git Bash on Windows, MSYS rewrites
#  container-absolute paths such as /app/data into C:/Program Files/Git/app/data,
#  so the database and endpoint checks report false negatives there.
# ============================================================

HOST="${QUARC_HOST:-quarcnet0.tail84500c.ts.net}"
PORT="${QUARC_PORT:-4002}"
BASE="https://$HOST:$PORT"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [ OK ]  $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL]  $1"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN]  $1"; WARN=$((WARN+1)); }

echo ""
echo "Quarc Weather — health check"
echo "============================"

# --- Containers ---------------------------------------------------------
echo ""
echo "Containers"
for svc in backend frontend; do
  id=$(docker ps -q --filter "label=com.docker.compose.service=$svc" | head -1)
  if [ -n "$id" ]; then
    status=$(docker inspect -f '{{.State.Status}}' "$id")
    if [ "$status" = "running" ]; then ok "$svc is running"; else bad "$svc is $status"; fi
  else
    bad "$svc container not found"
  fi
done

# quarc-auth lives in the Quarc_Notes repo but every app depends on it.
if docker ps --format '{{.Names}}' | grep -q '^quarc-auth$'; then
  ok "quarc-auth is running (shared login)"
else
  bad "quarc-auth not running — logins will fail. Start it from Quarc_Notes/auth."
fi

# --- Shared network -----------------------------------------------------
echo ""
echo "Networking"
if docker network ls --format '{{.Name}}' | grep -q '^quarcnet-shared$'; then
  ok "quarcnet-shared network exists"
else
  bad "quarcnet-shared missing — run: docker network create quarcnet-shared"
fi

FRONTEND=$(docker ps -q --filter "label=com.docker.compose.service=frontend" | head -1)
if [ -n "$FRONTEND" ]; then
  if docker exec "$FRONTEND" sh -c 'getent hosts quarc-auth >/dev/null 2>&1'; then
    ok "frontend can resolve quarc-auth"
  else
    bad "frontend cannot resolve quarc-auth — check the quarcnet-shared network"
  fi
fi

# --- JWT secret consistency --------------------------------------------
echo ""
echo "Shared login"
if [ -f .env ]; then
  MY_SECRET=$(grep -E '^JWT_SECRET=' .env | cut -d= -f2-)
  if [ -z "$MY_SECRET" ] || [ "$MY_SECRET" = "change-this-to-a-long-random-string" ]; then
    bad "JWT_SECRET is unset or still the placeholder"
  else
    ok "JWT_SECRET is set"
    AUTH_SECRET=$(docker exec quarc-auth printenv JWT_SECRET 2>/dev/null)
    if [ -n "$AUTH_SECRET" ]; then
      if [ "$AUTH_SECRET" = "$MY_SECRET" ]; then
        ok "JWT_SECRET matches quarc-auth (sessions will validate)"
      else
        bad "JWT_SECRET differs from quarc-auth — logins will be rejected"
      fi
    else
      warn "couldn't read quarc-auth's JWT_SECRET to compare"
    fi
  fi
else
  bad ".env not found — copy .env.example to .env"
fi

# --- SSL certificate ----------------------------------------------------
# What matters is whether *nginx* can read the cert, not whether the person
# running this script can: /var/lib/tailscale/certs is root-owned, so a
# host-side file test gives a false negative for any non-root user.
# Expiry is read off the live TLS connection rather than the file — that
# needs no filesystem access, and it reports the cert actually being served.
# (nginx:alpine ships no openssl binary, so don't ask the container for it.)
echo ""
echo "TLS"
EXPIRY=$(echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

if [ -n "$FRONTEND" ] && docker exec "$FRONTEND" test -f "/etc/nginx/ssl/$HOST.crt" 2>/dev/null; then
  if [ -n "$EXPIRY" ]; then
    ok "certificate mounted and readable by nginx (expires $EXPIRY)"
  else
    ok "certificate mounted and readable by nginx"
  fi
elif [ -n "$EXPIRY" ]; then
  ok "certificate is being served (expires $EXPIRY)"
elif [ -r "/var/lib/tailscale/certs/$HOST.crt" ]; then
  ok "Tailscale certificate present on host"
else
  warn "could not confirm the certificate — nginx may not be running. If the site serves HTTPS in a browser this is cosmetic; if not, run: sudo tailscale cert $HOST"
fi

# --- Database -----------------------------------------------------------
echo ""
echo "Database"
BACKEND=$(docker ps -q --filter "label=com.docker.compose.service=backend" | head -1)
if [ -n "$BACKEND" ]; then
  if docker exec "$BACKEND" test -f /app/data/weather.db; then
    CITIES=$(docker exec "$BACKEND" node -e "console.log(require('/app/src/db').getDb().prepare('SELECT COUNT(*) c FROM cities').get().c)" 2>/dev/null)
    USERS=$(docker exec "$BACKEND" node -e "console.log(require('/app/src/db').getDb().prepare('SELECT COUNT(DISTINCT user_id) c FROM cities').get().c)" 2>/dev/null)
    ok "weather.db present — $CITIES cities across $USERS users"
  else
    warn "weather.db not created yet (normal before first login)"
  fi
fi

# --- API ----------------------------------------------------------------
echo ""
echo "Endpoints"
health=$(curl -fsS --max-time 10 "$BASE/api/health" 2>/dev/null)
if echo "$health" | grep -q 'quarc-weather-backend'; then
  ok "GET /api/health"
else
  bad "GET /api/health did not respond correctly"
fi

# Unauthenticated calls must be rejected, not served.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/cities" 2>/dev/null)
if [ "$code" = "401" ]; then
  ok "GET /api/cities correctly requires auth (401)"
else
  bad "GET /api/cities returned $code, expected 401"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"username":"__nobody__","password":"__wrong__"}' 2>/dev/null)
if [ "$code" = "401" ]; then
  ok "POST /api/auth/login reaches quarc-auth (401 for bad credentials)"
else
  bad "POST /api/auth/login returned $code, expected 401 — auth proxy may be misrouted"
fi

# --- Upstream -----------------------------------------------------------
echo ""
echo "Upstream (Open-Meteo)"
if [ -n "$BACKEND" ]; then
  if docker exec "$BACKEND" node -e "
    fetch('https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.98&current=temperature_2m&timezone=auto')
      .then(r => r.ok ? process.exit(0) : process.exit(1))
      .catch(() => process.exit(1))
  " 2>/dev/null; then
    ok "backend can reach api.open-meteo.com"
  else
    bad "backend cannot reach api.open-meteo.com — check DNS/egress"
  fi
fi

# --- Summary ------------------------------------------------------------
echo ""
echo "============================"
echo "  $PASS passed, $FAIL failed, $WARN warnings"
echo ""
[ "$FAIL" -eq 0 ] || exit 1
