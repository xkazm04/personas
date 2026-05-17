# Perf-Optimizer Scan — Trigger Studio & Webhooks

> Project: Personas (frontend-only)
> Scope: 13 paths in src/features/triggers (+ realtime listener hooks)
> Total: 10 findings (1C/4H/4M/1L)

## Scope notes

Scope drift observed: the assigned context lists 13 paths but the directory also contains a
`sub_lineage/` subtree (TriggerLineageCanvas + node renderers) that is wired into TriggersPage
as a tab; treated as in-scope here because it shares the Trigger Studio surface.

All paths confirmed in `C:/Users/mkdol/dolla/personas/src/features/triggers/*`. No `src-tauri/`
analysis was performed. One realtime hook (`src/hooks/realtime/createSingletonListener.ts`) is
referenced because LiveStreamTab perf turns on its delivery contract.

Files read in full: TriggersPage, LiveStreamTab, DeadLetterTab, SmeeRelayTab, CloudWebhooksTab,
RateLimitDashboard, TestTab, TriggerStudioCanvas, TriggerLineageCanvas, TriggerAddForm,
TriggerList, TriggerCountdown, RadialCountdownRing, useRoutingState, RoutingView,
buildEventRows, useTriggerOperations, useTriggerHistory, useTriggerDetail, HighlightedJson,
EventDetailModal, createSingletonListener, useSmeeRelayStatus, useCloudWebhookRelay. (24 files)

---

## 1. LiveStream event-row list rebuilds on every event, no virtualization

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:97-110, 371-393`
- **Scenario**: Live event bus firing 50–200 evt/s (well within the 10k-cap the file already
  defends against) on a stream that already holds the rolling 200-row buffer.
- **Root cause**: Every CDC payload calls `setEvents(prev => [evt, ...prev])` — an
  immutable 200-item array allocation per event — and `setTotalReceived` + `setEventsPerMin`
  separately, triggering 3 re-renders per event. The whole filtered list is recomputed by the
  `availableTypes` / `filteredEvents` / `typeOptions` memos, then rendered by a plain
  `DataGrid` with no row windowing (pageSize=20 paginates but the DOM still re-renders all 20
  rows + memoized children). `getRowClassName` is a stable callback but uses
  `newEventIds.current.has(event.id)` so React can't memoize rows by props (the ref read makes
  every row appear "new" to React equality).
- **Impact**: At 100 evt/s the tab will pin a frame budget — three React re-renders + sort +
  filter walk per event = O(n) ≈ 200 ops/event = 20k ops/s before any DOM work. Users see UI
  freeze + paused-queue fall behind.
- **Fix sketch**: (a) Batch event ingest into a rAF-throttled `pendingRef` flushed once per
  frame; (b) wrap `EventTypeChip`, persona cell, and status badge with `React.memo` and pass
  primitive props; (c) replace `DataGrid` with a virtualized list (react-window) keyed on
  event id; (d) move `newEventIds` flag onto the row object itself so memoization sees it as
  a prop change rather than reading a ref.

---

## 2. CloudWebhooksTab waterfalls N `cloudListTriggers` calls per deployment

- **Severity**: high
- **Category**: duplicate-call / async-coordination
- **File**: `src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:44-81`
- **Scenario**: User opens Cloud Webhooks tab with K active deployments.
- **Root cause**: `for (const dep of webhookEnabled) { ... cloudListTriggers(dep.personaId) }`
  is awaited serially in a `for...of`. With K deployments the request latency is sum-of-K
  IPC round-trips even when each call is independent.
- **Impact**: Linear blocking IPC waterfall. With ~10 deployments at ~80ms each, tab idles
  ~800ms before showing rows. Also rebuilds the whole `webhookRows` array on every refresh
  (no diff), forcing list remount.
- **Fix sketch**: Replace the loop with
  `await Promise.all(webhookEnabled.map(dep => cloudListTriggers(dep.personaId).catch(() => [])))`,
  then flatten + map. Even better: expose a single `cloudListAllWebhookTriggers()` Tauri
  command that does the join server-side, mirroring the `listAllTriggers` + `getTriggerHealthMap`
  pattern TriggerList already uses.

---

## 3. RadialCountdownRing runs one rAF loop per trigger forever

- **Severity**: high
- **Category**: memory / async-coordination
- **File**: `src/features/triggers/sub_triggers/RadialCountdownRing.tsx:29-46`
- **Scenario**: TriggerList view rendered with many schedule/polling triggers (e.g. 30+
  triggers across personas).
- **Impact**: Each `RadialCountdownRing` schedules `requestAnimationFrame(animate)` in a
  self-recursive loop that never terminates while mounted, even when the ring is offscreen,
  the tab is backgrounded, or `remaining === 0` (it keeps writing the same `strokeDashoffset`
  every frame). N rings = N rAF callbacks at 60Hz = O(N) work per frame just to keep clamped
  values at zero. The shared 1Hz ticker in TriggerCountdown (a good pattern) is undone here.
- **Fix sketch**: (a) Stop the rAF loop when `currentRemaining <= 0` and only restart when
  `remaining > 0` changes; (b) gate animation with
  `if (document.visibilityState !== 'visible') return;`; (c) reuse the shared tick subscriber
  pattern from `TriggerCountdown` instead of per-instance rAF — countdown rings only need
  ~10Hz to look smooth, not 60Hz.

---

## 4. TriggerAddForm = god-component, all child config sections re-render per keystroke

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/triggers/sub_triggers/TriggerAddForm.tsx:33-241`
- **Scenario**: User types in any input — interval, cron expression, hmac secret, watch path,
  composite condition list, etc.
