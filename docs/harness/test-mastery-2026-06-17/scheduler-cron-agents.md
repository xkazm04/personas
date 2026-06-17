# Test Mastery — Scheduler & Cron Agents
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. User-initiated `backfill_schedule` skips budget / hourly-cap / active-window guards the auto path enforces
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/execution/scheduler.rs:98-209 (publish loop 156-187)
- **Current test state**: none (no `#[cfg(test)]` module in this command file at all)
- **Scenario**: The auto-backfill loop in `engine/background.rs` (lines 1759-1814) re-checks the persona monthly budget per slot, enforces `schedule_hourly_cap_exceeded`, and filters each slot through `trigger.is_within_active_window(*slot)`. The user-initiated `backfill_schedule` command runs the same fan-out (`compute_slots_in_range` → `event_repo::publish` per slot) but applies NONE of these three guards. A user clicking "backfill last 7 days" on an every-15-min schedule can publish up to 100 execution events that (a) blow past the persona's monthly budget cap, (b) ignore the active-window restriction (e.g. business-hours-only personas firing at 3am), and (c) bypass the scheduler's hourly rate ceiling. Today no test asserts that a user backfill respects budget/window — the behavior could silently diverge further or regress with zero test signal.
- **Root cause**: The command was written as a parallel implementation of the auto path (the code comments even acknowledge it "mirrors" `synthesize_backfill_payload`) but the guard logic was not ported, and there is no test pinning the expected guard set. The whole command module is untested.
- **Impact**: Real money: a single backfill click can exhaust a persona's monthly budget and trigger off-hours execution storms, defeating the spend controls and active-window constraints users explicitly configured. This is execution/scheduling + billing-metering blast radius.
- **Fix sketch**: Add a `#[cfg(test)]` module (or a Tauri-command integration test against an in-memory pool) that seeds a schedule trigger with (1) a monthly budget already exhausted and (2) a restrictive `active_window`, then asserts `backfill_schedule` enqueues 0 events for out-of-window/over-budget slots. Invariant to assert: **user-initiated backfill never publishes a slot the auto-scheduler would have suppressed.** This test will FAIL today (driving the fix) — which is the point.

## 2. `compute_slots_in_range` interval branch divides by zero / can spin on tiny intervals — no boundary tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/scheduler.rs:150-163
- **Current test state**: exists-but-weak (interval test only covers the happy `600s` case; the `secs == 0` guard at line 154 has no test)
- **Scenario**: The interval branch guards `*secs == 0` (returns empty) but there is no test proving it. More importantly, a `1`-second interval over a 7-day user backfill window relies solely on the `cap` to terminate — if the cap probe (`BACKFILL_MAX_SLOTS_PER_REQUEST + 1`) ever regressed to 0 or the cap logic changed, the `while t <= end` loop would push ~600k slots. The cap-at-max test (`test_compute_slots_in_range_caps_at_max`) only covers the cron branch, never the interval branch.
- **Root cause**: Interval branch tests assert only the nominal slot count; the zero-guard and the cap-termination on the interval path are untested edges.
- **Impact**: A regression in the zero-guard or cap on the interval path enqueues a runaway number of execution events (cost + DB pressure) with no test to catch it.
- **Fix sketch**: Add `compute_slots_in_range` tests: `interval_seconds: 0` returns empty; a 1s interval over a large window truncates to exactly `cap`; and the cron-branch and interval-branch both honor `max_slots`. Invariant: **slot count is always ≤ min(max_slots, BACKFILL_HARD_CAP), and 0 when interval==0.**

## 3. DST spring-forward gap & fall-back overlap in `next_fire_time_in_zone` are claimed-safe but untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/cron.rs:468-534 (with_*().and_then fall-through), next_fire_time_in_tz:551-557
- **Current test state**: exists-but-weak (tz tests cover EDT, EST, UTC-identity, and a UTC-day-boundary in Tokyo — none crosses a DST transition)
- **Scenario**: The doc comment claims "`with_*` calls return `Option` so DST gaps (non-existent local times) fall through to minute-level advancement instead of panicking." Nothing tests this. On a US spring-forward day a cron `30 2 * * *` names a wall-clock time (02:30) that does not exist; on fall-back, `0 1 * * *` exists twice. The current tests would not catch a regression that either panics (`.unwrap()` reintroduced) or fires at the wrong instant / skips the day. This is the exact class of bug the C5-handoff timezone regression (already memorialized in test_next_fire_in_tz_handoff_case_edt) came from.
- **Root cause**: Timezone tests were added reactively for one incident (EDT offset) but the harder DST-gap/overlap cases — the actual failure mode the code comments defend against — were never written.
- **Impact**: Scheduled personas silently skip a run or fire at the wrong hour twice a year, in production, on every persona with a DST-observing timezone. Hard to debug after the fact; invisible without a test.
- **Fix sketch**: Add `next_fire_time_in_tz` tests around a real transition, e.g. America/New_York on 2026-03-08 (spring forward) with cron `30 2 * * *` — assert it resolves to a real UTC instant (not a panic, not a skipped day), and a fall-back case `0 1 * * *` on 2026-11-01 asserting exactly one fire. Invariant: **next_fire is always a real, strictly-increasing UTC instant across DST boundaries.**

