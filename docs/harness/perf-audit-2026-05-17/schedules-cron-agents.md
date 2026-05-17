# Perf-Optimizer Scan — Schedules & Cron Agents

> Project: Personas (frontend-only)
> Scope: 4 paths in src/
> Total: 6 findings (1C / 3H / 1M / 1L)

## Scope notes

- Read all 13 source files in scope (10 components + 3 libs across schedules/) plus the 4 files in `overview/sub_cron_agents/`.
- Two duplicate `CronAgentsPage` files exist at `src/features/overview/sub_cron_agents/CronAgentsPage.tsx` and `.../components/CronAgentsPage.tsx`. The `index.ts` only exports the `components/` one; the sibling is dead code (out of scope for perf but worth noting — it ships in the bundle if anything else imports it).
- Scheduler logic / cron parsing live in Rust (`engine/cron.rs`); the frontend only fetches fire-times via the `cron_fire_times_in_range` IPC — analysis assumes those IPC calls are non-trivial (>10ms each, network/UI bridge).
- Call-site grep: `ScheduleTimeline` is lazy-loaded by `personas/PersonasPage.tsx`. `SidebarLevel2.SchedulesSidebarNav` subscribes to the same `cronAgents` slice and broadcasts persona filter via a `CustomEvent`. No sibling panel duplicates the `listCronAgents` IPC.

## 1. N×M IPC fan-out + entire calendar event-set rebuild on every navigation/legend toggle
- **Severity**: critical
- **Category**: data-layer
- **File**: `src/features/schedules/libs/useCronPreview.ts:153` (`useCalendarEvents`) and `src/features/schedules/components/ScheduleCalendar.tsx:60`
- **Scenario**: Calendar view with N schedules in the system. User clicks "next week", flips between week/month, or toggles a legend chip.
- **Root cause**: `useCalendarEvents`'s `useEffect` deps are `[entries, startMs, endMs]`. The `entries` array is rebuilt every render in `ScheduleTimeline` (line 123–127: `cronAgents.map(parseScheduleEntry)` returns a new array — `parseScheduleEntry` also creates fresh `Date` objects, so reference equality fails every render). Each effect fire launches `entries.length` parallel `cron_fire_times_in_range` IPC calls. On top of that, week→month navigation calls `setAnchor`, which recomputes `range` (new `Date` objects → new `startMs/endMs` only if value differs, but the `entries` reference churn means the effect re-fires on *any* parent re-render).
- **Impact**: With N=20 schedules, every parent re-render in `ScheduleTimeline` (30s poll, OVERDUE event, persona filter, legend toggle) fires 20 IPC round-trips and rebuilds the full event list. The 30s poll alone guarantees a 20-IPC storm every 30 seconds on the calendar view; opening the calendar view *while* data is loading guarantees double-fetch.
- **Fix sketch**: Memoize `entries` reference stability — either move `parseScheduleEntry` results into the store, or wrap the `entries` derivation so it returns the same array reference when `cronAgents` reference is unchanged (compare by `agent` identity). Cache fire-times by `(trigger_id, cron, timezone, startMs, endMs)` in a ref-keyed map so the legend/filter toggles don't re-IPC. Add a per-entry `useMemo` of the IPC promise keyed on its own inputs.

## 2. WeekView rebuilds the entire 24-hour×7-day slot grid on every event toggle
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/schedules/libs/calendarHelpers.ts:85` (`buildWeekGrid`) called from `src/features/schedules/components/WeekView.tsx:29`
- **Scenario**: User toggles a legend chip ("projected" off/on) on a calendar with hundreds of fire-times (e.g. a `*/5 * * * *` agent over 7 days = 2016 events).
- **Root cause**: `buildWeekGrid` allocates `7 days × 24 hours = 168` HourSlot objects + a Map every call, then linearly walks the entire `events` array calling `dayKey(ev.time)` and `ev.time.getHours()` for every event. `useMemo` deps are `[anchor, events]` — every legend toggle creates a new `events` array (line 68–75 of `ScheduleCalendar.tsx`), invalidating the memo. The same `events` array also drives `detectConflicts` (O(N log N) sort + sweep) which re-runs on every toggle even though `allEvents` is the input — actually `detectConflicts` is memoized on `allEvents` so that one is fine, but `buildWeekGrid` runs over the *filtered* set every legend click.
- **Impact**: With a few hundred fire-times, each legend click triggers a 168-slot Map rebuild + linear scan; with 2k+ events the click latency becomes visible. `activeHours` (line 38–54) does another O(events) sweep with `Math.min/Math.max` spread on the Set — fine at small N, but doubles the work.
- **Fix sketch**: Either (a) compute the day/hour bucket on the *unfiltered* `allEvents` once and apply legend filter at render time per cell, or (b) move the grid up to `ScheduleCalendar` and pass the bucketed structure to both views. Replace `Math.min(...set)`/`Math.max(...set)` with a single-pass reducer.

## 3. MonthView uses `day.events.find` (O(D·E)) for event placement + `Date.toISOString()` as React keys
- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/schedules/libs/calendarHelpers.ts:137` (`buildMonthGrid`) and `src/features/schedules/components/MonthView.tsx:52`
- **Scenario**: Month view with a busy calendar (e.g. 5–10 schedules × 30+ days of fire times = hundreds-to-thousands of events).
- **Root cause**: `buildMonthGrid` does `for (const ev of events) { const day = days.find((d) => isSameDay(d.date, ev.time)); ... }` — that's O(events × 42 days) with a `Date` getter comparison inside `isSameDay` per probe. Should use the same `dayKey`-indexed map as `buildWeekGrid`. Separately, the row `key={day.date.toISOString()}` (line 52) allocates a fresh string on every render and is brittle vs. timezone behavior; `dayKey(day.date)` is already computed two lines later. Each `EventBlock` also rebuilds an inline `kindStyles` object literal (EventBlock.tsx:17) on every render — N events × per-render allocation.
- **Impact**: At 500 events × 42 day cells that's 21k `isSameDay` calls per recompute, repeated on every legend toggle / range change. The toISOString key triggers React to potentially diff differently when a `Date` is re-instantiated for the same calendar cell.
- **Fix sketch**: Build a `Map<dayKey, CalendarDay>` once at the top of `buildMonthGrid` and look up by key in O(1). Switch month-cell keys to `dayKey(day.date)`. Hoist `kindStyles` out of the EventBlock body (module-level const) and `React.memo` the EventBlock — `event.kind`, `compact`, `color`, `hasConflict` are all primitives/stable.

