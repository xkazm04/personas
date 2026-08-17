# Golden path — Metric tile

> **Topic path:** `product-surfaces` › `metrics-and-charts` › `metric-tile`
> [situation spine](../situation-spine.md) · recurrence **32 — the second-most recurrent leaf in the
> 247-leaf spine** · risk **low** · sides: **client** (contradicted — §12.1) · convergence: **mixed**
> · dimensions: **ui · function · code-quality**
> Leaf definition: *"one number on a card: a label, a value, often a delta and a sparkline."*
> Composed 2026-08-17 against `master` @ `5d55d6a4a`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**2,104** `.tsx`). The tile population was
> extracted **four times** by three anchors — definition-first, render-site-first, and inline-markup —
> and the four disagreed by up to **6×** depending on the denominator; §0 and §12.3 report the spread
> rather than one reconciled number. Read in full: `shared/components/display/{StatCard,Numeric}.tsx`,
> `overview/components/shared/KpiTile.tsx`, `overview/sub_sla/components/{SLACard,SLADashboard}.tsx`,
> `overview/sub_observability/components/ObservabilityDashboard.tsx` + `libs/useObservabilityData.ts`,
> `overview/sub_activity/components/{ExecutionMetricsDashboard,LlmSpendSection}.tsx` +
> `libs/{executionMetricsHelpers,useExecutionMetrics}.ts`, `overview/libs/computeTrends.ts`,
> `agents/sub_executions/detail/inspector/{inspectorShared,TraceSummary,CostBreakdownBar}.tsx`,
> `agents/sub_model_config/components/compare/CompareMetrics.tsx`, `lib/utils/formatters.ts`,
> `db/src/repos/execution/metrics.rs` (`get_execution_dashboard`, 380 lines),
> `db/src/repos/communication/sla.rs` (`get_sla_dashboard_with_offset`).
>
> **Measured by executing, not by reading.** Every tile below was **replayed** — the app's own
> formatter, the app's own window, the app's own guard — against a read-only **copy** of the
> operator's live 347 MB `personas.db` (+ `personas_data.db`), copied 2026-08-17 00:19 UTC with the
> app running; the live files were never opened for write and **both copies were deleted afterwards**.
> 2,188 executions, 2,942 execution traces, 90,813 spans, 88 headless LLM calls, 500 SLA rollup days,
> 78 personas. §0 publishes the number on screen beside the number the database holds.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL/JS.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. `personas-cloud` has **zero** `.tsx` and is reported
> as structurally absent. `personas-web` self-declares as a re-implementation of this desktop app
> **41 times** and is discounted to a half-vote (§6). **Effective independent cohort: 3, not 5.**
> The oracle found **two siblings meaningfully ahead of this repo** and inverted one brief clause.
>
> **The §9 signal was also portability-tested** — run verbatim, read-only, over all four sibling UI
> checkouts. It is the first §9 signal in the corpus to fire outside this repo (**11 / 5 / 13 / 15**),
> and it landed on the exact files the convergence sweep had independently named as the cohort's best
> and worst answers. §9 reports the caveats it did not verify.
>
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 963 Rust files, 4,828 `.ts`,
> 2,104 `.tsx`, 1,135 lint warnings / 0 errors.
>
> **Settles:** what a tile is allowed to print when the thing it measures was never measured.
>
> ### Sibling boundaries, settled in prose
>
> [**aggregate-count-display**](./aggregate-count-display.md) owns **cardinality** — a badge, an
> `N of M`, `?? 0` on a keyed lookup, and it ships `absent-entity-count-as-zero` (40/30). This path
> owns **a scalar readout on a card**, and the two rules intersect at **1 file of 48 (2%)**, measured.
> Its P4 (*"an unknown count is not zero"*) and this path's P1 are the same law against two different
> quantities; this leaf's contribution is that **the tile's own prop type is what destroys the
> distinction, before any call site gets a chance to be careful.**
>
> [**metric-definition**](./metric-definition.md) owns what the number *means* (the predicate, the
> unit, the window). [**scoring-and-thresholds**](./scoring-and-thresholds.md) owns what it takes for
> a number to become a **verdict**, and its headline — *"a correct sub-score cannot outvote its silent
> neighbours"* — is this leaf's headline one layer down: **a correct tile cannot outvote its silent
> neighbours in the same grid.**
>
> [**data-provenance-disclosure**](./data-provenance-disclosure.md) owns the `scope` pill and the
> staleness chip. [**number-and-cost-formatting**](./number-and-cost-formatting.md) owns separators
> and locale. [**chart-component**](./chart-component.md) and its rule `sample-derived-plot-scale`
> (7/7, and it **already covers `KpiTile.tsx`**) own the sparkline's y-axis; this path does not
> re-propose it and §8 Gap 4 hands it the sibling's better answer.
>
> [**execution-trace-instrumentation**](./execution-trace-instrumentation.md) established that
> `parser.rs:340-341` reads two field names the Claude CLI never emits. This path does not re-derive
> that; it measures **what the tiles built on top of it print**, and corrects the brief's version of
> the claim (§12.2).
>
> The **Deviations** section is a note backlog. **Nothing in it was applied** — per the
> [runbook](../golden-path-runbook.md), the operator uses this app daily and every entry changes what
> a number on screen says.

---

## 0. The headline

**Two dashboards in this app compute the same metric over the same empty window and print opposite
things. The SLA dashboard prints an em dash, with a seven-line comment explaining that a 0% success
rate "falsely screams total failure when the truth is no data". The Observability dashboard, four
files away, prints a green `0.0%`. And in the file that produces that zero, thirteen lines below it,
sits a comment refusing to fabricate a *delta* on exactly the grounds that would have refused the
*value*.**

```ts
// src/features/overview/sub_sla/components/SLADashboard.tsx:74-88
// Distinguish a genuine 0% success rate (real failures) from an empty /
// low-activity window with no decided runs. … rendering that as a red
// "0.0%" falsely screams "total failure" when the truth is "no data".
const decidedRuns = Number(data.global.successful) + Number(data.global.failed);
const hasActivity  = decidedRuns > 0;
const successValue = hasActivity ? formatPercent(data.global.success_rate) : '—';
```

```ts
// src/features/overview/sub_observability/libs/useObservabilityData.ts:96-98
const successRate = summary && summary.totalExecutions > 0
  ? ((summary.successfulExecutions / summary.totalExecutions) * 100).toFixed(1)
  : '0';
// :100-112 — thirteen lines below:
// "Returning nulls makes the Summary cards omit the trend chips … instead of
//  lying about a comparison we didn't actually compute."
```

`ObservabilityDashboard.tsx:218` then renders that `'0'` as `numericValue={parseFloat(d.successRate)}`
with `color="green"`. **The author who refused to fabricate the delta fabricated the value, in the
same hook, in the same session, and wrote the reason down next to the line that does it.**

### And the guard is per-tile, not per-grid — twice, independently

The SLA grid gets its **Success rate** tile right and its **Avg latency** tile wrong, side by side.
Replayed against the operator's database at each of the five windows the picker offers:

| window | decided runs | Success-rate tile | Avg-latency tile |
|---|---:|---|---|
| 7d | 0 | **"—"** ✅ guarded | **"0ms"** ❌ unguarded |
| 14d | 0 | **"—"** ✅ | **"0ms"** ❌ |
| **30d (the default)** | **0** | **"—"** ✅ | **"0ms"** ❌ |
| 60d | 318 | "98.4%" | "5.3m" |
| 90d | 2,166 | "89.0%" | "4.2m" |

`g_avg_dur`'s `else { 0.0 }` is at `db/src/repos/communication/sla.rs:508-511`; `formatDuration(0)`
is `"0ms"` (`lib/utils/formatters.ts:479`). The tile that says "your agents respond in 0
milliseconds" sits two inches from the tile that correctly says it doesn't know.

The same shape, in a different feature, by different authors, three lines apart in one grid:

```tsx
// src/features/agents/sub_executions/detail/inspector/TraceSummary.tsx:52-64
{stats.totalCost > 0 ? <>$<Numeric value={stats.totalCost} precision={4} /></> : '-'}   // ← guarded
…
<Numeric value={stats.totalInput + stats.totalOutput} />                                 // ← not
```

Replayed over **all 2,942 execution traces**:

| tile | renders | |
|---|---:|---|
| **Cost** — has a `> 0` guard | `-` on **115 / 2,942**, a real `$` figure on **2,827** | ✅ |
| **Tokens** — no guard, same grid, 12 lines down | **`0` on 2,942 / 2,942 (100%)** | ❌ |
| `CostBreakdownBar`, gated on `totalInput + totalOutput > 0` | **rendered 0 / 2,942 times** | never ran |

### How many tiles are showing the operator a number that is not true right now

Nine tile **positions**, across five surfaces, are *structurally* incapable of being true — not
"wrong on this data", but wired to a field the producer has never written:

| surface | tile positions that cannot be true | renders over the live database |
|---|---|---:|
| `inspectorShared.tsx:40-41` `InspectorStatStrip` | Input tokens, Output tokens | **4,376** (2 × 2,188 executions) |
| `TraceSummary.tsx:63` | Tokens | **2,942** |
| `CompareMetrics.tsx:49-50` | Tokens in, Tokens out | 2 per model comparison |
| `ExecutionComparison.tsx:88-89` | Input-token delta, Output-token delta | 2 per pair, both operands 0 |
| `SLADashboard.tsx:138` / `ObservabilityDashboard.tsx:218` | Avg latency, Success rate — on an empty window | 2 |
| | **9 positions** | **≥ 7,318 renders of a fabricated zero** |

Executed, the reason those are not honest zeros: **585 of the 2,188 executions carry
`cache_read_tokens` or `cache_creation_tokens` greater than zero** — 648,406,049 and 26,029,682
respectively — which is positive proof that tokens moved on runs whose two token tiles print `0`.

### The population — recurrence 32 understates it, and the denominator swings it by 6×

| | n |
|---|---:|
| `.ts`/`.tsx` walked | **4,829** (2,104 `.tsx`) |
| **metric-tile render sites** (an element receiving both a label and a value, non-interactive) | **299 in 71 files** |
| ↳ resolving to distinct component **definitions** | **68** |
| ↳ under distinct component **names** | **45** — `Stat` names **12 different components**, `StatCard` **6**, `StatChip` **3** |
| ↳ of those definitions, card-shaped with a display-size value ("a tile proper") | **33 definitions / 172 sites** |
| **hand-rolled inline tiles** (a bordered card with a label class and a display class, no component) | **52 in 45 files** |
| render sites of the **catalogued shared primitive** `display/StatCard` | **13** |
| render sites of the feature-scoped "unified" primitive `overview/…/KpiTile` | **26** |
| declarations of the shape `label: string; value: …` | **81** |
| ↳ that **can express "not measured"** (`number \| null`, `string \| null`) | **6 (7.4%)** |
| tile render sites whose value crosses the boundary already a **string** | **61** |
| tile render sites carrying an explicit absence arm (`—`, `N/A`) | **7** |
| tile render sites routed through `<Numeric>`, which renders `null` as an em dash | **10** |
| tile render sites defaulting the value to `0` with `?? 0` / `\|\| 0` | **10** |
| tile render sites passing a **delta or trend** | **11 in 7 files** |
| ↳ of those, hardwired to `null` on purpose | **4** |
| ↳ of those, that **state their baseline to the user** | **1** |
| `en.json` leaf keys | **19,112** |
| ↳ naming a comparison baseline ("vs prior period") | **11** |
| ↳ whose entire text is a "not measured" affordance | **7** |

