# Gates: Implement resource optimizations + prove via tests & before/after stress

- [x] G1: Host toolchain ready (deps installed).
  CHECK: test -d node_modules && test -f node_modules/.bin/vitest && echo OK
  EXPECT: /OK/
  EVIDENCE: yarn install via corepack (1932 pkgs); linkedom@0.18.13 added; vitest bin present.

- [x] G2: Pristine baseline source snapshot exists (pre-change reference for image build).
  CHECK: test -f .bench/baseline-src/package.json && echo SNAP_OK
  EXPECT: /SNAP_OK/
  EVIDENCE: git archive HEAD → .bench/baseline-src (25MB); working tree had 0 tracked modifications at snapshot time.

- [x] G3: Baseline test suites recorded before any source edit.
  CHECK: grep -cE "Test Files" .bench/test-baseline-summary.txt
  EXPECT: /[1-9]/
  EVIDENCE: pristine-HEAD run: Test Files 348 passed | 1 skipped (349); Tests 4728 passed | 23 skipped; tsc 0 errors; oxlint exit 0. (Original log lost to host wipe; summary verbatim from run output, preserved in .bench/test-baseline-summary.txt.)

- [x] G4: Baseline performance captured (idle RSS, boot time, p95 latency, Redis idle ops/min).
  CHECK: node -e "const j=require('./.bench/stress-baseline.json'); console.log(!!j.rssMB&&!!j.bootS&&!!j.healthP95ms)"
  EXPECT: /true/
  EVIDENCE: TRUE baseline = local HEAD build (outline:baseline24l): boot 13.5s, idle RSS 479.4MB, Redis 632 ops/min, health p95 49.5ms. NOTE: an earlier round measured a remote-base upstream artifact and was invalidated + redone (see report methodology).

- [x] G5: A1 — update phone-home removed.
  CHECK: grep -rn "checkUpdates\|utils/updates" server --include='*.ts' | wc -l
  EXPECT: /^0$/
  EVIDENCE: updates.ts deleted; main.ts clean; TELEMETRY/ENABLE_UPDATES removed from env.ts + .env.sample by driver; image grep: build/server/utils/updates.js absent.

- [x] G6: A2 — StatsD pipeline removed.
  CHECK: grep -rn "hot-shots" server plugins app shared --include='*.ts' --include='*.tsx' | wc -l
  EXPECT: /^0$/
  EVIDENCE: Metrics.ts no-op stub (API preserved); metricsTimer block deleted from queue.ts; connections gauge + ShutdownHelper entry deleted from web.ts; hot-shots dropped from package.json/yarn.lock; image contains zero hot-shots strings.

- [x] G7: A3 — requestTracer middleware fully removed.
  CHECK: grep -rn "requestTracer" server --include='*.ts' | wc -l
  EXPECT: /^0$/
  EVIDENCE: file deleted; mounts removed in routes/api/index.ts, routes/mcp/index.ts, routes/oauth/index.ts; absent from built image.

- [x] G8: A5 — trace wrappers short-circuit when APM disabled.
  CHECK: grep -n "isApmEnabled" server/logging/tracing.ts server/logging/tracer.ts | wc -l
  EXPECT: /[2-9]/
  EVIDENCE: isApmEnabled exported at tracer.ts:42 (same predicate as init branch); traceFunction returns target unchanged when disabled (tracing.ts:69).

- [x] G9: B12 — default process count capped at 4 when WEB_CONCURRENCY unset.
  CHECK: grep -c "DEFAULT_MAX_WEB_PROCESSES" server/index.ts
  EXPECT: /[2-9]/
  EVIDENCE: constant defined once, used at both fallback sites (processCount + throng count) in index.ts; explicit WEB_CONCURRENCY honored; force-to-1 collab logic untouched. Not measurable on this 4-core host (min(4,4)=4) — code+image verified (grep count 4 refs in built bundle).

- [x] G10: B13 — Redis healthcheck PING default raised 30s→120s.
  CHECK: grep -n '"120000"' server/env.ts
  EXPECT: /120000/
  EVIDENCE: driver edit in env.ts REDIS_HEALTHCHECK_INTERVAL default.

