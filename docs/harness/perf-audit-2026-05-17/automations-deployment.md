# Perf-Optimizer Scan — Automations & Deployment

> Project: Personas (frontend-only)
> Scope: 6 paths in src/
> Total: 8 findings (1 C / 4 H / 3 M / 0 L)

## Scope notes

- File scope resolved cleanly. All 6 listed paths exist.
- `src/features/deployment/components/cloud/` (16 files) was read in addition to the parent components dir because it is a child of `src/features/deployment/components` and most cloud-deployment UI lives there.
- `channelDelivery.ts` is a thin one-function wrapper (26 LoC) — no inherent perf surface, but consumers were not in scope to inspect.
- `usePolling` already integrates with a shared `PollingCoordinator` (good). `useCloudHealthMonitor` does NOT — see #5.

---

## 1. UnifiedDeploymentDashboard rebuilds `unified` row array + remounts sparkline computations on every selection toggle
- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/deployment/components/UnifiedDeploymentDashboard.tsx:56`
- **Scenario**: User opens the unified dashboard with 30+ deployments and clicks a row checkbox, types in the search box, or auto-poll fires. Every keystroke + every checkbox click triggers a re-render of the parent, which feeds a NEW `rows` array into `useDeploymentHealth(unified)` (called positionally on line 81 BEFORE `displayRows` is memoised, but `unified` itself is memoised). However, `useDeploymentHealth` then derives `personaEntries` / `stableKey` / `deploymentIdsKey` at module-scope inside the hook on every render — see finding #2 — and `personaEntriesRef.current = personaEntries` writes a new ref every render. Combined with `DeploymentTable` (not memoised) and inline arrow callbacks on every row, a single checkbox click re-renders every `<tr>` including the SVG `DeploymentHealthSparkline` (which then re-spreads `Math.min/Math.max` over the 7-day series — see #8). 50 deployments × 3 sparklines × full re-render = visible jank.
- **Root cause**: Three compounding issues: (a) `DeploymentTable` is not wrapped in `React.memo`; (b) per-row inline closures `() => handleAction(row.id, () => cloudPauseDeploy(row._cloud!.id))` create new function identities every render; (c) `selectedIds: Set<string>` is a reference type — every `setSelectedIds(new Set(...))` invalidates every row's prop equality. The `useShallow` pattern used in `CloudDeployPanel` is NOT applied here.
- **Impact**: Critical. The dashboard is the primary deployment UI; with the cloud auto-poll firing every 15s (cloudHistory cadence pattern) plus user interaction, the table is in near-constant re-render. On a 50-row deployment list this can sustain 16–30ms re-render frames during selection.
- **Fix sketch**: (1) Wrap `DeploymentTable` and a new `DeploymentRow` subcomponent in `React.memo`; pass `isSelected` boolean and a stable `onToggleSelect` callback instead of a `Set`. (2) Hoist row action callbacks via a `useCallback` factory keyed by row id, or pass action handlers + `row.id` separately so the row stays referentially stable. (3) Memoise `healthMap[row.id]` lookup at the row level via `useMemo(() => healthMap?.[row.id], [healthMap, row.id])`. (4) Replace `Set` selection with a `Record<string, true>` to make `isSelected` cheap and stable.

---

## 2. `useDeploymentHealth` recomputes O(N log N) deployment key every render and writes refs unconditionally
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/deployment/hooks/useDeploymentHealth.ts:24`
- **Scenario**: Dashboard with 50 deployments. Parent re-renders for any reason (search keystroke, hover state, selection toggle, poll). The hook body runs lines 24–33 every render: `rows.filter().map()` allocates a new array, `[...new Set(...)].sort()` allocates+sorts unique persona IDs, `personaEntries.map(e => e.id).sort().join(',')` re-sorts deployment IDs and joins to a string. All before any effect runs. Then `personaEntriesRef.current = personaEntries` writes a fresh array reference unconditionally.
- **Root cause**: None of the derived values are memoised. `personaEntries` (line 26), `uniquePersonaIds` (line 28), `stableKey` (line 29), `deploymentIdsKey` (line 31) are all recomputed even when `rows` is referentially unchanged. The `useEffect` dependency `[stableKey, deploymentIdsKey]` then has stable string identity, so the effect doesn't re-fire — but the compute cost is paid every render anyway.
- **Impact**: High. With N=50 deployments, each render performs N filters + N maps + N-element Set construction + 2× sort + join. Multiply by re-render frequency from #1 → measurable main-thread cost.
- **Fix sketch**: Wrap derivations in `useMemo`:
  ```ts
  const personaEntries = useMemo(() => rows.filter(r => r.personaId).map(r => ({ id: r.id, personaId: r.personaId! })), [rows]);
  const stableKey = useMemo(() => [...new Set(personaEntries.map(e => e.personaId))].sort().join(','), [personaEntries]);
  const deploymentIdsKey = useMemo(() => personaEntries.map(e => e.id).sort().join(','), [personaEntries]);
  ```
  Also drop `personaEntriesRef` — read `personaEntries` directly inside the effect via a closure over the memoised value.

---

