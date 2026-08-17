# Golden path — Scheduled trigger firing

> Situation node: `backend-runtime/scheduling-and-triggers/scheduled-trigger-firing` ·
> [situation spine](../situation-spine.md) · recurrence 26 · risk **HIGH** ·
> sides: **server** · dimensions: **function · resilience · cost · code-quality · security**
> Composed 2026-08-15 against `master` @ `f2e002f7b`.
>
> **Sweep size.** 963 `.rs` files (the full `src-tauri` tree, walked by the census
> engine and by an independent brace-matched scanner that agreed on the file
> count). Every load-bearing number below was taken **twice, by two independent
> implementations**, and is reported only where the two agreed — the one place
> they disagreed is itself a finding and is called out in §9.
>
> **Measured by execution, not by reading.** Three things were run:
>
> 1. The operator's live `personas.db` (347 MB) was **copied** and opened
>    read-only. `get_due`'s SQL was replayed **verbatim** against the real rows.
>    Counts were then taken a second time through a different SQLite driver
>    (`node:sqlite` vs `better-sqlite3`); every figure matched.
> 2. `cron.rs`'s decision logic — `parse_cron_seeded`, `next_fire_time_in_zone`,
>    `day_matches`, `gap_end_utc` — plus `scheduler.rs`'s `resolve_schedule_tz`,
>    `next_interval_at`, and `background.rs`'s `compute_missed_backfill_slots`
>    were **transcribed into JavaScript and gated against `cron.rs`'s own
>    `#[cfg(test)]` assertions**: all 24 (including both DST cases, the Tokyo
>    day-boundary case and the five parse rejections) reproduce exactly. Only
>    then was the replay pointed at the live rows and at downtime scenarios.
> 3. The census rule in §9 was validated standalone, then re-extracted from this
>    finished document and re-run. Numbers match.
>
> **`cargo` was not run** (PreToolUse guard — the operator's app is running).
> Rust was read and reasoned about; every runtime claim comes from the replay or
> from the database.
>
> ---
>
> ## The headline, up front: this pipeline has not fired in 79 days, and nothing says so
>
> `get_due` (`db/src/repos/resources/triggers.rs:1581`), replayed verbatim at
> 2026-08-15T20:00Z against the live database, **returns zero rows**. The
> subscription that calls it has been ticking every 5 seconds this whole time
> (`engine/subscription.rs:389`).
>
> | measured on the live database | value |
> | --- | --- |
> | time-based triggers (`schedule` + `polling`) | **39** |
> | …with `next_trigger_at IS NULL` — invisible to `get_due` forever | **37** |
> | …that have ever fired (`last_triggered_at IS NOT NULL`) | **2** |
> | rows `get_due` returns today | **0** |
> | `persona_events` rows with `source_type='trigger'` | **0** of 4,972 |
> | `persona_events` rows with `source_type='scheduler'` | **0** |
> | `persona_executions` rows with `trigger_id IS NOT NULL` | **0** of 2,188 |
> | `schedule_missed_runs` rows | **0** |
> | `pending_trigger_fires` rows | **0** |
> | `persona_healing_issues` with `category LIKE 'schedule%'` | **0** |
> | most recent fire of any scheduled trigger | **2026-05-28** (79 days ago) |
>
> The zeroes are not a retention artifact. `events::cleanup`
> (`db/src/repos/communication/events.rs:595`) deletes only
> `('completed','skipped','failed','discarded')`; all 4,941 surviving events are
> `delivered`, which that list omits, and they reach back to 2026-06-03. **A
> trigger fire any time in the last 73 days would still be in the table.**
>
> So every mechanism this document describes downstream of "a trigger became
> due" — backfill, missed-run accounting, overlap skip, the approval hold, the
> hourly cap, the lost-fire healing issue — has **never executed once in
> production**. They are correct-looking code with an empirical run count of
> zero. Treat §6's "exemplary call site" accordingly: it is exemplary *by
> construction*, not by service record.
>
> ### Why 37 of 39 are dead — two causes, both silent
>
> Replaying `compute_next_from_config_anchored` over every live row classifies
> them exactly:
>
> | replay verdict | n |
> | --- | --- |
> | `DEAD (invalid_timezone:local)` — the config names a zone that does not exist | **9** schedule |
> | `DEAD (polling_without_interval_seconds)` — a `cron` on a `polling` trigger, which `TriggerConfig::Polling` has no field for | **7** |
> | armed and correct | **2** (both gated off by `personas.enabled = 0`) |
> | `next_trigger_at` is NULL but the config is fine — **nobody ever computed it** | **21** |
>
> **Cause 1 — a sentinel that is not a zone.** 16 live triggers carry
> `"timezone":"local"`. `resolve_schedule_tz` (`core/src/scheduler.rs:41`) does
> `s.parse::<Tz>()`, which is `TIMEZONES.get(s)` in chrono-tz 0.10.4
> (`prebuilt/timezones.rs:1948`) — an exact IANA-name lookup. `"local"` appears
> **zero** times in that table. The parse fails, `compute_next_from_config`
> logs a `warn!` and returns `None`, and `next_trigger_at` stays NULL forever.
> **All 16 have `last_triggered_at IS NULL`. Not one has ever fired.**
>
> The writer is `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx`
> at **:278, :292, :301 and :331** — all four branches of the template-adoption
> trigger builder emit `timezone: "local"`. The app's own zone picker
> (`src/features/triggers/sub_triggers/TimezoneSelect.tsx:69`) gets this right:
> "system local" is `value=""`, i.e. absent, which `resolve_schedule_tz` maps to
> `Ok(None)` and the engine handles. The adoption path invented a *word* for the
> empty case, and the word is a legal `String` in a slot typed `Option<String>`.
>
> **Cause 2 — creation paths that never arm.** Of **10 production
> `INSERT INTO persona_triggers` sites** (23 occurrences total; 10 in
> `#[cfg(test)]`, 3 in migrations, excluded by brace-matched range), only **3**
> name `next_trigger_at` in their column list. One more
> (`commands/design/build_sessions.rs:2213`) arms in a separate best-effort pass
> *after* the transaction. **Six do not arm at all**, and two of those six can
> mint a `schedule` or `polling` row: the import path
> (`commands/core/data_portability.rs:6126`, whose failures land in
> `result.warnings`) and the n8n confirmation path
> (`commands/design/n8n_transform/confirmation.rs:169`, whose `valid_types`
> explicitly includes `"schedule"` and `"polling"`).
>
> ### The CONVERGED label survives on one clause and inverts on two
>
> The spine marks this leaf CONVERGED. Tested against `personas-web`, `brainiac`,
> `personas-cloud`, `vibeman` and `ascent` (7,783 files), the verdict splits —
> full result in §6:
>
> - **Claim-before-work, with the affected-row count as the lock: PHYSICS.**
>   `ascent` (Prisma/TS) and `brainiac` (sqlx/Rust) reinvented it identically,
>   including the lease and the stale-`running` reaper. Personas'
>   `mark_triggered` CAS is the same idea. **Confirmed.**
> - **Catch-up: INVERTED.** All three sibling schedulers coalesce N missed slots
>   into exactly one fire, computing the next time from `now`. Personas is the
>   *only* one of the four that can fire N times (`max_backfill`). The
>   convergent answer is the one this repo does not take by default.
> - **Timezone: NO TRACE.** **Zero IANA zone names across all five repos.** The
>   two mature schedulers are UTC-only by construction. Personas' zone-aware,
>   DST-gap-and-fold-correct cron evaluator is **unique** — a house convention,
>   and by the oracle's own rule it must be labelled one even though it is
>   plainly better than the siblings' answer. **`"local"` as a zone value has
>   zero corroboration in 7,783 files.**
> - **Watchdog: 1 of 5.** Only `brainiac` detects "the loop is alive and nothing
>   is moving". Not physics — and Personas is on the wrong side of it, which is
>   why the 79-day silence above went unreported.
>
> ### Sibling boundaries, settled in prose
>
> [**background-loop**](./background-loop.md) owns *the loop* — `ReactiveSubscription`,
> the generation gate, the panic boundary, the un-raced wait. **This path owns
> what the loop is looking for and what it does when it finds one.**
>
> [**polling-loop**](./polling-loop.md) owns the *content-diffing* poller.
> `polling` triggers live in the same table and are skipped by this tick at
> `background.rs:2439`. **This path owns the row; that path owns the HTTP GET.**
>
> [**post-write-side-effects**](./post-write-side-effects.md) owns what happens
> after a row lands. **This path owns the one ordering decision that path cannot
> make for you: the claim is written BEFORE the effect, deliberately, and §2 says
> why.**
>
> [**human-review-queue**](./human-review-queue.md) owns the approval surface.
> `unattended_mode = "approval"` holds a fire in `pending_trigger_fires`
> (`background.rs:2878`). **That path owns the queue; this path owns the fact
> that the schedule has already advanced before the hold is written.**
>
> [**llm-spend-accounting**](./llm-spend-accounting.md) owns the budget number.
> **This path owns the gate that reads it** (`background.rs:2490-2530`) and the
> reason it must mirror the manual path exactly.
>
> [**error-surfacing-policy**](./error-surfacing-policy.md) owns where a failure
> goes. **This path adds the case it has no vocabulary for: a schedule that
> stops is not an error anywhere — it is an absence, and absences do not raise.**
>
> The **Deviations** section is a fix backlog.

---

## 1 Trigger

- "Make this persona run every morning at 9." / "Run this every 15 minutes."
- "My scheduled agent isn't firing." / "It fired once and never again."
- "What happens to my daily job if the app was closed all week?"
- "This needs to run at 9am *their* time, not the server's."
- "Two ticks might overlap — will it double-fire?"
- "I'm adding a trigger row from my import / template / build path."

If you are about to type `next_trigger_at`, `trigger_version`, `mark_triggered`,
`advance_schedule_pointer`, `compute_next_trigger_at`, `parse_cron_seeded`,
`max_backfill`, `"timezone"`, `INSERT INTO persona_triggers`, or to add a new
`cron`-shaped column to any table — you are in this situation.

**Not this path:** *the tick loop's own lifecycle* is
[background-loop](./background-loop.md); *HTTP content diffing* is
[polling-loop](./polling-loop.md); *how the published event becomes an execution*
is the event bus, in [backend-to-frontend-events](./backend-to-frontend-events.md)
and `event_bus_tick`.

## 2 The one way

**Compute the next fire time at the same instant you write the row, from the
same parsed config, in the same transaction — and if you cannot compute one, say
why in a durable place, because a NULL `next_trigger_at` is not "unscheduled", it
is "gone".** Go through `triggers::create`
(`db/src/repos/resources/triggers.rs:97`), which is the only construction site
that parses the config once (`:130`), computes `next_trigger_at` from it
(`:131`), writes both atomically (`:154-159`), and — critically — records *why*
when the computation fails (`:168`). Never hand-write
`INSERT INTO persona_triggers`; six of the ten sites that do have no arming step
and therefore mint rows that can never run. **At fire time, claim before you
publish**: `mark_triggered` (`:1715`) is a compare-and-swap on `trigger_version`
that both stamps the fired-watermark and advances the pointer in one UPDATE, so
two overlapping ticks cannot both win — and only after it returns `Ok(true)` may
you publish the event (`background.rs:2836` then `:2906`). This buys
**at-most-once** and it is the right trade here, because the alternative
(publish, then claim) buys at-least-once by paying in duplicate LLM executions,
which cost real money. **Use the right skip primitive**: an *intentional* drop
(overlap) consumes the slot with `mark_triggered`; an *involuntary* one
(over budget, outside the active window, rate-limited) must use
`advance_schedule_pointer` (`:1750`), which moves the pointer and the version but
**not** `last_triggered_at`, because the catch-up window is `(last_triggered_at,
now]` and moving that watermark silently deletes every missed run. **Resolve the
timezone through `resolve_schedule_tz` (`core/src/scheduler.rs:41`) and refuse
on failure** — never `.parse::<Tz>().ok()`, which turns "you named a zone I do
not recognise" into "you named no zone" into "use whatever zone this laptop is
in". Then stop: do not re-derive the next-fire computation in TypeScript, do not
add a second `cron` column to a new table without deciding *in writing* whether
it is UTC or wall-clock, and do not assume a schedule that stops will tell you.

## 3 Mandated primitives

**Exist today — use them:**

- **`db/src/repos/resources/triggers.rs:97` `create(pool, CreateTriggerInput)`** —
  the only construction site that arms. Validates (`:100-101`), detects chain
  cycles (`:108`), encrypts config (`:126`), parses once (`:130`), computes
  `next_trigger_at` (`:131`), INSERTs it atomically with an auto-paired
  `event_listener` (`:154-163`), and records an invalid-timezone issue after
  commit (`:168`). Every other path is a downgrade.
- **`core/src/scheduler.rs:41` `resolve_schedule_tz(Option<&str>) -> Result<Option<Tz>, ScheduleTzError>`** —
  the one shared zone policy. `None → Ok(None)` (fall back to local);
  `Some(valid) → Ok(Some(tz))`; `Some(invalid) → Err`, and **the caller must
  refuse**. Its own doc comment says it exists "so they can never diverge
  again". Four call sites obey it; six sites parse zones without it (§7 P1).
- **`core/src/scheduler.rs:96` `compute_next_from_config_anchored(cfg, now, seed, anchor)`** —
  the single next-fire decision. Cron arms ignore the anchor (wall-clock);
  interval arms use it so cadence does not drift later every cycle.
  `compute_next_trigger_at` (`:157`) is the wrapper that reads the anchor off
  the trigger.
- **`core/src/cron.rs:74` `parse_cron_seeded(expr, seed)` + `:95` `seed_hash(id)`** —
  5-field cron as bitmasks, with Jenkins `H` expansion salted by field index and
  part index. **Always pass `seed_hash(&trigger.id)`**; `parse_cron` (`:62`) is
  the zero-seed form reserved for syntax validation, and it collapses every `H`
  to its range minimum, i.e. re-creates the thundering herd it exists to avoid.
- **`core/src/cron.rs:597` `next_fire_time_in_tz` / `:587` `next_fire_time_local`** —
  the DST-correct evaluators. Both go through `next_fire_time_in_zone` (`:472`),
  which iterates **local wall-clock minutes** and maps back with
  `from_local_datetime(..).earliest()`: a fall-back duplicate fires once, and a
  spring-forward gap fires at the gap boundary via `gap_end_utc` (`:571`)
  instead of slipping a day. Four `#[cfg(test)]` cases pin this (`:1076-1112`),
  and the JS replay reproduces all of them.
- **`db/src/repos/resources/triggers.rs:1715` `mark_triggered(pool, id, next, expected_version)`** —
  the claim. CAS on `trigger_version`; `Ok(false)` means another tick won.
- **`:1750` `advance_schedule_pointer(pool, id, next, expected_version)`** — the
  same CAS **without** moving `last_triggered_at`. This is the skip primitive
  and it is also, reused, the *backfill claim* (`background.rs:2638`) and the
  *user-backfill claim* (`commands/execution/scheduler.rs:190`).
- **`:1581` `get_due(pool, now_rfc3339)`** — the query. Note both of its
  conditions: `t.status = 'active'` **and** `p.enabled = 1` (the persona toggle;
  it joins because the header switch used to be cosmetic). It does *not* read
  `t.enabled` — `set_enabled` (`:1856`) keeps the two in sync, and 20 live rows
  sit at `enabled=0, status='active'` from a bulk update that did not.
- **`:2005` `set_schedule_status_reason` / `:2033` `clear_schedule_status_reason`** —
  the durable "why is this NULL" channel, on `schedule_missed_runs`. **This is
  the primitive that makes a dead schedule explicable. It has 0 rows.**
- **`background.rs:2199` `schedule_overlap_active(pool, trigger_id)`** — the
  in-flight check. Its doc comment (`:2185-2198`) is required reading: an
  in-memory guard *cannot* work here, because the fire path only publishes an
  event and returns long before the execution starts, so the durable signal is
  the execution row plus any still-pending event.
- **`background.rs:1906` `BACKFILL_HARD_CAP` (100) / `:1915` `GLOBAL_BACKFILL_PER_TICK` (50)** —
  the two amplification ceilings. Per-trigger and per-tick respectively.
- **`commands/execution/scheduler.rs:122` `backfill_schedule`** — the
  user-initiated replay. Claims via CAS *before* computing anything (`:190`),
  refuses on a bad zone (`:168`), dedupes against already-published slot times
  (`:235`), applies the same hourly cap as the auto path (`:259`).

**Do NOT build:** a second cron parser (`useCronPreview.ts:12-21` documents
deleting a seedless preview hook precisely because it "modelled a fire minute
the engine would never actually use" — the fix was to route the UI through the
seeded IPC, not to align two implementations); a per-trigger `tokio` task; an
in-memory in-flight guard; a `HashSet` of fired slot ids.

## 4 Steps

1. **Decide the cadence shape.** `cron` (wall-clock, zone-aware, no anchor) or
   `interval_seconds` (elapsed-time, anchored). If both are present, **`cron`
   wins** — the match arms in `compute_next_from_config_anchored` test
   `cron: Some(_)` first (`core/src/scheduler.rs:103`). Do not rely on that;
   author one.
2. **Author the zone as an IANA name or omit the field entirely.** There is no
   third option. `""` and absent both mean system-local and both work; every
   other non-IANA string is a permanently dead schedule.
3. **Call `triggers::create`.** Do not write SQL. If your path genuinely cannot
   (an import loop, a transaction you already own), you owe three things
   in the same transaction: `TriggerConfig::from_raw`,
   `compute_next_from_config`, and `next_trigger_at` in the column list — and
   `invalid_schedule_timezone` + `set_schedule_status_reason` after it.
4. **Validate before you insert.** `validate_config` (`core/src/validation/trigger.rs:71`)
   checks the cron; `validate_schedule_has_cron_or_interval` (`:210`) checks the
   trigger declares a cadence at all. **Neither validates the timezone** — that
   is Gap 1, and until it closes, check it yourself with `resolve_schedule_tz`.
5. **Let the tick take over — and then stop.** `TriggerSchedulerSubscription`
   (`engine/subscription.rs:384`, 5 s active / 30 s idle) plus the startup
   overdue sweep (`background.rs:773`) own the rest. Do not add a wake path, do
   not shorten the interval, do not "help" it fire.
6. **If you are writing the fire path itself**, the order is fixed and every
   step is load-bearing:
   `get_due` → skip non-time-based types → daemon yield → active-window skip
   (`advance_schedule_pointer`) → budget skip (`advance_schedule_pointer`) →
   overlap skip (`mark_triggered` + visible signal) → count missed slots →
   backfill extras (claim first, then publish) → compute next → rate-limit skip
   (`advance_schedule_pointer`) → **claim (`mark_triggered`)** → record
   discarded misses → **publish**. The claim/publish boundary is the only place
   in this list where crashing loses a fire, and that is deliberate.
7. **Give a dead schedule a reason.** Any path that can produce
   `next_trigger_at = NULL` for a `schedule`/`polling` row must write a
   `schedule_missed_runs.status_reason` in the same breath. A NULL with no
   reason is indistinguishable from a manual trigger, and that is exactly how 37
   rows became invisible.
8. **Before you add a `cron` column to a new table**, write down whether it is
   UTC or wall-clock, and pick the matching evaluator. `next_fire_time`
   (`cron.rs:407`) is **UTC**; `next_fire_time_local` (`:587`) is wall-clock.
   `curation_scheduler.rs:110` uses the first and every trigger path uses the
   second, so `"0 3 * * *"` means two different instants in one app today (§7 P4).

## 5 Anti-patterns

- **`.parse::<Tz>().ok()`** — collapses "unrecognised zone" into "no zone",
  which every caller reads as "this laptop's zone". 6 live sites (§9). The
  failure is not that a fire happens at the wrong hour; it is that **two halves
  of the same trigger disagree about what time it is**: the schedule refuses
  while its active window silently runs on host-local (`core/src/models/trigger.rs:150`).
- **Writing `INSERT INTO persona_triggers` by hand.** Six of ten production
  sites do, and none of the six arms the schedule. The row is created, the UI
  lists it, the user believes it is scheduled, and `get_due` will never see it.
- **Advancing `last_triggered_at` on an involuntary skip.** The catch-up window
  is `(last_triggered_at, now]`. `advance_schedule` (`:1780`) — the
  *unconditional* variant, used after a manual run — moves it. Reach for it and
  a week of missed runs stops existing. Use `advance_schedule_pointer`.
- **Publishing before claiming.** Gets you at-least-once, and an at-least-once
  LLM execution is a duplicate bill and a duplicate side effect. The repo has
  already paid for this lesson twice in adjacent code: `commands/execution/scheduler.rs:176-189`
  and `background.rs:2617-2637` both document the same double-publish race and
  both fixed it by claiming first.
- **Assuming `tokio::time::interval` skips missed ticks.** It does not — the
  default is `MissedTickBehavior::Burst`. 13 files construct one; **3** set the
  behavior (`auto_cred_browser.rs:113` Skip, `alert_evaluator.rs:361` Delay,
  `runner/mod.rs:2086` Skip). The trigger subscription is not one of them, so a
  tick that blocks for 60 s is followed by 12 immediate back-to-back ticks.
- **A cron on a trigger type that has no cron field.** `TriggerConfig::Polling`
  (`core/src/models/trigger.rs:291`) has no `cron`; `from_raw` (`:593`) does not
  read one; nothing in the tree sets `deny_unknown_fields` (0 occurrences). The
  key is silently dropped. **7 live rows** are `polling` triggers whose entire
  config is `{"cron":"0 * * * *","timezone":"local"}` — two independent reasons
  to never fire, stacked.
- **Naming the empty case.** `"local"`, `"system"`, `"auto"` are words, not
  zones. The empty case is already representable: omit the field.
- **Reporting a capped count as a count.** `compute_missed_backfill_slots`
  stops at `BACKFILL_HARD_CAP`. Replayed: a 900 s interval trigger 30 days stale
  has **2,880** missed slots and the recorded `missed_count` is **99**. The
  event payload (`background.rs:2151`) calls that field `missed_count` with no
  "at least" marker.

## 6 Evidence

**The one site to copy: `db/src/repos/resources/triggers.rs:97-180`** —
`triggers::create`. It is the only place in the tree where parse, compute,
insert and explain are one unit. Read `:126-136` (parse once, compute, capture
the zone fault) and `:151-177` (transaction, then the fault report *after*
commit so a reporting failure cannot roll back the row).

The fire path to copy is `background.rs:2833-2935` — CAS, then `Ok(false) →
continue`, then publish, then `log_schedule_lost_fire_issue` on publish failure.
The three skip paths above it (`:2454-2470`, `:2516-2529`, `:2795-2831`) are the
reference for "advance the pointer, preserve the watermark".

The zone policy to copy is `core/src/scheduler.rs:41-49` and its two consumers
at `:109` and `:206`, plus `background.rs:2312` and
`commands/execution/scheduler.rs:168`.

The correctness proof to copy is `cron.rs:1071-1112` — three DST tests that name
the exact instants (`2026-03-08 02:30` in the gap → 07:00 UTC; `2026-11-01 01:30`
fires once at 05:30 UTC and next at Nov 2 06:30 UTC, explicitly `assert_ne!`
against the 06:30-same-day duplicate). This is the single strongest piece of
engineering in the subject area and it is worth saying so.

### Convergence sweep — 5 sibling repos, 7,783 files

| clause | verdict | evidence |
| --- | --- | --- |
| **Claim the due job before doing the work; the affected-row count is the lock** | **PHYSICS** | `ascent` `src/lib/db/org-watch.ts:209-217` — `updateMany({where:{id, watched:true, scanSchedule:{not:"off"}, nextScanAt:{lte:new Date()}}, data:{nextScanAt: +15min}})` then `return res.count === 1`. `brainiac` `crates/brainiac-server/src/sweeps.rs:240-255` — claim and clock-advance in ONE `UPDATE … WHERE kind IN (SELECT … WHERE next_run_at <= now() AND last_status IS DISTINCT FROM 'running') RETURNING kind`. Two stacks, no shared document. `ascent`'s own comment at `digest/route.ts:189-193` records arriving here by *fixing the check-then-act bug in production*. |
| **Claim strictly BEFORE the billable step** | **PHYSICS** | `ascent` `api/cron/rescan/route.ts:78-134` — comment reads "CLAIM-BEFORE-WORK: atomically take ownership of this due repo before any expensive or billable step". Personas does the same at `background.rs:2836` → `:2906`. |
| **A lease, not a full advance; plus a stale-`running` reaper** | **PHYSICS, and Personas lacks it** | `ascent` `CLAIM_LEASE_MS = 15min` (`org-watch.ts:192`) + `advanceScheduleAfterFailure` 6 h backoff (`:241`) + `releaseAuditClaim` compensating release (`scans-audit.ts:136`). `brainiac` `RUNNING_STALE = "2 hours"` (`sweeps.rs:46`). Personas advances the pointer a full period on claim and has no reaper — a fire lost between claim and publish waits a full cadence, which for a daily job is 24 h. |
| **Missed slots coalesce to ONE fire** | **INVERTED — the siblings are unanimous and Personas is the outlier** | `ascent` `nextScanFor` = `Date.now() + d*86_400_000`; `brainiac` `next_run_at = now() + make_interval(cadence_secs)`; `personas-cloud` `computeNextCron(cron, now)`. All three compute from **now**, never from the missed slot; none has a `max_backfill`. Personas is the only one that can emit N catch-up events. Note the sibling weakness this exposes: **none of the three decided to coalesce — it fell out of having one column**, and none records that slots were dropped. Personas' `schedule_missed_runs` is the better idea nobody else had; it has 0 rows. |
| **Named IANA zones on a schedule** | **NO TRACE — 0 across all 5 repos** | `brainiac`: `chrono_tz` 0, `chrono::Local` 0, cadence modelled as `cadence_secs` so a wall clock never enters. `ascent`: Vercel crons are UTC, `nextScanFor` is epoch-ms arithmetic. `personas-web`: silence. The one sibling that evaluates cron against a wall clock — `personas-cloud` `cronParser.ts:63-83`, six local-time getters then `toISOString()` at `:79` — is exactly where its timezone defect lives. **Personas' zone-aware, DST-gap-and-fold-correct evaluator is a house convention with zero external corroboration. It is also the best implementation in the sweep.** The honest reading is not "drop it" but "the siblings avoided the problem class entirely, and that is a real alternative: model cadence, not time-of-day." |
| **`"local"` (or any sentinel) where a zone belongs** | **NO TRACE — 0 in 7,783 files** | No sibling accepts a user-supplied zone string at all, so no sibling has needed to validate one. This defect is purely local. |
| **DST gap / fold handling** | **NO TRACE** | The only DST engagement anywhere is `ascent` `src/lib/window.test.ts:94`, which *pins a known spring-forward off-by-one-day as accepted behaviour* in a reporting window. No sibling handles DST in a schedule. Personas' `cron.rs:1076-1103` is alone. |
| **Watchdog for "loop alive, nothing moving"** | **1 of 5 — not physics** | Only `brainiac`: the 2 h wedge reaper (`sweeps.rs:46`), a queue crash-poison dead-letter (`queue.rs:120-133`), and a 48 h stall SLO that *re-pages on every cadence* by design (`alerts.rs:19-20`). `ascent` substitutes HTTP 207-on-degraded (`purge/route.ts:51-60`). `personas-cloud`'s 30 s/90 s heartbeat watches *workers*, not the loop. Personas has neither. |
| **`set_missed_tick_behavior`** | **N/A in siblings** | 0 hits — because **no sibling constructs a `tokio::time::interval` at all**. `brainiac` uses `Instant::elapsed()` comparison (`main.rs:787`) and explicit `sleep_or_shutdown`, which cannot burst by construction. Personas uses `tokio::time::interval` in 13 files and sets the behavior in 3. |

**The most valuable sibling result is a negative one.** `personas-cloud`'s
scheduler is not independent evidence: `packages/orchestrator/src/triggerScheduler.ts:87`
says *"Ported from desktop engine/background.rs::trigger_scheduler_tick()"*.
It was discounted — and then it turned out to be the strongest argument in this
document, because **the port dropped the CAS**. Its advance is
`UPDATE persona_triggers SET last_triggered_at = ?, next_trigger_at = ?, updated_at = ? WHERE id = ?`
(`db.ts:1048`) with no version guard, relying entirely on single-process
`BEGIN IMMEDIATE`. The one mechanism that makes this path safe is invisible in
the shape of the code — it lives in a `WHERE` clause that looks like
bookkeeping — so a careful engineer copying the file by hand did not carry it
across. That is the case for making it a type rather than a convention.

The port also carries a defect worth stealing the lesson from:
`personas-cloud` `db.ts:1043` compares a column holding `toISOString()` output
(`2026-08-15T09:00:00.000Z`) against SQLite `datetime('now')`
(`2026-08-15 10:30:00`) as **strings**. `'T'` (0x54) > `' '` (0x20), so an
intraday schedule never becomes due until the calendar date rolls over.
Personas' `get_due` compares RFC3339 to RFC3339 and is safe **today** — but
`next_trigger_at` is `TEXT` and 20 live rows already carry `updated_at` in the
space-separated `datetime('now')` shape from a bulk update, so the mixed-format
condition already exists in this table (§8 Gap 5).

`vibeman` supplies the empirical cost, as siblings usually do. It has a
`persona_triggers` table copied from this app's shape, with **2 rows, both
`enabled = 1`, both 169 days overdue** as of 2026-08-15 — and `grep persona_triggers`
over its `src` returns **0 matches**. There is no code that can ever service
them. Worse, the two rows record `interval_seconds: 14400` (4 h) while their
`next_trigger_at − last_triggered_at` is **exactly 300.000 s**: whatever wrote
them fired on a 5-minute cadence against a 4-hour config, **48× over**. And its
`obs_endpoint_stats` rollup still asserts **80,817,237 API calls** over 3,733
rows against only 93,154 retained raw call rows — an 867× inflation, for a
localhost app. The pattern across both repos is the same: **a schedule table
whose numbers nobody reads is not neutral, it is confidently wrong.**

## 7 Deviations

Every entry is live on `master` @ `f2e002f7b`.

**P0 — 37 of 39 time-based triggers cannot fire, and 16 of those never could.**
- `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:278,292,301,331`
  — emits `timezone: "local"`, which is not an IANA zone; every trigger built by
  template adoption is dead on arrival. **Fix: delete the key** (all four
  branches), matching `TimezoneSelect.tsx:69`'s `value=""`. One-line-per-branch fix.
- 16 live rows carry the sentinel; **0 have ever fired**. A data migration is
  required alongside the code fix: `UPDATE persona_triggers SET config = json_remove(config,'$.timezone') WHERE json_extract(config,'$.timezone') = 'local'`,
  then recompute `next_trigger_at`. The replay confirms all 16 become schedulable.

**P1 — six zone-resolution sites discard the parse failure.** Each turns an
unrecognised zone into host-local instead of a refusal, so the UI and the
engine disagree about whether a trigger is alive.
- `src-tauri/core/src/models/trigger.rs:150` — `ActiveWindow::resolve_tz`. The
  active-window gate runs host-local while the schedule refuses. Worse,
  `resolved_timezone_name()` (`:155-160`) is *displayed*, and for a bad zone it
  returns the host's IANA name — the UI actively asserts the wrong zone is "in
  effect".
- `src-tauri/src/commands/tools/triggers.rs:867` (`preview_cron_schedule`) and
  `:942` (`cron_fire_times_in_range`) — **the calendar renders a fabricated
  future for a schedule the engine has permanently refused.** These two are
  precisely the failure `useCronPreview.ts:12-21` claims to have eliminated;
  the seed was fixed there, the zone policy was not.
- `src-tauri/src/commands/tools/triggers.rs:334` — the trigger list's "next run".
- `src-tauri/src/engine/rotation.rs:1173` — credential rotation cron.
- `src-tauri/src/engine/system_ops.rs:157` — `compute_next_run_at`, written as a
  bare `.parse().ok()` with the type inferred from the next line.
- **Fix:** all six call `sched_logic::resolve_schedule_tz` and refuse on `Err`.

**P2 — six of ten production INSERT sites never arm the schedule.**
- `src-tauri/src/commands/core/data_portability.rs:6126` — the **import** path.
  Inserts any `trigger_type` with `next_trigger_at` absent, and pushes failures
  into `result.warnings`. Importing a persona export with a daily schedule
  produces a permanently dead schedule.
- `src-tauri/src/commands/design/n8n_transform/confirmation.rs:169` — same, and
  its `valid_types` explicitly admits `"schedule"` and `"polling"`.
- `src-tauri/src/commands/design/build_sessions.rs:2213` — inserts NULL, arms in
  `update_trigger_schedules` (`:2589`, called at `:2994`) **outside the
  transaction, best-effort**: `let _ = db.get().map(|c| c.execute(..).ok())`. Its
  `if let Some(next_at) = compute_next_trigger_at(..)` means a `None` — i.e. a
  bad zone or a bad cron — takes the else-less branch and produces **no log, no
  healing issue, no status_reason**. This is the exact code path that silently
  minted the 16 dead rows.
- `src-tauri/db/src/repos/communication/events.rs:1588`
  (`create_subscription_with_trigger`) — takes `trigger_input.trigger_type`
  unconstrained.
- `src-tauri/db/src/repos/resources/triggers.rs:757` and `:1069` — both pin
  `'event_listener'` literally, so they are safe today; they are listed because
  the next edit that parameterises the type inherits the defect.

**P3 — `platforms/deploy.rs:303` INSERTs a column that does not exist.**
```
"INSERT INTO persona_triggers
 (id, persona_id, name, trigger_type, config, enabled, created_at, updated_at)"
```
`persona_triggers` has **13 columns and none is `name`** — verified against the
live `PRAGMA table_info` and against every `ALTER TABLE persona_triggers` in
`db/src/migrations/incremental.rs` (`:624` `use_case_id`, `:2175` `status`,
`:2323` `trigger_version`, `:2341` `unattended_mode`). The statement can only
return `no such column: name`, and it is `?`-propagated, so the whole GitHub
deploy fails. **Fix: drop `name` from the column list and the corresponding
`format!("GitHub: {}", …)` parameter.**

**P4 — one cron string, two meanings.** `curation_scheduler.rs:110` calls
`cron::next_fire_time` (`cron.rs:407`), the **UTC** evaluator; every trigger path
calls `next_fire_time_local`/`_in_tz`. So `"0 3 * * *"` on a curation schedule
and on a trigger fire at different instants — currently 2 h apart on this
machine (`Europe/Prague`). `cron.rs:407` also carries `#[allow(dead_code)]`
while being `pub` and having a live caller, which is how it stayed unexamined.
`engine/src/scraper.rs:457` is a third model: `next_fire_time_local` with no
timezone field at all, so scrape schedules are host-local and unportable.

**P5 — the startup overdue sweep bypasses the leadership gate.**
`background.rs:773` calls `trigger_scheduler_tick_counted` directly, inline in
`start_loops`. Every periodic subscription is gated on
`leadership.is_leader()` (`subscription.rs:1284`, default `requires_leadership() = true`),
but this call is not. Two instances on one data directory both run the full
overdue sweep at boot. The `mark_triggered` CAS contains the damage — which is
the argument for the CAS, not an argument that the gap is harmless.

**P6 — the detector only runs at create/update time.** `record_invalid_timezone_issue`
(`triggers.rs:483`) is reachable from `create` (`:168`) and `update` (`:461`)
only. There is no boot-time reconcile over existing rows, so the 16 sentinel
rows — which predate the detector — have **no** `schedule_missed_runs` row, **no**
healing issue and **no** status reason. `schedule_missed_runs` has 0 rows total.
A detector that cannot see the rows that motivated it is not a detector.

**P7 — `missed_count` reports a cap as a count.** Replayed: a 900 s interval
trigger 30 days stale has 2,880 missed slots; `compute_missed_backfill_slots`
returns 99 and `record_and_emit_missed_runs` persists **99**. The payload field
is named `missed_count` (`background.rs:2151`) with no truncation marker. Add
`missed_at_least: bool` or persist the window instead of the count.

**P8 — `enabled` and `status` have drifted on 20 live rows.** `get_due` reads
`status`, not `enabled`; `set_enabled` (`:1856`) writes both. 20 rows sit at
`enabled=0, status='active'` with `updated_at = '2026-06-10 08:13:14'` — a bulk
UPDATE that wrote one column and, note, wrote it in SQLite's
space-separated format rather than RFC3339. Two columns encoding one fact is
one column too many (§8 Gap 5).

## 8 Gaps

1. **Nothing validates a timezone at the door.** `validate_config`
   (`core/src/validation/trigger.rs:71`) validates `interval_seconds`,
   `window_seconds`, `cron`, `cron_expression`, `webhook_secret` and
   `smee_channel_url`. It never reads `timezone`. Every deviation in P0/P1 is
   downstream of this one omission — and it is the gap the "prefer a type"
   section below closes properly.
2. **`Option<String>` for `next_trigger_at` encodes five different states as
   one.** NULL means: not time-based (correct, and the majority of rows);
   unparseable cron; unparseable zone; nobody computed it; **or a webhook fired
   and cleared it** (`engine/webhook.rs:631` sets `next_trigger_at = NULL`
   deliberately). `get_due` treats all five identically as "never run". The
   `status_reason` side-table exists to disambiguate and is unused.
3. **A schedule that stops firing raises nothing, anywhere.** `SchedulerState`
   tracks `triggers_fired` as a counter and `SubscriptionHealth`
   (`background.rs:43-70`) carries `alive`, `tick_count`, `last_tick_at`,
   `overrun`, `consecutive_panics`. Every one of those is *green* during the
   79-day silence: the loop is alive, ticking on time, never panicking, and
   processing zero rows. `mark_subscription_dead` is called from exactly one
   place (`subscription.rs:1427`) — loop retirement. **There is no instrument
   for "healthy and doing nothing", which is the shape of the 2-day fleet
   deadlock this repo already paid for.** The event bus *does* have the
   analogous reaper (`reap_stuck_processing_events`, `background.rs:1081`); the
   trigger scheduler does not. `brainiac`'s three-layer answer (§6) is the
   model.
4. **`BACKFILL_HARD_CAP` is a slot cap, not a cost cap.** With
   `max_backfill: 30` and a daily cron 30 days stale, the replay says the tick
   publishes **30 events** — 29 catch-up plus the live fire — in one pass. Each
   becomes an LLM execution. The per-persona hourly ceiling
   (`schedule_hourly_cap_exceeded`) is the only thing between that and the
   monthly budget, and it is re-checked per slot, so the *first* slots still
   run. A budget-denominated backfill cap would be the correct primitive and
   does not exist.
5. **`next_trigger_at` is `TEXT` compared lexicographically.** `get_due`'s
   `t.next_trigger_at <= ?1` is a string comparison against
   `Utc::now().to_rfc3339()`. It is correct today only because every writer
   happens to use `to_rfc3339()`. The table already contains `updated_at` values
   in SQLite's `datetime('now')` shape from a bulk UPDATE, and
   `personas-cloud` shipped exactly this bug (§6). An `INTEGER` epoch column, or
   a `CHECK` constraint on the format, would make the class unrepresentable.
6. **The census cannot see `#[cfg(test)]`.** The engine matches whole file
   content and has no notion of a brace-matched test range, so a rule over Rust
   inherits its fixtures. The `silent-row-skip` rule already documents carrying
   4 test matches in its baseline. This is why §9 rejects the INSERT-arming
   gate with a measured precision rather than shipping it.
7. **The census cannot express "must be zero".** The condition this document
   most wants to gate — *no `schedule`/`polling` row may exist with
   `next_trigger_at IS NULL` and no `status_reason`* — is a property of the
   **database**, not of the source. It has no textual signal at all. Closing it
   needs a boot-time reconcile that writes a `status_reason` for every
   unschedulable row, plus a UI badge that reads it. Until that exists, the only
   honest gate is the source-level proxy in §9.

## Prefer a type over a gate

**Make the timezone slot hold a zone, not a string: `timezone: Option<Tz>`.**

Today `TriggerConfig::Schedule.timezone` is `Option<String>`
(`core/src/models/trigger.rs:278`) and `ActiveWindow.timezone` is `Option<String>`
(`:133`). `"local"` is a perfectly valid inhabitant of both. Change the field to
`Option<chrono_tz::Tz>` — the crate already ships the `serde` impl behind a
feature (`chrono-tz/Cargo.toml:73`, `src/lib.rs:135`), currently not enabled, so
this is a one-line manifest change plus `from_raw` (`:582`) doing the parse once
where it already parses everything else.

Held against the six qualifications:

1. **A required prop carries only what it actually encodes.** `Option<Tz>`
   encodes exactly "a zone, or none". `Option<String>` encodes "any text at all",
   and the code then spends six sites re-deriving which texts are zones.
2. **Requiredness is orthogonal to closedness — and closedness is the entire
   win here.** The field stays optional; `None` is a legitimate, common answer
   ("use system local") that 23 live rows depend on. Making it *required* would
   change nothing, because the illegal value would still be spellable. What
   makes the defect impossible is that the type is **closed** over the ~600 IANA
   names. This is the qualification that decides the design.
3. **A type nobody constructs constrains nothing.** `Tz` is constructed at one
   place (config deserialisation) and consumed at ten (the four compliant
   `resolve_schedule_tz` sites and the six violating `.parse().ok()` sites, all
   of which stop existing). It is on the hot path, not decorative.
4. **A type anyone can construct authenticates nothing.** True — anyone can
   write `Tz::Europe__Prague`. But `Tz` is not being asked to *authenticate*;
   it is being asked to be **inhabited only by real zones**, and it is. There is
   no `Tz::Local` variant to reach for. The illegal state is unrepresentable,
   not merely unauthorised.
5. **Withholding beats requiring.** This adds no field and no required argument.
   It removes a freedom: the freedom to put arbitrary text in a zone slot.
6. **Withhold the dangerous freedom, not the answer.** The answer — "this
   schedule has no explicit zone" — stays fully expressible as `None`. What is
   withheld is only the ability to *name a zone that does not exist*.

**And — the test the brief demands — does the type actually reach the code?**
Yes, and this is the discriminating point. `timezone` is a struct field passed
**by value as a parameter** into `compute_next_from_config_anchored`
(`core/src/scheduler.rs:96`), `compute_slots_in_range` (`:181`) and
`compute_missed_backfill_slots` (`background.rs:2292`). Every consumer sees it
through a signature `rustc` can check. Contrast the *other* candidate on this
path — making `next_trigger_at` a type that cannot be silently absent. That one
**cannot reach the code**, because at six of the ten INSERT sites the column is
not a parameter at all: it is a word inside a SQL string literal
(`"INSERT INTO persona_triggers (id, persona_id, …)"`). No Rust type is at that
boundary to constrain. `platforms/deploy.rs:303` proves the point at full
strength — it names a column that has never existed, and the compiler is
perfectly happy. The only fix available there is the *withholding* move at a
different layer (make the table reachable only through
`triggers::create`, the way `hand-rolled-fixture-ddl` already polices `CREATE
TABLE`), which is a gate wearing a type's clothes.

So: `Option<Tz>` is the type change to make, and it is the reason §9's rule is a
**ratchet, not the fix** — the rule counts the six sites; the type deletes them,
and takes Gap 1 with it.

## 9 The missing gate

**Condition, stated stack-free:** *a value that must name a member of a closed,
externally-defined vocabulary is accepted as free text, and the "not a member"
outcome is discarded rather than refused.* An adopting repo must derive its own
proxy — this one keys on Rust turbofish syntax and would report green forever in
a TypeScript codebase where the same condition is spelled
`new Intl.DateTimeFormat(undefined, {timeZone: x})` inside a `try/catch`.

**Existing rules checked for overlap before writing this**, by reading each
definition, not by title: `silent-row-skip` (anchored to `query_map`, about row
iterators), `env-default-conflates-unset-with-empty` (`??` after an env read, TS
only), `unraced-loop-wait` (a `loop {` opening with a bare wait — the closest
neighbour, and it owns the *loop*, not the decision inside it),
`process-global-caches-a-failure` (`OnceLock<Result<..>>`),
`bindingless-catch-on-io`, `hand-rolled-emptiness-refusal`,
`unverified-effect-dispatch`, `optional-store-handle`,
`unverifiable-conflict-clause`, `blind-identity-write`, `untimed-repo-query`,
`hand-rolled-fixture-ddl`. **None covers a discarded parse of a closed
vocabulary.** Proposing a new one.

**Fail-loud:** inherited from the runner — a walk below `floor: 900` (the tree
is 963 `.rs` files), a rule matching zero files, a stale `exclude`, a rise, or a
**silent drop** all exit non-zero.

### Recall matters more than precision here, and the first pattern got it wrong

The first version of this rule anchored on the turbofish only:
`parse::<(?:chrono_tz::)?Tz>\(\)\s*\.\s*ok\(\)`. It validated clean at **5
matches / 3 files** and looked finished.

A second, independent pass — grepping for the *consumer* (`next_fire_time_in_tz`)
rather than the syntax — found a **sixth** site the pattern could not see:
`src-tauri/src/engine/system_ops.rs:157`, `tz.and_then(|z| z.parse().ok())`,
whose target type is inferred from the `next_fire_time_in_tz` call on the very
next line. Recall was **5/6 = 83%**, and the missing one was in a live
scheduling path. The published pattern is a union of both spellings and measures
**6/4**. This is the same failure the brief warns about — a Rust pattern keyed on
one way of writing a type — and it is worth recording that the *only* thing that
caught it was measuring the same quantity a second way.

### The rule

```json
{
  "rules": [
    {
      "id": "discarded-timezone-parse",
      "goldenPath": "docs/concepts/golden-paths/scheduled-trigger-firing.md",
      "title": "An IANA zone name is parsed and the parse FAILURE is discarded, so an unrecognised zone silently becomes the host machine's local time",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:parse::<(?:chrono_tz::)?Tz>\\(\\)\\s*\\.\\s*ok\\(\\)|\\.parse\\(\\)\\s*\\.\\s*ok\\(\\)[\\s\\S]{0,120}?next_fire_time_in_tz)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an IANA zone name resolved into chrono_tz::Tz with the ParseError discarded by .ok(). TWO spellings, because one is invisible to the other: the explicit turbofish parse::<Tz>().ok(), and the type-INFERRED .parse().ok() whose target type comes only from the next_fire_time_in_tz call that consumes it (system_ops.rs:157 — missed by the turbofish-only first draft, recall 5/6). PROXY FOR the stack-free condition: a value that must name a member of a closed, externally-defined vocabulary is accepted as free text and the not-a-member outcome is discarded rather than refused. chrono_tz's FromStr is TIMEZONES.get(s) — an exact IANA-name lookup — so .ok() collapses 'you named a zone I do not recognise' into 'you named no zone', which every caller in this stack reads as 'use whatever zone this machine is in'. MEASURED 2026-08-15 at f2e002f7b: 6 matches in 4 files, ALL SIX OPENED AND CONFIRMED (precision 6/6) — models/trigger.rs:150 (the active-window gate, which then disagrees with its own schedule), commands/tools/triggers.rs:334/867/942 (the trigger list and BOTH calendar/preview IPCs, which render a fabricated future for a schedule the engine has permanently refused), engine/rotation.rs:1173, engine/system_ops.rs:157. The compliant form is resolve_schedule_tz (core/src/scheduler.rs:41), whose own doc comment says it exists so the paths 'can never diverge again'; it has 4 call sites against these 6. Live consequence: 16 rows in the operator's database carry timezone \"local\", 0 have ever fired. RATCHET ONLY — the real fix is typing the field Option<Tz> (see the path's 'Prefer a type over a gate'), which deletes all six sites"
      },
      "baseline": { "files": 4, "matches": 6 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged)

Same anchors pointed at the compliant form. It returns **5 matches / 3 files**
(`core/src/scheduler.rs:41,109,206`, `commands/execution/scheduler.rs:168`,
`engine/background.rs:2312`) — one definition and four call sites. A near-zero
result here would have meant the violating pattern was not discriminating on
"discards the error" but merely finding *all* zone handling in the repo; 5
compliant against 6 violating says the two forms genuinely coexist and the rule
separates them.

```json
{
  "id": "discarded-timezone-parse-positive-control",
  "goldenPath": "docs/concepts/golden-paths/scheduled-trigger-firing.md",
  "title": "POSITIVE CONTROL — zone resolution routed through resolve_schedule_tz, which returns Result and forces the caller to decide",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "resolve_schedule_tz\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "the compliant call; measured 5 matches / 3 files at f2e002f7b. NO baseline by design — a control is evidence, not a ratchet."
  },
  "floor": 900
}
```

### Refused: a gate on unarmed trigger INSERTs — with the numbers

The larger defect (P2: six of ten INSERT sites never arm the schedule) is the
more valuable thing to gate, and **I could not build a rule for it that is worth
shipping.** Both candidates were run through the real engine:

| candidate | signal | matches / files | true positives | precision |
| --- | --- | --- | --- | --- |
| **A** | `INSERT INTO persona_triggers` whose column list omits `next_trigger_at` | **18 / 9** | 4 | **22%** |
| **B** | A, plus a negative lookahead excluding statements whose `VALUES` tuple pins a non-time-based type literal (`'event_listener'`, `'webhook'`, `'manual'`, `'chain'`) | **9 / 6** | 4 | **44%** |

The refinement works — B correctly drops `triggers.rs:757`, `:1069` (literal
`'event_listener'`) and `deploy.rs:303` (literal `'webhook'`) — and it still
cannot clear 50%, because **5 of its 9 matches are `#[cfg(test)]` fixtures** and
the census engine has no brace-matched test-range exclusion (Gap 6). A gate that
is wrong more often than it is right trains people to ignore it; per the
contract, a gate that fires on correct content is worse than no gate. **Refused,
with the measurement rather than an opinion.**

