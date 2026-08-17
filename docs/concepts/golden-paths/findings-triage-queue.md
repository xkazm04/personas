# Golden path — The findings triage queue

> Situation node: `ai-agents/human-review/findings-triage-queue` ·
> [situation spine](../situation-spine.md) · recurrence **6** · risk **HIGH** ·
> sides: **client** (contradicted — see [§12.1](#121--sides-client-is-wrong-again-the-seventh-data-point-and-here-the-client-half-is-absent)) ·
> convergence: **CONVERGED** (tested and failed — see [§12.2](#122--the-converged-label-failed-for-the-fourteenth-time-in-the-mode-the-doctrine-calls-the-fleet-converged-on-the-disease)) ·
> dimensions: **function · resilience · ui · cost**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` walked **four** times — twice by the
> census engine (rule + control), once by an independent structural counter that extracts every Rust
> string literal by character scan (escapes, `r#".."#` raw strings, char literals) and decides each
> one by ordered substring search rather than by a spanning regex, and once more to reproduce **every
> one of the 79 committed census rules that can reach `src-tauri/**/*.rs`** for the overlap table.
> The 13 queue tables were read at their schema, their producer, their reader, their ranker and their
> sweep.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB, 71 tables) were taken
> 2026-08-17 10:54 with the app running; the live files were never opened for write and **the copies
> were deleted at the end of composition**. Three things were replayed verbatim against them:
> **`pending_counts`'s six `COUNT(*)` statements** (`db/src/repos/dev_tools.rs:1352-1375`),
> **`gc_stale_pending`'s `WHERE status = 'pending' AND created_at < ?1` predicate**
> (`db/src/repos/communication/manual_reviews.rs:554-556`) at its production 7-day cutoff, and
> **`find_triage_candidates`'s grace-window filter** (`src/engine/subscription.rs:1918-1932`).
> Nothing was triaged, dismissed, approved, resolved or applied in the live app. `cargo` was not run.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened, and **two disqualified by lineage**, leaving an
> effective independent cohort of **3** (§6). It inverted the spine's `convergence` label and produced
> the strongest single idea in this document, which this repo does not have.
>
> **Settles:** what enters a findings queue and under what identity, what order the human meets it
> in, what drains it and how fast, what a never-triaged item becomes, and whether a dismissed finding
> can come back.
>
> Cross-reference, not overlap. [`human-review-queue`](./human-review-queue.md) owns **the verdict on
> one row** — the CAS, `rowWrites`, the resume seam, and the failure direction as a *design choice*.
> [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) owns **the N sub-items inside one
> row**. [`audit-trail-view`](./audit-trail-view.md) owns **the record of who decided**.
> [`bulk-selection-actions`](./bulk-selection-actions.md) owns **the set the user picked**.
> [`ai-draft-preview-apply`](./ai-draft-preview-apply.md) owns **one draft's journey to an applied
> row**. This path owns **the queue as a population** — its admission, its rank, its drain rate, its
> backlog and its aging. Where those leaves state a policy, this one counts its victims.

---

## 0. The headline

**Thirteen queues on this install hold 370 items waiting on a human. The decision badge can count 56
of them. The other 314 — 84.9% — sit in queues the badge does not know about, and the oldest has been
waiting 98 days.**

Replayed verbatim from `pending_counts` (`db/src/repos/dev_tools.rs:1352-1375`), the one place the
backend enumerates its human-decision queues:

```
pending_counts()  — the six queues the title-bar badge counts
  goal_acceptance        =  2      dev_goals WHERE status='awaiting_acceptance'
  manual_reviews         =  0      persona_manual_reviews WHERE status='pending'
  ideas                  = 54      dev_ideas WHERE status='pending'
  practices              =  0      workspace_knowledge WHERE status IN ('observed','proposed')
  policy_proposals       =  0      policy_proposals               <- 0 ROWS IN THE TABLE, EVER
  promotion_proposals    =  0      evolution_promotion_proposals  <- 0 ROWS IN THE TABLE, EVER
  TOTAL (the badge)      = 56

queues NOT in pending_counts
  persona_healing_issues          open        = 179   oldest  82 d
  audit_incidents                 open        =  99   oldest  74 d
  dev_kpis                        proposed    =  21   oldest  66 d
  persona_memory_review_proposal  pending     =   4   oldest  98 d
  companion_approval              pending     =   8   oldest   6 d
  companion_backlog_item          pending     =   3   oldest  79 d
  memory_claims                   unresolved  =   0        —
  INVISIBLE TOTAL                             = 314   oldest  98 d
```

Two of the badge's six entries point at tables that have never held a row. The registry is not merely
incomplete — **it is a third dead, and the third that is dead is the third somebody remembered to
add.** Meanwhile the two largest queues in the app, at 179 and 99 items, are not in it at all.

### Per queue: how many are waiting, how old is the oldest, and has a human ever drained it

| queue | waiting | oldest waiting | ever drained by a human? | how it actually drains |
|---|---:|---:|---|---|
| `persona_healing_issues` | **179** | **82 d** | **NEVER — 0 of 205** | 26 resolved, **all 26 `auto_fixed = 1`**, mean 247 s |
| `audit_incidents` | **99** | **74 d** | **never *acknowledged* — `acknowledged_at` NULL on 164 of 164**; 19 of 65 resolutions are human-shaped | 26 `Healing-retry noise … Promote()`, ~14 `Resolved by T: <persona> (execution …)`, 19 in one human batch |
| `dev_ideas` | **54** | **131 d** | yes — 182 decided | 158 accepted / 24 rejected; **23 of 24 rejections carry a reason (96%)** |
| `dev_kpis` (proposed) | **21** | **66 d** | yes — 44 decided | 64 of 65 rows are `created_by = 'scan'` |
| `companion_approval` | **8** | **6 d** | partly | **65 of 106 resolved within 2 s, 59 within 1 s, minimum 0 s** |
| `persona_memory_review_proposal` | **4** | **98 d** | **NEVER — `decided_at` NULL on 4 of 4** | no drain exists; no component calls the door |
| `companion_backlog_item` | **3** | **79 d** | **NEVER** | `reminded_count = 0` on all three — the reminder has never fired |
| `dev_goals` (awaiting acceptance) | **2** | **62 d** | — | — |
| `persona_manual_reviews` | **0** | — | **21 of 194 (10.8%)** | **168 of 194 (86.6%) machine** — see below |
| `workspace_knowledge` | **0** | — | yes — 1,306 decided | 1,164 adopted / 118 rejected / 24 deprecated |
| `policy_proposals` | 0 | — | table empty | — |
| `evolution_promotion_proposals` | 0 | — | table empty | — |
| `memory_claims` | 0 | — | 2 resolved | — |

The two queues at **zero** are the two the badge can see and the two with a real drain. **Visibility
and drain are the same variable**, and nine of the thirteen queues have neither.

### Executed, not argued — the three doors out of the review queue

`persona_manual_reviews` is the only queue in the app that has been fully drained, so it is the only
one where "what happens to an item nobody triages" can be measured rather than reasoned. All 194 rows
were classified by the sentinel their writer stamped into `reviewer_notes`:

```
fate                                                    n    status      min      mean      max
1  [auto-triaged — unattended review policy: …]       142   approved    150 h   3,131 h  36,406 h
     writer: src/engine/subscription.rs:2045     door opens at T + 60 min
2  [auto-triaged — high-severity technical-status…]     6   approved    196 h     911 h   1,741 h
     writer: src/engine/subscription.rs:2041     same door, allowlist arm
3  Auto-resolved: stale > GC threshold                 20   resolved  25,213 h  28,979 h  35,973 h
     writer: db/…/manual_reviews.rs:583          door opens at T + 7 d
4  Chose action: …            (a real human pick)      21   approved    473 h  11,399 h  21,372 h
5  (no note)                                            5   approved     18 h     127 h     284 h

machine  142 + 6 + 20 = 168 of 194 = 86.6%        human  at most 21 of 194 = 10.8%
```

**148 of 148 auto-triages fired at or after 60 minutes** — `REVIEW_TRIAGE_GRACE_MINUTES`
(`subscription.rs:1886-1887`) is respected exactly, and **51 of them fired inside the first tick after
it**. The grace window is the human's entire window, and it is one hour.

### And the two machine doors are pointed at opposite populations

This is the finding that makes the leaf `risk: HIGH`. Auto-triage refuses high and critical
deliberately, and says so:

> *"Conservative policy: APPROVES only low/medium severity … **HIGH/critical severity is left for a
> human.**"* — `src/engine/subscription.rs:1893-1895`

The 7-day sweep does not read severity at all. Its predicate is `status = 'pending' AND created_at <
?1` (`manual_reviews.rs:554-556`). So the population it takes is, by construction, whatever
auto-triage refused:

```
severity of what each door took
                               low   medium   high   critical
  auto-triage (T+60min)         49       93      6          0    <- declines high/critical by policy
  gc_stale_pending (T+7d)        2        1     17          0    <- 85% HIGH
  human                          2        3     17          4
```

**17 of the 20 rows the sweep took were `high`.** One module declares high severity a genuine human
decision; a second module, running on every launch (`src/engine/background.rs:815-836`), disposes of
it seven days later — neutrally, with no learning signal (`gc_stale_pending` writes `resolved`, and
`manual_reviews::update_status`'s memory writer is never reached because the sweep writes raw SQL),
and **without resuming what it held: 13 of the 20 carry an `assignment_id`**, so thirteen team
assignments sit parked at `awaiting_review` behind reviews that were resolved without them.
[`human-review-queue`](./human-review-queue.md) P0 named that seam. This is its body count, and the
sharper half is that the sweep's population is not random: **it is exactly the set the other policy
protected.**

Both modules are individually correct. Neither knows the other exists.

### What enters, and under what identity

| queue | admission | identity it dedups on | live consequence |
|---|---|---|---|
| `persona_healing_issues` | `INSERT OR IGNORE` (`healing.rs:1571`) | **`UNIQUE (persona_id, execution_id)`** (`migrations/fk_hygiene.rs:523`) | **179 open rows carrying 4 distinct titles.** "Transient process failure" ×107, "Execution failed" ×43, "Usage limit reached — retry scheduled" ×21, "Execution timed out" ×8. 75 distinct `(persona, title)` pairs; largest group 9. |
| `audit_incidents` | `promote()` (`db/src/audit_incidents_promoter.rs`) behind `PERSONAS_INCIDENTS_PROMOTION=1` | **`dedup_key TEXT NOT NULL UNIQUE`**, composed `<source_table>:<source_id>` | 99 open rows carrying **64** distinct titles. Sixteen times better, and still 11 copies of "Transient process failure" — because for 63 of 164 rows the `source_id` is an **execution id**. |
| `dev_ideas` | a scan writes N rows | `dedup_key` column exists — populated on 22 of 236 rows. **Corrected 2026-08-17 by [alert-dedupe-and-cooldown](./alert-dedupe-and-cooldown.md): that is a TEMPORAL CUT, not a coverage gap.** All 214 unkeyed rows are ≤ 2026-06-13 and all 22 keyed rows are ≥ 2026-07-27; there are 6 production `scan_dedup_key` callers and a partial UNIQUE index. The column was adopted, not abandoned — "90.7% of the table does not use it" measured history as if it were policy. | 0 duplicate `dedup_key`s, 0 duplicate titles |
| `workspace_knowledge` | harvest writes rows as `observed` | `dedup_key` on **1,304 of 1,306** | 0 duplicate keys, 0 keys carrying two statuses |

**A dedup key that contains the id of the occurrence cannot dedup anything**, because the next
occurrence has a new one. `healing.rs`'s own header calls the index dedup, and it is: it prevents two
rows for *one execution*. It has never prevented a row for a problem already in the queue, and the
queue is 97.8% duplicate by title.

### What ranks it

Nothing does, at any human reader. `triage_ideas` (`db/src/repos/dev_tools.rs:3841`) is
`ORDER BY created_at DESC, id DESC`; the review queue's eight reads are `ORDER BY created_at DESC`;
`workspace_knowledge`'s two are `ORDER BY updated_at DESC`. Every one of these tables carries a rank
signal that is populated and unread — `dev_ideas.impact` on **236 of 236**, `effort` on 214,
`priority` on 47; `persona_manual_reviews.severity` on **194 of 194**;
`persona_healing_issues.severity` on **205 of 205**; `workspace_knowledge.confidence` on **1,304 of
1,306**.

The exception is the machine's own reader, and it is the best artifact in this leaf:

> ```sql
> -- Auto-APPROVABLE severities first (low/medium), THEN high/critical,
> -- each oldest-first. Without this, a backlog of legitimately-held
> -- high/critical business items (PHI/PII/compliance) at the front of an
> -- oldest-first queue permanently STARVES the approvable low/medium
> -- reviews behind them under the per-tick cap — the real reason
> -- autonomous triage resolved nothing despite 29 approvable pending.
> ORDER BY CASE WHEN lower(COALESCE(severity,'medium')) IN ('low','medium') THEN 0 ELSE 1 END,
>          created_at ASC
> ```
> — `src/engine/subscription.rs:1925-1932`

**A capped drain over an arrival-ordered queue drained zero items while 29 were eligible**, and
somebody found it and fixed it by ranking. The fix was applied to the machine's reader and to no
human reader in the app.

### And whether a dismissed finding can come back

Almost nowhere, and where it can, nothing uses it. `workspace_knowledge` has a `superseded_by`
column: **0 of 1,306 rows use it**. `dev_ideas` has `reopenIdeaRow` (`rowWrites.ts:296-310`) and on
this install **0 rows have ever been reopened** — no title appears twice, no `dedup_key` appears
twice, and no rejected title was ever re-proposed. `dev_ideas.verify_state` — the column that would
record whether a finding still holds against the code — is **NULL on 236 of 236 rows**. So "can a
dismissed finding come back" has a live answer and it is *no, and nothing has tried*: the rejection
reason is recorded at 96% and **nothing reads it**, because every producer here writes a fresh scan
rather than diffing against what was already refused.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the one everything else follows from.** **A queue's depth is a measurement, and
> a queue nothing publishes does not exist.** A backlog no rollup counts is not a backlog somebody
> decided to have; it is one nobody can see. Registering a queue is not bookkeeping — it is the
> difference between a decision deferred and a decision lost.
> *Warrant: measured here at 314 of 370 waiting items (84.9%) outside the one registry, oldest 98
> days — and that registry's own list is a third dead, naming two tables that have never held a row.*
>
> **P2 — physics.** **Admit a finding under the identity of the problem, never the identity of the
> occurrence that produced it.** A key containing the run, the execution, the event or the timestamp
> guarantees the next recurrence is a new row, so the queue measures how often the machine ran rather
> than how many things need deciding.
> *Warrant: 179 open items carrying 4 distinct problems, deduped on `(entity, execution)`; against a
> sibling table in the same database deduped on `(source, source_id)`, which is 16× better and still
> leaks wherever `source_id` is an execution. Independently: **3 of 3 independent sibling repos key
> their queue on the problem**, and none on a run.*
>
> **P3 — physics.** **Rank the queue by need, then by the clock — and rank it hardest where the drain
> is capped.** Arrival order is fair only when everything in the queue will eventually be served. The
> moment a drain has a per-cycle cap, arrival order is a starvation schedule, and the items that
> starve are the ones the cap was meant to protect.
> *Warrant: this repo's own recorded incident — "the real reason autonomous triage resolved nothing
> despite 29 approvable pending" — fixed by putting a `CASE` before the clock, in the only reader in
> the app that has one.*
>
> **P4 — physics, and the most expensive.** **Two policies over one queue compose into a third policy
> nobody wrote.** A conservative rule that declines the hard items and an aging rule that resolves
> whatever is left are each defensible; together they are a rule that disposes of exactly the hard
> items, at a delay, silently.
> *Warrant: measured — the sweep's population is 85% `high` precisely because the door upstream
> declines `high` by design; 17 of 20, with 13 assignments left parked.*
>
> **P5 — physics.** **"Nobody triaged this" must be a state the row can hold, and its transition must
> be as loud as a verdict.** Ageing out is a decision. If it writes the same status a human writes, no
> reader downstream — a badge, a memory writer, a resume, an audit view — can tell a considered
> outcome from an abandoned one.
> *Warrant: 20 rows resolved by a sweep and 174 by a verdict share one status column, separated only
> by a sentence in a free-text notes field.*
>
> **P6 — physics as an economics claim.** **A machine drain and a human drain are different products,
> and a queue serving both must say which one it is.** When a machine empties the queue at machine
> speed, the human-facing surface is not a work queue; it is a log with buttons on it.
> *Warrant: 86.6% machine on the one drained queue; 100% machine on healing; 0% human acknowledgement
> across 164 incident rows; 61.3% of consent rows resolved within two seconds under a rule whose text
> is "under autonomous mode every proposed action fires".*
>
> **P7 — ergonomics with teeth.** **A rejection is only knowledge if the next producer reads it.**
> Recording *why* an item was refused costs nothing and buys nothing unless tomorrow's scan diffs
> against it. Otherwise triage is a treadmill with a well-documented tread.
> *Warrant: 96% reason coverage on this repo's best queue and zero consumers of the column; a
> `superseded_by` column at 0 of 1,306; a `verify_state` column at 0 of 236. Against **2 of 3**
> independent siblings, which do dedup admission against prior rejections and wrote down why.*
>
> **P8 — ergonomics.** **A queue must disclose its own age, not only its own size.** "54 pending" and
> "54 pending, oldest 131 days" are different products, and only the second is actionable.
> *Warrant: every count surface in this repo publishes a cardinality and none publishes an age; the
> oldest waiting item on this install is 98 days old and nothing anywhere says so. **1 of 3**
> independent siblings publishes queue age, and it is the only one that can halt a downstream
> pipeline when the queue stalls.*
>
> **Scale condition.** P1 and P8 bite at the first queue nobody registered. P2 bites at the second
> occurrence of one problem. P3 bites the first time a drain is capped. P4 bites at the second policy.
> P5, P6 and P7 bite the first time anybody asks what the queue accomplished.

---

## 1. Trigger

- "The scan produced 40 findings — where do they go?" / "Add a table of things to review."
- "Add a badge with the number of things waiting."
- "Why is this list 179 items of the same thing?"
- "Auto-approve the low-risk ones so the queue doesn't pile up."
- "What happens to a review nobody looks at?" / "Should these expire?"
- "It keeps suggesting the thing I already said no to."
- "The badge says 56 and I have hundreds of open issues."

**If you are about to write** an `INSERT` into a table whose `status` defaults to `pending` / `open` /
`proposed` / `observed`; a `UNIQUE` index or a `dedup_key` for such a table; `ORDER BY created_at` on
a read a human is going to work through; a background tick that resolves rows a human was supposed to
decide; a `LIMIT` or `take(N)` on such a tick; or a `COUNT(*) … WHERE status = 'pending'` for a badge
— **you are in this situation.**

You are **not** in it for a machine work queue — an event outbox, an execution lane, a retry
scheduler. Those are FIFO by design and arrival order is correct for them. The discriminator is
whether a **human** is the drain. (This distinction is load-bearing: a first draft of §9's signal
keyed on the pending status alone and scored ~15% precision because `persona_events` and
`persona_executions` dominated it.)

### Boundaries with the adjacent leaves

- [**`human-review-queue`**](./human-review-queue.md) owns **one row's verdict**: the CAS, the
  `seenStatus` contract, `rowWrites`, the resume seam, and the *design question* "what should happen
  if nobody answers" (its fourteen-surface table). This leaf owns **the population**: how many are
  waiting, how old, in what order, and what the chosen failure directions actually did. Where it says
  *"seven hang forever and not one says so"*, this one says *which seven, how deep, and since when*.
  Its §Gap 9 (`pending_counts` is *"a rollup, not a registry"*) is P1 from the other side, and its P0
  seam (a sweep that resolves without resuming) is quantified here at **13 parked assignments**.
- [**`selective-per-item-verdicts`**](./selective-per-item-verdicts.md) owns **the verdict inside one
  row** — the N sub-items, the staging map, the apply door's signature. Its D5 (8 expired approval
  batches) is one queue in this leaf's table; its exemplar `dev_ideas` is measured here as a *queue*
  rather than as a *storage shape*, and comes out the best-drained and the worst-ranked.
- [**`audit-trail-view`**](./audit-trail-view.md) owns **the record of who decided** — the missing
  `resolver_kind`, the machine decisions rendered as a human's. This leaf owns **why the machine made
  them**: the grace window, the per-tick cap, the sweep, and the ranking that decides which items each
  door reaches. Its §2(e) *"order by the clock and then by the primary key"* is correct for a history
  and is the defect for a queue — see [§6](#the-composition-with-audit-trail-view--measured-not-argued)
  and §12.8.
- [**`bulk-selection-actions`**](./bulk-selection-actions.md) owns **the set the user picked**. This
  owns the set the machine admitted. Its finding that two bulk surfaces are unreachable today because
  their queues are empty is this leaf's §0 from the UI side — the queues are empty because machines
  drained them.
- [**`ai-draft-preview-apply`**](./ai-draft-preview-apply.md) owns **one draft's journey**, including
  giving an abandoned draft a terminal state — for one artifact. This owns abandonment as a *queue
  property*: rate, age distribution, and which door claims the abandoned.
- [**`informed-consent-gate`**](./informed-consent-gate.md) owns the 24-hour consent window;
  [**`retention-and-pruning`**](./retention-and-pruning.md) owns the sweep as a data-lifecycle
  mechanism. This owns whether the sweep's population is the one the product intended.
- [**`aggregate-count-display`**](./aggregate-count-display.md) owns *what a rendered number counts*.
  It would own the badge if the number were wrong; the number is right and **the list is incomplete**,
  which is a different defect and needs a different instrument (§9).

## 2. The one way

**Decide, before the first `INSERT`, what identifies the *problem* rather than the occurrence, what
order a human will meet the queue in, what drains it and how fast, and what an item nobody touches
becomes — then register the queue in the one rollup so all four are visible.** Concretely: (a) **give
the row a dedup key derived from the problem** — the entity plus a normalized cause, never a run,
execution or event id — and admit a recurrence by bumping an occurrence counter and a `last_seen_at`
on the existing row, not by writing a new one; a `UNIQUE (entity, occurrence_id)` index is a no-op
wearing dedup's clothes. (b) **Register the queue in the single pending-count rollup in the same
commit that creates the table**, and make that rollup a *descriptor* — table, pending statuses, decide
command, rank expression, timeout policy — so the badge, the sweep, the drain and the gate all read
one list. (c) **Rank every human read by need and only then by the clock**: `ORDER BY
<severity|priority|score>, created_at`. Arrival order is acceptable only where the drain is uncapped
and the queue is known to empty. (d) **Publish the queue's age beside its size** — `54 waiting ·
oldest 131 days` — because size alone cannot distinguish a working queue from an abandoned one. (e)
**Declare the failure direction as a named constant next to the queue, and give ageing out its own
terminal status** (`expired` / `aged_out`), never the status a human writes; a reader must be able to
separate a considered outcome from an abandoned one without parsing prose. (f) **Before adding a
second policy over one queue, write down the composition** — the population one policy declines is
the population the next one inherits — and put the test on the composition, not on either half. (g)
**Cap a machine drain by rate, never by silently truncating a badly-ordered read**; if it is capped,
(c) is mandatory rather than advisory. (h) **Give the machine drain a grace window and say what it is
for**, so the human's window is a stated product decision and not the interval between two ticks. (i)
**Record why an item was refused as a machine token, and make the next producer read it** — a
rejection nothing diffs against is a rejection that will be re-proposed. (j) **Give a dismissed item a
way back that is a state transition, not a re-insert**, so the second offer of the same finding is
visibly the second. Then stop: do not add a second unregistered queue, do not resolve a row you cannot
resume, and do not let an aging sweep write the same status as a verdict.

If you must get one right first: **(b)**. Everything else in this document is downstream of queues
nobody counted — including the fact that the only two queues in this repo which *are* counted are also
the only two that reached zero.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/dev_tools.rs:1338-1387` — `PendingCounts` / `pending_counts` | **the one queue registry.** Six index-backed `COUNT(*)`s on one pooled connection, `u32` for a documented ts-rs reason. **Any new queue must be added here or it is invisible.** It is also this leaf's largest defect (§7 D1) — use it *and* fix it. |
| `src/engine/subscription.rs:1918-1932` — `find_triage_candidates` | **the ranked-drain query to copy, and the only one in the app.** A `CASE` that puts the drainable class first, then `created_at ASC` inside the class, with the starvation incident that produced it written above the SQL. Copy the shape *and* the comment discipline. |
| `src/engine/subscription.rs:1886-1889` — `REVIEW_TRIAGE_GRACE_MINUTES = 60`, `REVIEW_TRIAGE_MAX_PER_TICK = 10` | **a stated human window and a stated drain rate.** *"A review must sit `pending` at least this long before auto-triage touches it, giving a human first crack."* The only queue in the app where the human's window is a named constant rather than an accident. |
| `db/src/audit_incidents_promoter.rs` + `audit_incidents.dedup_key TEXT NOT NULL UNIQUE` | **the admission-identity shape to copy.** One key per `(source_table, source_id)`, `promote()` idempotent by construction: *"Already promoted — idempotent no-op. Not even debug-logged because this path fires on every retry."* Copy the mechanism; **choose a better `source_id`** (§7 D3). |
| `db/src/repos/execution/audit_incidents.rs:357-370` | **the queue's own shape, published.** `SELECT severity, COUNT(*) … GROUP BY severity`, and the same by `source_table` — the only queue in the app that can say *what* is waiting rather than only how many. |
| `src/commands/companion/approvals/approval_exec_fleet.rs:434-441` · `src/companion/observability.rs:141-150` | **the two severity-ranked reads.** `ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 …`. **Read each beside its own neighbour at `:389` and `:175`, which rank the review queue by the clock in the same function** — compliant and violating forms roughly 40 lines apart, by one author. |
| `src/companion/brain/backlog.rs:159-162` | **status tier before clock**: `ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, b.created_at DESC`. Waiting items sort above settled ones without a second query. |
| `db/src/repos/dev_tools.rs:4456-4498` — `decide_idea_cas` + `dev_ideas.rejection_reason` | **the drain shape that works at scale.** Per-row status, per-row reason, two statements rather than a `COALESCE` so "no reason given" is storable. **96% live coverage** — the highest in the app. |
| `triageAdapters.ts:505-583` — `{ id, value, copy }` reject presets | **the machine token for *why*.** `value` is the persisted English a scanner reads back; `copy` is the translated label. Exactly what P7's "make the next producer read it" needs, and it already exists. |
| `src/commands/companion/approvals/mod.rs:38-43` — `APPROVAL_FRESHNESS_WINDOW = "-24 hours"` | **a declared failure direction with its reasoning beside it.** The window is right; what is missing is a status a sweep can write when it closes (§7 D5). |
| `db/src/repos/resources/automation_suggestions.rs:225` — `prune_stale_proposed` | **the only sweep in the repo that prunes a *proposal* queue rather than a work queue.** The shape a new queue should opt into instead of writing a fourteenth bespoke answer. |

**Do NOT build:** a fourteenth unregistered queue; a `UNIQUE` index whose second column is an
execution/run/event id, called dedup; a badge that counts rows without publishing their age; an aging
sweep that writes the status a human writes; a second policy over an existing queue without writing
down the composition; a per-tick cap over an arrival-ordered read; another `dedup_key` /
`superseded_by` / `verify_state` column with no writer.

## 4. Steps

1. **Name the problem identity before you name the table.** Write the dedup key out as a sentence
   first: *"two rows are the same finding when they name the same persona and the same failure
   class."* If your sentence contains "the same run", you have written P2's defect. Then make it a
   column with a `UNIQUE` index and admit recurrences with `UPDATE … SET occurrences = occurrences +
   1, last_seen_at = ?`.
2. **Add the queue to `pending_counts` in the same commit as the migration.** Not the next one. Six
   of thirteen queues here are unregistered and every one of them was going to be added later.
3. **Write the human read's `ORDER BY` before the surface exists**, need first: `ORDER BY CASE
   severity …, created_at ASC`. If the table has no need column, that is the finding — add one, or
   admit in writing that the queue is arrival-ordered on purpose.
4. **Ask whether the type can make the wrong call impossible — before you write the gate.** Here it
   can for two of three sub-conditions and provably cannot for the third; see below.
5. **Decide the failure direction and give it its own status.** Four honest answers (hang /
   expire-as-reject / age-out-as-neutral / supersede) per
   [`human-review-queue`](./human-review-queue.md) step 1 — plus a fifth requirement this leaf adds:
   **whichever you choose, the terminal status must not be one a human verdict can also write.**
   `expired`, not `resolved`.
6. **If a machine will drain this queue, write the grace window as a named constant** and state what
   it is for. One hour is a product decision; the interval between ticks is not.
7. **If the machine drain is capped, rank the candidate query and put the starvation argument in the
   SQL.** `subscription.rs:1925-1930` is the template, comment included.
8. **Enumerate every policy that can touch this queue and write down the composition.** For each
   pair, complete the sentence *"the items policy A declines are the items policy B will get."* If
   that sentence names a population you would not have chosen, one of the two policies is wrong.
9. **Publish size and age together.** `waiting`, `oldest_waiting_at`, and where it exists
   `waiting_by_severity` — `audit_incidents.rs:357-370` already computes the third.
10. **Record the rejection reason as a token and wire the next producer to read it.** Tomorrow's scan
    takes the rejected keys as an exclusion set. Without that step, (i) is bookkeeping.
11. **And then stop.** Do not add a second sweep, do not add a second badge, and do not let a queue be
    both machine-drained and human-facing without saying which surface is which.

### Can the type make the wrong call impossible? — asked before §9

**Partially, and the honest answer is that the largest half of this leaf is not a type problem at
all.**

The bad state is *"a queue exists that no rollup counts, ranked by arrival, whose ageing status is
indistinguishable from a verdict."* Three sub-states, and they are not equally reachable by a type.

**(a) The ageing status — a type closes it completely, in one edit.** `ManualReviewStatus`
(`core/src/models/review.rs:11-54`) is a closed enum with a validated transition table, and
`gc_stale_pending` writes `'resolved'` **as a raw SQL string literal** (`manual_reviews.rs:578`),
bypassing both. Add a variant and take the string away:

```rust
pub enum ManualReviewStatus { Pending, Approved, Rejected, Resolved, AgedOut }   // + AgedOut
// validate_transition: Pending -> AgedOut allowed; AgedOut -> nothing.
```

Then make the sweep call `update_status(.., ManualReviewStatus::AgedOut, ..)` instead of writing SQL.
The consequences are the point: the memory writer's `match` **stops compiling** until somebody decides
whether an aged-out review teaches the model anything (it must not — today it silently does not, by
accident of the sweep bypassing the writer entirely); `react_to_review_decision`'s `Approved |
Resolved` gate **stops compiling** until somebody decides whether ageing out resumes the assignment
(it must, or the 13 parked ones stay parked); and
[`audit-trail-view`](./audit-trail-view.md)'s missing `resolver_kind` becomes derivable for 20 of its
168 machine decisions **with no new column at all**. One variant, three readers forced to choose.

**(b) The dedup identity — a type helps, and only if you withhold the right half.** A newtype
`ProblemKey(String)` constructible only through a function taking `(entity_id, cause_class)` and
**refusing an execution id** is Q5/Q6 exactly: withhold the dangerous freedom (the occurrence id), not
the answer (the identity of what recurred).

**(c) The registry — no type reaches it, and this is the largest half.** Doctrine's *"where types
cannot reach"* gains a member here: **a queue that was never declared.** `pending_counts` is six
hand-written `COUNT(*)` string literals in one function body (item 1 of the doctrine's list — inside a
SQL string literal), and the failure is not that a caller passed a wrong value; it is that **nobody
called anything.** No signature is short a parameter. No enum is short a variant. A queue that should
have been registered and was not leaves no hole a compiler can see, which is why six accumulated and
two dead entries survived. The only instrument that finds it is an **inventory of what should exist**
compared against the registry — the same shape as the doctrine's orphan-bindings case, and the same
reason a diff-shaped gate cannot see it. **This is stated so nobody proposes a type for it: there
isn't one.**

Held against the seven qualifications:

- **Q1 (a type carries only what it encodes)** — holds for (a): `AgedOut` encodes *this transition was
  made by time, not by judgement*, and nothing more. It does **not** encode *who*, which stays
  `audit-trail-view`'s `resolver_kind` column; it does not encode *how long we waited*, which is
  `resolved_at - created_at` and already present.
- **Q2 (requiredness ≠ closedness)** — (a) is closedness: a new legal value plus a transition edge.
  Making anything required changes nothing, because nothing is optional here.
- **Q3 (a type nobody constructs constrains nothing)** — survives for (a): `ManualReviewStatus` has 9
  construction sites and `update_status` is the sole writer, so the variant is constructed the day it
  lands. It is **thin for (b)**: `ProblemKey` would have exactly **one** construction site today
  (`healing.rs:1571`), so propose it alongside a second producer or not at all.
- **Q4 (a type anyone can construct authenticates nothing)** — live for (b): `ProblemKey` with a
  public field is a comment. Private field, one constructor, or skip it.
- **Q5/Q6 (withhold the dangerous freedom, not the answer)** — withhold the raw status string from the
  sweep, not the sweep; withhold the occurrence id from the key, not the key.
- **Q7 (withholding helps only where the requirement forced the bad value)** — decisive here. Nothing
  *forced* `gc_stale_pending` to write `'resolved'`; it did so voluntarily because raw SQL was
  available. So the fix is withholding the permissive door, which is exactly what deleting the string
  literal does.

**And one destination needs fixing before any gate points at it** (contract, fifth §9 failure mode).
Routing authors to `pending_counts` is worth little while two of its six entries name tables that have
never held a row: an author who reads it as the canonical list of queues learns that `policy_proposals`
is a live queue and that healing — 179 items, 82 days — is not. **Delete the two dead entries and add
the six live ones before ratcheting anybody toward the registry**, or the gate will route people to a
list that is wrong in both directions.
## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A queue that is not in `pending_counts`** | It is real and invisible. Nothing badges it, nothing sweeps it, nothing can ask how deep it is. Measured: **6 unregistered queues holding 314 of the app's 370 waiting items (84.9%), oldest 98 days.** §7 D1. |
| **A registry entry for a table that has never held a row** | Worse than a missing entry, because it manufactures the impression that the list is the list. `policy_proposals` and `evolution_promotion_proposals` are **0 rows, ever** — a third of the registry — while healing (179) and incidents (99) are absent. §7 D1. |
| **`UNIQUE (entity_id, execution_id)` called dedup** | Dedups the occurrence, never the problem, so every recurrence is a new row. **179 open healing issues carrying 4 distinct titles**; 107 of them are the same sentence. The next failure always has a new execution id, by definition. §7 D2. |
| **A `dedup_key` composed as `<source>:<source_id>` where `source_id` is an execution** | The same defect, one layer up and 16× better. `audit_incidents` gets 64 distinct titles out of 99 open rows instead of 4 out of 179 — and still carries 11 copies of "Transient process failure", because 63 of 164 rows key on an execution. §7 D3. |
| **`ORDER BY created_at` on a queue a human works through** | Arrival order is a fair schedule only if the queue empties. Under a per-tick cap it is a starvation schedule. Measured in this repo's own words: *"the real reason autonomous triage resolved nothing despite 29 approvable pending"* (`subscription.rs:1929-1930`). Every human queue read in the app is arrival-ordered while the rank column beside it is populated at 99–100%. §7 D4. |
| **A rank column populated by the producer and read by nobody** | `dev_ideas.impact` 236/236, `persona_manual_reviews.severity` 194/194, `persona_healing_issues.severity` 205/205, `workspace_knowledge.confidence` 1,304/1,306. The cost of the signal was paid at write time and none of it is spent at read time. §7 D4. |
| **A confidence score that does not separate the outcomes** | `workspace_knowledge.confidence`: adopted mean **0.797** (0.55–0.95) against rejected mean **0.779** (0.60–0.92) — overlapping ranges, 1.8 points apart. Ranking by it would be ranking by noise, and *believing* it would be worse. §7 D7. |
| **An aging sweep that writes the status a human writes** | `gc_stale_pending` writes `'resolved'` as raw SQL, so 20 sweep dispositions and 174 verdicts share one column and are separable only by a prose sentinel in `reviewer_notes`. Every downstream reader — badge, memory writer, resume, audit view — sees one thing. §7 D3, and [`audit-trail-view`](./audit-trail-view.md)'s whole subject from the other end. |
| **Two policies over one queue, written independently** | The population the first declines is the population the second inherits. Auto-triage declines high/critical *"left for a human"*; the 7-day sweep takes whatever is left. Result: the sweep's population is **85% high (17 of 20)**, and it is the only door those items ever reach. §7 D3. |
| **Resolving a queue row without resuming what it held** | [`human-review-queue`](./human-review-queue.md) P0's defect, quantified: **13 of the 20 swept reviews carry an `assignment_id`**, so thirteen team assignments sit at `awaiting_review` behind reviews an audit row says were handled. |
| **A per-tick cap over an unranked read** | The cap and the order compose into a filter nobody wrote. `REVIEW_TRIAGE_MAX_PER_TICK = 10` is correct; it was harmless only once the `CASE` landed in front of it. A cap is a policy about *which* items, not only *how many*. |
| **A grace window that is really the tick interval** | `REVIEW_TRIAGE_GRACE_MINUTES = 60` is the only stated human window in the app, and 148 of 148 auto-triages honoured it, 51 within the first tick after it. Every other machine-drained queue's human window is whatever the scheduler happened to be doing. |
| **A queue count with no age** | "56 waiting" cannot distinguish a queue being worked from one abandoned in May. Nothing in this app publishes an age; the oldest waiting item is 98 days old. **1 of 3 independent siblings publishes one, and it is the only repo in the cohort that can stop a downstream pipeline when the queue stalls.** §8 Gap 6. |
| **A rejection reason nothing reads** | `dev_ideas.rejection_reason` at **96% coverage and 0 consumers**. **Half-corrected 2026-08-17 by [alert-dedupe-and-cooldown](./alert-dedupe-and-cooldown.md): the reason string really is unread, but the EXCLUSION SET is not.** `create_finding`'s `(project_id, dedup_key)` gate excludes on any status including `rejected`, and `list_finding_dedup_keys` → `dev_tools_list_finding_dedup_keys` → `devTools.ts:928` is a live production chain. So admission *is* deduped against prior rejections here — this row was right about the reason and wrong about the key. That repo also already ships `REJECTED_DEDUP_WINDOW_DAYS = 90` with brainiac's own phrasing. §7 D8. |
| **A promotion path behind an env flag that defaults off** | `PERSONAS_INCIDENTS_PROMOTION=1` — unset, every promoter is a complete no-op. 164 rows exist so it has run; nothing states whether it is meant to be on now, and a queue whose *admission* is environment-dependent has a depth that is not a property of the product. §7 D5. |
| **A declared capability with no writer** | `workspace_knowledge.superseded_by` 0/1,306. `dev_ideas.verify_state` 0/236. `dev_ideas.dedup_key` 22/236. `companion_backlog_item.reminded_count` 0/3. Four columns that describe a lifecycle the code does not implement — and each one reads, to the next author, as evidence that the lifecycle exists. §7 D6. |
| **An acknowledge affordance nobody has ever used** | `audit_incidents.acknowledged_at` / `acknowledged_by`: **NULL on 164 of 164**. The two-stage lifecycle (open → acknowledged → resolved) has one stage that has never happened, so `open` means both "nobody has looked" and "somebody is on it". |
| **A reminder counter that never increments** | `companion_backlog_item.reminded_count = 0` on all three rows, aged 79 days. The queue was built with a nudge mechanism and the nudge has never fired, so "pending" here has no upper bound at all. |

## 6. Evidence

**The one site to copy: `src/engine/subscription.rs:1886-1932` — the graced, capped, *ranked* drain.**

```rust
/// A review must sit `pending` at least this long before auto-triage touches
/// it, giving a human first crack.
const REVIEW_TRIAGE_GRACE_MINUTES: i64 = 60;
/// Max reviews auto-triaged per tick.
const REVIEW_TRIAGE_MAX_PER_TICK: usize = 10;

"SELECT id, COALESCE(severity,'medium'), COALESCE(title,''), \
        COALESCE(description,''), COALESCE(suggested_actions,'')
 FROM persona_manual_reviews
 WHERE status = 'pending' AND datetime(created_at) < datetime('now', ?1)
 -- Auto-APPROVABLE severities first (low/medium), THEN high/critical,
 -- each oldest-first. Without this, a backlog of legitimately-held
 -- high/critical business items (PHI/PII/compliance) at the front of an
 -- oldest-first queue permanently STARVES the approvable low/medium
 -- reviews behind them under the per-tick cap — the real reason
 -- autonomous triage resolved nothing despite 29 approvable pending.
 ORDER BY CASE WHEN lower(COALESCE(severity,'medium')) IN ('low','medium') THEN 0 ELSE 1 END,
          created_at ASC",
```

Five decisions worth copying: (1) the human's window is a **named constant with its purpose written
beside it**, not the scheduler's period; (2) the drain rate is capped and the cap is named; (3) the
candidate query is **ranked before it is capped**, which is the only reason the cap is safe; (4) the
starvation incident is recorded **in the SQL**, where the next person to touch the `ORDER BY` will
read it; (5) the eligibility classifier is an **allowlist with a denylist that wins on overlap**
(`high_severity_auto_approvable`, `:1977`), so an unrecognised high-severity item stays pending rather
than defaulting into the drain.

It is also where this leaf's central defect is visible, and the file cannot see it: everything above
is a decision about the *machine's* view of the queue. `REVIEW_TRIAGE_GRACE_MINUTES` is the human's
entire window and no human surface knows the constant exists.

**Also exemplary:**

- `db/src/repos/execution/audit_incidents.rs:357-370` — the only queue in the app that publishes its
  own **shape**: `SELECT severity, COUNT(*) … WHERE status='open' GROUP BY severity`, and the same by
  `source_table`. Two statements away from also publishing its age (`MIN(created_at)`), which is §8
  Gap 6 and the cohort's best idea.
- `db/src/audit_incidents_promoter.rs` — admission as an **idempotent promotion** with a
  `UNIQUE dedup_key`, every promoter best-effort (*"Promotion failure must NEVER fail the parent audit
  insert"*), and the no-op path deliberately not logged *"because this path fires on every retry"*.
  The mechanism is right; §7 D3 is about the key it is given.
- `src/companion/observability.rs:141-150` and
  `src/commands/companion/approvals/approval_exec_fleet.rs:434-441` — `ORDER BY CASE severity WHEN
  'critical' THEN 0 WHEN 'high' THEN 1 …`. **Read each one beside the review-queue read in the same
  function** (`:175` and `:389`), which is `ORDER BY created_at`. The compliant and violating forms sit
  roughly 40 lines apart, written by one author on one afternoon: the knowledge is present in the
  file and did not reach the queue that needed it most.
- `src/companion/brain/backlog.rs:159-162` — `ORDER BY CASE b.status WHEN 'pending' THEN 0 …,
  b.created_at DESC`. Waiting sorts above settled in one query. The cheapest possible instance of §2(c).
- `db/src/repos/dev_tools.rs:4456-4498` — `decide_idea_cas`, and the 96% reason coverage that makes
  `dev_ideas` this repo's best-drained queue. Two statements rather than a `COALESCE` so *"no reason
  given"* is storable and distinguishable from *"nobody asked"*.
- `db/src/repos/resources/automation_suggestions.rs:225` `prune_stale_proposed` — the only sweep in
  the tree aimed at a *proposal* queue rather than a work queue.

### Convergence — 5 checkouts opened, effective independent cohort **3**

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened. Two were disqualified by lineage before
counting**, per doctrine §5:

- **`personas-web` — disqualified twice over.** It is a **downstream consumer**: `ReviewsSplitPane`
  reads `synced_manual_reviews`, a table this repo writes. Agreeing with its upstream is not evidence
  about the upstream. *(Reported anyway below, because one of its behaviours is a finding.)*
- **`personas-cloud` — disqualified as a proxy.** Its review surface forwards
  `/api/reviews/pending` to this repo's data; it holds no queue of its own.
- **`vibeman` — counted, with the lineage stated.** Its `ideas` table is a **schema port** — the same
  columns in the same order with the same SQLite defaults — but its **triage logic is independent**:
  Jaccard-similarity dedup where this repo uses a canonical key, and its own stop-word list. Counted
  for the behavioural clauses, not for the schema ones.
- **`brainiac`, `ascent` — clean-room.** Different language, different store, no shared vocabulary.

So: **cohort 5 → 3.** "2 of 5" and "2 of 3" are different findings, and the label on the spine was
computed against neither.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Admission keys on the problem, not the occurrence** | **PHYSICS (3 of 3)** | Not one sibling keys a human queue on a run/execution id. vibeman dedups by title similarity + stop-word-stripped tokens; brainiac by canonical claim key; ascent by `(repo, practice_id)`. **Personas is alone in the cohort with an occurrence key, and it is the queue with 179 rows and 4 problems.** |
| 2 | **Admission dedups against prior REJECTIONS** | **MAJORITY (2 of 3), and both wrote down why** | vibeman `ideaSaver.ts:114-127` seeds the dedup set with rejections **except** stale auto-archives, which *"may legitimately resurface once its context actually changes"* — a deliberate re-entry carve-out this repo has no equivalent for. brainiac `library_sweep.rs:20-25`: *"Rejection is knowledge: a maintainer who said no must not be asked again next week"*, with `DEFAULT_DEDUP_WINDOW_DAYS = 90`. **Personas records the reason at 96% and reads it in zero producers.** |
| 3 | **The default queue view is ranked by need** | **MINORITY (1 of 3) — and that matters for §2(c)** | Only brainiac's dispute queue: `ORDER BY count FILTER (WHERE verdict='wrong') DESC, count(*) DESC, min(created_at) ASC`. Its **own** promotions queue is FIFO and its standards gate is **alphabetical**. vibeman's primary queue is `created_at DESC`. So P3 is **not** something the fleet has converged on — it is a frontier, and the strongest argument for it in six codebases is the SQL comment in this repo. §2(c) is prescriptive on the strength of a measured local incident, and is labelled accordingly. |
| 4 | **A stated failure direction for "nobody ever answers"** | **MINORITY (1 of 3) — the sharpest silence** | brainiac only, and it states the *product* consequence rather than the mechanism: *"A queue nobody works turns the whole intake into theatre — and the proposers keep filing."* (`console.rs:3187-3191`). vibeman and ascent hang. This is the same 5-of-15 result [`human-review-queue`](./human-review-queue.md) measured inside this repo, reproduced across the fleet — **the omission is universal**, which is evidence the situation is hard and evidence *against* an answer existing to adopt. |
| 5 | **⚠ THE COHORT'S BEST IDEA — the queue's AGE gates something downstream** | **1 of 3, and Personas has nothing like it** | brainiac `health.rs:20-22` `REVIEW_SLO_SECS = 48 * 3600`; `governance_pillar(backlog, oldest_secs)` folds **depth and oldest-item age** into one score; `PUBLISH_MIN_GOVERNANCE = 50` **halts publishing** when that score drops — *"Silence beats confident staleness."* It also ships a **rubber-stamp detector**: decisions landing within 5 s of the same reviewer's previous decision are discounted. Measured against this install, that detector would fire on **59 of 106** `companion_approval` rows. **Adopt this.** §8 Gap 6. |
| 6 | **Anything expires a never-triaged finding** | **PRESENT (2 of 3), BOTH BROKEN — report as a shared failure, not as adoption** | vibeman has a 30-day auto-archive whose **only caller is inside idea generation**, so a project nobody scans ages forever — the sweep is reachable only by the producer it is meant to bound. ascent's purge is opt-in and **default-off**. brainiac has none. Personas' 7-day sweep is the only one in the cohort that actually runs unattended, and §7 D3 is what it does when it runs. **The fleet converged on writing an expiry and not wiring it.** |
| 7 | **A machine drains the human queue automatically** | **MAJORITY (2 of 3), both bounded; Personas is unbounded** | vibeman auto-merges only at `AUTO_MERGE_MIN_IMPACT = 8` **and** `MAX_EFFORT = 3`, and is **explicitly banned from the file watcher** (*"A file watcher must NEVER auto-accept ideas"*) — a stated boundary on *which producer* may trigger an auto-drain. brainiac auto-approves only the raw→candidate hop at ≥0.9/0.95 and makes the canonical promotion **DB-enforced human**. ascent: zero. Personas' companion autopilot removed its allowlist entirely — *"under autonomous mode every proposed action fires"* (`approval_autopilot.rs:785-786`) — which is a defensible reading of standing consent and is **the only unbounded machine drain in the cohort.** |
| 8 | **Re-entry after dismissal is a state, not a re-insert** | **MIXED (2 of 3)** | brainiac keeps `rejected` as a **retained lifecycle state** rather than a delete, so a re-proposal is visibly a second offer; vibeman's stale-archive carve-out is an explicit re-entry rule. ascent dismisses to `dismissed` with no path back. Personas has `reopenIdeaRow` and `superseded_by` and **0 live uses of either**. |

**Physics — keep as doctrine:** clauses 1 and 2 (P2, P7).
**Reported as silence:** clauses 3 and 4 — *nobody has converged on ranking a findings queue by need,
and nobody has converged on stating a failure direction*. P3 and the second half of §2(e) are
therefore **proposals grounded in a local measured incident**, not adoptions. Clause 6 is a silence
wearing agreement's clothes: two siblings wrote an expiry and neither wired it.
**Personas is behind** on 1, 2, 5 and 8, **ahead** on 6 (its sweep is the only one that runs) and
**alone** on 7 (the only unbounded machine drain).

**One downstream observation worth keeping despite disqualification.** `personas-web`
`ReviewsSplitPane.tsx:42-47` sorts the same reviews **pending-first and then by date, ignoring
`severity` entirely** — the identical defect as `observability.rs:175`, reached independently on the
other side of a sync boundary, in TypeScript, with a client-side comparator that **no Rust matcher
could ever see** (§9's disclosed recall gap, demonstrated rather than asserted). And it
auto-approves `info`-severity reviews after an **8-hour SLA** — the same shape as this repo's
60-minute grace, reinvented downstream without either side knowing.

### The composition with `audit-trail-view` — measured, not argued

Doctrine §6 asks what happens to somebody who follows two adjacent paths. Here is the measured
answer, and it is the reason §9 declines to merge with its nearest neighbour rather than being unable
to.

[`audit-trail-view`](./audit-trail-view.md) §2(e) prescribes **"order by the clock and then by the
primary key"**, and its census rule `clock-ordered-history-read-without-tiebreak` (78 files / 141
matches) ratchets toward it. That is correct for a **history**: a stable, reproducible replay of what
happened. It is this leaf's defect for a **queue**.

The overlap numbers make the interaction concrete rather than rhetorical:

- **6 of my 8 violating files (75%) also contain a match of that rule — at 0 shared sites.** The two
  conditions co-occur in the same modules and never in the same statement.
- Its **positive control certifies `db/src/repos/dev_tools.rs:3841`** — `SELECT * FROM dev_ideas
  WHERE {} ORDER BY created_at DESC, id DESC LIMIT` — which is `triage_ideas`, **the flagship
  arrival-ranked findings queue in this repo**: 54 items deep with a 131-day tail and an `impact`
  column populated on 236 of 236 rows. It is compliant by the neighbour's standard and is this leaf's
  worst instance.
- Adding the tiebreak that path asks for makes the order *stable*. It does not make it *right*, and a
  reader who has just satisfied a green ratchet has every reason to think the `ORDER BY` is finished.

**Neither path is wrong. The pair is.** The resolution is one qualifier, offered upward in §12.8: the
clock-then-key rule governs a **history**; a queue a human works through ranks by **need** first and
uses clock-then-key as its *tiebreak within a rank class* — which is exactly the shape
`subscription.rs:1931-1932` already has (`CASE …, created_at ASC`).

## 7. Deviations

Every entry is live on `master` @ `2a874e692` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database. **Per the campaign's no-destructive-applies rule
these are notes for later, not asks** — the operator uses this app daily and every fix below either
changes a schema, changes what a live queue surface shows, or changes which rows a sweep touches.

### D1 — `pending_counts` counts 56 of 370, and a third of its list is dead

`db/src/repos/dev_tools.rs:1338-1387`. Replayed verbatim in §0. Three defects in one function:

1. **Six live queues are unregistered**, holding **314 items** — healing (179, 82 d), incidents (99,
   74 d), KPI proposals (21, 66 d), memory review proposals (4, 98 d), companion approvals (8, 6 d),
   companion backlog items (3, 79 d). None reaches the title-bar badge.
   [`human-review-queue`](./human-review-queue.md) noted KPI proposals and
   [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) noted companion approvals; the
   other four are new here, and healing alone is larger than the entire registered total.
2. **Two of the six registered entries name tables with zero rows, ever.** `policy_proposals` and
   `evolution_promotion_proposals`. The function's own comment says *"The six above. The caller adds
   build questions on top"* — an accurate description of a list that is wrong in both directions.
3. **It stores a number, not a descriptor.** No pending statuses, no decide command, no rank
   expression, no timeout policy, no age. So the badge, the sweep, the drain and any future gate each
   re-derive the queue list independently, which is how the list drifted.

**Fix (note):** a `PendingQueue { table, pending_statuses, decide_command, rank_expr, on_timeout }`
descriptor with one row per queue; derive `PendingCounts` from it; delete the two dead entries and add
the six live ones. *(Not an apply — it changes what the operator's badge shows, from 56 to 370.)*

### D2 — the healing queue dedups on the execution, so 179 rows carry 4 problems

`db/src/repos/execution/healing.rs:1571` + `db/src/migrations/fk_hygiene.rs:523`.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_phi_persona_execution
  ON persona_healing_issues(persona_id, execution_id) WHERE execution_id IS NOT NULL;
```

`create_with_source`'s own header calls this dedup — *"dedup on the `(persona_id, execution_id)`
unique index"* (`healing.rs:180`) — and it is one, for a single execution retried. It cannot dedup a
recurring problem, because the next failure has a new `execution_id` by construction. Live: **179
open rows, 4 distinct titles** ("Transient process failure" ×107, "Execution failed" ×43, "Usage limit
reached — retry scheduled" ×21, "Execution timed out" ×8), across 75 distinct `(persona, title)`
pairs, oldest 82 days. `execution_id` is non-NULL on 204 of 205 rows, so the index applies to
essentially the whole table.

The consequence is not only volume. **A human has never resolved one of these** — all 26 resolutions
carry `auto_fixed = 1` — and a 179-row list of four sentences is precisely the artifact a human
abandons. The queue's depth is a measure of how many executions failed, which the executions table
already knows.

**Fix (note):** a `problem_key` derived from `(persona_id, category, normalized_title)` with a
`UNIQUE` index, an `occurrences` counter and a `last_seen_at`; admit a recurrence with an `UPDATE`.
*(Not an apply — it changes the row count of a live surface and needs a backfill that collapses rows.)*

### D3 — two policies compose into a third, and it disposes of the high-severity items

`src/engine/subscription.rs:1893-1895` + `src/engine/background.rs:815-836` +
`db/src/repos/communication/manual_reviews.rs:542-600`. Executed in §0.

| | auto-triage | `gc_stale_pending` |
|---|---|---|
| opens at | T + 60 min | T + 7 d |
| reads severity | **yes** — declines high/critical *"left for a human"* | **no** — `status = 'pending' AND created_at < ?1` |
| writes | `Approved` via `update_status` (learning memory fires) | `'resolved'` **as a raw SQL string** (no state machine, no memory, no resume) |
| took, live | 142 + 6 = **148** | **20** |
| severity taken | 49 low / 93 medium / 6 high | **2 low / 1 medium / 17 high** |

Four defects stacked:

1. **The composition.** Nobody wrote "dispose of high-severity reviews after a week", and that is what
   the pair does. **17 of 20.**
2. **`'resolved'` is a raw string literal** (`manual_reviews.rs:578`), so
   `ManualReviewStatus::validate_transition` never runs and no reader can distinguish this from a
   human's `Resolved`.
3. **No resume.** `react_to_review_decision` triggers on `Approved | Resolved`, and the sweep does not
   call it. **13 of the 20 carry an `assignment_id`.** This is
   [`human-review-queue`](./human-review-queue.md) P0 with a number attached.
4. **The threshold is a `const` in the background module** (`background.rs:817`), duplicated as
   `.unwrap_or(7)` in the command, with the module's own comment conceding *"exposing it via
   app_settings is tracked as a follow-up"*.

**Fix (note):** the `AgedOut` variant from §4; make the sweep call `update_status`; make ageing out
resume. *(Not an apply — it changes which assignments restart on the operator's next launch.)*

### D4 — every human queue read is arrival-ordered while the rank column sits populated

10 reads across 8 files (the §9 census population), plus `triage_ideas`
(`db/src/repos/dev_tools.rs:3841`) which the rule cannot see. Against:

| table | rank signal | populated | used by any human read |
|---|---|---:|---|
| `dev_ideas` | `impact` / `effort` / `risk` / `priority` | 236/236 · 214 · 214 · 47 | **no** |
| `persona_manual_reviews` | `severity` | 194/194 | **no** |
| `persona_healing_issues` | `severity` | 205/205 | **no** |
| `workspace_knowledge` | `confidence` | 1,304/1,306 | **no** (and see D7) |

The two sharpest instances are the ones with a compliant sibling in the same file:
`src/companion/observability.rs:175` ranks the review queue by `r.created_at DESC` while `:142` ranks
healing by `CASE h.severity`; `approval_exec_fleet.rs:389` shows Athena *the five oldest* pending
reviews while `:435` shows incidents *severity-first*. Both are briefing surfaces for an autonomous
agent, so the ordering decides what it reasons about.

**Fix (note):** lead each `ORDER BY` with the need column. Low risk individually and it changes what
ten live surfaces show. *(Not an apply.)*

### D5 — incident admission is env-gated, and the acknowledge stage has never happened

`db/src/audit_incidents_promoter.rs:38-44`: every promoter is a complete no-op unless
`PERSONAS_INCIDENTS_PROMOTION=1`, described as *"the v1 mitigation"* during a bake-in window. 164 rows
exist, so it ran; nothing states whether the bake-in ended. **A queue whose admission depends on an
environment variable has a depth that is not a property of the product.**

And the lifecycle is one stage short of real: `acknowledged_at` and `acknowledged_by` are **NULL on
164 of 164 rows**. `open` therefore means both "nobody has looked at this" and "somebody is on it",
across 99 rows up to 74 days old. Of the 65 resolutions, 26 are `Healing-retry noise … Promote()`,
~14 are `Resolved by T: <persona> (execution …)` — a *team member* closing it — and 19 are a single
human batch (`Root cause fixed 2026-06-10: …`). So the human drain of this queue is **one afternoon,
once.**

**Fix (note):** decide the flag's fate and write it down; either wire an acknowledge control or drop
the two columns, because a stage nothing writes is worse than a stage that does not exist.

### D6 — four columns describe a lifecycle the code does not implement

| column | populated | what its existence implies |
|---|---:|---|
| `workspace_knowledge.superseded_by` | **0 of 1,306** | that a practice can be replaced rather than re-added |
| `dev_ideas.verify_state` (+ `verify_checked_at`, `verify_evidence`) | **0 of 236** | that a pending finding is re-checked against the code before a human sees it |
| `dev_ideas.dedup_key` | **22 of 236** (all `origin='workspace_practice'`) | that ideas dedup — one producer of ten writes it |
| `companion_backlog_item.reminded_count` | **0 of 3**, aged 79 d | that the queue nudges |

Each reads, to the next author, as evidence that the mechanism exists. `verify_state` is the most
expensive: it is the exact column P7 needs, and a 131-day-old pending idea has never been asked
whether it still applies.

**Fix (note):** implement or delete, per column. Deleting is a migration; implementing changes what a
live queue shows.

### D7 — the one score a queue could rank by does not separate the outcomes

`workspace_knowledge.confidence`, populated on 1,304 of 1,306 rows:

```
adopted   n=1162   min 0.55   mean 0.797   max 0.95
rejected  n= 118   min 0.60   mean 0.779   max 0.92
deprecated n= 24   min 0.65   mean 0.806   max 0.90
```

Overlapping ranges, **1.8 points of mean separation**, and the *deprecated* cohort scores highest of
the three. Ranking this queue by `confidence` would rank it by noise; the risk is that a future author
reads §2(c), finds a score column, and uses it. **A rank signal has to be validated against outcomes
before it is allowed to sort a human's work.** This is [`metric-definition`](./metric-definition.md)'s
territory as much as this leaf's and is flagged in both.

**Fix (note):** either validate the score against adoption and keep it, or stop writing it. Until
then, rank this queue by `evidence_count` (populated) or by `kind`, not by confidence.

### D8 — the rejection reason is recorded at 96% and read by nobody

`dev_ideas.rejection_reason`: 23 of 24 rejections carry one — the best coverage in the app, and
`decide_idea_cas` (`dev_tools.rs:4470-4473`) deliberately uses two statements so *"no reason given"* is
storable. **Zero producers read it.** Every scan starts from the code; none takes the rejected set as
an exclusion. `workspace_knowledge` is worse: **118 rejections and no reason column at all.**

Live, this is invisible — 0 duplicate titles, 0 duplicate `dedup_key`s, 0 re-proposals — because the
corpus is 236 rows across 7 projects and the scans have not repeated. It is latent, not absent: the
mechanism that would prevent re-proposal does not exist, and **2 of 3 independent siblings built one
and wrote down why** (§6 clause 2).

**Fix (note):** pass the rejected `dedup_key` set into the scan prompt as an exclusion, and add a
reason column to `workspace_knowledge`.

### D9 — no queue publishes its own age, and the oldest item is 98 days old

Every count surface in the app publishes a cardinality. Nothing anywhere publishes
`MIN(created_at) WHERE status = 'pending'`. `audit_incidents.rs:357-370` is two statements from being
the first. The operator's badge has read a number between 50 and 60 for weeks while items aged 66, 74,
79, 82, 98 and 131 days behind it, and the number is *correct*.

**Fix (note):** add `oldest_waiting_at` to the registry descriptor in D1 and render it beside the
count. See §8 Gap 6 for the cohort's stronger version of this.

## 8. Gaps

1. **There is no queue registry, only a rollup — and no type can create one.** D1. This is the leaf's
   root cause and it is a genuine limitation rather than laziness: a queue that was never declared
   leaves nothing for a compiler, a linter or a diff to notice (§4(c)). It needs an **inventory**
   instrument, not a gate, and §9 says so explicitly.
2. **Nothing in the app can express "this row and that row are the same problem."** There is no
   problem-identity primitive — no canonicalizer, no normalizer, no similarity helper. `dedup_key` is
   spelled four different ways in four tables and computed by each producer. `vibeman` has one
   (Jaccard + stop-words) and `brainiac` has one (canonical claim key); this repo has four ad-hoc
   strings and one index on an execution id.
3. **No shared sweep.** `gc_stale_pending` is bespoke to one table with a hardcoded threshold;
   `prune_stale_proposed` is bespoke to another. There is no "age out pending rows" mechanism a new
   queue can opt into, which is most of why seven queues in
   [`human-review-queue`](./human-review-queue.md)'s table opted into nothing. Note the cohort agrees
   this is hard: **2 of 3 siblings wrote an expiry and neither wired it to a scheduler** (§6 clause 6).
4. **`ManualReviewStatus` has no non-verdict terminal state**, so the one sweep that does run must
   borrow `Resolved`. §4(a) is the fix and it is one enum variant.
5. **There is no rank contract.** Nothing says which column ranks which queue, so ten reads each chose
   independently and all ten chose the clock. A `rank_expr` on the D1 descriptor would make the choice
   reviewable in one place — and D7 shows why it must also be *validated*, not merely *chosen*.
6. **Nothing gates anything on queue health — and the cohort's answer is worth importing wholesale.**
   `brainiac/…/health.rs:20-22` sets `REVIEW_SLO_SECS = 48*3600`, folds queue **depth and oldest-item
   age** into a `governance_pillar(backlog, oldest_secs)`, and refuses to publish below
   `PUBLISH_MIN_GOVERNANCE = 50`: *"Silence beats confident staleness."* It also discounts decisions
   landing within 5 s of the same reviewer's previous one as rubber-stamping — which, applied to this
   install, fires on **59 of 106 `companion_approval` rows**. Personas has no SLO, no age, no
   governance score and no gate. **This is the single highest-value import in the document.**
7. **The machine's view and the human's view of a queue are unrelated code.**
   `find_triage_candidates` knows about grace, cap and rank; the eight human reads know about none of
   them, and no surface renders `REVIEW_TRIAGE_GRACE_MINUTES`. A reviewer cannot see that their window
   on a low-severity item is one hour.
8. **No queue can answer "what is in here".** `audit_incidents.rs:357-370` is the only breakdown-by-
   severity in the app. For the other twelve, "179 waiting" is the entire available description, and
   for healing the honest description is "4 problems, 179 times".
9. **Nothing links a finding to whether it still applies.** `verify_state` exists and is empty (D6). A
   131-day-old pending idea may name code that no longer exists; the queue cannot tell, and a reviewer
   opening the oldest item first — which §2(c) does *not* recommend, precisely because of this — would
   be reading fiction.
## 9. The missing gate

**The condition, stated stack-free:** *a queue of machine-produced findings is presented to a human in
the order the rows arrived rather than the order they matter — which is merely suboptimal while the
drain is uncapped, and is a starvation schedule the moment it is not.*

**The signal (a proxy, and stated as one):** a SQL read over a **human-decision queue table**,
filtered to a pending-ish status, whose `ORDER BY` **leads with `created_at` / `updated_at`**. This
keys on the shape the condition wears **in this repo**, where every queue is a SQLite table read
through a hand-written statement in Rust. **An adopting repo must re-derive its own proxy** — a
client-side comparator, an ORM `order_by`, a query builder and a materialised view all carry this
condition and none of them match this pattern. That is not hypothetical: the sibling sweep found
`personas-web/…/ReviewsSplitPane.tsx:42-47` sorting the *same reviews* pending-first-then-date with
`severity` ignored, in TypeScript, where no Rust matcher could ever reach it.

**The vocabulary is derived from the tree, not from imagination** — the doctrine's specific warning
about actor-attribution word lists. The twelve table names are `pending_counts`' own six
(`db/src/repos/dev_tools.rs:1352-1375`) plus the six this leaf measured waiting outside it. Not one
was invented.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path writes no script.

**Where it executes:** `npm run census:check` is part of `npm run check`, and it is the
`golden-path-census` **pre-push** job in `lefthook.yml:74-75`. That matters: `ci.yml` is currently red
on 10 pre-existing failures, so **a gate that only runs in CI runs nowhere.** This one fails the push.

**Precision 10/10 on the stated condition; every match opened and read.** All ten are reads of a
human-decision queue whose order is arrival order. On the stricter question *"is this a defect"* it is
also 10/10 — each of the four tables involved carries a populated rank column that the read ignores
(§7 D4).

**The population partitions, and two of the violating files contain their own counter-example:**

| | matches | files |
| --- | ---: | ---: |
| **violating** — a pending-queue read ordered by the clock | **10** | 8 |
| **compliant** — a pending-queue read ordered by need (the positive control) | **3** | 3 |

`src/companion/observability.rs` and `src/commands/companion/approvals/approval_exec_fleet.rs` each
appear in **both**: `:175` ranks the review queue by `created_at` while `:142` ranks healing by
`CASE severity`; `:389` shows the five *oldest* pending reviews while `:435` shows incidents
severity-first. Roughly 40 lines apart, one author. **The control is not a distant compliant
population — it is the adjacent statement**, which is the strongest available evidence that the gate
is discriminating on the thing it names and not on an author's habits.

**Two independent implementations DISAGREED — 10 vs 12 — and hand-verification resolved it for the
census.** Implementation #1 is the census regex. Implementation #2 extracts every Rust string literal
by character scan (tracking escapes, `r#".."#` raw strings and char literals) and then decides each
literal by **ordered substring search**, so no regex spans a file and no lazy quantifier crosses a
statement. It credited `src/engine/subscription.rs:2296` and `:2408`, where `FROM dev_ideas` appears
inside a `NOT EXISTS` predicate while the `ORDER BY` ranks **`dev_projects`** — a different entity.
The census pattern's `(?!FROM)` guard excludes them; #2 had no such guard because its anchor is "the
last `FROM` naming a queue table", which is a reasonable rule that is wrong here. The two agree
**exactly on the compliant set at 3 of 3**, and their line numbers differ by 1–3 throughout
(literal-start versus match-start) — *agreement on what is still not agreement on where.*

**A correction to my own instrument, and it is the doctrine's own failure mode.** The positive control
first returned **2**, missing `find_triage_candidates` — **the single best artifact in this leaf** —
because the span between its status predicate and its `ORDER BY` is occupied by the six-line SQL
comment recording the starvation incident, which is longer than the 400-character limit I had chosen
for tidiness. **The exemplar was invisible to a limit that had no reason to be where it was.**
Widening to 900 recovered it and added **zero** matches to the violating rule, which is how the number
was chosen rather than guessed.

**Existing rules checked for overlap first, by re-running every one of them over its own roots and
intersecting the `file:line` sets — measured, not assumed.** All **79** committed rules that can reach
`src-tauri/**/*.rs` were re-run and **all 79 reproduced their committed baselines exactly**, which is
also the instrument's own check.

| neighbour rule | its files / matches | site overlap | file overlap | why it is a different condition |
|---|---:|---:|---:|---|
| `clock-ordered-history-read-without-tiebreak` ([`audit-trail-view`](./audit-trail-view.md)) | 78 / 141 | **0 (0%)** | **6 of 8 (75%)** | The nearest neighbour, and **the interaction is the finding rather than the overlap** — see §6. It asks *is this order reproducible*; this asks *is this order the right one*. Its positive control **certifies `dev_tools.rs:3841`**, this leaf's flagship defect. Adding a tiebreak satisfies it and leaves the queue arrival-ranked. |
| `untimed-repo-query` | 36 / 245 | 0 (0%) | 3 of 8 | Instrumentation, not ordering. |
| `hand-rolled-emptiness-refusal` | 135 / 305 | 0 (0%) | 3 of 8 | An empty-input guard. |
| `deferred-read-then-write` | 10 / 12 | 0 (0%) | 2 of 8 | A read→write interleave; shares `manual_reviews.rs` and `dev_workspaces.rs` at unrelated lines. |
| `silent-row-skip` · `persistence-handle-in-command-tree` · `hand-rolled-fixture-ddl` · `blind-identity-write` · `unverifiable-conflict-clause` | 64/148 · 46/134 · 37/93 · 35/82 · 40/71 | 0 (0%) each | 2 of 8 each | All co-occur in the same busy repo modules; none shares a statement. |
| 9 further rules | — | 0 (0%) each | 1 of 8 each | Listed for completeness; no shared sites. |
| the other **62** rules | — | **0** | **0** | No contact at all. |

**The largest site-level overlap against all 79 committed rules is 0.** The largest file-level
co-occurrence is 75%, with the neighbour whose prescription this leaf must qualify rather than merge
with.

**Disclosed recall gap — the anchor is a vocabulary plus a syntax, and it misses exactly where the
doctrine says it will.** The pattern requires a literal `status` predicate **in the same SQL string**,
so it **cannot see `triage_ideas`** (`db/src/repos/dev_tools.rs:3841`), whose `WHERE` is a `{}`
format placeholder assembled from `clauses.join(" AND ")` — **the single most important instance of
this condition scores a structural zero here.** It also cannot see: a read assembled by a query
builder; a client-side comparator (demonstrated in the sibling sweep); a rank chosen in a component
rather than in SQL; and — the whole other half of this leaf — **a queue nobody registered**, which is
not greppable because nothing was written. True recall over reads carrying this condition is roughly
**10 of 14**.

**How it fails loudly if its own precondition is absent:** `floor: 900` against a live walk of 963
`.rs` files, so a moved root or a broken glob fails rather than reporting zero; a rule matching zero
files anywhere is a structural failure in the runner; a rise is fatal; a **drop** without `--update`
is fatal; and a baseline on a positive control is rejected by `validateRule`. **All six were verified
by deliberately breaking the rule**, results below.

**What the gate cannot do, stated so nobody trusts it further than it goes:**

- **It cannot see an unregistered queue**, which is D1 and the root of everything else. The census
  ratchets a count of something present; it cannot assert an absence. §9's honest companion is not a
  second rule but a **different instrument** — an inventory of tables carrying a pending-ish status
  column, diffed against `pending_counts`' six, failing on either direction. That is ~30 lines beside
  `check-csp-hosts.mjs`, and it is the one thing that would have caught all six.
- **It cannot see the dedup identity** (D2), which is a schema fact.
- **It cannot see a composition** (D3). Two policies that are each fine and are jointly wrong have no
  textual form at all.
- **It cannot tell a good rank from a bad one** (D7). `workspace_knowledge.confidence` would satisfy
  the positive control and rank the queue by noise.
- **It counts a statement, not a queue.** A table read three times contributes three matches; deleting
  two of them lowers the count without ranking anything, which is why the control must move in the
  opposite direction and why the two counts are published together.

```json
{
  "rules": [
    {
      "id": "pending-queue-read-ranked-by-arrival",
      "goldenPath": "docs/concepts/golden-paths/findings-triage-queue.md",
      "title": "A read of a human-decision queue ordered by the clock rather than by need",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "FROM\\s+(?:persona_manual_reviews|dev_ideas|workspace_knowledge|persona_healing_issues|audit_incidents|dev_kpis|persona_memory_review_proposal|companion_approval|companion_backlog_item|policy_proposals|evolution_promotion_proposals|memory_claims)\\b(?:(?!FROM|GROUP BY)[^\"]){0,900}?status\\s*(?:=|IN)\\s*(?:\\?\\d*|\\(?\\s*'(?:pending|open|proposed|observed|pending_review|awaiting_acceptance|awaiting_review)')(?:(?!FROM|GROUP BY)[^\"]){0,900}?ORDER BY\\s+(?:[A-Za-z_]{1,20}\\s*\\.\\s*)?(?:created_at|updated_at)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A SELECT over one of this repo's human-decision queue tables, filtered to a pending-ish status, whose ORDER BY leads with created_at/updated_at - so the order the reviewer meets the queue in is arrival order and nothing about an item's need can reach the top. PROXY FOR the stack-free condition: a queue of machine-produced findings is ranked by when the row arrived rather than by how much it matters, which is merely suboptimal while the drain is uncapped and is a STARVATION SCHEDULE the moment it is not. THE VOCABULARY IS DERIVED FROM THE TREE, NOT FROM IMAGINATION: the twelve table names are pending_counts' own six (db/src/repos/dev_tools.rs:1352-1375) plus the six this leaf measured waiting outside it. MEASURED 2026-08-17 at 2a874e692: 10 matches across 8 of 963 .rs files under src-tauri, EVERY ONE OPENED AND READ, precision 10/10. THE TEN: manual_reviews.rs:110,:137,:202 (the status-filtered review-queue reads, ORDER BY created_at DESC); dev_workspaces.rs:572 (workspace_knowledge by status, ORDER BY updated_at DESC); healing.rs:132 (get_for_health, the ONLY read of the 179 open healing issues); evolution_proposals.rs:114; approval_exec_fleet.rs:389 (Athena's briefing shows the 5 OLDEST pending reviews); approval_lifecycle.rs:21 (companion_approval inside the 24h freshness window); operations_views.rs:196; observability.rs:175. THE PARTITION IS INSIDE TWO FILES: approval_exec_fleet.rs and observability.rs each contain BOTH a violating match and a compliant one - :389 ranks reviews by the clock while :435 ranks incidents by CASE severity, and :175 ranks reviews by the clock while :142 ranks healing by CASE severity, roughly 40 lines apart in one function by one author. The author knows how to rank a queue; the review queue did not get it. MEASURED LIVE against read-only copies of the operator's personas.db (347 MB) and personas_data.db, taken 2026-08-17 10:54 with the app running, never opened for write, DELETED after: 13 queues hold 370 items waiting on a human and pending_counts can see 56 of them; the other 314 (84.9 percent) are unregistered, oldest 98 days. Every one of these tables carries a populated rank signal that no human read uses - dev_ideas.impact on 236 of 236, persona_manual_reviews.severity on 194 of 194, persona_healing_issues.severity on 205 of 205, workspace_knowledge.confidence on 1304 of 1306. THE REPO HAS ALREADY PAID FOR THIS: engine/subscription.rs:1925-1930 puts a CASE before the clock and says why - Without this, a backlog of legitimately-held high/critical business items at the front of an oldest-first queue permanently STARVES the approvable low/medium reviews behind them under the per-tick cap - the real reason autonomous triage resolved nothing despite 29 approvable pending. That fix was applied to the MACHINE's reader and to no human reader in the app. TWO INDEPENDENT IMPLEMENTATIONS DISAGREED 10 vs 12 AND HAND-VERIFICATION RESOLVED IT FOR THE CENSUS: implementation 2 extracts every Rust string literal by character scan (escapes, raw strings, char literals) and decides each by ordered substring search rather than by a spanning regex; it credited subscription.rs:2296 and :2408, where FROM dev_ideas appears as a NOT EXISTS predicate while the ORDER BY ranks dev_projects - a different entity. The census pattern's (?!FROM) guard excludes them; implementation 2 had no such guard. The two agree exactly on the compliant set at 3 of 3. ZERO SITE-LEVEL OVERLAP with all 79 committed rules that reach src-tauri, measured by re-running every one of them - all 79 reproduced their committed baselines exactly. The largest FILE-level co-occurrence is 6 of my 8 files (75 percent) with clock-ordered-history-read-without-tiebreak (audit-trail-view.md, 78f/141m) at ZERO shared sites, and that is the finding rather than the risk: audit-trail-view.md section 2(e) prescribes order by the clock and then by the primary key, which is correct for a HISTORY and is this leaf's defect for a QUEUE. Its positive control certifies dev_tools.rs:3841 - SELECT * FROM dev_ideas WHERE {} ORDER BY created_at DESC, id DESC LIMIT - which is triage_ideas, the flagship arrival-ranked findings queue in this repo, 54 items deep with a 131-day tail. TWO INDIVIDUALLY-CORRECT PATHS COMPOSE INTO A DEFECT. DISCLOSED RECALL GAP, exactly where the doctrine predicts a vocabulary-keyed anchor fails: the pattern needs a literal status predicate in the same SQL string, so it CANNOT see triage_ideas, whose WHERE is a {} format placeholder built from clauses.join. It also cannot see a query-builder read, a client-side comparator (personas-web sorts pending-first and ignores severity, which this leaf's convergence sweep found and no Rust matcher could), or the absence upstream of everything - a queue nobody registered in pending_counts, which is not greppable because nothing was written. True recall over reads carrying this condition is roughly 10 of 14. Do NOT silence a match by deleting the status filter, by moving the ORDER BY into a format string, or by dropping the read - the honest fix is to lead the ORDER BY with the need column the table already populates."
      },
      "exclude": [],
      "baseline": { "files": 8, "matches": 10 },
      "floor": 900
    },
    {
      "id": "pending-queue-read-ranked-by-arrival-positive-control",
      "goldenPath": "docs/concepts/golden-paths/findings-triage-queue.md",
      "title": "POSITIVE CONTROL - a human-decision queue read ordered by need",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "FROM\\s+(?:persona_manual_reviews|dev_ideas|workspace_knowledge|persona_healing_issues|audit_incidents|dev_kpis|persona_memory_review_proposal|companion_approval|companion_backlog_item|policy_proposals|evolution_promotion_proposals|memory_claims)\\b(?:(?!FROM|GROUP BY)[^\"]){0,900}?status\\s*(?:=|IN)\\s*(?:\\?\\d*|\\(?\\s*'(?:pending|open|proposed|observed|pending_review|awaiting_acceptance|awaiting_review)')(?:(?!FROM|GROUP BY)[^\"]){0,900}?ORDER BY\\s+(?:CASE|(?:[A-Za-z_]{1,20}\\s*\\.\\s*)?(?:severity|priority|impact|score|rank|confidence|weight|urgency))",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition over the same root and extensions: a human-decision queue read, filtered to a pending-ish status, whose ORDER BY leads with a CASE or a need column (severity/priority/impact/score/rank/confidence/weight/urgency) so the reviewer meets the queue in the order the items deserve. Measured 2026-08-17 at 2a874e692: 3 matches in 3 files, against the violating rule's 10 in 8. THE THREE, all opened: (1) engine/subscription.rs:1920 find_triage_candidates - ORDER BY CASE WHEN lower(COALESCE(severity,'medium')) IN ('low','medium') THEN 0 ELSE 1 END, created_at ASC - the only ranked queue read in the app, carrying the starvation incident that produced it in a six-line SQL comment above the clause. (2) approval_exec_fleet.rs:435 - audit_incidents ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1, then created_at DESC. (3) observability.rs:142 - persona_healing_issues ORDER BY CASE h.severity. NOTE (2) AND (3) SHARE A FILE WITH A VIOLATION: the same function bodies rank incidents and healing by severity and rank the REVIEW queue by the clock, roughly 40 lines apart. A MATCH HERE IS NOT A CERTIFICATE: find_triage_candidates ranks correctly and then drains the queue AUTONOMOUSLY at 10 per tick after a 60-minute grace, which is how 148 of this install's 194 reviews were decided by a machine. THE SPAN LIMIT IS LOAD-BEARING AND WAS MEASURED, NOT GUESSED: at 400 characters this control returned 2 and MISSED find_triage_candidates, because the exemplar's own explanatory comment is longer than the span - the corpus's single best artifact for this leaf was invisible to a limit chosen for tidiness. Widening to 900 recovered it and added ZERO matches to the violating rule. A GROUP BY guard excludes aggregate rollups (audit_incidents.rs:357 counts by severity and is not a queue read). Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved; verified by adding one, which exits 1. THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if the violating count falls while this stays flat, a queue read was DELETED rather than ranked. CONVERGENCE CONTEXT, measured against 3 independent siblings: only 1 of 3 ranks any default queue view by need (brainiac's dispute queue). Vibeman's primary queue is created_at DESC, brainiac's own promotions queue is FIFO and its standards gate is alphabetical. Ranking a findings queue by need is a MINORITY practice in the fleet, and this repo holds the fleet's best written argument for it."
      },
      "exclude": [],
      "floor": 900
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private scratch
registry whose filename is unique to this composer, because siblings share the scratchpad>`, never
against the shared `rules.json`, and **the full registry was not run** (doctrine §4). The runner
reports **10 matches / 8 files** for the rule and **3 / 3** for the control over **963** files against
a floor of 900, and `--check` exits **0** at the declared baseline. There are no `exclude` entries, so
there is no stale-exemption surface. **Re-extracted from this finished document and re-run, with
identical counts.**

**Deliberately broken six ways, all fatal as required:**

```
baseline (8f/10m, control 3f/3m)     -> exit 0
floor 2000 > 963 walked              -> exit 1   (matcher/root broken, not codebase clean)
pattern matches zero files           -> exit 1
stale exclude entry                  -> exit 1
baseline too LOW (a rise)            -> exit 1
baseline too HIGH (a silent drop)    -> exit 1
baseline ON the positive control     -> exit 1   (validateRule rejects a control with a baseline)
```

### The instrument this leaf needs that the census cannot be

Stated plainly because the doctrine asks for it: **the largest finding in this document is not
gateable by counting.** D1 is an *absence* — six queues that were never registered — and the census
ratchets what is present. The right instrument is a **`scripts/check-queue-registry.mjs`**: walk the
schema for every table carrying a status column with a pending-ish default, diff that set against the
six `COUNT(*)` statements in `pending_counts`, and **exit 2 in both directions** — a queue in the
schema and not in the registry (six today), and a registry entry whose table has never held a row (two
today). Its precondition guard is the same shape as `check-csp-hosts.mjs`'s: if the schema walk finds
fewer than N tables, fail rather than report clean. That is ~30 lines and it is the only thing in this
document that would have caught all of §0.

### The type, alongside the ratchet

Restating §4 next to the gate, in descending order of what it buys:

- **The ageing status is a one-variant type fix** and it forces three readers to make a decision they
  have never made (§4(a)). Propose it as the fix; this rule does not reach it.
- **The registry is not a type problem at all** (§4(c)) and needs the inventory script above.
- **The dedup identity is a type fix with one construction site**, so it is worth proposing only
  alongside a second producer (Q3).
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a destination
  is only as good as the destination's defaults*). Two of `pending_counts`' six entries name tables
  that have never held a row. Correct the registry **before** routing anyone to it.

## 12. Corrections to the brief

### 12.1 — `sides: "client"` is wrong again, the seventh data point, and here the client half is absent

The brief flagged the label as a hypothesis contradicted on 6 of 6 leaves that tested it. **This is the
seventh, and it fails in the most complete way yet.** Every measurement in this document, the
exemplar (`find_triage_candidates`), every one of the nine deviations, the census rule, its positive
control and its floor are **server-side Rust**. There is no client half to report: the queue's
admission, identity, rank, cap, grace window, sweep and registry are all in `src-tauri/`, and the
frontend's contribution is to render whatever order the SQL returned.

The one client-side instance of this leaf's condition in the entire sweep came from a **sibling** repo
(`personas-web/…/ReviewsSplitPane.tsx:42-47`), and a client-only brief would have found *that* and
nothing here.

**Recommend `both` is wrong too — recommend `server`.** This is worth distinguishing: the doctrine
records `sides: both` holding once, so the field is not pure noise. `"client"` has now failed seven
times and the useful shape of the correction is not always "it was both" — sometimes, as here, the
label is simply **inverted**.

### 12.2 — the `converged` label failed for the fourteenth time, in the mode the doctrine calls "the fleet converged on the disease"

The spine says CONVERGED. **It does not hold, and the cohort it was computed against does not exist.**

- **The effective independent cohort is 3, not 5.** `personas-web` reads `synced_manual_reviews` —
  rows this repo writes — and `personas-cloud` proxies `/api/reviews/pending` to this repo's data.
  Both are **downstream consumers**, disqualified per doctrine §5. `vibeman`'s `ideas` table is a
  **schema port** (same columns, same order, same SQLite defaults) with **independent triage logic**,
  so it is counted for behaviour and not for schema.
- **Of the 3, the clauses split, and a single enum field cannot carry a verdict that splits by
  clause** — the doctrine's own most recent finding, reproduced. Admission identity **converges 3 of
  3** (physics). Rejection-aware admission **converges 2 of 3** (physics). But ranking by need is **1
  of 3**, a stated failure direction is **1 of 3**, and queue-age visibility is **1 of 3**.
- **Three of those clauses fail in the "converged on the disease" mode.** On failure direction the
  fleet agrees by *omitting* it — the same 5-of-15 result [`human-review-queue`](./human-review-queue.md)
  measured *inside* this repo, now reproduced *across* it. On expiry, **2 of 3 siblings wrote a sweep
  and neither wired it to a scheduler** (vibeman's only caller is inside idea generation; ascent's is
  default-off), which reads as agreement and is a shared failure. On ranking, the agreement is
  *"queues are FIFO"* — including brainiac's own promotions queue and its alphabetical standards gate,
  in the one repo that ranks anything by need. **An oracle counting agreement would score this leaf as
  strongly converged three separate times, and each time on an omission.**

**Report loudly, as the brief asks:** the label did not hold. But two clauses **did**, and they are
the two this document promotes to physics — P2 (admit on the problem, not the occurrence) and P7
(rejection is knowledge). A leaf can be 3-of-3 on the clause that matters and still be mislabelled by
one field.

### 12.3 — "168 of 194 review decisions were machine-made" is exactly right, and the decomposition is the finding

Confirmed to the row: **148 auto-triage + 20 aging sweep = 168 of 194 (86.6%)**, human at most 21
(10.8%), 5 with no note. The brief presented it as one number. It is **two doors with opposite
policies**, and separating them is what produced §0's central result: the sweep's population is 85%
`high` *because* the auto-triage door declines `high` by design. The aggregate hides a composition.

### 12.4 — "ask what a triage queue is for when a machine drains it" — answered, and the answer is that the queue is not the control surface

Confirmed to the row: **65 of 106 resolved `companion_approval` rows landed within 2 seconds, 59
within 1 second, minimum 0**, under `approval_autopilot.rs:785-786` — *"the autoapprove ALLOWLIST is
gone: under autonomous mode every proposed action fires."*

The answer the measurement gives: **the control surface is the toggle, and the queue is the receipt.**
That is a coherent product — standing consent is a real thing and the module argues for it well — but
it has three consequences nobody chose. (1) The row a machine produced is byte-identical to a human's,
which is [`audit-trail-view`](./audit-trail-view.md)'s subject and this leaf's cause. (2) The
human-facing surface still *reads* as a work queue, so its depth invites work that will not happen.
(3) **The cohort has an answer and this repo does not**: brainiac discounts decisions landing within
5 s of the same reviewer's previous one as rubber-stamping. Applied to this install, that detector
fires on **59 of 106 rows** — it would have said out loud what took a database replay to find.

And a boundary worth importing with it: **2 of 3 siblings bound their machine drain by producer or by
threshold** (vibeman's *"A file watcher must NEVER auto-accept ideas"*; brainiac's DB-enforced human
gate on canonical promotion). Personas' is the only unbounded one in the cohort.

### 12.5 — the two backlog figures are exact, and one of them understates the problem

**"4 memory proposals / 24 entries, `decided_at` NULL, aged 37–98 days"** — confirmed exactly
(98/98/37/37 d). **"8 `companion_approval` batches past their 24h window"** — confirmed exactly, 8 of
8, oldest 6 d.

What the brief could not have known is that these are **two of six** unregistered queues, and the two
smallest. The same condition holds at **179** and **99** items for healing and incidents, neither of
which any prior path has counted. The backlog is 314, not 12.

### 12.6 — `dev_ideas` is the exemplar the brief describes and the counter-example this leaf needs, simultaneously

**"23 of 24 rejections carry a reason (96%) against 0 of 208 for the JSON-array shape" — confirmed
exactly**, and `decide_idea_cas`'s two-statement write is the right shape for the right reason.

**But measured as a *queue*, which is what the brief asked for, it is the repo's worst instance of
this leaf.** 54 pending with a **131-day** tail and 8 items past 90 days; ranked `created_at DESC`
(`dev_tools.rs:3841`) while `impact` is populated on **236 of 236** rows; `dedup_key` populated on
**22 of 236** (one producer of ten); `verify_state` NULL on **236 of 236**; and its 96%-covered
`rejection_reason` read by **zero** producers, so the reason is recorded and never spent.

**It is the best-drained queue and the worst-ranked one**, and both facts come from the same place:
somebody thought carefully about the *verdict* and nobody owned the *queue*. That is the boundary
between this leaf and [`selective-per-item-verdicts`](./selective-per-item-verdicts.md), drawn by
measurement rather than by assertion.

### 12.7 — corrections to my own instrument, twice, and both are doctrine failure modes

**(a) My first census anchor scored roughly 15% precision** and I nearly shipped it. It keyed on the
pending status literal plus a clock `ORDER BY` with no table vocabulary, returned 20 matches, and was
dominated by `persona_events` (4), `persona_executions` (2) and other **machine work queues**, where
FIFO is correct. The condition I had written said *"waiting on a human"* and the pattern could not
express it. Re-deriving the vocabulary from `pending_counts`' own table list — the tree, not my
imagination — took precision to 10/10. **This is the doctrine's actor-attribution warning exactly:
the word list came first and the reading came second.**

**(b) The positive control's span limit hid the best artifact in the leaf.** At 400 characters the
control returned 2 and missed `find_triage_candidates` — because the distance between its status
predicate and its `ORDER BY` is occupied by the six-line comment recording the starvation incident.
**The exemplar was invisible because it explains itself.** Same family as the CSP checker whose
comment stripper ate the URLs and the grep that ended in `head -3`: a measurement bounded by something
with no relationship to the thing being measured. Widening to 900 recovered it and added zero gate
matches, which is how 900 was chosen.

**(c) And the two implementations disagreed, 10 vs 12.** My structural counter anchored on "the last
`FROM` naming a queue table", which credited two `dev_projects` queries that merely *mention*
`dev_ideas` in a `NOT EXISTS`. Hand-verification resolved it for the census. They agreed exactly on
the compliant set at 3 of 3 and their line numbers differed by 1–3 throughout — **agreement on the
concept, disagreement on the count, and near-agreement on the location, all in one pair.**

### 12.8 — a correction offered upward to `audit-trail-view`, as a qualifier rather than a defect

[`audit-trail-view`](./audit-trail-view.md) §2(e) prescribes **"order by the clock and then by the
primary key"**, and its census rule ratchets toward it across 78 files. That is correct for a
**history** and it is this leaf's defect for a **queue** — measured, not argued: **6 of my 8 violating
files also carry a match of that rule, at 0 shared sites**, and **its positive control certifies
`db/src/repos/dev_tools.rs:3841`**, which is `triage_ideas` — the flagship arrival-ranked findings
queue in this repo, 54 deep with a 131-day tail. A reader who has just satisfied that green ratchet
has every reason to believe the `ORDER BY` is finished.

**The offered qualifier**, one sentence, for that path's §2(e):

> *…for a history. A queue a human works through ranks by **need** first and uses clock-then-key as
> the tiebreak **within** a rank class — see [`findings-triage-queue`](./findings-triage-queue.md) §2(c).*

That is the shape `src/engine/subscription.rs:1931-1932` already has (`CASE …, created_at ASC`), so
the qualifier costs that path nothing and closes a compositional hole doctrine §6 exists to catch.
Neither path is wrong; the pair was.

### 12.9 — one thing the brief did not ask and the measurement volunteered

The brief asked whether a dismissed finding can come back. It cannot, and **the more interesting
result is that nothing has ever tried**: 0 duplicate titles and 0 duplicate `dedup_key`s in
`dev_ideas`, 0 uses of `superseded_by` in 1,306 practice rows, 0 reopens. It is tempting to read that
as evidence the dedup problem does not exist here — and it is not. It is evidence that **the corpus is
too small and too young for it to have surfaced yet**: 236 ideas across 7 projects, with the scans not
yet repeated. Two of three independent siblings hit this and built a defence with the reasoning written
down (*"re-proposes the same rejected idea on every run and turns triage into a treadmill"*). **A
latent defect with a clean live measurement is the one most likely to be closed as "not a problem",
so it is named here explicitly as latent rather than absent.**
