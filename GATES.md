# Gates: better-auth migration build (integration ledger)

Task: Implement better-auth email+password auth replacing all external providers per PLAN.md contracts. Leaf ledgers live in gates/impl-{A..G}.md; this file tracks the branch/integration outcome only.

- [x] G1: All leaf ledgers met (A,B,C,D,E,F,G).
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs gates GATES.md
  EXPECT: /ALL MET/
  EVIDENCE: ALL MET — 7/7 impl-A..G plus this file (exact counts pasted in final report).

- [x] G2: Full typecheck green on merged tree.
  CHECK: NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
  EXPECT: no "error TS"
  EVIDENCE: Exit 0, no output.

- [x] G3: Targeted test suites pass.
  CHECK: corepack yarn test server/middlewares/authentication.test.ts server/auth/better-auth.test.ts server/policies/index.test.ts server/collaboration
  EXPECT: /passed/
  EVIDENCE: Test Files 5 passed, Tests 42 passed (server); app/scenes/Login + app/stores: Test Files 3 passed, Tests 23 passed. Includes new BA suites: signup-key gate, provisioning/claim path, BA-session middleware auth.

- [x] G4: No external provider sign-in path remains reachable.
  CHECK: grep -rl "Hook.AuthProvider" plugins --include="*.ts" | wc -l
  EXPECT: /^0$/
  EVIDENCE: Output `0`. Also passport deps in package.json = 0; routes/auth deleted; mount("/auth") removed from web.ts.

- [x] G5: Report audit passed.
  EVIDENCE: All numbers in the final report re-measured via the commands above this session; ledger pasted verbatim; adversarial probes on auth.info JWT-decode removal and middleware dispatch order both passed (evidence in gates/impl-G.md G5).

- [x] G6: Deployability — better-auth schema is applied by the standard pre-boot migration check (no compose changes).
  CHECK: grep -n "ensureBetterAuthSchema" server/scripts/checkMigrations.ts server/auth/migrate.ts | wc -l
  EXPECT: /^([2-9])$/
  EVIDENCE: grep count = 2 (call site in checkMigrations.ts under existing MutexLock("migrations"); implementation in server/auth/migrate.ts). tsc exit 0. .env.sample documents AUTH_SIGNUP_KEY.

- [x] G7: Image builds and smoke-passes.
  EVIDENCE: `bash deploy/build.sh` → outline-optimized:local built (base + runtime, no errors). Smoke on fresh postgres:16 + redis containers from the image: /_health "OK"; logs show sequelize migrations then `Applying better-auth schema (4 tables, 0 changes)`; pg_tables lists ba_account/ba_session/ba_user/ba_verification; wrong signupKey → HTTP 403; correct key → HTTP 200 + Set-Cookie better-auth.session_token; sign-in → 200; users.id = ba_user.id (uuid cast check) with role=admin; POST /api/auth.info with only the BA session cookie returns the provisioned Outline user. Containers/network torn down after.