## 4. `validate_min_interval` wrap-around gap math is untested at the boundary
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/cron.rs:235-265 (wrap-around: `min_gap.min(60 - last + first)`)
- **Current test state**: exists-but-weak (`test_every_minute_matches_minimum_interval` passes `* * * * *` which short-circuits at `minute_count <= 1`/`min_seconds <= 60`; the wrap-around branch never executes because `MIN_CRON_INTERVAL_SECONDS == 60`)
- **Scenario**: The function computes the minimum gap between fires *including the wrap from the last minute back to the first* (line 256). With the production constant of 60s this guard is effectively inert (it only rejects sub-minute, which 5-field cron can't express). But the math is real and load-bearing for any future tightening of `MIN_CRON_INTERVAL_SECONDS`. A cron like `0,59 * * * *` has a 1-minute wrap gap; `0,30 * * * *` has 30. No test pins either, so the wrap arithmetic could be off-by-one and nobody would know.
- **Root cause**: Tests exercise `parse_field` heavily but never call `validate_min_interval` with a `min_seconds` high enough to trip the gap logic, so the most error-prone line (the modular wrap) has zero coverage.
- **Impact**: If the minimum interval is ever raised (a plausible product change to throttle abuse), a buggy wrap calculation would either wrongly reject valid schedules or wrongly admit too-frequent ones — and the existing suite would stay green.
- **Fix sketch**: Test `validate_min_interval` directly with an elevated `min_seconds` (e.g. 300): assert `0,30 * * * *` (30-min min gap) is rejected, `0 * * * *` is accepted, and `0,59 * * * *` is rejected via the *wrap* gap (59→0 = 1 min). Invariant: **reported min gap equals the true minimum including the 59→next-hour wrap.**

## 5. Pure cron-agent UI helpers `formatInterval` / `formatRelative` have zero tests (LLM-generatable)
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/overview/sub_cron_agents/libs/cronHelpers.ts:1-25
- **Current test state**: none
- **Scenario**: These two pure functions render every cron agent's schedule and next/last-fire labels. They have boundary behavior worth pinning: `formatInterval` switches units at 60 / 3600 / 86400 (e.g. 90s → "2m" via rounding, 59s → "59s"); `formatRelative` distinguishes past/future, "just now" vs "in <1m", and rounds m/h/d. A regression (wrong threshold, dropped suffix) would mislabel every schedule in the UI. `formatRelative` also reads `Date.now()`, so a naive test is non-deterministic — fix by injecting/freezing time with `vi.useFakeTimers()`.
- **Root cause**: Pure presentational helpers were never given a spec; the suite has rich coverage for matrix/lab helpers but skipped this folder.
- **Category note**: Ideal LLM batch — pure in/out, no mocks beyond a frozen clock.
- **Impact**: User-facing mislabeling of schedules and fire times across the entire Cron Agents page; low blast radius but high visibility.
- **Fix sketch**: Generate a `cronHelpers.test.ts` table-driven batch with `vi.useFakeTimers()` pinned to a fixed `now`. Assert the unit-threshold boundaries (59/60/3599/3600/86399/86400 s) and past/future + "just now"/"in <1m" branches. Invariant to assert (not snapshot): **each output reflects the correct unit bucket and tense for its input** — pick exact expected strings, do not snapshot.

## 6. `CronAgentCard` health-color/icon logic and `AgentRow` schedule fallback are untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/overview/sub_cron_agents/components/CronAgentCard.tsx:21-46
- **Current test state**: none
- **Scenario**: `AgentRow` computes `failureRate`, then maps it to a health color and icon across five branches (disabled → Pause; zero executions → Clock; 0 failures → green CheckCircle; <0.6 → amber AlertTriangle; else red XCircle), plus a 3-way `schedule` fallback (cron expr → interval → "no schedule") and a timezone label defaulting to "local". The 0.6 threshold and the disabled-takes-precedence ordering are business rules a regression could silently invert (e.g. showing green for a failing agent). None of this is asserted.
- **Root cause**: Component logic was embedded in JSX with no extraction or render test; the project has render-test infra (see cockpit widget `__tests__`) but this card was skipped.
- **Impact**: Operators misread fleet health at a glance — a red (mostly-failing) agent rendered green/amber hides a broken scheduled persona.
- **Fix sketch**: Either extract the color/icon/schedule derivation into a pure helper and unit-test the branch boundaries (failureRate exactly 0, just below/above 0.6, disabled overriding execution state), or render `AgentRow` with crafted `CronAgent` fixtures and assert the icon + class. Invariant: **disabled state overrides health; failureRate≥0.6 is red; the 0.6 boundary is amber-vs-red as specified.**

## 7. `BackfillModal` future-window clip warning vs. backend clipping not asserted
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/schedules/components/BackfillModal.tsx:47-65
- **Current test state**: none
- **Scenario**: The modal computes `validRange` and `windowInFuture` and submits `startDate.toISOString()`/`endDate.toISOString()`. The backend (`backfill_schedule`) clips `end` to `now` and rejects windows that cover no past time. The modal warns about a future window but still submits the unclipped end. A regression where `validRange` lets `end <= start` through, or where the future warning stops showing, would degrade UX and rely entirely on the backend to reject — with no frontend test covering the contract.
- **Root cause**: New modal added without a render/interaction test; date-boundary logic uses `Date.now()` so it also needs frozen time for determinism.
- **Impact**: Minor — backend is the real guardrail — but the warning-vs-submit contract could drift unnoticed.
- **Fix sketch**: Render with `vi.useFakeTimers()`; assert the invalid-range banner appears when end ≤ start and the submit button is disabled, and that the future-clip warning shows when end > now while still allowing submit. Invariant: **submit is disabled iff `!validRange`; future warning is shown iff end > now.**
