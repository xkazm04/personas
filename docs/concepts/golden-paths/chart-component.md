# Chart component

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `chart-component`
> **Composed:** 2026-08-15 · **Leaf recurrence:** 48
> **Sweep:** 4,829 TS/TSX files walked by two independent matchers; 8 recharts-backed
> files (13 chart instances) and 13 hand-rolled sparkline components read in full;
> `recharts@3.8.1` library source read for four defaults; series palettes scored
> with an executable CIEDE2000 + colour-vision-deficiency audit; convergence
> measured against `../personas-web` and `../brainiac/console`.
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 4,829 `.ts`
> files, 2,104 `.tsx` files, 1,135 lint warnings / 0 errors at `211d519bb`.

---

## 1. Trigger

You are in this situation when you say or type any of:

- "add a chart to this dashboard" / "plot cost over time" / "show the trend"
- "put a sparkline in this row/tile"
- "why does this metric look so spiky?" / "this chart is lying"
- "which colour is which series?"
- "the chart panel is blank while it loads"

**The "if you are about to write X" test.** If you are about to write a
`<R.LineChart>`, a `<polyline points={…}>` built from a data array, a `domain={…}`,
a `Math.min(...values)` that becomes the bottom of a drawing, or an
`<R.YAxis>` — you are here.

### The seam: this leaf and its two unwritten siblings

`metrics-and-charts` holds three leaves and they are easy to blur. The
discriminating question is **checkable and structural**:

> **Does decoding a mark require a scale the mark itself does not carry?**

| Answer | Leaf | Structural consequence |
| --- | --- | --- |
| **Yes** — the mark's position/extent is meaningless without an external, developer-chosen domain shared across all marks | **`chart-component`** (this path) | You must *choose* a domain, and the choice can lie. You inherit axis honesty, series-encoding channels, and the renderer's degenerate-input behaviour. |
| **No** — the mark carries its own denominator and its value is printed beside it | `proportional-bar-list` | There is no domain to choose. You inherit ranking, share-of-total semantics, "what is the denominator", and the long tail. |
| There is no mark at all — the question is what the number *counts*, over what window, from what source | `metric-definition` | Upstream of any rendering. You inherit derivation, window, unit, and comparability. |

Grounded, not asserted. `LlmSpendSection.tsx:62-77` renders a bar whose width is
`(row.cost_usd / maxCost) * 100%` — but `:68` prints `fmtCost(row.cost_usd)` on
the same row. The reader never consults the scale; the bar is a redundant ordinal
cue. **That is `proportional-bar-list`.** `CostSparkline.tsx:13-17` maps each cost
to `y = H - PAD - ((c - min) / range) * (H - PAD*2)` and prints **no number
anywhere** — a point at y=7px is undecodable without the domain. **That is this
leaf.** The same file can host both; the question is asked per mark, not per file.

Two corollaries the seam settles cleanly:

- **A sparkline is a chart.** It has no visible axis, which makes the scale
  *invisible* rather than absent — the strongest form of the condition, and where
  this repo's real defects are (§7).
- **A progress ring / gauge is not.** `OAuthProgressRing`, `RotationCountdownRing`,
  `TourProgressArc`, `ConfidenceArc` all encode a fraction of a full sweep and print
  the percentage. The mark carries its scale. Out of scope here.

### Boundaries with paths that already exist

This leaf is narrower than "everything about a chart". Four neighbours own
territory inside a chart panel and **this path defers to all four**:

| Territory | Owner | Do not restate |
| --- | --- | --- |
| Axis-tick / tooltip / legend **number** formatting — `tickFormatter`, currency, percent, locale | [`number-and-cost-formatting.md`](./number-and-cost-formatting.md) §1 `:148`, §4 `:248`, §5 `:276`, §7.B `:440-457`, §7.C `:473-478` | It already enumerates six of this repo's chart formatters by file:line. |
| Chart loading placeholder — "reserve the final box height, ghost a calm rectangle in it" | [`page-loading.md`](./page-loading.md) `:53`; `Suspense fallback` doctrine `:25`, `:31`, `:68` | This path only measures *compliance* (§7 D1). |
| The simulated-series mark (`strokeDasharray="6 4"` + `trend_sim_suffix`), and the four-condition empty cascade a chart panel must resolve | [`empty-and-demo-states.md`](./empty-and-demo-states.md) `:28`, `:43`, `:66`, `:102` | |
| Whether a chart's entrance or loop is *allowed to move* | [`motion-and-reduced-motion.md`](./motion-and-reduced-motion.md) `:145-165`, `:115-122` | This path owns only the part that layer provably cannot reach (§8 Gap 4). |

