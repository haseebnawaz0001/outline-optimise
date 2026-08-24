#!/usr/bin/env bash
# Hard-cap ladder: app = 1 CPU + 500MB RAM (no swap). Stores keep their existing limits.
# Usage: ladder-mem.sh <imageTag> <prefix>
set -u
IMG="$1"; PREFIX="$2"
BASE="http://127.0.0.1:3100"
LEVELS=(8 16 32 48 64 96 128)

docker rm -f bench-outline >/dev/null 2>&1
docker run -d --name bench-outline --network bench_default -p 127.0.0.1:3100:3000 \
  --cpus=1 --memory=500m --memory-swap=500m \
  -e URL=http://localhost:3100 -e PGSSLMODE=disable -e RATE_LIMITER_ENABLED=false -e FORCE_HTTPS=false \
  -e SECRET_KEY=6c1e7f4a9b2d3e8f0a1b2c3d4e5f60718a9b0c1d2e3f405162738495a6b7c8d9 \
  -e UTILS_SECRET=0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0 \
  -e DATABASE_URL=postgres://user:pass@postgres:5432/outline -e REDIS_URL=redis://redis:6379 \
  -e FILE_STORAGE=local -e FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data \
  "$IMG" >/dev/null

T0=$(date +%s.%N)
for i in $(seq 1 240); do CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true); [ "$CODE" = "200" ] && break; sleep 0.5; done
T1=$(date +%s.%N)
echo "{\"tag\":\"$IMG\",\"bootS\":$(echo "$T1 - $T0" | bc)}" > ${PREFIX}-boot.json
echo "BOOT=$CODE in $(cat ${PREFIX}-boot.json)"

( while docker inspect bench-outline >/dev/null 2>&1; do
    APP=$(docker stats --no-stream --format "{{.CPUPerc}} {{.MemUsage}}" bench-outline 2>/dev/null | head -1)
    echo "$(date +%s),$APP" >> "${PREFIX}-memstats.csv"
    sleep 2
done ) &
SAMPLER=$!
trap "kill $SAMPLER 2>/dev/null" EXIT

JSON="${PREFIX}-results.json"; echo "{" > "$JSON"; FIRST=1

snapshot() { # returns compact state string
  local ST=$(docker inspect bench-outline --format '{{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} exit={{.State.ExitCode}}' 2>/dev/null || echo "gone")
  echo "$ST"
}

run_level() { # name path conc secs
  local NAME="$1" PATHP="$2" CONC="$3" SECS="$4"
  node .bench/load.mjs "$BASE" "$PATHP" "$CONC" "$SECS" "/tmp/${PREFIX}-${NAME}.json" >/dev/null 2>&1
  local R=$(cat "/tmp/${PREFIX}-${NAME}.json")
  local HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || echo dead)
  local STATE=$(snapshot)
  local LOGLAST=$(docker logs bench-outline 2>&1 | tail -c 400 | tr '\n' ' ' | tr -d '\r' | tail -c 200)
  [ $FIRST -eq 0 ] && echo "," >> "$JSON"
  FIRST=0
  echo "\"${NAME}\": {\"result\": $R, \"health_after\": \"$HEALTH\", \"state\": \"${STATE//\"/}\"}" >> "$JSON"
  echo "== $NAME conc=$CONC done: health=$HEALTH state=$STATE"
}

for C in "${LEVELS[@]}"; do
  run_level "home_c$C" "/" "$C" 45
  H=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true)
  if [ "$H" != "200" ]; then
    echo "APP UNHEALTHY ($H) after c$C — capturing post-mortem and stopping"
    docker logs bench-outline 2>&1 | tail -30 > "${PREFIX}-death.log" || true
    break
  fi
  sleep 12
done

if curl -s -o /dev/null -w "%{http_code}" $BASE/_health | grep -q 200; then
  for C in 160 224 288; do
    run_level "push_c$C" "/" "$C" 40
    H=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true)
    [ "$H" = "200" ] || { docker logs bench-outline 2>&1 | tail -30 > "${PREFIX}-death.log" || true; break; }
    sleep 15
  done
fi
echo "}" >> "$JSON"
cp ${PREFIX}-boot.json .bench/ 2>/dev/null
echo "LADDER-MEM DONE $PREFIX"
