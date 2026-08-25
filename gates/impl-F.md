# Gates: impl-F strip external providers

Scope: all 7 Hook.AuthProvider registrations + provider routers deleted, routes/auth passport stack deleted, passport deps pruned, dead tests removed; non-auth plugin features (slack/github integrations etc.) intact.

- [x] G1: No Hook.AuthProvider registrations remain in plugins/.
  CHECK: grep -rl "Hook.AuthProvider" plugins --include="*.ts" | wc -l
  EXPECT: /^0$/
  EVIDENCE: `0` (email/passkeys/discord plugin dirs deleted whole; google/azure/oidc/slack index.ts rewritten with no AuthProvider hook — verified 2026-08-25)
- [x] G2: Passport strategy packages removed from package.json.
  CHECK: grep -cE '"(@outlinewiki/)?passport' package.json
  EXPECT: /^0$|^1$/   # at most core koa-passport shim if still referenced; target 0
  EVIDENCE: `0`; removed @outlinewiki/koa-passport, @outlinewiki/passport-azure-ad-oauth2, passport, passport-google-oauth2, passport-oauth2, passport-slack-oauth2, @types/passport-oauth2 (grep confirmed zero source imports after deletions); yarn.lock updated via `corepack yarn install` exit 0
- [x] G3: Non-auth plugin features still importable (slack/github/webhooks index files exist).
  CHECK: ls plugins/slack/server/index.ts plugins/github/server/index.ts plugins/webhooks/server/index.ts | wc -l
  EXPECT: /^3$/
  EVIDENCE: `3`; slack Hook.API + Hook.Processor registrations retained; `yarn test plugins/slack/server/api/hooks.test.ts plugins/oidc/server/oidcDiscovery.test.ts` → 2 files / 22 tests passed
- [x] G4: Server typecheck green after removals.
  CHECK: yarn tsc 2>&1 | tail -5
  EXPECT: /error TS/i !present
  EVIDENCE: empty output, exit 0 (`corepack yarn tsc 2>&1 | tail -5` → no "error TS"); also `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → EXIT:0

## Notes / ABANDON lines

- KEPT per preservation rules: server/utils/jwt.ts, User.getSessionToken/getTransferToken/getEmailSigninToken/getCollaborationToken, jwtSecret column, server/middlewares/authentication.ts legacy branch (+ its test), server/utils/passport.ts (pruned to `getTeamFromContext` only — every other export's last importer was a deleted auth router or server/middlewares/passport.ts, each verified by grep before pruning).
- KEPT: plugins/{google,azure}/server/{google,azure,env}.ts and plugins/oidc/server/{oidc,env}.ts — imported by `server/models/AuthenticationProvider.ts` `oauthClient` getter (legacy token validation for pre-existing UserAuthentication rows). Model files are outside this leaf's ownership.
- KEPT: plugins/oidc/server/oidcDiscovery.ts (+test) — standalone util, still compiles and passes.
- ABANDON: none. All planned actions completed.
