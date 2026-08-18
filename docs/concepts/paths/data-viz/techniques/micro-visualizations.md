---
layer: technique
subject: data-viz
technique: micro-visualizations
status: forged
laws: []
shared_with: []
---

# Micro-visualizations

A micro-visualization — a sparkline in a table cell, a completion ring on a
card, a confidence arc beside a score, a tiny bar in a list row — is a chart
with all of its chrome amputated: no axes, no ticks, no legend, no gridlines,
usually no labels. What survives the amputation is only the *shape*, which
means the form works under exactly one condition: **the glyph answers one
pre-attentive question, and everything the chrome would have carried is
supplied by context or by fixed convention.**

## When a micro-viz, when a number, when a full chart

- **A number** when the question is "what is the value". A sparkline cannot
  be read for magnitude; a ring cannot be read to the percent. If the value
  itself is the answer, print it — the glyph, if present, rides *beside* the
  number, never instead of it.
- **A micro-viz** when the question is directional or proportional and asked
  *many times in parallel*: which rows are trending down, which items are
  nearly complete, how does this week's shape compare across twenty entities.
  The dense repetition is the justification — one sparkline is a decoration,
  a column of them is an instrument.
- **A full chart** the moment the user needs to interrogate: exact values,
  time positions, comparisons at specific points. The micro-viz's honest role
  is a *doorway* — it shows that a pattern exists and links to the surface
  where the pattern can be questioned.

## Fixed scales are mandatory, not optional

In a full chart, fixed-vs-auto scaling is a decision (see
[scale-and-axis-design](scale-and-axis-design.md)). In a column of
micro-visualizations the decision is forced: **cells exist to be compared, so
the scale is shared across all cells** — same value domain, same time window,
same bucket grain. An auto-scaled sparkline column is worse than none: every
cell renders its noise at full amplitude, the flat and the volatile look
identical, and the column *invites* the comparison its scales silently break.

The same goes for time: every sparkline in a column covers the same window
aligned to the same clock, or the shapes are not comparable and must not sit
in a shared column.

One refinement the rule needs to survive contact with real surfaces: the
shared-scale mandate applies when cells encode the **same metric**. A matrix
where each row tracks a *different* metric in different units cannot share a
value domain; there, per-row normalization is legitimate — but only for
shape, and the surface must then avoid inviting cross-row amplitude
comparison (and each row's normalization still declares its floor rather
than anchoring to its own sample minimum; a heterogeneous matrix does not
suspend the scale discipline of
[scale-and-axis-design](scale-and-axis-design.md), it just applies it per
row). The test: if a reader could reasonably conclude "row A is more
volatile than row B" from the pictures, the scales must make that conclusion
true or the layout must make it unaskable.

Bounded encodings (rings, arcs, fill bars) inherit the rule automatically —
their domain is 0-to-whole by construction, the mark carries its own scale.
That is a reason to prefer them in dense surfaces: they cannot be silently
rescaled. What they *can* silently swap is the denominator: share-of-total
("how is this whole divided") and share-of-largest-sibling ("which of these
is biggest") produce identical-looking bars with different meanings, and a
per-row denominator (each item against its own target) is a third family
that must never sit unlabeled in the same visual language as the first two.
Name the denominator, in the computation and in the surrounding context, and
never mix families in one surface without labeling each.

## Design constraints at glyph size

- **One series, one question.** Multi-series sparklines at cell size are
  spaghetti; if two series must be compared, that is a full chart's job.
- **Legibility floors are real.** Below a minimum rendered size a trend line
  is an artifact of anti-aliasing, and a ring's 72% is indistinguishable from
  81%. Under the floor, degrade to the number or a discrete direction mark
  (up/flat/down) rather than shipping an unreadable picture.
- **The honesty rules shrink with the chart.** Unmeasured is still not zero —
  a gap is a gap even three pixels tall; a partial trailing bucket still
  cliff-fakes; a magnitude-encoded mini-bar still starts at zero. Small is
  not a license to lie small.
- **Color follows the shared vocabulary.** A red mini-trend means what red
  means everywhere (see [encoding-vocabulary](encoding-vocabulary.md)); a
  decorative palette on glyphs teaches readers to ignore color, which then
  undermines it on the surfaces where it carries status.
- **Quiet by default.** No entrance animation per cell in a scrolling column,
  no hover states that change layout. In a table, the glyph obeys the row's
  rhythm — fixed height, no reflow — because it is a *cell*, subject to the
  table's rules first.

## Degenerate data degrades explicitly

Dense surfaces meet degenerate data constantly — new entities with two data
points, entities with none, all-zero histories:

- **Too few points for a shape** → no line. Two points draw a slope that
  reads as a trend but is noise; below a stated minimum (typically a handful
  of buckets), render the number, a dash, or a "collecting" mark instead.
- **No data at all** → an explicit blank state, not an empty image the same
  size as a real one — an indistinguishable blank teaches readers that blanks
  might mean anything (see
  [empty-and-degraded-chart-states](empty-and-degraded-chart-states.md)).
- **The glyph never throws.** At the scale of a cell renderer, failures must
  degrade to the blank state; one malformed history must not break the row,
  the column, or the table.

## Context supplies what chrome would have

The glyph carries no labels, so its meaning must be recoverable from where it
sits: the column header names the metric and window ("7-day trend"), the
adjacent cell holds the current value, and a hover or focus affordance can
reveal the precise reading for those who need it — with the full chart one
step away. A micro-viz whose meaning cannot be reconstructed from its
surroundings is not minimal; it is unlabeled.
