# overview/usage — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 4 medium / 0 low)
> Context group: Observability & Monitoring | Files read: 12 | Missing: 5

## 1. DashboardFilters.tsx is a dead 254-line file triplicating three live components
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_usage/DashboardFilters.tsx:1
- **Scenario**: Grep across `src/` shows zero imports of `DashboardFilters.tsx`; every consumer (ObservabilityDashboard, ExecutionMetricsDashboard, DashboardHomeMissionControl, ReviewFilterTrailing) imports `components/DayRangePicker.tsx` and `components/PersonaSelect.tsx` instead. The dead copy still contains full older implementations of `DayRangePicker`, `DateRangePopover`, `CompareToggle`, and `PersonaSelect`.
- **Root cause**: The components were split out into `components/` but the original monolithic file was never deleted. The copies have already diverged: the live `DateRangePopover` uses `DebtText` i18n keys and the live `PersonaSelect` renders `PersonaSelectorModal`, while the dead copy still uses `t.overview.filters.*` and `ThemedSelect`.
- **Impact**: 254 lines of drift-prone dead weight. A grep-driven edit (i18n sweep, design-token rename, a11y fix) can land in the dead copy and silently vanish, or double the review surface. The stale `PersonaSelect`/`ThemedSelect` version also misleads readers about the current UX.
- **Fix sketch**: Delete `src/features/overview/sub_usage/DashboardFilters.tsx` entirely. Also note it exports a duplicate `DayRange` type alias — the live one in `components/DayRangePicker.tsx` remains. Run `tsc` to confirm nothing referenced it (grep already shows nothing does).

## 2. Local components/LazyChart.tsx is dead and shadows the shared LazyChart with an incompatible API
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_usage/components/LazyChart.tsx:14
- **Scenario**: `MetricChart.tsx` imports `LazyChart` from `@/features/shared/charts/RechartsWrapper` (props: `fallback`/`render`), not this local file (props: `height`/`children`). Grep shows no importer of `sub_usage/components/LazyChart` anywhere.
- **Root cause**: The IntersectionObserver-based lazy wrapper was superseded by the shared RechartsWrapper `LazyChart` (which also lazy-loads the recharts module), but the old file was left behind.
- **Impact**: A same-named component with a different prop contract one directory away from its live namesake is a classic wrong-import trap for autocomplete; 53 dead lines.
- **Fix sketch**: Delete `src/features/overview/sub_usage/components/LazyChart.tsx`. If the viewport-deferral behavior (IntersectionObserver, 200px rootMargin) is still desired, fold it into the shared `RechartsWrapper` LazyChart instead of keeping a parallel implementation.

## 3. Unused index.ts barrel keeps pivotToolUsage.ts and deprecated constants alive
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_usage/index.ts:1
- **Scenario**: No file imports `@/features/overview/sub_usage` (the barrel) — all 20+ consumers import deep paths (`sub_usage/components/...`, `sub_usage/libs/...`). The barrel is therefore dead, and `pivotToolUsageOverTime` (libs/pivotToolUsage.ts, 55 lines) is referenced ONLY by this dead barrel — dead transitively. The barrel also re-exports the `@deprecated` `GRID_STROKE`/`AXIS_TICK_FILL` constants and `CHART_HEIGHT`/`METRIC_UNITS_BY_KEY`, none of which have external consumers.
- **Root cause**: Barrel created for a public-API convention the codebase does not actually follow; the pivot helper's chart consumer appears to have been removed (the old `charts/` directory in this context spec is gone).
- **Impact**: Dead surface that defeats "find usages" reasoning and keeps deprecated exports looking alive; the barrel would also drag every chart lib into any chunk that imported it.
- **Fix sketch**: Delete `index.ts` and `libs/pivotToolUsage.ts` (verify with tsc; grep shows `pivotToolUsageOverTime` has no callers). While there, drop the deprecated `GRID_STROKE`/`AXIS_TICK_FILL` aliases from `chartConstants.ts` if no external references remain (grep shows the getter functions are what consumers use).

## 4. ChartTooltip constructs a new Intl.NumberFormat per USD value on every mousemove
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_usage/components/ChartTooltip.tsx:18
- **Scenario**: Recharts re-invokes the tooltip component on every pointer move over a chart. For each payload entry with a `usd` unit, `defaultFormatter` executes `new Intl.NumberFormat(undefined, { style: 'currency', ... })` — a comparatively expensive constructor (locale resolution + ICU data lookup) — dozens of times per second while hovering cost charts (TrafficErrorsChart, sub_observability MetricsCharts).
- **Root cause**: The count formatter was correctly hoisted to module scope (`defaultNumberFormatter`), but the currency formatter is created inline inside the switch.
- **Impact**: Avoidable per-frame allocation/CPU on the hover hot path of every cost chart; can contribute to tooltip jank on large dashboards, especially in a Tauri webview.
- **Fix sketch**: Hoist `const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })` to module scope next to `defaultNumberFormatter` and use it in the `'usd'` case.

## 5. getGridStroke/getAxisTickFill call getComputedStyle on every render, including inline in hover-hot JSX
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_usage/libs/chartConstants.ts:23
- **Scenario**: `getCSSVar` runs `getComputedStyle(document.documentElement)` on each call. Consumers call it once per render (`const gridStroke = getGridStroke()` in 5 chart files) — and `TrafficErrorsChart.tsx:66-68` calls it three times inline in JSX props. Recharts charts re-render on every tooltip mousemove, so each hover frame triggers repeated computed-style reads, each of which can force a style recalculation if styles are dirty.
- **Root cause**: The theme-responsive lookup has no caching layer; every chart resolves the same two CSS variables from scratch on every render.
- **Impact**: Repeated forced style reads on the hover hot path across all dashboards; multiplied by 5-10 charts per page. Bounded but pure waste — the values only change on theme switch.
- **Fix sketch**: Memoize the resolved values in module scope keyed by the current theme (e.g. cache in a variable, invalidate via the existing theme-toggle path or a `MutationObserver` on `document.documentElement`'s class/data-theme attribute). Alternatively expose a `useChartTheme()` hook that reads once per theme change and lets components pass stable values down. At minimum, hoist the three inline calls in `TrafficErrorsChart` into per-render consts like the other chart files do.
