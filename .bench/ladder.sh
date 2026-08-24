#!/usr/bin/env bash
# Escalating load ladder under constrained resources.
# Usage: ladder.sh <imageTag> <outPrefix>
set -u
IMG="$1"; PREFIX="$2"
BASE="http://127.0.0.1:3100"
LEVELS=(8 16 32 48 64 96 128)

docker rm -f bench-outline >/dev/null 2>&1
docker run -d --name bench-outline --network bench_default -p 127.0.0.1:3100:3000 \
  --cpus=1 \
  -e URL=http://localhost:3100 -e PGSSLMODE=disable -e RATE_LIMITER_ENABLED=false -e FORCE_HTTPS=false \
  -e SECRET_KEY=6c1e7f4a9b2d3e8f0a1b2c3d4e5f60718a9b0c1d2e3f405162738495a6b7c8d9 \
  -e UTILS_SECRET=0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0 \
  -e DATABASE_URL=postgres://user:pass@postgres:5432/outline \
  -e REDIS_URL=redis://redis:6379 \
  -e FILE_STORAGE=local -e FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data \
  "$IMG" >/dev/null

T0=$(date +%s.%N)
for i in $(seq 1 240); do CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true); [ "$CODE" = "200" ] && break; sleep 0.5; done
T1=$(date +%s.%N)
BOOT=$(echo "$T1 - $T0" | bc)
echo "{\"tag\":\"$IMG\",\"bootS\":$BOOT}" > ${PREFIX}-boot.json
echo "BOOT=$CODE in ${BOOT}s"

# stats sampler: app cpu+rss, store rss, every 2s
( while docker inspect bench-outline >/dev/null 2>&1; do
    APP=$(docker stats --no-stream --format "{{.CPUPerc}} {{.MemUsage}}" bench-outline 2>/dev/null | head -1)
    PG=$(docker stats --no-stream --format "{{.MemUsage}}" bench-postgres-1 2>/dev/null | head -1)
    RD=$(docker stats --no-stream --format "{{.MemUsage}}" bench-redis-1 2>/dev/null | head -1)
    echo "$(date +%s),$APP,$PG,$RD" >> "${PREFIX}-stats.csv"
    sleep 2
done ) &
SAMPLER=$!
trap "kill $SAMPLER 2>/dev/null" EXIT
echo "epoch,app_cpu app_mem,pg_mem,redis_mem" > "${PREFIX}-stats.csv"

JSON="${PREFIX}-results.json"; echo "{" > "$JSON"; FIRST=1

run_level() { # name path conc secs
  local NAME="$1" PATHP="$2" CONC="$3" SECS="$4"
  node .bench/load.mjs "$BASE" "$PATHP" "$CONC" "$SECS" "/tmp/${PREFIX}-${NAME}.json" >/dev/null 2>&1
  local R=$(cat "/tmp/${PREFIX}-${NAME}.json")
  local HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || echo dead)
  local RESTARTS=$(docker inspect bench-outline --format '{{.RestartCount}} {{.State.OOMKilled}}' 2>/dev/null || echo "gone")
  local PGE=$(docker logs bench-postgres-1 2>&1 | grep -ciE "FATAL|out of memory|too many clients" || true)
  local RDR=$(docker exec bench-redis-1 redis-cli INFO stats 2>/dev/null | grep -E "rejected_connections|maxmemory" | tr '\n' ' ' || echo "?")
  [ $FIRST -eq 0 ] && echo "," >> "$JSON"
  FIRST=0
  echo "\"${NAME}\": {\"result\": $R, \"health_after\": \"$HEALTH\", \"app_restarts_oom\": \"$RESTARTS\", \"pg_err_lines\": $PGE, \"redis\": \"${RDR//\"/}\" }" >> "$JSON"
  echo "== $NAME conc=$CONC recorded"
}

for C in "${LEVELS[@]}"; do
  run_level "home_c$C" "/" "$C" 45
  H=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true)
  if [ "$H" != "200" ] && [ "$H" != "301" ]; then echo "APP UNHEALTHY ($H) after c$C — stopping ladder"; break; fi
  sleep 12
done

# DB-bound probe: hammer health (SELECT 1 per hit)
run_level "pgprobe_c64" "/_health" 64 30
echo "}" >> "$JSON"
cp "/tmp/${PREFIX}-boot.json" .bench/ 2>/dev/null
echo "LADDER DONE $PREFIX"
