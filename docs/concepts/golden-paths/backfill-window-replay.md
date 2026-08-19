# Golden path — Backfill window replay

> Situation node: `backend-runtime` › `scheduling-and-triggers` › `backfill-window-replay` ·
> [situation spine](../situation-spine.md) · recurrence **3** · risk **high** ·
> sides: **client** (contradicted — see [§12.1](#121--sides-client-is-inverted-the-entire-decision-surface-is-server-side)) ·
> convergence: **mixed** (tested — see [§10](#10-convergence)) ·
> dimensions: **ui · function · cost · resilience**
> Composed 2026-08-17 against `master` @ `52b0a6ba8`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` walked for the replay vocabulary
> (`backfill`, `catch_up`, `missed`, `replay`) by two independent matchers. Read in full:
> `src-tauri/core/src/scheduler.rs` (405 lines, the whole file), `src-tauri/src/commands/execution/scheduler.rs`
> (425 lines, the whole file), `src-tauri/src/engine/background.rs:1840-2900`,
> `src-tauri/db/src/repos/resources/triggers.rs:1600-2145`,
> `src-tauri/db/src/repos/communication/events.rs:500-570`. On the client:
> `src/features/schedules/**` (21 files, 4,524 lines — all of it),
> `src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts`,
> `TriggerScheduleConfig.tsx`, `TimezoneSelect.tsx`, `src/api/pipeline/scheduler.ts`.
>
> **Measured by execution, not by reading.** A read-only copy of the
> **2026-08-17 purge backup** — `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`,
> 347,054,080 B — was queried, never the live file. **This is load-bearing: the live database
> holds zero triggers.** On 2026-08-17 the operator authorized a purge that deleted all 351
> triggers, all 78 personas and 2,188 executions. Every row count below is **historical as of
> 2026-08-17** and is **not reproducible against the live database**. A composer that re-measures
> against the live file will find zero of everything and must not read that as a fix.
> `get_due` was replayed verbatim; `bucketByDay` was replayed verbatim at three host offsets.
> The copy was deleted.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL/JS.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five walked. Effective independent cohort for this leaf:
> **4** (§10).
>
> **Settles:** what happens to a fire time that passed while the app was closed — how many times
> it fires, which end of an over-long gap survives, what makes a second press of the button free,
> and how the user learns which of the four possible zeros they are looking at.

---

## 0. The headline

**Three replay paths in this engine anchor the same cadence on three different instants, and
the two that bound their output drop opposite ends of the window without saying so.**

| path | who calls it | anchor the cadence is walked from | what it drops when the bound is hit |
|---|---|---|---|
| live tick catch-up | `background.rs:2670` `compute_missed_backfill_slots` | `last_triggered_at` — the last slot that actually fired | **the OLDEST** (`missed.drain(..(len - extras))`, `:2680`) |
| user "Run backfill" | `commands/execution/scheduler.rs:214` → `core/scheduler.rs:181` `compute_slots_in_range` | **the window's `start`** — a boundary the user typed | **the NEWEST** (`slots.truncate(100)`, `:223`) |
| calendar projection | `useCronPreview.ts:226` `generateIntervalFireTimes` | `next_trigger_at` — the engine's own phase | nothing (`maxResults = 500`) |

For a cron schedule the three converge, because a cron expression is a wall-clock function and any
start instant walks onto the same minutes. **For an interval schedule they do not.** A trigger
firing every 600 s whose engine phase is `…:07:30` is replayed by the user path at
`start + 600 s, start + 1200 s, …` — a phase the engine has never used and will never use again.
The calendar draws the engine's phase; the replay publishes a different one; nothing compares them.

And the truncation disagreement is the sharper half. Press **Run backfill** over a 7-day window on
an hourly cron: 168 slots, cap 100, `capped: true`, and the 100 that survive are **hours 1 through
100 — the oldest**. The 68 the user was most likely reaching for, the most recent ones, are the
ones dropped. The auto path, given the identical 168-slot gap, keeps the newest. Neither path
states which end it keeps; both report the same boolean.

**The second headline is that none of this has ever run.** In the operator's 351 triggers:

| fact | measured | consequence |
|---|---|---|
| triggers with `max_backfill` set | **0 of 351** | `backfill_cap > 1` is false for every row that has ever existed; the ~175-line auto-catch-up branch (`background.rs:2614-2789`) is **unreachable on this install** |
| schedule triggers with a `last_triggered_at` | **2 of 32** | the watermark the replay window is computed from exists for two rows |
| …and those two rows' persona | `enabled = 0` | `get_due`'s `INNER JOIN personas p … AND p.enabled = 1` excludes them, so the two rows carrying the watermark are the two rows the tick never visits |
| rows in `schedule_missed_runs` | **0** | the badge, the `schedule.missed.offline` event, the two IPC commands and the ts-rs binding have never held or moved a row |
| `persona_events` with `source_type = 'trigger'` | **0 of 4,972** | no trigger — live *or* replayed — has ever published an event in this database's recorded history |

The apparatus is not merely unexercised. It is **structurally unreachable in the order it is
written**: `record_and_emit_missed_runs` fires at `background.rs:2857`, *after* `mark_triggered`
succeeds at `:2836`. **You only learn what you missed at the moment you stop missing it.** A
schedule that is off, over budget, on a disabled persona, or whose zone will not parse — every one
of which is a reason misses accumulate — never reaches line 2836, so its misses are never counted.

---

## Principle (stack-free head)

A recurring job's fire time can pass while nothing is running. The system must then answer one
question, and there are exactly three defensible answers: **fire once** (the schedule is a
heartbeat; you only ever needed the latest one), **fire every missed occurrence** (the schedule is
a ledger; each slot is a distinct unit of work), or **skip to the next boundary** (the work is only
meaningful at its own moment and a late run is worse than none).

All three are correct for some job. **Choosing one by accident is correct for none.** So:

1. **Write the answer down where the author of a schedule can read it**, in the same surface where
   they author the schedule — not only in the engine's comments.
2. **Give the same answer for every recurrence kind you offer.** If cron gets catch-up and interval
   does not, that is not a policy, it is an omission wearing a policy's clothes.
3. **Anchor every replay on the schedule's own phase**, never on a boundary the caller supplied.
   The window says *which* slots; the schedule says *where* the slots are. Conflating them makes
   the replay fire at instants the schedule never had.
4. **Make a replay idempotent by construction, not by a prior read.** A `SELECT` of what has
   already been published, followed by an `INSERT` of what has not, is a check with a gap in the
   middle and no constraint behind it.
5. **Decide which end of an over-long gap survives, and say so at the door.** A bound that is hit
   is a fact about the *tail* or the *head*; a boolean carries neither.
6. **Return a receipt that can distinguish the four zeros**: nothing was due, everything was
   already replayed, everything was refused, everything failed. They are four different situations
   and the user's next action differs in each.
7. **A replay is a fan-out of side effects.** If the downstream action is a network write, a
   replayed slot repeats it. Bound the replay by what the *effects* can tolerate, not by what the
   enumerator can produce.

---

## 1. Trigger

You are in this situation when you catch yourself saying or typing any of:

- "the app was closed overnight — should it run the ones it missed?"
- "let me re-run yesterday's slots"
- "how do I catch up after downtime?"
- "why did it fire 40 times when I opened the laptop?"
- "it says *missed 12 while offline* — what do I do with that?"
- **The test:** if you are about to write a loop that walks a recurrence from some instant in the
  past up to `now` and publishes something per step — you are here, whether you call it backfill,
  catch-up, recovery, replay, or "the overdue sweep".

---

## 2. The one way

**Decide the missed-slot policy before you write the enumerator, expose it on the authoring
surface for every recurrence kind you support, walk the cadence from the schedule's own phase
anchor and never from the caller's window boundary, dedupe on a uniqueness constraint rather than
a prior read, and return a receipt whose zero is legible.** Concretely: (a) write the policy as a
value in the schedule's own config — `max_backfill` here — with a default that is stated in the
authoring UI, not inferred from absence; (b) render that control for *every* recurrence mode, or
the mode without it has silently opted into a policy its author never saw; (c) the enumerator takes
the phase anchor as a parameter — for cron the anchor is irrelevant and for interval it is the whole
answer, so the signature must carry it or the two kinds will diverge; (d) bound the replay, and make
the bound's direction explicit at the call site (`keep_newest` / `keep_oldest`), because
`Vec::truncate` and `Vec::drain` silently disagree; (e) put a `UNIQUE` index on
(`source_id`, `slot_fired_at`) and let the insert refuse, instead of reading a `HashSet` of what was
published and hoping nothing lands between the read and the write; (f) return `{ found, enqueued,
skipped_already_done, refused_by_cap, failed, window }` — six numbers, not one plus a boolean — so
"nothing was due" and "all 47 were already done" are different answers; and (g) before you replay
anything, ask what the slot *does*: a slot that recomputes a view is free to repeat, a slot that
POSTs is not, and the same enumerator serving both is the bug.

**When the two are in tension, prefer refusing to replay over replaying twice.** A missed run the
user can re-request is recoverable; a duplicated external side effect is not.

---

## 3. Mandated primitives

| primitive | path | what it gives you |
|---|---|---|
| `compute_slots_in_range(cfg, start, end, seed, max_slots)` | `src-tauri/core/src/scheduler.rs:181` | the only enumerator that takes an explicit window. Caps at `min(max_slots, BACKFILL_HARD_CAP)`, refuses on an unparseable zone, refuses `end <= start`. **Its interval arm anchors on `start` — see §7 D3.** |
| `compute_missed_backfill_slots(cfg, last_fire, now, seed)` | `src-tauri/src/engine/background.rs:2292` | the watermark-driven enumerator. Same zone-refusal policy, and it **pops the most recent slot** (`:2350-2352`) because the live tick fires that one. |
| `resolve_schedule_tz(raw) -> Result<Option<Tz>, ScheduleTzError>` | `src-tauri/core/src/scheduler.rs:41` | the one zone door. `None` → host-local fallback; `Some(invalid)` → **`Err`, and every caller must refuse**. Its docstring says it exists so the live and backfill paths "can never diverge again"; both replay enumerators honour it. |
| `advance_schedule_pointer(pool, id, next, expected_version)` | `src-tauri/db/src/repos/resources/triggers.rs:1814` | a CAS on `trigger_version` that does **not** move `last_triggered_at`. Used as a claim before a replay so the loser retries instead of double-publishing. |
| `backfill_slot_times_for_source(pool, source_id)` | `src-tauri/db/src/repos/communication/events.rs:507` | the set of `fired_at` values already published as backfill slots for one trigger. **Reads the marker out of the payload — see §7 D4.** |
| `crate::limits::BACKFILL_HARD_CAP` / `GLOBAL_BACKFILL_PER_TICK` | `src-tauri/core/src/limits.rs:55,64` | per-trigger-per-tick and tick-wide ceilings. `cap_with_log` clamps and logs. |
| `record_missed_runs` / `list_missed_runs` / `clear_missed_runs` | `src-tauri/db/src/repos/resources/triggers.rs:2012,2040,2069` | the discarded-slot ledger. Accumulating upsert, `first_missed_at` preserved, clear is idempotent and keeps any `status_reason`. |
| `backfillSchedule(triggerId, start, end)` | `src/api/pipeline/scheduler.ts:24` | the one client door. Everything else on the client is presentation. |

**Do NOT build:** a second slot enumerator (there are already two and they disagree); a bespoke
lock (`advance_schedule_pointer` is the claim); a client-side cadence walk for replay
(`generateIntervalFireTimes` exists for *projection* and is anchored differently on purpose).

---

## 4. Steps

1. **Name the policy in config, with the default visible.** `max_backfill: Option<u32>` on
   `TriggerConfig::Schedule` (`core/src/models/trigger.rs:401`). The authoring control is a
   `<select>` at `TriggerScheduleConfig.tsx:243-259` whose first option reads *"Off — fire once when
   overdue (default)"*. **This is the only place in the product where the answer to "what happens to
   a missed slot" is stated to a user.** Keep it that explicit.
2. **Render the control for every recurrence kind.** Today it renders only inside `CronConfig`
   (`TriggerAddForm.tsx:225`, gated `scheduleMode === 'cron'`) while `buildTriggerConfig.ts:63-66`
   writes the key for both modes — so interval schedules are silently pinned to fire-once. Fix the
   render site, not the writer.
3. **Take the claim before you read anything.** `advance_schedule_pointer` with the trigger's
   current `next_trigger_at` and its `trigger_version`. On `Ok(false)`, return "retry" — do not
   fall through. `commands/execution/scheduler.rs:190-209` is the reference, with a 14-line comment
   naming the exact double-dispatch it prevents.
4. **Resolve the zone through `resolve_schedule_tz` and refuse on `Err`** — before enumerating, and
   surface the refusal as a validation error rather than a silent empty set
   (`commands/execution/scheduler.rs:163-174`).
5. **Enumerate from the schedule's phase.** Pass the anchor explicitly. For cron it is inert; for
   interval it is the answer. Then **cap at `CAP + 1`** so `capped` is a measurement and not a
   guess (`:213-224`), and **name the direction** when you truncate.
6. **Clip the window to the past.** `effective_end = min(end, now)` and refuse when the clipped
   window is empty (`:143-149`). A replay that can reach the future is a scheduler with extra steps.
7. **Publish each slot through the same door the live fire uses** — `event_repo::publish` with
   `source_type: "trigger"` — and layer only the markers that distinguish it
   (`backfill_slot: true`, plus `user_backfill: true` for the on-demand path).
8. **Re-check the ceilings inside the loop, not only before it.** The per-persona hourly ceiling
   (`schedule_hourly_cap_exceeded`) and, on the auto path, the monthly budget are re-read per slot;
   hitting either sets `capped = true`, logs a healing issue, and **breaks** rather than continuing
   (`:259-275`, `background.rs:2690-2737`).
9. **And then stop.** The event bus owns dispatch from here. A replayed slot is an ordinary
   `persona_event`; it does not get its own runner, its own retry policy, or its own execution
   table.
10. **Return the receipt, and make the UI read it.** Six numbers (§2f). `useScheduleActions.ts:283-295`
    is the consumer; today it branches on `slotsEnqueued > 0` alone.

---

## 5. Anti-patterns

**Walking the cadence from the window boundary.** `compute_slots_in_range`'s interval arm is
`let mut t = start + interval; while t <= end` (`core/src/scheduler.rs:233-237`). The failure mode
is not "wrong count" — the count is right. It is that every replayed slot lands at an instant the
schedule has never occupied, so the replayed run's `created_at` cannot be matched back to any
nominal slot by anything downstream, including this feature's own
`matchPastSlotsToRuns`.

**Dedupe by prior read.** `already_published` is a `HashSet` fetched once at
`commands/execution/scheduler.rs:235`, before a publish loop with no re-check and no `UNIQUE`
index behind it. The claim at `:190` narrows the race but does not close it: the CAS is a
point-in-time version bump, not a lock held across the loop, so a second request that *reads the
trigger after* the first request's CAS acquires its own claim and computes the identical slot set.
The double-submit guard that actually holds today is a `disabled` prop on a button
(`BackfillModal.tsx:210`).

**A boolean for a bound.** `capped: bool` tells the caller that slots were dropped. It does not
tell them **how many** (the count exists — `slots.len()` before truncation — and is discarded) or
**which end** (a `Vec` method decided). Both replay paths report the same boolean and drop opposite
ends.

**Counting a diagnostic into a local and logging it.** `skipped_duplicate` is declared at
`:229`, incremented at `:247`, and reaches only `tracing::info!` at `:318`. The one pass that knows
whether a zero means "nothing was due" or "all of it was already done" discards the distinction at
the boundary. (Already on record as [`backfill-migration`](./backfill-migration.md) §7 D6 — cited,
not re-claimed.)

**Making the miss-ledger's write depend on a successful fire.** `record_and_emit_missed_runs` runs
after `mark_triggered` returns `Ok(true)`. Every reason a schedule accumulates misses is also a
reason it does not reach that line.

**Documenting a function that does not exist.**
`docs/features/execution/01-entry-points.md:134` says *"on app startup, `recover_overdue_triggers`
runs once"*. That identifier appears **0 times in 963 `.rs` files**. The real mechanism is an
unnamed block in `background.rs::start_loops:772-786` calling `trigger_scheduler_tick_counted`. A
reader searching for the documented symbol finds nothing and concludes the feature is gone.

**Replaying a POST because you can enumerate it.** Nothing in either enumerator asks what the slot
*does*. See §8 Gap 1.

---

## 6. Evidence

**The one site to copy: `src-tauri/src/commands/execution/scheduler.rs:122-332`.** It is the
strongest replay door in the tree and four of its moves are worth lifting verbatim:

| line | move |
|---|---|
| `:143-149` | clip `end` to `now`, then refuse when the clipped window is empty — a replay cannot reach the future, and "you asked for the future only" is an error, not a zero |
| `:190-209` | the claim taken **before** the read, reusing an existing CAS rather than a bespoke lock, with the comment naming which double-dispatch it prevents and why this primitive (it does not move `last_triggered_at`, so the loser's watermark stays correct) |
| `:213-224` | the cap probed at **`CAP + 1`**, so `capped` is measured rather than assumed |
| `:259-275` | a mid-pass ceiling that sets `capped`, opens a healing issue, and breaks — a partial pass the caller can see |

Also exemplary:

- `src-tauri/core/src/scheduler.rs:41-49` — `resolve_schedule_tz`, one error policy for the live and
  both replay paths, with the reason in the docstring.
- `src-tauri/core/src/scheduler.rs:74-90` — `next_interval_at`: catch-up by **one O(1) jump**
  (`behind / interval_secs + 1`) rather than a loop, because the anchor can be days stale. This is
  the correct shape for "skip to the next boundary" and it is the *only* one of the three anchors
  that is right.
- `src-tauri/src/engine/background.rs:2532-2544` — the overlap-skip comment, which reasons
  explicitly about whether a skipped slot should be replayable and picks `mark_triggered`
  (consuming the slot) over `advance_schedule_pointer` (preserving it) **with the reason stated**.
  That is the decision §2 asks for, made in the open.
- `src-tauri/src/commands/execution/scheduler.rs:346-359` + its test at `:392-423` — the
  user-path payload builder delegates to the live builder and layers only two markers, and a test
  pins the delegation field-by-field. (The *auto* path does not — §7 D5.)
- `docs/features/execution/01-entry-points.md:138-165` — the policy, the caps, the markers and the
  three reliability signals, written down accurately for a reader who is not in the code.

---

## 7. Deviations

### D1 (P0) — the catch-up policy is unreachable for interval schedules, and unset everywhere

`buildTriggerConfig.ts:62-66` writes `config.max_backfill` for **both** schedule modes, but the
control that sets `s.scheduleMaxBackfill` is rendered only when `scheduleMode === 'cron'`
(`TriggerAddForm.tsx:225` passes `maxBackfill`/`setMaxBackfill` into `CronConfig`; the interval
branch has no such prop). An interval schedule therefore always carries `max_backfill: None`,
always gets `backfill_cap = 1`, and its author is never shown that a choice existed.

Measured against the backup: **0 of 351 triggers set `max_backfill`** — 0 of the 32 schedule
triggers, and there were 0 interval-mode schedule triggers to begin with (all 32 are cron). So the
defect is **latent for interval and absolute for everyone**: the entire branch at
`background.rs:2614-2789` — the claim, the enumerator, the per-slot budget re-check, the per-slot
active-window check, the hourly ceiling, the lost-fire healing issue, roughly 175 lines — has never
had a row that satisfies its guard.

**Fix:** render the `max_backfill` select in both modes (one line at the interval branch of
`TriggerAddForm.tsx`), and make the Schedules row show the effective policy so absence reads as a
choice. Deferred, not applied — it changes a live authoring surface.

### D2 (P0) — the miss ledger cannot be written by the triggers that miss

`missed_total` is computed at `background.rs:2575-2592` and `record_and_emit_missed_runs` is called
at `:2856` — **after** the `mark_triggered` CAS at `:2836`. Every earlier `continue` in the loop
skips it: polling and event-listener types (`:2439`), daemon yield (`:2448`), outside the active
window (`:2454`), over budget (`:2516`), overlap (`:2545`), hourly cap (`:2803`). And the loop is
only entered for rows `get_due` returns, which requires `status = 'active'`, a non-NULL
`next_trigger_at` in the past, **and `personas.enabled = 1`**.

Replayed against the backup at 2026-08-17T17:13Z, `get_due` returns **0 rows** — the same zero
[`scheduled-trigger-firing`](./scheduled-trigger-firing.md) reports for a different reason at a
different date. The two rows in the whole database with a `last_triggered_at`
(`50fba5fd…`, `96ce3923…`, both last fired 2026-05-28, both armed for 2026-05-29) belong to persona
`QA Guardian (2)`, which has `enabled = 0`. **`schedule_missed_runs` holds 0 rows**, and
`schedule.missed.offline` appears **0 times** in 4,972 `persona_events`.

The consequence is not "the badge is empty". It is that the badge is **structurally incapable of
reporting the case it was built for**: an app that was closed produces missed slots, and the
mechanism that records them requires a successful fire first.

**Fix:** compute and record misses on the skip paths too — every `continue` that advances the
pointer without firing is a discarded slot by definition. Deferred (it writes rows).

### D3 (P1) — the user replay anchors interval cadence on the window boundary

`core/src/scheduler.rs:231-237`:

```rust
let interval = Duration::seconds(*secs as i64);
let mut t = start + interval;
while t <= end && slots.len() < cap {
    slots.push(t);
    t += interval;
}
```

`start` is the user's window start. The engine's phase lives in `next_trigger_at` and is advanced
by `next_interval_at(now, anchor = next_trigger_at, secs)` (`:74-90`); the calendar projects it with
`generateIntervalFireTimes(secs, agent.next_trigger_at, …)` (`useCronPreview.ts:226-250`), whose
docstring says in as many words *"we mirror that: walk forward from the anchor by whole intervals"*.
The replay is the one path that does not.

**Latent today** — 0 interval-mode schedule triggers existed in the backup — and it will fire the
moment one does. **Fix:** add `phase_anchor: Option<DateTime<Utc>>` to `compute_slots_in_range` and
walk from `max(anchor + k·interval)` that is `> start`. A signature change; the compiler visits both
call sites.

### D4 (P1) — the idempotence marker is written by the branch that may not run

`commands/execution/scheduler.rs:277-279`:

```rust
let payload = cfg
    .payload()
    .or_else(|| Some(synthesize_user_backfill_payload(&trigger, &cfg, &slot_iso)));
```

`backfill_slot_times_for_source` recovers the dedup key by decrypting each of the trigger's events
and reading `backfill_slot` + `fired_at` out of the payload object
(`events.rs:539-548`). Those two keys exist **only** in the synthesized payload. A trigger whose
config carries an explicit `payload` takes the `cfg.payload()` branch, publishes a slot carrying
neither marker, and is therefore invisible to `already_published` — so **every press of Run
backfill republishes every slot in the window, without limit**.

Measured: **0 of 351 triggers set `config.payload`** (the key does not appear in any config in the
backup; the observed vocabulary is `cadence`, `cron`, `listen_event_type`, `source_filter`,
`_auto_for_trigger`, `timezone`, `event_type`, `filter`, `condition`, `payload_forward`,
`source_persona_id`). So the hole is **latent, not live** — and it is exactly the kind of hole that
opens the first time somebody uses a documented feature. `TriggerConfig::Schedule.payload` is a
supported field.

This also **overturns a published claim** — see [§12.3](#123--correction-owed-to-backfill-migration-the-dedup-is-not-unconditional).

**Fix:** carry the slot instant in a column, not in the payload — a `UNIQUE(source_id, slot_at)`
partial index on `persona_events` — so dedup does not depend on which payload branch ran, and does
not cost a decrypt per historical event per click. Deferred (schema).

### D5 (P1) — the auto path's payload builder is a hand-copied twin that has already drifted

`commands/execution/scheduler.rs:336-345` states, as the reason its own builder is safe:

> Delegates the field synthesis to the SAME `engine::background::synthesize_trigger_fired_payload`
> the live scheduler's own backfill path builds on (`engine::background::synthesize_backfill_payload`
> **layers just `backfill_slot: true` on top of that same call**).

It does not. `synthesize_backfill_payload` (`background.rs:2358-2403`) rebuilds the map field by
field, and **the copy has already lost a field**: `synthesize_trigger_fired_payload` (`:1856-1866`)
matches `TriggerConfig::Schedule` *and* `TriggerConfig::Polling { interval_seconds }`; the twin
(`:2364-2371`) matches only `Schedule`. The user path's test (`:392-423`) pins the user builder to
the live builder — and nothing pins the auto builder to anything.

The lost field is currently unreachable (the auto path is entered only for
`trigger_type == "schedule"`), which is why the drift has cost nothing yet. **A comment asserting a
delegation that does not exist is worse than no comment**: the next person to add a field to the
live payload will read it and skip the twin.

**Fix — the comment half is APPLIED** (`commands/execution/scheduler.rs:334-357`): the false
delegation claim is replaced with what is actually true of each builder, plus the lost `Polling`
arm and the instruction for the next person to add a field. A comment correction is inside the
runbook's apply-freely line. Making `synthesize_backfill_payload` delegate for real is three lines
and is left as the follow-up, because it changes a live payload.

### D6 (P2) — the two replay paths truncate opposite ends, and both report the same boolean

- user: `slots.truncate(BACKFILL_MAX_SLOTS_PER_REQUEST)` (`:223`) on an ascending vector — **keeps
  the oldest 100**.
- auto: `missed.drain(..(missed.len() - extras_wanted))` (`:2680`) on an ascending vector — **keeps
  the newest `cap - 1`**, and the comment says so (*"Drop the OLDEST when over"*).

Neither surfaces the direction. `BackfillResult.capped` is `true` in both cases and the UI renders
one suffix (`toast_backfill_capped_suffix`) and one asterisk (`ScheduleRow.tsx:186`).

For a user who opened the app after a week away and pressed Run backfill on an hourly job, the 100
slots that run are **the week-old ones**, and the 68 nearest to now are the ones dropped. That is
the opposite of what "catch up" means to the person pressing the button.

**Fix:** make the direction a parameter of the bound, and put the dropped count and the surviving
window in the receipt.

### D7 (P2) — the receipt cannot distinguish "nothing was due" from "all of it was already done"

`BackfillResult` (`:94-107`) carries `slots_enqueued`, `capped`, `slot_times`, `failures`. It does
not carry the **population** (`slots.len()` before truncation, known at `:221`) or the **refused**
count (`skipped_duplicate`, known at `:247`). `useScheduleActions.ts:290-295` branches on
`slotsEnqueued > 0` and otherwise shows `toast_backfill_none` — one message for two situations with
opposite next actions.

The `skipped_duplicate` half is already on record as
[`backfill-migration`](./backfill-migration.md) §7 D6 (`scheduler.rs:229,247,318` vs
`useScheduleActions.ts:292`) — cited here for completeness, **not claimed**. The *population* half
is additional: even with `skipped_duplicate` returned, a caller still cannot tell a window that
contained no slots from one whose slots all failed the active-window or ceiling checks.

### D8 (P2) — polling triggers are scheduled, never replayed, and never counted as missing

`TriggerConfig::Polling { interval_seconds }` is armed by `compute_next_from_config_anchored`
(`core/src/scheduler.rs:145-148`) exactly like a `Schedule` interval. But every replay surface
matches on `TriggerConfig::Schedule` only: `compute_missed_backfill_slots` (`:2300-2345`),
`compute_slots_in_range` (`:193-240`), `missed_total` (`:2575`, guarded
`trigger_type == "schedule"`), and `backfill_schedule` itself refuses at `:152-156`. So two triggers
with an identical cadence get opposite answers to "what happened to the slots you missed", decided
by a string in a different column.

Measured: **7 polling triggers** in the backup, **0** with `interval_seconds` — all seven carry
`{"cron": …, "timezone": "local"}`, keys `TriggerConfig::Polling` does not declare. So they are
unarmed for a *third* reason and the gap is, again, latent.

### D9 (P3) — `LoadingSpinner` on the action control, which renders `null`

`BackfillModal.tsx:215` renders `<LoadingSpinner size="sm" />` inside the Run button's busy branch.
`feedback/LoadingSpinner.tsx:12-21` returns `null` unless a `label` is passed, and no label is
passed. Per the repo's own spinner boundary (`CLAUDE.md`, and
[`inline-busy-state`](./inline-busy-state.md)), an action the user just pressed **requires** a real
spinner; the destination is `buttons/AsyncButton`, whose `onClick` returns a promise and which owns
the busy state, the `disabled` and the `aria-busy` without a `useState`. Today the button swaps its
`History` icon for nothing and changes its label.

The surrounding state is externally owned (`isRunning` comes from `useScheduleActions`), so
`buttons/Button loading={isRunning}` is the minimal correct move.

### D10 (P3) — the modal's default window ignores the gap the app already measured

`BackfillModal.tsx:43` defaults the window to `now - 24h`. `schedule_missed_runs` carries
`first_missed_at` and `last_missed_at` per trigger and the row's one-click path already uses them
(`ScheduleRow.tsx:111-114`, `missed.firstMissedAt ?? missed.lastMissedAt ?? now - 24h`) — the modal
does not. The two doors to the same command disagree about what "the gap" is.

`clear_schedule_missed_runs` is also the same call for "I backfilled it" and "I don't care"
(`ScheduleRow.tsx:116`, in a `finally`, so it clears even when the backfill throws). Nothing checks
that the replayed window covered the recorded one.

---

## 8. Gaps

**Gap 1 — nothing in the replay path knows what a slot *does*, so idempotence is not expressible.**
Both enumerators publish a `persona_event`; dispatch, tool use and every external write happen
downstream, behind the bus. A replayed slot that recomputes a summary and a replayed slot that
opens a GitHub PR are the same object to this code. There is no capability, no `replay_safe` flag,
and no dry-run mode on the replay door. The only bounds are quantitative — per-request 100,
per-tick-per-trigger 100, per-tick global, per-persona hourly, per-persona monthly budget — and
they bound *volume*, not *repeatability*. **This is the leaf's largest genuine limitation and it is
upstream of D4 and D6:** if the effect were declared, "which end do we keep" would have an answer
that is not a preference.

**Gap 2 — the census cannot ratchet any of this leaf's headline findings.** Three of them are
absences (a config key nobody sets; a ledger with no rows; a `UNIQUE` index that does not exist)
and the runner cannot assert an absence. Two are *disagreements between two sites* (the anchors,
the truncation ends) — a property of a pair, which no per-site matcher sees. See §9.

**Gap 3 — `capped` is not comparable across the two paths.** On the user path it means "your window
had more than 100 slots" **or** "the hourly ceiling stopped us mid-loop" (`:273`). On the auto path
the tick-wide budget and the per-slot budget just `break` without setting anything. So the same
field name means different things and the auto path's partiality is invisible outside the log.

**Gap 4 — replay is per trigger, and downtime is per app.** Both doors take one `trigger_id`. After
a week offline with 32 schedules, catching up is 32 presses of a modal, each with its own window,
each independently capped at 100. Nothing offers "replay the gap for everything", which is the
actual situation.

**Gap 5 — the dedup read costs a decrypt of the trigger's entire event history.**
`backfill_slot_times_for_source` selects every `persona_events` row for the source and decrypts each
payload (`events.rs:516-538`). All 4,972 payloads in the backup are encrypted
(`payload_iv` non-empty on 4,972 of 4,972; 0 plaintext). The cost grows with history and is paid on
every press. Column-based dedup (Gap-1-adjacent, D4's fix) removes it.

---

## 9. The missing gate

### Declined — and the decline is the finding

**No census rule is proposed for this leaf.** Four candidates were built and measured; each failed
for a stated reason, and the failures are more informative than a weak rule would have been.

| candidate | signal | measured | verdict |
|---|---|---|---|
| **receipt without a population** | a fill-named `fn` whose return type cannot carry the four zeros | **already shipped** as `unfinishable-backfill-receipt` (`backfill-migration.md`, baseline 5 files / 5 matches, roots `src-tauri`, floor 900). Its own description **names `BackfillResult{slots_enqueued,capped,failures,slot_times}` at `scheduler.rs:94` as a COMPLIANT shape.** | **decline — 100% site overlap on the one site that matters.** Correct action is to fix the classification, not add a rule (§12.4). And the condition is not expressible in that rule's shape anyway: a struct's *field set* is invisible at the return type, so no return-type regex can separate a receipt that carries the population from one that does not. |
| **replay anchored on a window boundary** | `let mut t = start + interval` / `let mut from = start;` before a `next_fire_time` walk | 4 matches in 2 files; **2 are correct** (`compute_missed_backfill_slots` anchors on `last_fire`, which *is* the phase) | **decline — 2/4 precision.** A gate that fires on correct content is worse than no gate. |
| **undirected truncation of an ordered bound** | `.truncate(` / `.drain(..` applied to a slot vector after a cap probe | **2 matches in 2 files** in 963 `.rs` files | **decline — the defect is a *disagreement between the two*, not a property of either.** Each site in isolation is defensible; only the pair is wrong, and a per-site matcher cannot see a pair. |
| **marker-dependent dedup** | `.or_else(|| Some(synthesize_` feeding a set membership test | **2 matches**, both in the two backfill payload builders | **decline — population 2, and both are this leaf's own code.** A ratchet over a rule's own subject is a comment with a runner attached. |

### What outranks a gate here: three type edits, each compiler-forced

Per the contract's *prefer a type over a gate*, and holding each against the doctrine's seven
qualifications:

1. **`BackfillResult` gains `slots_in_window: u32` and `skipped_duplicate: u32`.** One struct, one
   construction site (`:323-331`), one `export_bindings` regen, one UI branch. Q3 passes — the type
   *is* constructed, exactly once. This makes the four zeros representable. (The
   `skipped_duplicate` half is `backfill-migration` D6's owed fix; the `slots_in_window` half is
   this leaf's.)
2. **`compute_slots_in_range` gains `phase_anchor: Option<DateTime<Utc>>`.** Q5 (withhold beats
   require) argues for the stronger form — *do not hand the enumerator a bare `start`* — but Q6
   applies: the window boundary is the answer to "which slots", not the dangerous freedom. The
   dangerous freedom is using it as the *phase*. So the anchor must be a distinct parameter the
   compiler demands at both call sites, not a widened `start`.
3. **A `UNIQUE` partial index on `(source_id, slot_at)` in `persona_events`, with `slot_at` as a
   real column.** This is the only edit that makes replay idempotent by construction rather than by
   a read. It defeats D4 permanently and deletes Gap 5. It is *not* a type in the Rust sense — it is
   the storage-layer equivalent, and per the doctrine's "no type reaches inside a serialized blob",
   it is the **only** layer that can reach a key currently living inside an encrypted JSON payload.

None of the three is applied here: (1) and (2) change an IPC contract, (3) changes the schema. All
three are recorded in [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md)
(**#58**, **#59**, **#60**).

### What a gate could NOT have caught, stated so the next repo does not try

The three headline findings — the unreachable policy branch, the empty miss ledger, the ordering
that makes it unwritable — are all **absences measured against live data**, and the census "cannot
assert an absence" by construction. The instrument that found them was replaying `get_due` and
counting config keys against a database copy. **For this leaf, the durable verification asset is a
fixture database and a replay harness, not a matcher.** If an adopting repo wants one gate here,
make it a test that arms a schedule, advances a fake clock past N slots, and asserts the published
count equals the declared policy — the only instrument that can tell fire-once from fire-N from
skip.

---

## 10. Convergence

**Cohort established for this leaf: 4 independent of 5 present.** `brainiac` was walked and its
apparent hits are all inside `console/.next-build/**` — compiled Next.js bundles, not source; with
those excluded it contributes nothing to this leaf. `personas-cloud` is a **declared port** of this
engine and is disqualified as corroboration — but, per the doctrine, a port is the strongest
*negative* evidence available, and this one is decisive.

**The spine label `convergence: mixed` — tested, and it holds, for a reason worth naming.**

**Clause 1: "replay missed occurrences after downtime" — silence, 4 of 4.** The catch-up vocabulary
(`backfill|catch_up|replay_missed|missed_runs`) appears in `personas-web` in exactly 1 file (a SQL
setup script, unrelated), `vibeman` 7 (goal lifecycle, unrelated), `ascent` 3 (GitHub list paging
and a playbook migration, unrelated), `personas-cloud` **0**. Meanwhile `A2 cron/schedule engine`
vocabulary is present in `ascent` (36 files, including `src/app/api/cron/digest` and
`api/cron/purge`) and `personas-web` (41). **So three siblings run scheduled work and none of them
has a concept of a slot that was missed.** Per the doctrine, a silence stays strong regardless of
shared authorship: nobody solving this four times is evidence the problem is hard or unnoticed —
and here it is *unnoticed*, because the hosting model (Vercel cron, a server that is always up)
makes downtime somebody else's problem. **Personas has this leaf because it is a desktop app that
gets closed.** That is a genuine "ahead of the fleet", stated as self-comparison.

**Clause 2: "anchor the cadence on the schedule's own phase" — inverted, and the port proves it.**
`personas-cloud/packages/orchestrator/src/triggerScheduler.ts:86` declares itself *"Ported from
desktop engine/background.rs::trigger_scheduler_tick()"*. Compared with its original, the port
dropped:

- the interval anchor — `:174` is `new Date(now.getTime() + intervalMs)`, i.e. **`now + interval`**,
  precisely the drift the desktop `next_interval_at` (`core/src/scheduler.rs:66-71`) exists to
  eliminate and documents in its own comment;
- the timezone entirely — `computeNextCron(config.cron, now)` (`:165`) takes no zone, so
  `resolve_schedule_tz`'s whole refuse-or-fall-back policy has no counterpart;
- the `trigger_version` CAS — `db.updateTriggerTimings` (`:214`) is unconditional;
- backfill, `max_backfill`, the missed-runs ledger — absent.

This is the **second recorded instance** of the doctrine's flagship oracle result (*"the port
dropped the compare-and-set"*), on the same file pair, for three more mechanisms. The general form
is now well evidenced: **the parts of a scheduler that make catch-up correct read like
bookkeeping, and do not survive a careful re-implementation by the same author.** That is cost and
failure evidence, which shared authorship does not explain away — and it is the corpus's best
argument for moving each of them into a type (§9).

**Clause 3: "make replay idempotent" — the fleet has the mechanism and does not point it at this
problem.** `ON CONFLICT` / upsert / dedupe vocabulary is dense everywhere (`ascent` 90 files,
`vibeman` 83, `personas-cloud` 5 of 48, `personas-web` 12) — including `personas-cloud`'s own
`db.ts` and `eventProcessor.ts`. So the fleet knows how to make a write idempotent; nobody applies
it to a replayed schedule slot, because nobody replays one. This is the
[`entity-picker`](./entity-picker.md) shape — *a solved problem that did not cross a component
boundary* — with the boundary here being between "event ingestion", where the constraint exists, and
"schedule replay", where it does not. The prescription that follows is **transfer, not invention**:
§9's fix #3 is a `UNIQUE` index, which this repo already uses elsewhere.

So: one silence, one inversion, one transfer — **`mixed` is the right label**, and it is the second
spine convergence label the corpus has upheld.

---

## 12. Corrections

### 12.1 — `sides: client` is inverted; the entire decision surface is server-side

The spine marks this leaf `sides: "client"` with `twoSided: true`. Every finding in §0, every one of
D1–D8, the exemplar, all three type fixes and the whole of §10 are **server-side Rust**. The client
contributes a modal with two `datetime-local` inputs, three quick-range buttons, and a toast — and
its two genuine defects (D9, D10) are presentation, not semantics. The one *authoring* control that
decides the policy (D1) does live on the client, which is presumably where the label came from; but
that control's defect is that it is not rendered, not that the client owns the answer.

This is the **eighth** `sides: "client"` contradiction against two upholdings. Per the doctrine's
ledger the failure is specific to this value and this is another instance of the same shape: had the
brief been scoped by the label, the sweep would have read 21 client files and missed the three
anchors, the two truncation directions, the empty ledger and the ordering bug. Following the
doctrine's refinement — *say whether it is incomplete or inverted* — this one is **inverted**:
`"server"` with a small client annex, not `"both"`.

### 12.2 — corrections to the brief

- **"find the surface under `src/features/triggers/**`"** — the schedule surfaces are at
  **`src/features/schedules/`** (21 files, 4,524 lines: `ScheduleCalendar`, `WeekView`, `MonthView`,
  `ScheduleTimeline`, `ScheduleRow`, `ScheduleRowHistoryPanel`, `BackfillModal`, `FrequencyEditor`,
  and the `libs/` behind them). `src/features/triggers/` owns trigger *authoring*
  (`TriggerScheduleConfig`, `TimezoneSelect`, `buildTriggerConfig`), which is where D1 lives. Both
  leaves in this batch needed both trees.
- **"whether it is written down anywhere"** — **it is, and accurately.**
  `docs/features/execution/01-entry-points.md:138-165` documents the automatic backfill (the
  `max_backfill > 1` guard, the `BACKFILL_HARD_CAP = 100`, the `backfill_slot: true` marker, the
  implementing functions), the user-initiated backfill (the arbitrary window, the
  `BACKFILL_MAX_SLOTS_PER_REQUEST = 100`, the `capped` flag, both markers), and all three
  reliability signals. The policy is also stated *to the user* at
  `TriggerScheduleConfig.tsx:255` — *"Off — fire once when overdue (default)"*. The brief's
  hypothesis that the answer might be undocumented is refuted. **What is undocumented is that the
  answer differs by recurrence kind** (D1, D8).
- **"is the same answer given for cron, interval and one-shot?"** — **no**, and there is no
  one-shot: `TriggerConfig::Schedule` offers `cron` and `interval_seconds` only, and
  `compute_next_from_config_anchored`'s `_ => None` arm covers manual, webhook, chain and unknown.
  Cron gets an authorable catch-up policy; interval gets the same engine support with no control
  rendered (D1); polling gets an interval schedule with no replay path at all (D8).
- **"`next_trigger_at` is a stored scalar that shadows a computation — find who recomputes it, and
  what happens across a DST boundary and a non-`local` IANA zone."** Recomputation happens at
  exactly four kinds of site, all in the tick: `mark_triggered` (fired), and
  `advance_schedule_pointer` on three skip paths (active window `:2457`, over budget `:2518`,
  hourly cap `:2793`) — plus `triggers::create`/`update`. **DST is handled correctly and by
  construction**, and this is worth stating because it is the one place this engine is
  unambiguously right: cron re-arms through `cron::next_fire_time_in_tz(&schedule, now, tz)`, which
  resolves wall-clock in the named zone every time, so a spring-forward gap simply has no matching
  minute and a fall-back repeat resolves once; interval re-arms through `next_interval_at`, which is
  pure `chrono::Duration` arithmetic on UTC instants and is DST-immune by not knowing about it. The
  stored scalar cannot drift from the computation because **it is never read as an input to the
  cron computation** — only as the *anchor* for interval, which is exactly where it should be. The
  `"local"` half of the question is `scheduled-trigger-firing`'s territory and is confirmed below.
- **`timezone: "local"` — 16 rows, and the brief's neighbours are right about the count.** My first
  implementation reported **9** because it filtered to `trigger_type = 'schedule'`; a second,
  type-blind implementation over the raw `config` text reported **16**. The disagreement is the
  finding: the 16 are **9 schedule + 7 polling**, and the seven polling rows are unaffected by the
  zone (their variant declares no `timezone` field, so `resolve_schedule_tz` is never called for
  them — they are dead for the unrelated reason in D8). So
  [`scheduled-trigger-firing`](./scheduled-trigger-firing.md) and
  [`trigger-wiring-surface`](./trigger-wiring-surface.md) are **correct on the count of rows
  carrying the sentinel** and slightly generous on the count of rows *killed* by it: **9**, not 16.
  No correction is owed to either document's conclusion — both are about the sentinel's existence,
  which stands.

### 12.3 — correction owed to `backfill-migration`: the dedup is not unconditional

[`backfill-migration.md:145`](./backfill-migration.md) records, in its re-run-safety table:

> `backfill_schedule` | **free** — republishes nothing | `backfill_slot_times_for_source` is read
> from the destination; duplicates counted into `skipped_duplicate`

**The dedup is conditional on which payload branch ran.** `commands/execution/scheduler.rs:277-279`
takes `cfg.payload()` when the trigger's config supplies one, and that payload carries neither
`backfill_slot` nor `fired_at` — the two keys `backfill_slot_times_for_source` reads
(`events.rs:542-548`). For such a trigger the re-run is **not free**: every press republishes every
slot in the window. Latent today (**0 of 351 triggers set `config.payload`**), live the moment one
does. The same conditionality applies to the auto path at `background.rs:2740-2742`.

Also owed, to the same document's §6 (`:329`) and its evidence table (`:483`), which call
`backfill_schedule` *"the reference user-initiated backfill"* and its cap probe *"four lines that
turn a guess into a measurement"*: the probe measures **whether** the bound was hit and is silent on
**which end survives**, and this repo's two replay paths choose opposite ends (§7 D6). Both
statements remain true as far as they go; neither is complete.

### 12.4 — correction owed to `unfinishable-backfill-receipt`'s classification

The rule's own description lists, among the compliant shapes in its anchor:

> a struct (`BackfillResult{slots_enqueued,capped,failures,slot_times}` `scheduler.rs:94`; …)

`BackfillResult` **is** better than a bare numerator, which is what that rule gates. But measured
against its own golden path's §2 — *"a receipt that carries the population, the part handled, the
part refused, and whether the bound was hit"* — it carries the part handled and whether the bound
was hit, and **omits the population and the part refused**. The refused count is computed at `:247`
and discarded into `tracing::info!` at `:318` — which is the *exact* defect the rule's description
attributes to 4 of its 5 violating matches (*"COMPUTE the missing terms inside the loop and discard
them into a `tracing::` macro before returning"*). **The rule's chosen exemplar of the cure commits
the disease it names**, one field short of it. That document already records the `skipped_duplicate`
half as its own §7 D6, so the two halves of that document disagree with each other; the correction
owed is to the rule *description*, so a future composer reading the registry does not inherit
`BackfillResult` as a model to copy.

### 12.5 — correction to `docs/features/execution/01-entry-points.md`

`:134-137` — *"on app startup, `recover_overdue_triggers` runs once and fires all triggers with past
`next_trigger_at`"*. **`recover_overdue_triggers` occurs 0 times in 963 `.rs` files** (and 0 times
anywhere outside that doc line). The startup sweep is an unnamed block at
`src-tauri/src/engine/background.rs:772-786` calling `trigger_scheduler_tick_counted(&scheduler,
&pool)`, whose result is logged and emitted as `OVERDUE_TRIGGERS_FIRED`. The second half of the
sentence is also imprecise: the sweep fires **one slot per overdue trigger** (plus `max_backfill - 1`
extras where configured), not "all" the slots each trigger missed. Applied — a documentation
correction, which the runbook permits.

### 12.6 — correction to this document's own first pass

My first count of `max_backfill` adoption read the `config` column with `JSON.parse` and reported
**0 of 32 schedule triggers**. A second, type-blind pass over raw text reported **0 of 351**, which
is the number that matters: it establishes that the branch is unreachable for *every* trigger kind,
not merely for the ones the first pass looked at. Same failure shape as the `"local"` count above —
**both of my scoping errors were the same error, made twice, in the same direction: filtering to the
type I expected the answer to live in.** The doctrine's rule that two implementations must differ
*structurally* is what caught it; two JSON-parsing passes would have agreed.
