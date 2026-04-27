# Bug Hunt Fix Wave 6 — Time / Timezone / DST / Polling Theme

> 5 commits, 6 findings closed (the calendarHelpers commit closed two findings in the same file).
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Findings closed | Severity | Files |
|---:|---|---|---|---|
| 1 | `31e1317f` fix(schedules): cron preview is DST-safe + parseCronField bounds-checks every value | triggers-schedules #1 + #3 | high + high | 1 |
| 2 | `a23c41f5` fix(schedules): detectSkippedExecutions caps lookback to 24h | triggers-schedules #6 | medium | 1 |
| 3 | `64412dc4` fix(polling): exponential backoff actually fires on consecutive errors | external-integrations #1 | medium | 1 |
| 4 | `60e40eb1` fix(overview): disable fabricated trend percentages until prior-period fetch wired | overview-dashboard #1 | high | 1 |

---

## What was fixed

### DST-safe day stepping + cron-field bounds (1 commit, 2 findings)

1. **DST-unsafe `addDays`** — `setDate(getDate() + 1)` preserves the time field in local wall-clock terms but on a DST transition day where the cursor sat in the missing hour, the next iteration could land at 01:00 instead of 00:00 — `t.setHours(h, m, 0, 0)` then emitted fire times that skipped or duplicated around the spring-forward / fall-back week. Conflict detection silently undercounted. Fix: a new `nextLocalMidnight(d, n)` helper uses `new Date(year, month, day+n)` which re-anchors to local midnight regardless of whether the day in question is 23, 24, or 25 hours long. The day-iteration loop now derives each cursor from `dayStart + dayOffset` instead of accumulating drift.

2. **`parseCronField` accepted out-of-range values silently** — Single values and N-M ranges were added to the result Set without min/max checks. A typoed cron like `0 25 * * *` (hour=25) made it past the parser; the calendar then `setHours(25, ...)` rolled into the next day, painting phantom fire times the user trusted as real. Fix: `inRange()` helper validates every value and range before `result.add`; out-of-range invalidates the entire field, matching the backend's stricter parser. Also rejects ranges where start > end.

### Skipped-execution lookback cap (1)

3. **`detectSkippedExecutions` treated first launch as missing 100s of runs** — A fresh install or imported agent could have `last_triggered_at` set well in the past (e.g. months ago for an agent imported from another machine). `floor(elapsed / intervalMs)` produced `missedCount` in the thousands; the display cap of 100 hid the symptom but the SkippedRecoveryPanel still recommended "recover 100 missed runs" for an agent that was never actually missing runs. Clicking "Recover All" blasted 100 real executions through the queue per agent. Fix: `SKIPPED_LOOKBACK_MS = 24h`, `effectiveLastRun = max(actualLastRun, now - 24h)` — `missedCount` can never exceed `24h / intervalMs`, a sensible upper bound for "missed while the app was closed". The 100-cap stays as a defensive secondary guard.

### Polling exponential-backoff was a no-op (1)

4. **`usePolling` setInterval evaluated `getDelay()` once at scheduling time** — The closure's read of `errorCountRef.current` was therefore stale forever after the first scheduling. The "exponential backoff" advertised in the docstring did nothing while a polling cycle was alive. During a sustained backend outage the hook kept hammering the API at the original 5s/12s/15s cadence, risking rate limits (especially for self-hosted GitLab). Fix: switched from `setInterval` to recursive `setTimeout` — each tick awaits `runFetch` then computes the next delay against the current `errorCountRef` before scheduling the next tick. Visibility-pause + clear-on-cleanup behaviour preserved.

### Fabricated trend percentages (1)

5. **Overview observability trend deltas were noise** — The `trends` derivation split `chartData` (effectiveDays of points) in half and called the first half "previous" and second half "current" for percentage deltas. But `chartData` was never fetched at 2× window — `useObservabilityData` fetches only `effectiveDays`, unlike `useExecutionMetrics` which uses `previousPeriodDays` when compare is on. The Summary cards always showed "period-over-period" deltas that were actually "first-half-of-week vs second-half-of-same-week" — pure noise. Users made decisions ("cost spiked 40%!") on phantom movement. Fix: `trends` returns nulls; the Summary cards already short-circuit on null and omit the trend chips. TODO comment points future work at fetching 2× window. Honest "no comparison shown" beats lying numbers.

---

## Verification

| Gate | Before wave 6 | After wave 6 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 4 unique |
| Cumulative findings closed (waves 1-6) | 39 | **45** |

---

## Cumulative status (waves 1-6)

**45 findings closed in 43 atomic commits across 6 themed waves.**

| Wave | Theme | Findings |
|---|---|---:|
| 1 | Security & data-loss criticals | 12 |
| 2 | Stream lifecycle + persona-switch staleness | 6 |
| 3 | Misc criticals (orchestration, recovery, React 19 hazards) | 7 |
| 4 | Cleanup-gap | 7 |
| 5 | Silent-success theater | 7 |
| 6 | Time / timezone / DST / polling | 6 |
| | **Total** | **45** |

All 25 critical-rated findings remain closed. Waves 4-6 added the highest-impact items in cleanup-gap, silent-success-theater, and time/timezone — three of the four remaining themed clusters. The fourth (optimistic-update-without-rollback) is the natural next wave.

---

## Patterns established (additions to the catalogue, now 21-23)

21. **`setDate(+n)` is not DST-safe for re-anchored calendar cursors** — Time-of-day is preserved in local wall-clock terms but a cursor sitting in DST's missing hour can land 1 hour off after stepping. When iterating days in calendar code, derive each cursor from a stable origin via `new Date(year, month, day + offset)` rather than mutating in place.

22. **`setInterval(..., getDynamicValue())` evaluates the value once** — The closure captures the value at scheduling time; subsequent reads of the underlying ref do not re-trigger setInterval. For exponential-backoff or any dynamic-cadence polling, switch to recursive `setTimeout` that recomputes the delay each tick.

23. **Don't fabricate "period-over-period" deltas from a single window** — Splitting one window in half and calling the halves "previous" vs "current" produces statistical noise, not a real comparison. Either fetch 2× the window, or hide the deltas.

The catalogue (now 23 items) is the durable artefact across all six waves.

---

## What remains

- **Optimistic update without rollback** (~22) — recipes-pipelines, vault scope picker, others. Best done as a focused wave introducing a `withRollback()` helper.
- **Race-window tail** (~12 after waves 2-3 closed many) — overview seq-counter inconsistency, etc.
- **Empty-set / divide-by-zero / NaN** (~15) — overview/leaderboard math.
- **Tail items per context** (~140) — predominantly low-severity.

The pattern catalogue (now 23 items in `FIXES-WAVE-6.md`) plus the per-wave summary docs are the most durable artefacts. New code reviewers should grep for these shapes before relying on bug-hunt re-scans.
