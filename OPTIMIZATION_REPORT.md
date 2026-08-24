# Outline — Runtime Resource Optimization Report

**Goal:** reduce runtime resource consumption (CPU, RAM, Redis/Postgres load, network, bundle/disk) without losing any real user feature. Telemetry/analytics is treated as removable by definition. Self-hosted ("community") deployment context.

**Method & verification:** tree-5 audit — six parallel research leaves covered `server` observability, `server` workers/cron, `app` client runtime, the dependency graph, all 23 `plugins/*`, and always-on data/runtime costs. Every candidate below carries code references that were **re-checked directly by the driver** (marked ✓) before inclusion. Nothing here comes from memory; estimated sizes are labeled *estimate*.

**Measured baseline (re-measured at report time):**
| Metric | Value |
|---|---|
| Non-test TS/TSX source files | 1,853 (app 808 · server 586 · shared 290 · plugins 169) |
| Production dependency entries | 231 |
| Plugin directories | 23 |
| Queue processors + tasks | 96 files, incl. 19 cron tasks |
| i18n locales on disk | 28 dirs, 4.3 MB (server-served per language, **not** bundled client-side) |

---

## A. Safe removals — zero user-facing feature loss

| # | Candidate | What it is today | Evidence | Savings mechanism | Risk |
|---|---|---|---|---|---|
| A1 | **Update phone-home (`checkUpdates`)** ✓ | Boot + daily POST of install fingerprint + user/team/doc counts to `updates.getoutline.com`; response cached under Redis `UPDATES_KEY` which **nothing ever reads** — a dead-end data path. On by default (`ENABLE_UPDATES`/`TELEMETRY`, env.ts:385–392), runs 4 DB COUNT queries each fire. | server/utils/updates.ts:19–66; server/main.ts:27,148–153 ✓ | Deletes periodic DB scans + outbound calls + the latent timeout-less fetch. No UI consumes the stored notice. | None |
| A2 | **StatsD pipeline (`hot-shots`) incl. 5 s queue gauges** ✓ | `Metrics` singleton constructed unconditionally in every process (web/websockets/collaboration/worker/cron); every log line, email, WS connect, queue event emits UDP datagrams to a local agent that doesn't exist by default. Plus a `setInterval` every 5 s per queue per process issuing two Redis COUNT round-trips, and a 5 s web-connections gauge. | server/logging/Metrics.ts:1–45; server/queues/queue.ts:68–85 ✓; server/services/web.ts:74–88 | Removes constant Redis chatter (~0.8 ops/s/process idle), timers, per-event CPU. No local consumer exists. | None |
| A3 | **`requestTracer` middleware** | Enumerates every body/query param of **every API/MCP/OAuth request** to tag Datadog root spans that are noops unless `DD_API_KEY` is set. Always mounted. | server/middlewares/requestTracer.ts:1–24; mounted routes/api/index.ts:77, mcp/index.ts:225, oauth/index.ts:297 | Per-request CPU back on 100 % of traffic. | None |
| A4 | **dd-trace dependency** | Lazily initialized APM; inert without `DD_API_KEY`, but the package (and its require-time patching surface) ships and its shim loads first thing at boot. | server/logging/tracer.ts:25–65; server/index.ts:3; package.json | Install size + startup module graph. Installs that deliberately use DD keep it behind the existing flag instead. | Low (self-hosted default) |
| A5 | **`traceFunction` wrappers when tracer is a noop** ✓ | Decorators on ~30 hot paths (document presenters, policy presenter, revision presenter, collaboration extensions, converters) build spans/tags and wrap promises **even with APM off** — the only gate is `NODE_ENV==="test"`. | server/logging/tracing.ts:59–127 ✓ | Make the wrapper pass through when tracer is noop → identical observable behavior, pure CPU/allocation win on most API responses. | Low |
| A6 | **Sentry loaded eagerly on client even when DSN unset** ✓ | `@sentry/react` statically imported from the entry graph (`app/index.tsx:31` → `utils/sentry.ts:1`, also Logger/AuthStore/WebsocketProvider), so every visitor downloads/parses the SDK and pays a breadcrumb hook on every socket event, regardless of configuration. | app/utils/sentry.ts:1; WebsocketProvider.tsx:166–172 | Lazy facade: dynamic-import only when `SENTRY_DSN` set. Same for `@sentry/node`'s unconditional import chain server-side (init already DSN-gated). Removes ~60–100 KB gz (*estimate*) from eager waterfall. | Low–medium |
| A7 | **Google Analytics injection surface** *(conditional)* | Core `Analytics.tsx` injects GA3/GA4/Matomo/Umami scripts when configured; vendored 707-line autotrack ships in the bundle. Default-inert. | app/components/Analytics.tsx:16–126; app/index.tsx:103–115 | Strip for hardened self-hosted builds via compile-time flag. **Conditional:** admins who configured Matomo/Umami lose in-app analytics. | Very low (default installs) |
| A8 | **googleanalytics plugin** | Admin settings card for GA measurement IDs; third-party cloud telemetry path. | plugins/googleanalytics/client/index.tsx:6–18 | Delete dir (+A7 core path). | None for default installs |
| A9 | **zapier plugin + CSP allowance** ✓ | Cloud-only settings card (`"deployments": ["cloud"]` skips registration self-hosted) — but its chunks still ship because the client glob matches every dir, and `cdn.zapier.com` is whitelisted in CSP **unconditionally** on every install. | plugins/zapier/plugin.json ✓; csp.ts:79–80 ✓; app/utils/PluginManager.ts:145 | Delete dir + 2 CSP lines. Zapier automations use the public REST API and are unaffected. | Negligible |
| A10 | **iframely plugin** *(conditional)* | Generic rich-unfurl fallback; disabled until `IFRAMELY_API_KEY`/`IFRAMELY_URL` set. | plugins/iframely/server/index.ts:10–18 | Delete dir. **Conditional:** generic external links lose rich previews (GitHub/Linear/Figma/Slack previews unaffected — separate providers). | Low |
| A11 | **Dead service-worker route** | Workbox `CacheOnly` rule for `/api/urls.unfurl` can never match (unfurls are POSTed; workbox defaults to GET matching) and would error on miss anyway. | vite.config.ts:72–86 | Hygiene deletion; prevents future cache-tuning confusion. | None |
| A12 | **Zero-reference dependencies** ✓ | `core-js` (polyfills are hand-rolled in app/utils/polyfills.ts), `react-is` (regular dep of styled-components/framer-motion already), `@bull-board/ui` (already a dependency of `@bull-board/koa`). All 0 imports repo-wide including configs. | grep counts 0/0/0 ✓ | Install disk + supply-chain surface; zero runtime change. | None |
| A13 | **Misplaced prod deps → devDeps** | `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `sequelize-cli`, `@types/form-data`, `@types/mailparser`, `@types/pako`, `@types/sanitize-filename` are build/type-time only but sit in `dependencies` → installed in production images. | package.json:118, 273–274, 114–117 | Smaller production Docker image/install. | None |
| A14 | **Search-index jobs that are guaranteed no-ops** ✓ | Under the default Postgres search provider, `SearchIndexProcessor` still receives queued Bull jobs for 13 event types just to early-return (`SEARCH_PROVIDER === "postgres"` check). The processor has no `shouldQueue` override although the base class supports exactly this. | SearchIndexProcessor.ts:20–46 ✓; worker.ts:74–75 ✓ | Add `shouldQueue → false` when provider is postgres: eliminates several job create+consume cycles per save cycle. External search providers unaffected. | None |

---

## B. Downgrades — tiny behavior deltas, large resource cuts

| # | Candidate | What you give up (slight) | What you save | Evidence |
|---|---|---|---|---|
| B1 | **Narrow PWA precache to app shell** (or drop `VitePWA` for self-hosted) | Cold offline start of never-visited routes fails on installed PWAs. In-session offline editing is unaffected (content persists via y-indexeddb) and offline value is already marginal: `navigateFallback: null`, no `.html` precached. | Today every visit + **every deploy** downloads and caches the entire chunk graph (entry + all vendors + mermaid/elk + FontAwesome…) up to 5 MB/file. Est. 5–15 MB transfer + Cache Storage write per first visit/release (*estimate*). | vite.config.ts:57–103 ✓ |
| B2 | **Cap/remove attachment runtime cache** | Repeat views stream from server again. | Workbox `CacheFirst` on `/api/files.get` has **no per-entry size limit** (runtime strategies ignore `maximumFileSizeToCacheInBytes`) → arbitrary-size videos/attachments pinned to disk per user, up to hundreds of MB. | vite.config.ts:87–101 ✓ |
| B3 | **Lazy-load emoji dataset** | First open of emoji picker/reactions/icon-search pays a small delay. | `shared/utils/emoji.ts` statically imports `@emoji-mart/data` + module-scope `init()` → ~600 KB raw JSON parsed whenever the editor chunk loads, even if never used (*estimate*). The lazy pattern already exists in `shared/editor/lib/emoji.ts:53-60`. | shared/utils/emoji.ts:1–8 ✓ |
| B4 | **Lazy-load math/katex** | First math block renders with slight delay. | katex + prosemirror-math sit in the static editor import chain (`nodes/Math.ts:14,78` → `extensions/Math.ts`) though math is rare; contrast mermaid which is properly dynamic. One of the largest vendor chunks out of the eager editor path. | shared/editor/nodes/index.ts:107–109; extensions/Math.ts:19 |
| B5 | **framer-motion `domMax` → `domAnimation`** | Two cosmetic layout animations (tab underline slide, comment position animation) replaced with CSS transitions. | Drag/layout features unused elsewhere; ~25–35 KB gz less parse/exec at boot (*estimate*), smaller reconciler work. | app/index.tsx:5,76; Tab.tsx:139,168; CommentThread.tsx:233 |
| B6 | **Defer kbar mount** | Command bar initializes after first interaction instead of boot. | kbar wraps the whole tree at entry (incl. share links/login screens) with internal state subscribers + continuous action registration. | app/index.tsx:6,74 |
| B7 | **Defer client plugin loading to idle** | Settings-sidebar plugin entries appear moments later. | `loadPlugins()` fires pre-first-paint and `Promise.all`s N parallel chunk requests during the critical load window. | app/index.tsx:36; app/utils/PluginManager.ts:140–148 |
| B8 | **Conditional mermaid extras** | Diagrams using ELK layouts / FA icons inside mermaid pay first-use latency. | ELK loader + fa-solid/fa-brands packs register eagerly once any mermaid block exists — hundreds of KB min for plain flowcharts (*estimate*). | shared/editor/extensions/Mermaid.ts:126–159 |
| B9 | **Retention cleanups hourly → daily** | Trash/audit/search-query/notification purging shifts ≤24 h for items already invisible to users (30-day trash delay, 365-day audit retention). | Five hourly cleanup tasks each run ≥1 indexed SELECT/hour even when empty; two batch-scan up to 100 k rows. Eliminates ~115 mostly-idle runs/day. | CleanupOldEventsTask.ts:13–15; CleanupOldSearchQueriesTask.ts:13–15; CleanupDeletedDocumentsTask.ts:39–44 |
| B10 | **Backlinks on debounced event** | Backlinks become eventually-consistent (≤5 min lag). | Currently fires on raw `documents.update`: doc fetch + link parse + per-link queries + NOT-IN destroy scan — ~60+ queries across a 30-link editing session, repeated per save. Collapse to one rebuild per session like RevisionsProcessor already does. | BacklinksProcessor.ts:9–13 ✓ vs DebounceProcessor.ts:15–48 |
| B11 | **Batch notification fan-out queries** | None (same output, same suppression rules). | Per revision: N+1 `User.findByPk` per mention/group member + 2 suppression queries **per recipient** (`Notification.findOne` + `View.findOne`) + per-notification email lookups. Single IN-query batching turns O(recipients×2)+O(mentions) into O(1) round-trips — the biggest per-save DB amplifier. | RevisionCreatedNotificationsTask.ts:62,119–132,200,229; EmailsProcessor.ts:21–53 |
| B12 | **WEB_CONCURRENCY default cap** | Fewer processes on many-core boxes (Koa serving is IO-bound; throughput impact minimal). | Falls back to `os.cpus().length` — an 8-core box clones the full Sequelize model graph, PG pools (max 5 + RO×2 each), 4 Bull connections and Redis clients ×8 before any traffic. Cap default (e.g. `min(cpus,4)`). | server/index.ts:48–52 ✓; database.ts:57–58,165–168 |
| B13 | **Redis healthcheck cadence + connection diet** | Failure detection of dead Redis slows from 30 s to ~2 min. | Every non-blocking client PINGs every 30 s; plus 4 dedicated Bull bclients per process (websocketQueue is consumed only by websocket procs). Raise interval to 120 s; consolidate low-volume bclients. | redis.ts:91–123; queue.ts:21–38; HealthMonitor.ts:41–48 |
| B14 | **Presence/view writes every minute → 5 minutes** | "Recently active"/unread-read timestamps can lag ≤5 min while editing. | Each editing socket writes `View.touch` + `user.update(lastActiveAt)` at most once/min → 5× fewer background writes. | server/collaboration/ViewsExtension.ts:37–47 ✓ |
| B15 | **Gate the GitLab plugin like its siblings** | None — feature stays opt-in. | Only integration plugin registering **unconditionally**: mounts router, instantiates issue provider, registers webhook task, and pulls `@gitbeaker/rest` into every boot with zero creds. Add the standard `GITLAB_CLIENT_ID && GITLAB_CLIENT_SECRET` gate used by figma/linear. | plugins/gitlab/server/index.ts:7–31 ✓ |
| B16 | **Cache webhook-subscription lookup briefly** | New webhooks activate up to ~60 s later. | `WebhookProcessor.shouldQueue` runs an indexed SELECT **for every single event** even when no team has subscriptions. Short-TTL cache (or team-level memo) removes steady-state query load. | plugins/webhooks/server/processors/WebhookProcessor.ts:17–29 ✓ |
| B17 | **Events-table retention as env knob** | Ops choice, not code. | Retention hardcoded 365 d with an in-code TODO; expose env var so lean installs can cut the events table (audit-log growth) aggressively. | CleanupOldEventsTask.ts:13 |
| B18 | **Deterministic cron jobIds** | None. | Restarts re-enqueue duplicate delayed daily/hourly jobs (Bull persists them; no deterministic ID) → post-deploy duplicate heavy work. Key jobId by name+window. | BaseTask.ts:19–27; services/cron.ts:32–40 |
| B19 | **(Optional) Realtime sidebar sync on debounced event** | Non-collaborative list/sidebar refresh lags ≤5 min. | Every raw save currently triggers document present + membership fanout via websocket job. Only take this if B10's model proves acceptable. | WebsocketsProcessor.ts:216–226,1042–1084 |

---

## C. Technology replacements / consolidations — different tech, massive cut

| # | Replace | With | Why cheaper | Risk |
|---|---|---|---|---|
| C1 | **jsdom** for server-side HTML parsing (`ProsemirrorHelper`, `DocumentHelper`, `DocumentConverter`) | **linkedom** (or `happy-dom` subset) | Full DOM implementation + CSS parser allocated per parse for what is only ProseMirror DOM-parsing of document HTML; linkedom does this at a fraction of RAM/CPU per conversion (imports/exports/bulk ops). jsdom is already dynamically imported, so swap is contained to 3 call sites. | Medium (spec edge cases in parsing) |
| C2 | **Two DnD stacks** (`react-dnd` + `react-dnd-html5-backend` AND `@dnd-kit/*`) | **@dnd-kit only** | Two full drag-and-drop engines shipped and hydrated; react-dnd serves sidebar/tree dragging, dnd-kit serves cards/pins. One engine = less JS, one context system. | Medium (sidebar drag rewrite) |
| C3 | **Two virtualization stacks** (`react-window` + `react-virtualized-auto-sizer` AND `@tanstack/react-virtual`) | **@tanstack/react-virtual** | IconPicker grid + DocumentExplorer list vs Table already on tanstack; one windowing engine, fewer deps. | Medium-low |
| C4 | **Two fuzzy-search engines** (`fuzzy-search` AND `fuse.js`) | **fuse.js** | DocumentExplorer + emoji search vs command bar; one ranking implementation, drops 2 packages (+its devTypes). | Low (ranking differs slightly) |
| C5 | **Integration SDKs required at boot** (octokit family, `@gitbeaker/rest`, `@linear/sdk`, `@notionhq/client`) | **lazy `import()` inside handlers** | Plugins are `require()`d at startup, so each *enabled* integration's full transitive SDK graph becomes resident RAM in every process whether or not any request ever uses it. Convert top-level SDK imports to in-handler requires. | Medium |
| C6 | **node-fetch@2 + form-data** legacy stack | **native fetch / undici** (Node ≥ 20 engines already required) | Drops a polyfill HTTP stack kept alive in email/unfurl paths; native fetch also fixes the timeout-less request class seen in updates.ts. | Low-medium (behavioral diffs) |
| C7 | **slug + slugify duplication** | **slugify** | Same job in two libs (unicode transliteration parity to be checked for old slugs). | Low |
| C8 | **mobx-utils** (2 trivial uses) | direct deps (`invariant`) + inline `now()` | Removes a package for 2 call sites. | Low |

---

## Deliberately KEPT (verified user-facing or security-critical — do not remove)

- **Realtime stack:** socket.io (`/realtime`: presence/UI invalidation/notifications) + hocuspocus (`/collaboration`: Yjs docs) are multiplexed in one process by default; merging protocols = full client rewrite for **zero** always-on saving. Collaboration Redis extension correctly gated on `REDIS_COLLABORATION_URL`.
- **Revisions & DebounceProcessor** (version history is not per-keystroke; already debounced 5 min), **popularity-score rollup** (feeds user-visible "popular" sort + Postgres search ranking boost).
- **Postgres full-text search** (default provider; tsvector maintained by DB triggers; cheapest option already selected), **rate limiter**, **HealthMonitor** (30 s, exits unhealthy workers), **redlock/MutexLock**.
- **y-indexeddb** per-document offline persistence and the narrow `PoliciesStore` IndexedDB persistence — bounded and user-valuable.
- **Per-language lazy i18n** — only active locale fetched; the 4.3 MB locale tree is never bundled.
- **Gated integrations users rely on:** slack, github, linear, notion, figma, google/microsoft/discord/oidc/passkeys auth, email magic-link, webhooks (feature itself), local storage backend, diagrams setting, slab importer (thin), matomo/umami cards (owner-controlled analytics; keep-flag per audit premise).
- **enterprise/** dir: never loaded by either plugin loader (i18n extraction stub for proprietary build) — zero runtime cost either way; leave untouched.

## Priority order if you want the biggest cuts first

1. **A1+A2+A3+A5** (telemetry/noop-tracing strip) — constant background CPU/Redis/network → ~0, zero risk.
2. **B1+B2** (PWA precache + attachment cache) — largest client-side network/disk multiplier per deploy.
3. **A14+B10+B11** (wasted search jobs, backlinks debounce, notification batching) — largest per-save DB amplifiers.
4. **B12+B13+B14** (process count, Redis chatter, view writes) — baseline infra footprint down sharply.
5. **C5+C1** (SDK lazy-loading, linkedom) — resident RAM per process and per-conversion cost.
6. **B3–B8** — editor/boot payload trims.

## Ledger

Verification: 6 leaf gates files fully met with evidence (`gates/L1…L6`), driver spot-re-ran the decisive greps (✓ marks above), root ledger in `GATES.md`. Numbers in this report re-measured at write time: file counts (find/wc), dependency count (package.json parse), plugin count (ls), locale size (du), reference counts (grep). Size figures labeled *estimate* were not measurable (node_modules absent from checkout).

---

## Implementation Results (post-implementation, measured)

**Scope implemented:** B12 · A1 · A2 · A3 · A5 · B13 · B14 · A14 · B10 · B11 · C5 · C1(2/3 sites).

**Methodology:** Dockerized local deploy (compose: postgres+redis; app container built from source via `Dockerfile.base` + runner stage). One deviation from stock images, applied **identically to both sides**: the upstream runner (`node:26.3.0-slim`) crashes at boot on `buffer-equal-constant-time` (pre-existing HEAD bug, discovered during baseline), so both artifacts were re-wrapped onto `node:24-slim`. First measurement round was invalidated and redone: plain `docker build` resolves `BASE_IMAGE` to the *remote* `outlinewiki/outline-base`, producing upstream artifacts rather than this tree — both sides were rebuilt with locally-built base images and re-measured. Idle = no traffic for 60 s; Redis ops/min = commandstats delta; latency = 20 s @ concurrency 16 per endpoint.

| Metric (idle unless noted) | BEFORE (HEAD) | AFTER | Delta |
|---|---|---|---|
| Resident memory (avg of 10 samples) | 479.4 MB | **399.2 MB** | **−80.2 MB (−16.7 %)** |
| Redis ops/min at idle | 632 | **246** | **−386 (−61.1 %)** |
| Boot → healthy /_health | 13.5 s | 14.1 s | ~parity |
| /_health p50 / p95 (load) | 15.3 / 49.5 ms | 15.3 / 49.0 ms | parity |
| `/` p50 / p95 (load), rps | 14.0 / 36.9 ms @946 | 12.8 / 37.6 ms @971 | parity |

Functional smoke identical both sides under load and after cooldown: `/`→301 (FORCE_HTTPS), `/_health`→200, unauthenticated RPC→405.

**Tests:** full monorepo suites before AND after: 348 files passed / 1 skipped both runs; tests 4,728→**4,734 passed**, 0 failed (6 new tests cover shouldQueue gating + batching semantics). `tsc --noEmit` 0 errors before/after; oxlint exit 0.

**Per-item notes (honest ledger):**
- B12 cap verified in code + image (`DEFAULT_MAX_WEB_PROCESSES` present ×4 refs); **not exercisable on this 4-core host** (min(cpus,4)=4=cpus) — benefit appears on >4-core VPSes.
- B11 batching preserved suppression semantics; verified by 20/20 task spec incl. 3 new batching-semantics tests.
- B10 backlinks now ride the existing `documents.update.debounced` chain — zero extra jobs created.
- C1: linkedom landed at DocumentConverter + DocumentHelper; **ProsemirrorHelper.toHTML intentionally kept on jsdom** — linkedom serializes attributes in reverse-insertion/camelCase order breaking exact HTML output parity (91/92 tests). jsdom therefore remains a production dependency.
- C5: all four SDKs (@gitbeaker/rest, octokit family, @linear/sdk, @notionhq/client) now load via memoized dynamic import on first use.
- Redis healthcheck default raised 30s→120s (B13); view-touch writes 1min→5min cadence (B14).

### Constrained Breaking Point test (app 1 CPU; redis 1 CPU+500 MB; postgres 1 CPU+500 MB)

Deviation documented: `RATE_LIMITER_ENABLED=false` and `FORCE_HTTPS=false` on the app container for load runs (else the limiter/redirect masks capacity); identical on both sides. `/` = SSR login page (real render), `/_health` = DB-bound (SELECT 1 per hit). Load = node fetch clients, 10 s client timeout.

**Ladder (45 s per level) — rps | p95 ms | errors:**

| Level | BEFORE | AFTER |
|---|---|---|
| c8 | 126 \| 101 \| 0 | **163 \| 71 \| 0** |
| c16 | 140 \| 185 \| 0 | **173 \| 123 \| 0** |
| c32 | 170 \| 241 \| 0 | **187 \| 208 \| 0** |
| c64 | 179 \| 452 \| 0 | 186 \| 413 \| 0 |
| c128 | 172 \| 1078 \| 0 | **183 \| 986 \| 0** |
| push c224 | 162 \| 1911 \| 0 | **169 \| 1636 \| 0** |
| push c288 | 171 \| 2075 \| 0 | 186 \| 1911 \| 0 |
| pgprobe c64 (SELECT 1) | 1269 \| 80 \| 0 | **1341 \| 77 \| 0** |

**Where things break:**
1. **First breaker is app CPU, not the stores.** SSR wall at 1 CPU ≈ **170–186 req/s**; latency collapse begins around c96–c128 (p95 ≈ 0.8–1.1 s) and user-facing degradation at c224+ (p95 > 1.6–2.1 s). Even at c288: zero 5xx, zero timeouts, no OOM kills, no container restarts — it degrades by queueing instead of failing.
2. **Redis and Postgres never approached their 500 MB caps**: PG peaked 40 MiB (before) / 28.8 MiB (after); Redis 7.5 MiB both sides; rejected_connections 0; zero fatal/too-many-clients log lines. The DB-bound health path sustains ~1,300 rps at p95 <90 ms.
3. **AFTER tolerates more before hurting**: +29 % throughput at c8, p95 lower at every level, peak RSS under overload 572.6 MiB vs 616 MiB (−43 MiB).
4. Practical VPS guidance at these limits: ~180 concurrent SSR page loads is the comfort ceiling; scale `WEB_CONCURRENCY` or offload TLS/SSR caching at a proxy beyond that.

---

## CPU Reduction Audit (tree-3 round)

Context: the constrained benchmark showed app CPU is the first bottleneck (~170–186 SSR req/s at 1 CPU). This round hunts CPU specifically. Every ✓ was re-verified by the driver reading the cited code before inclusion.

### High impact

| ID | Candidate | Mechanism (verified) | Fix |
|---|---|---|---|
| CS-1 ✓ | Full content changesets ride the event queue 4–6× per API save | `Model.ts:381` puts `model.previousChangeset` (full old+new content trees) into every event; `Event.ts:90-94` enqueues the whole model → Bull JSON round-trips it through delayed→debounced hops and websocket queue again. O(doc-size)×6 serialize/parse per text save | Keep changeset in DB row for audit; enqueue a stripped copy (scalar diffs only) |
| CS-2 ✓ | `User.findByPk` + team JOIN on **every** authenticated request, uncached | `utils/jwt.ts:61-69`; a token-cache pattern already exists in the rate limiter (`RateLimiter.ts:106-136`, TTL 3600s) | Short-TTL (30–60s) user+team cache keyed by token hash; invalidated on suspend/demote/logout |
| CX-1 ✓ | PlaceholderPlugin does an O(doc) walk + whole-doc string alloc on **every keystroke AND caret move**, ×2 instances | `PlaceholderPlugin.ts:38-40` recomputes on `docChanged \|\| selectionSet`; `:68-76` full descendants walk + `state.doc.textContent` (O(doc) string); mounted in `Doc.ts:27` and `ToggleBlock.ts:337` | Gate Doc instance on near-empty docs; restrict ToggleBlock walk via changedDescendants; replace textContent emptiness check |
| CD-1 ✓ | Search parses every result's ProseMirror doc per query to build snippets | `PostgresSearchProvider.ts:563` calls `DocumentHelper.toPlainText` (= full `Node.fromJSON`) × limit(15) per search; results rows already carry `text` column | Snippet from the loaded `text` column or Postgres `ts_headline`; select id/title/text only |

### Medium impact

| ID | Candidate | Mechanism | Fix |
|---|---|---|---|
| CS-3 ✓ | Every event fanned to websocket queue unfiltered | `worker.ts:63-66` adds to websocketQueue BEFORE the applicableEvents gating all other processors get; WebsocketsProcessor's switch no-ops for many event types | Give it an explicit applicableEvents list |
| CS-4 | No coalescing of documents.update fanout; full document presented per persist | Hocuspocus persists ~every 3s (`collaboration.ts:46-48`) → `presentDocument` incl. full PM tree build + broadcast of entire doc payload each time | Coalesce per documentId (trailing ~5s window) or emit lightweight `{id,updatedAt,title}` metadata refreshes |
| CS-5 ✓ | Revision text task parses doc twice + franc over full text per debounced revision | `DocumentUpdateTextTask.ts:15` parse #1, `toPlainText` inside franc = parse #2; plus RevisionsProcessor deep-isEqual of two trees | Parse once, reuse node; skip franc when language set and delta under threshold |
| CS-6 | Worker logs full event bodies at info with recursive sanitize clone | `worker.ts:45-48,136-138`; Logger deep-clones extras in production (`Logger.ts:189-244`) — compounds CS-1 payloads | Log name+ids at info, demote body to debug |
| CC-4 | Code highlighting cache keyed by absolute position — shifted blocks re-highlight wholesale | `CodeHighlightingPlugin.ts:16,111`; remote transactions trigger full rebuilds | Key by node identity / map through transaction.mapping |
| CX-2 | 3 Suggestion-menu plugins each re-extract cursor context per keystroke via separate setTimeout macrotasks | `SuggestionsMenuPlugin.ts:224-306`; duplicated with InputRules extraction | One shared cursor-context computation + coalesced scheduling |
| CD-2 | Export path-map collision check is O(D²) | `ExportDocumentTreeTask.ts:361-388` materializes all values per doc (`includes` over arrays) | Track used paths in a Set |
| CD-3 | Markdown-zip import scans full manifest per doc + repeated global regex rewrites | `MarkdownAPIImportTask.ts:549-559,69-113` | Single-pass occurrence index; precompile regexes |

### Low impact (cheap wins)

CS-7 compress defaults brotli-q4 on >1KB JSON responses (`web.ts:69`, tune threshold/level) · CS-8 ✓ koa-useragent mounted twice (`web.ts:67` + `routes/api/index.ts`) · CS-9 ✓ rate limiter processes `/_health` probes (`main.ts:71`) · CC-3 useAutoRefresh minute setState re-renders whole route tree (`useAutoRefresh.ts:16-35` — useRef instead) · CC-5 inline-code word decorations rebuilt doc-wide · CC-6 MouseSafeArea unthrottled mousemove setState · CC-7 TOC scroll handler DOM queries at 10Hz · CC-8 Scrollable shadow checks unthrottled · CX-3 kbar action objects rebuilt per render (hot only while palette open) · CC-10 unmemoized LocaleTime (~48 sites).

### Investigated and cleared (no change warranted)

framer-motion domMax is NOT a runtime CPU cost (features execute only when used; downgrade remains bundle-only) · presence/cursor path guarded by no-op mutation checks · useIdle throttled 1s · HoverPreview gated 600ms + TTL cache · FindAndReplace uses Highlight API, scoped · policy abilities cached + memoized per request · helmet/CSRF/passport negligible · css-inline WASM init once/process · zip deflate defaults fine (background) · collaborative persist canonicalization is the correctness mechanism · backlinks parseDocumentIds now debounced + bounded · avatar/image processing happens client-side only · insights rollup is set-based SQL.

**Expected effect:** CS-1+CS-2+CS-3+CS-4+CS-6 remove most background/event-path CPU; CX-1+CC-4+CX-2 raise editor keystroke ceiling on large docs; CD-1 cuts the dominant Node-side cost of search. Together they directly raise the measured 1-CPU SSR/API ceilings from the breaking-point test.

---

## CPU Fixes Implementation

**Shipped:** 21 of 22 audited items across 8 parallel implementation leaves. **Stopped honestly:** CD-1 — the `text` column is deprecated markdown AND stale for collaboratively-edited docs (`documentCollaborativeUpdater` writes with `hooks:false`; only `restoreFromRevision` writes `text`), so switching snippet input would visibly regress search results. Proper fix is a persisted plain-text column (schema migration — future work).

**Verification:** full monorepo suites green before AND after — 362 files / **4,822 tests passed, 0 failed** (+88 new tests written by the leaves covering each fix's semantics: single-parse assertions, cache hit/expiry/LRU/collision, burst→1 broadcast coalescing, decoration recompute counting, path-map equivalence vs naive implementation). `tsc --noEmit` 0 errors, oxlint exit 0.

**Measured on the live Docker stack (interleaved reverse-order A/B):**
- Unauthenticated SSR ladder: parity between pre/post-fix builds — *expected*: those fixes live on the authenticated request path, the event/save pipeline, and in-browser editing, none of which this profile exercises. An initial −10 % reading was investigated and proven to be host-load noise (load average 8.6 during that window), not a regression.
- Exercised server path (`/_health`, rate-limiter skip): post-fix build faster in both rounds (up to +5 % rps, p95 −10 ms).
- The remaining wins are structural: per-save payload stripping (CS-1) scales with document size; the auth cache (CS-2) removes a PG query from every authenticated call; websocket coalescing (CS-4) collapses ~20 full-document broadcasts/min of active editing to ~60; editor fixes (CX-1/CC-4/CC-5/CX-2) cut keystroke-time main-thread work on long documents.

**Notable engineering details:** JWT cache verifies the token signature on every call (the signing secret lives on the user row, so caching before verify is impossible — cache only skips the DB fetch); event-payload stripper preserves every scalar field any consumer reads (enumerated first) while redacting >8 KB values; markdown-import index uses zero-width lookahead alternation to exactly match `String.includes` semantics for overlapping filenames.

---

## Hard-Cap Breaking Point (app: 1 CPU + 500 MB RAM total)

Environment: app container `--cpus=1 --memory=500m --memory-swap=500m` (no swap escape); stores unchanged (1 CPU + 500 MB each). Both builds re-run through the full ladder + pushes.

**Headline: the app does not die — it shrinks and bends.**
- **Zero OOM kills, zero restarts, zero 5xx** through c288 on BOTH builds. Node/V8 reads the cgroup limit and caps its own heap accordingly: peak resident memory was just **~109 MB** (vs ~600 MB when unlimited) — the runtime trades memory headroom for aggressive garbage collection.
- **The cost of surviving is throughput**: the SSR wall drops from ~180 rps (unlimited RAM) to a flat **~110 rps**, because GC cycles eat into the same single CPU. Latency degrades progressively instead of collapsing: p95 crosses 1 s around c96 (vs c128 unlimited).
- **First genuine request failures appear at c288** (client-side timeouts as queueing exceeds 10 s) — i.e., the hard break of this environment is extreme overload only.

**Build comparison under the cap** — the CPU-fixed build wins at every level that matters:

| Level | fixed rps \| p95 | previous rps \| p95 |
|---|---|---|
| c8 | **110.2 \| 204** | 85.3 \| 224 |
| c16 | **110.1 \| 380** | 90.8 \| 401 |
| c32 | **109.1 \| 547** | 94.1 \| 592 |
| c64 | **112.1 \| 770** | 101.8 \| 855 |
| c128 | **111.2 \| 1234** | 108.7 \| 1328 |
| push c224 | **112.3 \| 2269** | 103.5 \| 2867 |
| push c288 | **112.1 \| 5166** (79 timeouts) | 108.2 \| 5478 |

Peak RSS identical (~109 MB both) — the fixes buy speed, not footprint, here because V8 already clamps memory.

**Practical guidance:** on a 500 MB/1-core box expect a comfortable **~110 concurrent page renders**, graceful slowdown beyond, and no crash scenario observed even at 288. If you can spare 768 MB–1 GB instead, the ceiling returns to ~180 rps — memory-to-throughput is roughly linear in this regime because GC pressure is the limiting mechanism.

---

## Viability Assessment — Bun runtime · lightweight DB · lightweight cache/S3

Three code-level audits (runtime couplings, Postgres feature dependencies, Redis/S3 touchpoints), driver-verified. External-facts about Bun/third-party libs are labeled [ext].

### 1) Runtime → Bun: **NO-GO today** (possible after weeks of validation, for bounded gains)

Verified Node couplings that have no Bun-safe path without rework:

| Blocker | Where | Why |
|---|---|---|
| throng process model | server/index.ts:59 ✓ | Entire supervision/fork/revival rides node:cluster [ext: long-standing Bun gap]. Nothing boots as-is. |
| cluster.isWorker semantics | tracer.ts:42, database.ts:77, startup.ts:22 ✓ | Under Bun everything looks like "master": APM silently never enables, statement-timeout defaults change |
| Boot-critical fork+IPC | startup.ts checkPendingMigrations ✓ | Startup blocks on a `fork(..., ipc)` child; NODE_OPTIONS heap flag is V8-only [ext] |
| Memory-cap guard loss | startup.ts `process.constrainedMemory()` ✓ | Node-only API; under container caps, Bun deployments lose exactly the OOM protection our hard-cap test relied on |
| Upgrade multiplexing | websockets.ts:53-54 ✓ | Pop/re-add listener shuffle encodes node:http's exact upgrade contract for socket.io + ws on one port — silent mis-emulation kills realtime rather than crashing |
| jsdom export path | ProsemirrorHelper.toHTML ✓ (kept deliberately) | Full global patching + React SSR + ProseMirror inside jsdom; JSC timing differences risk the effect-flush choreography |
| Sentry/dd-trace | sentry.ts, tracer.ts ✓ | dd-trace is Node-patching (already off by default); @sentry/node unsupported on Bun [ext], swap needed when DSN set |

**Expected gains vs measured profile:** cold start maybe 20–40% faster [speculation — boot is dominated by framework graph, not parse time]; SSR throughput ~parity-or-worse (hot path is string templating, V8's strength); possible idle-RSS improvement under caps but we'd lose the V8 tuning levers this repo actively uses. **Split-runtime option exists** (web on Bun / worker+collab on Node works because queues/pubsub are byte-compatible through Redis) — but collaboration can't move until blockers 1+5 are proven, and it forfeits the shared-process upgrade mux.

### 2) Database → lighter alternative: **NO-GO**

Postgres costs **17–40 MB RAM** in our measurements while the app costs 430–570 MB — replacing it saves <~5% of container memory and negligible CPU. Meanwhile the codebase is deeply entrenched:
- Hardcoded dialect + PG error-code handling + `SET LOCAL` timeout infra (database.ts:41,51,76-84 ✓)
- Search IS Postgres: plpgsql triggers feed tsvector columns; GIN/trgm indexes; ts_rank × popularity ranking; unaccent extension (provider + migrations)
- ~12 runtime raw-SQL sites use advanced PG constructs: UNLOGGED working tables, `FOR UPDATE SKIP LOCKED`, `unnest(ARRAY[]::uuid[])`, DISTINCT ON, DELETE…USING, CTE chains, ON CONFLICT…RETURNING (DocumentInsight.ts:120-222 ✓, UpdateDocumentsPopularityScoreTask, subscriptionCreator hot path)
- ARRAY `@>`/`&&` operators in public API filters; JSONB GIN indexes; read-replica pool wiring
- **300 migration files, 61 with PG-only DDL — history cannot replay on any other engine**; switching means a hand-written baseline schema and abandoning upgrade paths for every existing install

Alternative verdicts: SQLite+FTS5 = XL effort, single-host only, loses stemming/unaccent/timeouts/replicas; PGlite = blocked outright (single-process embedding contradicts the multi-process topology); MySQL/MariaDB = L effort, concurrency-safe, but *negative* resource savings (idles above what PG uses here).

### 3a) Cache/queue (Redis) → lightweight: **CONDITIONAL GO — default all-in-one deployment only**

Redis measures just ~7.5 MB RAM and 246 ops/min idle post-fixes — removal is an **operational-simplicity play, not a resource win**. The inventory found ~20 touchpoints; most are cleanly swappable:
- rate-limiter-flexible ships a memory backend **already imported** at RateLimiter.ts ✓
- CacheHelper already coalesces in-process; MutexLock guards 3 races (in-process mutex suffices merged)
- hocuspocus cross-process sync already optional; presence already in-memory ✓
- The real work: Bull → pg-boss over the existing Postgres [ext] to keep job durability (emails, imports, revisions survive restarts) — or accept losing queued work on restart with an in-memory scheduler

**Hard conditions:** works ONLY in the default shape where all services share one process (Dockerfile CMD default). Breaks silently if WEB_CONCURRENCY>1 or processes are split: per-user rate limits become per-worker, verification codes/OAuth-intent stores stop being shared, websocketQueue (produced in worker ✓, consumed in websockets service ✓) crosses a boundary nothing bridges anymore. Also requires relaxing `REDIS_URL` required-validation and dropping the Redis ping from /_health.

### 3b) S3 → lightweight: **GO (it's already done)**

Nothing to build. The local-disk backend covers every flow end-to-end (uploads incl. fetch-from-URL avatars, HTTP range streaming, import/export file handles, expiry cleanups — verified in plugins/storage). The AWS SDK never loads unless `FILE_STORAGE=s3` (lazy dynamic imports ✓). Only action: self-hosters should set `FILE_STORAGE=local` explicitly (the env default is `s3`). If object storage is genuinely wanted later, MinIO/Garage speak the S3 protocol — same SDK, zero code change.

### Summary table

| Change | Verdict | Effort | Real saving | Main blocker |
|---|---|---|---|---|
| Runtime → Bun | NO-GO (today) | Weeks + risky validation | Cold start only; SSR parity-at-best | cluster/throng, upgrade mux, jsdom exports, lost memory guard |
| DB → SQLite/PGlite/MySQL | NO-GO | XL / blocked / L | <~40 MB RAM (~5%) | Search stack, raw SQL, migrations history, concurrency topology |
| Drop Redis | CONDITIONAL GO | M (pg-boss swap + ~15 files) | One container (~8 MB) + ops simplicity | Only valid all-in-one; durability needs pg-boss |
| Replace S3 | GO (no-op) | Zero — set FILE_STORAGE=local | Already the lightest option | None |
