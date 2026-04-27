# Bug Hunt — Triggers & Schedules

> Total: 14 | Critical: 1 | High: 6 | Medium: 5 | Low: 2

## 1. Cron preview generator silently produces wrong fire times across DST transitions

- **Severity**: high
- **Category**: timing-bug
- **File**: `src/features/schedules/libs/calendarHelpers.ts:97-135` (`generateCronFireTimes`)
- **Scenario**: A user creates a `0 9 * * *` (daily 9 AM) schedule. The week-view calendar spans the spring-forward DST Sunday. The day-walking loop uses `addDays(d, 1)` which calls `setDate(getDate() + 1)` on a `Date` whose internal time was set by `startOfDay` (00:00:00 local). On the DST jump day the resulting `Date` ends up at 01:00:00 local instead of midnight. Then `t.setHours(9, 0, 0, 0)` is called and the eventual emitted Date drifts: the loop also tests `t.getTime() < endMs` which can either skip a day or include it twice.
- **Root cause**: The "step day-by-day, then setHours" pattern assumes `setDate(+1)` is a wall-clock 24-hour add. It is not on DST-affected dates — `setDate` adjusts day field but the underlying epoch shift is 23 or 25 hours. Combined with the `startOfDay → addDays` cursor, fire times for cron expressions can disappear or duplicate around DST boundaries.
- **Impact**: Calendar shows missing or doubled future runs around DST. Conflict detection and `previewConflicts` (which also uses these fire times in `FrequencyEditor.tsx:41-53`) silently undercount or miscount conflicts during the transition week — the user trusts a "0 conflicts" verdict that is wrong.
- **Fix sketch**: Iterate via `new Date(year, month, day+i)` constructor (re-anchored) or convert to UTC for the day-iteration loop, then re-localize the wall-clock hour/minute at emit. Add explicit unit tests for spring-forward / fall-back week.

## 2. `previewConflicts` is O(C × E) per keystroke and freezes the UI on dense schedules

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/schedules/libs/calendarHelpers.ts:441-488` (`previewConflicts`) called from `FrequencyEditor.tsx:41-53`
- **Scenario**: User is editing the cron expression for an agent in `FrequencyEditor`. They have 30 existing schedule entries, several of which fire `*/5 * * * *` (every 5 minutes). Over 7 days that is `2016 × N` existing fire times. The user types a custom cron like `* * * * *` (every minute → 10,080 candidate times). `previewConflicts` runs synchronously inside `useMemo` on every keystroke, performing ~20 million `Math.abs` comparisons and blocking the input.
- **Root cause**: The function uses a naive nested loop `for (ct of candidate) for (et of existing)` even though both arrays are sorted — a two-pointer or binary-search approach would be O((C+E) log E). It also runs synchronously inside `useMemo`, with no debounce gate (`cronInput` updates on every keystroke).
- **Impact**: Typing in the cron input becomes janky/unresponsive when the workspace has many high-frequency schedules. On low-end machines this is a multi-second freeze.
- **Fix sketch**: (a) Two-pointer sweep on the sorted arrays. (b) Debounce the candidate cron string (already done for the API preview at line 61-68 — reuse that debounced value).

## 3. Cron field parser accepts out-of-range values silently — invalid expressions appear "valid" in calendar

- **Severity**: high
- **Category**: validation-gap
- **File**: `src/features/schedules/libs/calendarHelpers.ts:173-223` (`parseCronField`)
- **Scenario**: User types `0 25 * * *` (hour=25, invalid) or `0 0 32 * *` (day=32). The backend `previewCronSchedule` rejects it, but the calendar's local renderer (`generateCronFireTimes` at line 79) calls `parseCronField` which: for a single value `25` simply does `result.add(25)`; for a range like `25-30` it adds 25..30. None of these are checked against `min`/`max` bounds. Then `hours.has(h)` is iterated and `t.setHours(25, 0, 0, 0)` produces a Date that rolls into the next day.
- **Root cause**: Bounds (`min`, `max` parameters) are only respected for the wildcard branch and (partially) for stepped ranges. Single values and `N-M` ranges are added to the set without any range check.
- **Impact**: A typoed cron expression that the backend rejects can still produce phantom calendar events at unexpected wall-clock times — the user sees fictitious upcoming runs and may think the schedule is valid.
- **Fix sketch**: After every `result.add(v)`, validate `v >= min && v <= max` and return `null` (invalid field) if not. Reject ranges where `rStart > rEnd`.

## 4. `OVERDUE_TRIGGERS_FIRED` listener payload type lies — listener registered with wrong shape

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:114-117` and `src/lib/eventRegistry.ts:702`
- **Scenario**: `ScheduleTimeline` calls `listen<{ recovered: number; timestamp: string }>(EventName.OVERDUE_TRIGGERS_FIRED, ...)` directly via raw `listen()` from `@tauri-apps/api/event`. But the registry types this event's payload as `{ trigger_ids: string[] }`. The handler in `ScheduleTimeline` ignores the payload anyway, so no runtime crash — but the type mismatch means anyone reading either side gets contradictory information.
- **Root cause**: The component bypassed `typedListen` from the event registry, hand-rolling its own (incorrect) payload type.
- **Impact**: The Rust side currently emits `{ trigger_ids }` per the registry; if a future change relies on `payload.recovered`, that field will be `undefined` and refresh count UIs will silently render `undefined`. The bigger latent risk: this is the documented escape hatch from typed events, encouraging more drift.
- **Fix sketch**: Replace with `typedListen(EventName.OVERDUE_TRIGGERS_FIRED, ...)`. Or, since the bridge is the canonical surface, register this listener in `eventBridge.ts` instead and dispatch a refresh event via the store.

