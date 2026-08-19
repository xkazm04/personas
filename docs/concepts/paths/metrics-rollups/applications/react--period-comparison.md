---
layer: application
subject: metrics-rollups
technique: period-comparison
stack: react
---

# Period comparison in the Overview dashboard

The Overview comparison pipeline is a faithful instance of the one-doubled-
read discipline on the fetch side, with one precondition violation on the
split side that the technique now names explicitly.

## The confirmed pattern

- **One 2×-window fetch** — when compare mode is on,
  `useExecutionMetrics` (`src/features/overview/sub_activity/libs/useExecutionMetrics.ts:39`)
  fetches `previousPeriodDays` (the doubled window) in a single
  `fetchExecutionDashboard` call. There is no second request for the prior
  period anywhere in the pipeline — one filter interpretation, one snapshot,
  one failure domain.

- **Split locally, render as ghost series** — `mergePreviousPeriod`
  (`src/features/overview/sub_usage/libs/periodComparison.ts:23-47`) splits
  the returned array and merges the previous half onto the current rows as
  `prev_*` keys for ghost lines.

- **Null over fabrication** — `splitComparisonPeriods`
  (`src/features/overview/libs/computeTrends.ts:37-48`) is documented as "the
  single source of period-over-period splitting used across Overview" and
  returns `null` unless compare mode is active AND a non-empty prior half
  exists; its docstring names the defect it retired (a front-half/back-half
  heuristic that fabricated a trend from a single loaded window on the Home
  "Runs" tile). `computeSeriesTrendPct` returns `null` when the prior period
  summed to zero. `makeTrend` (`computeTrends.ts:82-96`) branches before
  dividing: 0→0 is `stable`, and for average-shaped metrics a zero baseline
  is treated as "no samples", suppressing the delta instead of printing a
  fabricated +100%.

- **Derived-object output** — `computePeriodTrends` returns one
  `MetricTrends` structure (value + direction per metric) consumed by the
  KPI cards, rather than letting each tile do its own `(a-b)/b`.

## The two divergences from the standard

1. **Ordinal split over a sparse feed.** Both splitters cut at
   `points.length - periodDays` (`periodComparison.ts:30`,
   `computeTrends.ts:43`) — a positional boundary that presumes a dense
   series. The feed is not dense: `get_execution_dashboard`
   (`src-tauri/db/src/repos/execution/metrics.rs:1181-1196`) emits
   `daily_points` from a `GROUP BY DATE(...)` with **no zero-fill step**, so
   any day with zero executions shifts the split boundary by one. On a
   quiet install the "previous half" is the first N surplus points — not the
   previous period. The technique's dense-series precondition ("the split
   point is a moment in time, not a position in an array") is this finding,
   generalized. Fix shape: densify over the effective window before
   splitting, or split on the bucket date.

2. **Previous = 0 on sum metrics renders +100%.** `makeTrend` deliberately
   maps "no activity → some activity" to `+100% up` for cost/executions
   (`computeTrends.ts:84-91`, with rationale in the comment). The standard
   prefers a categorical **new** rendering; this is a declared, documented
   variant rather than a collapsed branch — the branch exists, only the
   final rendering differs.

Also worth noting against [aggregate-honesty](../techniques/aggregate-honesty.md):
`avgField` (`computeTrends.ts:76-80`) compares unweighted means of per-day
`successRate` and per-day `p50` — a mean of daily means (weight-blind) and a
mean of daily percentiles (percentiles do not compose by averaging). The
composable parts exist server-side; the trend layer flattens them.