## 3. `DailyBreakdownChart` reads layout DOM during render and triggers full re-render on every mousemove
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/deployment/components/cloud/DailyBreakdownChart.tsx:49`
- **Scenario**: User hovers over the 7/30/90-day execution chart in CloudHistoryPanel. `onMouseMove` (line 111) fires at ~60 Hz and calls `setTooltipPos({...})`, which triggers a full re-render of the chart including re-mapping all bars, the cost polyline, and the tooltip absolute-positioning math.
- **Root cause**: (a) Line 49 reads `containerRef.current?.clientWidth` during render — this is a layout read inside the render phase, forcing synchronous reflow if any pending writes exist, and the first render always returns 400 (the fallback) because the ref isn't attached yet. There is no `useLayoutEffect` to resize. (b) `setTooltipPos` on every mousemove triggers a top-level chart re-render rather than positioning the tooltip declaratively/imperatively. (c) Hover state lives at the chart level, so every bar element re-evaluates `isHovered = hoverIdx === i` and re-renders.
- **Impact**: High when chart is visible. Each hover frame: ~30 SVG `<rect>` updates + tooltip clientWidth read on the container + react reconciliation. On 90-day periods this is 90 bars × full reconciliation per mousemove frame. Also causes invisible chart layout shift from the 400px fallback.
- **Fix sketch**: (1) Use `useLayoutEffect` + `ResizeObserver` to track container width into state once, not during render. (2) Position the tooltip imperatively by writing to a ref'd `<div>` style on mousemove (skip React reconciliation entirely), OR throttle via `requestAnimationFrame`. (3) Move hover state into a child `Bar` component and memoize it — `isHovered` becomes a per-bar prop and only the previously-hovered + newly-hovered bars re-render.

---

## 4. `CloudHistoryPanel` runs poll + debounced refetch in parallel after filter change, and rebuilds `dailyBreakdown` array on every render
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/deployment/components/cloud/CloudHistoryPanel.tsx:106`
- **Scenario**: User changes the persona/status/period filter. The `useEffect` at line 106 fires `debouncedFetchData()` (300ms delay). Simultaneously, `usePolling` at line 115 has registered `fetchData` with the coordinator — and because `fetchData`'s identity changes when filters change (`useCallback` deps on `filterPersona`, `filterStatus`, `period`), the coordinator re-registers the ticker, which fires immediately on enable. Result: TWO `cloudListExecutions` + `cloudExecutionStats` round-trips per filter change (one immediate from polling re-registration, one debounced).
- **Root cause**: (a) `fetchData` identity flips on filter change → `usePolling` treats it as a new poller and fires immediately. (b) The debounced layer was added as a defense but doesn't cancel the polling-driven call. (c) Separately: line 138 maps `stats.dailyBreakdown` to a new array on every render and passes it to `DailyBreakdownChart` — new array → new prop reference → chart's `useMemo([data])` invalidates → recompute maxCount/maxCost.
- **Impact**: High under filter churn. Each filter change does 2× backend round-trips (each is `cloudListExecutions` + `cloudExecutionStats`, so 4 invokes total). On flaky connections this compounds and causes the "Live" indicator to flicker. The chart memo invalidation amplifies #3.
- **Fix sketch**: (1) Stabilise `fetchData` by reading filter values from refs OR pass filters as args to `usePolling`'s ticker so identity stays stable. (2) Wrap the dailyBreakdown mapping in `useMemo([stats])`. (3) Drop the debounced wrapper and let the polling coordinator's existing throttle handle it — OR have the filter-change effect call `pollingCoordinator.bumpNext()` instead of double-firing.

---

