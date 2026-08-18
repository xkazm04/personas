---
layer: golden-path
subject: data-viz
status: forged
techniques:
  - metric-identity
  - scale-and-axis-design
  - chart-loading-economics
  - micro-visualizations
  - encoding-vocabulary
  - empty-and-degraded-chart-states
evidence:
  - src/features/overview/sub_usage/components/MetricChart.tsx     # canonical chart panel: required height reserves the box, per-chart error boundary, lazy engine
  - src/features/shared/charts/RechartsWrapper.tsx                 # the single deferred chart-engine chunk for the whole app (render-prop, one shared import)
  - src/features/overview/sub_usage/components/LazyChart.tsx       # viewport-deferred mounting: one-shot observer, geometry-matched skeleton, reaper on unmount
  - src/features/overview/libs/metricIdentity.ts                   # registered metric-identity variants (id names surface+window+source) over one shared resolver
  - src/features/overview/libs/computeTrends.ts                    # one derivation source; returns null rather than fabricate a trend; avg-metric zero-baseline treated as no-sample
  - src/features/overview/sub_director/directorScore.ts            # the declared-domain sparkline exemplar: fixed scale, its docstring states the doctrine
  - src/features/teams/sub_kpis/kpiMath.ts                         # cross-language metric identity: declared mirror of the engine-side derivation
  - src-tauri/src/engine/kpi_derivation.rs                         # the other half of that mirror (comment-coupled, no shared-fixture gate — see report)
  - src/features/shared/glyph/types.ts                             # a fixed dimension vocabulary as an encoding language shared across surfaces
counter_evidence:
  - src/features/overview/components/shared/KpiTile.tsx            # sample-anchored sparkline floor (min-max autoscale) at the highest-reach call count — the scale defect the standard exists to prevent
  - src/features/shared/components/display/ChartEmptyState.tsx     # a chart empty-state primitive with zero render call sites and hardcoded hex art — vocabulary drift plus an unreachable door
deviations:
  - w3-data-viz   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Charts & data visualization

A chart is the surface you reach for when the user's question is about the
**shape of the whole**: trend, distribution, composition, correlation, rate of
change. A chart earns its pixels by pre-attentive perception — the eye reads a
slope, an outlier, or a divergence in milliseconds, before conscious attention
arrives — which is the one thing a grid of numbers cannot do. The boundary with
its sibling surface is bright and already drawn from the other side: a
[table](../table/table.md) answers *"which one"*, a chart answers *"what
pattern"*. When a user hovers a chart trying to read exact values point by
point, the chart is a table trying to escape; when a user scans a numeric
column squinting for the trend, the table owes them a chart — or at least a
sparkline.

That definition also decides what a chart is *not*:

- **A single number with a label** when the question is "what is the value
  now". A gauge drawn around one number is decoration; a tile with the number,
  its unit, and its recent direction answers faster and costs less.
- **A table** when individual records and their identities matter. Charts
  deliberately dissolve identity into aggregate shape; if the user's next
  action is "click the third one", they needed rows.
- **A micro-visualization** when the pattern question is asked *inside* a
  dense comparison surface — a trend cell in a row, a completion ring on a
  card. Full chart chrome (axes, legend, gridlines) at cell size is noise; the
  [micro-visualizations](techniques/micro-visualizations.md) technique covers
  the stripped-down form.

Within the family of drawn marks, one structural question separates the forms
that inherit this subject's hardest obligations from those that do not:
**does decoding the mark require a scale the mark itself does not carry?** A
line's vertical position is meaningless without an externally chosen domain —
so someone must choose that domain, and the choice can lie; everything in the
scale technique follows. A proportional bar that prints its value beside
itself, or a ring that sweeps a fraction of a whole, carries its own scale in
its geometry — no domain to choose, so the obligations shift to naming the
denominator instead. A sparkline is the *strongest* form of the condition,
not an exemption: it has no visible axis, which makes its scale invisible
rather than absent.

Charts in a **product** differ from charts in a notebook or a report in one
structural way: they are rendered thousands of times, unattended, over data
nobody previewed. A notebook chart is inspected by its author before anyone
else sees it; a product chart must be *correct by construction* over every
dataset the query can return — empty, single-point, all-zero, one enormous
outlier, a gap in the middle. Every rule below exists because some dataset
eventually arrives that makes the naive rendering lie.

