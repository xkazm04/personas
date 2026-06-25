# Scheduler & Cron Agents — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: scheduler-and-cron-agents | Group: Execution Engine
> Total: 5 | Critical: 1 | High: 2 | Medium: 2 | Low: 0

## 1. Auto-backfill watermark is poisoned by skip-advances → missed runs silently never catch up
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: silent failure / missed-fire recovery
- **File**: src-tauri/src/engine/background.rs:1810 (watermark read) ; src-tauri/src/engine/background.rs:1788 + :1735 + :1937 (skip-advances) ; src-tauri/src/db/repos/resources/triggers.rs:1678 (`mark_triggered` SQL)
- **Scenario**: A cron agent has `max_backfill: 24` so missed runs catch up after downtime. The persona hits its monthly budget cap. For each 5s tick over the next several days, the over-budget branch runs `compute_next_trigger_at` + `mark_triggered(..)` and `continue`s — never publishing, but `mark_triggered` sets `last_triggered_at = now`. When the budget resets on the 1st, the backfill window `(last_triggered_at, now]` (background.rs:1813) spans only the last ~5s, so **none** of the days of missed scheduled runs are replayed. The same poisoning happens for every out-of-active-window tick (:1735) and rate-limited tick (:1937).
- **Root cause**: `mark_triggered` overloads `last_triggered_at` to mean "last time the schedule pointer advanced," but the backfill catch-up logic treats it as "last time an event was actually published." Advancing it on pure *skips* destroys the catch-up watermark.
- **Impact**: Scheduled runs the user explicitly configured backfill to recover are permanently and silently lost (only a `warn!`/`debug!`). Defeats the entire backfill feature after the most common pause conditions (budget, active-window).
- **Fix sketch**: Track a separate `last_published_at` (or `last_fired_at`) column advanced *only* on a real `event_repo::publish`, and key `compute_missed_backfill_slots` off that. On skip paths, advance `next_trigger_at`/version but leave the fired-watermark untouched.
- **Value**: impact=9 effort=4

## 2. User-initiated backfill has no idempotency and no rate cap → duplicate / cost-runaway runs
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: duplicate firing / cost amplification
- **File**: src-tauri/src/commands/execution/scheduler.rs:98 (`backfill_schedule`) ; publish loop :156-187
- **Scenario**: User opens BackfillModal, picks "last 7 days" on an hourly cron, clicks Run → up to 100 `persona_event` rows enqueued (each a real execution). Nothing happened visibly fast enough, so they click Run again → another ~100 events for the **exact same slots** (slots are seeded identically via `cron::seed_hash(&trigger.id)`, so they line up perfectly). The auto-backfill path *does* apply `schedule_hourly_cap_exceeded`, but this user path applies **no** hourly cap and **no** dedupe against already-published `backfill_slot` events.
- **Root cause**: No `(trigger_id, slot_time)` uniqueness/dedupe key on backfill events and no per-persona hourly ceiling on the on-demand replay path. The `backfill_slot: true` marker is written but never consulted to suppress repeats.
- **Impact**: Each re-click multiplies executions and spend (up to 100× per click); overlapping with auto-backfill double-fires the same slots. Direct user money + duplicate agent side-effects.
- **Fix sketch**: Before publishing a slot, skip if a `backfill_slot` event for the same `(trigger_id, fired_at)` already exists (query or UNIQUE index). Also run `schedule_hourly_cap_exceeded` per slot here, as the auto path does.
- **Value**: impact=8 effort=3