- [x] G11: B14 — collaboration view-touch cadence 1min→5min.
  CHECK: grep -n "VIEW_TOUCH_INTERVAL_MS" server/collaboration/ViewsExtension.ts
  EXPECT: /VIEW_TOUCH_INTERVAL_MS/
  EVIDENCE: const VIEW_TOUCH_INTERVAL_MS = 5 * Minute.ms used in throttle comparison.

- [x] G12: A14 — SearchIndexProcessor opts out of queueing under postgres provider.
  CHECK: grep -n "static async shouldQueue" server/queues/processors/SearchIndexProcessor.ts
  EXPECT: /static async shouldQueue/
  EVIDENCE: returns env.SEARCH_PROVIDER !== "postgres"; worker.ts checks shouldQueue BEFORE job creation; new spec coverage passing.

- [x] G13: B10 — BacklinksProcessor consumes documents.update.debounced instead of raw update.
  CHECK: grep -c '"documents.update.debounced"' server/queues/processors/BacklinksProcessor.ts
  EXPECT: /[1-9]/
  EVIDENCE: applicableEvents = publish/debounced/delete; spec updated incl. raw-update-rejection test (9/9 passed).

- [x] G14: B11 — notification fan-out batched into IN queries, suppression semantics preserved.
  EVIDENCE: 5 query groups converted to IN queries (users, groups, group-members join, notification suppression, view suppression); payload/ordering identical; spec extended with 3 batching-semantics tests; RevisionCreatedNotificationsTask 20/20 passed.

- [x] G15: C5 — zero top-level value imports of integration SDKs in gitlab/github/linear/notion server code.
  CHECK: grep -rn "^import { Gitlab }\|^import { LinearClient }\|^import { Client }" plugins/gitlab/server plugins/linear/server plugins/notion/server --include='*.ts' | wc -l
  EXPECT: /^0$/
  EVIDENCE: all four SDKs lazy via memoized dynamic import(); octokit plugin factory loads once per process; type-only imports retained; targeted integration specs green (225/225 across helper/converter/plugin suites).

- [ ] G16: C1 — runtime HTML parsing uses linkedom at former jsdom sites.
  CHECK: grep -rc 'await import("jsdom")' server --include='*.ts' --include='*.tsx' | grep -v ':0' | wc -l
  EXPECT: /^1$/ (exactly the documented revert)
ABANDON: G16 ProsemirrorHelper.toHTML kept on jsdom — linkedom serializes attributes reverse-insertion/camelCase breaking exact HTML output parity (91/92 tests); changing shared/editor toDOM specs was out of scope and risks user-visible email HTML diffs. jsdom therefore stays in production dependencies. linkedom landed at DocumentConverter + DocumentHelper (2/3 sites).

- [x] G17: Post-merge full test suites show no NEW failures vs baseline.
  CHECK: grep -E "Test Files" .bench/test-after.txt | tail -1
  EXPECT: /348 passed \| 1 skipped/
  EVIDENCE: after-run: 348 files passed|1 skipped; Tests 4734 passed|23 skipped|0 failed (+6 new tests); one earlier attempt failed en masse due to DB container loss mid-run (6794×ECONNREFUSED), rerun clean.

- [x] G18: Type-check and lint clean vs baseline error counts.
  EVIDENCE: tsc --noEmit 0 errors before AND after merge (leaves each reported delta 0; driver re-ran post-merge: exit 0). oxlint exit 0 after fixing one unused-param finding in SearchIndexProcessor.shouldQueue (oxlint-disable comment added, matching repo pattern).

- [x] G19: Optimized image built and AFTER-stress captured; report has Implementation Results with measured before/after table.
  CHECK: docker image inspect outline:optimized24l > /dev/null && echo IMG_OK; grep -c "Implementation Results" OPTIMIZATION_REPORT.md
  EXPECT: /IMG_OK/ and /[1-9]/
  EVIDENCE: both sides rebuilt from locally-built base images after invalidating remote-base round; AFTER: idle RSS 399.2MB (−80.2MB/−16.7%), Redis idle ops 246/min (−61.1%), latency parity, boot parity. Full table in report.

- [x] G20: Functional smoke on deployed optimized stack matches baseline behavior.
  EVIDENCE: both sides under load-cooldown: home=301 (FORCE_HTTPS redirect), /_health=200, unauthenticated RPC=405; transient 429 during smoke directly after load blast = Outline rate limiter behaving identically both sides.

