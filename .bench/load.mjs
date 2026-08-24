#!/usr/bin/env node
// Escalating-load breaker probe. Zero deps.
// Usage: node load.mjs <baseURL> <path> <concurrency> <seconds> <outJson>
// Output: rps, p50/p90/p95/p99/max, errors classified (timeout/5xx/other).
import { writeFileSync } from "node:fs";

const [, , baseURL, path, conc, seconds, out] = process.argv;

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
}

const lat = [];
const errors = { timeout: 0, e5xx: 0, other: 0 };
let count = 0;
let statusCounts = {};
const deadline = Date.now() + Number(seconds) * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${baseURL}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      lat.push(ms);
      count++;
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      if (res.status >= 500) errors.e5xx++;
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") errors.timeout++;
      else errors.other++;
    }
  }
}

await Promise.all(Array.from({ length: Number(conc) }, worker));
const secs = Number(seconds);
const result = {
  level: { path, concurrency: Number(conc), seconds: secs },
  count,
  rps: +(count / secs).toFixed(1),
  p50ms: pct(lat, 50),
  p90ms: pct(lat, 90),
  p95ms: pct(lat, 95),
  p99ms: pct(lat, 99),
  maxMs: pct(lat, 100),
  errors,
  statusCounts,
};
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
