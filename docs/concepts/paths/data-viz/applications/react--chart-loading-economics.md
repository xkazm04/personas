---
layer: application
subject: data-viz
technique: chart-loading-economics
stack: react
---

# Chart loading economics — React + Recharts, as built here

How this repo implements the technique, where it complies, and where the
call-site data argues for tightening the primitives.

## The engine loads lazily, once

`src/features/shared/charts/RechartsWrapper.tsx` is the single dynamic
`import('recharts')` for the whole app (~450 KB vendor chunk). It deliberately
uses a **render-prop** instead of per-component `React.lazy` wrappers, and the
comment at `:3-6` says why: recharts inspects child component identity
(`child.type === Bar`), so a Suspense-wrapped child fails that check. Every
chart composes through `render={(R) => <R.LineChart …>}` against the one
resolved module — one shared chunk, no per-chart copies.

```tsx
// RechartsWrapper.tsx:27 — the one door to the engine
export function LazyChart({ render, fallback = null }: LazyChartProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyRechartsContent render={render} />
    </Suspense>
  );
}
```

Note `fallback = null` — the technique's "required parameter" lesson lives in
that default. Measured across the repo (chart-component census, 2026-08-15):
`MetricChart.height` is **required** and passed at 3/3 call sites;
`LazyChart.fallback` is **optional-null** and passed at 3/11. Same feature
area, same authors. Eight charts download the vendor chunk behind a blank
(but correctly sized) rectangle. The proposed fix (T1 in the legacy
chart-component path) is to delete the default and take the eight one-line
compile errors.

## Geometry reserved before anything arrives

`src/features/overview/sub_usage/components/MetricChart.tsx` is the canonical
panel: `height` is a **required prop** (`:27`), so the box is always reserved;
the header chrome renders unconditionally; `loading` swaps only the body for a
same-height ghost (`:54-57`); the chart subtree renders inside
`ChartErrorBoundary` + `LazyChart` with a same-height fallback div (`:60-69`).
`DashboardChartCard.tsx` (`src/features/overview/components/dashboard/widgets/`)
is the Home-page sibling: same shell contract via `bodyHeightClass` (`:33-34`,
default `h-32`), plus an `ariaLabel` on the card.

The best fallback in the repo, worth copying verbatim, is
`src/features/teams/sub_kpis/KPIDashboard.tsx:296`: reserved height,
`animate-fade-in` with `animationDelay: '150ms'` (the placeholder-entrance
delay from the async-ui-states doctrine), `aria-hidden`.

## Mount on visibility

`src/features/overview/sub_usage/components/LazyChart.tsx` — a **different
component with the same exported name** as the RechartsWrapper one — is the
viewport-deferral half: an `IntersectionObserver` with `rootMargin: '200px'`
(start work one screen early), one-shot (`observer.disconnect()` on first
intersection, `:26-27`), reaper in the effect cleanup (`:33`), and a
geometry-matched skeleton at the declared `height` while unmounted
(`:38-51`). Once visible it stays mounted — no re-animation on scroll-back.

The name collision is a live hazard: `MetricChart.tsx:3` imports `LazyChart`
from `RechartsWrapper` while sitting in the same directory as the
viewport-deferral `LazyChart.tsx`. Autocomplete cannot tell them apart;
renaming one is cheaper than the eventual wrong import.

## Per-chart failure boundary

`src/features/overview/sub_usage/components/ChartErrorBoundary.tsx` catches
render errors from malformed series (NaN, Infinity, unexpected shapes), logs
through `createLogger("chart-error-boundary")` (`:32` — the telemetry half the
technique requires), renders a compact failure state with a retry that resets
the boundary (`:35-37`). `MetricChart` and `DashboardChartCard` both build it
in, so charts composed through them are isolated for free.

Coverage is the gap, not the primitive: at the 2026-08-15 census only 4 of 8
recharts-bearing files were wrapped (`TrafficErrorsChart`,
`sub_observability/MetricsCharts`, `KPIDashboard`, `kpiDistance` ran bare).
Charts that bypass the shells bypass the boundary — the shells exist precisely
so that composing through them is the path of least resistance.

## What to check before adding a chart here

1. Compose through `MetricChart` (or `DashboardChartCard` on Home) — you get
   the reserved box, the boundary, and the lazy engine without decisions.
2. If you must use the RechartsWrapper `LazyChart` directly, pass `fallback`
   — a calm same-height rectangle, per `KPIDashboard.tsx:296`.
3. Below-the-fold dashboards: wrap in the viewport-deferral `LazyChart`
   (sub_usage) so offscreen charts cost nothing until approached.
4. Verify the entry bundle stays engine-free: `recharts` must appear only in
   its own deferred chunk.