## Round: constrained breaking-point test (app 1 CPU; redis/pg 1 CPU + 500MB each)

- [x] GC1: Resource constraints actually enforced on all three containers.
  CHECK: docker inspect bench-postgres-1 --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'; docker inspect bench-redis-1 --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'
  EXPECT: /1000000000 524288000/ for both
  EVIDENCE: docker inspect NanoCpus=1000000000 Memory=524288000 for bench-postgres-1 AND bench-redis-1 (verbatim output in session); app container --cpus=1.

- [x] GC2: BEFORE-side (HEAD build) full escalation ladder executed under constraints with per-level metrics + component-health snapshots saved.
  CHECK: grep -c '"level"' .bench/constrained-before.json
  EXPECT: /[4-9]/
  EVIDENCE: .bench/constrained-before.json 9 levels incl. push + pgprobe, all errs=0; peak RSS 616MiB; ladder+push logs saved.

- [x] GC3: AFTER-side (optimized build) identical ladder executed.
  CHECK: grep -c '"level"' .bench/constrained-after.json
  EXPECT: /[4-9]/
  EVIDENCE: .bench/constrained-after.json identical ladder; errs=0 all levels; peak RSS 572.6MiB.

- [x] GC4: First breaking point identified per side with concrete trigger metrics (error%/p95 threshold) and surviving component status (OOM/restarts/rejections checked).
  EVIDENCE: breaker = app CPU: SSR ceiling ~170-186 rps both sides; soft cliff c96-c128 (p95 0.8-1.1s), user-facing c224+ (p95>1.6s); ZERO 5xx/timeouts/OOM/restarts through c288 on both sides. Stores never near limits: PG peak 40/500 MiB (before) & 28.8/500 (after), Redis 7.5/500, redis rejected_connections=0, pg fatal/too-many-clients lines=0.

- [x] GC5: Report gains Constrained Breaking Point section with tables; rate-limiter disabled documented as deviation.
  CHECK: grep -c "Constrained Breaking Point" OPTIMIZATION_REPORT.md
  EXPECT: /[1-9]/
  EVIDENCE: 1

## Round: CPU-reduction audit (tree 3, analysis)

- [x] CR1: Server per-request + background CPU swept by fresh leaf with evidence (middleware chain, event payloads, websocket fanout presentation, serializers, email/export pipelines, logging overhead); COVERAGE declared.
  EVIDENCE: server leaf returned CS-1..CS-9 + KEEP notes; coverage ~53 files + vendored libs; skips declared (client/plugins/editor internals out of its scope).
- [x] CR2: Client runtime CPU swept (re-render hotspots, polling/timers, animation engine work, editor bindings, unthrottled handlers); COVERAGE declared.
  EVIDENCE: client leaf CC-3..CC-10 + recovery leaf CX-1..CX-3 (all 13 shared/editor plugins read, kbar internals verified); framer-motion domMax explicitly REJECTED as CPU measure with reasons.
- [x] CR3: Data-layer CPU costs quantified where code shows them (revision text pipeline incl. franc/markdown-it, changeset diffs, zip levels, css-inline, image processing); COVERAGE declared.
  EVIDENCE: data-layer leaf CD-1..CD-10 incl. five KEEP-QUANTIFIED verdicts (honest null results: collaboration hot path, backlinks, avatars, rollups).
- [x] CR4: Every CPU candidate driver-verified (paths:lines re-read or grep re-run) before entering report; false positives rejected.
  EVIDENCE: driver re-read cited code for CS-1 (Model.ts:381+Event.ts:90-94), CS-2 (jwt.ts:61), CS-3 (worker.ts:63-66), CS-8, CS-9, CX-1 (PlaceholderPlugin apply+walk+textContent, two mounts), CD-1 (buildResultContext:563), CS-5 (double parse) — all confirmed verbatim before entering report.
- [x] CR5: OPTIMIZATION_REPORT.md gains CPU Reduction Audit section w/ impact-ranked table + measured/estimated labels; ledger ALL MET.
  CHECK: grep -c "CPU Reduction Audit" OPTIMIZATION_REPORT.md
  EXPECT: /[1-9]/
  EVIDENCE: 1

## Round: implement all CPU fixes (22 items, 8 parallel leaves)

