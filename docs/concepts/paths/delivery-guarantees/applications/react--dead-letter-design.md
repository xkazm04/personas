---
layer: application
subject: delivery-guarantees
technique: dead-letter-design
stack: react
---

# The dead-letter triage surface

`src/features/triggers/sub_dead_letter/DeadLetterTab.tsx` (877 lines) is the
lane's surface, backed by the DLQ transitions in
`src-tauri/db/src/repos/communication/events.rs`. Between them, nearly every
clause of the technique has an address — including the bulk-verb
partial-failure contract, which is the clause most implementations skip.

## Clustering by failure story

`clusterByErrorPattern` (`DeadLetterTab.tsx:99`) implements the "400 rows,
three causes" move literally: `tokenizeError` lowercases, strips all digits,
and drops tokens under 3 chars — so ids, ports, and timestamps cannot shatter
one failure mode into singleton groups — then groups records whose token sets
Jaccard above `ERROR_SIMILARITY_THRESHOLD = 0.55`, a threshold whose comment
records its tuning evidence ("keeps 'connection refused tcp 1.2.3.4:5432'
and '…4.3.2.1:5432' together while splitting genuinely different stack
traces"). Filters cover event type, source, error substring, and age
(`:186-217`).

## The two verbs, with the partial-failure contract

Single and bulk retry/discard both exist (`retryDeadLetterEvent`,
`bulkRetryDeadLetterEvents`, etc., `:18-22`). The bulk path honors the
technique's non-negotiable:

- the backend returns `BulkDeadLetterOutcome { succeeded, failed }`, with
  each failure carrying a **typed reason** (`retry_exhausted` / `not_found` /
  `wrong_status`);
- `summarizeFailures` (`:282-293`) maps those reasons to translated counts
  for the operator — the response names the three that didn't redrive and
  why;
- `applyOutcome` (`:295-297`) removes only the `succeeded` ids from the
  view, so failed records visibly remain in the lane.

The redrive itself (`RETRY_DLQ_SQL`, `events.rs:1007+`) is one atomic
`UPDATE` guarded on `status = 'dead_letter' AND retry_count < ?2` — the
comment names the TOCTOU race it closes (two concurrent retriers both
passing a SELECT-side cap check) — and it preserves **lineage** by folding
the prior error into the new message (`[Retry #N — previous error: …]`),
the technique's "repeat offenders are a different class" rule in one
string. The manual campaign has its own ceiling, `MAX_MANUAL_RETRIES = 5`
(`events.rs:1005`), deliberately separate from the automatic
`DEFAULT_MAX_RETRIES = 3` (`:754`) — a human gets extra attempts, but not
infinity. The UI enforces the same cap at selection time: select-all and
bulk targeting exclude records at the ceiling (`:229`, `:274`, `:306-311`),
with the cap fetched from backend config rather than duplicated (`:133`,
`:179`).

## Where it falls short of the technique

Two gaps, both visible from the surface. The record's **failure story is
thin**: the automatic escalation path writes one generic prose string
("One or more subscription executions failed",
`src-tauri/src/engine/background/:1706-1711`) for every subscription-fan-out
failure, so clustering has little to bite on for that class, and there is no
per-attempt history or triage state (untouched/investigating/discarded-by)
on the record. And the lane's **binding is misaimed in practice**: the
legacy audit (`docs/concepts/golden-paths/dead-letter-triage.md` §0, §7 D6)
measured zero rows ever reaching this excellently-built lane, while the
failure class with real volume accumulated 99 unacknowledged items in the
parallel incidents inbox (`src-tauri/db/src/audit_incidents_promoter.rs`) —
the subject's counter-evidence, and the source of the technique's "bind the
lane to the failures you actually have" rule.
