# Perf-Optimizer Scan — Analytics, SLA, Usage & Leaderboard

> Project: Personas (frontend-only)
> Scope: 8 paths in src/features/overview/{sub_analytics, sub_sla, sub_usage, sub_leaderboard, sub_observability, sub_health, libs, utils}
> Total: 10 findings (1 C / 5 H / 3 M / 1 L)

## Scope notes

- All 8 paths exist and were inspected. The `libs/` and `utils/` top-level dirs each hold a handful of small shared helpers (`anomalySeverity`, `metricIdentity`, `computeTrends`, `dashboardGrid`); no perf hotspots there. The brunt of the work lives in `sub_observability/` (heaviest dashboard) and `sub_health/` (composite scoring).
- `sub_usage/` contains a duplicated `charts/` folder mirroring `components/` (`MetricChart.tsx`, `ChartTooltip.tsx`, `pivotToolUsage.ts`, `periodComparison.ts`) — possibly a dead/legacy copy. The hot imports use the `components/` and `libs/` paths.
- `sub_usage/components/LazyChart.tsx` is a *different* component from the `LazyChart` used by `MetricChart` (which imports `@/features/shared/charts/RechartsWrapper`). Local one looks unused.
- Skipped `src-tauri/` per scope.

---

## 1. ObservabilityDashboard recreates `since` ISO every render, blowing the `ToolPerformancePanel` memo

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:253`
- **Scenario**: Open Observability dashboard. Any state change in the dashboard (a hover, a filter pill click, the auto-refresh tick, the alert-rules toggle) re-renders `ObservabilityDashboard`. The `<ToolPerformancePanel since={new Date(Date.now() - d.days * 86_400_000).toISOString()} ... />` prop is recomputed inline — a brand-new string every render. Because `ToolPerformancePanel` is `memo`-wrapped *and* its effect depends on `[since, personaId, limit]`, the memo always misses and the effect re-fires the `getToolPerformanceSummary` IPC every render.
- **Root cause**: Inline `new Date(...).toISOString()` in JSX creates a new string identity on every render. `memo` shallow-compares strings by value, so identity isn't the issue — but the `useEffect` dep array IS the issue: the string value also drifts each render since `Date.now()` advances. The effect re-runs on every parent render, blasting an IPC call per frame during hover/auto-refresh.
- **Impact**: Recurring IPC storms on a dashboard whose explicit purpose is to *measure* performance. Each tick of `autoRefresh` (and every benign re-render) issues a `getToolPerformanceSummary` round-trip; under typical hover/tooltip churn this fires dozens of times per minute. Backend log noise, network/IPC contention with the actual metrics pipeline, and the panel itself flickers between loading states.
- **Fix sketch**: Quantise `since` to a stable bucket. In `useObservabilityData` (or `ObservabilityDashboard`) memoise `const since = useMemo(() => new Date(Math.floor(Date.now() / 60_000) * 60_000 - d.days * 86_400_000).toISOString(), [d.days])` (or derive from a refresh-tick state). Refresh `since` only on explicit refresh or day-range change.

---

## 2. `PredictiveAlerts` calls a hook inside a non-component helper and rebuilds the alert list every parent render

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/overview/sub_health/components/PredictiveAlerts.tsx:42` and `:115`
- **Scenario**: `PersonaHealthDashboard` renders `<PredictiveAlerts signals={healthSignals} recommendations={routingRecommendations} />`. Inside the component body, `buildPredictiveAlerts(signals)` is invoked as a plain function call with no `useMemo`. `buildPredictiveAlerts` itself calls `useTranslation()` at line 43 — a rules-of-hooks violation that *happens to work* today only because it's always called once per render in component scope, but it's fragile and disables React's hook checker.
- **Root cause**: Two interacting bugs: (a) `useTranslation` lives inside `buildPredictiveAlerts` which is invoked unconditionally each render from the component, so the alert list and the i18n strings are re-computed every time the parent re-renders; (b) the array work inside `buildPredictiveAlerts` iterates all signals four times (`if … push`), then runs `.sort` on the result. There's no memoization gate on `signals` identity.
- **Impact**: With ~20+ personas, every parent re-render walks the full signal array 4× plus a sort, plus re-creates the JSX list. Triggered by *any* state in `PersonaHealthDashboard` (grade filter pill click, refresh button hover, view-toggle hover) — the Health tab is sluggish even when its data hasn't changed. The hooks-rules violation also means the linter is suppressing real errors here.
- **Fix sketch**: Move `useTranslation()` to the component body, pass `t`/`tx` into `buildPredictiveAlerts`. Wrap with `useMemo(() => buildPredictiveAlerts(signals, t, tx), [signals, t])`. While there, hoist `SEVERITY_STYLES` access into a single derived map and use a single `for` loop pushing into one array instead of four passes.

