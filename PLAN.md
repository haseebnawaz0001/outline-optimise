# PLAN: Replace external auth providers with better-auth (email+password only)

Status log appended at bottom; do not rewrite sections above it.

## Scope (user-confirmed)

- Email + password **sign-up** and **sign-in** via better-auth v1.7.x. Nothing else.
- No email verification. Sign-up gated by shared secret `AUTH_SIGNUP_KEY` (long string env var).
- Remove all external provider flows (google, slack, azure, oidc, discord, passkeys, magic-link email).
- Keep: Outline cancan policies, API keys, OAuth AS (/oauth), MCP, shares — untouched.
- Keep: `users`/`teams` Sequelize tables as source of truth; better-auth tables prefixed `ba_`.

## Contracts (binding for every leaf)

**C1 — Identity mapping.** BA config sets
`advanced.database.generateId: () => crypto.randomUUID()`.
`databaseHooks.user.create.before` may rewrite `data.id` to the id of an existing
Outline `users` row with the same email (claim path for legacy users). If it did
not rewrite, `databaseHooks.user.create.after` calls
`server/commands/provisionBetterAuthUser.ts` which creates the matching Outline
user (same id, role = team.defaultUserRole, admin when creating install's first
team) and, when no team exists yet, one Team (self-hosted single-workspace
assumption). No AuthenticationProvider/UserAuthentication rows are ever created.

**C2 — Session resolution.** New module `server/auth/better-auth.ts` exports:
`auth` (betterAuth instance), `getBetterAuthSession(headers: Headers)` returning
the BA session+user or null. `server/middlewares/authentication.ts` keeps the
API-key and OAuth-token branches byte-for-byte; the JWT branch becomes
dual-read: legacy `getUserForJWT` first (grace window — TestServer and existing
cookies depend on it), else BA session mapped to the same
`ctx.state.auth = { user: SequelizeUser, type, token }`. `type` for BA sessions
is `AuthenticationType.APP`.

**C3 — Routes.** BA handler mounted in `server/services/web.ts` BEFORE
`mount("/api", api)` as a path guard on `/api/auth/*` calling
`toNodeHandler(auth)(ctx.req, ctx.res)` (bypasses koa-body). `/auth/*` passport
router deleted in Leaf 6. Logout endpoint (`api/auth.delete`) calls
`auth.api.signOut` when the request carried a BA session cookie, else legacy
rotation. `api/auth.info` stops issuing collaboration tokens (returns `""`),
keeps response shape otherwise. `api/auth.config` returns
`providers: []` + `passwordSigninEnabled: true`, keeping other fields.

**C4 — Signup key.** `hooks.before` middleware matching exactly
`/sign-up/email`: constant-time compare of `body.signupKey` vs
`env.AUTH_SIGNUP_KEY` (sha256 + timingSafeEqual). Missing/mismatched →
APIError FORBIDDEN. In development, unset key defaults to `"dev-signup-key"` so
local flows work. Key stripped from body before proceeding.

**C5 — WebSockets.** Both `server/services/websockets.ts` (socket.io upgrade)
and `server/collaboration/AuthenticationExtension.ts` (hocuspocus) authenticate
by parsing the `ba_session` cookie off request headers via
`getBetterAuthSession` (fallback: legacy JWT during grace). Document ACL checks
(`can(user,"read"/"update",document)`) unchanged. Client-supplied hocuspocus
token ignored.

**C6 — Env & config.** New env vars: `AUTH_SIGNUP_KEY` (required outside
development), optional `BETTER_AUTH_SECRET` (defaults to `SECRET_KEY`),
optional `BETTER_AUTH_URL` (defaults to `URL`). Database access: dedicated
`pg.Pool` using the same connection settings Sequelize uses
(`database.url` / discrete fields — resolved in Leaf 1 from `server/env.ts`).

**C7 — Schema management.** Tables owned by better-auth CLI
(`npx auth@latest migrate --config server/auth/better-auth.ts`) with model
names prefixed `ba_` via `modelName` overrides. Tests create schema
programmatically once in `server/test/setup.ts` via
`getMigrations(auth.options).runMigrations()`.

**C8 — Grace window.** Legacy per-user JWTs remain valid through the whole
build (removal is a post-cutover phase NOT part of this build). All existing
tests must keep passing unmodified except where they test removed provider
routes.

## Leaves

| Leaf | Deliverable | Mode | Depends |
|---|---|---|---|
| impl-A | better-auth installed; `server/auth/better-auth.ts`; Koa mount; ba_ schema tooling; test-schema wiring | parent | — |
| impl-B | signup-key hook + `provisionBetterAuthUser` command + claim path + unit/integration tests | subagent | A |
| impl-C | authentication middleware dual-read; logout; auth.info/config | subagent | A,B |
| impl-D | websocket paths (socket.io + hocuspocus) on C2 helper | subagent | C |
| impl-E | frontend: Login email+password form (+signup key field), AuthStore adjustments | subagent | C3 contract |
| impl-F | delete 7 providers' auth routers + registrations, routes/auth, passport deps; prune dead tests | subagent | C,D,E merged |
| impl-G | integration: full typecheck, lint, targeted suites, all ledgers green | parent | F |

Gates files: `gates/impl-{A..G}.md`. Branch/integration gate = impl-G.

## Risks register

R1 multi-workspace cloud hosting degrades (single-team assumption) — documented,
not fixed this build.
R2 desktop `outline://` transfer-token flow loses its exchange endpoint in
impl-F; desktop falls back to in-app browser session. Accepted.
R3 BA minor-version churn — pin exact version in package.json.
R4 test DB must allow DDL (ba_ migrations in setup.ts) — verified in impl-A.
