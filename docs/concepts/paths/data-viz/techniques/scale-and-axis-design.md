---
layer: technique
subject: data-viz
technique: scale-and-axis-design
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Scale and axis design

The scale is the chart's epistemology: it decides what a visual difference
*means*. Two series drawn at the same amplitude are being claimed comparable;
a slope is being claimed proportional to a rate. Libraries default to
data-fit auto-scaling because it makes every individual chart look good in
isolation — which is exactly the wrong optimization for a product, where
charts live next to each other and next to their own past.

## Fixed vs auto: the decision procedure

Ask one question: **will the reader compare this chart with anything else?**

- **Compared with siblings** — small multiples, a sparkline column, the same
  metric across entities, a dashboard of like measures → **fixed, shared
  scale** across the set. The set's scale is computed from the set (or from
  the domain's known bounds), not per member. Auto-scaled siblings are the
  classic silent lie: a series wobbling between 4 and 6 renders with the same
  drama as one climbing from 0 to 10,000, and the layout invites the
  comparison its scales forbid.
- **Compared with itself over time** — the same chart re-rendered as data
  refreshes → a **stable scale policy**, so a refresh doesn't rescale the
  world. A y-axis that jumps between renders makes the data look like it
  moved when only the frame did. Grow the domain when data exceeds it; shrink
  it reluctantly and never mid-view.
- **Examined alone for internal shape** → auto-scale is legitimate, and often
  right: the reader's question is about detail within the series, and pinning
  zero can flatten the signal into invisibility.

The anti-pattern is not auto-scaling — it is auto-scaling **by default,
undecided**. Every chart in a product should be able to answer "why this
scale" with a reason, not a shrug at the library.

## The one defect to hunt: the sample-anchored floor

Among all scale mistakes, one deserves to be named as *the* defect because it
is a correctness bug that no reviewer's eye can catch: **deriving the scale's
floor from the sample's own minimum.** A projection that maps the smallest
observed value to the bottom of the box and the largest to the top produces a
picture for every input, and every picture looks reasonable — that is exactly
the problem. The consequences, all measured wherever this defect ships:

- A series moving from 99.1 to 99.3 percent fills the full height of the box —
  a flat, healthy metric rendered as a dramatic climb.
- The renderer is *most* dramatic exactly where the data is *least*
  meaningful: sub-noise wiggle amplifies to full amplitude, while a genuinely
  large move renders the same way, so amplitude carries no information at all.
- Two panels in the same row silently use different scales, and the layout
  invites the comparison the scales forbid.

The structural fix outranks the disciplinary one: **the projection takes its
domain as a required input.** A drawing helper that computes its own floor
internally cannot be audited from the call site and will be reimplemented by
the next author who needs a different floor; a helper whose signature demands
`[min, max]` makes the honest zero-floor one keystroke shorter than the lie,
and makes a sample-anchored scale impossible to write through the sanctioned
door. Where the rendering library's own default is already zero-anchored,
the rule inverts into: *do not touch the domain except to widen it* to a
known fixed range — every override is a decision to depart from zero and
needs a stated reason. Narrowing a value axis to "data min…data max" is the
same defect spelled in configuration.

## Zero-baseline discipline

The baseline rule follows from the encoding, not from taste:

- **Length encodings (bars, areas, stacked anything) start at zero, always.**
  The eye reads a bar's magnitude as its length; a bar axis starting at 90
  renders a 92-vs-98 difference as a 4× visual ratio. There is no legitimate
  truncated bar chart — if zero makes the differences invisible, the
  differences are small, and hiding that is the lie; switch encodings instead.
- **Position encodings (lines, dots) may truncate** — a line's information is
  in its slope and shape, not its distance from the floor — but truncation is
  **disclosed where the eye is**, not merely deducible from tick values: an
  explicit domain annotation, a broken-axis mark, or a visibly non-zero floor
  label. The reader skims geometry first and reads ticks never.
- **Percentages of a whole get the whole**: a share-of-total axis runs 0–100
  unless there is a stated reason, because the reader's reference frame is
  the whole.

## Ticks and gridlines

- Ticks land on **round numbers in the data's unit** — 0/25/50/75/100, not
  0/23.7/47.4 — even when that means the domain is slightly wider than the
  data. A "nice" domain that wastes 4% of the plot height buys legibility
  cheap.
- **Few ticks.** Three to five per axis answers almost every reading; ten is
  wallpaper. Gridlines are the quietest element on the surface — present
  enough to carry the eye horizontally, never competing with data ink.
- The axis label carries **unit and predicate** — "requests / min", "p95
  latency (ms)", "errors, rolling 7d" — because a number that travels without
  its predicate will be quoted for a claim it does not support
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
  tooltip repeats the unit; the reader who arrives via hover never saw the
  axis.
- **Log scales are exceptional and loud.** They answer real questions
  (multiplicative growth, spans of magnitudes) but most readers decode them
  linearly; a log axis is labeled as such in words, not left to tick spacing
  to reveal.

## Time is the hard axis

Time axes concentrate most scale defects in products:

- **Bucket size is chosen per visible range, once, deliberately** — minutes
  for an hour view, hours for a week, days for a quarter — and the bucketing
  is part of the metric's meaning: "peak concurrent" and "hourly average"
  are different numbers with different shapes. Rebucketing on zoom changes
  the claim; say so (the subtitle or axis states the grain).
- **The trailing bucket is partial** on every live view, and plotting it as
  final paints a cliff at the right edge — the single most common trend-chart
  artifact. Mark it visually distinct, drop it, or extrapolate with explicit
  styling; never let today-so-far masquerade as today.
- **Empty buckets exist.** A time series is defined on the full grid of
  buckets in the window; buckets with no observations are either true zeros
  (the thing was measured and didn't happen) or gaps (nothing was measured) —
  the distinction belongs to the data contract, and the rendering must honor
  it (see [empty-and-degraded-chart-states](empty-and-degraded-chart-states.md)).
- **Boundaries are timezone decisions.** "Daily" buckets cut at midnight in
  *some* zone; the choice changes which day a 23:30 event lands in. Pick the
  zone deliberately (usually the viewer's, sometimes the domain's), state it,
  and keep it consistent across every surface showing the same metric.

## Dual axes: almost never

Two y-axes on one plot let the author fabricate any correlation by choosing
scales — the reader cannot tell designed alignment from real alignment. When
two metrics genuinely belong together, prefer stacked panels sharing the time
axis. If a dual axis truly earns its place, the two scales get visually
paired with their series (color-matched axes) and both obey every rule above
independently.