- **Root cause**: ~30 `useState` hooks colocated in the parent. Each keystroke updates one
  state, parent re-renders, and every child config (`WebhookConfig`, `FileWatcherConfig`,
  `ClipboardConfig`, `AppFocusConfig`, `CompositeConfig`, `EventListenerConfig`,
  `PollingConfig`, `IntervalConfig`, `CronConfig`, NlTriggerInput, TriggerQuickTemplates,
  TriggerCategorySelector, TriggerTypeSelector) re-renders because (a) none are memoized and
  (b) their setter props are passed as inline references in JSX, breaking referential
  equality even if children were wrapped.
- **Impact**: Visible typing lag in the composite condition list (which renders an array UI
  inside CompositeConfig). Cron debounce works but the rest of the form still recomputes.
- **Fix sketch**: Co-locate field state into the leaf config components, or move to a single
  `useReducer` and pass the dispatch + a `useCallback`-stable selector. Wrap each `*Config`
  child in `React.memo`.

---

## 5. DeadLetterTab AnimatePresence over unbounded list, full re-layout on each event

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:150-227`
- **Scenario**: 100-event dead-letter listing (the explicit fetch cap), framer-motion `layout`
  animations on every `motion.div`.
- **Root cause**: Every row carries `layout` + entry/exit transitions. With 100 rows, any
  filter or retry call triggers a FLIP-style layout measurement on every row (framer-motion
  reads layout per element). The `LazyPayload` child further parses payload JSON inside a
  `useMemo` that only invalidates when its `details` toggles open — but that's fine; the cost
  is in the layout animations on the list itself.
- **Impact**: Stutter when a retry succeeds (single row exits, all neighbors animate). Tab
  feels heavy when 100 rows are open.
- **Fix sketch**: Drop `layout` from `motion.div` and rely on simpler enter/exit; or virtualize
  with a constant-height row. Defer `formatDate` to row-level memo (currently called per
  render).

---

## 6. SmeeRelayTab refetches full relay list on every status heartbeat

- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:62-67`
- **Scenario**: `useSmeeRelayStatus` pushes a status payload each time `events_relayed`
  changes (one per relayed event).
- **Root cause**:
  ```ts
  useEffect(() => {
    if (globalStatus.events_relayed > 0) fetchRelays();
  }, [globalStatus.events_relayed, fetchRelays]);
  ```
  Every event increment triggers a full `smeeRelayList` IPC call. With an active relay firing
  10 evt/s this is 10 list-fetches/second.
