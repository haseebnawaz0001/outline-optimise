# Gates: Leaf D — DB amplifiers (B10 backlinks debounce, B11 notification batching)

- [x] D1: B10 done — BacklinksProcessor.applicableEvents = documents.publish, documents.update.debounced, documents.delete; handler switch updated (debounced case performs former update work); no other behavior change.
  EVIDENCE: applicableEvents=[publish, debounced, delete]; switch case renamed; body unchanged (BacklinksProcessor.ts:11,61).

- [x] D2: BacklinksProcessor.test.ts updated for new event names and passing.
  EVIDENCE: spec updated + raw-update rejection test; BacklinksProcessor Tests 9 passed (9).

- [x] D3: B11 done — RevisionCreatedNotificationsTask: mention/group-member User lookups batched (findAll IN / joined GroupUser query), per-recipient suppression checks batched into single Notification.findAll + View.findAll IN queries building lookup sets; created notifications byte-identical in fields; email dispatch flow untouched.
  EVIDENCE: 5 query groups -> IN queries incl. joined GroupUser + suppression Sets; payload/ordering identical; email flow untouched.

- [x] D4: RevisionCreatedNotificationsTask.test.ts passing (extend if coverage of batching semantics is missing).
  EVIDENCE: RevisionCreatedNotificationsTask Tests 20 passed (20) incl. 3 new batching-semantics tests.

- [x] D5: Suppression semantics re-read line-by-line vs original: same filters (teamId/documentId/userId/notification types/unread views), same early returns. No edits outside owned files.
  EVIDENCE: Suppression where-clauses re-read line-by-line (only userId->IN swap); edits confined to 4 owned files.
