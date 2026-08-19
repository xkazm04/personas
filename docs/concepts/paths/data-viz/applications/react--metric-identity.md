---
layer: application
subject: data-viz
technique: metric-identity
stack: react
---

# Metric identity — React + Rust, as built here

Where this repo implements the technique's three pillars — a registered
contract, one derivation door, gated duplication — and where the gate is
still an intention rather than a mechanism.

## The registry of declared variants

`src/features/overview/libs/metricIdentity.ts` is the registered-divergence
pattern from the technique, verbatim: the display name "Success Rate"
legitimately appears on three surfaces with three windows, and instead of
three silent forks there is one `MetricIdentity` contract type (id, label,
source, timeWindow, kind, fields) and a registry:

```ts
// metricIdentity.ts:12 — each variant's id names surface + window + source
dashboardRecentExecutions: { id: 'success-rate.dashboard.recent-executions',
  source: 'globalExecutions', timeWindow: 'recent-50-or-filtered', … }
analyticsSummary:          { id: 'success-rate.analytics.summary',
  source: 'observability.summary', timeWindow: 'selected-day-range', … }
executionDashboardSummary: { id: 'success-rate.executions.summary', … }
```

All three resolve through the single `resolveMetricPercent()` (`:43`) — one
computation door, three declared windows. One edge inside that door cuts
against the subject's own standard, though: a missing or zero denominator
returns `0` (`:55-57`), collapsing "unmeasured" into "0%" at the derivation
edge — exactly the upstream decision the empty-and-degraded technique warns
about. Contrast with the better edge in `computeTrends.ts` below.

## One derivation, refusing to fabricate

`src/features/overview/libs/computeTrends.ts` documents itself as "the single
source of period-over-period splitting used across Overview" and enforces the
technique's honesty at the edges:

- `splitComparisonPeriods()` returns **null** unless a genuine two-period
  window was fetched (`:42-47`) — callers "must render NO trend rather than
  fabricate one from a single loaded window (the front-half/back-half
  heuristic that used to lie on the Home 'Runs' tile)".
- `makeTrend()` (`:82-96`) distinguishes sum metrics from average metrics at
  the zero-baseline edge: for averages, a prior-period 0 means "no samples",
  and presenting it as "+100%" would fabricate a delta from missing data — so
  it suppresses the trend. Unmeasured ≠ zero, applied at the derivation.

## Forced duplication — mirrors declared, gate missing

Two cross-language mirrors exist, both maintained by comment discipline:

1. `src/features/teams/sub_kpis/kpiMath.ts` ↔
   `src-tauri/src/engine/kpi_derivation.rs`. The TS side says it plainly:
   `kpiTrack()` is "the exact port of `engine/kpi_derivation.rs::kpi_is_off_track`
   (keep the two in sync)" (`kpiMath.ts:29-31`), and `kpiFloorBreached` mirrors
   `kpi_floor_breached`. Both sides carry their own unit tests
   (`kpi_derivation.rs:463+`), and the off-track vocabulary
   (`'floor' | 'crit' | 'pace'`, priority-ordered) matches across the pair.
2. `src/features/templates/sub_generated/shared/DimensionRadial.tsx:35` —
   `evaluateDimensions()` "mirroring the Rust `score_design_result()` logic in
   reviews.rs", including threshold constants (identity > 20 chars,
   instructions > 50) restated by hand on the TS side.

What neither pair has is the technique's **parity gate**: no shared fixtures,
no test that feeds both implementations the same inputs and fails on
divergence. Each side's suite stays green independently, so a threshold tweak
on one side (say, the Rust side's tolerance or a `> 50` becoming `>= 50`)
ships silently. The fixtures the gate needs already exist in embryo — the
Rust tests' `kpi(…)` constructor cases are exactly the shared-fixture shapes;
exporting those cases to a JSON file both suites read would convert the
comment into a mechanism.

## Where identity forked anyway

The counter-example the golden path's frontmatter carries:
`src/features/overview/components/shared/KpiTile.tsx:104` computes its own
sparkline scale (`Math.min(...data)` floor) instead of importing the declared
projection, and `sub_kpis/kpiMath.ts:93` exports a second `sparklinePoints()`
with the opposite scale doctrine from
`sub_director/directorScore.ts:38`'s fixed-domain exemplar — two exported
functions, same name, same purpose, contradictory semantics. That is the
display-site-arithmetic smell from the technique: the derivation layer is
centralized, but the *projection* layer forked because no shared helper took
the domain as a parameter.

## The provenance ceiling

The strongest local witness for "provenance is part of the value":
`src-tauri/db/src/repos/communication/sla.rs` merges raw executions with
retention-surviving rollups per day (`load_daily_trend`, max-by-total) — and
the wire type `src/lib/bindings/SlaDailyPoint.ts` has six fields, none of
which can say which source won. The merge computes the answer per point, then
drops it; the Reliability dashboard consequently renders a card and a chart
six lines apart over populations differing by ~32% with nothing on screen
admitting it (measured in full in the legacy data-provenance-disclosure
path). Fixing that starts at the transport type, not the pixel.
