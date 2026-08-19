---
layer: technique
subject: metrics-rollups
technique: bundle-endpoints
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Bundle endpoints

A dashboard is a set of numbers the user reads **as one statement**: the
summary tile says 4,210 runs, the trend chart's buckets should sum to it, the
breakdown table should partition it. The user cross-checks these instinctively
— and when they disagree, the product has shipped its most corrosive defect:
three correct-looking surfaces proving at least one of them wrong, in a single
screenshot.

Numbers read together can only be guaranteed to agree if they are **computed
together**: one request, one filter interpretation, one clock, one snapshot.
That is the bundle endpoint — summary + series + breakdown returned as one
envelope — and it is a *consistency* device before it is a performance one.

## Why independent requests eventually disagree

Each tile fetching for itself introduces four independent axes of divergence,
all observed in the wild:

- **Time.** Requests resolve "now" at different instants. On an active log,
  the summary counted events the series has not seen. Worse, "last 30 days"
  itself moves between requests — two tiles can hold *different windows* while
  displaying the same window label.
- **Interpretation.** Each endpoint parses the filter set, resolves the
  timezone, applies the clamp. N endpoints is N parsers; they agree until the
  first uneven edit.
- **Definition.** Each endpoint folds the metric. The summary's "failed" and
  the breakdown's "failed" are two predicates that started identical — the
  request-level face of the fork that
  [metric-identity](../../data-viz/techniques/metric-identity.md) prohibits
  at the definition level.
- **Failure.** Independent requests fail independently, and the surface
  renders a chimera: fresh summary, stale series, error-state breakdown, all
  under one heading.

## The bundle contract

- **One resolution step.** The request's window, zone, and filters are parsed
  and clamped **once**; every section of the bundle is computed from the
  resolved form. The effective window (per
  [bucketing-strategy](bucketing-strategy.md)) is echoed once, at the
  envelope level, and applies to every section — one authority for the
  request vocabulary rather than a parser per section, which is
  [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
  at request scope.
- **One snapshot.** All sections read the same consistent view of the log.
  Where the store offers transactions or a stable snapshot, use it; where it
  does not, compute the sections from **one scan's intermediate result**
  (fold once into the finest section, derive the summary and the coarser
  sections from that fold) rather than re-querying per section.
- **Internally consistent by construction.** The strongest form derives the
  aggregates from each other: series buckets sum to the summary count,
  breakdown rows partition it (with any truncation remainder disclosed — see
  [cardinality-and-cost](cardinality-and-cost.md)). When sections are
  derived rather than independently queried, agreement is structural, not
  coincidental.
- **One failure domain — or an explicit per-section one.** The default bundle
  succeeds or fails as a unit. When sections have genuinely different failure
  surfaces (one privileged, one flaky, one optional), a partial bundle is
  legitimate — but then the envelope carries a **per-section error slot**, so
  that a section that is null-because-it-failed is distinguishable from one
  that is null-because-nothing-is-configured. Those are different facts with
  different renderings, and collapsing them is
  [failure spelled as empty success](../../_laws.md#failure-not-empty-success)
  at bundle scale. What a partial bundle never does is silently substitute a
  stale section for a failed one.

## What a bundle is not

- **Not a kitchen sink.** The bundle's membership rule is *co-display and
  cross-reading*: numbers the user will check against each other belong in
  one bundle. Surfaces with independent lifecycles — a slow heatmap below
  the fold, an expensive per-key drill-down behind a click — are separate
  requests *because* the user never cross-sums them against the tiles, and
  coupling their latency to the summary's makes the whole page as slow as
  its slowest section.
- **Not a cache-buster.** Because one envelope serves many components, it is
  the natural cache key: window + filters + zone. A bundle recomputed per
  component subscription has re-created the N-requests problem behind one
  request shape.
- **Not a substitute for shared derivation.** The bundle guarantees the
  *sections of one response* agree. Two different bundles showing the same
  named metric still agree only if they share the derivation — the bundle
  narrows the identity problem; the metric contract closes it.

## Shape notes

- The envelope carries the resolved request beside the data: effective
  window, grain, zone, applied filters, and the snapshot moment. Consumers
  render from the envelope's account of what was measured, never from the
  request they think they sent.
- Sections are named for what they answer (summary, series, breakdown), not
  for the components that consume them — components come and go; the
  cross-reading structure is the stable thing.
- Client code may reshape bundle sections freely (pivot, regroup, transpose)
  under the parent subject's rule: presentation-shape only, no new numbers.

## Smells

- A dashboard where two tiles under one filter bar issue requests whose
  filter serializations differ.
- A summary count that does not equal the sum of the series it sits above —
  and no one can say which is right (both were right, at different instants).
- A page that renders numbers progressively and looks self-contradictory for
  a second on every refresh.
- Per-section retry logic quietly serving one section from a previous window.
