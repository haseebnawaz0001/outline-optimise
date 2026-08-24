#!/usr/bin/env node
// Stress/measurement harness for Outline benchmarking. Zero deps (Node >= 18).
// Usage:
//   node stress.mjs latency <baseURL> <seconds> <concurrency> <outJson>
//   node stress.mjs idle <containerName> <redisContainer> <windowSec> <outJson>
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [, , cmd, ...args] = process.argv;

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

async function latency(baseURL, seconds, concurrency, out) {
  const results = {};
  for (const path of ["/_health", "/"]) {
    const latencies = [];
    let errors = 0;
    let count = 0;
    const deadline = Date.now() + seconds * 1000;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (Date.now() < deadline) {
          const t0 = performance.now();
          try {
            const res = await fetch(`${baseURL}${path}`, {
              redirect: "manual",
              signal: AbortSignal.timeout(10_000),
            });
            await res.arrayBuffer();
            if (res.status >= 500) errors++;
          } catch {
            errors++;
          }
          latencies.push(performance.now() - t0);
          count++;
        }
      })
    );
    results[path] = {
      count,
      errors,
      rps: +(count / seconds).toFixed(1),
      p50ms: +pct(latencies, 50)?.toFixed(1),
      p95ms: +pct(latencies, 95)?.toFixed(1),
    };
    console.error(`${path}: ${JSON.stringify(results[path])}`);
  }
  writeFileSync(out, JSON.stringify({ latency: results }, null, 2));
  console.log(JSON.stringify({ latency: results }));
}

function redisCalls(container) {
  const out = execSync(
    `docker exec ${container} redis-cli INFO commandstats`,
    { encoding: "utf8" }
  );
  let sum = 0;
  for (const m of out.matchAll(/calls=(\d+)/g)) sum += +m[1];
  return sum;
}

function rssMB(container) {
  try {
    const out = execSync(
      `docker stats --no-stream --format "{{.MemUsage}}" ${container}`,
      { encoding: "utf8" }
    );
    const v = out.trim().split("/")[0].trim();
    const num = parseFloat(v);
    if (v.includes("GiB")) return +(num * 1024).toFixed(1);
    return num;
  } catch {
    return null;
  }
}

async function idle(container, redisContainer, windowSec, out) {
  const samples = [];
  const redisBefore = redisCalls(redisContainer);
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < windowSec) {
    const r = rssMB(container);
    if (r !== null) samples.push(r);
    await new Promise((r) => setTimeout(r, 5000));
  }
  const redisAfter = redisCalls(redisContainer);
  const json = {
    idle: {
      windowSec,
      rssSamples: samples.length,
      rssAvgMB: samples.length
        ? +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1)
        : null,
      rssMaxMB: samples.length ? Math.max(...samples) : null,
      redisOpsPerMin: +(((redisAfter - redisBefore) / windowSec) * 60).toFixed(1),
    },
  };
  writeFileSync(out, JSON.stringify(json, null, 2));
  console.log(JSON.stringify(json));
}

if (cmd === "latency") latency(args[0], +args[1], +args[2], args[3]);
else if (cmd === "idle") idle(args[0], args[1], +args[2], args[3]);
else {
  console.error("unknown subcommand");
  process.exit(2);
}