**Primitive adoption, stated four ways, because [`tab-strip`](./tab-strip.md) measured that the
denominator swings a headline and this leaf reproduces it at 6.1×:**

| denominator | adoption of `StatCard` + `KpiTile` | adoption of the **catalogued shared** primitive alone |
|---|---:|---:|
| card-shaped tile sites only (172) | **22.7 %** | 7.6 % |
| all component-mediated tile sites (299) | 13.0 % | 4.3 % |
| **+ the 52 inline hand-rolls (351)** | **11.1 %** | **3.7 %** |

**22.7 % and 3.7 % are both true.** The honest sentence is: *among constructs that already went
through some tile component, two primitives cover about a fifth; against every labelled number on a
card in the app, the one primitive in the shared catalog covers one site in twenty-seven.*

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — physics, and the subject.** **A tile must be able to say "not measured", and that ability
> belongs to the tile's own contract, not to its callers' diligence.** Three states exist —
> *unmeasured*, *measured as none*, *measured as some* — and a value type that admits only a number
> or a string has already merged the first two before any call site can be careful. Every downstream
> guard is then a favour, and favours are unevenly distributed.
> *Warrant: measured here as 6 of 81 declarations able to express absence, with 7,318 renders of a
> fabricated zero downstream; and independently arrived at, with the reasoning written down, in two
> fully independent sibling repos — one of which states it as "null = nothing was asked. Deliberately
> distinct from 0."*
>
> **P2 — physics, and the sharpest clause here.** **The unmeasured case is a property of the grid,
> not of the tile.** Tiles are authored one at a time and read all at once. When one tile in a row
> guards its no-data case and its neighbour does not, the guarded one lends the unguarded one its
> credibility: a reader who sees an em dash next to a zero concludes the zero was measured.
> *Warrant: executed twice here, in two features, by different authors — a success rate reading "—"
> beside a latency reading "0ms", and a cost reading "-" beside a token count reading "0" twelve
> lines away. Both authors wrote a comment proving they knew the rule.*
>
> **P3 — physics.** **A value converted to display text before it reaches the tile arrives with its
> absence already spent.** Formatting is the last step, not the first; a string cannot be `null`, and
> a caller who must produce a string will produce `"0"`.
> *Warrant: 61 of 299 sites here stringify at the call site; the one sibling that types its tile value
> as a string is measurably the worst in the cohort at distinguishing zero from unknown, and coerces
> at every one of its call sites.*
>
> **P4 — physics.** **A delta is a claim about two populations, so the tile must name the second
> one.** "+12%" without "versus what" is not a compressed sentence, it is an incomplete one; and the
> baseline is a property of the window that produced it, so a hand-written label will eventually
> describe a window nobody is looking at.
> *Warrant: 1 of 11 delta sites here names its baseline; three siblings independently reinvented the
> label, and the best of them derives it from the same object that defines the window, making a stale
> label unrepresentable.*
>
> **P5 — function.** **Refusing to render a number is a legitimate answer and must be available.** A
> tile that cannot be honest should be empty, dashed, or explained — never zeroed. The instinct to
> always fill the slot is a layout instinct applied to a truth question.
> *Warrant: the repo's own best tile does exactly this and says why in a comment; and it is the
> answer two independent siblings reached, one of which puts a persistent on-screen banner over
> tiles whose numbers are fixtures rather than a note in the source.*
>
> **P6 — ui, and the polarity trap.** **Up is not good.** A tile that colours a rise green and a fall
> red is asserting a direction of virtue it was never told. Cost, latency, error rate and backlog all
> improve downward, and the tile cannot know which it is holding.
> *Warrant: two independent siblings ship the hardcoded up-is-green mapping (19 render sites between
> them), and two independent siblings model polarity explicitly under two different mechanisms — one
> as a tile prop, one as a per-metric rating band.*
>
> **P7 — ui.** **A sparkline drawn to fit its own sample turns noise into a trend.** Deriving the
> vertical extent from min and max of the points guarantees the line touches both edges, so a 62→64
> wobble and a 0→100 collapse are the same picture.
> *Warrant: 5 of 10 sparkline implementations across the fleet do this, including this repo's; three
> independent implementations anchor at zero instead, and one clamps to the metric's real domain and
> draws a reference line at a meaningful threshold.*
>
> **P8 — ui, function.** **While a tile grid is loading, the grid's geometry must be present and its
> numbers must not.** A blank region and a grid of zeros are the two failure modes, and the second is
> worse: it is indistinguishable from an answer.
> *Warrant: two fully independent siblings reinvented the tile-geometry skeleton, both writing down
> the no-blank/no-jump reason; the sibling that uses a spinner is the one whose tiles then render
> `$0.00 / 0 / 0.0%` on a fetch error.*
>
> **P9 — code-quality.** **A tile named after the concept is not a tile shared across the app.** The
> pull toward a local six-line `Stat` is enormous, because a tile is easy; the cost is that the
> absence rule, the polarity rule and the baseline rule must then be re-earned per copy.
> *Warrant: 68 tile definitions under 45 names here, one name covering 12 distinct components; the
> only sibling with high adoption is the one whose primitive lives in a shared folder AND carries the
> grid geometry with it.*
>
> **Scale condition.** P1, P2, P3, P5 and P6 are correctness on day one, at any size — they are wrong
> the first time the data is missing, which is usually the first time anyone opens the screen. P4 and
> P7 bite at the second window. P8 bites on a cold machine. P9 bites at the fourth tile.

---

## 1. Trigger

- "Add a stat card for that." / "put the total on the dashboard" / "show cost at the top"
- "Add a KPI row / summary cards / a metrics strip to this page."
- "Show the change since last week." / "add a little sparkline to that tile."
- "Why does this say $0.00 when we definitely spent money?"
- "The tile says 0 and the list below it has rows."
- "Two screens show different numbers for the same thing."

**If you are about to write** a JSX element that pairs a small label with a big number — or to type
`label: string; value: string` — **you are in this situation.** Likewise if you are about to write
`value={`${n}%`}`, `value={String(n)}`, `numericValue={x ?? 0}`, `trend={{ pct, invertColor }}`, or a
`<div className="rounded-card border …">` containing a `typo-caption` and a `typo-data-lg`.

You are **not** in this situation when the number is a **cardinality on a badge or an `N of M`**
([`aggregate-count-display`](./aggregate-count-display.md)), when the question is what the metric
*means* or over what window ([`metric-definition`](./metric-definition.md)), when the number becomes
a **grade or a colour band** ([`scoring-and-thresholds`](./scoring-and-thresholds.md)), when it is a
**series in a chart** ([`chart-component`](./chart-component.md)), or when you are choosing
separators ([`number-and-cost-formatting`](./number-and-cost-formatting.md)).

---

## 2. The one way

**Give the tile a value type that can say "we did not measure this", decide at the tile what that
looks like, and never let a caller convert a number to text on the way in.** Concretely: (a) type the
value `number | null` (or `string | null` for a pre-composed figure) and render `null` as a neutral
affordance — an em dash, a dimmed placeholder — **never** an absent tile and never `0`; (b) pass the
**number**, not a string: hand `value` + `unit` to the shared numeric primitive and let it own the
separators, the locale and the absence, because the moment you write `` `${x}%` `` the null is gone
and so is the locale; (c) **decide the no-data case for the whole grid at once** — write the
`hasActivity` / `decidedRuns` predicate above the grid and thread it into every tile, so a guard
cannot be present on one tile and missing on its neighbour; (d) if the tile shows a **delta**, carry
the baseline as data beside the percentage (`{ pct, invertColor, baselineLabel }`) and **derive
`baselineLabel` from the same object that defines the window**, so an "All time" window that has no
baseline yields no label and therefore no delta; (e) **model polarity** — a rise in cost, latency or
errors is not green, so the tile takes `invertColor` (or the metric carries its own rating band) and
the arrow follows the sign while the colour follows favourability; (f) a **sparkline** gets a fixed
or zero-anchored domain, not `min…max` of its own sample, and says `no data` at its own dimensions
rather than vanishing; (g) while the data is loading, render the **grid's geometry** as a calm
delayed ghost and no numbers at all — never a spinner, never zeros; (h) if the number genuinely
cannot be scoped honestly, **refuse to render it** and put the reason where it would have been. Then
stop: do not add a second local `Stat`, do not `?? 0` a fetched field, and do not format inside the
call site.