**A correction to the brief that commissioned this path, stated up front because
it inverts a premise.** The brief asserted that
"`display/ChartEmptyState` is the mandated chart-panel empty state" per
`empty-and-demo-states.md`. **It is not mandated anywhere.** That document never
lists it in §3, Steps, Evidence or Anti-patterns; it names it exactly twice — at
`:160` as a catalog-drift victim ("listed with `_(add a @catalog tag)_` and no
description") and at `:225-226` as a census-rule exclusion described as *"a
consolidation target for Gap 1, not a feature-local hand-roll"*. And the component
itself has **0 render call sites in the entire repository** (`grep -rn
"ChartEmptyState" src` returns three lines: one CATALOG.md row and two lines of its
own definition). Prescribing it would have routed every future chart to a
primitive nobody has ever rendered, whose four illustrations are hardcoded hexes
(`#818cf8`, `#6366f1`, `#a78bfa`, `#34d399`) invisible to `check-themes.mjs`, and
whose root `animate-fade-scale-in` is nulled under OS reduced motion
(`globals.css:4540`). §8 Gap 2 records what to do with it instead.

---

## 2. The one way

**Declare the value domain; never let the data choose it.** Before you draw
anything, write down the scale's floor and ceiling as an explicit, named quantity
— `[0, 100]` for a percentage, `[0, SCORE_MAX]` for a rated score, `[0, 'auto']`
for a magnitude — and pass it in. In recharts that means **taking `<YAxis>`'s
default and not touching `domain`**, because recharts' default numeric domain is
already `[0, 'auto']` (`axisSelectors.js:50`, `:147`) — zero-anchored, honest, and
correct for every count, cost and duration in this app; override it only to *widen*
to a fixed known range (`[0, 100]` on a percentage), never to narrow to what the
sample happens to span. In a hand-rolled SVG plot there is no such default, so the
domain is yours to state on the first line: `Math.min(...values)` as a scale floor
is the defect — it makes 99.1 → 99.3 % render as a full-height climb, makes two
tiles in the same row incomparable, and is invisible to every reviewer because the
picture looks fine. Compose the panel through **`MetricChart`**, whose required
`height` reserves the box, and render recharts through **`LazyChart` with an
explicit `fallback`** — its default is `null`, and 8 of its 11 call sites take that
default, so the ~450 KB vendor chunk downloads behind an unexplained blank
rectangle. Encode series identity on **at least two channels**: a colour drawn from
the shared `CHART_COLORS` module *plus* a dash pattern, a direct label, or a
legend that names it — never hue alone, because measured on this repo's own
palettes a protanope sees `#8b5cf6` and `#06b6d4` at ΔE00 **2.9**, and two slices of
`CHART_COLORS_PURPLE` at ΔE00 **0.8**. Guard the two inputs that break renderers
before the data reaches the chart — a series shorter than two points and a series
of all zeros — and hand every axis number to the formatters
[`number-and-cost-formatting.md`](./number-and-cost-formatting.md) mandates rather
than a `toFixed` in a `tickFormatter`, which is the one place that path's lint rule
is documented not to look.

---

## 3. Mandated primitives

Never invent a name here. These exist today.

| Primitive | What it gives you |
| --- | --- |
| **`features/shared/charts/RechartsWrapper.tsx` → `LazyChart`** (`:26`) | The single dynamic `import('recharts')` for the whole app, as a **render-prop** — `render={(R) => …}`. The render-prop shape is load-bearing and documented at `:3-6`: recharts inspects child component identity (`child.type === Bar`), so a `Suspense`-wrapped child fails that check. Props: `render` (required), `fallback` (**optional, defaults to `null` — always pass it**). |
| **`overview/sub_usage/components/MetricChart.tsx` → `MetricChart`** (`:39`) | The full chart panel: title, optional icon + `insight`, `ChartErrorBoundary`, `LazyChart`, and `ResponsiveContainer` — from one `chart={(R) => …}` prop. `height` is **required**, so the box is always reserved. Also `emptySlot`, `loading`, `iconColor`. This is the closest thing to a canonical chart panel and it has 3 adopters. |
| **`overview/sub_usage/libs/chartConstants.ts`** | `CHART_COLORS` (8 categorical hexes, `:15`), `CHART_COLORS_PURPLE` (`:20`), `CHART_GRAD` (shared gradient ids, `:6`), `getGridStroke()` / `getAxisTickFill()` (`:37`, `:41` — theme-responsive, read `--chart-grid-stroke` / `--chart-axis-fill`), `CHART_HEIGHT` (`:45`), `MetricUnit` + `metricUnitForKey()` (`:47`, `:66`). |
| **`overview/sub_usage/components/ChartErrorBoundary.tsx`** | The one error boundary for chart subtrees. A malformed series throws inside recharts' render; without this the whole route unmounts. |
| **`overview/sub_usage/components/ChartGradientDefs.tsx`** | Mounts the four shared `<linearGradient>` defs once in `App`, referenced as ``fill={`url(#${CHART_GRAD.cost})`}``. Never re-declare a gradient per chart. |
| **`overview/sub_director/directorScore.ts` → `sparklinePoints(scores, w, h, pad)`** (`:38`) | **The exemplar for hand-rolled plots.** Projects a series onto an SVG box anchored to a *fixed* `SCORE_MAX` (`:11`). Its own docstring states the doctrine: *"The score scale is fixed (0–5), never min/max of the sample, so a '4' sits in the same vertical position everywhere."* |
| **`globals.css:403-404`, `:2425-2426`, `:2474-2475`, `:2605-2606`** | `--chart-grid-stroke` / `--chart-axis-fill`, defined per theme family. Grid and axis chrome are theme-aware; series colours are not (§8 Gap 3). |
| recharts' own defaults (`recharts@3.8.1`) | `domain: [0, 'auto']` (`axisSelectors.js:50`), `isAnimationActive: 'auto'` (`Line.js:576`, `Area.js:559`, `Bar.js:505`, `Pie.js:573`), `accessibilityLayer: true` (`CartesianChart.js:31`, `PolarChart.js:39`). **Three correct-by-default behaviours. Do not override them.** |

**Explicitly NOT primitives:**

- **`display/ChartEmptyState`** — 0 call sites, never mandated by
  `empty-and-demo-states.md`, hardcoded hexes, nulled entrance animation. See §1
  and §8 Gap 2.
- **`overview/sub_usage/components/LazyChart.tsx`** — a *different component with
  the same name* (viewport-deferred `IntersectionObserver` wrapper). Importing the
  wrong `LazyChart` is a live hazard; see §7 D6.
- **`teams/sub_kpis/kpiMath.ts:93` → `sparklinePoints`** — a *second exported
  function with the same name* as the exemplar above, implementing the opposite
  doctrine (min-max autoscale, `:101-103`). See §7 D2.
- `GRID_STROKE` / `AXIS_TICK_FILL` (`chartConstants.ts:33`, `:34`) — marked
  `@deprecated` in favour of the getter functions; they are the dark-theme
  fallbacks frozen as constants.

---

## 4. Steps

1. **Ask the seam question (§1).** If the mark carries its own denominator and its
   value is printed beside it, stop — you are building a `proportional-bar-list`.
2. **Write the domain down before the geometry.** One line, named. `[0, 100]`,
   `[0, SCORE_MAX]`, or "recharts' zero-anchored default". If you cannot state it,
   you do not yet know what the chart means.
3. **Decide whether you need recharts at all.** A single-series trend inside a table
   row or tile is a `<polyline>` and ~30 lines; the vendor chunk is ~450 KB
   ([`lazy-route-chunk.md:72`](./lazy-route-chunk.md)). Thirteen components in this
   repo made that call already. But if you hand-roll, step 2 is now entirely your
   responsibility — that is where all 7 of this path's census violations live.
4. **Compose the panel with `MetricChart`.** Pass `height` (required — this is what
   reserves the box), `title`, and `chart={(R) => …}`. You get the error boundary,
   the lazy import and the responsive container. **And then stop** — do not add your
   own `ChartErrorBoundary`, `Suspense`, or wrapper `div` with a height class.
5. **If you must use `LazyChart` directly, pass `fallback`.** A calm rectangle at
   the final height, per [`page-loading.md:53`](./page-loading.md).
   `KPIDashboard.tsx:296` is the model:
   `fallback={<div className="h-48 rounded-card bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '150ms' }} aria-hidden="true" />}`.
6. **Take recharts' `<YAxis>` default.** Do not write `domain` unless you are
   *widening* to a fixed known range. `domain={['dataMin', 'dataMax']}` on a value
   axis is the truncation this path exists to prevent. (On a *time* `<XAxis>` it is
   correct and idiomatic — `KPIDashboard.tsx:305`.)
7. **Give every series two encoding channels.** Colour from `CHART_COLORS` **plus**
   one of: `strokeDasharray`, a distinct `type`/shape, a direct end-label, or a
   `<Legend>` carrying `name`. Assume the reader cannot separate your hues (§7 D4).
8. **Guard degenerate inputs at the call site, before the chart mounts.**
   `series.length > 1` (a one-point line with `dot={false}` draws nothing) and
   "are all values zero" (a flat line at the floor is indistinguishable from a
   broken fetch). `AthenaUsageSection.tsx:170` and `LlmSpendSection.tsx:129` both
   do the first correctly with `{dailyChart.length > 1 && …}`.
9. **Route every number through the formatters.** `tickFormatter={(v) =>
   formatCost(v, { language })}`, not `` `$${v.toFixed(2)}` ``. See
   [`number-and-cost-formatting.md` §4 step 6](./number-and-cost-formatting.md).
10. **Hoist stable props to module scope.** recharts compares children by
    reference identity; a new arrow or object per render defeats its internal
    `shouldComponentUpdate`. `MetricsCharts.tsx:15-16` states this in a comment and
    does it: `const TOOLTIP_CONTENT = <ChartTooltipContent />;`.
11. **Translate `name=`.** A series `name` renders in the legend and the tooltip.
    Seven are hardcoded English today (§7 D7).
12. **Do not disable what recharts gets right.** Leave `accessibilityLayer`,
    `isAnimationActive` and the `<YAxis>` `domain` alone. Three defaults, all
    correct, all overridden somewhere in this repo (§7 D3, D5).

### Can the primitive's signature make the wrong call impossible?

**The contract requires this question be answered before §9 is written
([`golden-path-contract.md:165-184`](../golden-path-contract.md)). Yes — twice,
and this repo contains its own controlled experiment proving it.**

Two sibling chart primitives, same feature area, same era, differing in exactly one
respect — whether the prop that prevents the defect is required:

| Primitive | Prop | Required? | Passed at |
| --- | --- | --- | --- |
| `MetricChart` | `height` — reserves the box | **required** | **3 / 3 (100%)** |
| `LazyChart` | `fallback` — fills the box while the chunk loads | optional, `= null` | **3 / 11 (27%)** |
| `MetricChart` | `emptySlot` | optional | 1 / 3 |
| `MetricChart` | `loading` | optional | 0 / 3 |

Same file, same authors, same week. The required prop is universal; every
optional one is a minority. This is the exact shape of
[`golden-path-contract.md:98-107`](../golden-path-contract.md)'s fifth failure
mode — *"a gate on reaching a destination is only as good as the destination's
defaults"* — and the exact shape of `<Numeric language>`, where 206 of 215 call
sites took a wrong default.

**Two type changes, proposed as the real fixes:**

**T1 — make `LazyChart.fallback` required** (`RechartsWrapper.tsx:22-26`). Delete
`= null` and the `?`. Eight call sites become compile errors, each fixed with one
line. `page-loading.md:53` becomes unrepresentably violable at the chart boundary.

**T2 — make the domain a parameter of the geometry, not a computation inside it.**
The exemplar `sparklinePoints(scores, w, h, pad)` (`directorScore.ts:38`) is right
by accident of *hardcoding* `SCORE_MAX` — it is correct but not reusable, which is
precisely why `kpiMath.ts:93` re-implemented it wrongly instead of importing it. The
signature that makes the defect unrepresentable takes the domain:

```ts
export function plotPoints(
  values: number[],
  box: { w: number; h: number; pad: number },
  domain: readonly [min: number, max: number],   // required. No default. No Math.min inside.
): { points: string; lastX: number; lastY: number }
```

With no `Math.min(...values)` inside the helper, an autoscaled sparkline cannot be
written through it — the caller must name its floor, and `[0, max]` is one keystroke
shorter than the wrong answer. Seven violations and thirteen divergent sparkline
implementations collapse to one call. **Propose T1 and T2 as the fix; §9's census
rule is the ratchet that holds the line until they land.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `const min = Math.min(...values)` as a plot's scale floor | The baseline moves with the data. A success rate of 99.1 → 99.3 % renders as a full-height climb; a genuinely flat series renders as violent noise; two tiles in the same row use different scales and cannot be compared. **The picture always looks plausible, so review never catches it.** |
| `domain={['dataMin', 'dataMax']}` on a value axis | The same defect, spelled in recharts. Correct on a *time* axis; a lie on a value axis. |
| Overriding `<YAxis domain>` to narrow rather than widen | recharts already defaults to `[0, 'auto']`. Every override is a decision to depart from zero, and needs a reason. |
| `<LazyChart render={…} />` with no `fallback` | ~450 KB of vendor chunk downloads behind an unexplained blank rectangle. The height is reserved (`h-40` on the parent) but nothing says "loading" — half of `page-loading.md:53`. |
| Series identity carried by hue alone | Measured on this repo's palettes: `CHART_COLORS_PURPLE` has 6 of 28 pairs below ΔE00 10 for a protanope, minimum **0.8**. Also fails for anyone on a projector, a bad panel, or greyscale print. |
| `PALETTE[i % PALETTE.length]` with an unbounded series count | Not a perception problem — a **guaranteed collision**. Series 0 and series 8 get byte-identical colours and the legend cannot disambiguate them. 5 sites. |
| Series colour keyed on a *status*, not on *identity* (`stroke={TRACK_COLOR[track]}`) | Every off-track KPI is the same colour. The legend names them but its swatches are identical, so no legend row maps to any line. |
| `accessibilityLayer={false}` | Turns off recharts 3.x's built-in keyboard navigation of data points. The default is `true`; this is a deliberate removal of the only accessibility affordance charts here have. |
| An inline arrow or object literal as a recharts prop (`content={…}`, `label={({…}) => …}`, `tick={{…}}`) | New reference identity every render defeats recharts' internal memoisation, re-diffing the whole chart subtree on unrelated state changes. |
| A `tickFormatter` containing `.toFixed()` / `` `$${v}` `` | [`number-and-cost-formatting.md` §7.B](./number-and-cost-formatting.md): `custom/prefer-numeric` aborts on any enclosing arrow function (`prefer-numeric.cjs:78-80`), so this is the one shape the rule provably cannot see. |
| `name="Traffic"` on a `<R.Area>` | Renders in the legend and tooltip. It is UI copy and needs `t.*`. |
| A new `*Sparkline` component in a feature folder | There are already 13. Four are named plain `Sparkline`. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_director/directorScore.ts:31-50`,
consumed by `src/features/overview/sub_director/ScoreSparkline.tsx:26-49`.**

It is the only plot in the repository that gets every item in §2 right, and it says
why in its own docstring (`:1-9`):

> *"The score scale is fixed (0–5), never min/max of the sample, so a '4' sits in
> the same vertical position everywhere — trends stay comparable across personas at
> a glance."*

- **Declared domain** — `y = h - pad - (s / SCORE_MAX) * (h - 2*pad)` (`:47`), with
  `SCORE_MAX = 5` (`:11`). No `Math.min` anywhere.
- **The scale is visible** — `ScoreSparkline.tsx:38` draws a faint baseline `<line>`
  at score 0, so the floor is a rendered object rather than an assumption.
- **Two channels** — colour from `scoreTone()` (`:24-28`) *and* a trailing dot at the
  last value; and `:48` wraps the whole thing in a `Tooltip` carrying the readable
  series, so the numbers are recoverable ("the line shows the shape, the tooltip
  shows the actual numbers", `:9-11`).
- **Degenerate input guarded** — `if (scores.length < 2) return null;` (`:26`).
- **Geometry extracted** — the projection lives in a shared, named, documented
  helper, not inline in the component.

Secondary exemplars, each for one property:

| Site | What to copy |
| --- | --- |
| `teams/sub_kpis/KPIDashboard.tsx:295-300` | The only `LazyChart` `fallback` that follows `page-loading.md` exactly: reserved height, `animate-fade-in`, `animationDelay: '150ms'`, `aria-hidden`. |
| `overview/sub_activity/MetricsCharts.tsx:15-16` | `const TOOLTIP_CONTENT = <ChartTooltipContent />;` with the comment explaining recharts' reference-identity comparison. The right instinct, written down. |
| `overview/sub_activity/MetricsCharts.tsx:134-138` | Latency p50/p95/p99 as solid / `4 2` dashed / `2 2` dotted — **three channels**: hue, dash, and stroke width. Readable in greyscale. |
| `overview/sub_observability/MetricsCharts.tsx:164` | Pie slices carry `label={({name, percent}) => …}` — direct labelling, so identity survives the palette being near-degenerate. |
| `settings/sub_byom/ProviderSparkline.tsx:31-32` | `Math.max(...data, 1)` / `Math.min(...data, 0)` — a **clamped** domain. One extra argument each, and the scale is pinned to zero. The cheapest correct spelling in the repo. |
| `agents/sub_deployment/cloud/DailyBreakdownChart.tsx:57`, `:94` | `d.cost / maxCost`, `d.count / maxCount` — ratio-of-maximum, implicitly zero-floored. Honest by construction. |
| `overview/sub_activity/AthenaUsageSection.tsx:170` | `{dailyChart.length > 1 && …}` — the short-series guard at the call site, before the chart mounts. |

---

## 7. Deviations

Fifteen chart-bearing files were read in full. Every item below shipped under a
green `npm run check` (0 errors, 1,135 warnings — [`shared-facts.json`](../shared-facts.json)).

### D1 — Seven plots anchor their scale to the sample's own minimum · **7 files, 7 statements**

The census signal in §9. Confirmed identically by two independent matchers (a
whole-content regex through the census engine, and a line-oriented state machine).
Each is reported as **the floor statement with its consequent denominator**:

| File:line | Floor | Denominator | Reach |
| --- | --- | --- | --- |
| `agents/sub_deployment/components/DeploymentHealthSparkline.tsx:46` | `const min = Math.min(...values)` | `:48 const range = max - min \|\| 1` | ×3 series per row — **including `successRate`**, the worst case: `sr.push(d.successRate * 100)` (`:87`) then autoscaled, so 99.1→99.3 % fills the box. |
| `agents/sub_executions/components/list/CostSparkline.tsx:9` | `const min = Math.min(...costs)` | `:11 const range = max - min \|\| 1` | Per execution-list row. Sub-cent noise renders as a mountain range. |
| `overview/components/shared/KpiTile.tsx:104` | `const min = Math.min(...data)` | `:106 const range = max - min \|\| 1` | **`<KpiTile>` has 32 call sites across 9 files** — the highest-reach instance in the repo. |
| `teams/sub_kpis/kpiMath.ts:101` | `const min = Math.min(...values)` | `:103 const span = max - min \|\| 1` | An exported `sparklinePoints()` — a shared helper that spreads the defect. |
| `teams/sub_kpis/kpiDetailParts.tsx:155` | `const vMin = Math.min(...vCandidates)` | `:157 const vSpan = vMax - vMin \|\| 1` | Partially mitigated: `vCandidates` includes `target_value` and `baseline_value` (`:153-154`), so the domain at least spans the target. Still sample-derived. |
| `teams/sub_factory/factoryPrimitives.tsx:27` | `const min = Math.min(...data)` | `:29 const span = max - min \|\| 1` | An exported `Sparkline` used across the Factory surface. |
| `teams/sub_factory/KpiConsole.tsx:23` | `const lo = Math.min(...vals)` | `:25 const pad = (hi - lo) * 0.15 \|\| 1` | A function literally named `domain()` (`:21`) that computes one from the sample. |

**The asymmetry that makes this a correctness bug and not a style preference:**
with `range = max - min || 1`, an all-zero series and a series of `[5,5,5]` both
render flat — but `[0.001, 0.002, 0.001]` renders as a full-amplitude peak. The
renderer is *most* dramatic exactly where the data is *least* meaningful.

### D2 — Two exported functions named `sparklinePoints`, with opposite doctrine · **2 files**

- `overview/sub_director/directorScore.ts:38` — fixed `SCORE_MAX` scale. The exemplar.
- `teams/sub_kpis/kpiMath.ts:93` — min-max autoscale.

Same name, same repo, same purpose, contradictory semantics. An import
autocomplete cannot tell them apart. This is the strongest single argument for T2
(§4): the exemplar is un-reusable because its domain is baked in, so the second
author wrote a new one rather than importing it.

### D3 — recharts' accessibility layer explicitly disabled · **2 sites**

`teams/sub_kpis/KPIDashboard.tsx:299` and `teams/sub_kpis/kpiDistance.tsx:55` both
pass `accessibilityLayer={false}`. recharts 3.8.1 defaults it to `true`
(`CartesianChart.js:31`, `PolarChart.js:39`, `rootPropsSlice.js:14`), and the layer
is what wires keyboard traversal of data points
(`keyboardEventsMiddleware.js:42-43`, `:153-154`, `:179-180`). These two files are
otherwise the *best* charts in the repo — they are the only two that use CSS custom
properties rather than hex literals for series colour. The single accessibility
affordance charts have here is switched off in exactly the two files that got
everything else right.

### D4 — Series palettes collapse under colour-vision deficiency and on light themes

Computed, not asserted: CIEDE2000 over every pair, under Viénot CVD simulation,
with the app's `html { filter: brightness(…) }` (`globals.css:832`; 1.25 dark /
0.82 light, `themeStore.ts:33-44`) applied first — because
[`theming-and-contrast.md:31-34`](./theming-and-contrast.md) established that
auditing an unfiltered token scores a colour the app never renders.

| Palette · condition | min ΔE00 | pairs < ΔE 10 | pairs < ΔE 20 |
| --- | --- | --- | --- |
| `CHART_COLORS` · normal, dark | 19.7 | **0 / 28** | 1 / 28 |
| `CHART_COLORS` · deuteranope | 5.2 | 4 / 28 | 9 / 28 |
| `CHART_COLORS` · protanope | **2.9** (`#8b5cf6` vs `#06b6d4`) | 3 / 28 | 8 / 28 |
| `CHART_COLORS_PURPLE` · normal, dark | 8.5 | 1 / 28 | 14 / 28 |
| `CHART_COLORS_PURPLE` · protanope | **0.8** (`#6366f1` vs `#7c3aed`) | 6 / 28 | 15 / 28 |
| `CHART_COLORS_PURPLE` · normal, **light** | 5.8 | **8 / 28** | 20 / 28 |
| `CHART_COLORS_PURPLE` · deuteranope, light | 2.2 | **13 / 28** | 22 / 28 |

`CHART_COLORS` is a genuinely well-separated categorical palette **for normal
vision on a dark theme** — 0 of 28 pairs below ΔE 10 — and degrades gracefully.
`CHART_COLORS_PURPLE` is not a categorical palette at all; it is eight lightness
steps of one hue, and it is used as one at
`overview/sub_observability/MetricsCharts.tsx:165` to fill pie `<Cell>`s.

Contrast against the panel ground (non-text, 3:1 target):

| Palette · ground | below 3:1 |
| --- | --- |
| `CHART_COLORS` · dark `#0f0f14` @1.25 | 1/8 — `#4A154B` at **1.56** |
| `CHART_COLORS` · light `#ffffff` @0.82 | 3/8 — `#10b981` 2.41, `#f59e0b` 2.06, `#06b6d4` 2.32 |
| `CHART_COLORS_PURPLE` · light @0.82 | 3/8 — `#a78bfa` 2.57, `#c4b5fd` **1.80**, `#818cf8` 2.79 |

**Two claims I set out to make and could not support — recorded because a cleared
claim is worth as much as a confirmed one:**

- *"Something encodes meaning by hue alone."* The pie at
  `sub_observability/MetricsCharts.tsx:164` carries
  `label={({name, percent}) => …}` — every slice is directly labelled with its name
  and percentage. Identity does not ride on colour. Likewise the latency chart
  (`sub_activity/MetricsCharts.tsx:134-138`) is dash- and width-redundant, and the
  compare series everywhere use `strokeDasharray="6 3"`. **This repo is broadly
  good at redundant encoding** and matches both sibling repos. The palette is
  degenerate; the *information* mostly survives it.
- The one genuine exception is **`KPIDashboard.tsx:339`**:
  `stroke={TRACK_COLOR[paceDescriptor(kpi).track]}` — series colour is the KPI's
  *track status*, so every off-track KPI on the chart is the same colour and every
  legend swatch is the same colour. The legend `formatter` (`:327-334`) supplies
  names, but no name can be matched to a line.

### D5 — Palette index wrap guarantees identical colours past index 7 · **5 sites**

`CHART_COLORS[i % CHART_COLORS.length]` at `sub_activity/MetricsCharts.tsx:65`
(stacked areas, one per persona), `:165`, `AthenaUsageSection.tsx:148`,
`LlmSpendSection.tsx:73`, and `CHART_COLORS_PURPLE[i % …]` at
`sub_observability/MetricsCharts.tsx:165`. With nine personas, series 0 and series 8
are byte-identical. (The two bar-row sites are `proportional-bar-list` territory
and are listed for completeness only.)

### D6 — Four panel wrappers, one duplicated name · **structural**

| Wrapper | Location | Adopters |
| --- | --- | --- |
| `MetricChart` | `overview/sub_usage/components/` | 3 |
| `DashboardChartCard` | `overview/components/dashboard/widgets/` | its own children |
| `ChartPanel` | **local `function` inside `KPIDashboard.tsx:406`** | 2, same file |
| bare `LazyChart` | — | **11** |

The best primitive has the fewest users. Separately, **`LazyChart` names two
different components**: `shared/charts/RechartsWrapper.tsx:26` (the recharts lazy
import) and `overview/sub_usage/components/LazyChart.tsx:14` (a viewport-deferred
`IntersectionObserver` wrapper). Both are exported. `MetricChart.tsx:3` imports the
first while sitting in the same directory as the second.

`ChartErrorBoundary` wraps only **4 of 8** recharts files
(`TrafficErrorsChart`, `sub_observability/MetricsCharts`, `KPIDashboard`,
`kpiDistance` have none).

### D7 — Hardcoded English series names · **4 sites**

`sub_activity/MetricsCharts.tsx:136` `name="Prev p50"`, `:137` `name="Prev p95"`;
`TrafficErrorsChart.tsx:70` `name="Traffic"`, `:71` `name="Errors"`. These render in
the legend and the tooltip in all 14 locales. (`"p50"`/`"p95"`/`"p99"` are technical
identifiers and correctly untranslated.)

### D8 — `fallback` omitted at 8 of 11 `LazyChart` sites

`DashboardChartCard.tsx:73`, `AthenaUsageSection.tsx:167`, `LlmSpendSection.tsx:126`,
`sub_activity/MetricsCharts.tsx:56/82/106/128`, `TrajectoryChart.tsx:33`.

**Scoped honestly.** I expected layout shift and there is none: all eight reserve
the box on an ancestor (`h-40 2xl:h-48`, `h-48 2xl:h-56`, `bodyHeightClass`), so
**height reservation is 11/11**. The defect is the other half of
`page-loading.md:53` — the *calm ghost inside* the reserved box is **3/11**. The
user sees a correctly-sized empty rectangle with no indication anything is coming.

### D9 — A constant named `PERCENT_TICK_FORMATTER` that emits a currency glyph

`sub_activity/MetricsCharts.tsx:17`:
`const PERCENT_TICK_FORMATTER = (v: number) => `$${v.toFixed(2)}`;`

**Not a rendering bug.** I checked: it is applied at `:61` to the *"Cost per Day"*
`<AreaChart>`'s Y axis, where dollars are correct. It is a maintenance trap — the
next person who needs a percent axis reaches for the constant whose name says
percent and gets dollars, two lines above the correctly-named
`PCT_AXIS_FORMATTER` (`:18`). The formatting itself belongs to
[`number-and-cost-formatting.md`](./number-and-cost-formatting.md), which already
cites this line.

### D10 — No chart anywhere guards an all-zero series · **0 of 15**

Neither the 8 recharts files nor the 7 hand-rolled plots contain an
`.every(v => v === 0)` / `.some(v => v > 0)` guard. Short-series guards, by
contrast, are near-universal in the hand-rolled set (**7/7**, all `length < 2`)
and a minority in the recharts set (**3/8**). Degenerate-range division is safe
everywhere — all 5 hand-rolled normalisers carry `|| 1` (**5/5**), so no NaN
reaches the DOM.

### D11 — Formatter callback census · confirming the inherited finding

Measured: **17 formatter props across 8 chart files** (`tickFormatter` ×14,
`formatter` ×2, `labelFormatter` ×1). Of these, **9 are hoisted module-scope
constants** (good for reference identity) and 8 are inline arrows.

**None of the 17 routes through `<Numeric>` or any shared formatter — 0/17.** Two
call `toLocaleDateString()` / `toLocaleString()` with **no locale argument**
(`KPIDashboard.tsx:306`, `:318`), reading the operating system's locale rather than
the language the user picked.

The inherited premise is **confirmed**: `custom/prefer-numeric` has 3.5% recall
because `prefer-numeric.cjs:78-80` returns on any enclosing
`ArrowFunctionExpression`, and every one of these 17 is inside one. One brief
figure needs correcting: the `<Numeric>` locale statistic is **206 of 215 tags**
(`number-and-cost-formatting.md:270`, `:365`), not "189 of 197" — 197/8 is a
different, pre-fix population (`:57-63`) and ~212 is the count corrected by a
single edit at the primitive (`:70-71`).

---

## 8. Gaps

**Gap 1 — There is no chart primitive that owns the domain.** `MetricChart` owns
the panel; `LazyChart` owns the import; `chartConstants` owns colour. Nothing owns
the scale, which is this leaf's entire correctness surface. Every one of D1's seven
violations is downstream of this: thirteen authors each had to invent a projection,
and seven chose the one that looks right and is wrong. **This is the root cause the
second pass surfaced** — D1, D2 and the thirteen-sparkline sprawl are one gap, not
three. T2 in §4 is the fix.

**Gap 2 — `ChartEmptyState` exists, is unreachable, and cannot be recommended.**
Zero call sites. Its CATALOG.md row is blank (`_(add a @catalog tag)_`, `:42`) —
and per `empty-and-demo-states.md:160` so are all four empty-state components'
rows, so a developer scanning the catalog "sees four undifferentiated options and
picks none". Its four illustrations hardcode `#818cf8`/`#6366f1`/`#a78bfa`/`#34d399`
with no theme token, and its root `animate-fade-scale-in` is in the
`animation: none !important` set at `globals.css:4540`. It should either be given a
`@catalog` tag, themed, and adopted — or folded into `ScenarioEmptyState` as
`empty-and-demo-states.md:225` proposes. Until one of those happens, **this path
cannot mandate it**, and the honest chart-empty prescription is
`empty-and-demo-states.md`'s four-condition cascade rendered through
`ScenarioEmptyState` inside `MetricChart`'s `emptySlot`.

**Gap 3 — Chart colour is structurally invisible to the theming apparatus.** Grid
and axis chrome are theme-aware (`--chart-grid-stroke` / `--chart-axis-fill`,
redefined in four theme blocks). **Series colours are not**: 30 hex literals across
6 of 8 recharts files, versus 13 `var(--…)` uses in the two KPI files. And because
they are SVG `fill`/`stroke` values rather than `text-*` classes, they are invisible
to both `check-themes.mjs` and `custom/no-low-contrast-text-classes` — the rule that
accounts for 705 of the repo's 1,135 warnings ([`shared-facts.json`](../shared-facts.json))
cannot see a single chart pixel. `theming-and-contrast.md` explicitly scopes itself
to *text* colour (`:17`) and hands hues to other paths, so this is not its gap; it
is unowned. D4's light-theme contrast failures (3/8 and 3/8 below 3:1) are the
measurable consequence.

**Gap 4 — Recharts animates outside every reduced-motion layer this app has, and
the in-app toggle cannot reach it.** This is narrower than it first appears and the
narrowing matters:

- **Cleared:** I expected to find 13 charts animating ungated, since the repo sets
  `isAnimationActive` at **0 sites**. But recharts 3.8.1 defaults
  `isAnimationActive: 'auto'` (`Line.js:576`, `Area.js:559`, `Bar.js:505`,
  `Pie.js:573`), and `'auto'` resolves as
  `!Global.isSsr && !prefersReducedMotion` (`JavascriptAnimate.js:44`), reading
  `window.matchMedia('(prefers-reduced-motion: reduce)')`
  (`usePrefersReducedMotion.js:22`). **Under OS reduced motion, recharts already
  does the right thing, with no code here.** Do not add `isAnimationActive` — and
  note this makes `personas-web`'s `useChartAnimation()` hook redundant at v3.x.
- **The real gap:** this app has a *second*, user-controlled reduced-motion path —
  `html[data-motion="reduce"]` (`globals.css:5138-5146`), an attribute selector.
  `matchMedia` cannot observe a DOM attribute, so **a user who turns on reduced
  motion in the app's own settings still gets recharts' 1500 ms animations**
  (`Line.js:570`). The CSS author anticipated a third animation category and
  mirrored it explicitly — `html[data-motion="reduce"] animate, animateTransform,
  animateMotion { display: none }` (`:5153-5157`) for SMIL — but recharts'
  JS-driven `requestAnimationFrame` animation is a fourth category nobody mirrored.
  It is also invisible to `motion-and-reduced-motion.md`'s census rule, which keys
  on `repeat: Infinity` in framer transitions. The fix is a `MotionConfig`-style
  provider that passes `isAnimationActive={!reduced}` from the app's own store —
  but it needs the store's value, not the media query, and it is a real change, not
  a lint.

**Gap 5 — recharts' accessibility layer is the ceiling, and it is low.** Even
enabled, `accessibilityLayer` provides keyboard traversal, not a text equivalent.
No chart in any of the three repos surveyed carries `role="img"` + `aria-label`,
`<title>`/`<desc>`, or a screen-reader table fallback. A blind user cannot read any
chart in this application. The one partial affordance is
`DashboardChartCard`'s `ariaLabel` prop (`:52`) on the card, not the plot.

**Gap 6 — The census rule cannot express "and it is a chart".** The signal in §9
keys on a JavaScript idiom, not on a rendering context. A future hand-rolled plot
that computes its domain differently (a `reduce`, a `sort()[0]`, a `d3.extent`)
is a true violation the rule will never see. Recall is bounded by idiom, and
§9 states which condition the idiom proxies for so a re-derivation is possible.

---

## 9. The missing gate

**The condition to enforce:** *a plot's value scale is derived from the sample
rather than declared.* Not "a chart exists", not "a colour is a hex" — the one
thing in this leaf that is a correctness bug rather than a preference, and the one
this repo gets wrong seven times.

**Checked first that it is not already gated.** `scripts/census/rules.json` holds
**78 rules**; none has an `id` or signal containing `chart`, `axis`, `series`,
`viz`, `sparkline`, `palette`, `scale` or `domain`. The nearest neighbours —
`local-empty-state`, `hand-assembled-currency`, `locale-blind-percent`,
`illegible-foreground-alpha`, `looping-framer-animation` — each own a *different*
condition inside a chart panel and none can see this one.

**Signals I designed, measured, and rejected — the rejections are the finding:**

| Candidate | Result | Why rejected |
| --- | --- | --- |
| `<YAxis … domain={` | 2 files, 2 matches | **Both are correct** — `[0, 100]` and `[0, 120]`, zero-anchored widenings. A baseline here would have recorded two exemplary sites as violations. This is precisely the trap `golden-path-contract.md:216-222` warns about. |
| `max - min \|\| 1` (the range denominator alone) | 8 files | Includes `ProviderSparkline.tsx`, which is **correct** — it clamps with `Math.min(...data, 0)`. Fires on correct content. |
| `Math.min(\s*\.\.\.ident\s*\)` alone | 11 files | 7 true / 4 false (a test assertion, an earliest-timestamp `return`, a worst-case percentage, a clamped calendar hour range). **64% precision.** Not shippable. |

**The shipped signal is the floor statement WITH its consequent** — an unclamped
spread-min *assigned as a scale*, paired within ~3 lines with a `|| 1` range
denominator. That pairing is what makes it a scale rather than a minimum, and it is
what removes all four false positives while keeping all seven true ones.

**Validated standalone** against the real engine
(`node scripts/census/run-census.mjs --rules <scratch>`): `sample-derived-plot-scale`
→ **7 files / 7 matches / 4,831 walked**; `declared-plot-scale-positive-control` →
**1 file / 2 matches**. Re-extracted from this finished document and re-run: same
numbers.

**Verified by a second independent implementation** — a line-oriented state machine
rather than a whole-content regex — which reported the identical 7 files / 7
matches and printed each floor with its denominator. (The first attempt at that
verifier silently reported **zero**: a bash heredoc collapsed `\\b` to a literal
backspace character. Two implementations caught it; one would not have.)

**Fail-loud properties**, inherited from the census engine rather than re-derived:
a run fails on a rising count, on a *silently dropping* count, on a walk seeing
fewer than `floor` files, on a rule matching zero files anywhere, and on a stale
`exclude`. Surviving counts print on success.

**How this gate could still fail, stated so the next repo can re-derive it.** The
signal proxies for "the vertical domain is derived from the sample". It keys on the
JavaScript idiom this repo happens to use — spread-min plus `|| 1`. A repo that
spells the same defect with `d3.extent()`, `_.minBy()`, or a `reduce` will match
nothing while the condition is present at scale, which is exactly the portability
failure `golden-path-contract.md:34-60` documents. **An adopting repo must
re-derive its own proxy for the same condition, and should verify against the
positive control's population before trusting a green run.**

**The positive control** carries no `baseline` by design. It matches the *correct*
spelling — a spread min/max with a constant clamp (`Math.min(...data, 0)`,
`Math.max(...data, 1)`). The two rules differ in exactly one respect: whether the
spread is the sole argument. If any regex, walk or engine change ever broke that
distinction, the control goes to zero matches and the run fails structurally. Its
recall is deliberately narrow — it does **not** match
`ScheduleRowHistoryPanel.tsx:91`'s `Math.max(1, ...buckets.map(…))`, which is also
correct — because a liveness probe wants a stable, exactly-understood population,
not coverage.

**On severity.** This is proposed at the census layer, which is a ratchet, not an
`"error"`. The count may not rise; existing violations are a backlog, not a build
break. No argument from warning volume is made or intended.

```json
{
  "id": "sample-derived-plot-scale",
  "goldenPath": "docs/concepts/golden-paths/chart-component.md",
  "title": "A plot's value scale anchored to the sample's own minimum, so the baseline moves with the data",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "=\\s*Math\\.min\\(\\s*\\.\\.\\.[A-Za-z0-9_$.]+\\s*\\)[\\s\\S]{0,160}?\\|\\|\\s*1",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "an unclamped spread-min assigned as a scale floor, paired within a few lines with a `range || 1` denominator — the two halves of a min-max autoscale. The consequent is required so the match is the SCALE and not any minimum: it excludes `return Math.min(...stamps)` (earliest timestamp), `expect(...).toBe(Math.min(...))` and `kpiPct = Math.min(...pcts)` (a worst-case value), which take the raw signal from 64% to 100% precision. A clamped floor — Math.min(...data, 0) — cannot match, because the spread must be the sole argument. Condition proxied: the vertical domain is derived from the sample instead of declared, so a flat series renders as full-amplitude volatility and two panels are not comparable. An adopting repo must re-derive this proxy for its own idiom (d3.extent, minBy, reduce)."
  },
  "exclude": [
    {
      "path": "src/features/overview/sub_director/directorScore.ts",
      "reason": "the primitive this rule routes callers to — sparklinePoints() divides by the fixed SCORE_MAX constant and is the exemplar cited in this path's Evidence section"
    }
  ],
  "baseline": { "files": 7, "matches": 7 },
  "floor": 4000
}
```

```json
{
  "id": "declared-plot-scale-positive-control",
  "goldenPath": "docs/concepts/golden-paths/chart-component.md",
  "title": "POSITIVE CONTROL — a plot scale whose floor is declared rather than sampled",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "Math\\.(?:min|max)\\(\\s*\\.\\.\\.[A-Za-z0-9_$.]+\\s*,\\s*-?\\d+(?:\\.\\d+)?\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Matches the CORRECT spelling this path prescribes: a spread min/max with a constant clamp argument (Math.min(...data, 0) / Math.max(...data, 1)), pinning the scale floor to a declared value. It exists to prove the sibling rule's matcher family is alive: sample-derived-plot-scale distinguishes itself from this one ONLY by whether the spread is the sole argument, so if a regex or walk change ever made that distinction stop working, this control goes to zero matches and the run fails structurally. Recall is deliberately narrow (it does not match Math.max(1, ...xs.map(f))) — a liveness probe wants a stable, exactly-understood population, not coverage. It must never be given a baseline."
  },
  "floor": 4000
}
```

**Two conditions in this leaf that I am refusing to gate, with the measurement
that justifies the refusal:**

1. **`accessibilityLayer={false}`** (D3) is a perfectly precise signal — 2 files, 2
   matches, 100% precision, zero ambiguity. I am not shipping it because the census
   engine **cannot express "must be zero"**: a rule that matches zero files anywhere
   fails structurally. The correct fix is to delete both props, at which point the
   rule breaks the build. A gate whose success condition destroys it is a worse
   artifact than a two-line fix, and the two lines are named in D3.
2. **Series colour perceptual separation** (D4) is measurable — I measured it — but
   not *countable* by a regex. The condition is a property of a palette array's
   contents under a colour-space transform, not of any file's text. It belongs in a
   unit test over `chartConstants.ts` asserting a minimum pairwise ΔE00 under CVD
   simulation, which is a real piece of work and is recorded in Gap 3 rather than
   pretended into a signal.

---

## Convergence

Measured against `../personas-web` and `../brainiac/console`, neither of which has
ever seen this document.

**Reinvented independently — treat as physics:**

| Clause | personas-web | brainiac/console | This repo |
| --- | --- | --- | --- |
| **recharts** as the library | `^3.8.1`, 8 files | `^3.9.2`, 3 files | `^3.8.0` (3.8.1 installed), 8 files |
| **Zero-anchored value axes** | 1 `domain=`, `[0,100]` on a radar. **0 truncated axes.** | 3 `domain=`, all `[0,10]`/`[0,106]`. **0 truncated.** | 2 `domain=`, `[0,100]`/`[0,120]`. **0 truncated in recharts.** |
| **A shared colour module, not per-chart hex** | `lib/chart-theme.tsx` `CHART_PALETTE`, 7/8 files comply | `design/theme.ts` `band()` semantic hues, 2/3 | `chartConstants.ts` `CHART_COLORS`, but 6/8 files still use literals |
| **Redundant, non-hue encoding on every multi-series chart** | text legends + `strokeDasharray="6 3"` for compare | direct end-labels, opposite line shapes, dashed swatches, `●◐○` glyphs | dash+width-redundant latency, direct pie labels, dashed compare |
| **A tooltip guarded by `if (!active \|\| !payload?.length) return null`** | 4 sites | 3 sites | present |
| **A short-series guard on hand-rolled sparklines** | `Sparkline.tsx:27` `length < 2` | `KnowledgeHealth.tsx:101` `length < 2` | **7/7** hand-rolled plots |
| **Labelling the epistemic status of non-real data** | `"empty real dataset renders honestly"` | `"schematic — not a measurement"`, `"· demo trend"` | `trend_sim_suffix` + `strokeDasharray="6 4"` |

Three repos, three teams, zero shared documents, and **zero truncated value axes
across all of them**. The zero-anchored prescription in §2 is the strongest-supported
clause in this path — which makes D1's seven sample-derived scales, all in
hand-rolled SVG where no library default protects you, the clearest deviation the
convergence oracle could have surfaced.

**Where convergence contradicts me — reported as required:**

- **I was about to prescribe explicit reduced-motion gating of chart animation.**
  personas-web does it thoroughly (`useChartAnimation()`, 8/8 files, with a docstring
  naming recharts' "slow 1500ms ease that replays on every data refresh"). That
  looked like convergent physics. **It is a v2-era workaround.** Reading the
  installed library rather than trusting the sibling shows recharts 3.x defaults to
  `'auto'` and consults `prefers-reduced-motion` itself. This repo's 0 sites are
  **correct**, and personas-web's 8 are now redundant. The genuine gap is far
  narrower (Gap 4: the app's own `data-motion` attribute toggle). *Executing against
  the library beat reading the sibling.*
- **Chart accessibility has no trace anywhere.** `role="img"`, `aria-label`,
  `<title>`/`<desc>`, `accessibilityLayer`, screen-reader table fallbacks: **0 sites
  in personas-web, 0 in brainiac, ~0 here.** Under the naive reading that would mark
  §8 Gap 5 as local calibration. It is not — and the sibling data shows why. Both
  siblings apply the pattern *everywhere else*: brainiac labels 5+ hand-rolled SVG
  figures with `role="img"` + descriptive `aria-label` (`illustrations.tsx:49-50`
  labels every figure built through it *by construction*), and personas-web's
  dashboard carries 36+ `aria-*` attributes on non-chart controls. **The habit
  exists in all three codebases and stops at the chart boundary in all three.** Per
  the standing caveat that convergence measures *discoverability* rather than
  whether a requirement is real, this is the signature of a discoverability failure:
  the charting library's opacity defeats an otherwise-applied habit. Recorded as a
  gap, not withdrawn.
- **`Intl.NumberFormat` and locale-passing in chart formatters: 0/0/0.** Absent in
  all three. Here it is a live defect (14 locales, and
  `number-and-cost-formatting.md` owns it); in brainiac's console there is no i18n
  layer at all, so it is unlocalized by design. Same measurement, different verdict
  — a reminder that a shared zero is not automatically a shared bug.

**Local calibration, flagged as such:** the four-panel-wrapper sprawl (D6) and the
thirteen-sparkline population have no analogue — personas-web has one theme module
and one sparkline; brainiac has three direct usages. Both siblings are far smaller
chart surfaces. Prescribe `MetricChart` as a house convention, not as doctrine.

**A controlled experiment beats both.** The strongest evidence in this document is
not cross-repo at all — it is `MetricChart.height` (required) at **3/3** against
`LazyChart.fallback` (optional, defaulting to `null`) at **3/11**, in the same
feature area, same authors, same week. Consistent with `FacetedDecisionTable`'s
`emptyTitle` at 3/3 and `createLazySection`'s Suspense fallback at 22/22 vs 2/31.
And consistent with the caveat that a required prop carries only the property it
actually encodes: `MetricChart` requires `title`, `height` and `chart`, and still
ships no `aria-label`, no domain parameter, and no all-zero guard — Gaps 1, 5 and
D10 sit inside a primitive whose required props are all satisfied.
