---
layer: technique
subject: data-viz
technique: encoding-vocabulary
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Encoding vocabulary

A product's charts teach the reader a language: what red means, what a dashed
line means, what a tooltip looks like, how numbers are formatted. The language
is learned once and then read unconsciously — *if* it is one language. Every
chart that invents its own dialect forces conscious re-reading and, worse,
lets the same color make different claims on different pages. The vocabulary
is a system property, owned like one.

## One palette, bound to meaning, owned by the design system

- Chart colors come from the **product's design tokens**, not the chart
  engine's defaults. Engine default palettes are the most recognizable
  signature of an unowned chart — and they silently diverge from the
  product's own status colors, so "green" in the chart and "green" in the
  badge become two different greens making the same claim at two credences.
- **Semantic colors are reserved.** The hues the product uses for
  success/warning/danger appear in charts *only* with those meanings. A
  categorical palette that happens to include the danger red will eventually
  color an innocent series as an incident.
- The palette definition is singular:
  [one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary).
  Chart theme, status badges, and toasts all derive from the same tokens, and
  the palette adapts with the product's light/dark theming rather than
  shipping one hardcoded set that works in half the modes.

## Three palette families, three jobs

- **Categorical** — distinct hues for unordered series (entities, categories).
  Effective ceiling is small: beyond roughly six to eight series, hues stop
  being discriminable and the fix is design (top-N plus "other", small
  multiples, direct interaction) — never a twenty-hue palette.
- **Sequential** — one hue ramping in lightness for ordered magnitude
  (heatmaps, density). The ramp is perceptually even, or mid-range
  differences fabricate structure.
- **Diverging** — two hues meeting at a meaningful midpoint (zero, target,
  baseline). Use only when the midpoint *is* meaningful; a diverging ramp on
  data with no natural center invents one.

Choosing among the three is part of the metric's meaning, not styling: share
of total is sequential, delta from target is diverging, per-entity series are
categorical.

## Color answers one question per chart: identity or status, never both

Semantic color introduces a fork every multi-series chart must resolve
explicitly: is color carrying **who this series is** or **how this series is
doing**? Either answer works; blending them does not. Coloring each series by
its *status* (every failing item red) makes all same-status series
indistinguishable — the legend names them but its swatches are identical, so
no legend row maps to any line. Coloring by *identity* means status must ride
another channel (a marker, a badge, the label). Pick per chart, and state the
pick.

Related: **color follows favorability, not sign.** For metrics where rising
is bad (cost, latency, errors), an upward delta is not green; the metric's
polarity comes from its definition (see [metric-identity](metric-identity.md))
and the arrow follows the sign while the color follows whether the move is
good.

## Series identity is stable

The same entity keeps the same color **across renders, re-sorts, refreshes,
and across every chart on the surface** — this is
[identity-survives-reuse](../../_laws.md#identity-survives-reuse) in pigment.
Color assigned by series *index* reshuffles the mapping whenever data
reorders or a series appears or disappears, which reads as the data changing
when only the ordering did. Bind color to the series' stable identity (its
id, or a deterministic hash of it into the palette), so that entity X is the
same color in the line chart, the donut beside it, and tomorrow.

Index assignment has a second failure beyond reshuffling: **the modulo wrap.**
Cycling a fixed palette over an unbounded series count guarantees that series
N and series N+palette-size render byte-identical colors — not a perception
problem but a collision, and the legend cannot disambiguate what the encoding
has merged. A palette has a capacity; when the series count can exceed it,
the design must cap the series (top-N plus "other") rather than let the
palette silently alias.

When series count exceeds what color can carry, prefer **direct labeling**
(the label at the line's end) over a legend the eye must round-trip; legends
are the weakest link in the vocabulary and the first thing to cut.

## Hue is never the only channel

A meaningful distinction is encoded redundantly — position, order, marker
shape, line style, or a direct label alongside hue — so the chart survives
the common color-vision deficiencies and grayscale reproduction. The quick
audit: would the chart still be readable printed in gray? Status conveyed by
color alone (a red vs green dot with no other difference) fails users the
product claims to support.

## One tooltip, one legend, one number format

- **Tooltip idiom is singular.** Same trigger behavior, same layout (metric
  name, value with unit, timestamp/predicate), same formatting on every
  chart. The tooltip is where readers verify what geometry told them —
  inconsistency here undermines trust in the pixels, not just the popup.
- **Numbers are formatted by the product's shared formatter** — the same
  abbreviations, precision, and locale rules as tables and tiles — so the
  tooltip value matches the adjacent cell to the digit. A chart rounding
  differently from the table beside it manufactures a discrepancy out of one
  correct number (see [metric-identity](metric-identity.md) on precision as
  part of identity).
- **Line style and mark conventions are global**: if dashed means projected
  or partial in one chart, dashed means that everywhere; if a hollow marker
  means estimate, nothing else gets hollow markers. Conventions used once are
  noise; conventions used everywhere are vocabulary.

## The vocabulary is enforceable

Because the vocabulary is centralized (theme object, shared tooltip, shared
formatter), drift is auditable: a chart that imports the engine directly and
sets its own colors is findable mechanically. The review question for any new
chart is not "does it look good" but **"does it read as this product"** — and
the implementation question is "which of these visuals did you define
locally, and why".