If you must get one right first: **(a) with (c)**. (b) is what makes (a) reachable and (d)–(f) are
what make the tile *useful*, but a tile grid where one number is guarded and its neighbour is not is
worse than a grid where none is, because the guarded one certifies the rest.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src/features/shared/components/display/StatCard.tsx`** — `StatCard({ label, value, icon, tone, delta, hint, spark, tooltip })` | **The catalogued shared tile.** Card chrome, a tone signal line, an optional `delta` with arrow + colour, an optional `spark` slot, an optional `hint` caption, and a whole-card `Tooltip`. Its `@catalog` tag says *"Use for dashboard stat rows instead of hand-rolling a tile."* Read §7 D3 before using `delta`. | **13 sites** |
| **`src/features/overview/components/shared/KpiTile.tsx`** — three densities (`console` / `card` / `card-rich`) | **The unification that worked and then was re-hand-rolled.** Its docstring: *"Unified KPI tile primitive — replaces 3 hand-rolled stat-tile shapes …"* — and it did: 26 sites across 9 files. It is the only tile in the app that models **delta polarity** (`KpiTrend.invertColor`, **required**, not optional) and the only one with a sparkline slot. It is also the only one that animates the value (`AnimatedCounter`) and the only one with a compact-notation path carrying the exact value in a `title`. | **26 sites** |
| **`src/features/shared/components/display/Numeric.tsx`** — `<Numeric value={n} unit="usd\|ms\|%\|count\|compact" />` | **The one primitive in this repo that already does the right thing with `null`** — `formatNumeric(null, …)` yields an em dash — and, since 2026-08-14, binds the active locale itself rather than asking 197 callers to. For `unit="compact"` it auto-attaches the full-precision value as a `title`. **Pass it the number, not a string.** | **198 value-driven sites**, of which **10** are inside a tile's `value` prop |
| **`src/lib/utils/formatters.ts`** — `formatCost`, `formatDuration`, `formatCount`, `formatCompactNumber`, `formatNumeric` | **The absence-aware formatters.** `formatDuration(null)` → `—`; `formatCost(null, {precision:4})` → `—`. Both carry the 2026-08-14 incident in their doc comments. Prefer these over anything local — see §5 for the local one that inverts them. | 27+ direct callers |
| **`src/features/overview/sub_sla/components/SLACard.tsx`** — `SlaCard({ label, value, sub, color, icon, tooltip, scope })` | **The best-reasoned tile in the app.** `scope` renders a corner pill (`"All-time"`) so a reader can tell which tiles move with the window picker and which don't; `tooltip` carries the metric's *denominator policy* (`"cancelled runs are excluded"`), with the comment explaining that it exists so a user comparing against an external SRE dashboard can see why the numbers differ. Both props are the disclosure half of [`data-provenance-disclosure`](./data-provenance-disclosure.md), delivered at the tile. | **4 sites** |
| **`SLADashboard.tsx:74-88`** — the `decidedRuns` / `hasActivity` predicate | **The no-data decision, taken once, above the grid**, with the failure it prevents written into a seven-line comment. This is §2 (c). It is also the only place in the app that does it — and §0 shows it did not reach the tile beside it. | 1 |
| **`SLADashboard.tsx:225-260`** — `SLAMetricsPlaceholder` | **The tile-geometry ghost.** Reproduces the 4-across grid, the card border, the icon square, the label bar and the value bar; `aria-hidden`; a 150 ms `animate-fade-in` so a fast fetch never paints a ghost pixel, then a 150/185/220 ms cascade. Its docstring cites [`docs/design/overview-loading.md`](../../design/overview-loading.md) §C. **Copy this file's placeholder before writing your own.** | 1 |
| **`src/features/overview/libs/computeTrends.ts`** — `splitComparisonPeriods`, `computeSeriesTrendPct` | **The refusal to fabricate a delta, with the incident in the docstring**: *"Callers must therefore render NO trend rather than fabricate one from a single loaded window (the front-half/back-half heuristic that used to lie on the Home 'Runs' tile)."* Returns `null` unless a genuine 2× window was fetched **and** the prior half is non-empty **and** the prior sum is non-zero. | 2 |
| **`src/features/shared/components/display/AnimatedCounter.tsx`** | The previous→target roll used by `KpiTile` when `numericValue` is set. `mode: 'roll' \| 'fade'` — `console` density uses `fade` so a list of tiles doesn't fire N × 280 ms on a batched refresh. | 14 |

**Explicitly NOT primitives, and why:**

- **`feedback/LoadingSpinner`** renders `null`. **4 tile-host files gate their entire tile grid behind
  it** (§7 D6), so their cold-load state is a blank region. See the spinner boundary in `CLAUDE.md`.
- **`overview/sub_activity/libs/executionMetricsHelpers.ts:1-2`** — `fmtCost` / `fmtMs`. A local
  re-implementation that inverts the canonical one: `fmtCost(0)` returns **`"<$0.01"`**, and
  `fmtCost(2036.26)` returns **`"$2036.26"`** with no grouping separator, in a 14-locale app. §7 D5.
- **The 45 local `Stat` / `StatCard` / `KpiMetric` / `Tally` / `Tile` definitions.** Not primitives —
  they are the population this path is about.

---

## 4. Steps

1. **Say the tile's sentence out loud before you write it.** *"Cost, all agents, last 30 days, as of
   the last refresh."* If you cannot finish it, you do not yet know what the tile is for — and you
   certainly cannot write its no-data arm.
2. **Ask what the tile shows when the answer is "nothing was measured".** Not "when the value is
   zero" — those are different questions and the whole leaf lives in the gap. Write the answer down
   in the same commit.
3. **Take that decision once, for the grid.** One predicate above the row —
   `const hasActivity = decidedRuns > 0` — threaded into every tile. `SLADashboard.tsx:84` is the
   model. **Do not** let tile #1 compute it and tile #2 assume it.
4. **Type the value so absence is spellable.** `value: number | null`, or `string | null` for a
   pre-composed figure. If you are reaching for `value: string`, you have already decided that no
   caller may say "unknown".
5. **Pass the number, not the text.** `<Numeric value={n} unit="usd" />` or `numericValue={n}` +
   `format`. Never `` `${n}%` ``, never `String(n)`, never `n.toFixed(2)` at the call site — that is
   the moment the null, the locale and the figure style all die together. 61 of 299 sites did it.
6. **Never `?? 0` a value that came off the network.** `d.summary?.totalCostUsd || 0` is the client
   asserting a fact the server did not send. Ten sites do this; leave the `undefined` and let step 4's
   type carry it.
7. **If there is a delta, carry its baseline as data.** Derive the label from the window object, not
   from a literal at the call site — a window with no prior period yields no label and therefore no
   delta. See §6's `ascent` finding, which is ahead of everything in this repo.
8. **Set the delta's polarity explicitly.** `invertColor` on `KpiTile` is already required; if you use
   `StatCard.delta` you are on your own, because it hardcodes up = green (§7 D3).
9. **If there is a sparkline, fix the domain.** Zero-anchor it, or clamp to the metric's real range.
   Never `min(...data) … max(...data)` — §8 Gap 4, and `sample-derived-plot-scale` already counts it.
10. **Write the loading state as the grid's geometry.** Copy `SLAMetricsPlaceholder`. Never a spinner,
    never `return null`, and above all never the tiles with zeros in them.
11. **Mark the tiles that don't move with the filter.** `scope="All-time"` on `SlaCard` is one prop
    and it is the difference between a grid a reader can trust and one they cannot.
12. **Stop.** Do not define a local `Stat`. Do not add a second cost formatter. Do not fill a slot you
    cannot fill honestly — leave it dashed and put the reason in the tooltip.

### Can the type make the wrong call impossible? — asked before §9

**Split answer. One half is a two-line edit that lands; the other half is genuinely out of reach.**

**T1 — YES for the unmeasured/zero axis, and the population is small enough to meet Q3.** The bad
state is `value: string` / `value: number` on a labelled readout — a type in which *"we did not
measure this"* is unspellable, so the caller must invent something, and inventing `0` is free while
inventing `—` requires knowing the rule. Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** `number | null` encodes *"there may be no
  measurement"* and **nothing about scope, window or unit**. A `null`-able tile can still show a
  90-day number under a 30-day picker. That is why §2 (c) and step 11 are separate mandates and not
  folded in — the same qualification [`metric-definition`](./metric-definition.md) earned on
  `successRateSource`, where the closed tag was right and the unit lived in the number beside it.
- **Q2 — requiredness ≠ closedness.** Making `value` required changes nothing; the wrong value is
  `0`, not the absence of the prop. Widening the type is the entire edit.
- **Q3 — a type nobody constructs constrains nothing.** **This is the qualification that scopes it.**
  The two designated primitives have **13 and 26** call sites — small, closed, reachable; the edit
  lands. A repo-wide `Measurement<T>` wrapper that all **299** sites (plus 52 inline hand-rolls) must
  adopt is a refactor, not a type, and does not meet Q3. **Ship the nullable value on `StatCard` and
  `KpiTile`; treat the general wrapper as direction.**
- **Q4 — a type anyone can construct authenticates nothing.** `number | null` is not an
  authentication claim. A caller can still pass `xs.length` or a stale number, and this type does not
  and should not pretend otherwise. That residue is what §9 ratchets.
- **Q5/Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is **the
  pre-formatted string**, not the number. Deleting `value?: string` from `KpiTile` and keeping only
  `numericValue` + `format` withholds exactly the freedom that kills the null — and the app already
  ran this experiment on the adjacent prop: `KpiTrend.invertColor` is **required** and gets 4/4
  correct polarity, while `StatCard.delta.direction` permits and gets a hardcoded green-for-up on all
  its sites. Withholding scored better than permitting inside one repo, one folder apart.
- **Q7 — relaxing a requirement is inert where the caller volunteers the bad value.** Nothing forces
  `?? 0`; the callers volunteer it. So the nullable type alone is **inert unless the render arm
  changes too** — `null` must render *something*. `KpiTile.renderValue` currently does
  `<Numeric>{value ?? ''}</Numeric>` (`KpiTile.tsx:164`), which renders an **empty string**, not an em
  dash: today, a tile with no value shows a blank space where the number should be. **Both edits or
  neither.**

**T2 — YES, and cheaply, for the delta's baseline.** `KpiTrend { pct: number; invertColor: boolean }`
has no slot for "versus what", so all 11 delta sites in the app are *structurally incapable* of naming
one. Adding `baselineLabel: string` makes the omission visible but not impossible — the fix that
actually holds is the sibling's (§6 clause 3): put `comparisonLabel` on the **window object**, so the
period and its label are one value and an all-time window ships `""`, which the tile renders as no
delta at all. `computeTrends.ts` already refuses to compute a delta without a real prior period; this
is the same discipline extended to the label.

**T3 — NO for "is this number true".** No type distinguishes `0` returned because the sum is zero from
`0` returned because the producer never wrote the field. `parser.rs` writes `Some(0)`, the column is
`NOT NULL DEFAULT 0`, and by the time the tile sees an `i64` both stories are the same eight bytes.
The reachable approximation is upstream — `Option<u64>` on the parsed field and a nullable column —
and it belongs to
[`execution-trace-instrumentation`](./execution-trace-instrumentation.md), not here. **This leaf's
job is to make sure that when the truth is unknown, the tile can say so.** That is why §9 gates the
tile's prop type and not the number.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`value: string` on a labelled readout** | "Not measured" becomes unspellable, so every caller must invent a placeholder, and `0` is the cheapest invention. **55 declarations, 48 files** (§9). The one sibling that types its tile value as a string coerces at 100% of its call sites. |
| **A guard on one tile and not its neighbour** | The guarded tile lends the unguarded one its credibility. Executed twice: `"—"` beside `"0ms"`, and `"-"` beside `"0"` twelve lines apart. §0, §7 D1, D2. |
| **`` value={`${n}%`} `` / `String(n)` / `n.toFixed(2)` at the call site** | Kills the null, the locale and the figure style in one expression. **61 of 299 sites.** §7 D4. |
| **`?? 0` / `\|\| 0` on a fetched field inside a tile prop** | The client asserting a fact the server did not send; an unsettled or failed fetch renders `$0.00` in green. `ObservabilityDashboard.tsx:216,217,219`. **10 sites.** |
| **`: '0'` in the hook rather than the component** | Same defect, moved one file away, where the tile author cannot see it. `useObservabilityData.ts:98`. §0. |
| **A local `fmtCost` that returns `"<$0.01"` for zero** | Renders "we spent almost nothing" where the truth is "we have no cost data". Executed: `fmtCost(0) === '<$0.01'`. §7 D5. |
| **A local `fmtCost` that returns `` `$${v.toFixed(2)}` ``** | `"$2036.26"` — no thousands separator, no locale, in a 14-locale app whose canonical `formatCost` has done this correctly since 2026-08-14. §7 D5. |
| **`up = green` hardcoded in a tile** | Cost, latency, error rate and queue depth all improve downward. `StatCard.tsx:51-56` maps `'up'` → success and `'down'` → error unconditionally, while its sibling `KpiTile` **requires** `invertColor`. §7 D3. |
| **A delta with no baseline** | "+12.3%" against an unnamed period is an incomplete sentence. **1 of 11 delta sites names one.** §7 D7. |
| **A sparkline scaled to its own sample** | Guarantees the line touches both edges, so noise and collapse draw identically. `KpiTile.tsx:104-106`. Already counted by `sample-derived-plot-scale`; §8 Gap 4. |
| **`<LoadingSpinner>` gating a tile grid** | It renders `null`. The cold-load state of the Activity metrics dashboard is an empty flex container. **4 host files.** §7 D6. |
| **`if (loading && !data) return null` above a tile row** | The tiles do not ghost, they cease to exist, and the page below jumps when they come back. **3 host files.** §7 D6. |
| **A local `Stat` beside the shared one** | 68 definitions under 45 names; `Stat` alone names 12 different components. Every copy must re-earn the absence rule, the polarity rule and the baseline rule, and none of them does. §7 D8. |
| **A tile whose value is a field the producer never writes** | Not "wrong on this data" — structurally incapable of being right, and visually identical to a real zero. **9 positions, ≥7,318 renders.** §0, §7 D2. |
| **Hardcoded English in a tile label** | `label="fields"` (`IdentityAtelier.tsx:119`) in a 14-locale app. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_sla/components/SLADashboard.tsx:74-88` together
with `SLACard.tsx` and `SLAMetricsPlaceholder`.**

