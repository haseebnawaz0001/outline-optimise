#!/usr/bin/env bash
set -u
IMG="$1"; PREFIX="$2"; BASE="http://127.0.0.1:3100"
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
for i in $(seq 1 240); do CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true); [ "$CODE" = "200" ] && break; sleep 0.5; done
echo "boot_health=$CODE"
( while docker inspect bench-outline >/dev/null 2>&1; do docker stats --no-stream --format "{{.CPUPerc}} {{.MemUsage}}" bench-outline 2>/dev/null >> "${PREFIX}-push-stats.csv"; sleep 2; done ) &
SP=$!; trap "kill $SP 2>/dev/null" EXIT
for C in 160 224 288; do
  node .bench/load.mjs "$BASE" "/" "$C" 40 "/tmp/${PREFIX}-push_c${C}.json" >/dev/null 2>&1
  H=$(curl -s -o /dev/null -w "%{http_code}" $BASE/_health || true)
  echo "after c$C health=$H restarts=$(docker inspect bench-outline --format '{{.RestartCount}} {{.State.OOMKilled}}' 2>/dev/null)"
  sleep 15
done
cp /tmp/${PREFIX}-push_c*.json .bench/ 2>/dev/null
echo PUSH_DONE
