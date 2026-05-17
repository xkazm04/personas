# Perf-Optimizer Scan — Activity, Events & Realtime Bus

> Project: Personas (frontend-only)
> Scope: 11 paths in src/
> Total: 11 findings (3 C / 5 H / 2 M / 1 L)

## Scope notes

- `src/features/overview/i18n` does not exist (i18n lives globally in `src/i18n`). No findings here.
- `src/features/agents/sub_activity` exists and contains an `ActivityTab` that does **not** subscribe to the event bus (pure REST `Promise.all` loader), so the per-tick hot path is confined to overview + `useEventBusListener` subscribers.
- The hottest path is unambiguous: every Tauri `event-bus` payload fans out through `createSingletonListener.ts` to every component that calls `useEventBusListener` (today: `useRealtimeEvents`, `useEventLog`, plus any `MessageList` siblings via `useMessageCreatedListener`). Most findings concentrate around the singleton, `useRealtimeEvents`, `useEventLog`, and the realtime visualizations.

## 1. Realtime hub re-renders entire React tree on every event (3-state burst per tick)

- **Severity**: critical
- **Category**: re-render
- **File**: `src/hooks/realtime/useRealtimeEvents.ts:146-158`
- **Scenario**: Each backend tick lands a single `PersonaEvent`. `pushEvent` synchronously triggers `setEvents` (new array), `setCapDroppedCount` only sometimes, **and unconditionally** `setDataVersion((v) => v + 1)` from inside the `setEvents` updater. The wake/animation path then schedules another `setAnimTick` bump within the same microtask. Net: 2–3 commits per event, each forcing `RealtimeVisualizerPage`, `EventBusVisualization`, `SwimLaneVisualization`, `EventLogSidebar` and `RealtimeStatsBar` to re-render together.
- **Root cause**: Two separate `useState` calls (`events`, `dataVersion`) updated back-to-back instead of one consolidated state. `statsRef.current` is mutated before `setDataVersion`, so `dataVersion` exists only to force the `useMemo(() => statsRef.current, [dataVersion])` to flip — that pattern guarantees a second render. The drop counter is yet another state.
- **Impact**: At 20 events/s (a single chatty webhook firing) this is ~60 React commits/s across the entire realtime page. Stats bar, log sidebar (200-row map+reverse), and SVG visualizations all re-mount per commit.
- **Fix sketch**: Coalesce into a single state object (`{events, stats, dropCount}`) and a single `setState` per event. Better: rAF-batch incoming bus events (push into a buffer ref, flush once per frame) — at 60 events/s only ~16 commits/s instead of 60 × 3.

## 2. Event-bus singleton fan-out has no coalescing, no rAF batching, no payload deduping

- **Severity**: critical
- **Category**: re-render
- **File**: `src/hooks/realtime/createSingletonListener.ts:62-76`
- **Scenario**: On every Tauri `event-bus` payload the singleton immediately iterates `for (const cb of subscribers) cb(payload);` synchronously inside the Tauri listener callback. There are at least three live subscribers in production paths (`useRealtimeEvents` push, `useEventLog` push to store, and any plugin like `LiveStreamTab`), each of which causes its own `setState`. A burst of N events triggers N × subscribers commits with no coalescing.
- **Root cause**: The singleton's only batching mechanism is the early-arrival buffer (when zero subscribers exist). Once subscribers attach there is no rAF flush, no microtask debounce, no payload identity check — every single Tauri tick → N synchronous React updates.
- **Impact**: This is the universal multiplier. Any backend feature that emits to `event-bus` (CDC INSERT/UPDATE/DELETE, manual `emit_event_to_frontend`, `emitDeploymentEvent` round-trips) pays N× the subscriber cost. With the overview page open this is a guaranteed 60-fps-killing pattern.
- **Fix sketch**: Add a per-frame flush queue inside the singleton: `pending.push(payload); if (!rafScheduled) requestAnimationFrame(flush); flush() drains pending and dispatches a single `payload[]` batch via `cb(batch)`. Subscribers opt-in to batch shape (`useRealtimeEvents` already wants arrays — it would slot in directly). Optionally dedupe by `event.id` inside the same frame (the `event-bus` channel demonstrably emits both CDC notifications and full payloads for the same row — see `useEventLog.ts:97-99` filter).

## 3. EventLogSidebar slices+reverses 200 events and runs `personas.find()` per event on every realtime tick

- **Severity**: critical
- **Category**: algorithmic
- **File**: `src/features/overview/sub_realtime/components/panels/EventLogSidebar.tsx:50-67`
- **Scenario**: `logEntries` runs `events.slice(-200).map(...).reverse()` and inside the map performs `allPersonas.find((p) => p.id === evt.target_persona_id)` for each entry — that's O(events × personas) per render. The component re-renders every time the realtime hub commits (i.e. ~3× per tick per #1).
- **Root cause**: No memoized persona map; the lookup is recreated from `find()` on every event. Reversing a 200-item array per render also allocates each time. The dep is `[events, allPersonas]` so any persona-store touch (selection, status change) invalidates the whole thing too.
- **Impact**: With 5 personas: ~1,000 array scans per tick + 200-row allocation + DOM reconciliation for 200 items (the sidebar is not virtualized — see #6). At 20 e/s that is 20k `find()` calls/second on the hot path.
- **Fix sketch**: Build a `Map<personaId, persona>` once via `useMemo(..., [allPersonas])`, then O(1) lookup per entry. Reverse can be eliminated by iterating `events` from `length-1` downward into a pre-sized array. Memoize per-row JSX rendering by deriving entries from the original event array via `useMemo`.

## 4. EventLogSidebar render list is unvirtualized — full 200-row DOM rebuild on every tick

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_realtime/components/panels/EventLogSidebar.tsx:118-209`
- **Scenario**: `{filteredLog.map(entry => ...)}` renders the full filtered list (capped at 200) as React children of the scroll container. Each entry produces a non-trivial subtree (status icon, ChevronRight, payload preview, optional expanded panel). Combined with #1+#3 this paints 200 fresh button trees per tick.
- **Root cause**: No `useVirtualList`/`@tanstack/react-virtual` even though the rest of the codebase already uses it (see `MessageList.tsx:173`, `GlobalExecutionList.tsx:186`).
- **Impact**: ~200 row DOM nodes reconciled per realtime commit. With Framer Motion's `animate-fade-slide-in` class on every row, expensive style/layout work runs in microtasks behind every tick.
- **Fix sketch**: Wrap the rendered range in `useVirtualList(filteredLog, ROW_HEIGHT)` matching the message list pattern. Pre-compute row height (~52px collapsed, variable when expanded — collapse-only virtualization is fine for the 99% case).

