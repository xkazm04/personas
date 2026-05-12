# Code-refactor scan — Analytics, SLA, Usage & Leaderboard

> Total: 11 findings (3 high, 5 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: scoped paths `src/features/analytics`, `src/features/sla`, `src/features/usage`, `src/features/leaderboard`, `src/features/dashboard/kpi`, `src/api/{analytics,sla,usage,leaderboard}.ts`, `src/lib/analytics`, `src/stores/slices/{analyticsSlice,slaSlice,usageSlice}.ts`, `src-tauri/src/commands/{analytics,sla,usage,leaderboard}.rs`, `src-tauri/src/db/models/analytics.rs`, `src-tauri/src/db/repos/analytics` do NOT exist. Actual locations: `src/features/overview/sub_{analytics,sla,usage,leaderboard}`, `src/api/overview/sla.ts`, `src-tauri/src/commands/communication/sla.rs`, `src-tauri/src/commands/infrastructure/tier_usage.rs`, `src-tauri/src/db/repos/communication/sla.rs`, `src-tauri/src/db/repos/execution/tool_usage.rs`. Slices live under `src/stores/slices/overview/` (`overviewSlice.ts`, `personaHealthSlice.ts`) — there are no dedicated analytics/sla/usage slices.

## 1. Entire `sub_usage/charts/` directory is orphaned (271 LOC dead)

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_usage/charts/ChartErrorBoundary.tsx:1` (and 4 siblings)
- **Scenario**: `sub_usage/charts/` contains 5 files — `ChartErrorBoundary.tsx` (58 LOC), `ChartTooltip.tsx` (57 LOC), `MetricChart.tsx` (72 LOC), `periodComparison.ts` (48 LOC), `pivotToolUsage.ts` (42 LOC). Zero importers in the codebase (`grep "sub_usage/charts"` returns no matches outside the directory itself). The `sub_usage/index.ts` barrel re-exports only the `components/` and `libs/` siblings. `ChartErrorBoundary.tsx` is byte-identical to `components/ChartErrorBoundary.tsx`; the others are drift-only variants (e.g. `charts/pivotToolUsage.ts` lacks the zero-fill step that `libs/pivotToolUsage.ts` adds — see `libs/pivotToolUsage.ts:43-47`).
- **Root cause**: Likely an in-progress refactor where files were copied from `charts/` → `components/`+`libs/` and the originals were never removed. Their doc comments even acknowledge each other (`charts/pivotToolUsage.ts:13`: "unlike the `libs/` sibling, this variant does NOT zero-fill…").
- **Impact**: 271 LOC of phantom maintenance surface; risk of a future contributor importing the stale variant and re-introducing the pivot zero-fill bug or losing the ChartTooltip MetricUnit lookup.
- **Fix sketch**: Delete the directory `src/features/overview/sub_usage/charts/`. Confirm `tsc --noEmit` is clean.

## 2. `sub_usage/DashboardFilters.tsx` is dead — superseded by 3 split files

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_usage/DashboardFilters.tsx:1`
- **Scenario**: 254-LOC file exporting `DayRangePicker`, `DateRangePopover`, `CompareToggle`, `PersonaSelect`. Grep for `sub_usage/DashboardFilters` and `from '.*DashboardFilters'` returns no matches. The active code imports each of the four components from the split files in `sub_usage/components/{DayRangePicker,PersonaSelect}.tsx`, and the barrel `sub_usage/index.ts` re-exports only from `components/`.
- **Root cause**: Aborted decomposition — the monolithic file was split into focused components but the original was never removed.
- **Impact**: 254 LOC orphaned. Drift risk: changes made here (e.g. accessibility improvements, fix for the `formatRangeLabel` `--` separator) will not flow to the live components.
- **Fix sketch**: Delete `sub_usage/DashboardFilters.tsx`. Diff against the split files first to harvest any unique improvements (the monolithic version uses `t.overview.filters.start_date` translation keys while `components/DayRangePicker.tsx:99-103` uses hardcoded "Start Date"/"End Date" — that translation fix should be moved to the live file before deletion).

## 3. `fmtCost` re-implemented 4 times across hot paths

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts:1`
- **Scenario**: Same `(v: number) => v < 0.01 ? '<$0.01' : '$' + v.toFixed(2)` formatter is defined in:
  1. `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts:1`
  2. `src/features/agents/sub_executions/libs/comparisonHelpers.ts:27`
  3. `src/features/agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:12`
  4. `src/features/agents/sub_lab/libs/reportGenerator.ts:47`

  Meanwhile `src/lib/utils/formatters.ts:53` already provides a canonical `formatCost(usd, { precision: 2|4|'auto' })` with the same sub-penny semantics.
- **Root cause**: Each feature wrote its own quick formatter; the central `formatCost` arrived later (`sub_sla/libs/slaHelpers.ts:8` already migrated `formatDuration` to use the central form).
- **Impact**: Drift risk — `reportGenerator.ts:47` is a slightly different impl that may diverge on negative values; sub-penny threshold changes need 4 edits.
- **Fix sketch**: Delete all four `fmtCost` definitions; have each call-site `import { formatCost } from '@/lib/utils/formatters'`. Confirm `reportGenerator.ts` HTML escaping is preserved (it uses `fmtCost` in template strings — same output, no escaping needed).

## 4. `MEDAL_*` / `TREND_ICON` config duplicated across 3 leaderboard sites

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_leaderboard/components/PodiumStep.tsx:51`
- **Scenario**: Same medal-and-trend visual config repeated:
  - `src/features/overview/sub_leaderboard/components/LeaderboardCard.tsx:8-25` defines `MEDAL_CONFIG` (gold/silver/bronze → bg/border/text) + `TREND_ICON` (improving/stable/degrading → Icon/color)
  - `src/features/overview/components/dashboard/widgets/TopPerformersWidget.tsx:8-18` defines `MEDAL_STYLES` (same keys/values) + `TREND_ICON` (identical shape)
  - `src/features/overview/sub_leaderboard/components/PodiumStep.tsx:18-55` defines `PODIUM_CONFIG` (superset: same medals + extra ring/step classes) + `TREND` (same trend map)

  Also `src/features/overview/components/shared/TrendIndicator.tsx` exists as a centralised trend-arrow component but is not used by any of the three.
- **Root cause**: Copy-paste during widget expansion; the centralised `TrendIndicator` predates `TREND_ICON` but wasn't adopted because callers wanted the bare icon, not the labelled span.
- **Impact**: Visual drift risk — gold's amber color or trend's emerald color cannot be tuned in one place. ~30 LOC of repeated config across the 3 sites.
- **Fix sketch**: Extract `MEDAL_TOKENS` and `TREND_TOKENS` to `src/features/overview/sub_leaderboard/libs/leaderboardTokens.ts`. Have `LeaderboardCard`, `TopPerformersWidget`, `PodiumStep` import from there. `PodiumStep`'s podium-specific overlays (ring, step height) can stay local since they are unique.

## 5. `mergePreviousPeriod` exists in two near-identical files

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_usage/charts/periodComparison.ts:23`
- **Scenario**: Function bodies are functionally identical; only cosmetic differences (one inline comment trimmed, one comment-divider style). See `charts/periodComparison.ts:23-48` vs `libs/periodComparison.ts:23-47`. Active importers (`sub_analytics/libs/useChartSeries.ts:5`, `sub_activity/libs/useExecutionMetrics.ts:6`) all use the `libs/` variant. (Subsumed by Finding #1 — listed separately because the duplication semantics differ from the orphan story: even if a developer adopted the `charts/` variant, the behavior would be identical to `libs/` for this function.)
- **Root cause**: Same as Finding #1.
- **Impact**: See Finding #1.
- **Fix sketch**: Delete `charts/periodComparison.ts` as part of the Finding #1 cleanup.

## 6. `pivotToolUsageOverTime` `charts/` variant has a known bug `libs/` already fixed

- **Severity**: medium
- **Category**: dead-code / cruft
- **File**: `src/features/overview/sub_usage/charts/pivotToolUsage.ts:22`
- **Scenario**: `charts/pivotToolUsage.ts:13` doc-comment admits "unlike the `libs/` sibling, this variant does NOT zero-fill missing (date, tool) cells, so consumers must tolerate `undefined` values" — i.e. the file is a known-buggy older copy. The active code path (via `sub_analytics/libs/useChartSeries.ts:6`) imports the zero-filling `libs/` variant.
- **Root cause**: Pre-fix copy retained.
- **Impact**: 42 LOC of code documented as broken. Any contributor who autocompletes to `charts/pivotToolUsage` will silently re-introduce the NaN-tooltip bug that the doc explicitly warns about.
- **Fix sketch**: Delete `charts/pivotToolUsage.ts` (covered by Finding #1).

## 7. `sub_usage/components/LazyChart.tsx` is dead — shadowed by `shared/charts/RechartsWrapper`

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/overview/sub_usage/components/LazyChart.tsx:14`
- **Scenario**: This module exports a `LazyChart` with props `{ height, children }` (IntersectionObserver-based viewport lazy mount). Zero importers — all 10+ call-sites import `LazyChart` from `@/features/shared/charts/RechartsWrapper` instead, which has a different signature `{ render, fallback }` (Recharts module lazy load). The name clash is not a re-export — they are two independent implementations of "lazy chart".
- **Root cause**: An older viewport-deferred lazy-chart pattern survived the migration to the Recharts module-lazy-load pattern in `shared/charts/RechartsWrapper`.
- **Impact**: 52 LOC dead. Worse, autocomplete may suggest the wrong `LazyChart` to a developer in `sub_usage/`, leading to a type error or silent regression.
- **Fix sketch**: Delete `src/features/overview/sub_usage/components/LazyChart.tsx`. Confirm with `grep -r "sub_usage/components/LazyChart"` that nothing imports it.

## 8. Deprecated `GRID_STROKE` / `AXIS_TICK_FILL` constants only re-exported in barrel

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/overview/sub_usage/libs/chartConstants.ts:32`
- **Scenario**: `GRID_STROKE` and `AXIS_TICK_FILL` are declared with `@deprecated` JSDoc on lines 31 and 33 of `chartConstants.ts`. The only remaining reference is the barrel `sub_usage/index.ts:11` which re-exports them. Live charts use the `getGridStroke()` / `getAxisTickFill()` theme-aware getters.
- **Root cause**: Backward-compat shim outlasted its migrators.
- **Impact**: 4 LOC of pretend API surface; a contributor may import the deprecated constant and bypass theme awareness.
- **Fix sketch**: Remove the deprecated exports from `chartConstants.ts:31-34` and the corresponding line in `sub_usage/index.ts:11`. Run `tsc --noEmit` to ensure nothing imported them.

## 9. Inline `month: 'short', day: 'numeric'` date formatter repeated ~14 sites

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_analytics/libs/analyticsHelpers.ts:11`
- **Scenario**: `formatDateTick(dateStr)` is locally defined in `sub_analytics/libs/analyticsHelpers.ts:11`, and the same `{ month: 'short', day: 'numeric' }` `toLocaleDateString` pattern is inlined at:
  - `src/features/overview/sub_activity/libs/executionMetricsHelpers.ts:6` (as `fmtDate`)
  - `src/features/overview/sub_usage/DashboardFilters.tsx:62` (in `formatRangeLabel`)
  - `src/features/overview/sub_usage/components/DayRangePicker.tsx:44`
  - `src/features/overview/sub_observability/components/MetricsCharts.tsx:19` (as `DATE_AXIS_FORMATTER`)
  - `src/features/home/components/cockpit/CockpitPanel.tsx:200`
  - `src/lib/types/timeRange.ts:63`
  - `src/features/pipeline/sub_teamMemory/components/timeline/TimelineItem.tsx:15`
  - …and ~7 more sites across schedules/triggers/vault.
- **Root cause**: No central "short-date tick" formatter; each consumer wrote its own.
- **Impact**: ~14 sites must be co-edited for any localization or i18n date-format change. `analyticsHelpers.ts` has the cleanest version (memoizes the `Intl.DateTimeFormatOptions` constant).
- **Fix sketch**: Add `formatShortDate(iso)` to `src/lib/utils/formatters.ts` (handles both `YYYY-MM-DD` and ISO-with-T). Migrate the 14 sites in a dedicated wave. Keep `sub_analytics/libs/analyticsHelpers.ts:formatDateTick` as a 1-line re-export until the wave lands, then delete.

## 10. `MetricsCharts` lives in both `sub_activity` and `sub_observability` with overlapping responsibilities

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/overview/sub_activity/components/MetricsCharts.tsx:1`
- **Scenario**: Two `MetricsCharts.tsx` components (179 LOC + 214 LOC). Both render Recharts dashboards over the same `MetricsChartPoint` shape, both pull from `sub_usage/libs/chartConstants` (`CHART_COLORS`, `CHART_COLORS_PURPLE`, `CHART_GRAD`, `getGridStroke`, `getAxisTickFill`), both hoist a `TOOLTIP_CONTENT` constant for Recharts ref-identity, both wrap charts in `ChartErrorBoundary` and `LazyChart`. Chart sets differ (activity: cost-per-day stacked area + executions-by-status + success-rate + latency; observability: cost-over-time + executions pie + execution health bars), but ~60 LOC of axis-tick/legend memos, gradient setup, and tooltip wiring is structurally identical. They cannot be merged into one component without violating their domain split, but the shared scaffolding (Tooltip stable ref, axis-tick `useMemo({fill, fontSize})`, legend style) is duplicated.
- **Root cause**: Each sub-dashboard was built independently, taking the canonical "metrics chart wall" recipe with it.
- **Impact**: A typography or theme adjustment requires touching both files. ~60 LOC of true duplication inside two larger components.
- **Fix sketch**: Extract `useChartChrome(sf)` hook returning `{ axisTick, legendStyle, gridStroke, TOOLTIP_CONTENT }` to `src/features/overview/sub_usage/libs/useChartChrome.ts`. Have both `MetricsCharts.tsx` files call it. Out of scope: merging the chart sets — they correctly belong to different sub-domains.

## 11. `slaHelpers.formatPercent` is the only `formatPercent` — no rate-to-percent utility centrally

- **Severity**: low
- **Category**: structure
- **File**: `src/features/overview/sub_sla/libs/slaHelpers.ts:3`
- **Scenario**: `formatPercent(rate) => (rate * 100).toFixed(1) + '%'` is defined only here despite the codebase having dozens of `*.toFixed(1) + '%'` inline call-sites. Not a duplication finding — a missing-central-util finding. `slaHelpers.ts` is a 26-LOC file with three formatters (`formatPercent`, `formatMtbf`, an aliased `formatDuration`) and one color picker (`slaColor`). The MTBF formatter (`formatMtbf`) is genuinely SLA-specific (seconds-based, decays s→m→h→d), but `formatPercent` is generic.
- **Root cause**: The file was created as a feature-local helper before the codebase grew a `lib/utils/formatters.ts` standard.
- **Impact**: Low. Future percent-formatting wave will have to grep for the pattern across many sites.
- **Fix sketch**: Add `formatPercent(value, opts?: { fromRate?: boolean; precision?: number })` to `src/lib/utils/formatters.ts`. Have `slaHelpers.ts:formatPercent` re-export it for one wave, then migrate `sub_sla` call-sites (`SLACard.tsx:62, 123`) to the central util. Keep `formatMtbf` local — it has SLA-specific semantics.
