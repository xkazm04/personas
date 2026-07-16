# schedules (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 4 | Missing: 0

## 1. useConflictPreview fires N parallel IPC calls per keystroke — no debounce, and unstable `existingEntries` in deps defeats the `sig` guard
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/schedules/libs/useCronPreview.ts:387
- **Scenario**: In FrequencyEditor, every character typed into the custom cron field (FrequencyEditor.tsx:56 passes `cronInput.trim()` directly) re-runs the effect, which issues 1 candidate + N existing-entry `cron_fire_times_in_range` IPC calls (up to 500 fire times each). It also re-runs on any parent re-render that recreates the entries array.
- **Root cause**: Two compounding issues: (a) unlike `useCronPreview` (300ms debounce), `useConflictPreview` has no debounce; (b) the effect dep array at line 387 includes both the carefully-built `sig` string AND the raw `existingEntries` array — the comment at lines 299-300 says `sig` exists precisely so "re-renders from health updates do not churn the IPC fetches", but including the array identity makes `sig` pointless.
- **Impact**: Typing a 15-character cron expression against 10 schedules fires ~150 IPC round-trips plus repeated 500-element Date parses and the O(candidate x existing) scan — measurable input lag and wasted backend work on an interactive hot path.
- **Fix sketch**: Remove `existingEntries` from the dep array (read it via a ref inside the effect, keyed by `sig`), and debounce the effect body the same way `useCronPreview` does (setTimeout ~300ms with the existing reqId staleness guard). Both patterns already exist in this file; this is alignment, not new machinery.

## 2. detectConflicts double-counts events across overlapping sweep windows and does O(n^2) slice/Set allocation
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: quadratic-and-overcount
- **File**: src/features/schedules/libs/calendarHelpers.ts:215-243
- **Scenario**: ScheduleCalendar runs `detectConflicts(allEvents)` over the full unfiltered window (week view: up to 500 fire times per agent x N agents). With a dense cluster (e.g. several agents on `*/5 * * * *`), every index `i` inside a qualifying window re-slices `[windowStart..i]`, rebuilds a Set, and re-increments `byHourCell`/`byDayCell` for ALL events already counted in the previous iteration.
- **Root cause**: The sweep emits a group per event index instead of per maximal window: for a window of k conflicting events, the increment loop at lines 230-240 runs for every `i`, so an event at `windowStart` is counted up to k-1 times; `byEventId` is also overwritten with successively larger overlapping groups. Total work is O(n^2) in cluster size, with an allocation per step.
- **Impact**: Hot-path calendar recompute is quadratic in dense schedules, and the hour/day badge counts shown in week/month cells are inflated (a 3-event window reports 6 in `byHourCell`, not 3) — visible wrong numbers, not just wasted cycles.
- **Fix sketch**: Emit a group only when the window closes: track the current maximal window; when `windowStart` advances past it (or the loop ends), finalize the accumulated `[start..end]` range once — one slice, one Set check, one increment pass per event. Keeps the same return shape; O(n) total.

## 3. Per-entry fire-time resolution is duplicated between useCalendarEvents and useConflictPreview
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/schedules/libs/useCronPreview.ts:174-204
- **Scenario**: Both hooks contain the same ~25-line block: skip paused entries, cron -> `cronFireTimesInRange(expr, tz ?? undefined, start, end, 500, trigger_id)` with a swallow-to-`[]` catch, interval -> `generateIntervalFireTimes(...)`, else `[]` (lines 174-204 vs 341-367).
- **Root cause**: `useConflictPreview` was added after `useCalendarEvents` and inlined the same resolution logic instead of extracting it.
- **Impact**: Any change to fire-time semantics (cap, timezone default, error surfacing — the silent `catch { return [] }` is a likely future fix) must be made twice; the two blocks have already micro-diverged (`entry.health === 'paused'` check placement, `Number(...)` coercion).
- **Fix sketch**: Extract `async function entryFireTimes(agent: CronAgent, start: Date, end: Date): Promise<Date[]>` in this file and call it from both `Promise.all` maps. Pure mechanical consolidation, no behavior change.

## 4. ScheduleActionState.cronPreview is written but never read — dead state that re-renders every consumer
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/schedules/libs/useScheduleActions.ts:19
- **Scenario**: `previewCron` (line 251) both returns the preview AND stores it in `state.cronPreview`. Grep across src/ shows no reader of this hook's `cronPreview` field — ScheduleTimeline consumes only `previewCron` (passing it down as `onPreviewCron`) and `state.lastBackfill`; the `s.cronPreview` hit in features/triggers/buildTriggerConfig.ts is a different store.
- **Root cause**: Callers migrated to using `previewCron`'s return value directly; the state mirror was never removed.
- **Impact**: Every preview call triggers two extra `setState`s, re-rendering ScheduleTimeline (and every row under it) for data nobody displays; the field also misleads readers into thinking preview state is centralized here.
- **Fix sketch**: Delete `cronPreview` from `ScheduleActionState` and the two `setState` calls in `previewCron`, keeping the returned value. Verify no cross-context consumer first (grep found none), then drop the now-unused `CronPreview` type import.

## 5. useConflictPreview conflict counting is O(candidate x existing) linear scan over sorted data
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: algorithm
- **File**: src/features/schedules/libs/useCronPreview.ts:375-384
- **Scenario**: With a dense candidate (`*/5` -> ~500 capped fire times over 7 days) and 10 existing schedules (up to 5000 merged times), the nested loop performs up to ~2.5M `getTime()` comparisons on the main thread per invocation — and per keystroke until finding #1 is fixed.
- **Root cause**: `existingTimes` is already sorted (line 369) but the inner loop scans linearly from index 0 for every candidate instead of binary-searching or advancing a two-pointer (candidateTimes are also ascending).
- **Impact**: Bounded but real main-thread stalls (tens of ms) during interactive frequency editing on schedule-heavy installs; trivially avoidable given both arrays are sorted.
- **Fix sketch**: Two-pointer merge: advance an index into `existingTimes` while `et < ct - WINDOW`, then check the next element against `ct + WINDOW`. O(n + m) total, ~10 lines.

## 6. Dead `export type { CronAgent }` re-export with a stale migration comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/schedules/libs/useCronPreview.ts:266-269
- **Scenario**: The re-export claims to exist "until the `previewConflicts` migration to IPC" and to avoid forcing "every consumer to re-import" — but calendarHelpers.ts:248 records that migration as completed 2026-05-01, and grep shows zero files import `CronAgent` from this module (all consumers use `@/lib/bindings/CronAgent`).
- **Root cause**: Migration-era scaffolding never cleaned up; the comment's stated reason no longer holds.
- **Impact**: Pure noise — a misleading tombstone plus a phantom public export that suggests this module owns the type.
- **Fix sketch**: Delete lines 266-269. The `import type { CronAgent }` at line 3 is otherwise unused in this file too (the hooks reference it only via `ScheduleEntry.agent`), so the import goes with it.