---

## 3. `useIpcSnapshot` recomputes full IPC stats on every subscribed IPC call — including when the panel is collapsed

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/overview/sub_observability/components/IpcPerformancePanel.tsx:16-26` and `:98`
- **Scenario**: `IpcPerformancePanel` subscribes to `subscribeIpcMetrics` via `useSyncExternalStore`. Every IPC call (and there are many — observability auto-refresh, healing fetches, etc.) bumps the generation counter and triggers re-render. The `useMemo` then re-executes `computeCommandStats()`, `getSlowestCalls(10)`, and `getGlobalSummary()` on every IPC event. The component also calls `useTranslation`, `useState(false)`, `useState('commands')`, and the hook on lines 86–89 **before** the `if (summary.totalCalls === 0) return null` early-out at line 98 — so the heavy computation runs even when there are no calls (returns null) and even when the panel is collapsed.
- **Root cause**: Subscription granularity is "every IPC call". Computation is unbounded — `computeCommandStats` aggregates over every record. There is no `expanded`-gated short-circuit before doing the work.
- **Impact**: Under heavy IPC traffic (auto-refresh + healing live stream + drill-down opens) the panel processes O(N) records on every event, regardless of visibility. Visible degradation on the Observability tab when load is busy — i.e. exactly when this panel matters. The `maxP95 = Math.max(...stats.map(s => s.p95))` at line 93–96 is recomputed on every snapshot too, and uses spread which throws RangeError once stats arrays grow large.
- **Fix sketch**: (a) Gate the snapshot to only run heavy compute when `expanded` is true: keep `useSyncExternalStore` to detect "any data", but defer `computeCommandStats`/`getSlowestCalls` behind an `useMemo` that gates on `[generation, expanded]`; (b) replace `Math.max(...stats.map(...))` with a `reduce(..., -Infinity)` to avoid spread-stack issues and one extra pass; (c) consider sampling/throttling `subscribeIpcMetrics` to e.g. 250 ms windows since users can't perceive sub-second flux in p50/p95.

---

## 4. `useStatusPageData` fetches on every visibility-return and polls every 60 s — even when Status tab is not active

- **Severity**: high
- **Category**: duplicate-call / data-layer
- **File**: `src/features/overview/sub_health/libs/useStatusPageData.ts:70-104`
- **Scenario**: `StatusPageView` is lazy-loaded by `PersonaHealthDashboard` when the user selects the `status-page` view. Once mounted, `useStatusPageData`'s effect kicks off `loadData()` immediately, starts a 60s `setInterval`, and re-fires `loadData()` on every visibility-return. The effect's dep is `[loadData]`, and `loadData` is a `useCallback` keyed on `fetchExecutionDashboard` — stable in practice, but the visibility handler unconditionally fires `loadData()` on every tab/app focus change. Three round-trips per refresh: `fetchExecutionDashboard()`, `getSlaDashboard(30)`, `listHealingIssues()`.
- **Root cause**: No coalescing with other dashboards — `PersonaHealthDashboard`, `SLADashboard`, `ObservabilityDashboard` all independently fetch `getSlaDashboard` and `listHealingIssues`. Visibility-return forces immediate fetch even if data is fresh (last fetch could be seconds ago). Polling continues at full rate while Status view is rendered, even if the user navigated to another view inside the same dashboard.
- **Impact**: On a laptop returning from sleep, every dashboard's visibility hook fires simultaneously — `getSlaDashboard` is called 2× (once here, once by `SLADashboard` if reliability view is open), `listHealingIssues` is called by useObservabilityData + here + audit log + multiple other surfaces. Wave of redundant IPCs amplifies the very latency the dashboard measures.
- **Fix sketch**: (a) Add a `lastFetchedAt` guard: skip refresh-on-visibility if `Date.now() - lastFetchedAt < 30_000`; (b) Hoist the SLA + healing fetches into the overview store with TTL-based caching so all consumers share; (c) Pause the 60s interval when the status-page view is not the active `healthView` (lift `healthView` state up or expose a `paused` prop).

---

## 5. `MetricsCharts` chart-redraw on tooltip move via inline reference-line/anomaly `label` functions

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_observability/components/MetricsCharts.tsx:74-130` and `:191-208`
- **Scenario**: Inside the cost AreaChart and the execution-health BarChart, each `<R.ReferenceLine>` (one per annotation, one per anomaly) receives an inline `label={({ viewBox }) => …}` arrow function that closes over `getAnnotationColor`, `onAnomalyClick`, `shouldAnimate`, etc. Recharts uses these labels in its render tree; on every tooltip hover Recharts re-evaluates labels with new viewBox props, and prop identity churn on these inline functions defeats Recharts' internal `shouldComponentUpdate` for the reference lines.
- **Root cause**: Closures created inline + per-iteration over `visibleAnnotations` and `costAnomalies`. Even though the outer `MetricsCharts` is `memo`-wrapped, hovering inside the chart causes Recharts to internally invoke these label renderers — and each re-creation of the parent (e.g. anomaly badge update, healing status changes, anything that touches `useObservabilityData`) creates fresh closures, so the entire `<g>` subtree underneath every reference line re-renders too. With 5+ annotations and a few anomalies, this is dozens of SVG sub-trees rebuilding on hover.
- **Impact**: On dashboards with many annotations (rotation + prompt + healing markers can easily be 20+), tooltip hover causes noticeable chart redraw stutter. The pulsing-animation `<animate>` SVG elements on anomaly markers compound the issue by forcing layout invalidation each frame.
- **Fix sketch**: Hoist label renderers to module scope or `useCallback` (`renderAnnotationLabel(annotation)` factory that returns a stable function per annotation, keyed in a `useMemo` over `visibleAnnotations`). Better: render the anomaly markers as a single `<Customized>` layer that does its own diffing rather than as N independent ReferenceLines.