## Every number on screen has one identity

The most expensive chart defect is not visual — it is two surfaces disagreeing
about the same named number. A metric that appears in a chart, a summary tile,
a table column, and an export must mean *exactly* the same thing in all four:
same derivation, same window, same filters, same unit. Two independent
implementations of "error rate" are not redundancy; they are a race that ends
with a support ticket titled "why do these two pages disagree", and by then
nobody can say which one is right.

So a named metric is a **contract, defined once**: its derivation lives in one
place, every surface that shows it derives from that one place, and when two
runtimes must both compute it (a backend aggregating, a frontend previewing),
the duplication is acknowledged and **gated by parity tests over shared
fixtures** — never left to convergent good intentions. The full treatment is
the [metric-identity](techniques/metric-identity.md) technique; it is listed
first because everything else in this subject decorates numbers that this
technique keeps true.

## The honesty rules

A chart makes claims with geometry, and geometry can lie while every underlying
number is correct. The rules:

1. **Magnitude encodings start at zero.** Bars and areas encode value as
   *length*; a bar axis starting above zero makes a 5% difference look like a
   3× difference. Position encodings (lines, points) may truncate the axis to
   show detail — but a truncated axis is **disclosed**, visibly, not buried in
   tick labels the eye skips.
2. **Unmeasured is not zero.** A period with no data points is a *gap* in the
   line, not a plunge to the floor. Plotting missing as zero fabricates a
   crash that never happened; silently interpolating across the gap fabricates
   a continuity that was never observed. Both are lies with the same shape as
   truth.
3. **Aggregation is part of the claim.** A "daily" series where the last
   bucket is today-so-far shows a fake cliff at the right edge on every
   render. Partial buckets are marked, dropped, or completed — never plotted
   as if final. Smoothing, if applied, is disclosed and the raw series remains
   reachable.
4. **A number that travels carries its predicate.** The axis label, the
   tooltip, and the legend say what was counted, over what window, in what
   unit. "1,240" floating in space will be read as whatever the reader hoped
   it was.
5. **The pixel says how the number was made.** Data that is not a real
   measurement — simulated, demo, projected, extrapolated — is visibly marked
   as such (a distinct stroke, an explicit suffix), every time it is drawn.
   When a pipeline merges sources with different completeness or vintage,
   *which source answered* is part of the value: a wire format that cannot
   carry provenance forces every downstream surface to present two different
   populations as one number. And a value's age is disclosed when it matters —
   a chart of mixed vintages with no "as of" invites the reader to assume
   "now".

These rules are load-bearing precisely because a chart is *trusted more* than
a paragraph — the visual form reads as measurement, not assertion. The worst
observed failures of this family are not ugly charts; they are two clean,
professional surfaces a few lines apart showing the same metric name over
different populations, with nothing on screen admitting the difference.

## Scales are a deliberate choice, not a library default

Every chart picks between two scale policies, and the pick is a design
decision with a correct answer per situation — never an unexamined default:

- **Fixed (shared) scales** when charts will be *compared with each other*:
  small multiples, sparklines down a column, the same metric across entities
  or time ranges. Comparability is the whole point of placing them together;
  auto-scaled siblings render noise at the same amplitude as signal and make
  the flattest series look as dramatic as the steepest.
- **Auto (data-fit) scales** when one chart is examined *alone* for internal
  detail, and the reader's question is about shape within the series rather
  than magnitude against siblings.

The governing rule underneath both policies: **declare the domain; never let
the data choose its own floor.** Even an auto-scale is a declared policy
(zero-anchored, ceiling following the data); a scale whose *floor* is the
sample's own minimum renders sub-noise variation at full amplitude, makes two
adjacent panels incomparable, and always looks plausible — which is why review
never catches it. The failure mode is always the same: the library or a
hand-rolled projection auto-scales by default, nobody decides, and the product
ships incomparable charts sitting side by side in a comparison layout. The
decision procedure, tick design, and time bucketing live in
[scale-and-axis-design](techniques/scale-and-axis-design.md).

## The chart library is a heavy dependency

Rendering engines for charts are among the largest dependencies a product
front-end carries, and charts are almost never on the critical path of the
first paint. The consequences are structural:

