# Gates: Implementation of optimization tiers (tree 5)

Scope: implement OPTIMIZATION_REPORT.md items B12, A1, A2, A3, A5, B13, B14, A14, B10, B11,
C5, C1. Prove with: full test suites vs recorded baseline, tsc/lint, dockerized deploy +
stress test BEFORE and AFTER changes.

## Contract
- Driver owns cross-cutting files exclusively: server/env.ts, package.json, yarn.lock,
  .env.sample, OPTIMIZATION_REPORT.md.
- Leaf T owns: server/utils/updates.ts(del), server/main.ts, server/logging/{Metrics,tracing,tracer}.ts,
  server/queues/queue.ts, server/services/web.ts, server/middlewares/requestTracer.ts(del),
  routes mounts {api,mcp,oauth}/index.ts.
- Leaf E owns: server/index.ts, server/collaboration/ViewsExtension.ts,
  server/queues/processors/SearchIndexProcessor.ts(+spec).
- Leaf D owns: BacklinksProcessor.ts(+spec), RevisionCreatedNotificationsTask.ts(+spec).
- Leaf L owns: plugins/{gitlab,github,linear,notion}/server/** value-import lazification;
  ProsemirrorHelper.tsx, DocumentHelper.tsx, DocumentConverter.tsx/.ts linkedom swap.
- No leaf edits outside its list. Leaves run TARGETED vitest specs only; full suites are driver's.

## Status log (append only)
- [t0] Task started. Snapshot baseline-src from HEAD (25MB). Old audit ledger archived to
  /tmp/opencode/audit-gates/.
- [t1] Env facts: docker 29.6.1, compose v5.3.0, 4 cores / 7.6GB RAM host (B12 cap=cpus here,
  delta expected ~0 locally — verify logic + note). yarn absent → corepack yarn install running.
  linkedom@0.18.13 to be added by driver pre-dispatch. Debounce chain confirmed:
  documents.update ->(.delayed +5min) ->(.debounced); Event union has both; RevisionsProcessor
  already consumes .debounced. shouldQueue checked BEFORE job creation in globalEventQueue ✓.

## Status log (implementation task, appended)
- [t2] Baselines: tests 348f/4728t green; tsc 0; lint 0; TRUE-baseline stress (after remote-base
  invalidation): boot 13.5s / RSS 479.4MB / redis 632 ops-min.
- [t3] Leaves T,E,D,L merged. Driver edits: env.ts (TELEMETRY/ENABLE_UPDATES removed; healthcheck
  default 120000), .env.sample (ENABLE_UPDATES section removed), package.json (hot-shots dropped,
  linkedom added). tsc post-merge 0 errors.
- [t4] Full after-suite green: 348 files | 4734 tests passed (+6 new), 0 failed. Lint exit 0.
- [t5] Docker pair rebuilt from local bases (remote-base artifact round invalidated honestly).
  AFTER: boot 14.1s / RSS 399.2MB (−16.7%) / redis 246 ops-min (−61%); latency parity; smoke parity.
- [t6] G16 partially abandoned with reason (jsdom retained for ProsemirrorHelper.toHTML).

## Round: CPU fixes implementation — master plan (driver)

Pre-flight verified: all event.changes consumers read only scalars (attributes / previous.*);
textBetween(node) util exists; RateLimiter token-cache pattern reusable; WebsocketsProcessor has
60 switch cases.

### Ownership matrix (disjoint files per leaf)
- L-A events+worker: Event.ts, DebounceProcessor.ts, worker.ts, middlewares/rateLimiter.ts → CS1,CS3,CS6,CS9
- L-B auth: utils/jwt.ts (+spec) → CS2
- L-C websocket: WebsocketsProcessor.ts → CS4
- L-D tasks+web: DocumentUpdateTextTask.ts, services/web.ts, routes/api/index.ts → CS5,CS7,CS8
- L-E data: PostgresSearchProvider.ts, ExportDocumentTreeTask.ts, MarkdownAPIImportTask.ts → CD1,CD2,CD3
- L-F editor-deco: PlaceholderPlugin, nodes/Doc.ts, nodes/ToggleBlock.ts, CodeHighlightingPlugin, CodeWordDecorationsPlugin → CX1,CC4,CC5
- L-G editor-suggest: SuggestionsMenuPlugin.ts, app/editor/extensions/Suggestion.ts → CX2
- L-H client-ui: useAutoRefresh, useMousePosition/MouseSafeArea, Contents.tsx, Scrollable.tsx, LocaleTime/useLocaleTime, useCommandBarActions → CC3,CC6,CC7,CC8,CC10,CX3

### Key design decisions (leaves must honor or justify deviation)
- CS1: strip at enqueue time only (Event.schedule + AfterSave path); whitelist approach — keep
  attributes/previous scalar entries; replace any single serialized value >8KB with "[stripped]"
  marker; DB persist path untouched; DebounceProcessor spreads already-stripped payload.
- CS2: in-process LRU (cap 1000) keyed by sha256(token), TTL 30s; document staleness bound;
  no cross-process invalidation (accepted trade-off).
- CS3: derive applicableEvents strictly from existing switch cases; behavior for unmatched
  events must remain no-op.
- CS4: module-level Map<documentId, timer+payload> trailing 1000ms in WebsocketsProcessor;
  latest payload wins; Yjs realtime channel NOT touched.
- CS5: reuse parsed node via textBetween(node,...); no franc-skip heuristic unless trivially safe.
- Editor leaves: preserve public plugin APIs; run shared-project specs.