## 5. ScheduleTimeline visibility-gated effect leaves a 30s polling timer wired to a refresh that may run after unmount

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:72-125`
- **Scenario**: Component mounts → `isVisible` flips to true → effect installs `setInterval(scheduleRefresh, 30_000)` and a Tauri listener. User scrolls so the element leaves the viewport. `isVisible` becomes false → effect re-runs, the cleanup runs and sets `cancelled = true`. So far OK. But `unlistenP.then((fn) => fn())` is asynchronous: if the unmount races a Tauri listener that has just fired, the handler runs `if (!cancelled) scheduleRefresh()` but `cancelled` is captured in a stale closure of the *previous* effect run. Worse — the `pending = true` re-trigger inside `doRefresh().finally` (line 91-94) re-invokes `doRefresh` even after `cancelled=true`, since the `cancelled` check is only on the outer scheduling, not before the re-entrant call.
- **Root cause**: Re-entrancy guard at lines 91-95 doesn't re-check `cancelled` before recursing. After teardown the in-flight promise can resolve, see `pending=true`, and start another fetch — pushing data into `setSchedulerStats` of an unmounted component (warning) or wasting a network round-trip.
- **Impact**: Spurious "state update on unmounted component" warnings; one extra fetch per teardown race; possible toast spam if backend errors during the post-unmount fetch.
- **Fix sketch**: Add `if (cancelled) return;` before `doRefresh()` recursion at line 93. Also guard `setSchedulerStats` already present, but add the same guard to other state setters once added.

## 6. Skipped-execution detector treats the very first launch after install as "missed all the runs since 1970"

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/schedules/libs/scheduleHelpers.ts:121-154` (`detectSkippedExecutions`)
- **Scenario**: A user creates a brand-new agent with `interval_seconds = 60`. The backend persists the trigger but `last_triggered_at` is initially set to the trigger's creation time minus the interval (or the user imports an agent from another machine where last_triggered_at is months old). On the next render `elapsed > intervalMs * 1.5` is true and `missedCount = floor(elapsed / intervalMs) - 1` can be enormous (capped at 100 for display, but only because of the explicit `Math.min(missedCount, 100)`).
- **Root cause**: There's no "agent created within the last interval" sanity check, and no upper bound on `elapsed` relative to a sensible window (e.g., last 7 days). The 100-cap masks the symptom but the panel still recommends recovering 100 runs of an agent that was never properly scheduled.
- **Impact**: Shortly after import or first install, the SkippedRecoveryPanel suggests "recover 100 missed runs" for every interval-based agent, which — if the user clicks `Recover All` — fires 100 executions per agent through `batchRecover` in a tight loop, blowing through token budgets and user trust.
- **Fix sketch**: Skip detection if `(now - agent.created_at) < intervalMs * 2`. Cap `elapsed` to a fixed window (e.g., 24 hours) or compute `missedCount` from `max(lastRun, now - 24h)`. Confirmation dialog before batch recovery > 5 items.