What would make it shippable, in order of preference:
1. **Withhold the table.** If `persona_triggers` can only be written through
   `db::repos::resources::triggers`, the signal becomes "the string
   `INSERT INTO persona_triggers` appears outside one file" — a boundary rule with
   near-perfect precision, exactly the shape `hand-rolled-fixture-ddl` already
   uses for `CREATE TABLE`. That is a refactor, not a regex.
2. Teach the census engine `#[cfg(test)]` brace-matched ranges. That single
   engine change lifts candidate B from 44% to 100% on this corpus and would
   also let `silent-row-skip` drop the 4 test matches it currently carries.

### What the census fundamentally cannot gate here

The condition that actually caused the 79-day outage — *a `schedule` or
`polling` row exists with `next_trigger_at IS NULL` and no `status_reason`* — is
a property of the **database**, not of any file, and has no textual signal. The
census cannot express it, and it cannot express "must be zero" either. Closing
it requires:

- a **boot-time reconcile** that walks every `schedule`/`polling` row with a
  NULL pointer, re-runs `compute_next_from_config`, arms the ones that can be
  armed, and writes a `schedule_missed_runs.status_reason` for the ones that
  cannot — the missing counterpart to `reconcile_orphaned_kb_records`
  (`vector_kb.rs:1410`), which does exactly this shape of repair for a different
  table and already runs from `src/lib.rs:1092`;
- a **zero-fire watchdog**: if the trigger subscription has ticked N times with
  `triggers_fired` unchanged *while at least one enabled schedule row exists*,
  raise. `brainiac`'s 48 h stall SLO (`alerts.rs:19-20`, re-pages every cadence
  by design) is the reference. Nothing in `SubscriptionHealth` can express this
  today, because every field in it was green for 79 days.
