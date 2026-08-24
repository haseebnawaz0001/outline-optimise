# Gates: Leaf E — server efficiency (B12 worker cap, B14 view cadence, A14 search shouldQueue)

- [x] E1: B12 done — server/index.ts caps the DEFAULT process count at 4 when WEB_CONCURRENCY is unset (const DEFAULT_MAX_WEB_PROCESSES = 4; Math.min(os.cpus().length, cap) applied consistently in both `processCount` and throng `count` for the web path); explicit WEB_CONCURRENCY always honored; collaboration force-1 logic untouched.
  EVIDENCE: DEFAULT_MAX_WEB_PROCESSES=4 defined once, used at index.ts:54 and :68; explicit env wins; force-1 untouched; comment updated. Image bundle contains cap (grep 4 refs).

- [x] E2: B14 done — ViewsExtension view-touch threshold raised from 1 minute to 5 minutes (named constant preferred), comment updated if present. Do NOT touch server/env.ts (B13 default is driver's edit).
  EVIDENCE: VIEW_TOUCH_INTERVAL_MS = 5 * Minute.ms at ViewsExtension.ts:12 used at :41; env.ts untouched by leaf.

- [x] E3: A14 done — SearchIndexProcessor gains static async shouldQueue returning false when the active search provider is postgres (mirror perform()'s gate; prefer env.SEARCH_PROVIDER !== "postgres" without calling getProvider() to avoid pre-enqueue throws on misconfiguration).
  EVIDENCE: static async shouldQueue returns env.SEARCH_PROVIDER !== 'postgres' (SearchIndexProcessor.ts:46); perform() intact.

- [x] E4: SearchIndexProcessor.test.ts extended to cover shouldQueue under both providers and passing via targeted vitest run.
  EVIDENCE: SearchIndexProcessor.test.ts extended; targeted run 'Tests 5 passed (5)'; corroborated green in full suite.

- [x] E5: No edits outside owned files.
  EVIDENCE: git scope limited to 4 owned files (leaf git status evidence); tsc delta 0.