## 3. Backfill replays in system-local time on an unparseable timezone while the live path refuses → wrong-hour runs
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: timezone semantics / divergence
- **File**: src-tauri/src/engine/scheduler.rs:176-178 (`compute_slots_in_range`) ; src-tauri/src/engine/background.rs:1590-1592 (`compute_missed_backfill_slots`) — contrast live path src-tauri/src/engine/scheduler.rs:80-93
- **Scenario**: A trigger is `0 7 * * *` + `timezone: "America/New_York"` but the stored zone string fails to parse (legacy alias, zone dropped across a chrono-tz bump, or a value that slipped past creation validation). The live scheduler (`compute_next_from_config_anchored`) logs a warning and returns `None` → `next_trigger_at` becomes NULL → trigger silently stops. Both backfill paths instead do `timezone.as_deref().and_then(|s| s.parse::<Tz>().ok())`, which discards the parse error and falls back to `next_fire_time_local` — replaying every slot at 07:00 **system-local** (e.g. Europe/Prague) instead of 07:00 New York, i.e. ~6 hours off.
- **Root cause**: Three call sites resolve the same timezone field with two different error policies: live = "refuse (None)", backfill = "silently fall back to Local (`.ok()`)".
- **Impact**: Backfill produces real runs at the wrong wall-clock hour — runs the live scheduler would never have emitted. Wrong-time firing of autonomous agents; also masks the underlying "trigger silently dead" state.
- **Fix sketch**: Make backfill mirror the live policy: if `timezone` is `Some(raw)` and fails to parse, return an empty slot set (and surface an error to the user-initiated command) rather than `.ok()`-into-Local. Share one `resolve_schedule_tz()` helper across all three paths.
- **Value**: impact=7 effort=3

## 4. Backfill extras are published before the version-CAS claim → overlapping ticks double-emit catch-up
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / duplicate firing
- **File**: src-tauri/src/engine/background.rs:1809-1922 (backfill publish loop) ; the CAS guard only protects the live fire at :1961
- **Scenario**: The startup overdue sweep (`trigger_scheduler_tick_counted`, background.rs:659) runs the full tick body, and a regular subscription tick can begin while it is still working through a large due-trigger set. Both ticks read the same stale `last_triggered_at`, both compute the same missed slots, and both publish them in section 2.5 — which has **no** `trigger_version` compare-and-swap. The live fire at step 4 is CAS-protected (only one tick wins), but the catch-up extras emitted earlier in the same iteration are not, so they double-publish.
- **Root cause**: The duplicate-fire defense (CAS on `trigger_version`) is applied only to the single live event, not to the N backfill events published before the claim. The authors' own comment at :1959 acknowledges overlapping ticks are expected.
- **Impact**: After downtime, catch-up slots can fire twice (duplicate executions). Bounded by `GLOBAL_BACKFILL_PER_TICK` but still 2× the intended catch-up volume.
- **Fix sketch**: Claim the trigger via `mark_triggered` (CAS) *first*; only if the claim wins, proceed to emit the backfill extras for that trigger. Or guard the backfill block behind a successful CAS on the current version.
- **Value**: impact=6 effort=4

## 5. Auto-backfill silently drops the OLDEST missed slots over `max_backfill`, with no user-visible "capped" signal
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: silent failure / undocumented limit
- **File**: src-tauri/src/engine/background.rs:1821-1824 (`drain(..oldest)`) ; :1628 (`slots.pop()` drops most-recent) — contrast user path `BackfillResult.capped` at src-tauri/src/commands/execution/scheduler.rs:79
- **Scenario**: A trigger with `max_backfill: 5` is offline for two days (48 missed hourly slots). On restart, `compute_missed_backfill_slots` caps at `BACKFILL_HARD_CAP`, then the tick keeps only the newest `cap-1 = 4` extras and `drain`s the rest — discarding ~43 missed runs. Unlike the user-initiated path (which returns `capped: true` so the UI warns), the automatic path emits only a `debug!` and the CronAgentCard shows a healthy "last <time>", giving the user no indication that most missed runs were dropped.
- **Root cause**: The "drop oldest beyond cap" behavior is an undocumented magic limit with no telemetry/health surface; combined with finding #1's watermark advance, the user cannot tell catch-up was partial or absent.
- **Impact**: Silent partial catch-up; missed scheduled work is discarded with no signal. Tribal-knowledge gap (`max_backfill` counts the live fire as 1, drops oldest, hard-capped at 100) is not exposed anywhere in the UI.
- **Fix sketch**: When extras are dropped, record a healing issue / per-trigger metric (mirroring `log_schedule_rate_limit_issue`) and expose a `backfill_dropped` count to `CronAgent` so the card can warn. Document `max_backfill` semantics in the trigger config docs.
- **Value**: impact=5 effort=3
