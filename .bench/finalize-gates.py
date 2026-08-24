import re

GATES = r'''- [x] F-CS1: Strip oversized values from enqueued event payloads (DB rows unchanged); all `.changes` consumers enumerated and proven unaffected.
  EVIDENCE: stripOversizedValues (>8192 chars -> "[stripped]") applied at Event.ts AfterSave (:151,:155) + schedule (:202); WebsocketsProcessor changes-readers verified scalar-only, no client forwarding of stripped trees; DebounceProcessor verified no re-inflation; 5 new stripper unit tests in Event.test.ts.
- [x] F-CS2: Per-process TTL cache for user+team lookup in getUserForJWT; suspension staleness bounded and documented.
  EVIDENCE: jwt.ts Map<sha256(token)>, TTL 30s, LRU 1000; cache AFTER all validations incl. per-call JWT.verify(user.jwtSecret); transfer tokens bypass; failures never cached; 12 new specs green.
- [x] F-CS3: WebsocketsProcessor events gated by explicit derived list.
  EVIDENCE: adapted - processor is not a BaseProcessor, so exactly-derived 60-event list websocketApplicableEvents gates routing at worker.ts:152; dedicated queue + consumption unchanged; unmatched events stay no-ops.
- [x] F-CS4: Coalesce documents.update websocket fanout per documentId.
  EVIDENCE: module-level Map + 1000ms trailing window in WebsocketsProcessor.ts:43-60; latest-wins; archive/delete immediate; Yjs channel untouched; 3-spec coalesce suite green.
- [x] F-CS5: DocumentUpdateTextTask parses PM tree once.
  EVIDENCE: textBetween(node,...) reuses Node.fromJSON output for franc; serializer untouched; new spec asserts single parse (4/4).
- [x] F-CS6: Worker logs event name+ids at info; bodies demoted to debug.
  EVIDENCE: eventLogMeta() {name, documentId?, actorId} worker.ts:93; full events at Logger.debug (:133,:229); failure logs untouched.
- [x] F-CS7: Compression tuned.
  EVIDENCE: web.ts compress({threshold:2048, br:{params:{BROTLI_PARAM_QUALITY:3}}}); option shape verified against installed koa-compress 5.2.2 types.
- [x] F-CS8: Duplicate koa-useragent mount removed.
  EVIDENCE: routes/api/index.ts mount+imports removed (grep there = 0); app-level mount retained.
- [x] F-CS9: Rate limiter skips /_health.
  EVIDENCE: early-return before Redis consume (rateLimiter.ts:66) + spec; live A/B pgprobe c64: cpu24 vs prev +5% rps / p95 -10ms in both interleaved rounds.
- [ ] F-CD1: Search snippets built without per-result ProseMirror parse.
ABANDON: F-CD1 text column is deprecated markdown AND stale for collaboratively-edited docs (multiplayer persist writes hooks:false; only restoreFromRevision writes text) - snippet switch would be a visual regression; needs a persisted plain-text column (schema work) instead. PostgresSearchProvider.ts untouched by design.
- [x] F-CD2: Export path-collision guard O(1) via Set.
  EVIDENCE: parallel Set w/ has/add alongside map writes; caller-preseed covered; 4 new unit tests; 24/24 suite green.
- [x] F-CD3: Markdown import manifest matching single-pass; regexes precompiled.
  EVIDENCE: AttachmentReferenceIndex zero-width-lookahead alternation preserving includes() semantics (overlapping names, empty basenames); pattern cache keyed by pathInZip capped 1000; 58/58 provider-import suite green.
- [x] F-CX1: PlaceholderPlugin gated/restricted.
  EVIDENCE: lazy memoized textContent getter; O(1) canMatch fast-path for Doc instance (WeakMap-memoized); ToggleBlock delta-walk via changedDescendants + tr.mapping + selection-crossing gate; hard-break semantics preserved (textContent sites swapped=1/left=2 with reasons); 10 new tests incl. irrelevant-edit->0 recomputes.
- [x] F-CC4: Code highlighting cache keyed by node identity.
  EVIDENCE: WeakMap<Node,{language,highlighted,decorations}> with relative offsets materialized at current pos; lang-load invalidation via highlighted:false flag; spec proves upstream shift -> 0 highlight calls, edit -> exactly 1.
- [x] F-CC5: CodeWordDecorations single changed-walk.
  EVIDENCE: one bidirectional walker short-circuiting on first marked-text change replaces two-directional lib calls; rebuild conditions unchanged; 7 new tests.
- [x] F-CX2: Suggestion-menu cursor-context checks coalesced to one macrotask per keystroke.
  EVIDENCE: module-level pendingChecks Map + single setTimeout flush, replace-not-stack, ordering preserved, reentrancy guarded, composition path untouched; Suggestion.ts input-rule timer left (distinct mobile/IME path, documented); 6 new tests.
- [x] F-CC3: useAutoRefresh minute counter in ref.
  EVIDENCE: useRef counter; interval/threshold/idle logic identical; routes tree no longer re-renders per tick; new useAutoRefresh.test.tsx (React17 act + reload-path assertion).
- [x] F-CC6: MouseSafeArea mousemove rAF-throttled.
  EVIDENCE: one setState max per frame w/ latest position, pending frame canceled on cleanup; return shape unchanged; zero consumer edits needed.
- [x] F-CC7: TOC scroll spy caches rects + updates state only on slug change.
  EVIDENCE: [headings]-keyed element cache w/ isConnected fallback; functional guarded setScrolledSlug; throttle kept 100ms.
- [x] F-CC8: Scrollable shadow updates rAF-batched + change-gated.
  EVIDENCE: single pending rAF + 100ms trailing settle; scrollTop/scrollHeight/clientHeight change guards; mount-time initial update synchronous.
- [x] F-CC10: LocaleTime memoized.
  EVIDENCE: React.memo export + hook memo keyed incl. minutesMounted so the shared 1-min tick still refreshes visible output; dateFormatLong hoisted.
- [x] F-CX3: useCommandBarActions memoizes registerable array.
  EVIDENCE: useMemo([actions, context]); context identity proven stable via useStableValue in useActionContext (verified); SearchActions churn pre-existing/out of scope, documented.
'''

s = open('GATES.md').read()
for block in GATES.split('\n- '):
    block = block.strip()
    if not block:
        continue
    m = re.match(r'- \[( |x)\] (F-[A-Z0-9]+):', '\n- ' + block if not block.startswith('- ') else block)
    gid = re.search(r'F-(?:CS|CX|CC|CD)[0-9]+', block).group(0)
    # replace the whole gate block from its checkbox line up to next gate or EOF marker
    pat = re.compile(r'- \[ \] ' + re.escape(gid) + r':.*?(?=\n- \[|\n\n## Integration)', re.S)
    if pat.search(s):
        s = pat.sub(block.rstrip(), s, count=1)
    else:
        print('MISS', gid)

open('GATES.md','w').write(s)
print('gates finalized')