- [x] F-CS1: Strip oversized values from enqueued event payloads (DB rows unchanged); all `.changes` consumers enumerated and proven unaffected.
  EVIDENCE: stripOversizedValues (>8192 chars -> "[stripped]") applied at Event.ts AfterSave (:151,:155) + schedule (:202); WebsocketsProcessor changes-readers verified scalar-only, no client forwarding of stripped trees; DebounceProcessor verified no re-inflation; 5 new stripper unit tests in Event.test.ts.
[x] F-CS2: Per-process TTL cache for user+team lookup in getUserForJWT; suspension staleness bounded and documented.
  EVIDENCE: jwt.ts Map<sha256(token)>, TTL 30s, LRU 1000; cache AFTER all validations incl. per-call JWT.verify(user.jwtSecret); transfer tokens bypass; failures never cached; 12 new specs green.
[x] F-CS3: WebsocketsProcessor events gated by explicit derived list.
  EVIDENCE: adapted - processor is not a BaseProcessor, so exactly-derived 60-event list websocketApplicableEvents gates routing at worker.ts:152; dedicated queue + consumption unchanged; unmatched events stay no-ops.
[x] F-CS4: Coalesce documents.update websocket fanout per documentId.
  EVIDENCE: module-level Map + 1000ms trailing window in WebsocketsProcessor.ts:43-60; latest-wins; archive/delete immediate; Yjs channel untouched; 3-spec coalesce suite green.
[x] F-CS5: DocumentUpdateTextTask parses PM tree once.
  EVIDENCE: textBetween(node,...) reuses Node.fromJSON output for franc; serializer untouched; new spec asserts single parse (4/4).
[x] F-CS6: Worker logs event name+ids at info; bodies demoted to debug.
  EVIDENCE: eventLogMeta() {name, documentId?, actorId} worker.ts:93; full events at Logger.debug (:133,:229); failure logs untouched.
[x] F-CS7: Compression tuned.
  EVIDENCE: web.ts compress({threshold:2048, br:{params:{BROTLI_PARAM_QUALITY:3}}}); option shape verified against installed koa-compress 5.2.2 types.
[x] F-CS8: Duplicate koa-useragent mount removed.
  EVIDENCE: routes/api/index.ts mount+imports removed (grep there = 0); app-level mount retained.
[x] F-CS9: Rate limiter skips /_health.
  EVIDENCE: early-return before Redis consume (rateLimiter.ts:66) + spec; live A/B pgprobe c64: cpu24 vs prev +5% rps / p95 -10ms in both interleaved rounds.
[ ] F-CD1: Search snippets built without per-result ProseMirror parse.
ABANDON: F-CD1 text column is deprecated markdown AND stale for collaboratively-edited docs (multiplayer persist writes hooks:false; only restoreFromRevision writes text) - snippet switch would be a visual regression; needs a persisted plain-text column (schema work) instead. PostgresSearchProvider.ts untouched by design.
[x] F-CD2: Export path-collision guard O(1) via Set.
  EVIDENCE: parallel Set w/ has/add alongside map writes; caller-preseed covered; 4 new unit tests; 24/24 suite green.
[x] F-CD3: Markdown import manifest matching single-pass; regexes precompiled.
  EVIDENCE: AttachmentReferenceIndex zero-width-lookahead alternation preserving includes() semantics (overlapping names, empty basenames); pattern cache keyed by pathInZip capped 1000; 58/58 provider-import suite green.
[x] F-CX1: PlaceholderPlugin gated/restricted.
  EVIDENCE: lazy memoized textContent getter; O(1) canMatch fast-path for Doc instance (WeakMap-memoized); ToggleBlock delta-walk via changedDescendants + tr.mapping + selection-crossing gate; hard-break semantics preserved (textContent sites swapped=1/left=2 with reasons); 10 new tests incl. irrelevant-edit->0 recomputes.
[x] F-CC4: Code highlighting cache keyed by node identity.
  EVIDENCE: WeakMap<Node,{language,highlighted,decorations}> with relative offsets materialized at current pos; lang-load invalidation via highlighted:false flag; spec proves upstream shift -> 0 highlight calls, edit -> exactly 1.
[x] F-CC5: CodeWordDecorations single changed-walk.
  EVIDENCE: one bidirectional walker short-circuiting on first marked-text change replaces two-directional lib calls; rebuild conditions unchanged; 7 new tests.
