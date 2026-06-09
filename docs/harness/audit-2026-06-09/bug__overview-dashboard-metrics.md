# Bug Hunter — overview-dashboard-metrics
> Total: 6
> Severity: 0 critical, 4 high, 2 medium, 0 low

## 1. Dashboard/observability fetches have no refetch-race guard — stale window overwrites fresh
- **Severity**: high
- **Category**: race-condition
- **File**: src/stores/slices/overview/overviewSlice.ts:350-398
- **Scenario**: User on Observability/Analytics clicks the day-range picker quickly: 90 → 7. The pipeline (`useExecutionDashboardPipeline.refresh`) issues `fetchExecutionDashboard(7)` and `fetchObservabilityMetrics(7)` while the 90-day calls are still in flight. The slow 90-day response resolves *after* the 7-day one and its `set({ executionDashboard, executionDashboardDays: 90, ... })` (line 392) / `set({ observabilityMetrics, ... })` (line 372) clobbers the correct 7-day data. The dashboard now shows 90-day numbers under a "Last 7 days" filter.
- **Root cause**: Unlike sibling actions `fetchGlobalExecutions` (guarded by `fetchGlobalSeq`, line 197/208/239) and `fetchGlobalExecutionCounts` (`fetchGlobalCountsSeq`, line 245), `fetchExecutionDashboard` and `fetchObservabilityMetrics` write to the store with no sequence/staleness check. The pipeline's `signal.cancelled` flag only flips on hook *unmount* (`useExecutionDashboardPipeline.ts:189`), not on filter change, and it only guards `settleAndReport`'s bookkeeping — never the store writes inside the fetch actions. So back-to-back filter changes within one mount overlap unguarded.
- **Impact**: UX degradation / data corruption — metrics, success rate, cost and chart series silently mismatch the active filter; users make decisions on the wrong window.
- **Fix sketch**: Add per-action monotonic sequence counters (mirror `fetchGlobalSeq`): capture `const seq = ++fetchDashboardSeq` at entry, and gate every `set(...)` on `if (seq === fetchDashboardSeq)`. Make this the mandatory pattern for *all* filter-dependent fetch actions so "last write wins" can never be the stale write.

