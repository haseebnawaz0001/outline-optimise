# Gates: impl-G integration (branch gate)

Scope: merged build is coherent — types, lint, targeted tests, every leaf ledger met.

- [x] G1: Full TypeScript compile passes.
  CHECK: NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
  EXPECT: no "error TS"
  EVIDENCE: Exit 0, empty output on merged tree (run twice: after leaf merge and after setup.ts Logger fix).

- [x] G2: Lint passes.
  CHECK: corepack yarn lint
  EXPECT: exit 0, no errors
  EVIDENCE: LINT_EXIT:0, grep -c "error " = 0; only 2 pre-existing warnings in files untouched by this build (app/hooks/useAutoRefresh.test.tsx, plugins/github/server/github.ts). Fixed the one new offender (console.warn → Logger.warn in server/test/setup.ts).

- [x] G3: Targeted suites green.
  CHECK: corepack yarn test server/middlewares/authentication.test.ts server/auth/better-auth.test.ts server/policies/index.test.ts server/collaboration && corepack yarn test app/scenes/Login app/stores
  EXPECT: /passed/
  EVIDENCE: Server: Test Files 5 passed, Tests 42 passed. Frontend: Test Files 3 passed, Tests 23 passed. Cross-suite interference found and fixed during integration (better-auth.test.ts cleanup hit events_teamId_fkey once authentication tests ran first — cleanup now deletes scoped events rows first).

- [x] G4: All leaf ledgers fully checked.
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs gates GATES.md
  EXPECT: /ALL MET/
  EVIDENCE: gate-check run at integration time reports ALL MET across gates/impl-{A,B,C,D,E,F,G}.md + root ledger (counts in final report).

- [x] G5: Report audit: numbers re-measured, ledgers pasted.
  EVIDENCE: Final report states only re-measured numbers: 42+23 targeted tests, tsc exit 0, lint exit 0/0 errors, Hook.AuthProvider refs = 0, passport deps = 0, non-auth plugin entrypoints present = 3. Adversarial probes: auth.info no longer calls getJWTPayload (grep clean); middleware dispatch order OAuth→ApiKey→legacy JWT→BA-fallback verified by line numbers (authentication.ts:254,298,357,363).