## 5. EventLogSidebar parses payload JSON inside render via `tryParsePayload` — re-parses every tick

- **Severity**: high
- **Category**: data-layer
- **File**: `src/features/overview/sub_realtime/components/panels/EventLogSidebar.tsx:26-40,122`
- **Scenario**: For each event row, `tryParsePayload(entry.payload)` calls `JSON.parse(raw)` plus `Object.keys(...)` + `JSON.stringify` of every value on every render. The result is not memoized (called in the `.map` body), so all 200 payloads re-parse on every realtime commit. The expanded view repeats the parse a second time (`JSON.stringify(JSON.parse(entry.payload!), null, 2)` at line 192).
- **Root cause**: No payload cache. JSON parse is the textbook example of work to do once per event id, not per render.
- **Impact**: A 200-item list with avg 300-byte payloads = 60 KB JSON parsed every tick × 3 commits = ~3.6 MB/s of `JSON.parse` work under load. Garbage collector thrash, main-thread blocking.
- **Fix sketch**: Memoize `logEntries` keyed by `evt.id` (parse once when an event first appears, cache the preview string on the entry). Or use a `WeakMap<RealtimeEvent, string>` parse cache. Same applies to `EventLogItem.tsx:101` and `EventDetailDrawer.tsx:14-21` but those are non-hot (modal/detail surfaces).

## 6. `useEventColor` allocates a fresh memo wrapping a pure pure function per consumer

- **Severity**: low
- **Category**: re-render
- **File**: `src/hooks/realtime/useEventColor.ts:9-11`
- **Scenario**: `useMemo(() => getEventColor(eventType, status), [eventType, status])` per consumer. `getEventColor` is already a pure lookup; the memo cost (deps array allocation, equality compare) is more expensive than the call itself when the rendered list is large.
- **Root cause**: Over-memoization of a trivial pure function. Each row that wants a color pays the React memo bookkeeping cost.
- **Impact**: Marginal but multiplies with #4 (200 rows). Memo cache could be moved outside React.
- **Fix sketch**: Replace with a module-level memoized function (`new Map<\`${eventType}:${status}\`, result>()`) or drop the wrapper and call `getEventColor` directly.

