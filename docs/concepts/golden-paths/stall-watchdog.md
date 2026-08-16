# Golden path — Stall watchdog

> Situation node: `backend-runtime/backend-observability/stall-watchdog` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **HIGH** ·
> sides: **server** · convergence: **diverged** ·
> dimensions: **resilience · function · code-quality · cost**
> Composed 2026-08-16 against `master` @ `cd9d094d9`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri` and all **4,828** `.ts`/`.tsx`
> under `src/` ([`shared-facts.json`](../shared-facts.json)). All **41**
> `ReactiveSubscription` implementations (39 production, 2 test) opened by name;
> all **50** `fn tick(` definitions in the tree classified twice. **244 tables**
> in `personas.db` and **71** in `personas_data.db` enumerated for a timestamp
> column and a newest row. Read in full: `engine/subscription.rs` (3,436 lines),
> `engine/background.rs` `SchedulerState` + `SubscriptionHealth` + `SchedulerStats`,
> `commands/infrastructure/system/health.rs::build_subscriptions_section`,
> `db/src/repos/execution/audit_incidents.rs::promote`, `db/src/repos/system_ops.rs`,
> `commands/execution/alert_evaluator.rs`, `src/logging.rs`.
>
> **Measured by executing, not by reading.**
>
> 1. **Read-only copies of both live SQLite files** (`personas.db` 347 MB,
>    `personas_data.db` 17.5 MB, copied 2026-08-16 16:19 with their `-wal`/`-shm`,
>    opened `readOnly: true`; the live files were never opened for write while the
>    app was running — `engine-leader.lock` shows pid 22264 heartbeating at the
>    moment of the copy). **`FleetLivenessWatchdog::tick`'s four SQL statements
>    were replayed verbatim.** That query is this leaf's instrument and, per the
>    brief, nobody had run it.
> 2. **The app's own rolling tracing log was read** — six days,
>    `personas.2026-08-11.log` … `personas.2026-08-16.log`, ~4.3 MB — and every
>    one of the 39 production subscription names grepped across it.
> 3. The §9 rule was built, measured by **two independent implementations** (a
>    paren-counting Rust scanner and the census engine) that agree to the line,
>    **fault-injected 11 ways**, **overlap-checked against 236 match sites of the
>    five nearest existing rules (0 collisions)**, validated in a
>    composer-private scratch registry, then re-extracted from this finished
>    document and re-run. **The full registry was NOT run**, per the doctrine.
> 4. **`cargo` was not run** (the operator's app is running). Every Rust claim is
>    static and traces to a file opened during composition.
>
> ---
>
> ## 0 The headline: every liveness instrument in this app measures motion, and the app has produced nothing for 51 days
>
> Of **94** non-empty timestamped tables in `personas.db`, **57 have a newest row
> more than 30 days old.** The engine's whole execution plane stopped inside one
> three-minute window and nothing anywhere has said so:
>
> | durable artifact | newest row | silent for |
> | --- | --- | ---: |
> | `persona_executions` (2,188 rows, **all** in 2026-06) | 2026-06-26T16:34:02 | **50.9 d** |
> | `execution_traces` · `execution_knowledge` · `persona_memories` · `persona_tool_usage` · `provider_audit_log` · `obsidian_sync_log` | 2026-06-26T16:36:54 | 50.9 d |
> | `persona_events` with `status='delivered'` (4,941) | 2026-06-26T16:34:02 | 50.9 d |
> | `team_assignments` · `team_assignment_events` (8,486) · `dev_goal_signals` | 2026-06-17T05:35 | 60.4 d |
> | any `audit_incidents` row at all | 2026-06-26T15:31 | 51.0 d |
> | last fire of any `schedule`-type trigger | 2026-05-28T15:55 | **80.0 d** |
> | `dev_tasks` — 2 rows `status='running'`, `updated_at` 6 ms after `created_at` | 2026-04-09T15:30 | **129.0 d** |
> | `circuit_breaker_state` · `healing_knowledge` · `schedule_missed_runs` · `fleet_sessions` · `alert_rules` · `fired_alerts` | — | **0 rows, ever** |
>
> The 5-second trigger loop, the event bus, the zombie sweep and 36 other loops
> have been ticking through all of it.
>
> ### The app has a watchdog for exactly this. Replayed today, it says STALL.
>
> `FleetLivenessWatchdog` (`engine/subscription.rs:2946`) is **the only
> instrument in this repo that measures OUTPUT rather than activity** — its tick
> asks "have any executions started in the last `FLEET_STALL_HOURS`?" and not
> "did the loop run?". Its four statements, replayed verbatim against the live
> copy at 2026-08-16T14:22Z:
>
> | `FleetLivenessWatchdog::tick` step | line | live value | verdict |
> | --- | --- | ---: | --- |
> | `COUNT(*) FROM persona_executions WHERE datetime(created_at) > datetime('now','-2 hours')` | `:2995` | **0** | not explained |
> | open goals on team-linked projects | `:3006` | **9** | work exists |
> | pending `dev_ideas` on team-linked projects | `:3016` | **24** | work exists |
> | `team_assignments` `awaiting_review` | `:3025` | **11** | work exists |
> | `quota_cooldown_active` (15-min lookback) | `:2983` | **false** | not explained |
> | **result** | `:3032` | — | **STALL** |
>
> ### It raised its incident once, 67 days ago, and it is structurally incapable of raising another
>
> ```
> audit_incidents · kind='fleet_stall' · 1 row
>   dedup_key  fleet:fleet_stall
>   created_at 2026-06-10T08:26:46Z      status open      67.2 days
>   acknowledged_at NULL   resolved_at NULL   continued_at NULL
> ```
>
> The raise is `promote(source_table:"fleet", source_id:"fleet_stall")`
> (`subscription.rs:3062-3063`, commented *"stable → dedupes to ONE open
> incident"*). `promote` builds `dedup_key = "fleet:fleet_stall"`
> (`audit_incidents.rs:69-71`) and does `INSERT OR IGNORE`
> (`audit_incidents.rs:209-233`), against a column declared
> **`dedup_key TEXT NOT NULL UNIQUE`** (`db/src/migrations/incremental.rs:2527`).
> **The uniqueness is not scoped to `status`.** So:
>
> - The second raise inserts 0 rows and `promote` returns `Ok(None)`.
> - The watchdog notifies only `if let Ok(Some(_)) = promoted` (`:3075`), so no
>   desktop notification is ever sent again.
> - **Nothing in 963 `.rs` and 4,828 `.ts` files ever resolves, clears or
>   re-raises a `fleet_stall`.** The string appears **4 times** in the whole
>   tree: two comments, the `source_id`, the `kind`. Zero consumers.
> - Even resolving it by hand would not help — `dedup_key` is unique over the
>   *lifetime of the database*, not over open incidents.
>
> **"One stall, one page" was the intent (`:3073-3074`). The mechanism delivers
> "one stall, ever."** And the one page it did send landed in an inbox that now
> holds **99 open incidents**, the oldest 74 days.
>
> ### Three independent causes of silence, and all three look identical from outside
>
> The watchdog has not even reached its `tracing::warn!` in six days —
> `fleet_liveness_watchdog` appears **0 times** in 4.3 MB of the app's own log.
> Replay explains why, and the explanation is the leaf:
>
> | cause | when it started | recorded anywhere? |
> | --- | --- | --- |
> | **1. Disarmed.** `if !advancement_on && !any_full { return; }` (`:2980`). All 11 `autonomous_*` settings are `'false'`, set 2026-06-17T05:31 | 60 d ago | **no** — bare `return`, no log, no row |
> | **2. Latched.** the `fleet:fleet_stall` dedup key already exists | 67 d ago | **no** — `Ok(None)` is discarded at `:3075` |
> | **3. Genuinely stalled.** 0 executions, 44 units of work waiting | 51 d ago | **no** — this is what 1 and 2 were built to report |
>
> Nine sibling loops log `"<name>: quota cooldown active — skipping tick"` when
> they mute themselves (`:1607, :1820, :2165, :2338, :2449, :2551, :2634, :2791, :2878`
> plus `deliberation.rs:855`). **The watchdog is the one that does not**
> (`:2983-2985`, comment: *"silence is explained"* — the explanation is written
> nowhere). The loop whose entire job is to explain silence goes silent without
> a word, by two separate gates.
>
> ### Ticking is not working, and one table proves it
>
> `persona_events` is alive: 31 rows written in August, the newest 2026-08-14.
> **All 31 are `status='skipped'`.** Every one of the 4,941 `delivered` rows is
> ≥51 days old. The event bus loop is ticking, receiving events, and has
> delivered **zero** of them for 51 days — which is indistinguishable, in every
> instrument this app owns, from a healthy bus with a quiet inbox.
>
> > **Corrected 2026-08-16 by [domain-event-publication](./domain-event-publication.md).**
> > The counts above are right; the causal reading is **inverted**. The bus is not
> > failing to deliver — **nothing is publishing.** There are **0 events of any
> > status between 2026-06-27 and 2026-07-31**, and **16 of the 31 August rows are
> > two types whose publisher's own doc comment says they are meant to have no
> > consumer**, so `skipped` is the correct outcome for them. A delivery-side
> > watchdog would have fired on a healthy delivery path.
> >
> > **The observation this path exists for survives intact, and is strengthened:**
> > "0 delivered since boot" and "0 delivered ever" still read identically, and now
> > so does "0 delivered" versus "0 published". The instrument cannot separate a
> > broken consumer from an empty producer — which is the same missing comparison,
> > one table upstream.
>
> ### Sibling boundaries, settled in prose
>
> [**background-loop**](./background-loop.md) owns the loop's own lifecycle — the
> wait, the generation gate, the panic boundary, the leadership gate. **This path
> owns the question that loop cannot answer about itself: did any of that
> ticking produce anything.** Its `unraced-loop-wait` rule and this path's rule
> share zero match sites (§9).
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns work
> that *started and then stopped* — reapers, `incomplete`, the unread
> `last_heartbeat_at`. **This path owns work that never started.** The
> distinction is load-bearing and measured: `persona_executions` today has
> **zero** non-terminal rows. Every reaper in that document has done its job
> perfectly. There is nothing stuck; there is nothing at all. Its D9 (an
> `EXECUTIONS_SILENT_DETECTED` event with no listener — re-verified here:
> **2 occurrences in `src/`, both in `eventRegistry.ts`, 0 `listen` calls**) is
> the per-execution instance of this leaf's per-loop condition.
>
> [**scheduled-trigger-firing**](./scheduled-trigger-firing.md) found this leaf
> by accident: 79 days of an armed loop firing nothing. Its Gap 3 asks for
> exactly one thing — *"a zero-fire watchdog: if the trigger subscription has
> ticked N times with `triggers_fired` unchanged while at least one enabled
> schedule row exists, raise."* **§7 D1 here answers it: the repo built that
> watchdog for a different loop, and §0 is what happened to it.**
>
> [**long-running-job-progress**](./long-running-job-progress.md) owns whether
> ONE job reports progress. **This path owns whether the LOOP that starts jobs
> reports throughput.** Its `unswept-job-registry-read` keys on an in-memory
> `HashMap`; disjoint.
>
> [**timeout-tiering**](./timeout-tiering.md) owns the bound on one operation
> (`anonymous-deadline`, 61 sites). **This path owns the bound on a repeating
> one** — the deadline that says "you have had long enough to produce
> something", which has no name anywhere in this repo.
>
> [**error-surfacing-policy**](./error-surfacing-policy.md) owns where a failure
> goes. **A stall is not a failure and raises nothing** — extending the note
> `scheduled-trigger-firing` left there: absences do not raise, and this document
> is the instrument for them.
>
> [**agent-dispatch**](./agent-dispatch.md) owns keeping a handle on work you
> started. **This path owns noticing that the handle went quiet.**
>
> The **Deviations** section is a fix backlog and contains **one live latched
> alarm** (D1), **one disarmed-without-a-trace watchdog** (D2) and **one health
> surface that prints tick counts as proof of health** (D4).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no
file path, primitive name or count, so an adopting repo can tell physics from
local calibration. Each clause names its warrant.

> **P1 — physics, and the whole subject.** *Liveness is not progress.* A loop
> that ticks on time, never panics, and does nothing is the failure this
> situation exists for, and it is invisible to every instrument that measures
> the loop's own motion. Ask what the loop **produced**, not whether it **ran**.
>
> **P2 — physics.** *Record the last unit of work durably, next to the loop's
> identity, in the same write that finished the work.* In-process counters
> answer "since when?" with "since the last restart", which is the one answer
> that cannot distinguish a system that has produced nothing today from one that
> has produced nothing ever.
>
> **P3 — physics.** *Last-attempt and last-success are two columns, not one.*
> Collapsing them makes a loop that runs and fails look exactly like a loop that
> runs and succeeds. This is the single most reinvented clause in the sweep.
>
> **P4 — physics, and the clause that decides whether the alarm works at all.**
> *A standing failure must keep speaking.* Deduplicate an alarm by **time
> window**, never by a key that is unique for the life of the store. An alarm
> that fires once and then goes quiet has converted a permanent problem into a
> single forgotten message — and the quiet is indistinguishable from recovery.
>
> **P5 — physics.** *Scope the output measurement to the producer you are
> watching.* Global throughput hides a dead producer behind a live one for
> exactly as long as anything else is working.
>
> **P6 — physics.** *A disarmed detector must say that it is disarmed.* Every
> gate that can make a watchdog return early — a feature flag, a cooldown, a
> leadership check, a "nothing to do" branch — must leave a record, because from
> outside, "armed and quiet", "disarmed", and "already fired" are the same
> observable: nothing.
>
> **P7 — ergonomics, and it is not optional.** *A health verdict that a human
> must go and pull is not a watchdog.* Something must push, on a cadence, into a
> channel that outlives the process.
>
> **P8 — house convention, flagged.** *Do not let a watchdog be a peer of the
> loops it watches.* If it is scheduled by the same supervisor, it dies with
> them. Only one repo in the six-repo family even has the problem, because only
> one has a watchdog.

---

## 1 Trigger

- "How would we know if this loop stopped doing anything?"
- "The scheduler says it's running — why hasn't anything happened?"
- "I'm adding a background job / subscription / cron / sweep."
- "This alert fired once in June and we've heard nothing since. Is it fixed?"
- "Everything is green and the product isn't producing."
- "How long has it been broken?" (asked after someone noticed by hand)

If you are about to type `async fn tick(&self)`, `tick_count`, `last_tick_at`,
`alive: bool`, `interval.tick().await`, a new `*Subscription` struct, a
`HealthCheckStatus::Ok` arm, `INSERT OR IGNORE` on an alert, a `dedup_key`, or a
bare `return;` inside a periodic tick — you are in this situation.

**Not this path:** *the loop's own wait, cancellation and panic isolation* is
[background-loop](./background-loop.md); *a row that got stuck mid-flight* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); *one job's
progress bar* is [long-running-job-progress](./long-running-job-progress.md);
*the timeout on one call* is [timeout-tiering](./timeout-tiering.md).

## 2 The one way

**Make every periodic cycle return a value that names what it produced, persist
that value beside the loop's identity in the same write, and alarm on the age of
the last non-zero one — not on the tick.** Concretely: (a) the cycle's signature
returns an outcome (`-> Result<usize>` at minimum, a small struct like
`TickReport { picked, replied }` when there is more than one kind of product),
so the supervisor *can* record throughput and the author *cannot* forget to say
what happened — a `()` return makes the whole concern unrepresentable upstream.
(b) **Persist it**: one row per loop carrying `last_run_at`, `last_status`,
`last_detail`, and — the part almost everyone collapses — a **separate**
last-*success* timestamp, so "ran and produced nothing" and "has not run" are
different rows. (c) **Alarm on age, scoped to the producer**: `now -
last_success_at > budget`, where `budget` is derived from the loop's own cadence
(*n* missed cycles), never a constant you picked; and count only the output of
the loop you are watching, because a global counter lets one busy producer mask
a dead one indefinitely. (d) **Re-fire on a cadence while the condition holds.**
Dedupe by time window. Never by a key the store makes unique forever, and never
read "the insert affected 0 rows" as "already handled" — that turns a permanent
condition into a single message. (e) **Clear on recovery**: write the resolution
when the condition lifts, because the absence of the next alert is
indistinguishable from the alerting loop itself having died. (f) **Log every
early return.** A watchdog that a flag, a cooldown, a leadership gate or an
empty result set turned off must say so at `info!`, with its own name in the
line. (g) **Do not schedule the watchdog on the supervisor it watches** where
you can avoid it; where you cannot, give it an independent durable heartbeat so
its own silence is detectable.

If you must get one right first: **(b)**. (a) is the type that makes (b)
unavoidable, and (c)–(g) are all impossible without it — but (b) is the one that
survives a restart, and every finding in §0 was found by reading exactly those
timestamps.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/system_ops.rs:120` `mark_run(pool, id, status, detail, next_run_at)` + `:142` `mark_outcome(pool, id, status, detail)` | **the one site to copy.** The repo's only durable per-loop watermark: `last_run_at` / `last_status` / `last_detail` on `system_op_automations`, and `mark_outcome` deliberately records *the real outcome* separately from `mark_run`'s *fire time* — P3, already built. Its one live row reads `last_status='ok'`, `last_detail='scan_id=6e33a772…'` |
| `src/engine/curation_scheduler.rs:61` `tick(pool) -> Result<usize, AppError>` | the compliant tick signature, with the doc comment that states the contract: *"Returns the number of jobs enqueued this tick."* Returns `Ok(0)` on the empty path instead of `return`ing — "nothing to do" is an answer, not a silence |
| `src/engine/slack_poller.rs:131` / `discord_poller.rs:98` `TickReport { picked, replied, ingested }` | the richer form: a named struct per *kind* of product, with a doc comment explaining why `ingested` is counted apart from `picked`. Four of the five compliant ticks in the tree are these pollers and relays |
| `src/engine/subscription.rs:2946` `FleetLivenessWatchdog` + `:2952` `FLEET_STALL_HOURS` | the only OUTPUT-based watchdog in the tree, and the right shape: measure produced rows over a window, refuse to alarm when the silence is explained, require that actionable work exists. **Copy its question; do not copy its alarm** (§7 D1) |
| `src/engine/background.rs:1081` `reap_stuck_processing_events` + `:1038` `STUCK_EVENT_REAP_INTERVAL` + `SchedulerStats.events_reaped` | the loudness discipline: `warn!` with per-outcome counts *and* a counter, *"so it is never silent"* (`:1145`). The counter is in-memory (§8 Gap 2) but the instinct is right |
| `db/src/repos/execution/audit_incidents.rs:150` `promote` | the durable alarm channel with an inbox behind it. **Only for alarms whose `source_id` identifies a specific row.** For a recurring system-level condition it is the wrong primitive as written (§7 D1) |
| `core/src/models/observability.rs:15` `AlertMetric::Executions` + `AlertOperator::Lt` | the vocabulary for "fewer than N produced" already exists and is evaluated server-side (`commands/execution/alert_evaluator.rs:83`, the `Executions` arm at `:109`). **`alert_rules` has 0 rows and `fired_alerts` has 0 rows** — nobody has ever written the rule this enum was built for |
| `src/engine/leadership.rs:100` `EngineLeadership` + `daemon/lock.rs:57` `STALE_THRESHOLD` | the one liveness signal in the app that is durable, refreshed and actually read: `pid` + `hostname` + `heartbeat_at`, three missed beats = dead. The model for a loop's own heartbeat file |
| `src/logging.rs:121` the daily rolling appender, 7-file retention | the only durable channel a tick can write to today without a schema change. Use it — but see §8 Gap 1: at the default `info` filter, a *healthy* tick writes nothing to it |

**Do NOT build:** a second in-memory health map beside `SubscriptionHealth`; an
alarm keyed on a string literal `source_id`; a per-loop `tokio::spawn` outside
the subscription registry; a "did anything happen?" query over a table the loop
you are watching does not own; a watchdog whose only output is `tracing::warn!`;
another `HealthCheckStatus::Ok` arm reached by exhausting the failure cases.

## 4 Steps

1. **Name the product before you write the loop.** One sentence: *"a healthy
   tick of this loop produces N of X."* If you cannot finish that sentence, you
   are building a loop nobody can supervise. `curation_scheduler.rs:59-60` is
   this sentence, written as a doc comment, in the repo.
2. **Give `tick` a return type.** `-> Result<usize, AppError>` for one product,
   a `TickReport` struct for several. Not `()`. See *Prefer a type over a gate* —
   this is the edit that makes every later step possible, and it is step 2 rather
   than step 9 deliberately.
3. **Return `Ok(0)`, never `return;`.** "Found no work" is a measurement. An
   early `return` on an empty result set destroys the only difference between
   *nothing to do* and *broken*.
4. **Persist the outcome in the same call that produced it.** One row per loop:
   `last_run_at`, `last_status`, `last_detail`, `last_success_at`. Copy
   `system_ops::mark_run` + `mark_outcome`; the schema is four columns.
5. **Derive the stall budget from the loop's own cadence**, as *n* missed
   cycles — the way `daemon/lock.rs:57` justifies 90 s as *three missed
   heartbeats*. If you find yourself typing `const X_STALL_HOURS: i64 = 2`,
   stop: 2 hours is 1,440 missed ticks for a 5-second loop and 0.1 of a cycle
   for a daily one, and the same constant cannot be right for both.
6. **Write the alarm as an age comparison against `last_success_at`, scoped by
   the loop's id.** Not a global count, not a count since boot.
7. **Dedupe by window, and clear on recovery.** `WHERE kind = ? AND status =
   'open'` — or a `last_alerted_at` you compare against a cooldown — so a
   standing failure re-pages every cadence. When the condition lifts, write the
   resolution. **Never let a uniqueness constraint be the debounce.**
8. **Log every early return with the loop's own name**, at `info!`. Ten sites in
   `subscription.rs` already do this for the quota gate; copy the line verbatim.
   The one that does not is the watchdog, and that is §7 D2.
9. **Then stop.** Do not add a second health map, do not add a per-loop
   `tokio::spawn`, and do not put the verdict only behind a panel a human has to
   open — that is a report, not a watchdog (P7).

## 5 Anti-patterns

- **A health record composed entirely of activity fields.** *Failure:* the
  record is complete, structured, exported to TypeScript, and cannot express the
  outage. **Measured: `SubscriptionHealth` (`background.rs:43-69`) has 14
  fields — `alive`, `started_at`, `interval_ms`, `last_tick_duration_ms`,
  `max_tick_duration_ms`, `overrun`, `tick_count`, `error_count`,
  `consecutive_panics`, `last_tick_at`, `avg_tick_duration_ms`,
  `overrun_count`, `slow_tick_count`, `name`. Thirteen describe the loop's own
  motion. Zero describe what it produced.**
- **Printing the tick count as evidence of health.** *Failure:* the number
  offered as proof is precisely the number that is unrelated to the claim.
  **Measured: `health.rs:715-770` is a four-arm classifier — dead / unstable /
  overrun / `else → Ok("Healthy -- {} ticks, avg {}ms")`. There is no fifth arm,
  and no field to build one from.**
- **An alarm deduplicated by a key that is unique for the life of the store.**
  *Failure:* the second occurrence is silently dropped, forever, and the silence
  reads as recovery. **Measured: one `fleet_stall` row, 67 days open, and
  `dedup_key TEXT NOT NULL UNIQUE` is not scoped by `status` — resolving it by
  hand would not re-arm it.** `brainiac` states the opposite policy in writing
  (§6).
- **Reading "0 rows affected" as "already handled".** *Failure:* it also means
  "the store refuses to let you speak". `promote` returns `Ok(None)`
  (`audit_incidents.rs:233`) for both, and the caller notifies only on `Some`.
- **A global output counter used as a per-loop liveness signal.**
  *Failure:* any other producer masks the dead one. `FleetLivenessWatchdog`
  counts **all** `persona_executions`, so a single manual chat run would have
  reported the whole autonomous fleet healthy for another two hours.
- **A bare `return;` in a periodic tick.** *Failure:* it is the same observable
  as a crash before the loop started, a leadership gate, and a healthy empty
  poll. **Measured: the fleet watchdog's autonomy gate (`:2980-2982`) and its
  cooldown gate (`:2983-2985`) both return with no log, and it has produced 0
  lines in 6 days of tracing logs while its own SQL says STALL.**
- **A shared mute with no per-loop record of muting.** `quota_cooldown_active`
  (`:1502`) silences **11 loops** from one 15-minute probe. Ten log it. The
  cheapest possible defect is the one that skips the log line.
- **A counter that resets at restart used as an outage clock.** *Failure:*
  "0 events delivered" cannot be dated. All 10 `SchedulerStats` counters are
  `AtomicU64` seeded at 0 on `start_loops` and are never persisted.
- **A watchdog scheduled by the supervisor it watches.** *Failure:* it cannot
  outlive what it is watching. `FleetLivenessWatchdog` and `QueueDrainWatchdog`
  are `ReactiveSubscription`s in the same registry as the 37 loops they exist to
  protect. `brainiac` has the identical defect and named it (§6).
- **A verdict only a human can pull.** *Failure:* nobody pulls it. The only
  reader of `SubscriptionHealth` is `SystemHealthPanel`, recomputed on demand.
  `vibeman` reinvented this exactly (§6).

## 6 Evidence

**The one site to copy: `db/src/repos/system_ops.rs:110-155`** —
`mark_run` + `mark_outcome`. Read it as four decisions:

1. **The record is a row, not a field in a process.** It survives every restart
   and every `stop_loops`.
2. **It carries a status *and* a detail**, and the detail names the artifact:
   the live row reads `last_detail = 'scan_id=6e33a772-891d-4141-a5df-66018ef6a811'`.
   A stalled automation is legible from its own row without reading any code.
3. **`mark_outcome` exists separately from `mark_run`**, and its doc comment
   (`:135-138`) says why: `mark_run` records that the work was *requested* and
   re-arms the clock; `mark_outcome` records what actually *happened*, reported
   back after the dispatch finished. That is P3 — attempt and success are two
   writes — implemented before anyone asked for it.
4. **It re-arms `next_run_at` in the same statement**, so "when should this have
   produced something by" is durable too.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/engine/curation_scheduler.rs:59-66` | a tick that **returns a count** and answers the empty case with `Ok(0)` rather than `return` |
| `src/engine/slack_poller.rs:131-137` | a `TickReport` struct with a **doc comment on why one product is counted apart from another** |
| `src/engine/subscription.rs:2955-3006` | the **output question** — "have any executions started in this window" — plus the two refusals (cooldown, no actionable work) that keep it from crying wolf |
| `src/engine/subscription.rs:2963-2967` | `idle_interval() == interval()`, with the comment *"Deliberately NOT slower when idle — 'idle' is precisely the state this watchdog exists to interrogate."* The single best line in the subject area |
| `src/daemon/lock.rs:50-118` | a staleness threshold **justified as three missed heartbeats**, not chosen |
| `src/engine/background.rs:1030-1038`, `:1141-1145` | a reap that is loud by construction: `warn!` with per-outcome counts *plus* a counter, *"so it is never silent"* |
| `src/engine/subscription.rs:1607` | the early-return log line to copy verbatim: `"<loop_name>: quota cooldown active — skipping tick"` |

### Convergence — 5 sibling repos, all opened

Swept read-only against `../personas-web` (1,614 files), `../brainiac` (771),
`../personas-cloud` (51), `../vibeman` (2,570), `../ascent` (1,710). **All five
exist and all five were opened**; nothing below is reported by omission. **The
oracle inverted the clause I was most confident about** — noted inline.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A health record for a background worker contains activity fields only** | **PHYSICS as a DEFECT (3/5)** | `vibeman` `src/lib/scanQueueWorker.ts:661-687` `getStatus()` returns `isRunning`, `isPolling`, `currentlyProcessing`, `config`, `adaptivePolling`, `waitingResolvers` — **no field names anything produced**, and it is what `GET /api/scan-queue/worker` serves. `personas-cloud` `packages/shared/src/types.ts:278-293` `WorkerInfo` is heartbeat + slots. `personas-web`'s only health surface is an SSE heartbeat (`api/events/stream/route.ts:80-108`). **Personas is the third instance, not an outlier.** |
| 2 | **Measure OUTPUT, not activity** | **NOT physics — 1.5 of 5, and Personas is on the right side** | Only `brainiac` does it properly: `crates/brainiac-server/src/alerts.rs` is a whole file whose doc comment names this defect — *"The UAT's central negative finding was not a crash; it was silence… no surface anywhere CHANGED STATE."* Four age-based breach conditions (`:77`, `:88`, `:101`, `:111`) against named SLOs (`brainiac-core/src/health.rs:22` `REVIEW_SLO_SECS = 48h`). `ascent` is partial (`api/health/route.ts:12` checks autoscan *config* readiness). `personas-cloud` and `vibeman` are silence: `vibeman`'s `collectAlerts()` (`api/system-status/route.ts:628-703`) has six conditions and **not one is a stall**; `personas-cloud` has 20+ counters (`orchestrator/src/metrics.ts`) and **not one is compared to a threshold anywhere**. Personas' `FleetLivenessWatchdog` is one of only two real ones in the family. |
| 3 | **The instrument already exists and is used for the wrong purpose** | **PHYSICS (3/5) — the most reproducible finding in the sweep** | `vibeman` increments `consecutiveEmptyPolls` on every empty poll (`scanQueueWorker.ts:340`) and then **caps it at 3** (`:255-259`) because it is a backoff dial — so it cannot distinguish "empty for 30 seconds" from "empty for three days". `personas-cloud` collects `executionsCompleted` per worker (`shared/src/protocol.ts:86`) and only stores it for display (`workerPool.ts:396`). Personas collects `triggers_fired`, `events_delivered` and `events_processed` and renders **none** of them (§7 D3). **Three codebases, three languages: the telemetry is already there and nobody wrote the comparison.** |
| 4 | **A standing alarm re-fires on a cadence** | **PHYSICS (2/5 explicit) — and Personas is ALONE in latching** | I expected the permanent latch to be common. It is not. **`ON CONFLICT DO NOTHING` / `INSERT OR IGNORE` on an alert key appears NOWHERE in all five repos.** `brainiac` states the policy outright at `alerts.rs:19-22`: *"**Cadence is the debounce.** A breach that persists re-alerts once per sweep cadence (default 6h) — deliberate: a stalled review queue that stays stalled SHOULD keep paging… rather than us silently deduplicating a standing failure into one forgotten message."* That sentence is a direct refutation of `subscription.rs:3063`'s *"stable → dedupes to ONE open incident"*. `ascent` uses a 6 h in-memory window (`src/lib/alerts.ts:156-166`) and a 7-day durable audit window (`api/cron/digest/route.ts:129-130`). **`ascent` supplies the one sibling with the same failure at a different door:** `alerts.ts:334-336` `isLowCreditsCrossing` is edge-triggered on exact equality, documented at `:329-333` as *"each crossing fires once with no dedupe state"* — so an org sitting at balance 0, the state that permanently stops all autoscans, pages exactly once ever. |
| 5 | **Something clears the alarm on recovery** | **SILENCE, 5/5 — universal and unsolved** | **No `resolved_at` on any alert, no "recovered" notification, and no alarm-state table in any of the five repos.** `brainiac` on recovery returns *"no breaches"* and posts nothing (`alerts.rs:123-124`). The only two-way health transition anywhere is `personas-cloud` `triggerScheduler.ts:169-172` flipping a trigger `degraded → healthy`, and that is a config-validity flag with no notification attached. Report as silence: recovery is communicated only by the absence of the next alert, which is indistinguishable from the alerting loop having died. |
| 6 | **The output measurement is scoped to the watched producer** | **SPLIT 2/2/1 — not physics** | Scoped: `brainiac` per-org + per-sweep-kind (`alerts.rs:56-121`, `sweeps.rs:358`), `ascent` per-repo (`schema.prisma:188-189`). Global: `personas-cloud` (`index.ts:136-137` pool-wide; the per-persona breakdown at `metrics.ts:208-223` is display-only), `vibeman` (`currentlyProcessing` is a bare `Set.size`). Personas is on the global side. |
| 7 | **A durable last-successful-work watermark, distinct from last-attempt** | **PHYSICS (2/5, both explicit, and both wrote the reason down)** | `brainiac` `sweep_schedules` (`sweeps.rs:60-78`): `next_run_at`, `last_run_at`, `last_status`, `last_detail`, `last_duration_ms`, with `last_detail` carrying the product (`"7 clusters, 1 divergences"`, `"{expired} raw memories expired across {orgs} orgs"`). `ascent` `prisma/schema.prisma:188-194`: `lastScanAt` **and** `lastScanAttemptAt` **and** `lastScanStatus`, with the comment at `:190` naming the exact distinction — *"so the dashboard can tell 'never scanned' apart from 'scanning is broken'."* **Personas has this shape in exactly one table (`system_op_automations`) out of 244**, and it is the §6 exemplar. |
| 8 | **A watchdog that is not a peer of what it watches** | **1/5, and the one that has a watchdog has the defect** | `brainiac`'s `alert_sweep` **is itself one of the sweeps** (`sweeps.rs:301`), so if the worker loop dies the watchdog dies with it. Identical to `FleetLivenessWatchdog` being a `ReactiveSubscription`. Nobody has solved it; report as an open hazard, not doctrine. |
| 9 | **CI/tooling bounds its own runtime** | **PERSONAS IS AHEAD, 5/5 vs 1/22** | Across the five siblings: **22 jobs, 1 with `timeout-minutes`, 0 step-level timeouts anywhere.** The one hit is `brainiac` `deploy-test.yml:49-51`, annotated *"the default 360-minute timeout would let a…"*. `personas-cloud` has **no `.github/` directory at all**. Personas' `ci.yml` now sets a timeout on **all 5 jobs** (`:25, :101, :215, :323, :350`) — added 2026-08-16 with the incident in the comment (§7 D8). |

> **The strongest sibling result is `brainiac`, and it is a written refutation.**
> This repo's alarm carries the comment *"stable → dedupes to ONE open
> incident"*. `brainiac`'s carries *"rather than us silently deduplicating a
> standing failure into one forgotten message"*. Two engineers, two stacks, the
> same design decision, opposite conclusions — and this repo's live database
> shows which one was right: **one row, 67 days, still open, never re-raised.**

> **`vibeman` supplies the empirical cost, as siblings usually do.** Its
> `consecutiveEmptyPolls` counter is the stall signal, already computed on every
> poll, deliberately clamped to 3 so it can serve as a backoff dial. And its
> whole alert surface is **pull-only** — `collectAlerts()` is recomputed on each
> `GET /api/system-status` and pushed nowhere — which is precisely the failure
> `brainiac`'s `alerts.rs:5-7` was written to eliminate, and precisely what
> `SystemHealthPanel` is here.

## 7 Deviations

Every entry is live on `master` @ `cd9d094d9` and measured against read-only
copies of the operator's databases.

### D1 — the stall alarm is a one-shot latch for the life of the database

`subscription.rs:3062-3063` raises with `source_id: "fleet_stall"` — a string
literal. `audit_incidents.rs:69-71` builds `dedup_key = "fleet:fleet_stall"`;
`incremental.rs:2527` declares `dedup_key TEXT NOT NULL UNIQUE` **without a
status scope**; `audit_incidents.rs:209-233` is `INSERT OR IGNORE` returning
`Ok(None)` on conflict; `subscription.rs:3075` notifies only on `Some`.
Nothing resolves or re-raises a `fleet_stall` (**4 occurrences of the string in
963 `.rs` + 4,828 `.ts` files: 2 comments, the `source_id`, the `kind`**).

Live: **1 row, created 2026-06-10T08:26:46Z, `status='open'`, 67.2 days,
`acknowledged_at`/`resolved_at`/`continued_at` all NULL** — while the watchdog's
own replayed SQL returns STALL today.

**Fix (three parts, all small):** (a) window the dedupe — make the alarm's key
`fleet_stall:<YYYY-MM-DD-HH>` or gate the raise on
`NOT EXISTS (SELECT 1 FROM audit_incidents WHERE kind='fleet_stall' AND status='open' AND created_at > ?cooldown)`;
(b) auto-resolve — when a tick finds `recent > 0`, resolve any open
`fleet_stall`; (c) stop reading `Ok(None)` as "already reported" — it also means
"the store will not let me speak", and those need different handling.

### D2 — the watchdog is disarmed by a user setting and says nothing

`subscription.rs:2980-2982`:

```rust
if !advancement_on && !any_full {
    return;
}
```

All 11 `autonomous_*` rows in `app_settings` are `'false'`, written
2026-06-17T05:31. So the app's only output-based watchdog has been switched off
for 60 days by a setting whose UI never mentions the watchdog, and **the
disarming is recorded nowhere**: 0 lines in 6 days of tracing logs, no row, no
health item. Ten sibling loops log their equivalent early return
(`:1607, :1820, :2165, :2338, :2449, :2551, :2634, :2791, :2878`,
`deliberation.rs:855`); this one and the cooldown gate one line below it
(`:2983-2985`, comment *"silence is explained"*) do not.

**Fix:** `tracing::info!("fleet_liveness_watchdog: autonomy off — watchdog
disarmed")` at both gates, and surface "disarmed" as a distinct
`HealthCheckStatus::Info` item rather than as absence. A watchdog that can be
turned off silently is worse than none, because its silence is read as safety.

### D3 — 10 of 10 scheduler throughput counters and 14 of 14 health fields have zero readers

`SchedulerStats` (`background.rs:418-434`) carries `events_processed`,
`events_delivered`, `events_failed`, `triggers_fired`, `chain_cascades_total`,
`chain_cascade_duration_ms`, `queue_rejections`, `subscriptions_crashed`,
`trace_continuity_breaks`, `events_reaped`. Grepped across all 4,828 `.ts`/`.tsx`
files excluding `src/lib/bindings/`, **every one of the camelCase field names
returns 0 hits.** The only consumed field is `running` — a boolean rendered as
"engine running / engine stopped" at `ScheduleTimeline.tsx:255, :259, :261`.

`getSubscriptionHealth()` (`src/api/pipeline/scheduler.ts:21`) — the whole
14-field per-loop record — has **0 callers** outside its own module.
`tickCount`, `lastTickAt`, `consecutivePanics`, `overrunCount`, `slowTickCount`,
`avgTickDurationMs`: **0 hits each.**

**Fix:** delete `getSubscriptionHealth` or give it a consumer; and stop adding
counters to `SchedulerStats` until one of the ten is read. Adding an eleventh is
not observability.

### D4 — the health classifier's healthy arm prints the tick count as its evidence

`health.rs:715-770` `build_subscriptions_section` — four arms:
`!alive → Error` · `consecutive_panics > 0 → Warn` · `overrun → Warn` ·
`else → Ok("Healthy -- {} ticks, avg {}ms")`. **A loop that has ticked a million
times and produced nothing reads `Healthy -- 1000000 ticks, avg 3ms`.** There is
no fifth arm and no field in `SubscriptionHealth` from which to build one.

The section *is* rendered (`useHealthChecks.ts:39` → `SystemHealthPanel.tsx:22`),
which makes it the app's most confident wrong answer about this subject.

**Fix:** after *Prefer a type over a gate* lands, add
`last_produced_at: Option<String>` + `produced_total: u64` to
`SubscriptionHealth`, and a fifth arm: `alive && now - last_produced_at > n *
interval → Warn("Ticking, produced nothing for …")`.

### D5 — 29 of 39 production loops leave no trace at all in six days of logs

Every production subscription name grepped across
`personas.2026-08-11.log` … `personas.2026-08-16.log` (~4.3 MB). **10 names
appear; 29 appear zero times**, including `trigger_scheduler`,
`zombie_execution_sweep`, `healing_ttl_sweep`, `shared_event_relay`,
`kpi_evaluation`, `queue_drain_watchdog` and `fleet_liveness_watchdog`. (A
name-substring grep over-counts presence, so 29 is a lower bound on the silent
set; three of the ten "present" names score 2–3 lines over six days, i.e.
startup only.)

This is by design, and that is the problem: `run_single`'s success path
(`subscription.rs:1377-1424`) calls `record_tick_latency` into the in-memory map
and then logs `tracing::debug!("Tick completed")` — invisible at the default
`info` filter — plus `warn!` on overrun and on slow. **The three things the
supervisor can say about a completed tick are: it was slow, it was very slow, or
nothing. None of them is about what the tick did.**

**Fix:** once `tick` returns an outcome (see below), have `run_single` log at
`info!` when the outcome is non-zero, and update the durable watermark. One
edit at the supervisor covers all 39 loops.

### D6 — `dev_tasks` holds 2 rows `running` for 129 days with no reaper

`8fea62ab…` and `3cd603c1…`, both created 2026-04-09T15:30:57, both with
`updated_at` 6 ms later — they never advanced past creation. Ownership is
[long-running-job-progress](./long-running-job-progress.md), which already
records `dev_tasks` as having no boot recovery pass; this is its live artefact,
and it is 129 days old. Noted here because it is the oldest measured instance of
the leaf in the tree.

### D7 — the alert engine can express "produced too little" and has never been asked to

`AlertMetric::Executions` + `AlertOperator::Lt` (`core/src/models/observability.rs:15-21`,
evaluated at `commands/execution/alert_evaluator.rs:83-110`) is exactly the
stall rule. **`alert_rules`: 0 rows. `fired_alerts`: 0 rows.**

And the evaluator itself carries the leaf's defect: `ErrorRate` (`:85-92`) and
`SuccessRate` (`:93-100`) both return **`0.0` when `decided == 0`**. A system that
produced nothing at all reports an error rate of **0%** — the healthiest
possible value — and a success rate of **0%**, which would fire a
`SuccessRate < 95` rule for the wrong reason on every genuinely idle window. The
"no data" case has no representation; it is silently coerced to a number in both
directions.

**Fix:** make the snapshot's ratio fields `Option<f64>` and make an alarm on a
`None` window a deliberate, separate decision — the same shape as
`parseExecutionState` refusing to map an unknown status to `failed`
(`executionState.ts:75-87`).

### D8 — CI: fixed for jobs, still open for steps

`ci.yml` had **no job timeout until 2026-08-16**; a hung Clippy step on the macOS
runner ran for **six hours** (GitHub's default cap) *"while the run showed
in_progress and nobody could tell it was dead"* (`ci.yml:21-24`). All 5 jobs now
carry one (`:25, :101, :215, :323, :350`). **Still open:** `ai-conformance.yml`,
`audit.yml` and `codeql.yml` have **0 timeouts across ~7 jobs**, and **no
workflow in this repo sets a single step-level timeout** — so a hung step inside
the 60-minute `rust-tests` job still burns 60 minutes before anyone learns
anything. Same defect, same leaf, different substrate.

### Structural — where the durable watermarks are

Of **244 tables** in `personas.db`, exactly **one** carries the
`last_run_at` + `last_status` + `last_detail` shape for a recurring producer:
`system_op_automations` (1 row). `db_saved_queries` has `last_run_at` /
`last_run_ok` / `last_run_ms` and **0 rows**. `persona_executions` carries
`last_heartbeat_at` on 2,056 of 2,188 rows and `claimed_by_instance` /
`claim_expires_at` on **0** — carried forward unchanged from
[terminal-state-and-recovery](./terminal-state-and-recovery.md) D5; nothing has
closed it. **Nothing anywhere records what a *loop* last produced.**

## 8 Gaps — what the primitives genuinely cannot do

1. **The only durable channel a tick can write to today discards healthy
   ticks.** `logging.rs:121` gives 7 daily rolling files; `run_single` writes to
   it at `debug!` on success and `warn!` on slowness. So the app's own log
   cannot answer "when did this loop last do something" for 29 of 39 loops, and
   at 7-day retention it could not answer it for a 51-day outage even if it did.
2. **`SchedulerState` is process-scoped by construction.** Every counter is an
   `AtomicU64` and `subscription_health` is a `std::sync::Mutex<HashMap<…>>`
   (`background.rs:124`), both seeded fresh on `start_loops`. There is **no
   table** anywhere for loop health, so "0 delivered since boot" and "0
   delivered ever" are the same reading and always will be until a schema
   lands. This is why §2(b) is the clause to get right first.
3. **`ReactiveSubscription::tick` returns `()`** (`subscription.rs:90`), so the
   supervisor *cannot* record throughput even though it owns the health map, is
   already at the right instruction, and already records latency two lines
   later. This is the gap the type proposal closes, and everything in §7 D3–D5
   is downstream of it.
4. **The census cannot assert an absence, and this leaf is made of absences.**
   "No loop records what it produced", "this event has no listener", "nothing
   ever clears this alarm", "29 loops leave no trace" are the four largest
   findings above and **none is expressible as a count of something present.**
   They were found by querying the database and reading the log — by running the
   system, which is the only instrument that sees them.
5. **A stall is a property of the deployment, not of the source.** Whether *this
   machine's* trigger loop has fired is not a fact about any file. No source-level
   gate in any repo can see it; a runtime probe is required, and §9 specifies one.
6. **Nothing relates a watchdog's arming condition to its consumers.** The
   fleet watchdog is disarmed by `autonomous_goal_advancement`, a setting owned
   by a completely different feature, and no type, test or gate connects them.
   The setting's UI does not know a watchdog depends on it.
7. **A watchdog scheduled by the supervisor it watches cannot report that
   supervisor's death.** `FleetLivenessWatchdog` is a `ReactiveSubscription`; if
   `run_single` retires (generation bump) or the leadership gate flips, the
   watchdog stops with everything else and its silence is the same silence.
   `brainiac` has the identical structure (§6 clause 8). Nobody in the family has
   solved it; the honest mitigation is an independent durable heartbeat file, the
   way `engine-leader.lock` already works.

## Prefer a type over a gate

**Make one cycle of a periodic loop return what it produced:
`async fn tick(&self) -> TickOutcome`.**

Today `ReactiveSubscription::tick` is declared `async fn tick(&self);`
(`subscription.rs:90`) and **45 of the 50 `fn tick(` definitions in the tree
return `()`**: the trait declaration, **all 41 implementations**, and three
free-standing periodic cycles (`alert_evaluator.rs:191`,
`night_shift/mod.rs:334`, `leadership.rs:168`). Five sibling tick functions —
`curation_scheduler.rs:61`, `discord_poller.rs:103`, `slack_poller.rs:139`,
`team_slack_relay.rs:336`, `webhook_notifier.rs:600` — already return
`Result<usize, …>` or `Result<TickReport, …>`. **The repo has both forms and has
been building the right one for four years' worth of pollers while the
registry's own trait keeps the wrong one.**

```rust
/// What one cycle produced. There is no `TickOutcome::default()` and no
/// `From<()>`: a tick must say what it did.
#[non_exhaustive]
pub enum TickOutcome {
    /// Looked, found no work. A measurement, not a silence.
    Idle,
    /// Produced `n` units, described by a short, stable label.
    Produced { n: u64, detail: Cow<'static, str> },
    /// Did not look. `why` is the gate that stopped it (a flag, a cooldown,
    /// leadership) — the thing D2 currently drops on the floor.
    Skipped { why: &'static str },
    Failed { error: String },
}

async fn tick(&self) -> TickOutcome;   // was: async fn tick(&self);
```

`run_single` (`subscription.rs:1377`) then does — at the instruction where it
already calls `record_tick_latency` — one match: stamp `last_produced_at` on
`SubscriptionHealth`, `info!` the non-`Idle` outcomes with the loop's name, and
write the durable watermark row. **One edit at the supervisor covers all 39
loops**, which is the same leverage `<Numeric>`'s locale default had over 212
call sites (contract §9).

Held against all seven qualifications:

1. **A required prop carries only what it actually encodes.** ✔ `TickOutcome`
   encodes "what this cycle produced" and nothing else. It deliberately does
   **not** encode health — `Idle` is correct and healthy for a poller with an
   empty queue. Folding a verdict in would repeat the `successRateSource`
   failure; the verdict is `now - last_produced_at > n * interval`, computed by
   the supervisor from the *sequence* of outcomes, which is a different fact.
2. **Requiredness is orthogonal to closedness — and here requiredness is the
   whole win, which is unusual.** `()` is not "unanswered"; it is a definite
   answer ("nothing to say") that the language supplies for free at 45 sites.
   Making the return type non-`()` withdraws the free answer. Closedness matters
   too (`Skipped { why }` cannot be spelled as prose in a log nobody parses),
   but the load-bearing edit is that **there is no longer a way to return
   nothing.**
3. **A type nobody constructs constrains nothing.** ✔ **and this is the
   discriminating point.** Count the construction sites: **45, and `rustc`
   creates every one of them.** You cannot add a subscription without
   constructing a `TickOutcome`; there is no opt-out, no second door, no
   `impl Default`. Compare the three inert primitives the corpus has already
   catalogued — `ExecutionState::TERMINAL` (0 production references),
   `claim_for_instance` (0 production callers, 0 of 2,188 rows),
   `ProcessSession` (0 implementors), plus `vibeman`'s Status Algebra (0
   production value-imports). **Every one of those is *available*. This one is
   *unavoidable*, and that is the entire difference.**
4. **A type anyone can construct authenticates nothing.** ✔ with an honest
   limit, and it must be stated: nothing stops a lazy author writing
   `TickOutcome::Idle` unconditionally. The type cannot make a loop honest. What
   it *does* make impossible is the current state — a loop with **no opinion at
   all**, which is what all 45 sites have. Narrowing `Produced { n }` to
   `NonZeroU64` closes the "produced zero, said produced" lie; `Idle` stays a
   trust boundary, and the ratchet in §9 is what holds the line while the
   conversion happens.
5. **Withholding beats requiring.** ✔ — read correctly. The naive reading says
   this clause is *requiring* and therefore weak. It is not: what is withheld is
   **the default answer**. Today the caller is handed "say nothing" for free by
   the return type; afterwards that option does not exist. Requiring a
   *parameter* would be the weak move (a caller supplies a wrong one happily);
   removing the ability to decline to answer is the strong one.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom
   is **finishing a cycle without saying whether anything happened**. The
   answer — "nothing to do right now" — stays fully expressible as
   `TickOutcome::Idle`, and gains a distinction it does not have today:
   `Idle` (looked, found nothing) vs `Skipped { why }` (did not look). D2 is
   exactly the case where those two are conflated into a bare `return;`.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** ✔ and it rules out the alternative I first reached for. Nobody
   *forced* `build_subscriptions_section` to classify on tick counts; it
   classifies on tick counts because **that is all `SubscriptionHealth` holds**.
   Relaxing any signature there is inert. Likewise, adding
   `last_produced_at` to `SubscriptionHealth` *alone* is inert — nothing would
   ever write it, because at the one moment the supervisor could
   (`subscription.rs:1394`) the tick has already returned `()` and the
   information is gone. **The type must go on `tick`, upstream, or the field is
   another `claim_for_instance`.**

**Does the type reach the code?** **Yes, and this is the cleanest reach in the
corpus.** `tick` is a trait method: `rustc` visits all 41 implementations, and
**3 of the 4 outside `subscription.rs` are path-qualified**
(`impl crate::engine::subscription::ReactiveSubscription for …` at
`overnight.rs:539` and `incident_continuation.rs:349`,
`impl super::subscription::… ` at `pattern_miner.rs:367`) — the doctrine's
"path-qualified types did not match its pattern" trap, live, and the compiler
does not care. There is no SQL string literal, no `OnceLock`, no environment
variable anywhere in this path. Contrast the *other* candidate on this leaf:
making the alarm's dedup key a type that cannot be a constant. That one **cannot
reach the code**, because the key is assembled by `format!("{source_table}:{source_id}")`
(`audit_incidents.rs:70`) out of two `String`s and lands in a SQL string; the
uniqueness that breaks it is a `UNIQUE` clause in a migration
(`incremental.rs:2527`). No Rust type is at that boundary. D1's fix is a
predicate, not a type — and §9's ratchet is the rest of the answer.

**Fix order:** (1) D1 by hand — the alarm is latched *today* and it is three
small edits; (2) D2's two log lines; (3) `TickOutcome` on the trait, then
`run_single`'s match; (4) the durable watermark table, copying
`system_ops::mark_run`/`mark_outcome`; (5) `SubscriptionHealth.last_produced_at`
and D4's fifth arm; (6) delete §9's rule when it reaches zero.

## 9 The missing gate

**The condition, stated stack-free:** *the contract for one cycle of a periodic
loop returns nothing, so the supervisor that owns the loop can measure how long
the cycle took but can never record what it produced — and "found no work",
"was switched off", and "is broken" collapse into one observable.*

An adopting repo must derive its own proxy. This one keys on a Rust `fn tick(`
definition and its return arrow; a TypeScript repo spells the identical
condition as `private async poll(): Promise<void>` and a Go repo as
`func (w *Worker) tick()`, and **this pattern scores a structural zero in every
one of them while the condition is present at scale** — `vibeman`'s
`processQueueItems()` and `personas-cloud`'s `triggerScheduler` tick both return
`Promise<void>` (§6 clause 1).

**Where it runs:** `npm run census:check`, invoked by the **`golden-path-census`
pre-push job** (`lefthook.yml:74-75`) and by `npm run check` (`package.json:52`).
Explicitly **not** CI-only: `ci.yml` now runs the Rust suite but is red on 10
pre-existing failures, so a gate that runs only there runs nowhere.

**Fail-loud**, inherited from the runner: a walk below `floor: 900` (the tree is
963 `.rs` files), a rule matching zero files, a stale `exclude`, a rise, or a
**silent drop** all exit non-zero.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unraced-loop-wait` (`background-loop.md`, 12/13) | a `loop {` whose first statement is a bare, un-raced wait | The nearest neighbour and **structurally disjoint**: it matches `loop {` bodies and `.tick()` **call sites**; this matches `fn tick(` **definitions**. Both touch `alert_evaluator.rs` — at `:362` and `:191`. **Verified: 0 shared match positions.** |
| `unswept-job-registry-read` (`long-running-job-progress.md`, 6/9) | a `*_JOBS.lock()` read without a sweep | In-memory `HashMap`, not a loop contract. 0 shared positions. |
| `anonymous-deadline` (`timeout-tiering.md`, 38/61) | `timeout(Duration::from_secs(N))` with a literal | The bound on ONE operation. Closest *conceptual* neighbour. 0 shared positions. |
| `discarded-sync-watermark-write` (`sync-reconciliation-and-conflicts.md`, 4/11) | `let _ = …watermark(…)` | About discarding a watermark **write**. This is about there being no value to write. 0 shared positions. |
| `unverified-effect-dispatch` (`post-write-side-effects.md`, 60/162) | `let _ = …emit(…)` | Would catch a discarded emit, not a `()`-returning definition. 0 shared positions. |
| `silent-row-skip`, `discarded-guard-verdict`, `blind-identity-write`, `unfenced-work-outcome-write`, `untimed-repo-query`, `process-global-caches-a-failure`, `hand-rolled-emptiness-refusal` | row iterators, CAS verdicts, single-row writes, terminal-status writes, query timing, `OnceLock`, emptiness checks | All about a **statement's** result. None keys on a function's declared return type, and none mentions `tick`. |

**None of the 119 existing rules keys on a periodic-cycle contract.** Proposing
one.

### Measurement — an exact partition of every `fn tick(` in the tree

Two independent implementations, agreeing **to the line**:

| implementation | violating | compliant | total |
| --- | ---: | ---: | ---: |
| paren-counting Rust scanner (walks the param list by depth, brace-matched `#[cfg(test)]`, `*_tests.rs` filename rule) | **45** / 8 files | **5** / 5 files | 50 |
| the census engine, from the published pattern | **45** / 8 files | **5** / 5 files | 50 |

**45 + 5 = 50 accounts for every `fn tick(` definition in 963 `.rs` files.**
There is no third population, so this is a partition rather than a ratio. The
anchor is the method name, not the trait name — which matters: an anchor keyed
on `impl ReactiveSubscription for` would have missed **3 of 41 impls**, because
they are written `impl crate::engine::subscription::ReactiveSubscription` and
`impl super::subscription::ReactiveSubscription` (`overnight.rs:539`,
`incident_continuation.rs:349`, `pattern_miner.rs:367`). The doctrine's
path-qualified-type miss, reproduced and avoided.

**Precision 45/45 — every match opened.** 38 are in `subscription.rs` (the trait
declaration at `:90` plus 37 impls); the other 7 are
`alert_evaluator.rs:191`, `overnight.rs:554`, `night_shift/mod.rs:334`,
`deliberation.rs:848`, `incident_continuation.rs:366`, `leadership.rs:168`,
`pattern_miner.rs:385` — all genuine periodic cycles, all discarding what they
did.

**Contamination: 2 of 45**, both `TestSubscription` and `PanickingSubscription`
inside `subscription.rs`'s own `#[cfg(test)]` module (`:3171`, `:3271`),
identified by an independent brace-matched range scanner plus a `*_tests.rs`
filename rule. The census engine cannot exclude a test range
([terminal-state-and-recovery](./terminal-state-and-recovery.md) Gap 6), so the
baseline carries them, exactly as `silent-row-skip` documents carrying 4. The
production figure is **43**.

**Fault injection: 11 cases, all correct** — `async fn tick(&self) {` → V ·
`async fn tick(&self) -> TickOutcome {` → C · `async fn tick(&self);` (trait
decl) → V · `... -> TickOutcome;` → C · `interval.tick().await;` → neither ·
`self.sub.tick().await;` → neither · `pub(crate) async fn tick(pool: &DbPool, app: &AppHandle) {` → V ·
`fn ticker(&self) {` → neither · a multi-line parameter list → V ·
`pub fn tick(pool: &DbPool) -> Result<usize, AppError> {` → C ·
`let _ = handle.tick();` → neither.

**Backtracking:** the fill is `[^)]{0,200}` — a bounded quantifier over a single
negated character class, no nesting. Full 963-file run of both rules: **0.42 s**,
1,926 file-visits. `commentMatchesSkipped: 0`.

**Overlap:** the five nearest rules were re-run as controls and their **236
match sites** compared against these 50. **0 collisions.**

**Validated standalone** in a composer-private registry
(`registry-stall-watchdog-composer.json` — a filename unique to this composer,
because sibling composers share the scratchpad), then **re-extracted from this
finished document and re-run: `files 8 / matches 45` and `files 5 / matches 5`,
identical both times.**

### The rule

```json
{
  "rules": [
    {
      "id": "outcomeless-tick",
      "goldenPath": "docs/concepts/golden-paths/stall-watchdog.md",
      "title": "One cycle of a periodic loop returns nothing, so the supervisor that owns the loop can time the call but can never record what the call produced.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:async\\s+)?\\bfn\\s+tick\\s*\\([^)]{0,200}\\)\\s*[{;]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A `fn tick(...)` DEFINITION whose parameter list is followed directly by `{` or `;` rather than by `->` — i.e. one cycle of a periodic loop that returns (). Matches the trait declaration and every implementation; does NOT match `.tick()` call sites (the anchor requires the `fn` keyword) or `fn ticker(` (the anchor requires `(` immediately after `tick`). PROXY FOR the stack-free condition: the contract for one cycle of a periodic loop returns nothing, so the supervisor can measure how long the cycle took but can never record what it produced — and 'found no work', 'was switched off' and 'is broken' collapse into one observable. THE SUPERVISOR IS ALREADY AT THE RIGHT INSTRUCTION AND CANNOT ACT: run_single (src-tauri/src/engine/subscription.rs:1377-1424) awaits the tick, then calls record_tick_latency into an in-memory SubscriptionHealth map two lines later — it owns the health record, it owns the clock, and the only thing it never receives is what the tick did. MEASURED 2026-08-16 at cd9d094d9 over 963 .rs files: 45 matches across 8 files, ALL FORTY-FIVE OPENED AND READ (precision 45/45), commentMatchesSkipped 0. 38 are in engine/subscription.rs (the trait declaration at :90 plus 37 impls) and 7 elsewhere: commands/execution/alert_evaluator.rs:191, commands/infrastructure/overnight.rs:554, companion/night_shift/mod.rs:334, engine/deliberation.rs:848, engine/incident_continuation.rs:366, engine/leadership.rs:168, engine/pattern_miner.rs:385. THE ANCHOR IS THE METHOD NAME, NOT THE TRAIT NAME, AND THAT IS LOAD-BEARING: an anchor keyed on `impl ReactiveSubscription for` misses 3 of 41 implementations, which are spelled `impl crate::engine::subscription::ReactiveSubscription` (overnight.rs:539, incident_continuation.rs:349) and `impl super::subscription::ReactiveSubscription` (pattern_miner.rs:367). CONSEQUENCE, MEASURED AGAINST READ-ONLY COPIES OF THE OPERATOR'S LIVE DATABASES: of 244 tables in personas.db exactly ONE (system_op_automations, 1 row) records last_run_at + last_status + last_detail for a recurring producer; SubscriptionHealth's 14 fields are all about the loop's own motion; all 10 SchedulerStats throughput counters have ZERO reads across 4828 .ts/.tsx files; and 29 of 39 production loops leave zero lines in six days of the app's own rolling tracing log. persona_executions has produced NOTHING for 50.9 days while every one of these instruments reads healthy. CONTAMINATION: 2 of the 45 are TestSubscription/PanickingSubscription inside subscription.rs's own #[cfg(test)] module (:3171, :3271), verified by an independent brace-matched range scanner plus a *_tests.rs filename rule; the census engine cannot exclude a test range, so the baseline carries them exactly as silent-row-skip carries 4 — the production figure is 43. POSITIVE CONTROL: outcomeless-tick-positive-control, the IDENTICAL anchor with `->` in place of `[{;]`, matches 5 files-5 / matches-5. The two are mutually exclusive BY CONSTRUCTION (a parameter list cannot be followed by both `->` and `{`), and 45 + 5 = 50 accounts for EVERY fn tick( definition in the tree, so the partition is exact rather than a ratio. TWO INDEPENDENT IMPLEMENTATIONS — a paren-counting Rust scanner and the census engine — returned 45/8 and 5/5 with identical line numbers. FAULT-INJECTED 11 WAYS, all correct, including the trait declaration form (`;` not `{`), a multi-line parameter list, `interval.tick().await`, `self.sub.tick().await` and `fn ticker(`. BACKTRACKING: the fill is [^)]{0,200} — a bounded quantifier over a single negated class, no nesting; full 963-file run of rule + control 0.42s. ZERO MATCH-POSITION OVERLAP with the five nearest rules (unraced-loop-wait, unswept-job-registry-read, anonymous-deadline, discarded-sync-watermark-write, unverified-effect-dispatch), verified by re-running all five and comparing 236 sites against these 50; unraced-loop-wait and this rule both touch alert_evaluator.rs, at :362 and :191 respectively. LEGAL FIX: give tick a return type — `-> Result<usize, AppError>` for one product or a named report struct for several. The repo already has BOTH forms and the compliant one is older: curation_scheduler.rs:61 (`Returns the number of jobs enqueued this tick`), discord_poller.rs:103 and slack_poller.rs:139 (`TickReport { picked, replied, ingested }`), team_slack_relay.rs:336, webhook_notifier.rs:600. Do NOT silence a match by returning `-> ()` explicitly, by moving the body into a helper that returns a count and discarding it, or by adding a mutable out-parameter — all three preserve the defect and merely hide it from this signal. PRECONDITION (must be re-derived per repo): this repo spells one loop cycle as a Rust method literally named `tick` and declares return types with `->`. A TypeScript repo spells the identical condition `async poll(): Promise<void>` and a Go repo `func (w *Worker) tick()`; both sibling repos that exhibit the defect (vibeman's processQueueItems, personas-cloud's triggerScheduler) score a structural zero against this pattern while the condition is present at scale. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, BY DESIGN — DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-16 @ cd9d094d9 — 963 .rs files walked; two independent implementations agreeing at 45/8 and 5/5 with identical line numbers; every match hand-read; 11 fault-injection cases; 0 overlap across 236 neighbour match sites; live consequences replayed against read-only copies of personas.db (244 tables) and personas_data.db (71 tables)."
      },
      "baseline": { "files": 8, "matches": 45 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "outcomeless-tick-positive-control",
  "goldenPath": "docs/concepts/golden-paths/stall-watchdog.md",
  "title": "POSITIVE CONTROL — the same anchor, followed by a return type that names what the cycle produced.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:async\\s+)?\\bfn\\s+tick\\s*\\([^)]{0,200}\\)\\s*->",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL anchor as outcomeless-tick — same keyword, same method name, same bounded parameter-list fill — with the trailing `[{;]` replaced by `->`. The two are mutually exclusive BY CONSTRUCTION, not merely empirically: a parameter list cannot be followed by both an arrow and a brace. MEASURED 2026-08-16 at cd9d094d9: 5 matches across 5 files versus the gate's 45 across 8. PARTITION, NOT A RATIO: 45 + 5 = 50 = every fn tick( definition in 963 .rs files, so every cycle contract in the tree is classified and there is no unexamined third population. The 5 compliant sites are engine/curation_scheduler.rs:61 (`pub fn tick(pool: &DbPool) -> Result<usize, AppError>`, whose doc comment at :59-60 states the contract outright — 'Returns the number of jobs enqueued this tick' — and which answers the empty case with Ok(0) rather than an early return), engine/discord_poller.rs:103 and engine/slack_poller.rs:139 (both `-> Result<TickReport, AppError>`, a per-product struct whose third field carries a doc comment explaining why `ingested` is counted apart from `picked`), engine/team_slack_relay.rs:336 and engine/webhook_notifier.rs:600 (both `-> Result<usize, AppError>`). Its purpose is to demonstrate that the gate discriminates on the RETURN TYPE and not on the tokens `fn`, `tick` or the parameter list, all of which the compliant population carries identically: 10% of this repo's periodic-cycle contracts report what they produced and 90% do not. The compliant five are also the OLDER code — the pollers and relays got this right before the subscription registry existed — which is why this control is evidence that the fix is idiomatic here rather than imported. If this control's count ever collapses toward zero while the gate's holds, the shared anchor has broken and BOTH numbers are meaningless; that is the failure this control exists to make visible. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction.",
    "$measured": "2026-08-16 @ cd9d094d9 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 5 files / 5 matches both times."
  },
  "floor": 900
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **an alarm raised with a string-literal `source_id`** (D1's exact defect) | **2** | 40+ | The sharpest condition in the document and **unshippable as a ratchet**: `grep 'source_id: "'` over `src-tauri` returns exactly 2 hits, one of which (`incident_diagnosis.rs:361` `"a-1"`) is a test fixture. A one-production-match rule dies structurally the moment that line is fixed, and the runner correctly treats zero matches as a broken matcher. Carried as D1 with the fix spelled out. |
| **`INSERT OR IGNORE` used as an alarm debounce** | 94 | 2 | 94 `INSERT OR IGNORE` sites in `src-tauri`, and the overwhelming majority are legitimate idempotent seeds (catalogs, settings, migrations). No regex separates "idempotent seed" from "alarm silenced forever" — they are the same characters. **A gate firing on correct content at 90%+ is worse than no gate.** |
| **a health classifier with no "produced nothing" arm** | 1 | 0 | One match (`health.rs:715`), and it is an **absence dressed as a presence**. Carried as D4. |
| **`SubscriptionHealth` has no output field** · **`EXECUTIONS_SILENT_DETECTED` has no listener** · **29 loops leave no log line** · **no table records loop throughput** | n/a | n/a | All four are **absences**. The census counts presences; "no field anywhere names what the loop produced" has no textual signal. This is the same limit [retention-and-pruning](./retention-and-pruning.md) and [terminal-state-and-recovery](./terminal-state-and-recovery.md) recorded, and it bounds every largest finding in this document. See below. |
| **a periodic tick with a bare `return;`** | ~1,855 `if …is_empty() {` sites in `src-tauri` | — | Precision is the problem: an early return on an empty result set is *usually correct*. The defect is the return **without a record**, and no regex sees the absence of a log line without a tempered-dot construction over thousands of characters — a nested quantifier the doctrine explicitly bans as unrunnable. Carried as §5 and §7 D2. |

### What the census fundamentally cannot gate here — and the instrument that can

**"Nothing produced output" is an absence, and the census ratchets presences.**
No rule counting source text can say that this machine's trigger loop has not
fired in 80 days, that `persona_executions` stopped 51 days ago, or that a
`fleet_stall` incident has been latched open for 67. Those are properties of a
**deployment**, and they were found the only way they can be found — by copying
the live databases and running the app's own watchdog SQL against them.

So the honest second half of this §9 is a **specification for a different
instrument**, in the shape of `scripts/check-csp-hosts.mjs` (which exists
precisely because an allowlist-covers-a-set condition cannot live in the census):

**`scripts/check-loop-liveness.mjs`** — a dev-time probe, run against a
**read-only copy** of the local `personas.db`:

1. **Its own fail-loud precondition first, and this is the part that matters.**
   Exit 2 if the database is absent, if it holds **zero** tables, or if the
   producer inventory below resolves to **zero** loops — the three ways this
   check could silently become the thing it is watching. Print the inventory
   size on success, so a log distinguishes "clean" from "checked nothing".
2. **A declared inventory**, committed beside the script: one entry per
   production loop, naming the loop and the table + timestamp column that
   proves it did something (`trigger_scheduler → persona_triggers.last_triggered_at`,
   `event_bus → persona_events.processed_at WHERE status='delivered'`,
   `oauth_refresh → credential_audit_log.created_at`, …). **Assert the
   inventory covers all 39 `ReactiveSubscription` impls** — a loop added
   without an entry fails the check. This is the "enumerate the places that need
   the behaviour, not the places that exhibit the bug" rule from the doctrine.
3. **For each entry**: `MAX(ts)`, its age, and the loop's `interval()`. Report
   `age > k * interval` as a stall, `k` per entry with a written justification
   (three missed cycles is the `daemon/lock.rs:57` precedent).
4. **Report, do not fail, on a stall** — an operator's machine legitimately
   idles. The check **fails** only on its own preconditions and on an
   uncovered loop. That is the distinction `brainiac` got right and everything
   else in the family got wrong: the alarm is advisory, the *instrument* is
   mandatory.

It is ~120 lines, it uses `node:sqlite` (no dependency), and running it today
would have printed 51 days for `event_bus`, 80 for `trigger_scheduler` and 129
for `dev_tasks` — which is the entire content of §0, produced in under a second,
by the one thing nobody had built.

## 12 Corrections to the brief

1. **"Find out whether [the watchdog and breaker guards] would catch the 79-day
   case." They would not, and there are four independent reasons, not one.**
   `FleetLivenessWatchdog` (a) arms only when `autonomous_goal_advancement` is
   on or some project is on `Full` autopilot (`:2978-2982`) — a scheduled
   trigger has nothing to do with goal advancement; (b) tests for actionable
   work using `dev_goals` + `dev_ideas` + `team_assignments` (`:3006-3033`) and
   **never counts enabled schedule triggers**, so 39 armed triggers and no dev
   goals reads *"genuinely nothing to do — not a stall"*; (c) counts **all**
   `persona_executions`, so one manual chat run masks a dead trigger loop for
   another two hours; (d) even when all three align, it can raise **once ever**
   (D1). `QueueDrainWatchdog` is not a detector at all — it re-drains a queue
   and reports nothing. **The guards added after the 2-day deadlock are shaped
   for that specific deadlock and do not generalise one leaf sideways.**
2. **"`circuit_breaker_state`: 0 rows. `healing_knowledge`: 0 rows." — confirmed,
   and both are smaller than the finding.** **121 of 241 tables in `personas.db`
   are empty**, and the more diagnostic number is the other one: **57 of 94
   non-empty timestamped tables have a newest row more than 30 days old.** The
   emptiness is not the signal; the *dating* is.
3. **"`dev_tasks` holds 2 rows `status='running'` since 2026-04-09 — 129 days" —
   confirmed exactly**, and one detail sharpens it: both rows' `updated_at` is
   **6 ms** after `created_at`. They did not run and stall; they never advanced
   past insertion. Ownership sits with
   [long-running-job-progress](./long-running-job-progress.md); recorded here as
   D6 with the age.
4. **"`EXECUTIONS_SILENT_DETECTED` … zero listeners in 4,828 frontend files" —
   re-verified independently.** 2 occurrences in `src/`, both in
   `eventRegistry.ts` (`:214` the name, `:991` the type map). 0 `listen`
   registrations. Already owned by
   [terminal-state-and-recovery](./terminal-state-and-recovery.md) D9; not
   re-derived.
5. **"`ci.yml` ran a hung Clippy step for six hours because no job had a
   timeout" — FIXED, on the day this was composed, and the brief's own corpus
   fixed it.** All 5 `ci.yml` jobs now carry `timeout-minutes` (`:25, :101,
   :215, :323, :350`) with the incident written into the comment at `:21-24`.
   **Still open and worth more than the fixed half:** three workflows
   (`ai-conformance`, `audit`, `codeql`) have **0** timeouts, and **no workflow
   in the repo sets a step-level timeout** — so a hung step still burns its
   job's full budget. Anyone re-citing the six-hour Clippy run as a live defect
   should stop; anyone citing it as *closed* is also wrong.
6. **"nothing measures whether a loop ever DID anything" — nearly right, and the
   exception changes the document.** Two things do. `FleetLivenessWatchdog` asks
   the output question (and §0 is what became of it), and
   `system_ops::mark_run`/`mark_outcome` persists the answer for one automation,
   with attempt and outcome as **separate writes** — which is the shape
   `ascent` and `brainiac` independently reinvented (§6 clause 7). The
   prescription in §2 is therefore not invented here; it is **already in this
   repo, at one of 244 tables**, and the path's job is to route people to it.
7. **The convergence label `diverged` survives, but not where I expected.**
   "Measure output, not activity" is **1.5 of 5 — not physics**, and Personas is
   on the *right* side of it, which the brief did not anticipate. What is
   physics is the *defect* (activity-only health records, 3/5) and the
   near-miss (the stall signal already computed and used for something else,
   3/5). And the clause I was most confident would be common — a permanent
   dedup latch — is **unique to Personas**: `INSERT OR IGNORE`/`ON CONFLICT DO
   NOTHING` on an alert key appears **nowhere** in 6,716 sibling files, and
   `brainiac` documents the opposite policy in prose. **The one defect I assumed
   was universal is local, and the one virtue I assumed was local is nearly so.**
8. **Silences, reported as silences.** Clause 5 (*something clears the alarm on
   recovery*) is **0 of 5** — no `resolved_at` on any alert, no recovery
   notification, no alarm-state table anywhere in the family. Clause 8 (*a
   watchdog that is not a peer of what it watches*) is 1 of 5 and the one that
   has a watchdog has the defect. Neither is promoted to doctrine; both are
   labelled open hazards in the head (P8) and in Gap 7.
