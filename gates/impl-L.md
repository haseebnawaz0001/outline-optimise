# Gates: Leaf L — lazy tech (C5 SDK lazification, C1 linkedom swap)

- [x] L1: C5 done — plugins/gitlab/server/gitlab.ts (@gitbeaker/rest Gitlab), plugins/linear/server/linear.ts (@linear/sdk LinearClient), plugins/github/server/github.ts + GitHubIssueProvider (octokit family), plugins/notion/server/notion.ts (+NotionConverter if value-imported) load SDKs via dynamic import() inside methods on first use; exported signatures preserved; type-only imports stay top-level.
  EVIDENCE: All four SDKs dynamic-imported lazily; GitHubIssueProvider/NotionConverter verified type-only; top-level value-import greps all 0.

- [x] L2: Memoization pattern used where an SDK client is constructed per-integration (avoid repeated dynamic imports per request); failure path unchanged.
  EVIDENCE: Memoized module-promise pattern per plugin (GitLab.gitbeaker, Linear.linearSdk, loadOctokitModules, NotionClient.sdk); appOctokit instance memoized; failure paths unchanged.

- [ ] L3: C1 done — ProsemirrorHelper.tsx (~line 626 area), DocumentHelper.tsx (~493), DocumentConverter.ts (~111) parse HTML via linkedom parseHTML instead of jsdom JSDOM; surrounding function signatures unchanged unless structurally required; read each site's full context incl. comment about MessageChannel quirks before editing.
ABANDON: L3 ProsemirrorHelper.toHTML kept on jsdom after linkedom attribute-order serialization broke exact output parity (91/92 tests); changing shared/editor toDOM specs out of scope. DocumentConverter + DocumentHelper converted; root gate G16 carries matching ABANDON.

- [x] L4: Targeted vitest run passes for affected specs (ProsemirrorHelper/DocumentHelper/converter-related tests located via grep); any behavioral diff documented honestly.
  EVIDENCE: 9 affected spec files: Test Files 9 passed (9), Tests 225 passed (225) verbatim in leaf report; revisions.test.ts 21 passed.

- [x] L5: No edits outside owned files; package.json untouched (driver manages deps).
  EVIDENCE: Edits confined to 7 owned files; package.json untouched by leaf (driver managed deps).