```ts
// Distinguish a genuine 0% success rate (real failures) from an empty /
// low-activity window with no decided runs. When nothing has completed
// or failed in the window, the backend returns its divide-by-zero
// fallback of `success_rate = 0.0` (sla.rs); rendering that as a red
// "0.0%" falsely screams "total failure" when the truth is "no data".
// `decidedRuns === 0` is the no-data sentinel — mirror the per-agent
// "no data" treatment (neutral color + "—") instead. A real 0% with
// actual failures still has decidedRuns > 0, so it stays red.
const decidedRuns  = Number(data.global.successful) + Number(data.global.failed);
const hasActivity  = decidedRuns > 0;
const successValue = hasActivity ? formatPercent(data.global.success_rate) : '—';
const successColor = hasActivity ? slaColor(data.global.success_rate) : 'neutral';
const successSub   = hasActivity ? tx(t.overview.sla.executions_summary, …) : t.overview.sla.no_agent_data;
```

Six things to copy: (1) the no-data predicate is computed **once, above the grid**, from the
*backend's own* divide-by-zero fallback — it names the exact mechanism it is compensating for;
(2) the **colour** changes too (`'neutral'`, never red), because a dash in a red card is still an
accusation; (3) the **sub-caption** changes too, so all three of the tile's channels agree;
(4) `scope="All-time"` on the two tiles that ignore the window picker; (5) `tooltip` carrying the
denominator policy; (6) `SLAMetricsPlaceholder` reproducing the grid's exact geometry with a 150 ms
anti-flash delay. **Then read §7 D1, because this same file forgets all of it on the next tile.**

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `overview/libs/computeTrends.ts:22-47` | **The refusal to fabricate a delta, with the incident in the docstring** — *"the front-half/back-half heuristic that used to lie on the Home 'Runs' tile"*. Returns `null` unless a real 2× window was fetched. |
| `overview/sub_observability/libs/useObservabilityData.ts:100-113` | **The same refusal, applied**: four trend fields hardwired to `null` with eleven lines saying why, and a `TODO` naming the fix. The right instinct — see §0 for what happened three lines above it. |
| `overview/components/shared/KpiTile.tsx:31-37, :174-179` | **`KpiTrend.invertColor` is REQUIRED, not optional** — the one place in the app where a tile cannot forget that down can be good. Also `:150` — a compact figure attaches its full value as a `title` *only when compaction actually hid digits*. |
| `shared/components/display/Numeric.tsx:36-48` | **The gate-pointing-at-a-broken-destination fix, executed** — the locale default was moved *into* the primitive after measuring 189 of 197 callers not passing it. Read this before adding any prop a caller could forget. |
| `agents/sub_executions/libs/comparisonHelpers.ts:101` | `if (totalLeft > 0 && totalRight > 0)` — a token comparison that **declines to report** rather than divide by a zero it does not trust. |
| `agents/sub_lab/components/versions_table/LabVersionsTable.tsx:41-42` | The defect stated in its own docstring: *"Mean prompt + completion tokens for a measured row; **0 when never measured**."* Someone wrote the leaf's headline down as a comment and shipped it. |
| `overview/sub_activity/components/LlmSpendSection.tsx:99-102` | The one token tile in the app backed by a producer that actually writes tokens (`dev_llm_spend`: 16,750 in / 1,002,226 out / $118.07 over 88 calls). Same component, same prop, honest number — the difference is entirely upstream. |

### Convergence — 5 sibling repos, effective cohort 3