[x] F-CX2: Suggestion-menu cursor-context checks coalesced to one macrotask per keystroke.
  EVIDENCE: module-level pendingChecks Map + single setTimeout flush, replace-not-stack, ordering preserved, reentrancy guarded, composition path untouched; Suggestion.ts input-rule timer left (distinct mobile/IME path, documented); 6 new tests.
[x] F-CC3: useAutoRefresh minute counter in ref.
  EVIDENCE: useRef counter; interval/threshold/idle logic identical; routes tree no longer re-renders per tick; new useAutoRefresh.test.tsx (React17 act + reload-path assertion).
[x] F-CC6: MouseSafeArea mousemove rAF-throttled.
  EVIDENCE: one setState max per frame w/ latest position, pending frame canceled on cleanup; return shape unchanged; zero consumer edits needed.
[x] F-CC7: TOC scroll spy caches rects + updates state only on slug change.
  EVIDENCE: [headings]-keyed element cache w/ isConnected fallback; functional guarded setScrolledSlug; throttle kept 100ms.
[x] F-CC8: Scrollable shadow updates rAF-batched + change-gated.
  EVIDENCE: single pending rAF + 100ms trailing settle; scrollTop/scrollHeight/clientHeight change guards; mount-time initial update synchronous.
[x] F-CC10: LocaleTime memoized.
  EVIDENCE: React.memo export + hook memo keyed incl. minutesMounted so the shared 1-min tick still refreshes visible output; dateFormatLong hoisted.
[x] F-CX3: useCommandBarActions memoizes registerable array.
  EVIDENCE: useMemo([actions, context]); context identity proven stable via useStableValue in useActionContext (verified); SearchActions churn pre-existing/out of scope, documented.

## Integration gates (driver)

- [x] INT1: All leaves' targeted tests pass; deviations documented.
  EVIDENCE: L-A 23/23 (+5 new Event stripper tests), L-B 12/12, L-C 3/3, L-D 4/4, L-E 24/24+58/58, L-F 40/40 + shared editor suite 543 passed/9 skipped, L-G 38/38 incl. 6 new, L-H 2/2 + adjacent 50/50. Deviations: F-CS3 relocated to worker.ts (processor not a BaseProcessor); Suggestion.ts timer left (distinct IME path); F-CD1 stopped -> ABANDON recorded.
- [x] INT2: Full monorepo suites green vs baseline (no NEW failures).
  CHECK: grep -E "Test Files" .bench/test-after-cpu.txt | tail -1
  EXPECT: /[0-9]+ passed/
  EVIDENCE: Test Files  362 passed | 1 skipped (363)
- [x] INT3: tsc --noEmit 0 errors; oxlint exit 0.
  EVIDENCE: driver-fixed 2 TS7006 params in jwt.test.ts (concurrent-leaf artifact); final tsc output empty = 0 errors; oxlint app server shared plugins exit 0 (.bench/lint-cpu.txt).
- [x] INT4: Constrained ladder re-run on rebuilt image; ceiling compared vs prior optimized numbers.
  EVIDENCE: outline:cpu24 built from post-fix tree. Interleaved reverse-order A/B under identical host conditions: unauth SSR PARITY (R1 170.1 vs 171.2 rps, R2 164.9 vs 163.2) - expected, fixes target authenticated/event/editor paths not hit by this profile. Exercised path (/_health c64, CS-9): cpu24 wins both rounds (+0.3%/+5% rps, p95 -10ms R2). An initial -10% reading was proven to be host-load noise (load avg 8.6) via order-reversal. Editor/event-path wins are client-side/background and validated by the 88 new unit tests instead of HTTP rps.
- [x] INT5: OPTIMIZATION_REPORT.md gains CPU Fixes Implementation section w/ measured results; ledger ALL MET.
  CHECK: grep -c "CPU Fixes Implementation" OPTIMIZATION_REPORT.md
  EXPECT: /[1-9]/
  EVIDENCE: 1

## Round: hard-cap breaking point (app: 1 CPU + 500 MB RAM total)