## 5. `useCloudHealthMonitor` bypasses PollingCoordinator and uses chained `setTimeout` recursion
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/features/deployment/hooks/useCloudHealthMonitor.ts:54`
- **Scenario**: User opens `CloudDeployPanel`. `useCloudHealthMonitor()` (line 98 of CloudDeployPanel) starts a `setTimeout` chain: every 30s `runHealthCheck` calls `cloudGetConfig()`, which calls back into Tauri. Meanwhile `usePolling` for `cloudStatus` (12s) and `cloudHistory` (15s) are coordinated through `PollingCoordinator`. Health monitor runs on its OWN timer, so on a tab with both Status and History panels having opened recently, three separate timer schedules fire ticks at desynchronized moments → the device wakes the JS event loop more often, the Tauri bridge serializes invokes, and each wake costs a render due to the `useSystemStore` setState in the monitor.
- **Root cause**: `useCloudHealthMonitor` was written before the coordinator existed (or as a special case). It uses raw `setTimeout(runHealthCheck, 30_000)` and recurses through generation-counter refs. The `cloudGetConfig` it polls returns the same data that `cloudFetchStatus` (already polled by `usePolling` cloudStatus bucket) implicitly has access to — duplication of liveness signal.
- **Impact**: High over long sessions. Per-tick: a Tauri invoke + zustand setState (multiple call sites in the hook write `cloudConfig`, `cloudConnectionLatencyMs`, `cloudReconnectState`, `cloudError`) → every store subscriber re-evaluates. Also adds wake events when the tab is hidden because `setTimeout` doesn't respect document visibility (unlike `PollingCoordinator`, which suspends).
- **Fix sketch**: Register the health check with `getPollingCoordinator()` using a dedicated bucket name (e.g. `cloudHealth: { interval: 30_000, maxBackoff: 120_000 }`), so it shares the coordinator's visibility suspension and tick alignment. Move reconnect logic into a state machine that the coordinator drives, OR drop polling entirely and rely on `cloudFetchStatus` failures (already polled at 12s on the Status tab) as the dropped-connection signal.

---

## 6. `cloudSlice.cloudDeployments` array reference flips on every pause/resume/remove, forcing all subscribers to re-render
- **Severity**: medium
- **Category**: re-render
- **File**: `src/stores/slices/system/cloudSlice.ts:308`
- **Scenario**: User pauses one of 30 deployments. `cloudPauseDeploy` runs `state.cloudDeployments.map((d) => d.id === deploymentId ? updated : d)` — produces a NEW array even though 29 of 30 references are identical to the previous render. Every `useSystemStore((s) => s.cloudDeployments)` selector returns a new reference → every consumer re-renders (UnifiedDeploymentDashboard, CloudDeployPanel, CloudDeploymentsPanel, CloudSchedulesPanel). Bulk pause/resume amplifies: `cloudBulkPause` is correct in batching the set (line 363), but it still produces a full new array.
- **Root cause**: Standard Zustand pattern but no shallow-equality guard on consumers (`useShallow` is used in CloudDeployPanel but NOT in UnifiedDeploymentDashboard). Also no fine-grained selectors per deployment ID.
- **Impact**: Medium. Visible during action latency: clicking pause on row 1 causes rows 2–30 to re-render their sparklines (which then run #2 + #8). Scales linearly with deployment count.
- **Fix sketch**: (1) Adopt `useShallow` in UnifiedDeploymentDashboard for the cloud state slice (mirror CloudDeployPanel). (2) For row-level isolation, consider keyed selectors: `useSystemStore((s) => s.cloudDeployments.find(d => d.id === id))` combined with the row component being memoised — but this requires migration. (3) Short-term: ensure `cloudFetchDeployments` only writes a new array when data actually changed (deep-equal check or version stamp from the backend).

---

## 7. `CloudSchedulesPanel` fans out one `cloudListTriggers` per deployed persona on every mount and every refresh
- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/deployment/components/cloud/CloudSchedulesPanel.tsx:54`
- **Scenario**: User switches to the Schedules tab with 20 active deployments. `fetchTriggers` runs `Promise.all(Array.from(deployedPersonaIds).map(pid => cloudListTriggers(pid)))` → 20 parallel Tauri invokes. Refresh button does the same again. The result is then flattened on the client. There is no batch endpoint.
- **Root cause**: API design: `cloudListTriggers` is per-persona. The panel has no choice but to fan out.
- **Impact**: Medium. Tauri invoke channel is single-threaded per process; 20 simultaneous calls serialise. With 50+ active deployments this becomes a noticeable open-tab latency.
- **Fix sketch**: (1) Add a backend `cloudListTriggersBulk(personaIds: string[])` invoke that aggregates server-side and returns `Trigger[]` flat — keep the client identical. (2) Short-term frontend: memoise results by `personaId` in a ref-cache with TTL, so re-mounting the Schedules tab within N seconds doesn't refetch. (3) Stagger requests through a concurrency limiter if backend can't be changed.

---

## 8. `DeploymentHealthSparkline` does spread-based min/max + lookups outside the `useMemo` that owns its inputs
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/deployment/components/DeploymentHealthSparkline.tsx:46`
- **Scenario**: Inside the inner `MiniSparkline` component (rendered 3× per row: success/volume/errors), lines 46–47 do `Math.min(...values)` and `Math.max(...values)`. The outer `DeploymentHealthSparkline` memoises the *production* of the three series via `useMemo` on `daily` (line 84), but the rendered `<MiniSparkline>` is NOT memoised, so on every parent re-render (see #1) each MiniSparkline re-runs spread-based min/max and re-allocates the `points` array.
- **Root cause**: (a) `MiniSparkline` is a plain function component, not `React.memo`. (b) `Math.min(...values)` is a spread call — fine for 7 values, but pointless work per re-render. (c) The `daily` array reference may flip when `healthMap` is re-mapped (see #2's effect), invalidating the outer useMemo too.
- **Impact**: Medium. Per row × 3 sparklines × 7-day default = 21 min/max computations + 21 polyline point allocations per re-render. With 50 rows and a high re-render rate (#1), this is ~3150 trivial ops per dashboard render. Not catastrophic, but easy to fix and amplifies the upstream re-render storm.
- **Fix sketch**: (1) Wrap `MiniSparkline` and `DeploymentHealthSparkline` in `React.memo` with default shallow-prop comparison. (2) Move `min`/`max`/`points` into a `useMemo([values])` inside `MiniSparkline`. (3) Ensure `daily` reference is stable across renders by memoising at the producer (the `useDeploymentHealth` `mapped` object — only allocate when the underlying data actually changed).