Swept read-only. `personas-cloud` has **zero** `.tsx` (top level is `facade/` + `packages/`; last
commit *"Cloud rewrite plan"*) — **structurally absent** for every clause below, reported as such
rather than counted as a choice. `personas-web` **self-declares as a re-implementation of this
desktop app 41 times** (e.g. `IncidentsKpiHeader.tsx:18` *"The web counterpart to the desktop
Incidents Inbox KPI header"*); at the tile layer it is a *feature* port rather than a code port —
this repo names the polarity prop `invertColor`, it names it `goodDirection` and extracts it into a
helper with no counterpart here — so it is discounted to **half a vote** and is never the sole second
vote for a physics call. `brainiac` (222 `.tsx`), `vibeman` (586), `ascent` (336) are fully
independent. **Effective independent cohort: 3.**

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **A metric-tile primitive gets invented** | **PHYSICS (ascent, vibeman, + web semi)** | ascent `components/ui/Stat.tsx:26` → `org/shared/ui.tsx:56` `Tile`, **54 render sites / 13 files / 7 tabs**; vibeman's de-facto `ReflectorKPICard` **17 sites**; personas-web `MetricCard` 4. brainiac: **16 big-number sites, zero abstraction, no comment contemplating one** — a genuine silence. |
| 1b | **…in a shared folder AND actually adopted** | **MINORITY — `ascent` alone** | Adoption against each repo's own hand-rolls: ascent **54/58 = 93 %**, vibeman **17/53 = 32 %** (and **0 %** if you require `components/ui` — its nominal `ui/wizard/StatCard.tsx:24` is **exported and has zero render sites**), personas-web **4/20 = 20 %**. Ours is **11.1 %**. **Two of four repos ship a shared tile primitive with zero or near-zero adoption; the difference in ascent is that the primitive carries the grid geometry (`TILE_LEDGER`, `TILE_GRID`, 25 sites) so adopting it is easier than not.** |
| 2 | **Polarity is modelled ("up is good?")** | **PHYSICS, two independent mechanisms** | vibeman does it at the **data layer** — `lib/metrics/doraMetricsEngine.ts:65-78` rates change-failure-rate and MTTR into bands, both lower-is-better, and the tile colours by rating, not direction. personas-web does it as a **tile prop** (`MetricCard.tsx:22,37-42`) and splits the channels: *"Arrow follows the numeric sign so the tile stays honest about what moved / Color follows favorability so a rise in spend/errors reads as red, not green."* **A name-only sweep would have missed vibeman entirely.** |
| 2b | **`up = green` hardcoded** | **PHYSICS AS A DEFECT (vibeman, ascent)** | vibeman `ReflectorKPICard.tsx:42-53` across 17 sites — and the workaround proves the gap: `ObsKPICards.tsx:41-47`'s Error Rate tile gives up on the trend and hand-writes `accentColor={errorRate > 5 ? '#f87171' : '#4ade80'}`. ascent `components/ui/format.ts:22-26` `DIRECTION_TONE`, domain-safe today only because its deltas are all maturity scores. **This repo's `StatCard.tsx:51-56` is the same defect.** |
| 3 | **A delta names its baseline** | **PHYSICS (3 of 3.5) — and `ascent` is ahead of everyone** | ascent **3/3 (100 %)**, personas-web 3/5, vibeman 2/19, brainiac 0 (no deltas at all). Ours: **1 of 11.** |
| 4 | **`null` distinguishable from `0`** | **PHYSICS, unusually strong (2 fully independent, both with written doctrine)** | brainiac `console/src/observatory/observatory-data.ts:18-20`: *"`null` = nothing was asked. **Deliberately distinct from 0** (everything missed)"*, rendered at `Observatory.tsx:476` as `{pct === null ? "—" : …}` with the rationale at `:453-457` (*"better than rendering 0% and implying failure"*). ascent `LiveWarRoomStat.tsx:93,104` types `value: number \| null`, renders `—`, **and switches the colour off** at `:117` so an unmeasured tile cannot wear a score colour. personas-web is the counter-example and the worst in the cohort (`MetricCard.tsx:26` `value: string`, every call site coercing `?? 0`). |
| 5 | **Tile-geometry skeleton while loading** | **PHYSICS (vibeman, ascent)** | vibeman `DORAMetricsPanel.tsx:89-101` reproduces the 4-across grid with label-bar and value-bar proportions, and `CostAnalyticsPanel.tsx:111` separates *loading* from *empty*. ascent's `app/org/[slug]/loading.tsx:14-18` covers every org tab from one file, with the reason in its header. **Our `SLAMetricsPlaceholder` is the same invention, independently.** |
| 5b | **Tiles rendering `0` while loading** | **NOBODY on cold load — personas-web on ERROR** | `PerformanceMetricsGrid.tsx:26-29`'s `?? 0` fires whenever `metrics` is null and `loading` is false, i.e. on a fetch error, rendering `$0.00 / 0 / 0.0% / 0` under a live-looking sparkline. **That is our `ObservabilityDashboard.tsx:216-219` exactly, in a repo that ported our dashboard.** |
| 6 | **A sparkline inside a tile** | **PHYSICS (7 impls / 3 siblings)** | brainiac has zero — structurally silent. |
| 6b | **Sample-derived y-axis** | **PHYSICS AS A DEFECT — 5 of 10 impls, including ours** | Zero-anchoring is *also* physics (vibeman ×2, ascent ×1). |
| 6c | **Fixed domain + a reference line at a real threshold** | **`ascent` ALONE, and it is the best answer in the sweep** | `components/report/chartScale.ts:22-32` clamps to 0..100 and guards non-finite; `:60-62` centres a lone point — *"a one-scan chart renders a dot in the middle rather than at the left edge"*; `TrendChart.Sparkline.tsx:44` — *"Reference line at the L4 (Advanced) threshold — a real band edge, not an arbitrary 50."* |
| 6d | **Naming the absence instead of vanishing** | **`vibeman` ALONE** | `charts/QueryPerformanceWidget.tsx:64-71` renders `NO_DATA_POINTS` at the sparkline's exact dimensions instead of `return null`. Every other implementation in all five checkouts silently collapses, including `KpiTile.tsx:103`. |
| 7 | **Fabricated tile numbers shipping** | **PHYSICS AS A DEFECT (personas-web, vibeman)** | personas-web `EventBusStats.tsx:9-28` — three stat tiles driven by `Math.random` on a 2 s interval, under a hardcoded `const [connected] = useState(true)` rendering a pulsing green dot and the word *"connected"*. vibeman `FileScannerModal.tsx:167` — `Math.floor(Math.random() * 200) + 50` feeding a `StatCard` with 25 render sites. ascent: **zero `Math.random` in `.tsx`**. |
| 7b | **Telling the USER the tile numbers are fixtures** | **`brainiac` ALONE, and it is the best answer** | `console/src/components/DemoBanner.tsx:10-38` — a persistent banner: *"demo data — The brainiac server is unreachable — these numbers are the Meridian fixture org."* Plus `live: false` / `weeklyIsDemo: true` in the payload itself, gating the drill-down links. Everyone else's disclosure is a source comment. |

**Physics — keep as doctrine:** clauses 1, 2, 2b, 3, 4, 5, 6, 6b, 7.
**Reported as MINORITY / THIS-REPO-ALONE:** 1b (ascent), 6c (ascent), 6d (vibeman), 7b (brainiac).
**Silences, reported as silences:** brainiac has no tile primitive, no deltas and no sparklines, and
no comment anywhere contemplating any of them; `personas-cloud` is structurally absent.

**Personas is ahead** on exactly two things and they are worth defending: **`KpiTrend.invertColor`
being required** (no sibling makes polarity mandatory), and **`computeTrends`' written refusal to
fabricate a delta** (the closest sibling analogue is ascent's empty `comparisonLabel`, which is
better). Personas is **behind** on the nullable value type (2 independent siblings, both with written
doctrine), on the derived baseline label (ascent), on primitive adoption (93 % vs 11 %), and on
sparkline scaling (ascent).

> **The strongest external result is clause 3, and it is a type this repo can adopt on Monday.**
> `ascent/src/lib/window.ts:46-57` puts the baseline *and its label* on the window object:
> `comparisonLabel: "vs 90d ago"` for a 90-day window, **`""` for "All time"** — and `Stat.tsx:34`
> hides the delta row when there is no label. The tile cannot claim a baseline it does not have,
> because the label and the baseline are one value. It is covered by a test (`window.test.ts:133`).
> Our `KpiTrend` has no slot for it at all, so all 11 of our delta sites are structurally incapable.

### The composition defect with the neighbouring paths — offered upward

**(i) with [`aggregate-count-display`](./aggregate-count-display.md).** Its §4 T1 prescribes
`badge?: number | null` with `null` rendered as *"a dimmed placeholder"*. This path prescribes the
same shape for a tile. **Followed together on one screen they produce two different renderings of the
same fact** — a dimmed dot on the badge and an em dash on the tile — because neither path names the
glyph. The repo has **8 `en.json` keys whose entire value is an em dash**, all local, and no shared
"unmeasured" affordance. The one-line clause both paths need: **the unmeasured rendering is a
design-system token, not a per-primitive choice.**

**(ii) with [`data-provenance-disclosure`](./data-provenance-disclosure.md).** Its prescription is to
*disclose* a number's provenance with a `scope` pill. Applied to §0's tiles that would put an
"All-time" pill on a number that is structurally zero — **decorating a falsehood with a caption
about its scope.** The order matters: **establish that the number exists before disclosing where it
came from.** `SlaCard` gets this right by accident, because its `scope` prop and its `'—'` arm were
added for different reasons.

**(iii) with [`scoring-and-thresholds`](./scoring-and-thresholds.md).** Its headline is that a
correct sub-score is outvoted 60:40 by two neighbours that pay full marks for silence. This path's
headline is the same mechanism at the pixel: a correct tile is outvoted by the neighbour that prints
a zero. **The shared clause is that the no-evidence decision must be made for the composite, not for
each part** — whether the composite is a weighted score or a row of four cards.

---

## 7. Deviations

Every entry is live on `master` @ `5d55d6a4a`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All shipped under a green
`npm run check` (0 errors, 1,135 warnings — [`shared-facts.json`](../shared-facts.json)).
**None applied**: every one changes what a number on screen says.

### D1 — Two dashboards, one metric, opposite answers on an empty window · **executed**

Full replay in §0. `SLADashboard.tsx:86` renders `'—'` for an unmeasured success rate;
`useObservabilityData.ts:98` renders `'0'` for the same quantity, and
`ObservabilityDashboard.tsx:218` paints it `color="green"`. The SLA file carries a seven-line comment
explaining precisely why the observability file is wrong, and the observability file carries an
eleven-line comment refusing to fabricate a *delta* thirteen lines below the line that fabricates the
*value*.

**Fix (note):** lift `useObservabilityData`'s `: '0'` to `: null` and give `KpiTile` a `null` arm
(§4 T1). The consumer already handles `trend: null`; it cannot handle `numericValue: null`.

### D2 — The guard is per-tile, not per-grid · **2 independent instances, both executed**

- **SLA grid.** Success rate `'—'` ✅ / Avg latency `"0ms"` ❌, at 7/14/30-day windows including the
  **default**. `SLADashboard.tsx:138`, backend fallback at `sla.rs:508-511`.
- **Trace summary grid.** Cost `-` ✅ (115/2,942) / Tokens `0` ❌ (**2,942/2,942**).
  `TraceSummary.tsx:52` vs `:63`, twelve lines apart, one `useMemo`.

**Fix (note):** one `hasActivity` predicate above each grid, threaded into every tile (§2 c).

### D3 — `StatCard` hardcodes up = green; its sibling makes polarity required · **13 sites**

`shared/components/display/StatCard.tsx:51-57`:

```tsx
const deltaColor = delta?.direction === 'up'   ? 'text-[var(--status-success)]'
                 : delta?.direction === 'down' ? 'text-[var(--status-error)]'
                 : 'text-foreground/50';
```

`delta.label` is a free `string` and `direction` drives arrow **and** colour together, so a cost tile
whose spend rose renders a **green** up-arrow. `KpiTile.tsx:32-37` solves this correctly with a
**required** `invertColor: boolean` — and `:174-176` separates `isUp` from `isGood`. Two tile
primitives in one repo, one folder apart, on opposite sides of the withhold-vs-permit axis; the
convergence sweep found both siblings that hardcode it and both that model it (§6 clauses 2, 2b).

**Fix (note):** `delta: { label: string; direction: 'up'|'down'|'flat'; invertColor: boolean }` —
copy `KpiTile`'s resolution, or split arrow from colour the way `personas-web/MetricCard.tsx:39-42`
does with the reasoning in the comment.

### D4 — 61 of 299 tile values are already strings when they cross the boundary

`value={`${x}%`}` at 21 sites, `String(x)` / `.toFixed()` / `.toLocaleString()` at 32, mixed at 8.
Each one kills the null, the locale and the figure style in one expression. Worst instance:
`inspectorShared.tsx:40-41` — `execution.input_tokens.toLocaleString()` on a column that is `0` in
**2,188 of 2,188 rows**, which is *both* a hand-rolled formatter (the known drift) *and* a number
that cannot be true. Two lines below it, `:43` gets the same question right:
`hasCacheData ? \`${cacheHitPct}%\` : '–'`.

**Fix (note):** `<Numeric value={n} unit="count" />` — 4 characters longer and it renders `—` for
`null` and the right separator for 14 locales.

### D5 — A local cost formatter that inverts the canonical one's answer for zero · **2 tiles**

`overview/sub_activity/libs/executionMetricsHelpers.ts:1-2`:

```ts
export const fmtCost = (v: number) => v >= 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
```

Executed: `fmtCost(0)` → **`"<$0.01"`** — a zero rendered as *"less than a cent"*, which a reader
parses as a small measured amount. `fmtCost(2036.2570954)` → **`"$2036.26"`** — no grouping
separator, no locale, while `lib/utils/formatters.ts:121-160`'s `formatCost` has bound the active
locale since 2026-08-14 and carries the 23-of-27-callers incident in its comment. Consumed by the
**Total cost** tile on the Activity dashboard (`ExecutionMetricsDashboard.tsx:93`) and the **Total
cost** tile in `LlmSpendSection.tsx:99`.

**And it is not alone.** `agents/sub_executions/libs/comparisonHelpers.ts:28-34` is a *second*
hand-rolled `fmtCost` with the same shape and the same defect:

```ts
export function fmtCost(v: number, opts?: { precision?: 4 | 'auto' }): string {
  if (v < 0.001) return '<$0.001';                       // fmtCost(0) === '<$0.001'
  …
  return `$${v.toFixed(4)}`;                             // no locale, no grouping
}
```

**Seven cost formatters exist in `src/`: one canonical, four that delegate to it
(`ExecutionPreviewPanel.tsx:13`, `inspectorTypes.ts:18`, `useReplayState.ts:14`,
`knowledgeHelpers.ts:36`), and two independent hand-rolls that both render zero as a small positive
amount.** Both hand-rolls sit in the execution/metrics feature; both were written after the canonical
one grew its null arm.

**Fix (note):** delete both; call `formatCost(v, { precision: 'auto' })`, which returns `—` for
`null` and `$0.00` for a real zero at `precision: 2`.

### D6 — Tile grids that vanish while loading · **7 host files of 71**

| shape | files | effect |
|---|---:|---|
| `if (isLoading) return <LoadingSpinner/>` | **4** — `ExecutionMetricsDashboard.tsx:28-33`, `CloudStatusPanel`, `FleetSessionInsights`, `CredentialIntelligence` | `LoadingSpinner` renders **`null`**, so the cold-load state is an empty flex container |
| `if (loading && !data) return null` | **3** — `LlmSpendSection.tsx:57`, `AthenaUsageSection`, `AthenaHealthPanel` | the tiles cease to exist and the page below reflows when they arrive |
| a geometry-matched placeholder | 30 | ✅ |

`LlmSpendSection.tsx:55-57` at least states the trade-off in a comment (*"a flash of empty chrome
during the first fetch is more jarring than its late arrival"*) — which is the choice the loading
doctrine's law 1 exists to overrule.

**Fix (note):** `SLAMetricsPlaceholder` is 35 lines and already carries the anti-flash delay.

### D7 — 11 delta sites, 1 baseline · **and 4 of the 11 are hardwired to `null`**

`ObservabilityDashboard.tsx:216-219` passes `trend={d.trends.cost}` … and
`useObservabilityData.ts:112-115` returns `{ cost: null, executions: null, successRate: null,
personas: null }` — a frozen object, with a `TODO`. So four tiles render `KpiTile`'s no-trend arm,
`<span className="typo-body text-foreground">--</span>` (`KpiTile.tsx:246`), **beside a sparkline of
seven real days**. A trend visual with no trend number and no explanation.

The only site that names its baseline is `ErrorCategorySection.tsx:78-79` —
`trend={prior > 0 ? { pct: deltaPct, invertColor: true } : null}` with
`subtitle={t.overview.activity.error_category_prior_period}` = *"vs. prior period"*. Of **19,112**
`en.json` keys, **11** name a comparison baseline; **one** of them is wired to a tile.

**Fix (note):** §4 T2 — put `comparisonLabel` on the window object per `ascent/src/lib/window.ts:54`.

### D8 — 68 tile definitions under 45 names; `Stat` names twelve different components

`Stat` is defined at `DeckSummary.tsx:27`, `DryRunModal.tsx:242`, `JudgePanel.tsx:8`,
`HealingEffectivenessPanel.tsx:142`, `AthenaHealthPanel.tsx:19`,
`ResearchProjectListCartograph.tsx:216`, `BrainAtelier.tsx:324`, `ChannelsAtelier.tsx:389`,
`IdentityAtelier.tsx:326`, `KnowledgeAtelier.tsx:493`, `ToneAtelier.tsx:424`,
`TrainingAtelier.tsx:514` — twelve components, twelve prop shapes, one name. `StatCard` names six.
The seven Twin ateliers' `Stat` bodies are byte-similar and a shared `TwinStat` **already exists**
(`plugins/twin/shared/TwinStat.tsx:30`) with **zero** of them importing it.

**And the unification primitive has itself been re-hand-rolled under its own name:**
`overview/components/shared/KpiTile.tsx` says *"Unified KPI tile primitive — replaces 3 hand-rolled
stat-tile shapes"*, and `home/sub_cockpit/widgets/ExecutionFactsWidget.tsx:108` defines a **second,
local `KpiTile`** with 6 render sites. A fourth hand-roll, wearing the name of the fix.

**Fix (note):** the seven Twin `Stat`s → `TwinStat` is mechanical and zero-risk (identical render).
The rest is a §9 ratchet, not a refactor.

### D9 — 10 tile values defaulted to zero from an optional-chained fetch

`ObservabilityDashboard.tsx:216,217,219` (`d.summary?.totalCostUsd || 0`),
`CampaignReportPanel.tsx:119-123` (5 ×`report?.x ?? 0`), `WorkspacesAtlas.tsx:74-75`,
`DeploymentCard.tsx:163`. A response that has not arrived and a response that says zero are the same
pixels. Distinct from
[`aggregate-count-display`](./aggregate-count-display.md)'s `absent-entity-count-as-zero` (a **key
missing from a present map**) and from
[`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s
`read-failure-as-empty-value` (needs a `.catch(`): this is **the whole response absent**, in a render
expression, with no catch anywhere near it. Measured overlap with both: **1 file and 0 files of 48.**

### D10 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"Every run records $0."** **False, and the brief said it.** `SUM(cost_usd)` over
  `persona_executions` is **$2,036.2570954** across **1,970 of 2,188 rows**; the 2,942 trace root
  spans carry the same money. **Only the token half is zero.** See §12.2 — this materially changes
  which tiles are lying.
- **"`CostBreakdownBar` has never rendered."** **Confirmed by replay**, and now with the mechanism:
  `TraceSummary.tsx:92` gates it on `stats.totalInput + stats.totalOutput > 0`, which is **0/2,942**.
  Its 7-case test file passes because the tests supply `inputTokens={ONE_M}`.
- **"The two cost tiles in the execution detail disagree."** **They do not.** For the **2,062**
  executions that have both a row and a trace, the trace root's `cost_usd` and
  `persona_executions.cost_usd` are **identical in 2,062 of 2,062 cases — zero disagreements.** What
  *is* true is that **880 traces have no `persona_executions` row at all**, holding **$1,080.29** of
  spend that no cost tile in the app can reach. That is the retention story
  [`data-provenance-disclosure`](./data-provenance-disclosure.md) owns; the new number is the dollar
  figure.
- **`Numeric` is not the problem here either** — same finding as the neighbour's §12.3, from the
  tile side. It renders `null` as an em dash and now binds its own locale. It appears in only **10 of
  299** tile value props, and the absence is destroyed *upstream* of it by the tile's prop type.
- **The `KpiTile` sparkline's sample-derived scale is real and is already gated.**
  `sample-derived-plot-scale` (7 files) includes `KpiTile.tsx`. Not re-proposed; §8 Gap 4 hands it
  ascent's better answer instead.
- **The headless LLM lane's token tile is honest.** `dev_llm_spend` holds 16,750 input and 1,002,226
  output tokens over 88 calls; `LlmSpendSection.tsx:101` renders a real number through the same
  `KpiTile` prop that renders a fabricated zero everywhere else. **The component is not the defect.**
- **`computeTrends` is not the defect either.** I expected to find fabricated deltas and found a
  helper that refuses to compute one without a real prior period, with the incident in its docstring.
  The defect is the *absence* of a baseline label, not a wrong one.

---

## 8. Gaps

**Gap 1 — No shared component in this app can render an unmeasured number.** `StatCard.value` is
`ReactNode` (so `null` renders *nothing*, collapsing the tile), `KpiTile.value` is `string` and
`numericValue` is `number` (so `undefined` reaches `<Numeric>{value ?? ''}</Numeric>` and renders an
**empty string**), `SlaCard.value` is `string`. **6 of 81 labelled-value declarations in the whole app
can express absence**, and the two designated primitives are not among them. `Numeric` can — and 10
of 299 tile values reach it. This is upstream of D1, D2, D4 and D9, and the fix is §4 T1's two-line
edit plus a render arm. The convergence sweep found two fully independent siblings that solved it and
wrote down why, so this is neglect rather than difficulty.

**Gap 2 — There is no token for "not measured".** 8 `en.json` keys are an em dash, 7 more are a
"Not measured" phrase, and all 15 are feature-local. There is no shared glyph, no `<Unmeasured/>`, no
design-system entry — so every author who does the right thing invents a different right thing
(`—`, `-`, `–`, `--`, `N/A`, `0`), and `SLA_CARD_COLOR_CLASSES.neutral` is the only place that pairs
one with a colour rule. This is also the composition defect in §6 (i).

**Gap 3 — `KpiTrend` has no slot for a baseline, so no call site can name one.** All 11 delta sites
in the app are structurally incapable. The repo's own `computeTrends` knows the window (it takes
`currentPeriodDays` and `compareEnabled`) and throws that knowledge away when it returns a bare
number. ascent's answer — carry the label on the window object — is 6 lines and is covered by a test.

**Gap 4 — The sparkline's domain comes from its own sample.** `KpiTile.tsx:104-106`:
`min = Math.min(...data); max = Math.max(...data); range = max - min || 1`. Guarantees the polyline
touches both edges, so noise draws like a trend. Compounded at
`ObservabilityDashboard.tsx:120-123`, where `sparklineSuccess` maps a day with **no runs** to
`0`, so an idle day draws a crash to the floor. Already counted by `sample-derived-plot-scale`; the
answer to adopt is `ascent/src/components/report/chartScale.ts:22-32` (clamped domain, non-finite
guard, lone point centred) plus a reference line at a real threshold.

**Gap 5 — Nothing can express "this tile is a fixture."** brainiac's `DemoBanner` and its
`live: false` payload flag are the fleet's best answer and have no analogue here. Our onboarding and
template-preview tiles have no way to say the numbers are illustrative, and the operator's install
currently shows several tiles whose only honest caption would be *"no runs since 2026-06-26."*

**Gap 6 — The census rule keys on a TYPE DECLARATION and therefore cannot see three-quarters of this
leaf.** §9's signal matches `label: string; value: string|number`. It does **not** see the 52 inline
hand-rolled tiles (no props at all), the 61 call sites that stringify, the 10 `?? 0` defaults, the
missing delta baselines, or the per-grid guard asymmetry that is §0's headline. **A green census is
not coverage of this leaf.** Four of those five are §4's type edits; the fifth (per-grid asymmetry) is
a relation between two JSX siblings and is refused in §9 with its numbers.

---

## 9. The missing gate

**The condition to enforce:** *a labelled scalar readout declares its value as a bare `string` or
`number`, so "we have not measured this" cannot be handed to the component that decides how to render
it, and every caller must invent a placeholder — of which `0` is the cheapest.* Not "this number is
wrong" (unmeasurable — the producer's field name is a different leaf), not "the guard is missing on
tile 2 of 4" (a relation between siblings — refused below), but the one thing in this leaf that is a
correctness bug at any scale, is visible in a single declaration, and is **upstream of every other
deviation here**.

**Where it executes.** `npm run census:check` is inside **`npm run check`** *and* is the
**`golden-path-census` pre-push job** in `lefthook.yml`. That matters: per the §9 calibration,
`ci.yml` is red on 10 pre-existing failures, so a gate that only runs in CI runs nowhere. This one
runs on the developer's machine before the branch leaves it. `custom/*` ESLint rules are warn-level
and, per [doctrine §3](../golden-path-doctrine.md), **enforce nothing at either gate at any count** —
no argument from warning volume is made here.

**Existing rules checked for overlap before proposing this one — file overlap re-measured by running
each neighbour's own pattern with the engine's semantics and intersecting its file set with my 48:**

| neighbour rule | its files | overlap with my 48 | why it is a different condition |
|---|---:|---:|---|
| `absent-entity-count-as-zero` ([`aggregate-count-display`](./aggregate-count-display.md)) | 30 | **1 (2%)** | The nearest neighbour semantically. It needs a **keyed lookup** (`counts[id] ?? 0`); mine is a **type declaration** with no expression at all. Its condition is *"the entity was not in the map"*; mine is *"the component was never given a way to say so."* |
| `read-failure-as-empty-value` | 32 | **0 (0%)** | Requires a `.catch(`. Mine are `interface` bodies. |
| `estimate-typed-as-measurement` | 13 | **0 (0%)** | Closest in spirit — a derived value typed as a recorded one. Zero file overlap; it walks value *provenance*, mine walks value *nullability*. |
| `inline-verdict-band` | 38 | **6 (13%)** | Largest meaningful overlap. It counts a threshold ladder written inline; several tile files do both because a tile that colours by value needs a band. Different declaration, different fix. |
| `locale-blind-percent` | 57 | **5 (10%)** | Rendering a `%` glyph. |
| `hand-assembled-currency` | 39 | **4 (8%)** | `$` + a number. Both are the *formatting* half of §7 D4 and neither sees the type. |
| `sample-derived-plot-scale` | 7 | **1 (2%)** | `KpiTile.tsx` — the sparkline. **Already gated; §8 Gap 4 defers to it rather than re-proposing.** |
| `unknown-money-as-zero` | 21 | **1 (2%)** | Money nouns only, mostly Rust. |
| `local-empty-state` · `frozen-ui-copy-constant` · `untranslatable-token-label` · `stateless-disclosure-control` · `ordinal-denominator-in-bar-list` | 40 / 89 / 38 / 56 / 4 | **2 / 2 / 1 / 0 / 0** | — |
| `typo-token-overpainted` · `native-title-tooltip` | 824 / 571 | 23 (48%) / 15 (31%) | Repo-wide styling rules over 17 % and 12 % of all `.tsx`. A 48 % file overlap here is co-occurrence, not condition overlap — my 48 files are 1 % of the tree and they are all UI. |

Largest **meaningful** overlap **13 %**, far under the 83 % that correctly got a previous gate
declined.

**Two independent implementations, entered from opposite ends, and they disagreed twice.**
Implementation #2 is a **brace-walking scanner**: it starts from every `value` **field** in a type
position, walks **left** through balanced braces to the enclosing `{`, and asks whether a
`label: string` sibling exists anywhere in that group; then it walks **right** for `onChange`. It
shares no regex, no direction and no comment handling with the census pattern.

- **Round 1: 55 (walker) vs 50 (census).** The census pattern required `label: string;` and `value:`
  to be *textually adjacent* — but the engine's `ignoreCommentLines` only skips a match whose **start
  line** is a comment, so a JSDoc **between** the two fields blocked the match entirely. **5 sites in
  4 files were invisible, and one of them is `overview/components/shared/KpiTile.tsx` — this leaf's
  own designated primitive**, whose `value?: string` sits directly under
  `/** Static value when no animation is wanted. */`. A rule that cannot see the app's own tile
  primitive is not a rule about tiles. The gap between the fields was widened from `\s*` to
  `[^;={}()]{0,300}?`, which tolerates a doc comment and still stops at the next field's `;`.
- **Round 2: 56 (walker) vs 55 (census).** Now the walker was wrong. `src/stores/themeStore.ts:31` is
  `interface BrightnessDef { id; label: string; description: string; value: number }` — a
  **brightness setting**, not a readout. The walker's brace-group rule accepts a `label: string`
  anywhere in the group; the census pattern's adjacency requirement correctly rejects it. A known,
  named recall/precision trade kept on the record rather than patched.

**Final: 55 matches / 48 files, reconciled on 55 shared sites with one named disagreement in each
direction.** Neither error was visible with one implementation: the first reads as a clean rule that
misses the headline primitive, the second as a complete count with a setting in it.

**Precision, hand-verified 55/55 against the stated condition: 52/55 = 94.5 %.** The three
disagreements are `triageTypes.ts:150` (`TriageReasonOption` — a picker option), `triggerConstants.ts:172`
(rate-limit **window options**), and `CapabilityChip.tsx:5` (which *can* express absence, via
`value?: string` + a `placeholder` prop). Against the stricter question *"is this specifically a
**numeric metric** tile"* the count is **45/55 = 82 %**; the 7-site difference is labelled-fact
records (`IncidentFact`, `DecisionFact`, `ActionFact`, `IslandStat`, `DimImpact`, …) whose value is
often a word rather than a number. **They are deliberately kept**: the failure mode is identical —
`ConfirmDestructiveModal.tsx:18`'s `details?: { label: string; value: string }[]` is the fact list in a
destructive confirmation, which is exactly where
[`aggregate-count-display` §0](./aggregate-count-display.md) measured a 65× lie.

**The positive control partitions the anchor exactly, and its number is the finding.** Pointed at the
**compliant** form over the same roots and extensions — the same `label: string; value …` anchor,
typed nullable — it returns **6 matches in 6 files**. The raw anchor is **81** declarations and it
partitions with no residue:

```
81 = 55 non-nullable, non-interactive   (the violation)
   +  8 non-nullable but interactive     (a form control — value: string is correct)
   +  6 NULLABLE                         (the control)
   +  7 ReactNode                        (can carry absence; 0 of 13 StatCard sites do)
   +  5 other (a generic T, an enum, unknown)
```

So the population is **55 tile contracts that cannot say "unmeasured" : 6 that can**, and the two must
move in opposite directions as the codebase improves. If `unmeasurable-metric-tile` falls and the
control does **not** rise, a tile was deleted rather than fixed. The control is also a **liveness
probe** for the anchor: if the `label: string` convention were renamed away, it drops to zero and the
run fails structurally rather than quietly reporting a healthy ratchet.

**Fail-loud properties — not asserted, executed against the working tree with exit codes captured
(never through a pipe):**

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified, baseline 48/55) | **0** | `census OK — 2 rule(s), 9658 file-visits, 61 surviving violation(s) across 54 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose 40 -> 48 (+8). New violations of …metric-tile.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 48 (-51) without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 3000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 3000` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "src/GONE.tsx" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL given a baseline** | **1** | `a positive control must NOT carry a baseline — it exists to fail` |
| **POSITIVE CONTROL loses its population** | **1** | `[structural] matched zero files anywhere` |
| **control pattern swapped in as the violating rule** (partition check) | **1** | `[drift] files dropped 48 -> 6 (-42) without the baseline moving` |

**Validated standalone** against the real engine in a private scratch registry
(`node scripts/census/run-census.mjs --rules <scratch>/rules-metric-tile-mt9x.json --check`), never
against the shared `rules.json`; **the full registry was not run** (doctrine §4). Re-extracted from
this finished document and re-run: **identical — 55/48 and 6/6 over 9,658 file-visits, 3.1 s wall.**

**Portability — the signal was tested against the four sibling repos, and unlike the four §9 signals
the [contract](../golden-path-contract.md) reports, it did not score zero.** Run read-only, verbatim,
with the engine's comment semantics:

| repo | `.ts`/`.tsx` | violating rule | positive control |
|---|---:|---:|---:|
| `personas-web` | 1,054 | **11** | 0 |
| `brainiac` | 411 | **5** (3 of them generated `api-schema.d.ts` — see caveat) | 0 |
| `personas-cloud` | 32 | 0 | 0 | 
| `vibeman` | 1,999 | **13** | 0 |
| `ascent` | 892 | **15** | **1** |

**And it landed on the right files.** Without any coordination, the convergence sweep (§6) had
already named the cohort's worst tile contract, its dead shared primitive, its most-adopted primitive,
and its best nullable implementation. The signal found all four:

- `personas-web/src/components/dashboard/MetricCard.tsx:25` — clause 4's worst case, `value: string`
  coerced `?? 0` at every call site.
- `vibeman/src/components/ui/wizard/StatCard.tsx:7` — clause 1b's shared primitive with **zero**
  render sites.
- `ascent/src/components/org/shared/ui.tsx:66` — clause 1b's 54-site `Tile`.
- and **the sole control hit in the entire cohort is
  `ascent/src/components/org/live/LiveWarRoomStat.tsx:92`** — clause 4's best answer,
  `value: number | null` rendered as `—` with the colour switched off.

**Caveats, stated rather than smoothed:** sibling precision was **not** hand-verified at the site
level. `brainiac`'s three `console/src/lib/api-schema.d.ts` hits are **generated OpenAPI types**, a
false-positive family this repo does not have (an adopting repo should `exclude` its generated `.d.ts`
with a reason), and `ascent/src/app/api/badge/[owner]/[repo]/route.ts:136` is an API route, not a
tile. Treat the sibling counts as *the signal fires where the condition is*, not as a validated
precision.

**How it could still fail.** The signal keys on **the TypeScript inline props-object idiom**: a
`label: string` field textually near a `value` field in a type position. It ported across four
independently-authored React/TypeScript codebases because they share that idiom — **not because the
proxy is stack-free.** A repo spelling the same defect as a `PropTypes` shape, a Vue `defineProps`, a
Svelte `export let value: number`, a Python dataclass, a Rust `struct Tile { value: f64 }`, or a
positional parameter list `function Stat(label, value)` will match **nothing while the condition is
present at scale**. Re-key on your own idiom, and check the control's population before trusting a
green run — a control of **0**, which is what four of five siblings returned, means either that no
tile in that repo can express absence (the finding) or that the anchor does not exist there (the
instrument is broken), and those two look identical. **The pattern is also blind to the 52 inline
hand-rolled tiles by construction — they declare no props at all** (§8 Gap 6).

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`. The count
may not rise; the existing 55 are a backlog. The reason it is a ratchet rather than an alarm is that
every one of the 55 is locally reasonable — `value: string` is a perfectly sensible type for a tile
you are writing on a screen where the data is present — and the defect is legible only as a
population, and only in the moment the data is not.

```json
{
  "id": "unmeasurable-metric-tile",
  "goldenPath": "docs/concepts/golden-paths/metric-tile.md",
  "title": "A labelled scalar readout (a metric tile) declares its value as a bare string/number, so \"we have not measured this\" cannot be handed to the component that decides how to render it, and every caller must invent a placeholder — of which 0 is the cheapest",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\blabel\\s*:\\s*string[^;]{0,40};[^;={}()]{0,300}?value\\s*\\??\\s*:\\s*(?:string|number)(?:\\s*\\|\\s*(?:string|number))?\\s*[;,}](?![\\s\\S]{0,260}?onChange)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A component/record contract that pairs a `label: string` with a NON-NULLABLE `value: string | number`. PROXY FOR the stack-free condition: a metric tile cannot represent an UNMEASURED quantity, so absence must be destroyed at the call site (as a 0, a \"0\", or an empty string) before the component that decides how to render it is ever reached — and a reader cannot tell a measured zero from a value nobody ever recorded. THE `[^;={}()]{0,300}?` GAP IS LOAD-BEARING and was `\\s*` in the first draft: the census engine's ignoreCommentLines only skips a match whose START line is a comment, so a JSDoc sitting BETWEEN the two fields blocked the match entirely and hid 5 sites in 4 files — including src/features/overview/components/shared/KpiTile.tsx, this app's own designated tile primitive, whose `value?: string` sits directly under `/** Static value when no animation is wanted. */`. A rule that cannot see the tile primitive is not a rule about tiles. The negative lookahead `(?![\\s\\S]{0,260}?onChange)` is also load-bearing: it removes 8 FORM CONTROLS (TextField, RangeField, NumField, ModelDropdown, ColumnDropdownFilter, FieldCaptureRow, PersonaOverviewFilterHeader), where `value: string` is the correct type because the value is being EDITED, not READ. WHAT THE MATCH COSTS, executed rather than reasoned, against a read-only copy of the operator's live 347MB personas.db (2,188 executions / 2,942 traces / 90,813 spans): nine tile POSITIONS across five surfaces are wired to fields the producer never writes, and render >=7,318 fabricated zeros — inspectorShared.tsx:40-41 renders \"0\" for Input and Output tokens on 2,188 of 2,188 executions (4,376 renders) while 585 of those same rows carry cache_read_tokens/cache_creation_tokens > 0, positive proof that tokens moved; TraceSummary.tsx:63 renders \"0\" on 2,942 of 2,942 traces while the COST tile twelve lines above it at :52 has a `> 0` guard and honestly renders \"-\" 115 times. The same asymmetry, independently, in SLADashboard.tsx: the Success-rate tile renders an em dash on an empty window (with a seven-line comment explaining that a red 0% \"falsely screams total failure when the truth is no data\") while the Avg-latency tile beside it renders \"0ms\" at 7/14/30-day windows INCLUDING THE DEFAULT. PRECISION 52/55 = 94.5% hand-verified against the stated condition (three misses: triageTypes.ts:150 and triggerConstants.ts:172 are picker OPTIONS, CapabilityChip.tsx:5 expresses absence via a `placeholder` prop); 45/55 = 82% against the stricter 'is this specifically a NUMERIC metric tile'. The 7-site difference is labelled-fact records (IncidentFact, DecisionFact, ActionFact, IslandStat, DimImpact) and they are KEPT ON PURPOSE, because ConfirmDestructiveModal.tsx:18's `details?: { label: string; value: string }[]` is the fact list inside a DESTRUCTIVE CONFIRMATION — exactly where aggregate-count-display measured a 65x lie. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 55 SHARED SITES WITH ONE NAMED DISAGREEMENT IN EACH DIRECTION: this regex (55 in 48 files) and a brace-walking scanner that starts from every `value` FIELD, walks LEFT to the enclosing brace and asks whether a `label: string` sibling exists in that group (56 in 49). Round 1 the walker won by 5 (the JSDoc gap, above); round 2 the regex won by 1 — src/stores/themeStore.ts:31 `interface BrightnessDef { id; label: string; description: string; value: number }`, a brightness SETTING, which the walker accepts because its brace-group rule does not require adjacency. That miss is kept rather than patched so the disagreement stays on the record. LEGAL FIX: type the value `number | null` (or `string | null`) and give the primitive a render arm for null — an em dash or a dimmed placeholder, NEVER an absent tile and NEVER 0. Both edits or neither: KpiTile.tsx:164 currently does `<Numeric>{value ?? ''}</Numeric>`, so an absent value already renders as an EMPTY STRING. Do NOT silence a match by moving the coercion into the hook — useObservabilityData.ts:98's `: '0'` is the same lie one file further from the tile author. CONVERGENT AS A CONDITION, NOT AS A PROXY: two FULLY INDEPENDENT sibling repos solved this and wrote the reasoning down — brainiac/console/src/observatory/observatory-data.ts:18-20 ('null = nothing was asked. Deliberately distinct from 0 (everything missed)') with its render arm at Observatory.tsx:476, and ascent/src/components/org/live/LiveWarRoomStat.tsx:93,104 (`value: number | null` -> '—', and :117 switches the COLOR off so an unmeasured tile cannot wear a score colour). The counter-example is personas-web/src/components/dashboard/MetricCard.tsx:25, which types `value: string` and coerces `?? 0` at 100% of its call sites. PORTABILITY, MEASURED rather than assumed — the pattern was run verbatim and read-only over all four sibling UI checkouts and, unlike the four §9 signals the golden-path contract reports as scoring zero true positives in a sibling, IT FIRES IN ALL FOUR: personas-web 11, brainiac 5, vibeman 13, ascent 15, personas-cloud 0 (structurally absent, 0 .tsx). It also lands on the exact files an independent convergence sweep had already named — MetricCard.tsx:25 (the cohort's worst contract), vibeman/src/components/ui/wizard/StatCard.tsx:7 (a shared primitive with ZERO render sites), ascent/src/components/org/shared/ui.tsx:66 (the cohort's most-adopted tile at 54 sites) — and the positive control's ONLY hit in the entire cohort is ascent/src/components/org/live/LiveWarRoomStat.tsx:92, which is the sweep's independently-chosen best nullable-tile implementation. CAVEAT, not smoothed: sibling precision was NOT hand-verified per site; brainiac's three console/src/lib/api-schema.d.ts hits are GENERATED OpenAPI types (an adopting repo should exclude its generated .d.ts with a reason) and ascent's app/api/badge/.../route.ts:136 is an API route. PRECONDITION (must be re-derived per repo): the pattern ported across four independently-authored React/TypeScript codebases because they share the inline props-object idiom, NOT because the proxy is stack-free. A repo using PropTypes, Vue defineProps, Svelte `export let`, a Python dataclass, a Rust struct, or positional parameters `function Stat(label, value)` scores zero while the condition is present at scale — and a CONTROL of zero, which four of five siblings returned, is ambiguous between 'no tile here can express absence' (the finding) and 'the anchor does not exist here' (the instrument is broken). BLIND BY CONSTRUCTION to the other three-quarters of this leaf: 52 inline hand-rolled tiles that declare no props at all, 61 call sites that stringify the value before passing it, 10 that default it with `?? 0`, 10 of 11 deltas that name no baseline, and the per-grid guard asymmetry that is this path's headline — a green run on this rule is NOT coverage of metric-tile.md."
  },
  "exclude": [],
  "baseline": { "files": 48, "matches": 55 },
  "floor": 3000
}
```

```json
{
  "id": "nullable-metric-tile-positive-control",
  "goldenPath": "docs/concepts/golden-paths/metric-tile.md",
  "title": "POSITIVE CONTROL — a labelled scalar readout whose value type ADMITS null, so the tile itself owns what \"not measured\" looks like instead of making every caller invent it",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\blabel\\s*:\\s*string[^;]{0,40};[^;={}()]{0,300}?value\\s*\\??\\s*:\\s*[^;{}]{0,60}(?:\\bnull\\b|\\bundefined\\b)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. It is the COMPLIANT half of the SAME anchor the sibling rule catches wrong, so the two PARTITION rather than merely correlate. The raw anchor `label: string; value ...:` is 81 declarations across src/, and it decomposes with no residue: 55 non-nullable and non-interactive (the violation), 8 non-nullable but interactive (a form control, where `value: string` is CORRECT and which the sibling rule's onChange lookahead removes), 6 NULLABLE (this control), 7 ReactNode (which CAN carry absence but does not require it — shared/components/display/StatCard.tsx:21 is here, and 0 of its 13 render sites pass a nullable value), and 5 other (a generic T, an enum, unknown). THE NUMBER IS ITSELF THE FINDING: 6 of 81 labelled-value contracts in a 4,829-file application can say 'we did not measure this', and NEITHER of the two designated tile primitives is among them. The two counts must move in OPPOSITE directions as the codebase improves — if unmeasurable-metric-tile falls while this stays flat, a tile was DELETED rather than fixed, and the ratchet would otherwise have recorded that as progress. It is also a LIVENESS PROBE for the anchor itself: the violating rule and this control are the two halves of one question, so if the `label: string` props convention were renamed away this drops to zero and the run fails structurally instead of quietly reporting a healthy ratchet. Test files are included deliberately — a nullable tile contract exercised by a test is still a nullable contract. NOTE the two strongest members are both in one feature (overview/sub_certification/{DimensionBars.tsx:12, JudgePanel.tsx:9}, `value: number | null`), which is the shape of a convention that one author established and nobody adopted; when a new tile is typed nullable per this path's step 4, this control rises and that is the win being measured."
  },
  "exclude": [],
  "floor": 3000
}
```

**Three conditions in this leaf I am refusing to gate, with the measurement that justifies each
refusal:**

1. **The per-grid guard asymmetry — §0's headline — is not gateable.** It is a *relation* between two
   JSX siblings: one `value` expression carrying a ternary whose false arm is a dash, and another,
   twelve lines away, carrying none. I built the narrowest form I could — a tile grid containing at
   least one `'—'`/`'-'`/`'N/A'` arm and at least one bare numeric sibling within the same JSX
   element — and it cannot be written as one whole-file regex without a brace-matched grid extractor,
   which the census engine does not have. Per the corpus's own standard, a signal I cannot express is
   a finding, not a gate. **The instrument that reaches it is §2 (c): one `hasActivity` predicate per
   grid, which makes the asymmetry a missing variable rather than a missing character.**
2. **"The value is stringified at the call site" — 61 sites, and I could not separate the honest ones.**
   I built it and ran it: `value={` + a template literal, `String(`, `.toFixed(`, or
   `.toLocaleString(` returns **53 matches / 28 files** (or 32/18 for the non-template half). But the
   population includes `formatDuration(...)` and `formatCost(...)`, which **do** return an em dash for
   `null` — so the same syntax is the defect and the fix depending on which function it names, and a
   name allowlist is exactly the vocabulary trap the doctrine warns about (it would have to enumerate
   seven cost formatters, five of which are correct). Hand-verification put precision at roughly
   **60 %**. `hand-assembled-currency` (39 files) and `locale-blind-percent` (57) already ratchet the
   two sub-families where the syntax alone *is* decisive.
3. **"A delta with no baseline" — the population is 11 and the compliant half is 1.** A rule with a
   ten-site backlog and a single-site control cannot distinguish a real fix from a deleted tile, and
   the control would be one grep away from structural failure. The durable instrument is §4 T2's type
   — put the label on the window object, per `ascent/src/lib/window.ts:54` — after which a missing
   baseline is a missing field rather than a missing habit. Recorded in §8 Gap 3 rather than pretended
   into a signal.

---

## 12. Corrections to the brief

1. **`sides: "client"` is contradicted by this leaf's own measurement, making it 5 of 5 leaves that
   have checked.** A client-only reading would have missed everything that makes §0 true: the zero
   the SLA success-rate tile guards against is a Rust `else { 0.0 }` (`sla.rs:508-511`); the zero the
   avg-latency tile does *not* guard against is the neighbouring `else { 0.0 }` in the same function;
   the window that makes the whole Activity dashboard render "no data" at its default is
   `WHERE e.created_at >= datetime('now', ?1)` at `metrics.rs:1193`; the 22-row gap between the
   executions tile (2,166) and the Activity badge (2,188) is `AND e.status IN ('completed','failed')`
   at `metrics.rs:1194`; and the token columns that make nine tile positions structurally false are
   `NOT NULL DEFAULT 0` in the schema. **Recommend flipping `sides` to `both`.** Per the doctrine this
   field is now anti-correlated with where the answer lives at **5 of 5**.

2. **"Every run in the app's history records $0 and 0 tokens" — the `$0` half is false, and it matters.**
   Replayed: `SUM(cost_usd)` over `persona_executions` is **$2,036.2570954**, positive on **1,970 of
   2,188 rows**; the 2,942 trace root spans carry the same money (identical to the cent on all 2,062
   paired runs). **Only `input_tokens` and `output_tokens` are zero** — 0/2,188 and 0/2,942 — while
   `cache_read_tokens` holds **648,406,049** and `cache_creation_tokens` **26,029,682**. This changes
   which tiles are lying: **the cost tiles are honest and the token tiles are not**, and the sharpest
   artifact in the leaf (`TraceSummary`'s guarded Cost beside its unguarded Tokens, §0) is only
   visible once you know that. Had I taken the brief at face value I would have reported both halves
   of that grid as broken and missed the asymmetry entirely. The `CostBreakdownBar` half of the claim
   is **confirmed** (0/2,942), and `parser.rs:340-341` remains the cause —
   [`execution-trace-instrumentation`](./execution-trace-instrumentation.md) measured it correctly and
   is credited, not restated.

3. **"`tab-strip` found the primitive-adoption denominator swings a headline by 6×" — reproduced here
   at 6.1×, and the mechanism is different.** In `tab-strip` the swing came from *what counts as a tab
   strip*. Here the population is unambiguous and the swing comes from **what counts as the
   primitive**: 22.7 % if you count both designated tile components against card-shaped tile sites,
   **3.7 %** if you count only the one component in `shared/components/` against every labelled number
   on a card. Both are honest; the second is the one a reader assumes when they hear "we have a shared
   StatCard". My four extractions also disagreed on the *inventory* itself — 772 sites (definition-
   anchored) vs 299 (render-site-anchored) — because the first counts every render of a component that
   *declares* label+value props, including sites that pass neither. **The reconciling fact is that 45
   component NAMES resolve to 68 DEFINITIONS**, so any tile census keyed on a name silently merges
   twelve different components called `Stat`.

4. **"`display/Numeric` and `display/RelativeTime` are the catalogued primitives; `.toFixed()` /
   `.toLocaleString()` hand-rolls are the known drift" — true, and it is not this leaf's defect,
   confirming the neighbour's §12.3 from the tile side.** `Numeric` already renders `null` as an em
   dash and, since 2026-08-14, binds its own locale. It appears in **10 of 299** tile value props.
   The absence is destroyed *upstream of it*, by the tile's own prop type, before `Numeric` is ever
   reached — which is why §9 gates the type declaration and not the call site. `RelativeTime` did not
   arise: **0 of the 299 tile values is a timestamp.**

5. **"A tile showing a derived number as if it were recorded is `audit-trail-view`'s hazard in a
   different costume — check for it." — checked, and the answer is the inverse of what the brief
   expected.** I looked for derived-presented-as-recorded and found the app is careful about it: the
   trace inspector's own comment at `TraceSummary.tsx:87-90` says the cost decomposition is
   *"apportioned from the SAME total shown in the Cost tile above, never recomputed"*;
   `comparisonHelpers.ts:101` declines a token comparison it cannot trust; `computeTrends.ts:22-47`
   refuses to derive a delta from a single window and names the tile that used to lie.
   **The live hazard is the mirror image: a recorded number presented as if it had been measured.**
   `input_tokens = 0` is not derived — it is *stored*, in a `NOT NULL DEFAULT 0` column, by a parser
   reading a field name that does not exist. It is maximally authoritative and completely false, and
   no provenance affordance in the app would flag it, because its provenance is impeccable.

6. **The brief asked "what each tile does with `null` versus `0`"; the sharper answer is that 68 of 74
   tile contracts never get to make that choice.** Only **6 of 81** labelled-value declarations admit
   `null` at all, and **2 of those 6** are the same author's work in one feature
   (`sub_certification/{DimensionBars,JudgePanel}`). The question is not what call sites do with null —
   it is that the type forbids them from having one. That reframing is what produced §9's rule; a
   call-site survey would have produced a rule with 60 % precision (refusal 2).

7. **"Whether a delta has a stated baseline" — measured at 1 of 11, and the number of delta sites is
   itself the surprise.** For the second-most recurrent leaf in the spine, in a dashboard-heavy
   application, **11 tile deltas exist in 7 files, and 4 of them are hardwired to `null` on purpose.**
   The app is not fabricating deltas; it is *not showing* them, deliberately, with a `TODO`. The
   defect is not a lying delta — it is that `KpiTrend` has no slot for a baseline, so the four sites
   that will eventually be un-hardwired are already structurally incapable of naming one (§8 Gap 3).

8. **A methodological correction to my own first pass, in the doctrine's own terms.** My first census
   pattern and my first verifier agreed at neither end — but the *reason* my census pattern was wrong
   is worth recording: it required `label` and `value` to be textually adjacent, and the census
   engine's `ignoreCommentLines` only skips matches that *start* on a comment line, so a JSDoc
   between the two fields was an opaque wall. That combination hid **this leaf's own primitive,
   `KpiTile.tsx`**. **A comment-handling policy is part of a pattern's semantics, not a hygiene
   detail** — and the failure mode it produces is precisely the one the corpus fears most: a green
   rule that cannot see the thing it was written about.

9. **A correction to a claim I had already written into this document, caught by running it instead of
   reasoning about it.** I wrote in §9 that `personas-web/MetricCard.tsx` — the cohort's worst tile
   contract — *"would not match this pattern"*, and used that as the humility caveat about
   portability. I had not opened the file. It matches: `label: string;` and `value: string;` are
   **adjacent lines** in its props type. Running the pattern over all four siblings then produced the
   opposite of the expected result — **11 / 5 / 13 / 15 hits, in a corpus where every previously
   tested §9 signal scored zero** — and the positive control's single cohort-wide hit turned out to be
   the same file an independent sweep had chosen as the best answer to the same problem. **A caveat
   invented from imagination is as unreliable as a finding invented from imagination**, and this one
   would have understated the rule and hidden its best evidence. It is the same failure the doctrine
   records for vocabulary lists written before reading the tree — the guess distorted the humility
   rather than the claim, which made it feel safe.
