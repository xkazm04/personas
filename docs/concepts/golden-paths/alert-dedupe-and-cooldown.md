# Golden path — Alert dedupe and cooldown

> Situation node: `backend-runtime/scheduling-and-triggers/alert-dedupe-and-cooldown` ·
> [situation spine](../situation-spine.md) · recurrence **12** · risk **MEDIUM** ·
> sides: **server** (incomplete — see [§12.1](#121--sides-server-is-incomplete-the-first-time-that-label-has-failed)) ·
> convergence: **DIVERGED** (tested and **UPHELD** — see [§12.2](#122--convergence-diverged-held-and-it-held-for-a-reason-worth-keeping)) ·
> dimensions: **resilience · function · cost · ui**
> Composed 2026-08-17 against `master` @ `6c97502d3`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` walked **five** times — twice by the
> census engine (rule + control), twice by an independent structural scanner that finds every
> `static NAME:` declaration and reads its type by an **angle-bracket-balanced walk** rather than by a
> spanning regex (with `#[cfg(test)]` removed as **brace-matched ranges**, never a line threshold),
> and once more to re-run **every one of the 84 committed census rules that can reach
> `src-tauri/**/*.rs`** for the site-level overlap table. The frontend half was swept across
> `src/` for its own suppression ledgers. **Every one of the 19 candidate matches and all 12 shipped
> matches were opened and read.**
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (244 tables) and `personas_data.db` (71 tables) were taken 2026-08-17 with the app
> running; the live files were never opened for write and **the copies were deleted at the end of
> composition**. Four things were replayed verbatim against them: the healing queue's
> **`UNIQUE (persona_id, execution_id)`** index (`db/src/migrations/fk_hygiene.rs:523`); `promote()`'s
> **two-layer identity** — `make_dedup_key` plus the open-duplicate title guard, with
> `normalize_title_key` and `strip_counter_suffix` transcribed character-for-character from
> `db/src/repos/execution/audit_incidents.rs:98-148` including its **64-BYTE** truncation;
> `enqueue_if_new`'s `(trigger_kind, trigger_ref) AND status IN ('queued','delivered')` predicate
> (`src/companion/proactive/mod.rs:280-284`); and **six candidate cooldown windows from 60 s to 7 d
> replayed against the real inter-arrival times** of every recurring problem in the healing queue.
> That last replay is what produced §0, and nobody had run it.
>
> **Nothing was raised, acknowledged, resolved or dismissed in the live app. `cargo` was not run.**
> Every Rust claim is static and traces to a file opened during composition.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened, **two disqualified**, leaving an effective
> independent cohort of **3** (§6). It inverted the brief's central premise and it found the two
> opposite poles this leaf has to choose between, each argued in a comment.
>
> **Settles:** what makes two alarms "the same", where that identity lives, what a cooldown is
> measured from, whether it survives a restart, and what happens the tenth time.
>
> Cross-reference, not overlap. [`idempotent-invocation`](./idempotent-invocation.md) owns **one
> request not being executed twice** — the key derived from the request, the UNIQUE arbiter, the
> `Created | Deduped` return. This owns **one problem not being announced twice**, which is a
> different key over a different lifetime. [`findings-triage-queue`](./findings-triage-queue.md) owns
> **the queue as a population** — its depth, rank, drain and age. This owns **admission**: what gets
> in and what is silently refused. [`stall-watchdog`](./stall-watchdog.md) owns **noticing that a loop
> died**; its §2(d) and this leaf's §2(a) point in opposite directions and [§6](#the-composition-with-stall-watchdog--measured-not-argued)
> resolves it. [`domain-event-publication`](./domain-event-publication.md) owns **naming the event**;
> this owns whether it should be emitted at all.

> **Post-publication note — 2026-08-17: the promoter population is 15, not 8.** Measured by
> the `dead-letter-triage` composer: there are **fifteen** promotion doors — 7 behind
> `PERSONAS_INCIDENTS_PROMOTION=1` and **8 direct, ungated** ones. Every "seven of the eight
> promoters" below counts only the gated family, so the §7 D12 claim that an unset flag makes
> the promoters no-ops is true of 7 doors and false of the other 8. The Q3 construction-site
> count for the proposed `ProblemKey` moves with it.

---

## 0 The headline: every table in this database shaped to hold an alarm identity is empty, and every table holding live alarms is keyed on the occurrence

Six tables in `personas.db` carry exactly the schema this path prescribes — a stable problem key, an
occurrence counter, a first/last-seen pair. **All six hold zero rows.** The tables that actually hold
this install's alarms carry an occurrence key, or no key at all.

```
tables SHAPED for a problem identity                              rows   the shape they carry
  healing_knowledge                                                  0   UNIQUE(service_type, pattern_key)
                                                                         + occurrence_count + last_seen_at
  automation_suggestions                                             0   UNIQUE(event_type, persona_id)
                                                                         + occurrence_count + first_seen_at + last_seen_at
  schedule_missed_runs                                               0   missed_count + first_missed_at + last_missed_at
  alert_rules / fired_alerts                                       0/0   the app's NAMED alerting subsystem
  budget_alert_rules                                                 0
  circuit_breaker_state                                              0   opened_at (the cooldown anchor)
  notification_subscriptions                                         0
  incident_diagnoses                                                 0

tables actually HOLDING alarms                                    rows   the identity they use
  persona_healing_issues                                           205   UNIQUE(persona_id, execution_id)   <- the occurrence
  audit_incidents                                                  164   dedup_key = "<source_table>:<source_id>",
                                                                         source_id is a live persona_executions.id
                                                                         on 100 of 164 rows                 <- the occurrence
  companion_proactive_message (personas_data.db)                    76   (trigger_kind, trigger_ref)
                                                                         gated on OUTSTANDING state         <- the problem
  healing_audit_log                                                 27   no key of any kind
  dev_ideas                                                        236   dedup_key on 22 (see §12.6)
```

`fired_alerts` deserves its own line. It is the table named for this leaf, and its columns are
`id, rule_id, rule_name, metric, severity, message, value, threshold, persona_id, fired_at, dismissed`.
**There is no dedup key, no occurrence counter, no `last_fired_at`, no `suppressed_until` and no
resolution state.** The only thing that keeps it from stacking is a cooldown computed in Rust from
`ORDER BY fired_at DESC LIMIT 1`. It has never held a row, because `alert_rules` has never held a
row, so `tick()` returns at `if enabled.is_empty()` (`src/commands/execution/alert_evaluator.rs:201`)
and the app's one restart-proof cooldown has never executed.

### Executed: cooldown versus identity, head to head, over the same 205 rows

`persona_healing_issues` is the only alarm table on this install with enough recurrence to decide the
question. Every row was bucketed by its `(persona_id, title)` problem and each candidate suppression
window replayed against the real inter-arrival times:

```
                                                     205 rows ->   kept   suppressed
  ACTUAL: UNIQUE (persona_id, execution_id)                         205        0    ( 0.0%)
  cooldown     60 s on (persona, problem)                           200        5    ( 2.4%)
  cooldown    600 s                                                 198        7    ( 3.4%)
  cooldown   3600 s   (= alert_evaluator's FIRED_COOLDOWN_SECS)     175       30    (14.6%)
  cooldown   6 hours  (the fleet's emergent constant, §6)           153       52    (25.4%)
  cooldown  24 hours                                                145       60    (29.3%)
  cooldown   7 days                                                 110       95    (46.3%)
  IDENTITY on (persona, problem)                                     93      112    (54.6%)
```

Three results, and the third is the one to keep.

1. **The deployed key has collapsed nothing. Zero rows, out of 205.** `execution_id` is non-NULL on
   204 of 205, so the index applies to essentially the whole table, and by construction the next
   failure carries a new `execution_id`. `create_with_source`'s own header calls it dedup
   (`db/src/repos/execution/healing.rs:180`). It is — for one execution retried, which has never
   happened here.
2. **A cooldown is strictly dominated by identity, at every window.** Even a **seven-day** window —
   absurdly long for an operational alarm — suppresses 95 while the identity collapses 112.
3. **And the cooldown pays for its smaller win by destroying the record.** A suppressed occurrence
   leaves nothing: no counter, no `last_seen_at`, no evidence it happened. A collapsed occurrence
   leaves an `occurrences + 1` and a fresh timestamp. **The 179 open rows carry 4 distinct titles**
   ("Transient process failure" ×107, "Execution failed" ×43, "Usage limit reached — retry scheduled"
   ×21, "Execution timed out" ×8) across **47 personas** and **75 distinct `(persona, title)` pairs**,
   largest group 9. The queue's depth measures how many executions failed — a number
   `persona_executions` already knows.

### And the identity defect is a column choice, not a string-matching problem

The repo owns a careful title normalizer (`normalize_title_key`, lowercase + whitespace collapse +
one volatile counter suffix stripped, 64 bytes). Applied to the healing queue it produces **exactly
the same 75 groups** as raw `(persona_id, title)` — because the four titles are already canonical
constants. **Nothing about the normalizer would have helped; the entire defect is which columns the
`UNIQUE` index names.** Conversely, over `audit_incidents`' 164 titles the normalizer's apparatus
is nearly inert in the other direction: **0 of 164 titles carry the volatile counter suffix
`strip_counter_suffix` was written for**, its 64-byte truncation touches **88 of 164 (53.7%)**, and
across the whole table it merges exactly **one** pair that a plain lowercase would have kept apart.
A normalizer is a rounding rule. It cannot rescue a key that names the wrong thing, and it is where
false merges come from when the key is already right.

### What the incidents inbox's two-layer identity actually does

`promote()` has two gates: a per-source `dedup_key UNIQUE` and, on top, an **open-duplicate title
guard** scoped to the persona (or, for persona-less system sources, to the `kind`). Replayed:

```
  164 rows, 99 open, 164 distinct dedup_key (the UNIQUE holds)
  open rows under layer 1 (dedup_key)                    99 groups / 99 rows   0.0% duplicate
  open rows under layer 2 (persona|normalized title)     99 groups / 99 rows   0.0% duplicate
  open rows under normalized title alone (fleet-wide)    64 groups / 99 rows  35.4% "duplicate"
```

**The guard is airtight for its own key.** The residual 35.4% is not a leak — it is the deliberate
per-persona scope: "transient process failure" is open for **11 different personas**, "execution
failed" for 10, "usage limit reached" for 9. Whether one fleet-wide cause deserves 11 rows is a
product question this document raises (§7 D3) and does not call a bug.

Two things the guard does *not* do, both by design and both written down:

- **88 of 164 rows (53.7%) bypass the title guard entirely.** `CONTINUABLE_SOURCE_TABLES =
  ["persona_blocker", "team_assignments"]` (`audit_incidents.rs:81`) skip it so each distinct blocked
  execution keeps its own row for the continuation loop. Inside that bypassed set the guard key would
  have collapsed **1 of 88 (1.1%)** — so the exception costs almost nothing here, and the reason is
  recorded in eight lines of comment.
- **A resolved problem re-enters as a fresh row, not a state transition.** 11 guard-key groups hold
  more than one row; 10 are non-continuable and every one reads `resolved, resolved, open` or
  `resolved, open`. That is correct behaviour — a recurrence after a fix should reopen — implemented
  as a re-insert with a brand-new `dedup_key`, so nothing downstream can see that this is the third
  time.

### The cooldown that works, the budget that binds, and the adaptor that has no fuel

The one complete answer in the app is Athena's proactive pipeline, and its live numbers separate the
layers that work from the layer that cannot:

```
  76 proactive messages, 49 distinct (trigger_kind, trigger_ref)
  terminal states:  expired 61 (80.3%)   delivered 14   dismissed 1   engaged 0
  global daily cap        GLOBAL_DAILY_CAP = 12   max actual day = 10   -> NEVER BOUND
  per-kind cap            dev_goal* = 2           hit exactly 2 on 6 separate days -> BINDS
  engagement modulation   needs >= 5 (engaged+dismissed) in 30 d; whole-history total = 1 -> NEVER RAN
```

**The layer that adapts to the user reads two statuses the user almost never produces.** 80.3% of
proactive cards reach `expired`, which is neither engagement nor rejection, so the modulator's input
is 1 sample in 26 days and it has never moved a cap. The layer that actually shapes the operator's
day is the flat per-kind cap, and nothing anywhere records that a card was refused by it.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and everything else is downstream.** **An alarm's identity is the problem, never
> the occurrence that revealed it.** A key containing the run, the execution, the event, the attempt
> or the timestamp guarantees the next recurrence is a new alarm, because the next occurrence has a
> new one by construction.
> *Warrant: measured at 205 rows and 0 collapses under a key naming the execution; 93 groups under
> a key naming the problem. **3 of 3 independent siblings key a durable finding on an entity or a
> canonical claim, and none on a run.***
>
> **P2 — physics, and the most surprising result here.** **Identity strictly dominates a cooldown,
> and a cooldown is what you use when you have failed to find an identity.** Collapsing onto one row
> suppresses more and loses nothing; a time window suppresses less and destroys the evidence that the
> thing recurred.
> *Warrant: executed head to head over the same 205 rows — a seven-day window suppresses 46.3% and
> erases 95 occurrences; the identity collapses 54.6% and keeps every one as a counter.*
>
> **P3 — physics.** **A suppression window must be derived from the period of the thing it guards,
> not chosen as a constant.** The right window for a daily ritual is a day; for a fifteen-minute
> cadence it is fifteen minutes. A global constant is right for exactly one producer and wrong for
> every other.
> *Warrant: this repo derives one cadence guard from the cadence's own declared duration and
> hard-codes an 18-hour one beside it; the fleet's two independent cooldown constants landed on the
> same six hours by coincidence, in codebases with nothing else in common.*
>
> **P4 — physics.** **Suppression must expire on the condition, not only on the clock — and if it
> expires on the clock, something must age it out.** A guard that reads "an unresolved alarm already
> exists" is correct exactly as long as *unresolved* is reachable. The moment a state can be entered
> and never left, the guard becomes a permanent mute.
> *Warrant: this repo's own incident, in its own words — a row that lost its delivery slot stayed in
> an intermediate state that the dedupe guard treated as blocking, so that alarm could never fire
> again. **Twenty were stranded, the oldest for seven weeks.** The fix was three aging sweeps.*
>
> **P5 — physics, and it is what makes P2 safe.** **Suppressing an occurrence and re-announcing a
> standing condition are two different jobs, and one mechanism cannot do both.** Identity governs the
> ROW; a cadence governs the NOTIFICATION. Collapse the recurrence onto one row, and re-announce that
> row on a schedule derived from its own urgency.
> *Warrant: the corpus contains both halves of this argument as separate prescriptions that
> contradict each other (§6), and the fleet contains the same fork argued in comments — "pager
> fatigue trains a team to mute the exact channel" against "a stalled queue that stays stalled SHOULD
> keep paging". Neither is wrong. Both are answering half the question.*
>
> **P6 — physics.** **A suppression ledger that lives in process memory has an undeclared window: one
> process lifetime.** It resets on restart, is invisible to any second evaluator of the same
> condition, and where it is a one-way latch it suppresses without bound until the process dies.
> Whether that is acceptable is a decision; it must be a *stated* one.
> *Warrant: **12 process-global suppression ledgers** measured here against **5** that ask the same
> question of a durable store. Across the independent cohort, **only one repo persists any
> suppression state at all**, and only for one of its two alert paths.*
>
> **P7 — ergonomics with teeth.** **Repetition is information. Count it, and escalate on it.** The
> tenth occurrence of a problem is a different event from the first, and a system that only suppresses
> cannot tell them apart — so a permanent condition and a one-off look identical to every reader
> downstream.
> *Warrant: **0 of 3 independent siblings escalate on repetition** — no occurrence counter, no
> severity bump, no "Nth time" anywhere in the cohort. The one instance found in six codebases is in
> this repo, and it had to keep its counter in a process-global because **the incident spine it feeds
> has no occurrences column**, which its own comment says out loud.*
>
> **P8 — ergonomics.** **Say what you suppressed.** A refused alarm that leaves no trace is
> indistinguishable from an alarm that never happened, to the user and to the next author debugging
> why they were not told.
> *Warrant: this install's per-kind daily cap binds on 6 of the last 12 active days and there is no
> surface anywhere that says a card was withheld; the one repo in the cohort that counts its
> suppressions returns them in a cron response no human reads.*
>
> **Scale condition.** P1 and P2 bite at the second occurrence of one problem. P3 bites at the second
> producer. P4 bites the first time an intermediate state can be entered and not left. P5 bites the
> first time an alarm describes a condition rather than an event. P6 bites at the first restart. P7
> and P8 bite the first time someone asks "how long has this been happening?"

---

## 1 Trigger

- "It fired the same alert eleven times." / "Why is this list 179 items of the same thing?"
- "Add a cooldown so it stops spamming." / "Don't notify more than once an hour."
- "Should this re-alert while the condition is still true, or stay quiet?"
- "It stopped telling me about X and I don't know why."
- "It went quiet after the restart, then told me everything again."
- "This has been failing all week and it looks exactly like it failed once."

**If you are about to write** a `UNIQUE` index or `dedup_key` on a table a human is meant to read; a
`format!("{}:{}", something, an_id)` used as an idempotency key; a `HashMap<String, Instant>` /
`HashSet<String>` consulted before emitting; a `WHERE … AND created_at > <cutoff>` that answers "have
I already told them"; a `const *_COOLDOWN_*` / `*_WINDOW_*` / `*_THRESHOLD`; an `INSERT OR IGNORE`
into an inbox; or a call to a notification sink — **you are in this situation.**

You are **not** in it for **an event log or a work queue**, where every occurrence is the record and
FIFO is correct — `persona_events` holds 4,972 rows with `(event_type, source_id)` repeating up to
**96 times** for one team, and that is right. Nor for **idempotency of a request**, which is
[`idempotent-invocation`](./idempotent-invocation.md): there the key comes from the *request* and the
lifetime is one invocation; here the key comes from the *problem* and the lifetime is however long
the problem lasts. The discriminator: **are you preventing a second execution, or a second
sentence?**

### Boundaries with the adjacent leaves

- [**`idempotent-invocation`**](./idempotent-invocation.md) — its §2(a) *"derive the key from the
  request, never from the attempt"* is P1's sibling and needs one qualifier here: **for an alarm the
  request IS the attempt.** The occurrence that revealed the problem is exactly the thing you must
  key away from. Its §2(d) *"return which branch fired — `Result<T>` cannot carry the one bit the
  dedupe produced"* is **already satisfied by this repo's alarm doors**, which return
  `Result<Option<T>>`; §6 names the one call site that spends that bit correctly and §7 D6 names the
  ones that throw it away.
- [**`findings-triage-queue`**](./findings-triage-queue.md) owns the queue as a population — depth,
  rank, drain, age. Its P2 (*admit under the identity of the problem*) and this leaf's P1 are the same
  clause reached from two directions; this document supplies the executed replay that P2 asserted, and
  corrects two of its deviations (§12.6, §12.7).
- [**`stall-watchdog`**](./stall-watchdog.md) §2(d) prescribes *"dedupe by time window, **never** by a
  key the store makes unique forever, and never read 'the insert affected 0 rows' as 'already
  handled'"* — the exact inverse of P1/P2. Both are right about their own leaf. See
  [§6](#the-composition-with-stall-watchdog--measured-not-argued) and §12.4.
- [**`domain-event-publication`**](./domain-event-publication.md) owns naming and publishing the
  event; this owns whether it is emitted. Its §2(f) *"do not treat 'published' as 'handled'"* is P4
  from the other side: a row in an intermediate state is not a delivered alarm, and treating it as one
  is what strands the guard.
- [**`background-loop`**](./background-loop.md) owns the tick. This owns what the tick is allowed to
  say twice.

## 2 The one way

**Decide what makes two alarms the same problem before you write the first insert; put that in a
`UNIQUE` key and admit a recurrence by bumping a counter rather than inserting a row; then, separately,
decide how often that one row is allowed to speak, from a window derived from its own period and
persisted where a restart can see it.** Concretely: **(a) the key is `(entity, normalized cause)` and
must not contain a run, execution, event, attempt or timestamp id** — write it out as a sentence first
("two rows are the same alarm when they name the same persona and the same failure class"), and if
your sentence contains "the same run" you have written the defect. **(b) Admit the second occurrence
with `UPDATE … SET occurrences = occurrences + 1, last_seen_at = ?`, never a second row** — the
counter is what makes suppression free, because nothing is lost. **(c) Prefer a state predicate over a
time predicate**: "an *unresolved* alarm already exists for this key" is a better guard than "one was
raised within the last N hours", because it tracks the condition instead of the clock. **(d) Whenever
you write (c), also write the sweep that ages every non-terminal state out** — a guard keyed on an
outstanding state is a permanent mute for any state that can be entered and not left, and the aging
window must be derived from *whether the producer will re-raise*: generous where nothing will re-fire,
tight where the trigger is idempotent and can restate its case with fresh text. **(e) Where a time
window is genuinely the right instrument, derive it from the guarded thing's own period** and give it
a named constant with its purpose beside it; a global default is a fallback, not a design. **(f)
Persist the suppression state.** A `HashMap<_, Instant>` is a window of "one process lifetime" that
nobody declared; if you choose it, say in the comment that a restart re-fires and why that is
acceptable. **(g) Make the emission conditional on the durable admission** — `if let Ok(Some(id)) =
promote(…) { notify(…) }` — so the notification and the row can never disagree; never `let _ =
promote(…);` followed by an unconditional notify. **(h) Re-announce a standing condition on a cadence
even though its row is deduped**, because P1 collapses the record and must not collapse the reminder;
that cadence is a second, separate decision from the identity. **(i) Escalate on the counter** — a
severity bump, a different channel, or simply "the 12th time in 30 minutes" in the title — and **(j)
disclose the suppression**: "3 similar alerts suppressed" beside the one you showed. Then stop: do not
add a second cooldown over an existing guard, do not silence by narrowing the key, and do not let two
evaluators of the same condition keep separate ledgers.

If you must get one right first: **(a)**. (b) through (j) are all recoverable later; (a) is the one
whose failure is *invisible* — the queue fills with rows that each look correct, the index reports
that it is deduplicating, and the only way to find out is to group the rows by hand.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/companion/proactive/mod.rs:268-291` — `enqueue_if_new` | **the one correct admission guard in the app, and the site to copy.** `(trigger_kind, COALESCE(trigger_ref,'')) AND status IN ('queued','delivered')` — a **state** predicate, not a time one. Its comment states the rule: *"Engaged/dismissed/expired don't block — those are resolved."* Suppression lasts exactly as long as the alarm is still up. |
| `src/companion/proactive/mod.rs:223-263` — `sweep_lifecycle` | **the sweep that makes the guard above safe (P4).** Three aging arms plus a retention prune, run **before** every insert and every release so a row aged past its window unblocks its own dedupe on the same pass. `PROACTIVE_QUEUED_EXPIRY_WINDOW = "-1 day"`, `PROACTIVE_DELIVERED_EXPIRY_WINDOW = "-7 days"`, `PROACTIVE_SCHEDULED_EXPIRY_WINDOW = "-7 days"`, `PROACTIVE_RETENTION_WINDOW = "-30 days"` — and **each window's length is argued from whether the producer will re-raise.** |
| `src/companion/proactive/triggers.rs:435-455` — `cadence_dedupe_window_min` + `recently_nudged` | **P3, implemented.** The suppression window is the ritual's own `duration_min`, floored at 1 minute, defaulting to `CADENCE_MATCH_WINDOW_MIN`. *"The floor stops same-evaluation-tick duplicates without widening the dedupe past the firing window."* Copy this before you copy any constant. |
| `db/src/repos/execution/audit_incidents.rs:150-235` — `promote` | **the two-layer identity.** Layer 1 `dedup_key UNIQUE` = same source row; layer 2 the open-duplicate title guard = same problem, different occurrence. Returns `Result<Option<String>>`, so the caller gets the one bit the dedupe produced. **Copy the mechanism; choose a better `source_id` (§7 D1).** |
| `db/src/repos/execution/audit_incidents.rs:98-148` — `strip_counter_suffix` + `normalize_title_key` | **the normalizer, and its walked-back over-correction.** Its docstring records that an earlier version collapsed every digit run to `#` and *"silenced the second as a false duplicate"* — so `PR #4 stuck` and `PR #7 stuck` merged. Read the docstring before widening any normalizer. |
| `src/engine/subscription.rs:3059-3083` — the fleet-stall watchdog | **§2(g), the one site that spends the dedupe bit correctly.** `source_id` is the literal `"fleet_stall"`, so exactly one incident can ever be open; the OS notification is inside `Ok(Some(_))`. One stall, one page. |
| `engine/src/cli_mcp_config.rs:87-121` + `src/engine/runner/mod.rs:1290-1320` | **the only escalate-on-repetition in six codebases (P7).** `note_sidecar_missing` counts occurrences in a trailing `SIDECAR_MISSING_WINDOW` (30 min), pruning as it goes; the runner raises an incident only at `SIDECAR_MISSING_INCIDENT_THRESHOLD = 3`, with `source_id = persona.id` — **the entity, not the occurrence** — and puts the count in the detail text. It is also the clearest statement of §8 Gap 2, in its own comment: *"There is no occurrence counter on the incident spine itself, so we count here."* |
| `src/commands/execution/alert_evaluator.rs:57` + `:152-163` + `:215-219` | **the restart-proof cooldown (P6).** `FIRED_COOLDOWN_SECS = 3600` compared against `SELECT fired_at FROM fired_alerts WHERE rule_id = ?1 ORDER BY fired_at DESC LIMIT 1`. The state is a durable table, so it survives a restart **and** is the shared arbiter between the two evaluators. |
| `src/companion/proactive/budget.rs:23-48` — `GLOBAL_DAILY_CAP = 12` + `kind_cap` | **a two-layer attention budget, persisted per UTC date**, claimed atomically at release. *"crossing midnight UTC resets cleanly without a cron."* A per-kind cap so one noisy leg cannot crowd out another. |
| `src/companion/proactive/quiet.rs` | **suppression windows as user-declared data** (quiet hours / focus windows), read from rituals rather than hard-coded. |
| `db/src/repos/dev_tools.rs:4160-4244` — `create_finding` + `db/src/migrations/incremental.rs:5278-5281` | **the identity door with a partial `UNIQUE` behind it** (`idx_dev_ideas_dedup_unique ON dev_ideas(project_id, dedup_key) WHERE dedup_key IS NOT NULL`), a COUNT pre-check *and* a race-loser arm, and the property that matters most: the gate **matches any status including `rejected`**, so a human "no" is durable until the row is deleted. |
| `db/src/repos/dev_tools.rs:3903-3934` — `normalize_idea_title` / `scan_dedup_key` | **a stated identity for a machine-produced finding**: `scan:<type>:<scope>:<12 significant words>`. The scope is part of the identity *"the same title raised for two different areas of the codebase is genuinely two ideas"*. |
| `db/src/repos/dev_tools.rs:4329` + `dev_tools_list_finding_dedup_keys` | **the exclusion set, exported to the producer.** *"Every dedup key already spoken for on this project — the sweep's pre-filter, so N drafts cost one query instead of N existence checks."* |
| `db/src/repos/dev_workspaces.rs:199` — `REJECTED_DEDUP_WINDOW_DAYS = 90` + `DedupVerdict` | **a typed dedup verdict and an expiring rejection.** *"Rejected practices are retained so miners don't re-propose them; the block expires after this many days ('rejection is knowledge', but not forever)."* |

**Do NOT build:** a `UNIQUE` index whose second column is an execution/run/event id and call it dedup;
a `dedup_key` composed as `<source>:<a fresh uuid>`; a cooldown constant chosen without reference to
the guarded thing's period; a `HashMap<_, Instant>` suppression ledger without a comment saying a
restart re-fires; a state-predicate guard without the sweep that ages that state out; a second
cooldown layered over an existing guard; a notification emitted outside the `Some` arm of the door
that deduped it; another `occurrence_count` column with no writer.

## 4 Steps

1. **Write the identity as a sentence, then as a column.** *"Two alarms are the same when they name
   the same `<entity>` and the same `<cause class>`."* If the sentence names a run, stop. Then:
   `problem_key TEXT NOT NULL` with a `UNIQUE` index, `occurrences INTEGER NOT NULL DEFAULT 1`,
   `first_seen_at`, `last_seen_at`.
2. **Admit a recurrence with an UPDATE, not an INSERT.** `INSERT … ON CONFLICT(problem_key) DO UPDATE
   SET occurrences = occurrences + 1, last_seen_at = excluded.last_seen_at`. This is the step that
   makes every later decision cheap.
3. **Decide the guard: state or time.** Prefer state — *"an unresolved alarm with this key exists"*.
   Copy `enqueue_if_new`. Use time only when there is no durable row to point at.
4. **If you chose state, write the aging sweep in the same commit.** One arm per non-terminal state,
   each window argued from whether the producer will re-raise, and the sweep must run **before** the
   dedupe check so a freshly-aged row unblocks on the same pass.
5. **If you chose time, derive the window.** `cadence_dedupe_window_min` is the template: read the
   guarded thing's own period, clamp it, and name the constant. A bare constant is acceptable only
   with a comment saying which producer it was chosen for.
6. **Ask whether the type can make the wrong call impossible — before you write the gate.** Here it
   can for two of three sub-conditions; see below.
7. **Put the suppression state where a restart can see it**, or write down that it cannot. If you keep
   it in memory, say in the comment what a restart does and why that is the right default —
   `webhook_notifier.rs:500-506` and `team_slack_relay.rs:96-97` both do this well.
8. **Gate the emission on the admission.** `match promote(…) { Ok(Some(id)) => notify(…), Ok(None) =>
   {} , Err(e) => warn!(…) }`. Never `let _ =` then notify.
9. **Add the re-announce cadence as a separate decision** (P5). Write down how long the one row may
   stay quiet while its condition persists, and whether silence means fixed or means forgotten.
10. **Escalate on the counter and disclose the suppression.** Put `occurrences` in the title or the
    severity, and render "N similar suppressed" beside the one you showed.
11. **And then stop.** Do not add a second cooldown, do not narrow the key to silence noise, and do
    not let two evaluators of one condition keep two ledgers.

### Can the type make the wrong call impossible? — asked before §9

**Partially, and the honest answer splits three ways.**

The bad state is *"the same problem is announced N times, or announced once and then silently muted
forever."* Three sub-states, unequally reachable by a type.

**(a) The occurrence key — a type closes it, and this is Q5/Q6 exactly.** The dangerous freedom is the
*occurrence id*, not the identity of what recurred. A newtype

```rust
pub struct ProblemKey(String);           // private field — Q4
impl ProblemKey {
    pub fn new(entity_id: &EntityId, cause: CauseClass) -> Self { … }   // no other constructor
}
```

withholds the occurrence id while handing back the answer (Q6). `CreateAuditIncidentInput.source_id:
String` is what makes `alert.id`, `entry.id` and `ctx.execution_id` spellable at all; taking the
`String` away and demanding a `ProblemKey` makes seven of the eight promoters fail to compile until
somebody decides what the problem *is*. Held against the qualifications: **Q3 is the live risk** —
`ProblemKey` would have 8–10 construction sites today, all of them in one promoter module, which is
enough (unlike `findings-triage-queue`'s single-site version of the same idea). **Q4 is decisive**:
a public field makes it a comment. **Q7 holds**: nothing *forced* `source_id: alert.id` — the field's
type permitted it — so withholding the permissive constructor is the fix.

**(b) A process-lifetime cooldown — the type ALREADY says so and nobody reads it.** `Instant` is
monotonic-since-an-unspecified-epoch: it cannot be serialized, cannot be compared across processes,
and has no wall-clock meaning. **`Mutex<HashMap<String, Instant>>` is already a declaration that this
suppression window ends at process exit** — the type is correct and completely honest, and it is
still the defect, because the honesty is invisible at the call site 400 lines away where somebody
reasons "we don't re-alert for 30 minutes". This is the sharpest local instance of doctrine Q1: **the
type carries exactly what it encodes and not the consequence.** No stronger type helps; what helps is
the census rule in §9 and the comment discipline `webhook_notifier.rs:503-505` already shows.

**(c) The state-guard-without-a-sweep — no type reaches it, and it is the leaf's worst failure.** The
bad state is *"a status exists that can be entered and not left, and a dedupe guard treats it as
blocking."* That is a statement about the **reachability of a transition graph**, and every piece of
it type-checks: the status enum is closed, the guard's predicate is a legal `IN` list, the sweep that
would age the state out is a *function nobody called*. Doctrine's *"where types cannot reach"* item 4
— **a thing that was never declared** — gains its clearest instance: no signature is short a
parameter and no enum is short a variant. This repo paid **twenty stranded rows, the oldest for seven
weeks**, to learn it. The instrument that finds it is an inventory of non-terminal statuses diffed
against the sweep's `SET status =` arms, not a compiler and not a gate (§9).

**And one destination needs fixing before any gate points at it** (contract, fifth §9 failure mode).
Routing authors to `promote()` as the canonical admission door is right for the *mechanism* and
currently wrong for the *example*: **12 of the 15 production `CreateAuditIncidentInput` construction
sites pass an occurrence id as `source_id`** (§7 D1), so an author who copies the nearest call site
inherits the defect. **Fix `source_id` at the promoters before ratcheting anyone toward the door**,
or the gate will route people to a primitive whose commonest visible use is the anti-pattern.

## 5 Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`UNIQUE (entity_id, execution_id)` called dedup** | Dedups the occurrence, never the problem. **Executed: 0 of 205 rows collapsed**, while `(persona, title)` collapses 112. The next failure always has a new execution id, by definition. §7 D2. |
| **A `dedup_key` composed as `<source>:<a fresh uuid>`** | The same defect one layer up. `alert_evaluator.rs:274` promotes with `source_id: alert.id`, an id minted on line 241 of the same function — **a new dedup key on every fire, by construction**. The only thing that stops incidents stacking is the *second* guard (the open-title compare), which the comment names last. §7 D1. |
| **Reaching for a cooldown before defining an identity** | Strictly dominated. Executed: 7 days of cooldown suppresses 46.3% and erases the evidence; the identity collapses 54.6% and keeps it as a counter. A cooldown is what you use when you could not find an identity, and it should say so. §0. |
| **A cooldown constant with no relationship to the guarded thing's period** | Right for one producer, wrong for the rest. The repo holds `3600 s` (alert rules), `18 h` (anniversaries), `60 s` (fleet attention), `30 s` (clipboard), `5 s` (toasts), `1 s` (channel tests) and one window **derived** from the ritual's own `duration_min`. Only the last one generalises. §7 D5. |
| **A state-predicate guard with no aging sweep** | A permanent mute. This repo's own words: a row that lost its delivery slot *"stayed `queued` with nothing on earth able to re-deliver it, while the dedupe guard treated `queued` as blocking — so that `(trigger_kind, trigger_ref)` could never nudge again. **Twenty rows were stranded that way, the oldest for seven weeks.**"* §8 Gap 3. |
| **A dedupe guard whose predicate silently never matches** | The same mute, arrived at by a typo. `recently_nudged_on_this_day` compared `trigger_ref` by equality while the stored refs carry a `#<node_id>` suffix — *"so an equality match never fired and the per-anniversary guard was dead: a dismissed resurface re-popped on the very next tick."* A dedupe guard that matches nothing looks exactly like a dedupe guard that has nothing to match. §7 D7. |
| **A suppression ledger in a process-global** | An undeclared window of one process lifetime, invisible to any second reader. **12 of them here**, against 5 durable ones. Three (`SURFACED`, `NOTIFIED`, `WARNED`) are **one-way latches**: once set, that alarm cannot fire again until the app restarts, at which point it fires again. §9 is the ratchet. |
| **Two evaluators of one condition with two ledgers** | The alert rule engine runs in Rust every 60 s and in the frontend store every 60 s. They share a cooldown **only** because the client force-refetches `fired_alerts` on every tick and the server writes there first. Nothing serialises them, and the client's snapshot is global while the server's is persona-scoped — so which loop wins decides the *number in the message*. §7 D4. |
| **`let _ = promote(…);` then notify unconditionally** | Throws away the one bit the dedupe produced. `Result<Option<T>>` says "new" or "already known" and the caller that discards it emits the same sentence every time. The compliant form is 6 lines away in `subscription.rs:3059-3083`. §7 D6. |
| **A notification sink with no guard of its own** | `notifications.rs:1543-1547` builds and shows an OS notification with no dedup and no rate limit; every `notify_*` helper must self-govern and **2 of 6 do**. A sink that trusts its callers has as many policies as it has callers. §7 D8. |
| **An adaptive layer fed by statuses users don't produce** | The engagement modulator reads `engaged`/`dismissed` over 30 days and needs ≥5 samples. **80.3% of proactive cards reach `expired`**, so the whole-history sample is **1**. The adaptive layer is correct, wired, and has never run. §7 D9. |
| **A cap that binds with no record that it bound** | `dev_goal*` hits its per-kind cap of 2 on 6 separate days and nothing anywhere says a nudge was withheld. The user experiences silence and reads it as "nothing happened". §7 D10. |
| **A `resetCooldowns()` that clears everyone's** | `useRemediationEvaluator.ts:163-169`'s `forceEvaluate` calls `remediationBus.resetCooldowns()`, wiping the cooldown for **every credential and every action**, to re-check one. A bypass whose blast radius exceeds its purpose. §7 D11. |
| **A partial `UNIQUE` index presented as the dedup** | `idx_phi_persona_execution … WHERE execution_id IS NOT NULL` means the six callers that pass `None` are **not deduped at all**, and nothing at those call sites says so. §7 D2. |
| **Escalating the normalizer instead of fixing the key** | Widening a title normalizer to force a merge is how `PR #4 stuck` and `PR #7 stuck` became one incident. Measured here: the normalizer changes **nothing** on the queue that needs help (4 canonical titles) and merges **1 of 164** on the queue that doesn't. §0. |
| **A promotion path behind an env flag that defaults off** | `PERSONAS_INCIDENTS_PROMOTION=1` — unset, seven of the eight promoters are complete no-ops, so *which* alarms exist is a property of the environment rather than of the product. §7 D12. |

## 6 Evidence

**The one site to copy: `src/companion/proactive/mod.rs:24-31, 177-291` — noticing and delivering,
deliberately decoupled.**

```rust
// Sweep FIRST, dedupe second. Order matters: a row that has aged past its
// window is no longer a live claim on this (trigger_kind, trigger_ref), and
// retiring it before the dedupe check lets the trigger restate its case on
// the same pass instead of waiting a tick.
sweep_lifecycle(&conn);
// Dedupe: any already-queued or already-delivered message for the
// same trigger blocks a new one. Engaged/dismissed/expired don't
// block — those are resolved.
"SELECT id FROM companion_proactive_message
  WHERE trigger_kind = ?1
    AND COALESCE(trigger_ref, '') = COALESCE(?2, '')
    AND status IN ('queued', 'delivered')
  LIMIT 1"
```

Six decisions worth copying: (1) the guard is a **state** predicate, so suppression lasts exactly as
long as the alarm is outstanding and not one minute more; (2) the sweep runs **before** the dedupe so
there is no dead tick; (3) each aging window is argued from **whether the producer will re-raise** —
`PROACTIVE_QUEUED_EXPIRY_WINDOW = "-1 day"` because *"the trigger is idempotent: if the condition
still holds, the very next pass re-inserts the same `(trigger_kind, trigger_ref)` with freshly-derived
text… If the condition resolved itself, nothing re-fires — which is the correct outcome and the one
the old code could never reach"*, against `PROACTIVE_SCHEDULED_EXPIRY_WINDOW = "-7 days"` because a
user-requested check-in *"has **no re-fire path**… so expiring one destroys a user-visible promise"*;
(4) the incident that produced the design is recorded at the top of the module with its body count;
(5) all four comparisons wrap the stored column in `datetime(…)` because *"`'T'` (0x54) sorts after
`' '` (0x20)"* and a raw string compare carried an **up-to-one-day boundary skew**; (6) the budget is
spent at **release**, not at insert, so a lost claim costs nothing.

**Also exemplary:**

- `src/companion/proactive/triggers.rs:435-441` — `cadence_dedupe_window_min`. **The only cooldown in
  six codebases derived from the guarded thing's own period.** *"The floor stops same-evaluation-tick
  duplicates without widening the dedupe past the firing window."*
- `engine/src/cli_mcp_config.rs:87-121` + `src/engine/runner/mod.rs:1290-1320` — **the only
  escalate-on-repetition found anywhere in the sweep, including all five siblings.** Count in a
  trailing 30-minute window, raise at 3, and key the incident on `persona.id` — the **entity**. It is
  the one `promote()` call site in the tree whose `source_id` is not an occurrence.
- `src/engine/subscription.rs:3059-3083` — `source_id: "fleet_stall"`, a constant, so at most one
  incident can be open; the OS notification sits inside `Ok(Some(_))`. **One stall, one page.**
- `src/commands/execution/alert_evaluator.rs:12-17` — the header states the two-loop contract in
  full, including *why* the client force-refetches history: *"a server-fired alert inside the window
  suppresses the client's copy, and vice versa."* The contract is right; §7 D4 is about what it does
  not cover.
- `db/src/repos/execution/audit_incidents.rs:123-128` — the normalizer's **walked-back**
  over-correction, preserved in the docstring. Read it before widening any normalizer.
- `db/src/repos/dev_workspaces.rs:199` — `REJECTED_DEDUP_WINDOW_DAYS = 90`, *"'rejection is
  knowledge', but not forever"*, feeding a typed `DedupVerdict`.
- `src/engine/webhook_notifier.rs:500-506` / `team_slack_relay.rs:96-97` / `slack_poller.rs:366-369`
  — three breakers that **declare their own volatility**: *"In-memory only — a restart re-probes
  every bridge, which is the right default."* This is the comment §2(f) asks for, already written
  three times.

### Convergence — 5 checkouts opened, effective independent cohort **3**

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened. Two were removed before counting**, per
doctrine §5:

- **`personas-web` — disqualified as a downstream documentation consumer.** It contains **zero**
  runtime dedupe/cooldown logic; `src/data/guide/content/companion.ts:155-164` *describes* this
  repo's quiet hours, daily nudge budget and dismiss-driven decay. **And the description has already
  drifted**: it says *"at most three nudges per day"*, which is this repo's superseded pre-C2 cap of
  3, not the current `GLOBAL_DAILY_CAP = 12` — stale in the translated locales too. A documentation
  mirror agreeing with its subject is not evidence, and this one does not even agree.
- **`personas-cloud` — nothing to attribute.** 5 commits, abandoned 2026-03-23. Its only hits are
  retry backoff and replay-window nonces, and a nonce is occurrence identity **by construction**.
- **`vibeman` — counted, and it is the ANCESTOR.** First commit **2025-07-04**, seven months before
  this repo. Its anomaly-monitor schema cannot be a port of ours. Counted; lineage noted.
- **`brainiac`, `ascent` — clean-room.** Different languages, different domains, no shared
  identifier.

So: **cohort 5 → 3**, four implementations including this repo.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Identity is the problem, not the occurrence** | **PHYSICS (3 of 3)** | ascent keys on `repoFullName`; brainiac's divergence identity is `UNIQUE (org_id, canonical_id, axis)`; vibeman's `InsightDeduplicator` hashes `(type, title, projectId)` with a fuzzy fallback. **Not one keys on a run.** brainiac's migration header is the cohort's best statement of it: *"The natural key is what the adjudicator actually judges… Making that a unique key lets the sweep UPSERT and keep the row's identity"*, against the failure it fixed — *"A new id every sweep reads as a new divergence, so the mining sweep minted ANOTHER standard candidate for the same practice on every single run."* **Personas is the only repo in the cohort with an occurrence key, and it is the queue with 205 rows and 93 problems.** |
| 2 | **A cooldown exists at all** | **DIVERGED (1 present / 1 refused / 1 dead) — the leaf's label, confirmed** | ascent: `DEFAULT_REGRESSION_COOLDOWN_MINUTES = 360`, in-memory, deliberately. brainiac: **refuses one on principle** (see clause 4). vibeman: declares `cooldown_minutes INTEGER NOT NULL DEFAULT 60` and `last_triggered_at` in migration 222 and **no evaluator ever reads either** — the column, the type and the repository setter exist and nothing calls them. Three repos, three different answers, two of them argued. |
| 3 | **The window is derived from the guarded thing's period** | **MINORITY (1 of 3 by accident, 1 of 4 by design)** | brainiac's window *is* its sweep cadence, which is derivation by identity rather than by choice; vibeman's is per-monitor but dead; ascent's is a global env constant. **The only deliberate derivation in the cohort is this repo's `cadence_dedupe_window_min`.** Worth noting: ascent's 360 minutes and brainiac's 6-hour default cadence were reached **independently** — six hours is the fleet's emergent constant, and it is 6× this repo's alert cooldown. |
| 4 | **⚠ THE FORK — should a standing condition keep alarming?** | **DIVERGED, and both sides wrote down why** | ascent (`src/lib/alerts.ts:123-131`): *"A repo whose overall score oscillates ACROSS the regression threshold… fires a fresh Slack alert on EVERY re-scan — **the pager fatigue that trains a team to mute the exact channel the alert layer exists to keep credible**."* brainiac (`crates/brainiac-server/src/alerts.rs:19-24`): *"**Cadence is the debounce.** A breach that persists re-alerts once per sweep cadence — deliberate: **a stalled review queue that stays stalled SHOULD keep paging**, and an operator who wants less noise turns the cadence down in the sweeps UI, **visibly**, rather than us silently deduplicating a standing failure into one forgotten message."* **Two competent engineers, opposite conclusions, each correct about their own product.** P5 is this document's resolution and §12.4 offers it upward. |
| 5 | **Escalation on repetition** | **ABSENT (0 of 3), and Personas is the only repo in six that has one** | No occurrence counter, no severity bump, no "Nth time", no paging tier in ascent, brainiac, vibeman, personas-cloud or personas-web. Nowhere in `C:\Users\mkdol\dolla` is there an `ON CONFLICT … DO UPDATE SET count = count + 1` on an alert table. The single instance is `cli_mcp_config::note_sidecar_missing` + `SIDECAR_MISSING_INCIDENT_THRESHOLD = 3`. **A 5-of-5 silence with one local answer is the strongest possible argument that P7 is a frontier, not an adoption.** |
| 6 | **The suppression state is persisted** | **ALMOST ABSENT (1 of 3, partially) — the fleet converged on the disease** | Only ascent persists anything, and only for its weekly digest: a conditional insert whose affected-row count decides the winner, **before** dispatch, with an explicit release-on-failure — *"The old guard read the audit log, dispatched, then stamped AFTER the send — check-then-act — so two overlapping runs both read 'not sent' and both POSTed the same digest."* Its **per-repo** cooldown is a `globalThis`-pinned `Map`, explicitly accepted: *"a cooldown is spam-suppression, not a correctness guarantee, so a cold serverless start at worst re-sends once — never drops a distinct new regression."* **That sentence is the best defence of P6's escape hatch in the cohort and this repo should adopt the reasoning, not just the pattern.** |
| 7 | **Quiet hours / snooze** | **1 of 3, and the one is INVERTED** | vibeman returns a snoozed event while `snoozed_until > now` and drops it once the deadline **passes** — so snoozing hides the alert permanently after expiry instead of bringing it back. ascent and brainiac have none. **Personas is alone in the cohort with working quiet-hours and focus-window suppression, read from user-declared data.** |
| 8 | **Re-entry after suppression is a state transition** | **1 of 3** | brainiac's `UNIQUE (org_id, canonical_id, axis)` UPSERT keeps the row's identity across sweeps — the correct shape. ascent inserts a fresh audit row on every regression regardless of cooldown (deliberately: the audit is the record, the Slack post is the alert — a distinction worth stealing). vibeman has no path back. **Personas re-enters by re-insert with a new `dedup_key`** — 10 measured groups of `resolved, resolved, open`. |
| 9 | **Engagement-adaptive budget** | **0 of 3 — Personas alone, and its own is starved** | Nothing in the cohort adapts a notification cap to whether the user engages. This repo's `adjustment()` (dismiss ≥80% → −1, engage ≥60% → +1, `MODULATION_MIN_N = 5`) is unique in six codebases and has **1 sample in its whole history** (§7 D9). |

**Physics — keep as doctrine:** clause 1 (P1).
**Reported as divergence:** clauses 2 and 4 — *the fleet has not converged on whether a standing
condition should keep alarming, and the two positions are argued in comments that contradict each
other.* P5 is offered as the resolution, grounded in a local measured incident, not as an adoption.
**Reported as silence:** clauses 5 and 9 — *nobody escalates on repetition and nobody adapts to
engagement.* **Reported as convergence on the disease:** clause 6 — three of four suppression ledgers
in the cohort are volatile, which reads as agreement and is a shared gap; §9 ratchets it here.
**Personas is behind** on 1 and 8, **ahead** on 3, 5, 7 and 9, and **alone** on 6's worst instance
(12 volatile ledgers).

### The composition with `stall-watchdog` — measured, not argued

Doctrine §6 asks what happens to somebody who follows two adjacent paths. Here the two prescriptions
are **direct opposites**, in writing:

> [`stall-watchdog`](./stall-watchdog.md) §2(d): *"**Re-fire on a cadence while the condition holds.
> Dedupe by time window. Never by a key the store makes unique forever**, and never read 'the insert
> affected 0 rows' as 'already handled' — that turns a permanent condition into a single message."*

> This leaf §2(a)–(c): *the key is the problem, admit a recurrence by bumping a counter, and prefer a
> state predicate over a time window.*

Both are correct about their own leaf, and the collision is concrete rather than rhetorical:

- **The exemplar I nominate in §6 is the thing that path forbids.** `subscription.rs:3059-3083` uses
  `source_id: "fleet_stall"` — a key the store makes unique forever — and gates its OS notification
  on `Ok(Some(_))`, which is precisely "read 'affected 0 rows' as 'already handled'". It is
  *`stall-watchdog`'s own leaf's code*, and by that path's §2(d) it is a defect. Live it has produced
  **1 open incident** for a fleet that has been silent for weeks.
- **My headline defect is the thing this leaf forbids.** 205 healing rows, one per occurrence, is
  exactly "re-fire while the condition holds" taken to its limit, and it produced 4 sentences 205
  times.

**Neither path is wrong. The pair is** — and the resolution is P5, offered upward in §12.4:
**a recurring event and a standing condition are different objects.** Collapse the event onto one row
(identity, P1) *and* re-announce that row on a cadence (P5) — two mechanisms, two decisions. Using
identity for both makes a permanent condition a single forgotten message, which is `stall-watchdog`'s
correct complaint; using cadence for both makes 4 problems into 205 rows, which is this leaf's. The
repo already contains the composed answer: `companion_proactive_message` keeps **one row per
`(trigger_kind, trigger_ref)`** and ages it out so the trigger can **restate its case with fresh
text**. One row, repeated announcements, no stacking.

## 7 Deviations

Every entry is live on `master` @ `6c97502d3`, verified by reading the file, by replay, or against a
read-only copy of the operator's database. **Per the campaign's no-destructive-applies rule these are
notes, not asks** — every fix below changes a schema, changes which rows a guard admits, or changes
what a live surface shows, and the operator uses this app daily.

### D1 — the incidents inbox's first dedup layer is keyed on a value minted three statements earlier

`src/commands/execution/alert_evaluator.rs:241` mints `id: uuid::Uuid::new_v4()`; `:274` passes it as
`source_id`; `make_dedup_key` composes `fired_alerts:<that uuid>`. **The key is unique by
construction, so layer 1 can never dedup an alert rule that keeps firing.** The module header claims
otherwise — *"deduped by `fired_alerts:{alert_id}` + the repo's open-duplicate title guard, so the
same persona-problem never stacks incidents"* — and only the second clause is load-bearing.

The pattern generalises. Every production `CreateAuditIncidentInput` construction in the tree was
enumerated — **15 sites, and 12 of them pass an id of the occurrence**:

```
  occurrence-keyed (12)   promoter.rs:84 alert.id · :126 :158 :195 :228 entry.id · :264 event.id
                          · :297 issue.id (a healing-issue id, itself occurrence-keyed — double)
                          reviews.rs:1419 review.id · alert_evaluator.rs:274 alert.id (minted at :241)
                          athena_reaction.rs:1310 candidate.assignment_id
                          dispatch.rs:743 ctx.execution_id · engine/mod.rs:3036 exec_id
  NOT occurrence-keyed (3) engine/mod.rs:3261 persona_id · runner/mod.rs:1306 persona.id
                          subscription.rs:3063 "fleet_stall"  // stable -> dedupes to ONE open incident
```

Live, **`source_id` is a live `persona_executions.id` on 100 of 164 rows (61.0%)** and UUID-shaped on
163 of 164. The three exceptions are §6's two exemplars plus one; **`runner/mod.rs:1306` is the only
one that arrived there by counting occurrences first.**

This is not fatal today only because layer 2 exists. It is fatal for the **88 rows (53.7%)** that
skip layer 2 by design.

**Fix (note):** the `ProblemKey` newtype from §4(a), or at minimum change the seven promoters to key
on `(entity, kind)`. *(Not an apply — it changes which incidents exist.)*

### D2 — the healing queue's `UNIQUE` index has collapsed zero rows in 205, and six callers are outside it

`db/src/migrations/fk_hygiene.rs:523` (and its twin at `db/src/migrations/schema.rs:556`):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_phi_persona_execution
  ON persona_healing_issues(persona_id, execution_id) WHERE execution_id IS NOT NULL;
```

Executed in §0: **205 rows → 205 groups, 0.0% collapse**, against 54.6% under `(persona, title)`.
`create_with_source`'s header calls it dedup at `healing.rs:180`. Two further consequences:

1. **The index is partial.** Six callers pass `execution_id = None` and are therefore **not deduped
   at all**: `engine/background.rs:2021` and `:2099`, `engine/director.rs:1588`,
   `engine/oauth_refresh.rs:901`, `db/src/repos/resources/triggers.rs:533`,
   `engine/src/output_assertions.rs:543`. Nothing at those sites says so.
2. **`healing_knowledge` — 0 rows — already has the right schema**: `UNIQUE(service_type,
   pattern_key)` + `occurrence_count` + `last_seen_at`. The shape D2 needs exists in the same
   database and has never been used.

**Fix (note):** `problem_key` from `(persona_id, category, normalized_title)` with `occurrences` and
`last_seen_at`; admit a recurrence with an `UPDATE`. *(Not an apply — it collapses 205 rows to 93 on
a live surface and needs a backfill.)*

### D3 — one fleet-wide cause opens eleven incidents, and that is a decision nobody wrote down

`promote()`'s title guard scopes to `persona_id`, so `"transient process failure"` is open for **11
distinct personas**, `"execution failed"` for 10, `"usage limit reached"` for 9, `"execution timed
out"` for 7. Fleet-wide the open set is **64 distinct normalized titles across 99 rows (35.4%
duplicate)**.

Per-persona is defensible — a per-persona problem needs a per-persona fix. But it is a *policy* that
lives only in the shape of a `WHERE` clause, and the same four causes are 87 of the 99 open rows.
There is no fleet-level view that says "this is one thing, 11 times".

**Fix (note):** a `scope` on the guard (`persona` | `kind` | `fleet`) chosen per `kind`, or a
fleet-level rollup beside the inbox. *(Not an apply — it changes what the inbox shows.)*

### D4 — two evaluators, one condition, and only one of them can compute the right number

`src/commands/execution/alert_evaluator.rs` (Rust, 60 s) and
`src/stores/slices/overview/alertSlice.ts:424-469` (frontend, 60 s via
`useGlobalAlertEvaluator.ts:18`) evaluate the same `alert_rules` rows. Three gaps:

1. **The dedupe is a race, not a lock.** The client fires, then persists **asynchronously**
   (`api.createFiredAlert(alert).then(…)`, `alertSlice.ts:493`). If the server ticks inside that
   window it sees no row and fires too. The header at `alert_evaluator.rs:12-17` describes the
   mechanism honestly and the mechanism is check-then-act.
2. **They compute different values for the same rule.** The server builds a per-persona snapshot
   (`snapshot_for_scope`, `:166-187`); the client uses one global bundle for every rule. Whichever
   fires first suppresses the other for an hour — so the number in the alert is decided by a race.
3. **The client cannot fire `cost_spike` at all.** `ALERT_EVAL_WINDOW_DAYS = 1`
   (`useGlobalAlertEvaluator.ts:19`) means `chartData` has one point, so `avgDailyCost === todayCost`
   and the ratio is 1.0 by construction. `alert_evaluator.rs:29-33` records exactly this and calls
   itself the authority — the client half was never removed.
4. **The client's fallback trusts array order.** `state.alertHistory.find(a => a.rule_id ===
   rule.id)` (`:433`) takes the *first* match, which is the newest only because
   `list_fired_alerts` orders `fired_at DESC` (`alert_rules.rs:241`). The Rust side spells the
   ordering out in its own query; the client depends on a repo it does not own.

**Fix (note):** the server loop is the authority — make the client render `fired_alerts` and stop
evaluating. *(Not an apply — it removes a live alerting path.)*

### D5 — seven cooldown constants, one of them derived

| constant | value | measured from | persisted? | derived from the guarded thing? |
|---|---|---|---|---|
| `FIRED_COOLDOWN_SECS` / `FIRED_COOLDOWN_MS` | 1 h | last persisted `fired_at` | **yes** | no |
| `recently_nudged_on_this_day` window | 18 h | `created_at` of any prior message | yes | no (hard-coded literal) |
| `cadence_dedupe_window_min` | the ritual's `duration_min` | `created_at` | yes | **YES — the only one** |
| `ATTENTION_MIN_INTERVAL_MS` | 60 s | last wake | no (`Mutex<HashMap>`) | no |
| clipboard KB-match notify gate | 30 s | last successful notify, **globally** | no (`Mutex<Option<Instant>>`) | no |
| `_toastCooldownMs` (`storeTypes.ts:97`) | 5 s | `lastShown`, keyed on the **message string** | no | no |
| `RATE_LIMIT_WINDOW` (`notifications.rs:1177`) | 1 s | last call | no | no |
| `ACTION_COOLDOWNS` (`remediationBus.ts:73-77`) | 5–30 min | dispatch time | no | no |

The 18-hour anniversary window is the clearest instance: it guards a **calendar-day** event and the
window is *"18 hours: prevents same-day re-fire (covers a normal user's active waking hours)"* — a
literal reasoned from human behaviour where the guarded thing has a declared period of exactly one
day.

**Fix (note):** derive where a period exists; name and justify where it does not. *(Not an apply.)*

### D6 — the dedupe verdict is available at every alarm door and spent at one call site

`promote` returns `Result<Option<String>>`; `create_finding` returns `Result<Option<DevIdea>>`;
`create_with_source` returns `Result<Option<PersonaHealingIssue>>`; `enqueue_if_new` returns
`Result<Option<ProactiveMessage>>`. **Four doors, all correctly shaped** — this is exactly the fix
[`idempotent-invocation`](./idempotent-invocation.md) §2(d) asks for, already in place.

Across the tree, **one** call site spends that bit on whether to tell the human:
`subscription.rs:3075-3083`. `check_budget_enforcement` (`engine/mod.rs:2777-2811`) is the
counter-example — it writes a `critical` "Budget Exceeded" message via `let _ = …create(…)` **on
every execution** once the month's spend crosses the budget, with `execution_id: Some(exec_id)` (the
occurrence), no dedup key, no cooldown, and no "already alerted this month" check. Live it has
produced 0 rows on this install, because no persona has a `max_budget_usd`; the defect is latent, not
absent.

**Fix (note):** gate every human-visible emission on the `Some` arm; give `check_budget_enforcement`
a `(persona_id, YYYY-MM)` key. *(Not an apply.)*

### D7 — a dedupe guard that silently never matched, and the class it belongs to

`recently_nudged_on_this_day` (`triggers.rs:558-578`) compared `trigger_ref` by equality while
`build_on_this_day_nudge` stores `<offset>d:<YYYY-MM-DD>#<node_id>`:

> *"Stored refs carry a `#<node_id>` suffix, so an equality match never fired and the per-anniversary
> guard was dead: a dismissed resurface re-popped on the very next tick."*

It is fixed (prefix match, with the legacy equality arm kept). It is recorded here because **a dedupe
guard that matches nothing is indistinguishable from a dedupe guard with nothing to match**, and this
repo has three more guards whose key is composed in one function and compared in another:
`make_dedup_key` vs the seven promoters, `scan_dedup_key` vs `list_finding_dedup_keys`,
`cooldownKey()` vs `isOnCooldown()`. Doctrine's *"assert the instrument before you trust the result"*
applies to guards as much as to checkers.

**Fix (note):** every dedupe guard needs a test that asserts it *blocks*, not only that it permits.
`dev_tools_backlog_tests.rs` does this for the findings key. *(A test-only change; still not applied,
because the campaign is not adding test surface here.)*

### D8 — the OS notification sink has no guard, and 2 of 6 callers self-govern

`src-tauri/src/notifications.rs:1543-1547` builds and shows an OS notification with no dedup key, no
cooldown and no rate limit. Six helpers reach it. `notify_healing_issue` (`:1108-1138`) gates on
severity only; `notify_execution_completed_rich`, `notify_manual_review`, `notify_new_message`,
`notify_n8n_transform_completed` and `send_app_notification` gate on nothing but a per-persona
preference boolean. The **only** rate limit in the module is `RATE_LIMIT_WINDOW = 1 s`
(`:1173-1235`), and it applies exclusively to `test_channel_delivery`. **The one path that is
genuinely governed is the fleet-stall page**, and it is governed by its *caller*.

**Fix (note):** a `(kind, key)` cooldown at the sink, so a new caller inherits a policy instead of
inventing one. *(Not an apply — it changes what the operator sees.)*

### D9 — the adaptive budget reads two statuses that almost never occur

`budget.rs:60-107`. `engagement_30d` counts `status IN ('engaged','dismissed')` over 30 days;
`MODULATION_MIN_N = 5`. Live over the whole 76-row history: **`expired` 61, `delivered` 14,
`dismissed` 1, `engaged` 0.** The modulator has one sample in 26 days of history and has never
adjusted a cap.

**80.3% expired** is the finding underneath: an ignored card is neither engagement nor rejection, and
it is by far the most common outcome. The signal the modulator needs is being produced continuously
and thrown away, because `expired` is not in its `IN` list.

**Fix (note):** treat `expired` as weak negative evidence (it is *"the user did not act for seven
days"*), or lower `MODULATION_MIN_N`. *(Not an apply — it changes how often the operator is
interrupted.)*

### D10 — the cap that actually binds leaves no trace

Per-kind caps: `dev_goal*` = 2. Live, the `companion_attention_budget` rows show **exactly 2 on six
separate days** for `dev_goal_stalled` and four for `dev_goal_target` — the cap bound. The global cap
of 12 never bound (max 10). **Nothing anywhere records that a nudge was withheld**: no counter, no
log line at `info!`, no "N more" affordance. The operator's experience of a bound cap is silence, and
silence is what "nothing is wrong" looks like.

**Fix (note):** count refusals per `(date, kind)` beside the spend, and surface them. *(Not an apply.)*

### D11 — a bypass with a fleet-wide blast radius

`src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:163-169`'s `forceEvaluate` calls
`remediationBus.resetCooldowns()` (`remediationBus.ts:166`), which clears the cooldown map for
**every credential and every action** — including `auto_rotate` (15 min) and `auto_disable` (30 min),
whose windows exist to stop repeated *destructive* attempts. Re-checking one credential re-arms all
of them.

**Fix (note):** `resetCooldown(credentialId)`. *(Not an apply — it touches the credential remediation
path, which the runbook lists as security-sensitive.)*

### D12 — which alarms exist is a property of the environment

`db/src/audit_incidents_promoter.rs:38-44`: seven of the eight promoters are complete no-ops unless
`PERSONAS_INCIDENTS_PROMOTION=1`, described as *"the v1 mitigation"* during a bake-in window. 164 rows
exist, so it has run; nothing states whether the bake-in ended. `alert_evaluator.rs:267-269`,
`dispatch.rs`, `engine/mod.rs:3032`, `subscription.rs:3059` and `runner/mod.rs:1302` all deliberately
bypass the flag, so **the promotion surface is split into a gated half and an ungated half with no
single place that says which is which.** This is [`findings-triage-queue`](./findings-triage-queue.md)
D5 from the admission side.

### D13 — twelve suppression ledgers reset on restart, three of them without any window at all

The §9 population. Twelve process-global ledgers decide whether to raise something again; five
durable ones ask the same question of the database. Three of the twelve — `SURFACED`
(`cloud/remote_commands.rs:30`), `NOTIFIED` (`fleet_bridge.rs:2098`), `WARNED`
(`build_session/events.rs:293`) — are **one-way latches with no expiry**: the suppression window is
"until the process exits", after which the same alarm fires again. `WARNED` is the honest one; its
comment states the trade explicitly (*"the worst case is a duplicated warning for an old session,
which is preferable to a leak"*). The other two do not say.

**Fix (note):** for each, either persist or write the sentence
`webhook_notifier.rs:503-505` already writes. *(Not an apply.)*

## 8 Gaps

1. **Nothing in the app can say "these two are the same problem."** There is no problem-identity
   primitive — no canonicalizer, no similarity helper, no shared normalizer. `normalize_title_key`
   (incidents), `normalize_idea_title` (ideas) and `practice_dedup_key` (practices) are three
   independent implementations in three modules, and the healing queue — the one that needs it most —
   has none. `vibeman` has one (Jaccard + stop-words) and `brainiac` has one (a canonical claim key).
2. **No alarm table has an occurrence counter.** `runner/mod.rs`'s escalation had to keep its count in
   a process-global for exactly this reason, and its comment says so: *"There is no occurrence counter
   on the incident spine itself, so we count here and let the spine's `dedup_key` collapse the
   repeated promotions into one open incident."* Three empty tables (`healing_knowledge`,
   `automation_suggestions`, `schedule_missed_runs`) already have the column.
3. **There is no shared aging sweep.** `sweep_lifecycle` is bespoke to one table, `gc_stale_pending`
   to another, `prune_stale_proposed` to a third. A new queue that adopts a state-predicate guard must
   hand-roll the sweep that keeps it from becoming a permanent mute — which is the exact failure that
   cost twenty stranded rows. **This is the largest structural gap in the leaf.**
4. **There is no re-announce mechanism at all.** P5's second half does not exist anywhere in the tree.
   Nothing re-raises a still-open incident, re-notifies about a still-open healing issue, or says "day
   82". `audit_incidents` has been sitting at 99 open for 74 days in silence.
5. **A cooldown cannot be expressed as data.** Every window in the app is a Rust `const` or a TS
   module constant. `alert_rules` — the one user-configurable alerting surface — has `metric`,
   `operator`, `threshold`, `severity` and **no cooldown column**, so the 1-hour window is not tunable
   even where the rule is. `vibeman` declared exactly this column (`cooldown_minutes`) and never wired
   it, so the fleet agrees it is hard.
6. **Nothing discloses a suppression.** No surface anywhere says "N similar suppressed", "muted until
   HH:MM", or "capped for today". The two repos in the cohort that count suppressions
   (ascent's `skippedAlreadySent`/`skippedFlat`) return them in a cron JSON body.
7. **The two alert evaluators cannot be serialised.** They coordinate through the freshness of a table
   read. There is no lease, no CAS on `fired_alerts`, and no way to express "this rule is being
   evaluated". D4.
8. **`Instant` is unpersistable, which is correct and unhelpful.** Nine of the twelve volatile ledgers
   could be persisted only by rewriting their datum as a wall clock. The type is honest and the
   consequence is invisible at the call site (§4(b)).
9. **The webhook notifier's dedup is a watermark, not an identity.** `notification_dispatch_watermark`
   holds one row: `last_event_at = "<rfc3339>|<event_id>"`. It is a *position*, so a subscription
   added today cannot receive anything older, and a relay that falls behind cannot skip selectively.
   That is the right shape for an outbox and the wrong one for an alarm.

## 9 The missing gate

**The condition, stated stack-free:** *the state that decides whether to raise the same alarm again
lives only in the process, so the suppression window is silently "one process lifetime" — it resets on
restart, no second evaluator of the same condition can see it, and where it is a one-way latch it has
no upper bound at all.*

**The signal (a proxy, and stated as one):** a **process-global mutable ledger whose payload is a
time, a count, or a set of already-emitted keys** — `static NAME: OnceLock|LazyLock<Mutex<HashMap<K,
Instant|SystemTime|u32|u64|i64>>>`, `Mutex<HashSet<String>>`, or `Mutex<Option<Instant>>`. This keys
on the shape the condition wears **in this repo**, where suppression state is either a Rust
process-global or a SQLite row. **An adopting repo must re-derive its own proxy** — a `globalThis`-pinned
`Map` (ascent), a React store field, a Redis key with no TTL and a module-level `Set` all carry this
condition and none matches this pattern. Demonstrated, not hypothesised: **the frontend half of this
same repo has five more** (`storeTypes.ts:98` `_recentToasts`, `remediationBus.ts:91` `cooldowns`,
`silentFailureTelemetry.ts:59` on `globalThis`, `useTranslatedError.ts:27` `_lastBreadcrumbKey`,
`sentry.ts:72` `_lastFeatureKey`) that **no Rust matcher could ever reach.**

**The vocabulary is derived from the tree, not from imagination.** There is none: the anchor is
purely structural — a declaration form and a payload type. This was deliberate. The static *names* in
this population are `T`, `S`, `P`, `SIGS`, `M`, `SURFACED`, `NOTIFIED`, `WARNED`,
`CONSECUTIVE_FAILURES`, `BRIDGE_FAILURES`, `SIDECAR_MISSING_LOG`, `OAUTH_CLEANUP_LAST_RUN` — **five of
them are single letters**, so any name-based signal would have missed a third of the population and
the doctrine's actor-attribution warning would have applied at both ends.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path writes no script.

**Where it executes:** `npm run census:check` is part of `npm run check`, and it is the
`golden-path-census` **pre-push** job in `lefthook.yml`. That matters: `ci.yml` is currently red on 10
pre-existing failures, so **a gate that only runs in CI runs nowhere.** This one fails the push.

**Precision 12/12 on the stated condition; every match opened and read.** All twelve are ledgers
consulted before an emission and written after one. Nine carry a doc comment that says so in the
author's own words — *"so the 15s poll doesn't re-emit the same prompt every tick"*, *"don't re-wake
Athena about the same session more than once per window"*, *"Sessions already announced, so a
re-detection on the next 30s tick cannot announce twice"*, *"a permanently broken channel would
otherwise be re-hit every 5s forever"*. On the stricter question *"is this a defect"* the honest
answer is **3 of 12 are, 9 of 12 are documented trade-offs** — which is why the rule is a ratchet and
not a verdict, and why §7 D13 asks for a comment rather than a rewrite.

**The population partitions:**

| | matches | files |
| --- | ---: | ---: |
| **violating** — the suppression ledger is a process-global | **12** | 8 |
| **compliant** — the same question asked of a durable store (the positive control) | **5** | 4 |

The control is not a distant compliant population: it contains `alert_evaluator.rs:156` — the
persisted cooldown whose *volatile* twin is `alertSlice.ts`'s `alertFiredCooldowns` — and
`proactive/mod.rs:280`, this leaf's exemplar. **The same author, the same app, the same question,
answered both ways.**

**Two independent implementations, and the disagreement was the finding.** Implementation #1 is the
census regex. Implementation #2 finds every `static NAME:` declaration and reads its type by an
**angle-bracket-balanced walk** with `#[cfg(test)]` stripped as brace-matched ranges — no spanning
regex, no lazy quantifier crossing a declaration. #2 enumerated **80 process-global `Mutex`/`RwLock`
statics in 50 files** and classified each by payload shape. That is what showed the first draft of
this rule was wrong: at `HashMap<K, V>` with any scalar or tuple payload it returned **19 matches and
hand-verification found 13 true positives — 68.4% precision**, the false positives being caches
(`SCENARIO_CACHE`, `SMART_SEARCH_CACHE`, `VAULT_INDEX_CACHE`, an OAuth token cache) and process
registries (`DEV_SERVERS`, `OCR_CANCEL_TOKENS`). **The discriminator #2 supplied is that a cache's
payload is a tuple `(Instant, T)` and a suppression ledger's is a bare scalar** — a structural fact,
not a word list. Restricting the payload took it to 12/12 with three path excludes.

**Existing rules checked for overlap first, by re-running every one of them over its own roots and
intersecting the `file:line` sets — measured, not assumed.** All **84** committed rules that can reach
`src-tauri/**/*.rs` were re-run.

| neighbour rule | its files / matches | site overlap | file overlap | why it is a different condition |
|---|---:|---:|---:|---|
| `unverified-effect-dispatch` | 60 / 162 | **0 (0%)** | 3 of 8 | Whether an effect's result is checked, not where suppression state lives. |
| `unregistered-tauri-event-name` · `hand-rolled-emptiness-refusal` · `unfalsifiable-tier-guard` · `unobservable-detached-task` | 31/71 · 135/305 · 34/105 · 86/169 | 0 (0%) each | 2 of 8 each | All co-occur in the same busy engine modules; none shares a statement. |
| `process-global-caches-a-failure` | 3 / 4 | **0 (0%)** | **0** | The nearest neighbour by *name* and the furthest by condition: it keys on `OnceLock<Result<…>>` — a write-once global that froze a **failure**. Mine keys on a `Mutex`-wrapped **mutable** ledger of times and keys. Disjoint patterns, disjoint files, disjoint failure modes. |
| `anonymous-deadline` · `anonymous-retry-budget` | 38/61 · 6/8 | 0 (0%) | 1 of 8 · 0 | Both are about a *bound written as a literal*. Mine is about *where the state that spends the bound lives*. A named `const` satisfies them and changes nothing here. |
| `unverifiable-conflict-clause` | 40 / 71 | 0 (0%) | 1 of 8 | `INSERT OR IGNORE` without a named conflict target — adjacent to §7 D1/D2 in spirit, zero shared sites. |
| `pending-queue-read-ranked-by-arrival` ([`findings-triage-queue`](./findings-triage-queue.md)) | 8 / 10 | **0 (0%)** | **0** | Its leaf owns the queue's *order*; this owns its *admission*. No contact. |
| `untyped-lifecycle-transition` · `partial-terminal-status-set` · `unowned-inflight-state-sweep` | 26/152 · 6/14 · 6/6 | 0 (0%) each | 1 of 8 · 0 · 0 | The closest in *subject* — §4(c)'s "a status that can be entered and not left" — and still zero shared sites, because they key on SQL and this keys on a Rust declaration. Named here so a future composer does not re-derive the same overlap check. |
| the other **75** rules | — | **0** | ≤1 | No contact. |

**The largest site-level overlap against all 84 committed rules is 0. The largest file-level
co-occurrence is 3 of 8 (37.5%).**

> **A disclosure about my own overlap instrument, because doctrine asks.** My re-implementation
> deduplicates matches to distinct `file:line` sites — which is the correct unit for an *overlap*
> question and undercounts a rule with two matches on one line. **80 of the 84 rules reproduced their
> committed baselines exactly**; the four deltas are `deferred-read-then-write` (+1f/+1m — I do not
> implement the engine's `**` glob excludes), `unbound-child-lifetime` (−1f/−1m),
> `build-gated-ipc-entrypoint` (−1m) and `privately-reclassified-failure` (−4m), all in the
> same-line-collapse direction. **The overlap result is unaffected** — it is a set intersection, and
> collapsing two matches on one line into one site cannot manufacture a shared site. **I did not run
> the full registry** (doctrine §4).

**Disclosed recall gap — the anchor is a declaration form, and it misses exactly where the doctrine
predicts.** It cannot see: a suppression ledger held as a **struct field** rather than a static
(`engine/src/context_rules.rs:113` `last_match: HashMap<String, Instant>` — the rule engine's own
per-rule cooldown; `engine/src/file_watcher.rs:46` `last_fired`; `engine/src/queue.rs:92`
`quota_cooldown_until`); a ledger behind a **type alias**; the **five frontend ledgers** listed above;
and — the other half of this leaf — **a guard that has no ledger at all**, which is not greppable
because nothing was written. True recall over process-local suppression state in `src-tauri` is
roughly **12 of 16**; across the whole app, roughly **12 of 21**.

**How it fails loudly if its own precondition is absent:** `floor: 900` against a live walk of 963
`.rs` files, so a moved root or a broken glob fails rather than reporting zero; a rule matching zero
files anywhere is a structural failure in the runner; a rise is fatal; a **drop** without `--update`
is fatal; a stale `exclude` is fatal; and a baseline on a positive control is rejected by
`validateRule`. **All seven were verified by deliberately breaking the rule**, results below.

**What the gate cannot do, stated so nobody trusts it further than it goes:**

- **It cannot see the identity defect** (D1, D2), which is a schema fact and the leaf's headline. A
  `UNIQUE` index naming an occurrence column is 6 matches in 4 files at **33% precision** (two of the
  six are event logs where FIFO is correct and two are the same index declared twice), which is a
  refusal, not a gate.
- **It cannot see a missing sweep** (§4(c)), because the defect is a function nobody called.
- **It cannot tell a documented trade-off from a defect.** 9 of its 12 matches carry a comment
  accepting the volatility. The rule ratchets the *population*; §7 D13 asks for the sentence.
- **It counts a declaration, not a policy.** One module with three ledgers contributes three matches;
  merging them lowers the count without persisting anything, which is why the control must move in the
  opposite direction and why both counts are published.

```json
{
  "rules": [
    {
      "id": "process-global-suppression-ledger",
      "goldenPath": "docs/concepts/golden-paths/alert-dedupe-and-cooldown.md",
      "title": "The state that decides whether to raise the same alarm again lives only in process memory",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bstatic\\s+[A-Z][A-Z_0-9]*\\s*:\\s*(?:std::sync::|once_cell::sync::)?(?:OnceLock|LazyLock|Lazy|OnceCell)\\s*<\\s*(?:std::sync::|tokio::sync::|parking_lot::)?Mutex\\s*<\\s*(?:std::collections::)?(?:HashMap\\s*<\\s*[A-Za-z_][A-Za-z0-9_:]{0,30}\\s*,\\s*(?:Vec\\s*<\\s*)?(?:Instant|SystemTime|u32|u64|i64)\\s*>|HashSet\\s*<\\s*String\\s*>|Option\\s*<\\s*Instant\\s*>)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A process-global MUTABLE ledger whose payload is a time, a count, or a set of already-emitted keys - the state a suppression/dedupe/cooldown/breaker decision is made against. PROXY FOR the stack-free condition: the state that decides whether to raise the same alarm again lives only in the process, so the suppression window is silently ONE PROCESS LIFETIME - it resets on restart, no second evaluator of the same condition can see it, and where it is a one-way latch (a HashSet nothing removes from) it has no upper bound at all. THE ANCHOR IS PURELY STRUCTURAL AND THAT WAS DELIBERATE: the static names in this population are T, S, P, SIGS, M, SURFACED, NOTIFIED, WARNED, CONSECUTIVE_FAILURES, BRIDGE_FAILURES, SIDECAR_MISSING_LOG, OAUTH_CLEANUP_LAST_RUN - FIVE ARE SINGLE LETTERS, so any name-derived vocabulary would have missed a third of the population at one end and, per the doctrine's actor-attribution warning, distorted precision at the other. MEASURED 2026-08-17 at 6c97502d3: 12 matches across 8 of 963 .rs files under src-tauri, EVERY ONE OPENED AND READ, precision 12/12 on the stated condition. THE TWELVE: cli_mcp_config.rs:101 SIDECAR_MISSING_LOG (the repo's only escalate-on-repetition counter, and its comment says it lives here only because the incident spine has no occurrences column); remote_commands.rs:30 SURFACED ('so the 15s poll doesn't re-emit the same prompt every tick'); fleet_bridge.rs:172 attention_throttle ('don't re-wake Athena about the same session more than once per window'), :182 decision_signatures ('an unchanged prompt must NOT re-wake Athena'), :804 mechanical_next_signatures, :1547 pending_assessments, :2098 completion_notified ('Sessions already announced, so a re-detection on the next 30s tick cannot announce twice'); oauth.rs:1385 OAUTH_CLEANUP_LAST_RUN; build_session/events.rs:293 WARNED; slack_poller.rs:372 BRIDGE_FAILURES; team_slack_relay.rs:102 and webhook_notifier.rs:506 CONSECUTIVE_FAILURES (the two notifier breakers). THREE OF THE TWELVE ARE ONE-WAY LATCHES WITH NO EXPIRY - SURFACED, NOTIFIED, WARNED: once set, that alarm cannot fire again until the app restarts, at which point it fires again. NINE OF TWELVE CARRY A COMMENT ACCEPTING THE VOLATILITY, which is why this is a RATCHET AND NOT A VERDICT - the ask in section 7 D13 is the sentence webhook_notifier.rs:503-505 already writes ('In-memory only - a restart re-probes every bridge, which is the right default'), not a rewrite. MEASURED LIVE against read-only copies of the operator's personas.db (244 tables) and personas_data.db (71 tables), taken 2026-08-17 with the app running, never opened for write, DELETED after: EVERY table in this database shaped to hold an alarm identity (healing_knowledge with UNIQUE(service_type,pattern_key)+occurrence_count+last_seen_at; automation_suggestions with UNIQUE(event_type,persona_id)+occurrence_count+first_seen_at+last_seen_at; schedule_missed_runs with missed_count+first_missed_at+last_missed_at; alert_rules; fired_alerts; budget_alert_rules; circuit_breaker_state) HOLDS ZERO ROWS, while persona_healing_issues holds 205 rows keyed on UNIQUE(persona_id, execution_id) and audit_incidents holds 164 keyed on source_table:source_id whose source_id is a live persona_executions.id on 100 of them. REPLAYED HEAD TO HEAD over those same 205 healing rows: the deployed occurrence key collapses 0 (0.0 percent), a 1-hour cooldown on the problem collapses 30 (14.6), 24 hours collapses 60 (29.3), SEVEN DAYS collapses 95 (46.3) and destroys the evidence, and the problem identity (persona, title) collapses 112 (54.6) while losing nothing because a counter keeps it - IDENTITY STRICTLY DOMINATES A COOLDOWN AT EVERY WINDOW. TWO INDEPENDENT IMPLEMENTATIONS, AND THE DISAGREEMENT WAS THE FINDING: implementation 2 enumerates every static NAME: declaration and reads its type by an ANGLE-BRACKET-BALANCED WALK with cfg(test) stripped as brace-matched ranges (never a line threshold), finding 80 process-global Mutex/RwLock statics in 50 files. It showed the first draft of this rule was wrong - at HashMap<K,V> with any scalar OR TUPLE payload it returned 19 matches at 68.4 percent precision, the false positives being CACHES (SCENARIO_CACHE, SMART_SEARCH_CACHE, VAULT_INDEX_CACHE, an OAuth token cache) and process registries (DEV_SERVERS, OCR_CANCEL_TOKENS). The discriminator implementation 2 supplied is STRUCTURAL, not a word list: a cache's payload is a tuple (Instant, T); a suppression ledger's is a bare scalar. Restricting the payload took precision to 12/12. ZERO SITE-LEVEL OVERLAP with all 84 committed rules that reach src-tauri, measured by re-running every one of them and intersecting file:line sets; 80 of 84 reproduced their committed baselines exactly under a re-implementation that collapses same-line matches to one site. Nearest by NAME is process-global-caches-a-failure and it is furthest by condition: it keys on OnceLock<Result<..>>, a write-once global that froze a FAILURE; this keys on a Mutex-wrapped MUTABLE ledger of times and keys - disjoint patterns, disjoint files (0 of 8), disjoint failure modes. DISCLOSED RECALL GAP, exactly where a declaration-form anchor fails: it cannot see a ledger held as a STRUCT FIELD (context_rules.rs:113 last_match: HashMap<String, Instant> is the rule engine's own per-rule cooldown; file_watcher.rs:46 last_fired; queue.rs:92 quota_cooldown_until), nor one behind a type alias, nor the FIVE frontend ledgers in the same app that no Rust matcher could ever reach (storeTypes.ts:98 _recentToasts keyed on the toast MESSAGE STRING, remediationBus.ts:91 cooldowns, silentFailureTelemetry.ts:59 on globalThis, useTranslatedError.ts:27 and sentry.ts:72, both single-slot so alternating keys defeat them), nor a guard with no ledger at all - notifications.rs:1543 shows an OS notification with no dedup and no rate limit and 4 of its 6 callers add none. True recall in src-tauri is roughly 12 of 16; across the whole app roughly 12 of 21. CONVERGENCE, measured against 3 independent siblings (personas-web disqualified as a downstream doc consumer whose description of this repo's nudge budget is already stale at 3 versus the real 12; personas-cloud has no alerting at all; vibeman counted and dated as the ANCESTOR at 2025-07-04): ONLY ONE OF THREE PERSISTS ANY SUPPRESSION STATE, and only for one of its two paths - the fleet converged on the disease. Ascent's own comment is the best defence of the escape hatch and is worth adopting with the pattern: 'a cooldown is spam-suppression, not a correctness guarantee, so a cold serverless start at worst re-sends once - never drops a distinct new regression.' Do NOT silence a match by moving the ledger into a struct field, behind a type alias, or into a lazily-initialised wrapper - the honest fix is to persist it, or to write the sentence webhook_notifier.rs:503-505 writes."
      },
      "exclude": [
        { "path": "src-tauri/src/companion/session.rs", "reason": "INTERRUPTED_TURNS is a cancellation flag the streaming loop polls to kill a child process, not a ledger of what has already been emitted - hand-verified 2026-08-17" },
        { "path": "src-tauri/src/engine/team_assignment_orchestrator.rs", "reason": "LIVE is a single-flight guard over spawned work (its comment: two tick_loops would launch the same step twice), which is idempotent-invocation's leaf, not a suppression ledger over an emission - hand-verified 2026-08-17" },
        { "path": "src-tauri/src/commands/fleet/stale.rs", "reason": "AWAITING_BASELINE and SCREEN_SILENT_SINCE are the EVIDENCE a liveness verdict accumulates BEFORE it fires (a transcript byte-count baseline and a silence-start stamp), the confirmation side of the decision rather than the suppression side - hand-verified 2026-08-17" }
      ],
      "baseline": { "files": 8, "matches": 12 },
      "floor": 900
    },
    {
      "id": "process-global-suppression-ledger-positive-control",
      "goldenPath": "docs/concepts/golden-paths/alert-dedupe-and-cooldown.md",
      "title": "POSITIVE CONTROL - the same have-I-already-raised-this question asked of a durable store",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "SELECT\\s+(?:COUNT\\s*\\(\\s*\\*\\s*\\)|id|[A-Za-z_][A-Za-z0-9_]{0,24})\\s+FROM\\s+[A-Za-z_]\\w*(?:(?!FROM)[^\"]){0,400}?\\b(?:trigger_ref|trigger_kind|rule_id|dedup_key|source_id)\\s*(?:=|LIKE)\\s*(?:\\?\\d*|COALESCE|')(?:(?!FROM)[^\"]){0,400}?(?:\\b(?:created_at|fired_at|delivered_at|last_seen_at|occurred_at)\\s*\\)?\\s*[<>]|\\bstatus\\s+IN\\s*\\(|ORDER BY\\s+fired_at)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition over the same root and extensions: the have-I-already-raised-this question asked of a DURABLE store, keyed on a dedup reference (trigger_ref / trigger_kind / rule_id / dedup_key / source_id) and bounded either by a time cutoff or by the OUTSTANDING STATE of the prior alarm. Measured 2026-08-17 at 6c97502d3: 5 matches in 4 files, against the violating rule's 12 in 8. THE FIVE, all opened: (1) companion/proactive/mod.rs:280 enqueue_if_new - SELECT id FROM companion_proactive_message WHERE trigger_kind = ?1 AND COALESCE(trigger_ref,'') = COALESCE(?2,'') AND status IN ('queued','delivered') - THE EXEMPLAR, a STATE predicate rather than a time one, whose comment states the rule: 'Engaged/dismissed/expired don't block - those are resolved'. (2) proactive/triggers.rs:447 recently_nudged - the only cooldown in six codebases whose WINDOW IS DERIVED from the guarded thing's own declared period (cadence_dedupe_window_min reads the ritual's duration_min, floored at 1 minute). (3) proactive/triggers.rs:570 recently_nudged_on_this_day - an 18-hour per-anniversary guard, and the site whose comment records that an EQUALITY match against a ref carrying a '#node_id' suffix NEVER FIRED, so 'a dismissed resurface re-popped on the very next tick': a dedupe guard that matches nothing is indistinguishable from one with nothing to match. (4) alert_evaluator.rs:156 last_fired_at - SELECT fired_at FROM fired_alerts WHERE rule_id = ?1 ORDER BY fired_at DESC LIMIT 1, the app's one restart-proof cooldown and the shared arbiter between the Rust and the frontend evaluator; its VOLATILE twin is alertSlice.ts:431-442's alertFiredCooldowns, so the same author answered the same question both ways in the same feature. (5) events.rs:574 - COUNT over persona_events by (event_type, source_id) within a window. A MATCH HERE IS NOT A CERTIFICATE: (4) has never executed because alert_rules has held 0 rows for the life of this install, and (1) is only safe because sweep_lifecycle ages every non-terminal status out - before that sweep existed, 20 rows were stranded in 'queued', the oldest for seven weeks, and their (trigger_kind, trigger_ref) could never nudge again. THE SPAN LIMIT WAS MEASURED, NOT GUESSED: at a vocabulary that included persona_id this control returned 14 and 9 of them were persona_executions METRIC counts (36 percent precision); restricting the vocabulary to true dedup references took it to 5/5 and, critically, ADDED the exemplar at mod.rs:280 by allowing the ref to be wrapped in COALESCE - the best artifact in the leaf was invisible to a pattern that assumed a bare column. Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved; verified by adding one, which exits 1. THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if the violating count falls while this stays flat, a suppression ledger was DELETED rather than persisted."
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
reports **12 matches / 8 files** for the rule and **5 / 4** for the control over **963** files against
a floor of 900, and `--check` exits **0** at the declared baseline. **Re-extracted from this finished
document and re-run, with identical counts.**

**Deliberately broken seven ways, all fatal as required:**

```
baseline (8f/12m, control 4f/5m)     -> exit 0
floor 2000 > 963 walked              -> exit 1   (matcher/root broken, not codebase clean)
pattern matches zero files           -> exit 1
stale exclude entry                  -> exit 1
baseline too LOW (a rise)            -> exit 1
baseline too HIGH (a silent drop)    -> exit 1
baseline ON the positive control     -> exit 1   (validateRule rejects a control with a baseline)
```

### The instrument this leaf needs that the census cannot be

Stated plainly because the doctrine asks for it: **the leaf's largest finding is not gateable by
counting.** §4(c)'s bad state — *a dedupe guard keyed on a status that can be entered and not left* —
is a claim about the **reachability of a transition graph**, and the census ratchets what is present.
The right instrument is a **`scripts/check-guard-sweep-coverage.mjs`**: for every SQL predicate of the
form `status IN (…)` used as a *dedupe* guard, collect the statuses it treats as blocking; for every
`UPDATE … SET status = '<terminal>'` in the same module, collect the statuses it ages out; **exit 2
when a blocking status has no aging arm.** Its precondition guard is the same shape as
`check-csp-hosts.mjs`'s: if the scan finds fewer than N guards, fail rather than report clean. That is
~40 lines, and it is the only thing in this document that would have caught the twenty stranded rows
before they were stranded.

A second, cheaper instrument would catch §7 D1/D2: an inventory of every `UNIQUE` index and every
`dedup_key` construction, with a **required declaration** of whether its key is a problem or an
occurrence, checked against the columns it actually names. That is the same *inventory-versus-registry*
shape as [`findings-triage-queue`](./findings-triage-queue.md)'s queue registry, and for the same
reason: an occurrence key leaves no hole a compiler, a linter or a diff can see.

### The type, alongside the ratchet

Restating §4 next to the gate, in descending order of what it buys:

- **`ProblemKey` with a private field and one constructor** removes the whole D1 class permanently and
  has ~10 construction sites, so it survives Q3. Propose it as the fix.
- **The volatile cooldown is not a type problem** — `Instant` already declares the volatility
  perfectly and it does not help (§4(b)). That is what this rule is for.
- **The missing sweep is not a type problem** and needs the inventory script above.
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a destination
  is only as good as the destination's defaults*). **12 of the 15 production construction sites pass
  an occurrence id**, so an author copying the nearest example inherits the defect. Correct the
  promoters **before** routing anyone to the door.

## 12 Corrections to the brief

### 12.1 — `sides: "server"` is incomplete: the first time that label has failed

The doctrine's ledger records `sides: "server"` as **tested once and upheld**. This is its second test
and it does not hold — though the correction is *incomplete*, not *inverted*.

The server half is where the exemplar, the census rule, its control, its floor and 11 of the 13
deviations live. But the client half is not decorative: **one of the app's two alert evaluators is
frontend code** (`alertSlice.ts:376-520` + `useGlobalAlertEvaluator.ts`), it maintains **its own
cooldown map** with the same one-hour constant restated as `FIRED_COOLDOWN_MS`, and it can fire, toast
and persist an alert with the UI open — while being structurally unable to evaluate `cost_spike` at
all (§7 D4). Beside it sit **five more client-side suppression ledgers** — a toast dedup keyed on the
**message string** (`storeTypes.ts:96-98`), a credential remediation bus with per-action cooldowns
(`remediationBus.ts:70-81`), a sampled swallow tracker (`silentFailureTelemetry.ts:26-34`), and two
**single-slot** dedups (`useTranslatedError.ts:26-27`, `sentry.ts:66-72`) that alternating keys defeat
entirely.

**Recommend `both`.** And note the mechanism, because the doctrine asks for it where the label
survives or fails: this leaf is two-sided **because the same rule engine was implemented twice**, on
purpose, and the second implementation was never retired. That is a specific, checkable reason — not
"the client renders it".

### 12.2 — `convergence: diverged` HELD, and it held for a reason worth keeping

**The spine says DIVERGED. It is correct**, and this is only the second spine convergence label the
corpus has upheld (after [`ai-draft-preview-apply`](./ai-draft-preview-apply.md)'s `mixed`).

Cohort established first, per doctrine: **3 independent, not 5.** `personas-web` is a downstream
*documentation* consumer with zero runtime logic whose description of this repo's nudge budget is
already stale (it says 3; the real cap is 12). `personas-cloud` has no alerting at all. `vibeman` is
counted **and dated: first commit 2025-07-04, seven months before this repo** — so where the two
resemble each other, this repo is the descendant.

Of the 3, on the leaf's central question — *should a standing condition keep alarming?* — the answers
are **present / refused / declared-but-dead**, and two of the three wrote down why, in comments that
directly contradict each other:

- ascent: *"the pager fatigue that trains a team to mute the exact channel the alert layer exists to
  keep credible"*
- brainiac: *"a stalled review queue that stays stalled SHOULD keep paging… rather than us silently
  deduplicating a standing failure into one forgotten message"*

**That is what real divergence looks like: not absence, but two competent engineers reaching opposite
conclusions with their reasoning attached.** An oracle counting agreement would score this leaf as
uninformative; the *disagreement* is the most valuable thing the sweep returned, and P5 exists because
of it.

Two sub-clauses did converge and are reported separately: identity-on-the-problem is **3 of 3
physics**, and volatile suppression state is **convergence on the disease** at 3 of 4 (§6 clause 6).
A single enum field could not have carried any of this — the doctrine's own most recent finding,
reproduced.

### 12.3 — the brief's central premise is inverted for this leaf

> *"`brainiac` was measured writing 'Rejection is knowledge…' with a 90-day dedup window, and
> `vibeman` seeds its dedup set from rejections except stale auto-archives… **Two siblings have
> thought about this harder than this repo has** — cite them and measure the gap."*

**Measured, and the gap runs the other way.** Those two sibling behaviours are about a **findings /
ideas** pipeline, not an alerting one, and on that axis this repo already holds both halves *in one
constant*:

```rust
/// Rejected practices are retained so miners don't re-propose them; the block
/// expires after this many days ("rejection is knowledge", but not forever).
pub const REJECTED_DEDUP_WINDOW_DAYS: i64 = 90;          // dev_workspaces.rs:199
```

Ninety days — the same number as brainiac's `DEFAULT_DEDUP_WINDOW_DAYS`. The phrase *"rejection is
knowledge"* — brainiac's. The expiry carve-out (*"but not forever"*) — vibeman's *"may legitimately
resurface once its context actually changes"*. It feeds a typed `DedupVerdict`, and
`create_finding`'s gate is stricter still: it matches **any** status including `rejected`, so a human
"no" is permanent until the row is deleted.

On the *alerting* axis proper, the direction is clearer still. Against the 3 independent siblings this
repo is **ahead** on the derived cooldown window (the only one in six codebases), on quiet
hours (alone), on engagement-adaptive budgets (alone), and on escalate-on-repetition (**alone in six
codebases**, 0 of 3 siblings). It is **behind** on exactly two things: the identity of a healing issue
and an incident's `source_id`.

**Report loudly: the brief's premise was a reasonable inference from a neighbouring leaf and it does
not survive contact with this one.** The gap to measure was in the other direction.

### 12.4 — a correction offered upward to `stall-watchdog`, as a qualifier

[`stall-watchdog`](./stall-watchdog.md) §2(d) prescribes *"dedupe by time window. **Never** by a key
the store makes unique forever, and never read 'the insert affected 0 rows' as 'already handled'."*
That is correct for a **watchdog** and it is this leaf's defect for a **findings queue** — measured,
not argued: the shape it forbids is the one that takes 205 rows to 93 with no information loss, and
the shape it prescribes is what produced 4 sentences 205 times.

The collision is concrete: **`stall-watchdog`'s own leaf's exemplar violates its own §2(d).**
`subscription.rs:3063` uses `source_id: "fleet_stall"` — a key unique forever — and `:3075` gates the
OS notification on `Ok(Some(_))`, which is exactly "read 0 rows as already handled".

**The offered qualifier**, for that path's §2(d):

> *…for a watchdog **announcement**. The **row** should still be keyed on the problem and carry an
> occurrence counter — dedupe by time window governs how often the one row speaks, not how many rows
> exist. See [`alert-dedupe-and-cooldown`](./alert-dedupe-and-cooldown.md) P5.*

And the reciprocal, already in this document's §2(h): identity must not swallow the reminder. The
composed answer exists in the tree (`companion_proactive_message`: one row per key, aged out so the
trigger restates its case), so the qualifier costs that path nothing.

A second, smaller qualifier for [`idempotent-invocation`](./idempotent-invocation.md) §2(a) — *"derive
the key from the request, never from the attempt"* — is that **for an alarm the request IS the
attempt**, so "derive from the request" would produce exactly the defect in §7 D1. Its §2(d) (*return
which branch fired*) is, pleasingly, **already satisfied by all four alarm doors here**, and §7 D6 is
about callers that discard the bit rather than doors that fail to produce it.

### 12.5 — the healing figures are exact, and the ratio nobody had computed is the finding

**"`persona_healing_issues` dedups on `UNIQUE (persona_id, execution_id)`… 179 open rows carry 4
distinct titles, one of them 107 times" — confirmed to the row**, including the 107.

What the brief could not have known is the ratio: **the index has collapsed 0 of 205 rows**, and a
seven-day cooldown on the problem would still under-collapse the identity by 8.3 points while
destroying 95 occurrences. The brief asked "what is the identity?"; the executable answer is that
**identity strictly dominates every cooldown window at every value**, which reframes the leaf: a
cooldown is not a weaker form of dedupe, it is what you reach for when you have failed to find one.

### 12.6 — `dev_ideas.dedup_key` at 22 of 236 is a temporal cut, not a coverage failure

**"populated on 22 of 236 rows, only for one origin" — confirmed as a count and wrong as a
diagnosis.** Grouped by date:

```
  keyed    22 rows   2026-07-27 .. 2026-08-11    (all origin = 'workspace_practice')
  no-key  214 rows   2026-04-07 .. 2026-06-13    (all origin = NULL)
```

**Every unkeyed row predates 2026-06-14; every keyed row postdates 2026-07-27; no unkeyed row has been
written in 65 days.** The findings spine landed in between, with a partial `UNIQUE` index
(`idx_dev_ideas_dedup_unique ON dev_ideas(project_id, dedup_key) WHERE dedup_key IS NOT NULL`) and
**six production `scan_dedup_key` callers** (`idea_scanner.rs:857`, `memory_ledger.rs:418`,
`static_scan.rs:136`, `dispatch.rs:926`, `memory_reflection.rs:620`, plus `dev_workspaces.rs:1377`'s
`practice_dedup_key`). "One origin" is true and means "one producer has run since"; it does not mean
nine producers ignore the key.

This corrects [`findings-triage-queue`](./findings-triage-queue.md) D6, which lists `dev_ideas.dedup_key`
at 22/236 among *"four columns that describe a lifecycle the code does not implement"*. Three of its
four hold. **This one does not**: the lifecycle is implemented, the index exists, and the coverage
number is an artefact of when the operator last ran a scan.

### 12.7 — the rejection reason has a consumer, and `create_finding`'s real property is not the one the brief named

The brief nominated `create_finding`'s `(project_id, dedup_key)` gate as *"this repo's exemplar"*.
Measured, it is the exemplar for **identity** and has nothing to say about **cooldown** — its
suppression is permanent until deletion, with no window at all. Its genuinely interesting property is
one neither the brief nor `findings-triage-queue` named: **the gate matches every status, including
`rejected`**, so a refused finding cannot be re-proposed. That is the P7-equivalent property
[`findings-triage-queue`](./findings-triage-queue.md) §6 clause 2 reported this repo as lacking.

And the exclusion set **is** read: `list_finding_dedup_keys` (`dev_tools.rs:4329`) exists precisely to
export it — *"Every dedup key already spoken for on this project — the sweep's pre-filter, so N drafts
cost one query instead of N existence checks"* — and it is exposed over IPC as
`dev_tools_list_finding_dedup_keys` and consumed at `src/api/devTools/devTools.ts:928`. That path's D8
(*"the rejection reason is recorded at 96% and read by nobody"*) is correct about the **reason string**
and wrong about the **key**: the producer does dedup against prior rejections, through the key rather
than through the prose.

### 12.8 — the incidents inbox does not leak; two things about it are worth reporting instead

The brief's framing implied `audit_incidents` still stacks duplicates. Replayed, **it does not**:
under its own two-layer key the 99 open rows are 99 distinct groups, 0.0% duplicate. The residual
35.4% by title is the deliberate per-persona scope.

Two other things are worth reporting and neither was in the brief. **First, 88 of 164 rows (53.7%)
bypass the title guard entirely** — `persona_blocker` and `team_assignments` are in
`CONTINUABLE_SOURCE_TABLES` — so more than half the table is protected only by a `dedup_key` whose
`source_id` is an execution or an assignment id. Inside that set the guard key would have collapsed
1 of 88, so the exception is currently cheap; it is a standing exposure, not a live defect.
**Second, the elaborate normalizer is nearly inert on this corpus**: 0 of 164 titles carry the
volatile counter suffix `strip_counter_suffix` exists for, its 64-byte truncation touches 88 of 164,
and it merges exactly **1** pair that a plain lowercase would not. That is not a criticism of the
normalizer — it is evidence for §0's claim that **normalization is a rounding rule and cannot rescue a
key that names the wrong thing.**

### 12.9 — corrections to my own instrument, three of them, and all are doctrine failure modes

**(a) My first census anchor scored 68.4% and I nearly shipped it.** At `HashMap<K, V>` with any
scalar *or tuple* payload it returned 19 matches; hand-verification found 13 true positives, the false
positives being four caches and two process registries. **The second implementation is what supplied
the fix** — a structural payload discriminator (a cache's value is a tuple `(Instant, T)`, a
suppression ledger's is a bare scalar) rather than a name list. Had I reached for a name vocabulary
instead, five of the twelve true positives are named `T`, `S`, `P`, `SIGS` and `M`, so a
vocabulary-keyed anchor would have missed them at one end and, per the doctrine's actor-attribution
warning, distorted precision at the other.

**(b) My first positive control scored 36% and, worse, missed the exemplar.** It included `persona_id`
in the dedup-reference vocabulary and returned 14 matches of which 9 were `persona_executions` metric
counts. Restricting the vocabulary to true dedup references took it to 5/5 — and the same edit
**added** `proactive/mod.rs:280`, the best artifact in the leaf, which had been invisible because my
pattern assumed a bare column and the exemplar wraps its ref in `COALESCE(trigger_ref, '')`. Same
family as [`findings-triage-queue`](./findings-triage-queue.md) §12.7(b): *the exemplar was invisible
to a limit that had no reason to be where it was.*

**(c) I rejected two better-sounding rules with numbers, and the numbers are the point.** A rule on
`UNIQUE` indexes keyed on an occurrence column — which would have gated the leaf's *headline* defect —
returns **6 matches in 4 files at 33% precision** (two are event logs where FIFO is correct, and two
are the same index declared twice in two migration files). A rule on `source_id: <x>.id` field
initializers returns **31 matches in 19 files at ~32% precision**, dominated by `persona_events`
provenance, where naming the occurrence is exactly right. **A gate that fires on correct content is
worse than no gate**, so both were declined and the identity condition is carried by the inventory
instrument specified in §9 instead.

### 12.10 — one thing the brief did not ask and the measurement volunteered

The brief asked whether anything escalates on repetition. One thing does, and its comment names the
gap that forced it:

> *"There is no occurrence counter on the incident spine itself, so we count here and let the spine's
> `dedup_key` collapse the repeated promotions into one open incident."* —
> `engine/src/cli_mcp_config.rs:97-100`

That is the leaf in one sentence. **The only escalate-on-repetition mechanism in six codebases had to
keep its counter in a process-global — the very anti-pattern §9 ratchets — because the durable table it
feeds has no column for it.** The two findings are the same finding seen from both ends: a schema with
no `occurrences` forces the count into memory, and a count in memory is a suppression window nobody
declared. Adding one integer column to `audit_incidents` would close §7 D13's most defensible instance
and unlock P7 for every other producer at once.
