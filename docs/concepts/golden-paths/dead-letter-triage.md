# Dead-letter triage

> Situation node: `ai-agents / human-review / dead-letter-triage` ·
> [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 2` · `risk: high` · `convergence: "converged"`.
> Dimensions: **ui · function · resilience**.
> Spine `why`: *"Clustering terminally failed events by failure mode and
> retrying or discarding."*
>
> **Full contract** (Mode 2 tiering: `risk: high`).
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. Sweep:
> `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx` (877 lines),
> `src-tauri/db/src/repos/communication/events.rs` (the DLQ transitions),
> `src-tauri/core/src/models/event.rs` (the status machine),
> `src-tauri/db/src/audit_incidents_promoter.rs` (446 lines, 7 promoters),
> `src-tauri/db/src/repos/execution/audit_incidents.rs`,
> `src/features/overview/sub_incidents/**` (2,323 lines incl. `DESIGN.md`),
> `src/features/overview/sub_incidents/libs/groupIncidents.ts`,
> the 8 direct `audit_incidents::promote` call sites in `src-tauri/src/**`,
> `src-tauri/src/engine/background.rs` (the stuck-event reaper), and
> `src-tauri/src/engine/mod.rs:2955-3060` (the execution-failure escalation),
> plus row counts replayed against the 2026-08-17 purge backup.
>
> **⚠ Every row count below is historical as of 2026-08-17 and
> unreproducible.** Counts come from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`
> (347,054,080 B), **not** from the emptied live file. Where the live file was
> also read, it is named.

---

## §0 — Headline

**This repo built the leaf's canonical answer, and it is excellent, and nothing
has ever been in it. Meanwhile the queue that failures actually reach has 99
open items, the oldest 74 days old, and not one of them has ever been
acknowledged by anybody.**

The two queues, measured against the same database on the same day:

| | the DLQ (`persona_events.status = 'dead_letter'`) | the incidents inbox (`audit_incidents`) |
| --- | --- | --- |
| rows, ever | **0** | 164 |
| open now | 0 | **99** |
| ever acknowledged | — | **0 of 164** (`acknowledged_at IS NULL` on all) |
| oldest open item | — | **74 days** |
| clusters by failure mode | **yes** — Jaccard 0.55 over tokenized `error_message`, id/port/timestamp-stripped | **no** — group-by is agent / severity / source / none |
| retry | **yes**, single + bulk, with a per-item typed failure reason | **no** |
| discard | **yes**, single + bulk | dismiss |
| UI | 877 lines | 682 lines |

`persona_events` holds **4,972** rows. **4,941 `delivered`, 31 `skipped`, 0
`failed`, 0 `dead_letter`, 0 `discarded`**, and `retry_count = 0` on **4,972 of
4,972**. The dead-letter path has not merely been quiet — the *retry counter it
is downstream of* has never incremented once in the history of this install.

So the brief's discriminator resolves cleanly, and the answer is *both, in
different places*:

> **A dead-letter queue nobody drains is a different defect from one nothing
> writes to.** This repo has one of each. The DLQ is the *nothing-writes-to-it*
> case (0 rows, because event delivery has never failed). The incidents inbox is
> the *nobody-drains-it* case (99 open, 0 acknowledged, 74 days).

And between the two sits the failure class with all the volume, which reaches
neither properly:

| terminal failure | rows | reaches a human-visible surface? |
| --- | ---: | --- |
| execution failed | **238** | partially — 63 became incidents (26.5%) |
| healing issue opened | 205 (**179 open**) | yes, `HealingIssuesPanel` |
| tool call errored | **0 rows since the table was created 2026-03-12** | no |
| credential operation failed | 0 of 9,830 rows match the promoter's own predicate | **no, and never can** — §7 D3 |
| provider failover | 0 of 4,001 (`was_failover = 0` on every row) | no |
| policy drop | 5 | no (env-gated) |
| healing audit error | 0 of 1 (the one row is `ai_heal_parse_failed`; the predicate is `ends_with("_error")`) | **no, by one character** |
| event delivery exhausted retries | **0** | n/a |
| frontend crash | 84 | yes, `CrashLogsSection` |

**Seven of the app's promotion doors are behind an environment variable that is
set nowhere in the repository.** `PERSONAS_INCIDENTS_PROMOTION` appears in 21
places across the tree — a `pub const`, one comparison, seven doc comments, four
golden paths and a `DESIGN.md` — and in **zero** places that set it. Every one
of the 164 incidents that exist came in through the other eight doors, which are
not gated.

---

## §1 — Trigger

1. "What happens when this fails for the last time?"
2. "Where do the events that couldn't be delivered go?"
3. "Give the user a Retry button for the failed ones."
4. "We should group these errors — there are hundreds and they're all the same
   three problems."
5. "Add an incidents / alerts / issues inbox."
6. **The if-you-are-about-to-write-X test:** you are about to write
   `tracing::error!(…)` or `.catch(silentCatch(…))` on a path where **there is
   no next attempt**, or a `match … { Err(e) => { log; return; } }` at the end of
   a retry loop.

Adjacent and distinct: retry *policy* is
[`retry-with-backoff`](./retry-with-backoff.md); which class a failure belongs to
is [`failure-recovery-strategy`](./failure-recovery-strategy.md); a queue
awaiting a human *decision* rather than a human *diagnosis* is
[`human-review-queue`](./human-review-queue.md) and
[`findings-triage-queue`](./findings-triage-queue.md); a caught error that
should have been logged at all is
[`swallowed-error-telemetry`](./swallowed-error-telemetry.md).

---

## §2 — The one way

**Every terminal failure lands in exactly one queue, carries the machine token
that says what kind of failure it was, and that token is what the triage surface
groups by — then the queue is drained by an act that is the same act as fixing
the thing, and its depth is on a screen somebody looks at.** Concretely, in this
order:

(a) **Decide "terminal" explicitly and write it in the status machine.** A
failure is terminal when the producing code will not try again. Model that as a
distinct state, not as "failed and we stopped caring":
`PersonaEventStatus::{Failed, DeadLetter, Discarded}`
(`core/src/models/event.rs:16-23`) is the shape — `Failed` is retryable,
`DeadLetter` is terminal-but-actionable, `Discarded` is terminal-and-decided.
Three states, and the transition into the terminal one is a single SQL statement
that also carries the reason
(`increment_retry_or_dead_letter`, `events.rs:974`).

(b) **Give the failure a closed category at the moment it is produced, by the
code that produced it — never by reading words out of a message.** The category
is the grouping key, the routing key and the retry-eligibility key, and all
three are wrong if it is derived downstream from prose. This is
[`failure-recovery-strategy`](./failure-recovery-strategy.md)'s prescription and
it is a precondition for everything below.

(c) **Route on the token with an exact match against a closed set, never a
substring.** `op.contains("failure") || op.contains("error")` is not a router,
it is a guess about someone else's vocabulary — measured here at **0 matches
across 9,830 rows** because the vocabulary is `decrypt`,
`oauth_token_refreshed`, `healthcheck`, `delete`, `create`. If you cannot
enumerate the values, you do not have a token, and (b) is not done.

(d) **One queue per failure *audience*, not one per producer.** The user asking
"what is broken?" must not have to know that a failed tool call, a failed
credential decrypt and a failed run live in three tables. Promote into one
inbox, keyed by a `dedup_key` the producer computes
(`make_dedup_key(source_table, source_id)`, `audit_incidents.rs:69-71`) so
promotion is idempotent under retry.

(e) **Cluster the queue by the failure token first, and offer every other lens
second.** The spine's word is *"clustering … by failure mode"*, and the failure
mode is the category from (b) — not the persona, not the severity, not the
source table. Where the token is absent and only free text exists, cluster by
normalized similarity, which is what `clusterByErrorPattern`
(`DeadLetterTab.tsx:99-126`) does: strip digits, drop tokens under 3 chars,
Jaccard at 0.55, largest group first. That function is the fallback; the token
is the primary.

(f) **Give every cluster the two verbs and nothing else: retry, or discard.**
Both in bulk, both scoped to the cluster, both returning a **per-item** outcome
— not a boolean and not a count. `BulkDeadLetterOutcome { succeeded[], failed[
{ id, reason } ] }` is the shape, and rendering it as *"3 retry-exhausted, 1 not
found"* (`DeadLetterTab.tsx:282-293`) is what makes a bulk action honest.

(g) **Never gate admission on the environment.** A queue whose *depth* is a
property of the machine's env vars rather than of the product cannot be reasoned
about, cannot be tested, and reads as empty when it is off. If a promotion path
needs a bake-in period, gate it on a **persisted app setting with a UI**, so
the state is inspectable and one place answers "is this on?".

(h) **Give the queue an owner, a drain rate and an ageing policy, and put its
depth where somebody sees it.** *"99 open, oldest 74 days, 0 ever
acknowledged"* is not a queue, it is a log with buttons. Decide up front: what
does an item nobody touches become, and after how long? See
[`findings-triage-queue`](./findings-triage-queue.md) §2 — this leaf's queue is
one of the thirteen that path counted.

If you can only afford part of this, take (a)+(f): a named terminal state and
the two verbs. A queue you can drain but not cluster is annoying; a cluster you
cannot drain is decoration.

---

## §3 — Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `PersonaEventStatus` (`core/src/models/event.rs:16-33`) | The status machine, with the lifecycle written as a doc comment above the enum: `Pending → Processing → Delivered/Completed/Skipped/Failed`, `Failed → DeadLetter` (retries exhausted) or back to `Pending`, `DeadLetter → Pending` (manual retry) or `Discarded`. Terminal states are enum variants, not conventions. |
| `events::increment_retry_or_dead_letter` (`repos/communication/events.rs:974`) | The transition into the DLQ as ONE statement: `status = CASE WHEN retry_count + 1 >= ?1 THEN 'dead_letter' ELSE 'pending' END`. No read-modify-write, no race. |
| `events::move_to_dead_letter` / `dead_letter_from_processing` (`:839`, `:885`) | Guarded transitions. `move_to_dead_letter` **requires `status = 'failed'`** and returns an `Invalid event status transition` error otherwise (`:863`) — the state machine is enforced at the write, not documented at the type. |
| `events::retry_dead_letter` / `discard_dead_letter` (`:1005-1027`) | The two verbs, each scoped by `AND status = 'dead_letter'` so a concurrent change cannot be clobbered. Shared verbatim with the bulk variants — one predicate, two entry points. |
| `DeadLetterTab.tsx` — `clusterByErrorPattern`, `tokenizeError`, `jaccard` | Failure-mode clustering when only free text exists. Threshold 0.55, tuned against real data with the tuning rationale in the comment (`:60-65`). |
| `BulkDeadLetterOutcome` / `BulkDeadLetterFailure` (ts-rs) | Per-item bulk result: which ids succeeded, and for each failure a machine `reason` the client maps to a translated label (`:282-293`). |
| `audit_incidents::promote` (`repos/execution/audit_incidents.rs:150`) | Idempotent admission via `INSERT OR IGNORE` against `dedup_key UNIQUE`. Returns `Ok(None)` on a duplicate — a safe no-op on every retry. |
| `audit_incidents::make_dedup_key` (`:69-71`) | The single source of truth for the dedup key shape (`{source_table}:{source_id}`). Callers must not recompute it. |
| `groupIncidents` (`sub_incidents/libs/groupIncidents.ts`) | Grouping with worst-severity-first ordering, volume tiebreak, and a sentinel bucket that always sinks. The mechanism is right; its lens list is missing the failure mode (§7 D5). |
| `background.rs` stuck-event reaper (`:1119-1151`) | The producer of last resort: events stranded in `processing` are reclaimed, redelivered or dead-lettered, and the summary is logged at **WARN, not INFO**, with the reason written down (`:1143-1145`) — *"a non-zero count means ticks are dying between claiming an event and writing its outcome"*. |

---

## §4 — Steps

1. **Write the terminal state into the status enum before you write the failure
   path.** If your failure has no name in a closed type, stop — you are about to
   build (c)'s substring router.

2. **Make the transition into it a single guarded statement**, predicated on the
   state you expect to be leaving. Copy `move_to_dead_letter`'s refusal.

3. **Compute the dedup key at the producer** and promote through the one door.
   Never `INSERT` into the inbox directly and never recompute the key shape.

4. **Decide the admission predicate from the enum, not from the message.**
   Write it as `matches!(x.category, A | B)`. If you find yourself reaching for
   `.contains(`, go back to step 1.

5. **Ask whether the type can make the un-triaged failure unspellable** — §9.
   For this leaf the answer is a `#[non_exhaustive]`-free closed enum plus an
   exhaustive `match` at the promotion site, so a new failure category cannot
   compile without someone deciding whether a human sees it.

6. **Wire the queue's depth into the one rollup** the app already has
   (`pending_counts`), or it is invisible by construction — see
   [`findings-triage-queue`](./findings-triage-queue.md), which measured **314
   of 370 pending items sitting in queues nobody registered**.

7. **Build the triage surface as cluster → select cluster → two verbs**, in that
   order. The cluster is the unit of work; a per-row inbox over 99 items is why
   0 of 164 were ever acknowledged.

8. **And then stop.** `promote` is idempotent, `retry_dead_letter` is
   status-scoped, and the bulk variants reuse the single-item SQL. There is no
   per-caller retry bookkeeping to write, no dedupe to hand-roll, and no
   "already promoted?" check to add.

---

## §5 — Anti-patterns

- **Gating admission on an env var.** `PERSONAS_INCIDENTS_PROMOTION=1`, unset
  everywhere. The failure mode is the worst available: the queue renders
  **empty**, which is indistinguishable from healthy. Seven promoters,
  0 rows, ever.

- **Routing a machine token by substring.** `op.contains("failure") ||
  op.contains("error") || op.contains("denied")` over an `operation` column
  whose entire live vocabulary is `decrypt`, `oauth_token_refreshed`,
  `healthcheck`, `delete`, `create`, `oauth_completed`, `oauth_initiated`,
  `update`, `field_update`, `credential_oauth_refreshed`. **0 of 9,830.** The
  words were chosen before the vocabulary was read — the doctrine's *"derive the
  word list from the tree"*, from the predicate side.

- **A suffix convention nobody enforces.** `kind.ends_with("_error")` against a
  producer that writes `ai_heal_parse_failed`. One row, one character, zero
  promotions. A convention that is not a type is not a convention.

- **Grouping by the producer instead of by the failure.** `source_table` answers
  *"which subsystem noticed?"*. The user is asking *"what is wrong?"*. The
  column that answers that (`kind`, 8 distinct values here) is stored, indexed
  by nothing, and offered as no lens.

- **A queue with an acknowledge action and no drain rate.** 164 rows, 0
  acknowledged. The action exists, has a keyboard shortcut
  (`IncidentsInbox.tsx:347`) and an a11y announcement. Nobody has ever used it,
  and nothing in the product notices that.

- **Best-effort recording whose own failure is discarded.** `let _ =
  audit_incidents::promote(…)` at 3 of the 8 direct sites. Best-effort is the
  right *posture* — a promotion failure must never fail the parent write — but
  `try_promote` (`audit_incidents_promoter.rs:48-69`) shows the right *shape*:
  swallow the error, keep the warn. `let _ =` discards both.

- **Two inboxes for one question.** A user with a failing agent must check
  Activity (238 failed runs), the Healing panel (179 open issues), the Incidents
  inbox (99 open) and the Dead-letter tab (0). Four surfaces, four empty-states,
  one question.

- **Deriving "is this actionable?" from severity when severity is derived from
  the message.** `normalize_severity` (`audit_incidents.rs:47-65`) maps *any
  string containing `error` or `fail`* to `high`. Combined with the substring
  routers above, a failure's rank in the queue can be decided entirely by
  English words in text a model wrote.

---

## §6 — Evidence

**Copy this one:** `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx`.
It is the best implementation of this leaf in the repository and — measured
below — in the cohort. Specifically:

- `tokenizeError` + `jaccard` + `clusterByErrorPattern` (`:66-126`): clustering
  that survives volatile ids, ports and timestamps, with the threshold's tuning
  rationale written down and a real worked example in the comment (two
  `connection refused` errors with different IPs stay together; different stack
  traces split).
- `selectGroup` (`:270-279`): the cluster is the selection unit, which is the
  whole ergonomic difference between draining a queue and reading one.
- `summarizeFailures` (`:282-293`): a bulk outcome rendered as *counts per
  machine reason*, each mapped through i18n. Not "3 failed".
- The retry cap is read from the server (`get_dead_letter_config`) with a
  client fallback constant, so the button's disabled state and the server's
  refusal cannot disagree by construction.

**Second, for the server half:** `repos/communication/events.rs:839-1027`. Read
`move_to_dead_letter` (guarded on `status = 'failed'`, errors on an illegal
transition), `increment_retry_or_dead_letter` (the whole retry-or-terminate
decision as one `CASE WHEN` inside one `UPDATE`), and the shared
`retry_dead_letter` / `discard_dead_letter` predicates. The state machine is
enforced in SQL, once, and the bulk paths cannot drift from the single paths
because they execute the same string.

**Third, for admission:** `audit_incidents::promote` +
`make_dedup_key` (`:69-71`, `:150`). `INSERT OR IGNORE` against a `UNIQUE`
constraint is the correct idempotency primitive here, and the module comment
states the contract that makes it safe (*"callers must compute it
consistently"*) — then removes the temptation by exporting the function that
computes it.

**Fourth, for the producer of last resort:** `background.rs:1119-1151`. Note the
three-way outcome (`Redelivered` / `DeadLettered` / raced-and-therefore-fine),
that the race is *not* treated as an error with the reason written down, and
that the summary logs at WARN with an explanation of what a non-zero count
means. This is what "the failure lands somewhere a human can see" looks like on
a background path.

---

## §7 — Deviations

### D1 · Seven promotion doors are behind an env var set nowhere; 77 qualifying rows never reached the inbox — P0

`audit_incidents_promoter.rs:43-45`: `fn enabled()` returns
`std::env::var("PERSONAS_INCIDENTS_PROMOTION").ok().as_deref() == Some("1")`,
and all seven promoters return immediately when it is false. A tree-wide search
finds the name in 21 locations: the `pub const`, the one comparison, seven
"No-op unless…" comments on the calling repos, four golden-path documents, a
`DESIGN.md` and a 2026-06-09 audit that already reported this
(`docs/harness/audit-2026-06-09/bug__reviews-incidents-audit.md:50`). **Zero of
the 21 set it.**

Replaying each promoter's own predicate against its own source table
*(backup)*:

| promoter | predicate | qualifying rows | in the inbox |
| --- | --- | ---: | ---: |
| `promote_fired_alert` | every row | 0 (table empty) | 0 |
| `promote_tool_audit` | `result_status = 'error'` | 0 (table empty since 2026-03-12) | 0 |
| `promote_credential_audit` | operation contains failure/error/denied | **0 of 9,830** | 0 |
| `promote_healing_audit` | `*_error` / `ai_heal_unknown_*` / `ai_heal_section_missing` | **0 of 27** | 0 |
| `promote_provider_audit` | `was_failover = 1` | **0 of 4,001** | 0 |
| `promote_policy_event` | `action = 'dropped'` | **5 of 25** | 0 |
| `promote_healing_issue` | `status='open'` ∧ severity ≥ medium | **72 of 205** | 0 |
| **total** | | **77** | **0** |

And `SELECT COUNT(*) FROM audit_incidents WHERE source_table IN (<the seven>)`
returns **0** — confirming from the other side that not one of the 164 existing
incidents came through this module.

The bake-in rationale is written at `:13-18` and is reasonable *as a rationale*.
What is missing is any statement of when the window ends, any way to observe
that it has not, and any place a user or developer can see that the switch
exists. §2(g).

### D2 · The inbox has never been acknowledged — 99 open, oldest 74 days — P0

*(backup)*: 164 rows, 99 `open` / 65 `resolved`. `acknowledged_at IS NOT NULL`
on **0 of 164**. `continued_at` on 33. Newest open item **51 days** old, oldest
**74 days**.

The acknowledge action is not missing — it is wired to a keyboard shortcut with
a screen-reader announcement (`IncidentsInbox.tsx:347-349`), rendered by
`IncidentDetailModal`, and has a server command. The queue has an admission
path, an action, an a11y story, deep links, filters, grouping and persistence,
and **a drain rate of zero**. This is the pure form of the brief's second case,
and the diagnostic that separates it from the first is the pair of numbers: an
unwritten queue has 0 rows; an undrained one has 99 and an ageing distribution.

### D3 · A router whose word list cannot match its producer's vocabulary — 0 of 9,830

`promote_credential_audit` (`:144-152`) decides whether a credential event is a
failure with
`op.contains("failure") || op.contains("error") || op.contains("denied")`.
The live `operation` vocabulary, in full: `decrypt` (9,458),
`oauth_token_refreshed` (201), `healthcheck` (145), `delete` (10), `create` (4),
`oauth_completed` (3), `oauth_initiated` (3), `update` (3), `field_update` (2),
`credential_oauth_refreshed` (1). **Ten values, none containing any of the three
words.** The predicate matches 0 rows and would have matched 0 rows on every day
since the table was created.

This is not a tuning problem. The producer writes verbs (`decrypt`,
`healthcheck`) and the consumer searches for outcome adjectives, so the two
vocabularies are disjoint by design and no threshold fixes it. It is
[`failure-recovery-strategy`](./failure-recovery-strategy.md)'s finding —
recovery decided from words rather than from a class — appearing on the
*admission* side, and it is the sharpest instance yet because the failure is
total rather than partial.

`promote_healing_audit` fails the same way at higher resolution:
`event_type` holds `stale_pending_reverted` (26) and `ai_heal_parse_failed` (1).
The predicate is `ends_with("_error")`. The one genuine parse failure in the
table is one character from matching.

### D4 · The failure class with all the volume promotes 63 of 238 — and the threshold is invisible

238 executions terminated `failed`. `audit_incidents` holds 63 rows with
`source_table = 'execution_error'` (37 open, 26 resolved) — **26.5%**.

The gate is at `engine/mod.rs:3005-3010`: promotion happens only when
`escalation_failures >= escalate_after`, where both come from
`resolve_error_policy(pool, persona_id, use_case_id)` and `route_incident` is
itself a per-capability setting chosen at adoption. So whether a failed run
becomes visible depends on a capability-level policy configured elsewhere, with
no indication on the Activity row that a threshold exists or where the run sits
against it.

The design is defensible — *"so a single blip doesn't escalate"* is written at
`:3000-3001` — and the deviation is that the escaped 175 have no other
destination. They are `status = 'failed'` rows in a list, and a list is not a
queue: nothing tracks whether anyone looked.

### D5 · The inbox stores the failure mode and cannot group by it

`audit_incidents.kind` is populated on 164 of 164 rows with **8 distinct
values**: `blocked_dependency` (66), `external` (56), `review_blocker` (20),
`team_member_failing` (11), `config` (7), `ambiguous_requirement` (2),
`missing_credential` (1), `fleet_stall` (1). Among the 99 open rows it is the
single most discriminating column — `blocked_dependency` 35, `external` 30,
`review_blocker` 20, `config` 7.

`IncidentGroupMode` is `'agent' | 'severity' | 'source' | 'none'`
(`groupIncidents.ts:5`). The docstring says `source` answers *"what kind of
thing is failing?"* (`:59-60`) — but `source_table` names the **producer**
(`execution_error`, `persona_blocker`, `team_assignments`, `circuit_breaker`,
`fleet`, `review_dispatch`), not the failure. Under the leaf's own words
(*"clustering terminally failed events by failure mode"*), the lens the surface
is missing is the only one that clusters by failure mode.

The fix is four lines: add `'kind'` to the union, a `case 'kind'` arm in
`bucketFor`, a label resolver, and a token in `en.json`. Deferred (it changes a
live surface) — register entry **#121**.

### D6 · The DLQ's producer has never fired, and the reason is that its upstream never fails

`retry_count = 0` on 4,972 of 4,972 `persona_events`. Zero rows in `failed`,
`dead_letter` or `discarded`. `scheduled_retries`, `pending_trigger_fires`,
`schedule_missed_runs`, `chain_stop_reasons`, `circuit_breaker_state` and
`persona_message_deliveries` all hold **0 rows**.

This is honest and it is not a bug: 4,941 of 4,972 events were `delivered` and
31 `skipped`. The event bus has a 100% delivery record on this install, so
nothing has reached the retry-exhaustion path that feeds the DLQ.

The deviation is what that implies about the *product*: the app's best triage
surface is bound to the one failure class that does not occur, and the failure
class that occurs 238 times (a run that failed) has no dead-letter path at all —
it has a status on a row in a list, a healing issue, and a threshold-gated
incident. The DLQ's clustering, bulk verbs and per-item outcome reporting are
exactly what the 179 open healing issues and 99 open incidents need, and are
unavailable to both.

### D7 · `let _ =` on 3 of the 8 direct promotion sites

The eight direct `audit_incidents::promote` call sites, with how each handles
the promotion's own failure:

| site | source_table | result handling |
| --- | --- | --- |
| `engine/mod.rs:3032` | `execution_error` | `if let Err(e) … tracing::warn!` ✅ |
| `engine/runner/mod.rs:1302` | `mcp_sidecar` | `match` ✅ |
| `engine/dispatch.rs:739` | `persona_blocker` | `match` ✅ |
| `engine/subscription.rs:3059` | `fleet` | bound to `promoted` ✅ |
| `commands/execution/alert_evaluator.rs:270` | `fired_alerts` | `match` ✅ |
| `engine/mod.rs:3257` | `circuit_breaker` | **`let _ =`** ❌ |
| `commands/design/reviews.rs:1415` | `review_dispatch` | **`let _ =`** ❌ |
| `companion/athena_reaction.rs:1306` | `team_assignments` | **`let _ =`** ❌ |

`try_promote` in the promoter module (`:48-69`) is the correct shape and the
three direct sites do not use it. Note what is lost: not the incident (the write
either happened or it did not), but the **record that the last-chance recording
path failed**. The `circuit_breaker` site is the sharpest — its own log line one
statement earlier explains that it is raising an incident *instead of* disabling
a team member, so if the promotion fails, the mitigation silently becomes "do
nothing".

### D8 · Two of the fifteen promotion doors have never written a row, and one of them is the tool contract's declared consumer

Fifteen doors exist: seven in the promoter module (env-gated) and eight direct.
Six of the direct eight have written rows (`execution_error`, `persona_blocker`,
`team_assignments`, `circuit_breaker`, `fleet`, `review_dispatch`). Two have
not: `mcp_sidecar` (`engine/runner/mod.rs:1302`) and the server-side
`fired_alerts` promotion (`alert_evaluator.rs:270`) — which is explicitly
documented as *not* gated (`:267-269`) and still has 0 rows, because
`fired_alerts` itself is empty.

Separately, and already established by
[`tool-result-contract`](./tool-result-contract.md): the app built a typed
tool-failure contract with nine categories and a doc comment naming this inbox
as its consumer, and `tool_execution_audit_log` has held **0 rows since it was
created on 2026-03-12** *(measured in the purge backup, not the emptied live
file — the table was not in the purge cascade)*. `promote_tool_audit` is
therefore behind **two** gates in series over an empty table.

### D9 · `frontend_crashes` (84 rows) is the only failure store whose surface is a "clear" button

`CrashLogsSection.tsx:83` calls `clearCrashLogs()` and `clearFrontendCrashes()`
together. There is no triage, no clustering, no per-item verdict — the only
verb is *empty the table*. 84 crashes were recorded between 2026-05-25 and
2026-08-14 and the product's entire interaction with them is deletion. See
[`maintenance-affordances`](./maintenance-affordances.md) §7 for the wipe's own
defect (it returns no count).

---

## §8 — Gaps: what the primitives genuinely cannot do

1. **`promote` is idempotent per `(source_table, source_id)`, which is the wrong
   grain for a recurring failure.** `dedup_key` is `execution_error:<exec_id>`,
   so the *same problem* failing 40 runs produces 40 incidents.
   [`findings-triage-queue`](./findings-triage-queue.md) measured the
   consequence: 99 open rows carrying 64 distinct titles, including 11 copies of
   *"Transient process failure"*. Deduping by *problem* would need a fingerprint
   the producer does not compute — and computing it is exactly the failure-token
   work in §2(b).

2. **Jaccard clustering is a client-side fallback and cannot page.**
   `clusterByErrorPattern` runs over the loaded window (the comment says *"fine
   for the 100-event window"*), so cluster sizes describe what was fetched, not
   what exists. Correct for a queue that is meant to be small, structurally
   unable to answer "how many of these are there in total".

3. **A retry cannot be idempotent for the caller, only for the queue.**
   `retry_dead_letter` returns the event to `pending` and the bus redelivers it.
   Whether *that* is safe depends on the subscriber's own idempotency, about
   which the queue knows nothing. There is no "this event has side effects that
   already happened" bit, and there is nowhere to put one.

4. **The inbox cannot express "this is expected".** Statuses are
   open/acknowledged/in_progress/resolved plus dismiss and reopen. A recurring,
   understood, accepted failure — the single largest category in any mature
   queue — has to be dismissed one instance at a time, forever, because there is
   no mute/snooze/suppression rule keyed on the failure token. This is downstream
   of D5: you cannot write a suppression rule against a dimension you cannot
   even group by.

5. **Nothing measures the drain rate, and no primitive could.** Depth is a
   `COUNT(*)`; drain rate needs the *derivative*, which requires either a
   history table or a scheduled snapshot. `context_health_snapshots` and
   `knowledge_health_snapshots` show the repo already knows this shape; neither
   covers incidents.

6. **A promoter is a pure function of one row, so cross-source correlation is
   impossible by construction.** "The 30 `external` failures and the 6
   `circuit_breaker` trips are the same outage" is the single most useful thing
   a triage surface could say, and each promoter sees exactly one row of one
   table with no access to the others.

---

## §9 — The missing gate

### Existing rules checked first, and named

`privately-reclassified-failure` (`failure-recovery-strategy.md`, 14 files / 28
matches) — `.contains("timeout"|"rate limit"|"usage limit"|…)` for **recovery**
decisions. `retention-delete-by-status-allowlist` (3/3) — status allowlists in
retention `DELETE`s. `bindingless-catch-on-io`
(`swallowed-error-telemetry.md`, 84/122) — TypeScript `catch {}`.
`pending-queue-read-ranked-by-arrival` (`findings-triage-queue.md`) — queue
read ordering. `unqueryable-log-record` (`structured-logging.md`, 67/288).
`read-failure-as-empty-value` (`partial-failure-read-envelope.md`).

### The gate is declined, and here are the three candidates that declined it

**The condition this leaf needs gated is an absence**: *a terminal failure with
no human-visible destination*. The doctrine's §4 records that the census
ratchets a count of something present and cannot assert an absence. Three
countable proxies were built and measured:

| candidate | measured | verdict |
| --- | --- | --- |
| **A routing decision taken by substring-matching a machine token field** (`.contains`/`.starts_with`/`.ends_with` on `operation`/`event_type`/`result_status`/`action`/`kind`/`status`/`severity`/…) | violating **1 file / 1 match**; compliant (exact `==` or `matches!` on the same fields) **89 files / 262 matches** | **Refused: the matcher misses every earning case.** The five real instances all bind the field to a local first (`let op = entry.operation.to_ascii_lowercase();` … `op.contains(…)`), so the field name and the comparison are separated by a statement. A backreference-and-window pattern can bridge that, at the cost of a nested quantifier over 963 files — and the doctrine's mechanics section forbids exactly that shape. A rule that scores 1/5 recall on the sites that motivated it is a rule about formatting, not about the condition. |
| **`let _ =` on a recording/promotion/audit call** | violating **70 files / 196 matches**; inspected **52 / 74** | **Refused on precision.** Dominated by `let _ = app.emit(…)` — Tauri event emission, which is legitimately fire-and-forget and is not a failure record. True positives are the 3 in §7 D7, i.e. **≈1.5%**. Narrowing the verb list to `promote` alone leaves n = 3, all three already named with `file:line` in this document. |
| **A behaviour gated on an ambient env var** | violating **11 files / 13 matches**; compliant (persisted app-settings gate) **48 files / 93 matches** | **Refused on precision, ≈6/13.** The matches include a webhook **port**, a delegate **base URL** and a delegate **model** — configuration, correctly read from the environment, not a product behaviour switched off. The word "gate" is doing the work in the rule's name and not in its pattern. `compile-time-env-embedding.md` already owns the adjacent territory. |

Publishing the refusal counts is the point: **the strongest thing measured here
is that the two vocabularies (producer's tokens, consumer's word list) are
disjoint, and no regex over one file can see the other.** The instrument that
found it was a replay of the predicate against the column — SQL, not a scan —
which is the doctrine's *"execute, don't read"*.

### Prefer a type — and it is the same type twice

```rust
/// Every terminal failure the product can produce. Closed, exhaustive, and
/// the promotion site matches on it — so adding a variant does not compile
/// until someone decides whether a human sees it.
pub enum TerminalFailure {
    EventUndeliverable { event_id: String, attempts: u8 },
    ExecutionFailed { execution_id: String, class: FailureClass },
    ToolErrored { tool_id: String, kind: ToolErrorKind },
    CredentialOperationFailed { credential_id: String, op: CredentialOp },
    ProviderExhausted { engine: EngineKind },
    PolicyDropped { policy: PolicyKind },
    HealingGaveUp { issue_id: String, category: HealingCategory },
}

/// Where it goes. There is no `None`: a terminal failure that reaches no
/// destination must be spelled out, with a reason, at the site.
pub enum Destination {
    Inbox { severity: Severity },
    DeadLetter,
    SuppressedBy(&'static str),
}

fn destination(f: &TerminalFailure) -> Destination { /* exhaustive match */ }
```

Against the seven qualifications:

- **Q1** — it encodes *reachability of a destination* and nothing else. It does
  not claim the destination is drained; D2 is not fixed by a type.
- **Q2** — closedness is the win. Making `error_kind: Option<String>` required
  would change nothing: a required free string is still a free string, and D3's
  producer would still write `ai_heal_parse_failed` while the consumer looked
  for `_error`.
- **Q3 — this is where the type is weakest and it must be said.** The
  construction sites for `CredentialOp` and friends do not exist yet; the
  vocabularies are string literals scattered across the repos that write them
  (10 distinct `operation` values, 2 `event_type`, 8 incident `kind`). The enum
  is only worth what its *producers* adopt, so the first edit is at the
  `INSERT`, not at the promoter. A promoter-only change would be the type
  equivalent of `<Numeric>`'s optional locale — reaching the primitive without
  fixing the default.
- **Q4** — not applicable; nothing here authenticates.
- **Q5 (withholding beats requiring)** — applied: the promoter is not *given* a
  string to inspect. It is given a value that already says what happened.
- **Q6** — the dangerous freedom being withheld is "write a failure whose kind
  is prose". The failure's detail, message and payload are untouched.
- **Q7** — the caller does not supply the bad value voluntarily; it supplies the
  only value the schema offers. Widening does nothing; the fix is upstream at
  the write, which is Q3 again.

**What makes the primitive correct by default** (contract §9's fifth failure
mode): `Destination` has no `None` arm. A new `TerminalFailure` variant cannot
compile until `destination()` names where it goes, and "nowhere" must be spelled
`SuppressedBy("reason")` — which is greppable, reviewable, and impossible to
reach by omission. That is the property the env var destroyed: today, "nowhere"
is the default and it is spelled by not setting a variable.

### What a gate can usefully assert, and where it must live

Not a census rule. **A boot-time precondition assertion**, in the style of
`check-corpus-integrity.mjs`: for each registered promoter, count the rows in
its source table that satisfy its predicate, count the incidents with that
`source_table`, and `tracing::error!` when the first is non-zero and the second
is zero. That check would have fired on `persona_healing_issues` (72 vs 0) and
`policy_events` (5 vs 0) every day since the promoter shipped, costs 14 counts
per boot, and — crucially — **fails loudly when its own precondition is absent**:
if a source table is empty it says so rather than passing.

The census cannot express it, because the number it would ratchet is already 0
and a rule matching zero files fails structurally.

Filed as deferred-fix **#122**; not applied (it adds a boot-time query loop and
an error-level log, which changes runtime behaviour).

---

## §10 — The convergence oracle

**Cohort for this leaf, established at measurement time.** `../personas-web` and
`../personas-cloud` both consume this repo's event vocabulary (`persona_events`,
the same status tokens), so on anything DLQ-shaped they are dependents, not
witnesses. `../vibeman` is an ancestor by two independent datings. The effective
independent cohort is **2** (`../brainiac`, `../ascent`), not 5.

**The result is a silence with one partial exception, and the silence is the
strong kind.** No repo in the cohort has:

- a terminal `dead_letter` state on a queue table with retry and discard verbs;
- similarity clustering of failures by message;
- an idempotent cross-source promotion path into a single inbox;
- a bulk action returning a per-item typed failure reason.

`../brainiac` (Rust/Postgres) has retryable job state and a failure column;
`../ascent` surfaces per-panel errors. Neither has a triage *surface*.

Under the doctrine's weighting: agreement is absent, so there is nothing to
mistake for physics; silence is strong, and it says this problem is hard or
unnoticed rather than solved. **The spine's `convergence: "converged"` is
contradicted** — this is the fifteenth `converged` label the corpus has tested
and the fifteenth to fail. The mode here is the one `entity-picker` named,
inverted: not a solved problem that failed to cross a component boundary, but a
problem this repo solved *twice* — once well and once partially — and the
solution has not crossed a *queue* boundary inside the same codebase. The DLQ's
clustering and bulk verbs are 877 lines away from the 99 incidents that need
them.

**"Personas is ahead of the fleet", as self-comparison.** `DeadLetterTab.tsx` is
better than anything in the cohort on this subject, and its clustering function
would be worth porting *within this repo* before anywhere else.

**Interaction with a neighbouring prescription.**
[`structured-logging`](./structured-logging.md) prescribes moving values out of
the message string into structured fields. Applied naively to this leaf's
failure paths that is **actively harmful**: `clusterByErrorPattern` groups by the
tokens of `error_message`, so emptying that string into fields would collapse
every failure into one indistinguishable cluster. The reconciliation is §2(b):
the structured field must be the **token** (`kind`), the message stays
human-readable, and the clustering primary key moves from the message to the
token — at which point both prescriptions are satisfied and the Jaccard function
demotes to the fallback it was always meant to be. Naming this because the two
paths are individually correct and compose into a defect, which is exactly the
interaction the contract asks composers to look for.

---

## §11 — Cost, security and performance

**Cost.** Promotion is one `INSERT OR IGNORE` per qualifying source row, on the
writer's thread, wrapped in a swallow. Clustering is O(n·k) over a 100-row
window on the client. Neither is a budget concern at any plausible scale. The
real cost in this leaf is **human**: 99 open items with no drain is an attention
liability that grows monotonically.

**Security.** `promote` composes `title` and `detail` from producer-supplied
strings — including, at `engine/mod.rs:3027-3035`, a `serde_json` blob
containing a model-authored `diagnosis.description`. Those render into the inbox
as text. Two consequences worth stating: the inbox is a surface where
model-authored prose reaches the operator carrying an authority the producer did
not have (compare
[`ai-draft-preview-apply`](./ai-draft-preview-apply.md)), and any secret that
reached an error message reaches `audit_incidents.detail` unredacted — the
Sentry scrubber does not run on this path because it never leaves the device.
Local-only, so the exposure is bounded by the device; still worth knowing before
anything syncs this table.

**Performance.** `dedup_key TEXT NOT NULL UNIQUE` makes promotion O(log n) and
idempotent. `idx_ai_status`, `idx_ai_persona`, `idx_ai_severity`,
`idx_ai_source` (`incremental.rs:2686-2689`) cover the inbox's filters — and
note that **there is no index on `kind`**, which is D5 showing up in the schema:
the column the surface should be grouping by is the one column not indexed for
it.

---

## §12 — Corrections

### 12.1 · To this composer's brief

> *"So the question is not 'is there a dead-letter path' but 'what happens to
> the failures that should be in it'."*

**Half right, and the half that is wrong is the more interesting one.** There
*is* a dead-letter path — a complete one, 877 lines, with clustering, bulk verbs
and a typed per-item outcome — and the brief's framing would have led to a
document that never opened it. The corrected question is: **there are two
queues, they have opposite defects, and neither receives the failure class with
all the volume.** The brief's instruction to *"enumerate the terminal failure
paths and establish, per path, whether the failure lands somewhere a human can
see"* is what surfaced this, and the enumeration is §0's second table.

> *"`tool-result-contract.md` found the app built a typed failure contract …
> and its audit table has held zero rows since it was created on 2026-03-12."*

**Verified independently and it holds**, from the same backup:
`tool_execution_audit_log` = 0 rows, and the table was not in the purge cascade
(so the emptiness predates the purge, exactly as that path says). Re-verified
here because it is a load-bearing premise for D8, and because a claim that
agrees with the thesis is the one to re-run.

> *"a number describing a gap must come from outside the gap."*

Applied and worth showing. The gap this document claims is *"77 qualifying rows
never reached the inbox"*. The 77 is computed from the **source tables**
(`persona_healing_issues`, `policy_events`, …), and the 0 is computed from
`audit_incidents.source_table`. Two different tables, two different queries,
neither derived from the other. The register entry that refuted itself did the
opposite — it sized the gap from the column it called empty.

### 12.2 · To this composer's own measurement — the leaf's subject was nearly missed

The first four hours of scoping worked from the incidents inbox and the
promoter, and did not know `src/features/triggers/sub_dead_letter/` existed. It
surfaced only as collateral in a **different** measurement — an unrelated
regex over statement-position `await` calls happened to print
`DeadLetterTab.tsx:399 { await discardDeadLetterEvent(`.

The cause is a scoping search keyed on the *table* (`audit_incidents`) and on
the *concept as this repo names it in the backend*, when the feature is named
after the concept in the frontend and lives under `triggers/`, not under
`overview/`. This is the doctrine's *"when a clause is about a component, search
for its NAME as well as its mechanism"*, earned inside a single repo rather than
across the oracle. **Search the leaf's own words as a path fragment before
anything else** — `find . -ipath "*dead*letter*"` would have returned it in one
second.

### 12.3 · To [`findings-triage-queue.md`](./findings-triage-queue.md) — an extension, and one number to sharpen

That path lists `audit_incidents` as one of thirteen pending queues and states
its admission is `promote()` *"behind `PERSONAS_INCIDENTS_PROMOTION=1`"*, with:

> *"164 rows exist so it has run"*

**That inference does not hold.** All 164 rows came through the **eight direct
`promote` call sites in `src-tauri/src/**`**, which do not consult `enabled()` at
all — one of them (`alert_evaluator.rs:267-269`) says so explicitly in a comment
(*"Direct promotion — the server loop is the NOC authority, so it is NOT gated
behind PERSONAS_INCIDENTS_PROMOTION"*). Proof: the 164 rows carry
`source_table` ∈ {`execution_error`, `persona_blocker`, `team_assignments`,
`circuit_breaker`, `fleet`, `review_dispatch`}, and **not one** of the seven
values the promoter module writes. `SELECT COUNT(*) … WHERE source_table IN
(<the seven>)` = **0**.

The correction strengthens that path's own point rather than weakening it: the
env gate is not "a flag that has been on at some point", it is **a flag that has
never been on**, and the queue's depth is a property of which of two unrelated
admission families a producer happened to use. Suggested amendment to its §7 D5:
replace *"164 rows exist so it has run"* with *"164 rows exist, 0 of them from
the gated module — the gate has never been on, and admission is split across two
families with different rules"*.

### 12.4 · To [`alert-dedupe-and-cooldown.md`](./alert-dedupe-and-cooldown.md) — a count to correct

That path's §7 D12 reads *"unset, **seven of the eight** promoters are complete
no-ops"*. There are **fifteen** promotion doors, not eight: seven in
`audit_incidents_promoter.rs` (all env-gated) and **eight** direct
`audit_incidents::promote` call sites in `src-tauri/src/**`
(`engine/mod.rs` ×2, `engine/runner/mod.rs`, `engine/dispatch.rs`,
`engine/subscription.rs`, `commands/design/reviews.rs`,
`commands/execution/alert_evaluator.rs`, `companion/athena_reaction.rs`). The
"eight" appears to have counted the seven gated promoters plus the one direct
site that documents the gate in its comment. The corrected sentence is *"unset,
seven of the fifteen promotion doors are complete no-ops — and they are the
seven that cover every audit stream."* The severity is unchanged; the shape is
different, because it means the inbox's contents are decided by which family a
producer chose, not by a single switch.

### 12.5 · The spine labels

- `convergence: "converged"` — **contradicted**, by silence over an effective
  independent cohort of 2. §10.
- `sides: "client"` — **contradicted, incompletely rather than invertedly.**
  Unusually for this corpus, the client half is genuinely load-bearing here:
  the exemplar (`DeadLetterTab.tsx`) is client, and the clustering that the leaf
  is named for exists *only* on the client. But six of the nine deviations
  (D1, D3, D4, D6, D7, D8) are server-side Rust, and the type proposal is
  entirely server-side. The honest label is `both`, which the same spine object
  already asserts via `twoSided: true` — so the contradiction is internal to the
  spine, as it has been on seven previous leaves. This is the **second** recorded
  case where `sides: "client"` was contradicted and the correction was "it was
  both" rather than "it was the other one".

### 12.6 · A number that changed under a second reading

The first pass reported *"6 of 8 direct promoters have fired"* by grouping
`audit_incidents.source_table`. The second implementation — enumerating the
`CreateAuditIncidentInput { source_table: "…" }` literals in the Rust source —
returned **8 declared values** against **6 observed**, and named the two that
have never written: `mcp_sidecar` and the server-side `fired_alerts`. The counts
agreed; the *membership* did not, until the second pass supplied it. Recorded
because it is the doctrine's *"agreement on what is not agreement on where"*
appearing as agreement-on-count-without-membership: a `GROUP BY` over what
exists can never enumerate what should exist, and only the source-side inventory
closes that.