## 7. `useRealtimeEvents.computeStats` is O(events) with 4 separate filter+map passes + 2 Set rebuilds

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/hooks/realtime/useRealtimeEvents.ts:67-108`
- **Scenario**: On every event push, `statsRef.current = computeStats(capped)` runs. It performs `events.filter(...)` four times, calls `new Date(e.created_at).getTime()` inside each filter, then two `new Set(... map ... filter)` materializations. With the 200-item cap that is ~1000 `Date.parse` calls + 4 array allocations per tick.
- **Root cause**: Sequential filter passes instead of one O(n) loop. `new Date().getTime()` per event per tick is wasteful — the timestamp can be parsed once when the event arrives.
- **Impact**: 200-event window × 5 passes × per-event `Date.parse` = ~1k parses per push. Easily eclipses the cost of the JSON-parse work in #5 once the buffer fills.
- **Fix sketch**: Single pass: maintain incremental counts (`delivered/failed/pending`) plus a circular timestamp buffer; when the rolling-1-minute window slides, decrement instead of rescanning. Even a naïve single-pass loop with locally bound `oneMinuteAgo` would cut work 5×.

## 8. `useEventLog.filteredEvents` rebuilds a `Map<id, timestamp>` and re-sorts a merged array every realtime tick

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/overview/sub_events/libs/useEventLog.ts:188-220`
- **Scenario**: Each `pushRecentEvent` updates `recentEvents`; the `filteredEvents` memo then dedupes via Set, builds a `tsMap` with `new Date(e.created_at).getTime()` for every event, and sorts the entire merged list. Deps include `searchText` (typed character by character) and `isSearching` (toggles during debounce), so every keystroke also forces a full sort.
- **Root cause**: Sort done lazily on the entire merged list every time anything changes. Each merge re-parses every `created_at` string. `recentEvents` is already kept sorted by the store; merging with `olderEvents` could be O(n+m) instead of O(n log n).
- **Impact**: With 200 recent + 200 older = 400 sort, ~2.7k comparisons per tick + 400 Date parses. Scales linearly with feed velocity.
- **Fix sketch**: Persist timestamp as a numeric field once at fetch time (or via `useMemo` keyed on `e.id`). Use a merge-sort of two already-sorted arrays (linear) instead of re-sorting the union.

## 9. `useEventBusVisualization` source discovery rebuilds + LRU-sorts on every `events.length` change

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/overview/sub_realtime/components/views/EventBusVisualization.tsx:28-65`
- **Scenario**: The discovery effect runs on `[events]` and walks the **entire events array** each time (`for (const evt of events)`), even though only the newest event is novel. The `outerNodes` memo then re-runs on `[events.length]`, calling `Array.from(disc.values()).sort(...).slice(...)` plus `distributeOnRing` (trig per node) every tick.
- **Root cause**: Effect dep is `[events]` not `[newestEventId]`. The full-list walk is wasted because we only need to register the head event. The LRU prune scan also walks the full map every tick.
- **Impact**: O(events) per tick instead of O(1); plus the LRU sort is O(n log n) every time the map exceeds `maxDiscoveredSources`. SVG re-layout chain triggers on every push (positions change as `sizeFactor` recomputes).
- **Fix sketch**: Track the latest processed event id; only walk new events since last tick. Prune evictions on a separate `setInterval` (e.g. every 5s) instead of every event. Memoize `distributeOnRing` output keyed by source-id list.

## 10. `applyFilter` runs full event scan + 7-field string concat on every keystroke in filter searchText

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/overview/sub_realtime/libs/eventBusFilterTypes.ts:86-122`
- **Scenario**: `useEventBusFilter.filteredEvents = useMemo(() => applyFilter(events, filter), [events, filter])`. When the user types in `EventBusFilterBar` search, each keystroke produces a new `filter` object and triggers a full scan that builds a 7-field `[...].join(' ').toLowerCase()` haystack per event. With 200 events this is 1400 `toLowerCase` allocations per character.
- **Root cause**: No debounce on search input (compare against `useEventLog.ts:167-169` which debounces 300ms). Haystack is rebuilt per render.
- **Impact**: Typed search becomes visibly laggy at 200 events; mid-burst incoming events compound (events dep also re-fires the filter).
- **Fix sketch**: Debounce `searchText` (or use `useDeferredValue`). Cache lowercase haystack on event objects via `WeakMap<RealtimeEvent, string>`. Short-circuit by checking cheap fields (`event_type`, `status`) before payload string scan.

## 11. `useTauriEvent` re-subscribes whenever `handler` identity changes — silent listener leak risk

- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/hooks/useTauriEvent.ts:38-58`
- **Scenario**: The effect deps are `[eventName, handler, errorContext]`. Any consumer that doesn't wrap `handler` in `useCallback` (or whose closure deps change every render) tears down and re-binds the Tauri listener on every render. Each rebind is an async `listen()` → `unlisten()` round-trip and during the gap events fall on the floor.
- **Root cause**: Comment at top of file warns "Wrap in useCallback at the call site to keep the dependency array stable" — but the API design makes it the caller's responsibility and consumers can easily get it wrong. `LiveStreamTab.tsx` and `CompanionPanel.tsx` are external consumers of this exact pattern.
- **Impact**: Under churn (e.g. parent re-renders mid-stream) listeners are continuously torn down and re-bound; in the worst case the early-arrival buffer drops payloads. Also: the same handler attaches a new Tauri IPC subscription on each rebind (not de-duplicated), so a 60-fps re-rendering parent yields 60 listen()/unlisten() round-trips per second.
- **Fix sketch**: Store `handler` in a ref (the singleton pattern already does this — see `createSingletonListener.ts:107-110`), depend only on `[eventName, errorContext]`. Mirrors `useTimelineReplay` ref-syncing pattern. Belt-and-braces: a build-time ESLint rule that flags non-`useCallback` handler args to `useTauriEvent`.