- The chart engine **loads lazily**, and only for users who reach a surface
  that draws.
- The space a chart will occupy is **reserved before the engine arrives** — a
  placeholder matching the final geometry, so neither code arrival nor data
  arrival moves the layout.
- Each chart sits behind its **own failure boundary**: a rendering exception
  in one chart degrades that chart to an error state and takes nothing else
  with it. A dashboard is a fleet of independent instruments, not one organism
  with a shared heart.

This is the [async-ui-states](../async-ui-states/async-ui-states.md) doctrine
specialized to a surface whose *implementation* is as asynchronous as its
data; the economics — deferral, visibility-triggered mounting, skeleton
geometry, failure isolation — are the
[chart-loading-economics](techniques/chart-loading-economics.md) technique.

## One visual vocabulary, system-wide

A product's charts are read as a *system*, and the system property is learned
once: what a tooltip looks like, what the axis type is, what red means. Every
chart that invents its own idiom taxes the reader with relearning and quietly
suggests the data comes from somewhere less trustworthy.

- **One palette, bound to meaning.** Colors come from the product's design
  tokens, not from the chart library's defaults. Status hues mean in charts
  exactly what they mean in badges and toasts — a green line and a green badge
  make the same claim.
- **Stable series identity.** The same entity keeps the same color across
  renders, re-sorts, refreshes, and across *different charts on the same
  page*. Color assigned by series index reshuffles meaning every time the
  data reorders.
- **One tooltip idiom, one legend idiom, one number format** — shared with the
  rest of the product, so the value in the tooltip matches the value in the
  adjacent table cell to the digit.

The vocabulary — categorical vs sequential vs diverging palettes, redundant
encoding for color-blind readers, formatter sharing — is
[encoding-vocabulary](techniques/encoding-vocabulary.md).

## Never draw an axis around nothing

A chart's empty and failure states are more dangerous than a table's, because
chart chrome *asserts measurement*. Axes and gridlines rendered around an
empty plot area read as "measured: flat zero" — the surface fabricates a
finding by showing its frame. So the chart state model specializes the general
async doctrine with one hard rule: **chrome only renders around data.** Before
data, the reserved space shows a placeholder; on settled-empty it shows a
typed empty state (nothing exists yet vs nothing in this window vs not being
measured at all — different facts, different next actions); on failure it says
the system could not answer, which is never the same claim as zero. The
taxonomy is [empty-and-degraded-chart-states](techniques/empty-and-degraded-chart-states.md).

## Accessibility posture

A chart is the least self-describing surface in a product; treat the visual as
one rendering of the data, not the data's only body.

- Every chart carries an **accessible name and a text summary** of what it
  shows — the metric, the window, and the headline shape ("rising", "flat",
  "spike on the 12th"). A silent picture of lines is invisible to a screen
  reader and useless in every pipeline that consumes text.
- **Hue is never the only channel.** Series are distinguishable by more than
  color — direct labeling, ordering, markers, or pattern — and the palette
  holds up under the common color-vision deficiencies.
- **The data is reachable in non-visual form** — a table view, an export, or a
  structured summary — for any chart whose content the user might act on.
- Interactive affordances (tooltips, series toggles) are reachable by
  keyboard, and hover is never the only way to read a value that matters.

## The techniques

- [metric-identity](techniques/metric-identity.md) — one derivation per named
  metric, shared across surfaces and runtimes, with parity gates where
  duplication is forced.
- [scale-and-axis-design](techniques/scale-and-axis-design.md) — fixed vs
  auto scales, zero-baseline discipline, disclosed truncation, tick and time-
  bucket design.
- [chart-loading-economics](techniques/chart-loading-economics.md) — lazy
  engine loading, geometry-reserving placeholders, visibility-triggered
  mounting, per-chart failure boundaries.
- [micro-visualizations](techniques/micro-visualizations.md) — sparklines,
  rings, and arcs inside dense surfaces: chrome stripped, scales fixed, one
  question per glyph.
- [encoding-vocabulary](techniques/encoding-vocabulary.md) — one palette bound
  to meaning, stable series identity, one tooltip and number-format idiom.
- [empty-and-degraded-chart-states](techniques/empty-and-degraded-chart-states.md)
  — no axes around nothing; empty vs unmeasured vs zero vs failed as four
  distinct facts.