- [x] GM1: App container constraints enforced (1 CPU, 500 MB mem, no swap headroom); store limits unchanged.
  EVIDENCE: verbatim docker inspect during both runs: '1000000000 524288000 524288000' (bench-outline; --memory-swap=500m = no swap escape). Stores unchanged from prior round (verified same command earlier). Container torn down after runs.
- [x] GM2: Full ladder + push executed on current fixed build (outline:cpu24) under hard cap; per-level rps/p95/errors + RSS trace + OOM/restart checks recorded.
  EVIDENCE: outline:cpu24 full ladder+push under hard cap: zero OOM/restarts/5xx all levels; peak RSS 108.7MiB; first timeouts only at c288 (79). Results .bench/constrained-cpucap.json.
- [x] GM3: Same executed on pre-CPU-fix build (outline:optimized24l) for comparison.
  EVIDENCE: outline:optimized24l identical run: same survival profile, peak RSS 109MiB; results .bench/constrained-prevcap.json.
- [x] GM4: Breaking mode identified: OOM-kill vs GC-thrash vs CPU wall — with trigger metrics (level, RSS at death, error class) and post-mortem evidence (inspect state, logs).
  EVIDENCE: Break mode = GC-thrash bending, NOT OOM: V8 clamps heap to cgroup (both builds ~109MB peak vs ~600MB unlimited), throughput wall drops 180->110rps, p95 crosses 1s at c96, first client failures (timeouts) at c288. Per-level state snapshots all 'running oom=false'.
- [x] GM5: Report gains Hard-Cap Breaking Point section comparing builds; ledger ALL MET.
  CHECK: grep -c "Hard-Cap Breaking Point" OPTIMIZATION_REPORT.md
  EXPECT: /[1-9]/
  EVIDENCE: 1

## Round: viability study — Bun runtime + lightweight DB/cache/S3 alternatives

- [x] GR1: Runtime-coupling inventory complete: every Node-specific dependency enumerated from code (cluster/throng/process IPC, dd-trace patching, jsdom, Bull mechanics, ws/upgrade muxing, streams, build tooling) with file:line evidence + blocker ranking.
  EVIDENCE: Leaf matrix of 25 areas w/ files:lines; blockers ranked (throng/cluster BLOCKER; constrainedMemory guard; fork+IPC preflight; upgrade mux fidelity; jsdom export path; conditional dd-trace/Sentry). Coverage declared incl. skipped internals.
- [x] GR2: Database feature-dependency inventory complete: every Postgres-specific capability in use (tsvector/triggers, JSONB ops, CTEs, ON CONFLICT, UNLOGGED, raw SQL sites, dialect assumptions) mapped against SQLite/alternatives.
  EVIDENCE: Feature table (tsvector triggers+GIN+ranking, arrays @> in API filters, JSONB GIN, replicas, timeouts) + 12-site raw-SQL list + migration-history verdict (300 files, 61 PG-DDL). Verdicts: SQLite XL/single-host, PGlite blocked (single-process), MySQL L-but-negative-savings. NO-GO.
- [x] GR3: Cache/queue/storage inventory complete: every Redis touchpoint classified single-process-safe vs not; storage backends + lazy-loading verified; removal blueprints sketched per deployment shape.
  EVIDENCE: ~20 touchpoints classified; RateLimiterMemory already imported (verified RateLimiter.ts:3); CacheHelper inflight map exists; producer/consumer pairing verified (worker produces websocketQueue, websockets service consumes); deployment-shape matrix; blueprints per option.
- [x] GR4: Driver verification pass: top blocker claims re-checked in code before entering report; external-knowledge claims labeled as such.
  EVIDENCE: Driver re-read: index.ts:59 throng; cluster.isWorker x3; startup.ts fork-ipc + constrainedMemory; websockets.ts:53-54 pop/re-add; database.ts:41 dialect; main.ts:87 redis ping; storage/files/index.ts single-backend + lazy getS3; DocumentInsight CTE/ON CONFLICT; RateLimiterMemory import; websocketQueue producer/consumer sites. All confirmed verbatim.
- [x] GR5: OPTIMIZATION_REPORT.md gains Viability Assessment section with per-change GO/NO-GO/CONDITIONAL verdicts + costs/benefits; ledger ALL MET.
  CHECK: grep -c "Viability Assessment" OPTIMIZATION_REPORT.md
  EXPECT: /[1-9]/
  EVIDENCE: 1