## 7. `batchRecover` fires executions in a tight loop with no concurrency cap or backoff

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/schedules/libs/useScheduleActions.ts:120-146` (`batchRecover`)
- **Scenario**: Building on bug #6: user clicks "Recover Selected" with 50 agents queued. `batchRecover` iterates `for (const agent of agents)` and `await executePersona(...)` serially. If the backend `executePersona` is fast (10ms per call returning a queued execution_id), 50 are submitted in ~500ms — but this is to the *queue*, which then promotes them concurrently. The frontend has no cap, no inter-call delay, no progress UI per item.
- **Root cause**: Loop has no rate limiting and no abort signal. `setState` updates `recovering` for each agent in turn but there's no way for the user to cancel mid-batch.
- **Impact**: Token budget overrun, queue saturation, and (combined with bug #6) auto-firing of a runaway batch. Catch swallows individual errors silently — user only sees "Recovered N, failed M" with no detail on what failed or why.
- **Fix sketch**: Add `AbortController`, expose a Cancel button, throttle to e.g. 1 call per second, surface per-agent errors in a collapsible list. Consider checking budget *before* the batch, not just per-agent.

## 8. CompositePartialMatchIndicator polls every 4 seconds even when off-screen, with no visibility gate

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/triggers/sub_triggers/CompositePartialMatchIndicator.tsx:15-25`
- **Scenario**: A user opens the trigger detail drawer for a composite trigger, then collapses the drawer or scrolls away. The component remains mounted (because `expanded` toggles inner content but the parent list keeps rows mounted). The 4-second polling interval keeps firing `getCompositePartialMatch(triggerId)` IPC calls indefinitely.
- **Root cause**: No `useElementVisible` check, no document-visibility check, no exponential backoff when the indicator hasn't changed. Each composite trigger rendered = one extra IPC every 4 seconds, forever.
- **Impact**: With 20 composite triggers visible, that's 5 IPC calls per second to the Rust side. On a battery-powered laptop this prevents process sleep and drains battery. On a backend hiccup, all polls accumulate as queued IPC calls.
- **Fix sketch**: Use `useElementVisible` (already used in ScheduleTimeline) to gate polling, or rely on `document.visibilityState`. Backoff to 30s after 5 unchanged polls.

## 9. RadialCountdownRing's RAF animation uses `Date.now()` instead of `performance.now()` and never throttles when tab hidden

- **Severity**: low
- **Category**: timing-bug
- **File**: `src/features/triggers/sub_triggers/RadialCountdownRing.tsx:29-46`
- **Scenario**: User opens a tab with a countdown ring, switches tabs for 10 minutes (browser throttles RAF to ~1Hz). When they return, `Date.now() - startTimeRef.current` is huge, `currentRemaining` is correctly clamped to 0, but the RAF loop has been running 1×/s for 10 minutes, never reading a fresh `remaining` prop. If `total` is 60 and the trigger has fired 10 times in those 10 minutes, the ring is stuck showing `0` until the parent re-renders with fresh `remaining`.
- **Root cause**: `remaining` is captured into `startRemainingRef.current` only when the prop changes (line 26), but the RAF loop only reads `total` and `firing` from its dependency array. New parent updates that change `remaining` re-trigger the first effect, but if the parent doesn't re-render (because the trigger is paused), the ring is frozen at 0 forever.
- **Impact**: Cosmetic — ring shows wrong state until next parent update. No data loss. Notable mostly because Date.now is wall-clock, so a system clock change (NTP sync) can cause the ring to jump.
- **Fix sketch**: Use `performance.now()` (monotonic). Cancel RAF when `document.hidden`, restart on `visibilitychange`. Or read `remaining` directly via ref each frame.

## 10. ActiveHoursSection silently drops invalid timezone strings — no validation, no feedback

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/triggers/sub_triggers/ActiveHoursSection.tsx:222-235`
- **Scenario**: User types "EST" or "America/New_Yrok" (typo) into the timezone input. The change handler stores the literal string in `aw.timezone` without any IANA validation. The "displayed timezone" label echoes back the typo. The backend then either silently falls back to UTC (silent corruption) or rejects the trigger config on save (delayed failure).
- **Root cause**: The input is free-text. There's no `Intl.supportedValuesOf('timeZone')` lookup, no fuzzy match, no error state. `resolvedTimezoneLabel(tz)` literally returns the user's typo unmodified.
- **Impact**: User sets active-hours window with an invalid TZ, thinks "9 AM EST" is configured, but the trigger fires (or doesn't fire) at unexpected times. Silent because there's no surface for the IANA validation error.
- **Fix sketch**: Replace text input with a combobox seeded from `Intl.supportedValuesOf('timeZone')`. Validate on blur; show an inline "unknown timezone" error when invalid. Persist `undefined` if invalid rather than the bad string.

## 11. ActiveHoursSection time-input parsing crashes on browser-localized empty/partial values

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/triggers/sub_triggers/ActiveHoursSection.tsx:198-216`
- **Scenario**: User clears the time input (Firefox allows empty string from `<input type="time">`). `e.target.value` is `""`. Then `"".split(':').map(Number)` = `[NaN]`. Destructured as `[h, m]` → `h = NaN`, `m = undefined`. `update({ start_hour: NaN, start_minute: undefined })` writes garbage into config. Subsequent renders display `NaN:NaN` and the saved config is unparseable on the backend.
- **Root cause**: No guard against empty or malformed time string. `Number(undefined)` is `NaN`, and the schema doesn't reject it.
- **Impact**: Trigger silently corrupts on edit; loading the trigger again shows broken UI. Reproduces consistently in browsers that allow empty time inputs.
- **Fix sketch**: `if (!e.target.value) return;` plus `if (isNaN(h) || isNaN(m)) return;` before calling `update`.

