# hooks/realtime — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 2 medium / 3 low)
> Context group: Core Libraries & State | Files read: 12 | Missing: 0

## 1. `stats` memo has empty deps — realtime stats panel is frozen at the initial empty snapshot
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: stale-memo
- **File**: src/hooks/realtime/useRealtimeEvents.ts:143
- **Scenario**: Open the realtime visualizer, let events stream in. `const stats = useMemo(() => statsRef.current, [])` computes once on mount and caches the object produced by `computeStats([])` (line 134). Every subsequent `pushEvent` assigns a *new* object to `statsRef.current` (line 158), but the memo never re-reads the ref because its dependency array is empty.
- **Root cause**: The comment (lines 130-133) says the memo is "keyed on `events` identity", but the deps array is `[]`, not `[events]`. The dataVersion-counter removal mentioned in the comment dropped the only thing that made the ref read reactive.
- **Impact**: `stats` (eventsPerMinute, successRate, pendingCount, activeSourceIds/activeTargetIds) is permanently `computeStats([])` — the stats UI shows 0 events / 100% success forever, regardless of traffic. User-visible breakage introduced by a perf refactor.
- **Fix sketch**: Change to `const stats = useMemo(() => statsRef.current, [events]);`. Since `pushEvent` always assigns `statsRef.current` inside the same updater that produces the new `events` array, keying on `events` identity makes the ref read observe every data change while still skipping animation ticks. Add a small test: push one event, assert `stats.totalInWindow === 1`.

## 2. Side effects inside the `setEvents` updater — drop counter double-counts and `computeStats` runs redundantly under StrictMode/concurrent re-execution
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: impure-updater
- **File**: src/hooks/realtime/useRealtimeEvents.ts:148-161
- **Scenario**: In dev StrictMode (and in production whenever React re-executes an updater during a concurrent render), the `setEvents((prev) => ...)` updater runs twice per push. It calls `setCapDroppedCount((c) => c + ...)` and reassigns `statsRef.current = computeStats(capped)` from inside the updater — both side effects fire once per execution, not once per push.
- **Root cause**: React state updaters must be pure; `pushEvent` embeds another `setState` plus a ref mutation and an O(n×5-pass) `computeStats` inside the updater to keep stats "in sync" with the capped array.
- **Impact**: `droppedCount` shown to the user can double-count once the 200-event cap is hit; `computeStats` (5 filter passes + 2 Set builds over 200 events) runs twice per event during bursty traffic — wasted work exactly on the hot path this code was optimized for.
- **Fix sketch**: Compute the capped array and drop delta outside the updater is racy; instead keep the updater pure and move side effects out: compute `statsRef.current` in a `useEffect`/`useMemo` keyed on `events` (which finding #1 requires anyway — then the assignment in `pushEvent` can be deleted), and derive `capDroppedCount` from a ref incremented in `handleBusEvent` before calling `setEvents`, or track it with `useReducer` where the reducer returns `{events, dropped}` in one pure step.

## 3. Dead code: `getEventPhase`, `getEventAnimation`, and the entire `useEventColor.ts` file have no callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/realtime/useAnimatedEvents.ts:51-66 (also src/hooks/realtime/useEventColor.ts:1-12)
- **Scenario**: A repo-wide grep over `src/` finds zero imports of `getEventPhase`, `getEventAnimation`, or `useEventColor` — only their definitions. `useAnimatedEvents` itself is used (EventBusVisualization, SwimLaneVisualization), but its two helper exports are not, and `useEventColor.ts` is an orphaned 12-line wrapper around `getEventColor` from `@/lib/design/eventTokens` (which callers use directly).
- **Root cause**: Helpers survived earlier refactors that moved consumers to `useAnimatedEvents`/`eventTokens` directly.
- **Impact**: Maintenance noise; `getEventPhase`/`getEventAnimation` are also O(n) linear scans over the animation map, so any future caller reaching for them per-event would silently reintroduce O(n²) work.
- **Fix sketch**: Delete `getEventPhase` and `getEventAnimation` from useAnimatedEvents.ts and delete `useEventColor.ts`. Verification needed for dynamic use is minimal (hooks can't be called dynamically); a `tsc` pass after deletion is sufficient.

## 4. `useCloudWebhookRelay` and `useSmeeRelayStatus` are copy-paste duplicates of the same status-hook pattern
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/realtime/useCloudWebhookRelay.ts:13-33 (mirrors useSmeeRelayStatus.ts:12-31)
- **Scenario**: Both files are byte-for-byte the same shape: DEFAULT_STATUS constant → `createSingletonListener<Status>(EventName.X)` → hook that does `useState(DEFAULT); listener(setStatus); return status`. Any behavior change (e.g. resetting to default on detach, exposing the attached flag) must be made twice.
- **Root cause**: Second relay-status hook was cloned from the first instead of extracting the pattern.
- **Impact**: Bounded (2 sites, ~30 lines each) but this is exactly the kind of drift-prone twin that diverges silently.
- **Fix sketch**: Add a tiny factory next to `createSingletonListener`, e.g. `createStatusHook<T>(eventName: EventName, defaultStatus: T): () => T` that wraps the singleton listener + useState. Each hook file becomes 3 lines, or both collapse into one `relayStatusHooks.ts`.

## 5. Design token `EVENT_TYPE_HEX_COLORS` is re-exported through a hook module and consumed from there by 5 components
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/hooks/realtime/useRealtimeEvents.ts:10
- **Scenario**: `EVENT_TYPE_HEX_COLORS` lives in `@/lib/design/eventTokens` but is re-exported from `useRealtimeEvents.ts`; SwimLaneVisualization, EventBusVisualization, VisualizationParticles, EventBusParticleRenderers, and EventBusFilterBar all import the design token from the hooks path, while EventLogSidebar/EventDetailDrawer import it via a *second* re-export in `features/overview/shared/eventVisuals.ts`.
- **Root cause**: Legacy re-export kept for compatibility after the token was centralized; consumers were never migrated.
- **Impact**: Two aliased import paths for one token obscures the single source of truth and drags a color map into a hook module's public API; pure-presentational renderers gain an import edge to the realtime hook.
- **Fix sketch**: Point the 5 hook-path consumers at `@/lib/design/eventTokens` (or the existing `eventVisuals` barrel — pick one), then delete the re-export at useRealtimeEvents.ts:10. Mechanical, tsc-verifiable.

## 6. Timeline replay re-parses `created_at` ISO strings on every tick and every seek
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-parse
- **File**: src/hooks/realtime/useTimelineReplay.ts:99,129
- **Scenario**: During playback, each 50 ms tick calls `new Date(evt.created_at).getTime()` for up to 12 events plus the break-check; every scrubber seek runs a binary search (`findFirstAfter`) that parses log2(5000) ≈ 13 dates per comparison call, and dragging the scrubber fires seeks continuously.
- **Root cause**: Events are stored as raw `PersonaEvent`s; timestamps are never precomputed after the one-time sort in `enterReplay` (which itself parses all 5000 twice via the sort comparator).
- **Impact**: Bounded — ISO date parsing is cheap individually, but scrub-drag on a 7-day/5000-event range does thousands of redundant `Date` allocations inside an interactive gesture. Cost is real but modest; nothing user-visible today.
- **Fix sketch**: In `enterReplay`, build a parallel `timestampsRef: number[]` (parse once, also use it for the sort). `findFirstAfter` and `tick` then compare plain numbers. ~10-line change, removes all steady-state Date allocation from the replay loop.