- **Impact**: Hammers the Tauri command channel and keeps re-allocating `relays` state →
  re-renders the list. Currently masked because most relays are idle, but a single noisy
  channel saturates the IPC.
- **Fix sketch**: Debounce the refetch to ~1s, or have the status payload carry per-relay
  `eventsRelayed` deltas so the local state can be patched without an extra round-trip.

---

## 7. TriggerLineageCanvas — derived nodes/edges duplicated via setState mirror

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/triggers/sub_lineage/TriggerLineageCanvas.tsx:186-191`
- **Scenario**: Any change to `personas`, `allTriggers`, `filterMode`, or `selectedPersonaId`.
- **Root cause**: `decoratedNodes` / `decoratedEdges` are computed via `useMemo`, then mirrored
  into ReactFlow state with `useNodesState(decoratedNodes)` and a follow-on
  `useEffect(() => setNodes(decoratedNodes))`. This causes (a) two renders per change (memo
  computes, effect schedules another setState), and (b) `decoratedNodes.map(n => ... layout.nodes.find ...)`
  is O(N) inside a `.map` of N → O(N²) wrt the lineage graph size. With 50 triggers + 20 personas
  that's ~5,000 lookups per render.
- **Impact**: Filter-mode toggle stutters on medium graphs.
- **Fix sketch**: Build a `Map<id, GraphNode>` once outside the map; pass derived data
  directly to ReactFlow (no mirror setState) by computing nodes via `useMemo` and feeding
  them straight in — ReactFlow doesn't require local node state unless the user needs to
  mutate positions; treat positions as derived too or store them in a ref keyed by id.

---

## 8. LiveStream filters + availableTypes scan the full 200-event buffer twice per render

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:167-178`
- **Scenario**: Filtering by type/persona while events stream in.
- **Root cause**: `availableTypes` walks the buffer to build a `Set<string>`, then `.sort()`s.
  `typeOptions` then maps and replaces underscores per option. Both run on every events
  mutation (every received event). For 200 events × distinct types ≈ stable but the work
  recurs at the event tick rate.
- **Impact**: Constant CPU when stream is busy.
- **Fix sketch**: Track a `typeCountsRef` updated incrementally in the singleton listener
  callback (++ when new event, -- when buffer evicts the last of its type). Memoize
  `typeOptions` on the resulting Map rather than re-deriving from the array.

---

## 9. EventDetailModal HighlightedJson re-tokenizes from scratch on each open

- **Severity**: low
- **Category**: algorithmic
- **File**: `src/features/triggers/sub_live_stream/HighlightedJson.tsx:7-15`
- **Scenario**: User opens detail for an event with a large payload (10–100 KB JSON).
- **Root cause**: `JSON.parse → JSON.stringify(_, _, 2) → regex tokenize → array of token spans`
  runs on every modal mount and on every render where `raw` reference changes. Each token
  becomes a separate `<span>` (no flattening), inflating DOM size linearly with payload.
- **Impact**: ~100ms parse for a 50KB payload, plus a couple thousand DOM nodes that the
  scroll-container then has to lay out.
- **Fix sketch**: Tokenize once and cache by payload SHA / WeakMap keyed by event id;
  consider falling back to plain `<pre>` text when payload > N KB (the user can read raw JSON
  without 7-color highlighting).

---

## 10. DeadLetter / TriggerHistory replay each call `validateTrigger` even when info already cached

- **Severity**: low
- **Category**: duplicate-call
- **File**: `src/features/triggers/hooks/useTriggerHistory.ts:102-141`
- **Scenario**: User clicks Replay on multiple historical executions in quick succession.
- **Root cause**: Each replay does an extra `validateTrigger(triggerId)` IPC before
  `executePersona`, even though `triggerId` doesn't change between rapid replays and the
  health didn't change between clicks. The same trigger is re-validated N times for N
  replays of the same id.
- **Impact**: Doubles IPC roundtrips for batch replay workflows.
- **Fix sketch**: Short-TTL cache (e.g. 5s) on `validateTrigger(id)` results inside
  `useTriggerOperations`, or skip pre-validation when the previous replay returned `ok`
  within the last few seconds.
