# Gates: impl-A better-auth core wiring

Scope: better-auth installed and reachable at /api/auth/* on the Koa app, ba_-prefixed schema creatable, test harness creates it automatically.

- [x] G1: better-auth dependency present at a pinned exact version.
  CHECK: grep '"better-auth"' package.json
  EXPECT: /"better-auth": "1\./
  EVIDENCE: Output: `"better-auth": "1.7.1",` (exact pin; @types/pg added as dev dep).

- [x] G2: Auth instance module exists exporting auth + getBetterAuthSession, uses pg Pool against the same DB settings as Sequelize, emailAndPassword enabled, generateId UUID, modelName prefixes ba_.
  CHECK: grep -nE "emailAndPassword|ba_|randomUUID|new Pool" server/auth/better-auth.ts | wc -l
  EXPECT: /^([4-9]|[1-9][0-9])$/
  EVIDENCE: grep count = 6 (emailAndPassword.enabled, ba_user/ba_account/ba_verification modelNames, crypto.randomUUID generateId, new Pool from DATABASE_URL/discrete env fields).

- [x] G3: Signup-key hook present in config matching /sign-up/email with timing-safe compare (impl-B owns behavior tests; A owns presence).
  CHECK: grep -c "sign-up/email" server/auth/better-auth.ts
  EXPECT: /^[1-9]$/
  EVIDENCE: Line 99 `if (ctx.path !== "/sign-up/email")` inside hooks.before; sha256+timingSafeEqual in isValidSignupKey; dev fallback DevSignupKey.

- [x] G4: Koa app serves BA endpoints before the API mount.
  CHECK: grep -n "api/auth" server/services/web.ts
  EXPECT: /toNodeHandler|betterAuth/
  EVIDENCE: web.ts:28-44 `betterAuthHandler()` guard on `/api/auth/*` calling `authHandler(ctx.req, ctx.res)` (toNodeHandler), inserted before `mount("/api", api)` at the mount block.

- [x] G5: TypeScript compiles for touched projects.
  CHECK: NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
  EXPECT: no "error TS"
  EVIDENCE: Full-monorepo run exited clean after fixes (@types/pg, UserRole.Admin import, Logger.error signature, dropped nonexistent emailVerified column). Final output empty.

- [x] G6: Test setup creates BA schema once without failing the suite bootstrap.
  CHECK: grep -n "getMigrations" server/test/setup.ts
  EXPECT: /runMigrations/
  EVIDENCE: setup.ts:55-58 runs getMigrations(auth.options).runMigrations() once per worker, non-fatal try/catch with warning.