## 2. `fetchObservabilityMetrics` builds a Frankenstein snapshot from two different windows
- **Severity**: high
- **Category**: state-corruption
- **File**: src/stores/slices/overview/overviewSlice.ts:354-372
- **Scenario**: With no persona filter, `canReuseDashboard` (line 355) is computed from `get().executionDashboard` + `get().executionDashboardDays === days` *before* the `await getOverviewBundle(days)` (line 357). During the await the dashboard can be replaced by a concurrent `fetchExecutionDashboard` for a *different* window (see finding #1). After the await the code still reuses the captured `dashboard` for `summary` (lines 362-369) but takes `chartData` from the freshly-awaited `bundle` (line 371). The committed `observabilityMetrics` then carries a summary from window A and a chart from window B.
- **Root cause**: A reuse decision and the value it reuses are read at one instant but consumed across an await boundary, with no recheck and no seq guard. The optimization assumes `executionDashboard` is immutable for the duration of the call.
- **Impact**: corruption — KPI tiles (cost, executions, success rate, active personas in `ObservabilityDashboard.tsx:209-212`) disagree with the chart directly beneath them; success-rate sparklines and headline totals derive from inconsistent denominators.
- **Fix sketch**: Re-read `get().executionDashboard`/`executionDashboardDays` *after* the await (or pass a captured snapshot into a pure builder and verify the window still matches), and gate the final `set` on a sequence counter. Better: derive summary and chart from a single bundle response so they can't come from different fetches.

## 3. `success_rate` / `executions` alert rules fire on an empty window (alarm on no data)
- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/overview/alertSlice.ts:63-66, 74-76, 94-100
- **Scenario**: A user creates the natural rule "alert if success_rate < 90%" (operator `<`). In a window with zero completed runs, `decided = successful + failed = 0`, so `value = 0` (line 65). Then `0 < 90` → `triggered = true` (line 97). A critical "Success rate is 0.0% (threshold: < 90%)" alert fires, persists, and toasts — even though nothing ran. Same for "executions < N": `value = totalExecutions = 0` always trips. The 1h cooldown only delays the next false fire.
- **Root cause**: The zero-data guard returns `0` instead of "undefined / skip evaluation". `0` is a legitimate-looking value that satisfies any `<`/`<=` threshold, so "no data" is indistinguishable from "catastrophic failure". The decided-denominator fix correctly avoids NaN but substitutes a misleading sentinel.
- **Impact**: UX degradation / alert fatigue — false critical alerts on idle days/personas; users learn to ignore the alert system (inverse success theater: red when there's simply nothing to measure).
- **Fix sketch**: When `decided === 0` for rate metrics (and when `totalExecutions === 0` for the `executions`/`cost_spike` metrics), return `{ triggered: false }` / skip the rule entirely rather than `value: 0`. Make `evaluateRule` return `{ value: number | null }` so a null value short-circuits comparison and the type system forces callers to handle "no data".

## 4. Panel status chips show green "loaded" when data fetched-but-empty or partial
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:66-72, 211
- **Scenario**: `PanelStatusChips` paints a green check for any source where `pipelineFetchedAt[key]` is set (line 66), regardless of whether the payload was empty or whether reuse produced a degraded summary. Separately, the success-rate KPI (line 211) shows `parseFloat(d.successRate)` → "0.0%" in a green-labelled "Success rate" tile when the window has zero executions (`useObservabilityData.ts:96-98` returns `'0'` for no data). A user with no runs sees a healthy-looking "Metrics ✓" chip and a red 0.0% success rate that reads as a real failure, not "no data".
- **Root cause**: "fetch succeeded" is conflated with "data is present and meaningful". The fetched-at timestamp is the only signal; there is no empty/degraded state.
- **Impact**: UX degradation — success theater (green on absent data) and false-negative readings (0% success on zero runs), eroding trust in the dashboard.
- **Fix sketch**: Distinguish three states per panel — error / fetched-empty / fetched-with-data — and render an explicit "No data in this window" treatment. For the success-rate tile, render an em-dash / "No runs" instead of "0.0%" when `summary.totalExecutions === 0`.

## 5. `sparklinePoints` divides by zero for a single-point series (Infinity coords)
- **Severity**: medium
- **Category**: divide-by-zero
- **File**: src/features/overview/sub_director/directorScore.ts:44-51
- **Scenario**: `x(i) = pad + (i / (scores.length - 1)) * (w - pad*2)`. With `scores.length === 1`, the divisor is `0`, yielding `NaN`/`Infinity` x-coordinates in the polyline `points` and the trailing dot. The current callers (`ScoreSparkline.tsx:21`, `PersonaCoachingTable.tsx:134`) guard with `scores.length >= 2`, so it's latent today — but the function is exported as shared geometry ("speak the same vocabulary"), documented only as "Assumes `scores.length >= 2`", and the next consumer that forgets the guard renders an invisible/garbage SVG with no error.
- **Root cause**: An unenforced precondition on a shared, exported pure function. The guard lives in callers, not at the boundary.
- **Impact**: UX degradation — broken sparkline (silent) for any future caller that passes a 1-element trend.
- **Fix sketch**: Make the function total: when `scores.length < 2`, return a degenerate-but-valid result (e.g. a single centered point / flat segment) instead of relying on every caller to pre-check. Use `Math.max(1, scores.length - 1)` as the divisor so the math can never produce Infinity.

## 6. Heatmap grid bucketing mixes local-time and UTC date math
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:77-110, 134-147
- **Scenario**: `buildGrid` anchors "today" via `new Date()` + `setHours(0,0,0,0)` (local) and keys cells with `formatIso` using local `getFullYear/getMonth/getDate` (line 134-139). But the server's `data.days[].date` strings and `formatHumanDate` (line 143-146) interpret dates as UTC (`Date.UTC(...)`). For a user in a negative UTC offset late in the day, the locally-computed "today" ISO can be one calendar day ahead of the UTC bucket the backend emitted, so the rightmost column / today's count can land in the wrong cell or read empty, and the cell's hover tooltip date (UTC) won't match the cell it's anchored to.
- **Root cause**: No single timezone convention for "what day is this run on" between the server aggregation and the client grid; local `Date` arithmetic is silently mixed with UTC formatting.
- **Impact**: UX degradation — off-by-one day in the contribution graph, today's activity occasionally invisible, tooltip/cell date mismatch near midnight.
- **Fix sketch**: Pick one convention end-to-end (the monthly-spend path already passes `utcOffsetMinutes`; do the same for the heatmap) and build the grid in that timezone. Replace local `getDate()`-based `formatIso` with the same UTC basis used by `formatHumanDate`, or have the backend return both the date and the offset it bucketed against.
