---
subject: data-viz
evidence:
  - src/features/overview/sub_usage/components/MetricChart.tsx     # canonical chart panel: required height reserves the box, per-chart error boundary, lazy engine
  - src/features/shared/charts/RechartsWrapper.tsx                 # the single deferred chart-engine chunk for the whole app (render-prop, one shared import)
  - src/features/overview/sub_usage/components/LazyChart.tsx       # viewport-deferred mounting: one-shot observer, geometry-matched skeleton, reaper on unmount
  - src/features/overview/libs/metricIdentity.ts                   # registered metric-identity variants (id names surface+window+source) over one shared resolver
  - src/features/overview/libs/computeTrends.ts                    # one derivation source; returns null rather than fabricate a trend; avg-metric zero-baseline treated as no-sample
  - src/features/companions/overseer/directorScore.ts            # the declared-domain sparkline exemplar: fixed scale, its docstring states the doctrine
  - src/features/teams/sub_kpis/kpiMath.ts                         # cross-language metric identity: declared mirror of the engine-side derivation
  - src-tauri/src/engine/kpi_derivation.rs                         # the other half of that mirror (comment-coupled, no shared-fixture gate — see report)
  - src/features/shared/glyph/types.ts                             # a fixed dimension vocabulary as an encoding language shared across surfaces
counter_evidence:
  - src/features/overview/components/shared/KpiTile.tsx            # sample-anchored sparkline floor (min-max autoscale) at the highest-reach call count — the scale defect the standard exists to prevent
  - src/features/shared/components/display/ChartEmptyState.tsx     # a chart empty-state primitive with zero render call sites and hardcoded hex art — vocabulary drift plus an unreachable door
deviations:
  - w3-data-viz   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Data Viz - evidence

How this codebase measures against the [`data-viz`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
