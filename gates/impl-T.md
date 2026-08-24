# Gates: Leaf T — telemetry strip (A1 updates phone-home, A2 StatsD pipeline, A3 requestTracer, A5 tracing short-circuit)

- [x] T1: A1 done — server/utils/updates.ts deleted; server/main.ts has no checkUpdates import/call/interval; no dangling imports. env var removal is driver's job — do NOT edit server/env.ts.
  EVIDENCE: updates.ts deleted; main.ts import/call/interval removed; grep checkUpdates==0 across src.

- [x] T2: A2 done — server/logging/Metrics.ts rewritten as a no-op stub preserving the exact public surface (gauge, gaugePerInstance, increment, flush) with JSDoc noting the sink removal; zero hot-shots import; queue depth gauge setInterval block deleted from server/queues/queue.ts incl. its ShutdownHelper cleanup; connections gauge interval + "connections" ShutdownHelper entry deleted from server/services/web.ts.
  EVIDENCE: Metrics no-op stub w/ exact surface; hot-shots refs==0; metricsTimer block gone from queue.ts; connections interval + shutdown entry gone from web.ts; dep dropped from package.json/yarn.lock by driver.

- [x] T3: A3 done — server/middlewares/requestTracer.ts deleted; mount lines removed from routes/api/index.ts, routes/mcp/index.ts, routes/oauth/index.ts with unused imports cleaned.
  EVIDENCE: requestTracer.ts deleted; mounts removed from api/mcp/oauth index routes; repo grep==0.

- [x] T4: A5 done — tracer.ts exports an isApmEnabled flag computed from the same predicate that selects the real tracer (env.DD_API_KEY && cluster.isWorker); tracing.ts traceFunction returns target unchanged when !isApmEnabled (in addition to existing test-env bypass); traceMethod/traceClass inherit the behavior via traceFunction.
  EVIDENCE: isApmEnabled exported tracer.ts:42 from same predicate; traceFunction early-return added tracing.ts:69.

- [x] T5: Targeted vitest specs touching touched areas pass (locate via grep: routes/index.test.ts, any logging/Metrics/tracing specs); no edits outside owned files (no env.ts/package.json).
  EVIDENCE: routes/index.test.ts 34/34 passed (verbatim in leaf report); tsc delta 0; no out-of-scope edits.