## 4. `now`/`today`/`nowHour` recomputed via `new Date()` on every render
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/schedules/components/WeekView.tsx:34-35` and `src/features/schedules/libs/calendarHelpers.ts:122` (`buildMonthGrid`)
- **Scenario**: Calendar view in any state.
- **Root cause**: `WeekView` calls `startOfDay(new Date())` and `new Date().getHours()` outside any memo on every render. `buildMonthGrid` computes `const today = startOfDay(new Date())` on every call — fine because it's memoized via `useMemo` upstream, but combined with finding #1 (the memo invalidates) it runs frequently. `formatRelative` (cronHelpers.ts:8) is called in render paths for every `ScheduleRow` (twice — next and last) and in the sparkline tooltip; with the 30s poll, every poll cycle re-renders the list and re-calls `formatRelative` N times. Not a hot spot at small N but rises with schedule count.
- **Impact**: A few thousand wasted `new Date()` / `Date.getTime()` calls per render cycle; below threshold for jank but constant overhead under polling.
- **Fix sketch**: Memoize `today` / `nowHour` via `useMemo(() => ..., [anchor])` so they refresh only when navigation happens. Consider a single shared "now tick" ref incrementing once per poll so all relative-time labels share the snapshot.

## 5. 30s polling + OVERDUE_TRIGGERS_FIRED listener attached unconditionally on the schedules page
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:67-120`
- **Scenario**: User navigates to schedules, then to another tab; or schedules tab is in a stacked layout.
- **Root cause**: The poll/event-listener effect is gated by `isVisible` (line 68 `if (!isVisible) return`), which is good. But `useElementVisible` is an `IntersectionObserver` wrapper — the schedules page is the *only* render in its content slot, so `isVisible` flips to false only when the container is detached from the DOM, which doesn't happen with React's typical conditional rendering (the parent unmounts it). Net effect: while the tab is mounted (even if hidden behind other UI in a stacked layout), the 30s poll runs and `fetchCronAgents()` keeps firing. Each tick also calls `getSchedulerStatus()` regardless of whether the user is interacting. There's also no `document.visibilityState` check — the poll runs while the window/tab is backgrounded.
- **Impact**: With many schedules, every 30s the list IPC fires + scheduler status IPC fires + the calendar view (if active) fan-outs N more IPC calls (see #1). When the app is backgrounded it keeps polling indefinitely.
- **Fix sketch**: Add a `document.visibilityState === 'visible'` gate to the poll tick. Confirm `useElementVisible` returns false when the schedules view isn't mounted into the active layout (likely already true via unmount). Consider exposing a single store-level "schedules polling" coordinator so the sidebar (which also subscribes to `cronAgents`) shares one fetch.

## 6. `existingEntries` prop on `ScheduleRow` re-triggers `useConflictPreview` on every parent state change
- **Severity**: low
- **Category**: duplicate-call
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:149` and `src/features/schedules/libs/useCronPreview.ts:288-393`
- **Scenario**: User opens any `FrequencyEditor` modal — `useConflictPreview` is mounted with the full live entries list.
- **Root cause**: `ScheduleTimeline` passes `existingEntries={entries}` to every `ScheduleRow` (line 149). When the editor is open, `useConflictPreview` runs the signature-string serialization (`existingEntries.map(...).join('::')`, line 301–304) over every entry on every render — and the input array reference churns (see #1). The signature trick correctly avoids re-firing the IPC fan-out when only health changes, but the string concat itself runs each render. More importantly, the hook fires N parallel `cron_fire_times_in_range` IPCs every time the user types in the cron input (debounced to 300ms via state, but the `useEffect` actually runs immediately on each candidate change because there's no debounce on `candidateCron`).
- **Impact**: Opening the editor on a project with 30+ schedules issues 30 IPC calls per keystroke (after the candidate validates). Small surface today but scales linearly with schedule count.
- **Fix sketch**: Debounce `candidateCron` input before passing into `useConflictPreview`. Cache the existing-entries fire-times keyed on signature so subsequent candidate edits reuse them. Memoize the signature computation.
