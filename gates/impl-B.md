# Gates: impl-B signup gate + provisioning bridge

Scope: Sign-up requires AUTH_SIGNUP_KEY; every BA user creation yields exactly one linked Outline user (and first-run Team), legacy emails claim the existing row.

- [x] G1: Provisioning command exists and is invoked from user.create.after hook.
  CHECK: grep -n "provisionBetterAuthUser" server/commands/provisionBetterAuthUser.ts server/auth/better-auth.ts | wc -l
  EXPECT: /^[2-9]$/
  EVIDENCE: Output: `3` (definition + JSDoc'd export in the command, invocation in user.create.after). Also fixed impl-A drift found here: `session.modelName` override to `ba_session` was missing, so migrations had created an unprefixed `session` table while runtime looked for `ba_session`; added the override per contract C7.

- [x] G2: Claim path rewrites incoming id to existing Outline user id by lowercase email.
  CHECK: grep -n "findOne\|users" server/auth/better-auth.ts | grep -i claim
  EXPECT: /claim/i
  EVIDENCE: Output: `158:          // Claim path: an Outline users row already exists for this email`. Hook queries `User.findOne({ where: { email } })` (lowercased), verifies no ba_user via `ctx?.context?.internalAdapter.findUserByEmail(email)` with raw-SQL fallback (`SELECT id FROM ba_user WHERE lower(email) = $1`) through the shared pg pool, then returns `{ data: { ...user, id: existingOutlineUser.id } }`.

- [x] G3: Wrong key → 403; correct key → 200 + session cookie; missing key → 403.
  CHECK: yarn test server/tests-ba/signup.spec.ts 2>/dev/null || yarn test server/auth/better-auth.test.ts
  EXPECT: /passed/
  EVIDENCE: Ran `corepack yarn test server/auth/better-auth.test.ts` (yarn is corepack-only here): `Tests  4 passed (4)` / `Test Files  1 passed (1)`. Covers missing key (env unset) → FORBIDDEN, wrong key → FORBIDDEN, correct key → session token returned + ba_user/ba_account(credential)/Outline User rows. Verified via `auth.api.signUpEmail` (endpoint hooks run without HTTP layer). DB left pristine after each run (verified counts users/teams/ba_user = 0 across two consecutive runs); fresh-install branch (no teams pre-exist) genuinely exercised asserting role admin on a newly provisioned team.

- [x] G4: New Outline user gets defaultUserRole and first user is admin of a fresh Team.
  CHECK: grep -n "defaultUserRole\|UserRole.Admin" server/commands/provisionBetterAuthUser.ts
  EXPECT: /defaultUserRole|UserRole\.Admin/
  EVIDENCE: Output: `91:      role: isFirstUser ? UserRole.Admin : targetTeam.defaultUserRole,`. Behavior asserted by better-auth.test.ts both branches: fresh install → `UserRole.Admin` + new Team; teams exist → joins oldest team with its `defaultUserRole`.
