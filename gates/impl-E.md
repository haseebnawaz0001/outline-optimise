# Gates: impl-E frontend email+password

Scope: Login scene renders an email+password sign-in form and a sign-up form with signupKey field against better-auth endpoints; provider buttons removed; AuthStore adjusted minimally.

- [x] G1: No component renders config.providers buttons anymore (Login.tsx + AuthenticationProvider.tsx removed or repurposed).
  CHECK: grep -rn "config.providers.map\|providers.map" app/scenes/Login | wc -l
  EXPECT: /^0$/
  EVIDENCE: `grep -rn "config.providers.map\|providers.map" app/scenes/Login | wc -l` → `0`. Login.tsx rewritten (email+password forms, provider list/oidc auto-redirect deleted); components/AuthenticationProvider.tsx and components/PasskeyAuthenticationProvider.tsx deleted.
- [x] G2: Sign-in posts to /api/auth/sign-in/email and sign-up to /api/auth/sign-up/email including signupKey.
  CHECK: grep -rn "sign-up/email\|sign-in/email" app | head
  EXPECT: /sign-up\/email/
  EVIDENCE: `app/scenes/Login/Login.tsx:166: void handleSubmitAuth("/api/auth/sign-in/email"` and `app/scenes/Login/Login.tsx:175: void handleSubmitAuth("/api/auth/sign-up/email"`; sign-up body includes `signupKey` (Login.tsx handleSignUp).
- [x] G3: AuthStore handles auth.config response without providers array crashing (passwordSigninEnabled consumed).
  CHECK: grep -n "passwordSigninEnabled" app/stores/AuthStore.ts
  EXPECT: /passwordSigninEnabled/
  EVIDENCE: `44:  passwordSigninEnabled?: boolean;` (Config type, providers now optional), `94:  public passwordSigninEnabled?: boolean;` (observable), `212:    this.passwordSigninEnabled = res.data.passwordSigninEnabled !== false;` (fetchConfig). shared/types.ts has no auth.config shape — no change needed there.
- [x] G4: App typechecks and relevant frontend tests/lint pass.
  CHECK: NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit && corepack yarn lint app/scenes/Login app/stores/AuthStore.ts
  EXPECT: exit 0
  EVIDENCE: `npx tsc --noEmit` → exit 0, zero errors repo-wide. `corepack yarn lint app/scenes/Login app/stores/AuthStore.ts` (repo-wide oxlint run; path args don't scope it) → exit 1 caused ONLY by `server/test/setup.ts:61 no-console` (another leaf's file). Scoped lint of owned files: `npx oxlint app/scenes/Login app/stores/AuthStore.ts shared/types.ts` → exit 0, zero findings. Tests: `corepack yarn test app/scenes/Login` → 2 files / 16 tests passed (urls.test.ts, OAuthScopeHelper.test.ts); `corepack yarn test app/stores` → 1 file / 7 tests passed (StorePersistence.test.ts).
