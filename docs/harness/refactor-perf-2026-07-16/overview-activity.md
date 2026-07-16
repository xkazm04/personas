# overview/activity — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 2 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 12 | Missing: 0

## 1. `pendingExecutionFocus` fallback fetch can loop indefinitely when the target row never loads
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: fetch-loop
- **File**: src/features/overview/sub_activity/components/GlobalExecutionList.tsx:181
- **Scenario**: A notification click parks an execution id in `pendingExecutionFocus` that is NOT in the first page of `globalExecutions` (old execution beyond the page cap, or a pruned/deleted row). The effect fires `fetchGlobalExecutions(true)`; the store fetch replaces `globalExecutions` with a new array reference, which re-runs the effect (deps include `globalExecutions`), which still finds no match, which fetches again — a tight refetch loop for as long as the Activity tab is mounted.
- **Root cause**: The "not loaded yet — kick a one-off fetch" branch has no attempt guard and never clears `pendingExecutionFocus` on failure to find the row; the effect's own side effect (a store write producing a fresh array) is in its dependency list. The comment claims "the next render that includes the row will re-fire this effect" but there is no guarantee the row ever appears (fetch is also issued without the id or a targeted lookup, and it drops the active status filter, clobbering the filtered list as a side effect).
- **Impact**: Unbounded repeated Tauri invokes + SQLite queries + full list re-renders on a user-facing tab — CPU/battery drain and backend hammering that only stops when the user navigates away. Also silently resets the status-filtered page to unfiltered data.
- **Fix sketch**: Track a `fetchAttemptedFor` ref: on first miss, fetch once (preserving `statusParam`); on second miss for the same id, call `setPendingExecutionFocus(null)` (optionally toast "execution not found") and bail. Better: fetch the single execution by id via a dedicated store/API call instead of refetching the whole page hoping it appears.

## 2. `ExecutionRow.tsx` and the `sub_activity/index.ts` barrel are dead code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_activity/components/ExecutionRow.tsx:18
- **Scenario**: Grep across `src/` shows nothing imports from `@/features/overview/sub_activity` (the barrel) — the sole consumer (`ExecutionsWithSubtabs.tsx`) imports `GlobalExecutionList` directly from its component path. `ExecutionRow` is referenced only by that unused barrel; `GlobalExecutionList` renders its rows inline via `GroupedVirtualList` and never uses it.
- **Root cause**: The list was rewritten to a virtualized inline-row grid; the older expandable `ExecutionRow` component and the barrel exports were left behind.
- **Impact**: 89 lines of stale UI (with its own `ExecutionDetail` embed pattern that diverges from the current `ExecutionDetailModal` flow) that a future editor could mistakenly "fix" or reuse; the barrel also falsely advertises `ExecutionMetricsDashboard`/`ExecutionRow` as the module's public API.
- **Fix sketch**: Delete `components/ExecutionRow.tsx` and either delete `index.ts` or trim it to the actually-consumed export. One caveat: verify no dynamic/lazy import of the barrel outside `src/` (e2e/harness scenarios) before removing — grep for `sub_activity` found only the agents-feature namesake.

## 3. `useAthenaUsage` / `useLlmSpend` are copy-paste twins, and their sections duplicate the cost-per-day chart + bar-breakdown blocks
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_activity/libs/useLlmSpend.ts:13
- **Scenario**: The two hooks are byte-for-byte identical except for the API function and binding type (same state trio, same `load` callback, same silentCatch-to-error mapping, same return shape). Their consuming sections (`AthenaUsageSection.tsx`, `LlmSpendSection.tsx`) then each re-implement the same hoisted `TOOLTIP_CONTENT`/`COST_AXIS_FORMATTER`, the same `humanize` logic (also inside `useActionLabel`), the same "loading && !data → null" gate, the same ranked-bar row markup, and a near-identical Recharts AreaChart differing only in stroke color.
- **Root cause**: `LlmSpendSection` was built by mirroring `AthenaUsageSection` (the docstring says so) without extracting the shared fetch/presentation primitives first.
- **Impact**: Every tweak to the spend-lane UX (bar row styling, empty-state copy, tooltip, loading gate) now needs two synchronized edits across four files; drift has already started (`$`-formatter named `COST_AXIS_FORMATTER` here vs `PERCENT_TICK_FORMATTER` in MetricsCharts).
- **Fix sketch**: Extract a generic `useDashboardFetch<T>(fetch: (days: number) => Promise<T>, tag: string)` hook that both wrap in one line each. Extract a shared `RankedCostBars({ rows, label, accent })` component and a `DailyCostAreaChart({ data, stroke })` wrapper (which also absorbs the hoisted tooltip/formatter constants) into `sub_activity/components/shared` or next to `executionMetricsHelpers.ts`; MetricsCharts' top-personas block can reuse `RankedCostBars` too.

## 4. `useExecutionMetrics` computes and returns `trends` that no consumer uses
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_activity/libs/useExecutionMetrics.ts:102
- **Scenario**: The hook's only consumer is `ExecutionMetricsDashboard`, which never reads `m.trends` — its KPI tiles are rendered without `trend` props. `computePeriodTrends` runs (memoized) on every data/range change for nothing.
- **Root cause**: The docstring says `trends` was added "for the KPI cards", but the dashboard's KpiTile calls were never wired to it (the sub_observability dashboard has its own separate `trends` pipeline).
- **Impact**: Dead computation plus a misleading contract — the doc comment actively points future readers at a feature that doesn't exist in the UI. Cost is small (memoized, bounded input), so this is cleanup, not perf.
- **Fix sketch**: Either wire `trend={m.trends?.cost}` etc. into the four KpiTiles in `ExecutionMetricsDashboard.tsx` (matching the sub_observability dashboard's card-rich pattern), or delete the `trends` memo, its return-object entry, the `computePeriodTrends` import, and the docstring sentence.