## 12. `cronDebounceRef` cleanup in TriggerAddForm clears wrong timer when triggerType changes mid-debounce

- **Severity**: low
- **Category**: race-condition
- **File**: `src/features/triggers/sub_triggers/TriggerAddForm.tsx:69-74`
- **Scenario**: User is on `triggerType === 'schedule'` + `scheduleMode === 'cron'`, types a cron expression, then quickly switches `triggerType` to `polling` before the 400ms debounce fires. Effect re-runs: the new effect early-returns at line 70 because `triggerType !== 'schedule'`. The cleanup of the *previous* effect run runs `clearTimeout(cronDebounceRef.current)` — but `cronDebounceRef.current` may have been overwritten by the previous setTimeout call already, and the cleanup of the new effect (which was a no-op) never clears it. Race window is narrow but it leaks one timer that calls `fetchCronPreview(cronExpression)` on a triggerType that no longer wants it.
- **Root cause**: Single shared ref for the timer, with cleanup logic that only matches the most recently scheduled timer. When the early-return path is taken, no setTimeout was scheduled in that effect run, so the cleanup function (which only clears `cronDebounceRef.current`) clears whatever the previous run wrote — usually correct, but the ordering of "set ref → schedule next effect → clear ref" can leave a dangling pending preview.
- **Impact**: One stray IPC call after switching trigger type. Silent. Sets `cronPreview` state for a trigger type the user has abandoned, briefly showing stale schedule preview before the next render.
- **Fix sketch**: Always clear in cleanup unconditionally, set ref to null after clearing. Ideally use a local timer variable inside the effect, not a ref.

## 13. WeekView `nowHour` is captured at mount and never updates — current-hour highlight goes stale

- **Severity**: low
- **Category**: timing-bug
- **File**: `src/features/schedules/components/WeekView.tsx:34-35`
- **Scenario**: User opens the calendar at 4:55 PM. `nowHour = 16` is computed at component render. They leave the tab open across the hour boundary. At 5:30 PM, `nowHour` is still 16 (because the component only re-renders when `anchor`/`events`/etc. change). The blue "current hour" indicator stays on the 4 PM row.
- **Root cause**: No interval to refresh "now". Because `events` is recomputed via `useMemo` on `anchor` change, the parent rarely re-renders unless data changes.
- **Impact**: Cosmetic — blue indicator drifts behind real time until the user navigates or data refreshes. Confusing during long live monitoring sessions.
- **Fix sketch**: `useEffect` with `setInterval(() => setNow(Date.now()), 60_000)`, store `now` in state.

## 14. updateFrequency overwrites entire trigger config — `active_window`, `rate_limit`, and other settings silently lost

- **Severity**: critical
- **Category**: state-corruption
- **File**: `src/features/schedules/libs/useScheduleActions.ts:53-80` (`updateFrequency`)
- **Scenario**: User has a scheduled agent with cron `0 9 * * *` plus an `active_window` (weekdays 9–18 in NY tz) plus a `rate_limit` (max 10/hour). They open `FrequencyEditor` and change the cron expression to `0 10 * * *`. `useScheduleActions.updateFrequency` builds `configObj = { type: 'schedule', cron: newCron }` and calls `updateTrigger(...)` with `config: JSON.stringify(configObj)`. The new config replaces the old one entirely — `active_window` and `rate_limit` are gone from the persisted config.
- **Root cause**: The function constructs the new config from scratch with only the schedule fields, ignoring the existing config blob. There is no read-modify-write merge.
- **Impact**: Major data loss for any agent with active hours, rate limits, or any other config field. The user sees a successful "Updated schedule" toast and has no indication that their carefully-tuned active-hours and rate limits were just wiped. Triggers may now fire 24/7 when they should be confined to business hours, blowing budgets and triggering off-hours notifications.
- **Fix sketch**: Read the existing trigger config (already available via `agent.config` or via a `usePipelineStore` lookup), parse, spread it, then overwrite only `cron` / `interval_seconds` / `type`. Or accept a `Partial<...>` patch on the backend rather than a full config replacement.