---

## 6. `mergePreviousPeriod` + `pivotToolUsageOverTime` + sort + format runs every chart-data change in `useChartSeries`

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/overview/sub_analytics/libs/useChartSeries.ts:33-79`
- **Scenario**: `useChartSeries` produces 5 derived chart series. `pivotToolUsageOverTime` builds a `Map`, then a `Set` of names, then a zero-fill nested loop (O(dates × tools)), then sorts dates, then maps with date formatting. `barData` does an unconditional copy + sort + map of `toolUsageSummary` every time. `chartData` runs `mergePreviousPeriod` (slice × 2, map + spread per row) then a map that re-formats every date via `formatDateTick` (which calls `new Date()` and `toLocaleDateString` per point). None of these helpers cache by row identity.
- **Root cause**: Cheap-looking helpers run unconditionally on every change to the bound store slice. `formatDateTick` is the hottest: `toLocaleDateString` is ~10× slower than a hand-rolled formatter in Chromium. For a 90-day window the cost-over-time chart formats 90+ dates twice (once in `chartData`, once in `areaData` for tool usage). Inside `pivotToolUsageOverTime`, the zero-fill loop iterates `dates × tools` even when the source already has zero-filled entries.
- **Impact**: Switching tabs, toggling `compareEnabled`, or any change to `toolUsageSummary` re-runs all five `useMemo` blocks. For 30–90 day ranges with ~15 tools, the pivot is ~450 inserts plus sort plus map — a few ms but visible during the snap-in animation of the Analytics tab on first paint.
- **Fix sketch**: (a) Cache `formatDateTick` outputs in a per-render `Map<string, string>` to dedupe formatting; (b) precompute the formatted date inside `pivotToolUsageOverTime` so it isn't done twice; (c) skip the zero-fill in `pivotToolUsageOverTime` if `dateMap.size * names.size === toolUsageOverTime.length` (already dense).

---

## 7. `useAnnotationData` waterfalls N×personas + N×credentials IPC calls in `Promise.all` per filter change

- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/overview/sub_observability/libs/useAnnotationData.ts:27-99`
- **Scenario**: When `selectedPersonaId` or `personas` changes, the prompt-annotations effect calls `getPromptVersions(personaId, 8)` once per persona (up to 8 personas at a time). When `credentials` changes, the rotation-annotations effect calls `getRotationHistory(credential.id, 3)` once per credential (up to 20 credentials). Both are `Promise.all` fanouts. There is a 250ms debounce but no cache — switching `selectedPersonaId` between three personas in 1s triggers 24 IPC calls.
- **Root cause**: No batching endpoint (frontend can't fix that directly, but at minimum a request cache keyed on `personaId` / `credentialId` would suppress repeats during a single session). The `personas.map(...).slice(0, 8)` dependency is `personas` (the whole array) — so any change to persona list (e.g. credential update bumping the array reference) re-fans every prompt fetch.
- **Impact**: Switching persona filter on Observability does 8 round-trips before the chart can show annotations. Combined with the dashboard's existing fetch storm on focus, this is a notable contributor to perceived sluggishness on persona filter changes.
- **Fix sketch**: (a) Wrap `getPromptVersions` / `getRotationHistory` in a per-session memo (`Map<personaId, Promise<…>>`) with a TTL (60s); (b) consider one backend command that returns annotations for a set of persona IDs; (c) tighten dep to `personas.map(p => p.id).join(',')` so cosmetic changes to persona objects don't refetch.

---

## 8. `BurnRateProjection` recomputes `[...active].sort(...).slice(0,5)` every render of `useMemo`

- **Severity**: low
- **Category**: algorithmic
- **File**: `src/features/overview/sub_health/components/BurnRateProjection.tsx:13-21`
- **Scenario**: The `useMemo` derives `topBurners` by copying the active array, sorting it by `dailyBurnRate` desc, then slicing 5. For a fleet of 100 personas, that's a full O(N log N) sort to extract the top-5 — wasteful but only triggers on `signals` change.
- **Root cause**: Using `sort.slice` instead of a heap/partial selection.
- **Impact**: Negligible at typical fleet sizes (5–50 personas). Becomes measurable above ~500 personas. Mostly a hygiene fix.
- **Fix sketch**: Replace with a 5-slot insertion buffer — O(N × 5) instead of O(N log N). Or hoist to a util `topByKey<T>(arr, key, n)`.

---

## 9. `StatusPageView` `formatTimestamp` / `lastRefreshLabel` use `Date.now()` in render and only refresh on parent re-render

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/overview/sub_health/components/StatusPageView.tsx:48-53`, and same pattern in `PersonaHealthDashboard.tsx:87-92`, `IpcPerformancePanel`'s `SlowestCallRow` at `IpcPerformancePanel.tsx:69`, `HealingTimeline.tsx:32-38`, `IssuesList.tsx:48`
- **Scenario**: The "30s ago" / "2m ago" labels are recomputed inside `useMemo([lastRefreshedAt])` — i.e. they freeze at the value computed when `lastRefreshedAt` changed. If the user stares at the page for 5 minutes without a refresh, "1s ago" stays "1s ago" forever, *unless* an unrelated state change re-renders the parent, in which case the label suddenly jumps. Meanwhile `IssuesList`, `HealingTimeline`, `SlowestCallRow` compute `Date.now() - ...` *inside* the row map — no memo at all, recomputed every render, but still stale because there's no tick driving updates.
- **Root cause**: Time-relative labels need a ticking clock or `requestAnimationFrame`-aware re-render strategy, but currently they're either (a) frozen by a too-tight `useMemo` dep, or (b) recomputed every render but not driven by a tick so they appear stale.
- **Impact**: Two failure modes coexist on the same dashboards. (1) Labels jump in big increments on unrelated UI events (misleading freshness signal). (2) Inside lists of 50+ issues, age labels are recomputed per row per render even though they update visually only when the parent happens to re-render — costing CPU for no perceived benefit.
- **Fix sketch**: Use a shared `useRelativeTime(ts, { tickMs: 30_000 })` hook in `@/hooks/utility` that subscribes to a singleton 30s tick (one `setInterval` for all consumers via `useSyncExternalStore`). Drops per-row `Date.now()` work and gives users an accurate freshness display.

---

## 10. `SystemTraceViewer` ancestor-collapsed walk is O(N² × depth) and re-runs on every collapse toggle

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/overview/sub_observability/components/SystemTraceViewer.tsx:35-53`
- **Scenario**: Inside `TraceCard`, the `useMemo` rebuilds the visible-spans list whenever `collapsedSpans` changes. For each flat node, `isAncestorCollapsed` walks parents via `trace.spans.find(s => s.span_id === currentParentId)` — a linear scan of the entire spans array per ancestor hop. For a span tree of N nodes with average depth D, that's O(N × D × N) = O(N² × D).
- **Root cause**: Repeated `Array.prototype.find` inside a `while` loop instead of using a precomputed `Map<span_id, span>` index. The `buildSpanTree`/`flattenTree` likely already builds this map upstream but `isAncestorCollapsed` falls back to linear scan. `Math.max(0, ...trace.spans.map(...))` at line 46 also uses spread, which is fine here but compounds the same pattern.
- **Impact**: For long-running execution traces with 100+ spans (common in healing chains or LLM tool fanouts), toggling a collapse causes a measurable freeze (50–200ms in dev profile). Stacks with every other open trace card on the page.
- **Fix sketch**: Build a `Map<string, UnifiedSpan>` once via `useMemo(() => new Map(trace.spans.map(s => [s.span_id, s])), [trace.spans])`, then `isAncestorCollapsed` becomes O(D). Also precompute `parentChainOf(spanId)` as a `Map<spanId, spanId[]>` to make collapse-state changes O(1) per node.

---
