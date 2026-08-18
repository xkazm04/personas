---
layer: technique
subject: tracing
technique: waterfall-rendering
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Waterfall rendering

The waterfall is the read side of the whole subject: the span tree drawn so
that a human finds **the long pole and the failure without reading anything**.
Every layout decision serves that one scan — the eye should land on the
widest bar and the failure color within a second of the view opening, then
drill down. A waterfall that requires reading labels to find the slow part
has failed at its only job; it is a table wearing a chart's clothes.

## The layout invariants

- **One shared time axis.** Every bar is positioned and sized against the
  same scale, with time zero at the trace's start. The moment two spans are
  drawn against different scales — a subagent's subtree rendered relative to
  its own start, a lane normalized to its own duration — visual width stops
  meaning duration and the whole surface lies. Skew-adjusted alignment
  happens before layout; the axis itself is singular.
- **Rows in structural order, indented by depth.** The vertical order is the
  tree's order — each parent followed by its children, siblings by start
  time — so vertical adjacency means causal adjacency. Sorting rows by
  duration or name inside the tree view destroys the nesting narrative;
  rankings ("slowest ten spans") belong in a side list that *navigates to*
  the waterfall row, never reorders it.
- **Bars carry three encodings, no more**: position (start), length
  (duration), color (status — with kind carried by an icon or glyph rather
  than a second color channel). Status colors are the product's standard
  failure palette, and *failed*, *cancelled*, and *interrupted* are visually
  distinct; a cancellation rendered in failure red manufactures alarm, and a
  failure rendered neutrally buries it. Status must also survive without
  color — a glyph or text marker, for the colorblind and for monochrome
  exports.

## Honest bars for dishonest-shaped data

The corner cases are where waterfall implementations quietly lie, and each
has a required honest rendering:

- **Still-open spans** render as open-ended — a bar from start to "now" with
  an unfinished edge treatment — never as zero-width (reads as instant) and
  never as if closed (reads as complete). Failure and completion must look
  different from "still going"
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **Sub-pixel spans** get a minimum hit-and-see size, visually marked as
  clamped so a run of forty one-millisecond calls doesn't render as forty
  identical medium bars. The clamp preserves findability without
  counterfeiting scale.
- **Truncated traces** (the capture ceiling fired) render the truncation
  marker as a first-class row — "N spans not recorded" — where the missing
  subtree would sit. A truncated tree drawn as a complete one sends the
  investigator to a wrong conclusion with full confidence.
- **Estimated spans** carry their estimate marking into the bar itself
  (treatment distinct from measured bars); see
  [synthetic-and-estimated-traces](synthetic-and-estimated-traces.md).
- **Gaps are information.** The unexplained interval between a parent's
  edges and its children's coverage is *self time* — often the actual long
  pole (serialization, queueing, scheduling). Surface it: show self time per
  span, so "the parent is slow but no child is" stops being a dead end.

## Finding the long pole is a computation, not just a picture

The view does the arithmetic the investigator would otherwise do by eye:

- **Self time vs. child time** per span, because a wide parent with wide
  children is a pass-through, while a wide parent with narrow children is
  itself the problem.
- **Critical path**: with concurrency, the longest *sequential* chain — not
  the longest bar — determines the run's duration; ten parallel slow calls
  cost one call's time. The view can mark the chain of spans that actually
  gated the end time; without it, humans optimize wide bars that overlap
  something wider.
- **Wall time vs. attributed totals**: fold-based sums (total model time,
  total cost) shown alongside the wall-clock duration, clearly labeled —
  under parallelism the sum legitimately exceeds the wall time, and a viewer
  that presents the sum *as* the duration teaches its users wrong numbers.

## Depth, collapse, and scale

Real traces nest deep (a subagent inside a tool call inside a stage) and run
wide (thousands of rows). The view stays navigable by:

- **Collapsible subtrees**, collapsed-by-default below a depth or above a
  child count, with the collapsed row summarizing its hidden subtree —
  duration envelope, span count, and, non-negotiably, **worst status rolled
  up**: a collapsed subtree containing a failure shows the failure. Collapse
  must hide detail, never bad news.
- **Virtualized rows** past the low hundreds; the time axis and the
  structural order make windowed rendering straightforward.
- **Zoom on the time axis** for long runs where an interesting burst
  occupies a sliver — zoom changes the scale honestly (axis labels move with
  it) and never per-span.

## Drill-down: the bar is a door

Selecting a span opens its full record — every attribute, its identity and
parentage, its status with failure category, and the doorway to its raw
payloads in the [raw-record-viewers](raw-record-viewers.md) layer. The
waterfall's job ends at *which span*; the span detail's job is *what
happened inside it*. Keeping the two layers distinct is what lets the
waterfall stay a skeleton view that renders ten thousand spans, while the
heavy payloads load only for the one span the human actually opened.
