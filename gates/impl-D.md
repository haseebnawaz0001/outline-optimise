# Gates: impl-D websocket session auth

Scope: socket.io upgrade auth and hocuspocus onAuthenticate resolve better-auth sessions from request headers (legacy JWT fallback intact); document ACL checks unchanged.

- [x] G1: websockets.ts authenticates via getBetterAuthSession (headers) with legacy fallback.
  CHECK: grep -n "getBetterAuthSession\|getUserForJWT" server/services/websockets.ts
  EXPECT: /getBetterAuthSession/
  EVIDENCE: `9:import { getBetterAuthSession } from "@server/auth/better-auth";` / `248:  const session = await getBetterAuthSession(` (Headers built from socket.request.rawHeaders) / legacy fallback intact: `20:import { getUserForJWT } from "@server/utils/jwt";` `271:  const { user } = await getUserForJWT(accessToken);`. 1s auth timeout, room joining, origin checks untouched.
- [x] G2: AuthenticationExtension.onAuthenticate resolves BA session from connection request headers; ignores client token; keeps can(read/update) logic.
  CHECK: grep -n "getBetterAuthSession" server/collaboration/AuthenticationExtension.ts
  EXPECT: /getBetterAuthSession/
  EVIDENCE: `13:import { getBetterAuthSession } from "@server/auth/better-auth";` / `276:    const session = await getBetterAuthSession(` built from payload.requestHeaders (hocuspocus passes upgrade headers there; payload.connection is only a ConnectionConfiguration without request). Client token ignored when BA session resolves; grace fallback `128:      user = (await getUserForJWT(token, ["session", "collaboration"])).user;`. can(read)/can(update) and Redis invalidation pub/sub unchanged.
- [x] G3: Existing collaboration/socket tests still pass.
  CHECK: corepack yarn test server/collaboration server/services 2>&1 | tail -4
  EXPECT: /passed|No test files|skipped/ with zero failures
  EVIDENCE: `Test Files  2 passed (2)` / `Tests  13 passed (13)` — the two files are server/collaboration/AuthenticationExtension.test.ts and ConnectionLimitExtension.test.ts. No spec exists under server/services (and none anywhere for websockets.ts upgrade auth), so no coverage of that file is claimed.
- [x] G4: Repo typecheck stays clean.
  CHECK: NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
  EXPECT: no new errors
  EVIDENCE: exit code 0, no output after fixes (first run had 1 error in AuthenticationExtension.ts due to using connection.request; resolved by switching to payload.requestHeaders).
