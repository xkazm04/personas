---
layer: golden-path
subject: metrics-rollups
status: forged
techniques:
  - bucketing-strategy
  - period-comparison
  - bundle-endpoints
  - stored-rollups
  - aggregate-honesty
  - cardinality-and-cost
evidence:
  - src-tauri/src/commands/communication/observability/metrics.rs   # windows clamped at the door (1..365); overview bundle = summary+series+spend in ONE deferred transaction; health bundle with per-source error envelope disambiguating null-failed from null-valid; spend boundary deliberately UTC to match the budget gate's predicate
  - src-tauri/db/src/repos/communication/sla.rs                     # sla_daily rollup: idempotent recompute-and-replace writer, ONE shared local-day-boundary function for writer/backfill/reader, freeze-before-prune sequencing, durable-tail + fresh-head merge picking the more complete source per day
  - src-tauri/db/src/repos/execution/metrics.rs                     # server-side day bucketing (storage-engine GROUP BY); heatmap buckets by caller-local day with same modifier in SELECT and GROUP BY, echoes window_days + generated_at, bounded TTL cache keyed by (days, persona, zone)
  - src-tauri/db/src/migrations/incremental.rs                      # sla_daily backfill reuses the exact runtime rollup writer, so backfilled and live rows share one definition (recomputation named, once)
  - src/features/overview/sub_usage/libs/periodComparison.ts        # the 2x-window single-fetch comparison: one read, split locally, previous period as ghost series
  - src/features/overview/libs/computeTrends.ts                     # comparison discipline: returns null rather than fabricate a trend from a single loaded window; previous=0 branches before dividing
  - src/features/overview/sub_usage/libs/pivotToolUsage.ts          # client pivoting for presentation shape only — transposes already-aggregated rows, no new numbers
counter_evidence:
  - src/features/overview/libs/computeTrends.ts                     # same file, other face: ordinal-index period split assumes a dense series while the feed is group-by-sparse (boundary drifts by the count of quiet days); avgField takes unweighted means of daily means and daily p50s
deviations:
  - w5-metrics-rollups   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Time-series aggregation & rollups

Somewhere in the product there is a log: an append-only record of things that
happened — executions, requests, messages, errors — each row carrying a
timestamp and some dimensions. Every dashboard tile, trend line, heatmap, and
"up 12% from last week" in the product is a **derivation over that log**: rows
folded into buckets, buckets folded into windows, windows compared against
other windows. This subject owns that derivation — the computation that turns
events into series. What the numbers *mean* and how they are *drawn* is the
adjacent subject: [data-viz](../data-viz/data-viz.md) owns metric identity and
display; the [metric-identity](../data-viz/techniques/metric-identity.md)
contract (one derivation per named metric, parity gates where duplication is
forced) governs *which* computation is the right one. This subject governs
**where and how that computation runs** — bucketing, windowing, comparison,
storage of the derived form, and the cost curve underneath all of it.

The boundary matters because the two subjects fail differently. A display
defect makes one chart lie. An aggregation defect makes *every consumer of the
series* lie in agreement — the chart, the tile, the export, and the alert all
faithfully render the same wrong fold, and no amount of visual honesty
recovers a number that was mis-bucketed at birth.

## Aggregation runs where the rows live

The first structural decision, and the one hardest to reverse: **push the fold
down to the storage engine; never ship raw events across a boundary so a
client can add them up.** The reasons are not stylistic:

- **The volumes are asymmetric by orders of magnitude.** A month of events may
  be millions of rows; the daily series derived from it is thirty points. Every
  boundary the raw rows cross — process, serialization, network, memory — pays
  the large number so the small one can be computed on the wrong side.
- **The storage engine folds correctly under concurrency.** A client
  aggregating a paginated stream is aggregating a set that can change between
  pages; the engine aggregates one consistent read.
- **A client-side fold is a second implementation of the metric.** It will
  drift from the server's definition exactly as the
  [metric-identity](../data-viz/techniques/metric-identity.md) technique
  predicts — same name, different filters, a support ticket titled "why do
  these two pages disagree".

What legitimately remains client-side is **pivoting for presentation shape**:
transposing an already-aggregated result into the row/column arrangement a
particular component wants, regrouping a returned breakdown by a different
display key, formatting. The test is simple — presentation-shape code touches
only numbers the server already aggregated, and its output contains no number
the input did not. The moment client code sums raw events or windows
timestamps, the fold has escaped to the wrong side of the boundary.

## The window contract: a result echoes what it actually covered

Every aggregation request names a window — "last 30 days", "this week", a
custom range. Every aggregation **response must state the window it actually
covered**, because the two routinely differ and the difference is part of the
answer:

- The request exceeded a retention or policy maximum and was **clamped**.
- The range's edges fell mid-bucket and were **aligned** outward or inward to
  bucket boundaries.
- The trailing bucket is **partial** — today is not over.
- The range predates the data — the log simply does not go back that far.

A response that returns points without the effective window forces every
consumer to *assume* the request was honored, and the assumption fails
silently: the axis is labeled with the requested range, the comparison
divides by the wrong number of days, the export claims coverage it does not
have. The contract is one rule with no exceptions: **requested window in,
effective window out, and the effective window is what every downstream
computation uses.** Bucket arithmetic — grain choice, boundary alignment,
timezone and clock-shift edges, zero-filling — is the
[bucketing-strategy](techniques/bucketing-strategy.md) technique.

## Comparisons are one read, not two

"Up 12% from last week" is a claim about **two windows measured identically**.
The moment the current period and the prior period come from two separate
fetches, the claim degrades: the reads race (data arrives between them),
filters and definitions drift between two call sites, and the pair can render
half-updated. The discipline: **fetch one doubled window in a single read and
split it locally at the boundary** — one query, one filter interpretation, one
snapshot, then arithmetic. Alignment (comparing like spans, not a partial
period against a whole one) and growth-math honesty (small and zero
denominators) are the [period-comparison](techniques/period-comparison.md)
technique.

The same consistency argument scales up from one comparison to a whole
surface: a dashboard whose summary tiles, trend series, and breakdown table
come from independent requests is a surface whose numbers *can* disagree —
different moments, different clamps, subtly different filter parsing — and
eventually will, visibly, in one screenshot. Serving the numbers that will be
read together from **one read over one snapshot** is the
[bundle-endpoints](techniques/bundle-endpoints.md) technique.

## The rollup is a stored derivation, and it names its recomputation

When the log grows past what on-the-fly folding can serve interactively, the
answer is a **rollup**: the fold, precomputed at a chosen grain (typically
daily) and stored. This is the single most consequential move in the subject,
because it creates a second copy of the truth — a derived one — and every
stored derivation is a future discrepancy unless it
[names its recomputation](../_laws.md#derivation-names-recomputation): which
code rebuilds a bucket, what triggers it, how far back late-arriving events
can reach, and how a backfill is run when the definition changes. A rollup
with no invokable rebuild path is not an optimization; it is a fork of the
log that will quietly diverge from it. Grain choice, the live-edge seam
(history from the rollup, today from the log), idempotent rebuilds, and
invalidation are the [stored-rollups](techniques/stored-rollups.md) technique.

## The result is honest about what it is

Aggregation manufactures numbers that *look* uniform — a clean array of
buckets — out of inputs that are not: the last bucket is still filling, some
buckets measured zero while others were never covered, some points came from
a live fold and others from a frozen rollup. The series format must carry
those distinctions instead of flattening them, because once flattened they
are unrecoverable downstream: a partial bucket plotted as final is a fake
cliff; a coverage gap zero-filled is a fabricated crash; a merge that
computes which source answered and then drops that from the wire format
leaves every consumer structurally unable to say what it is showing. The
distinctions and their wire-format obligations are the
[aggregate-honesty](techniques/aggregate-honesty.md) technique.

## Cardinality is the cost driver

The intuition that "more events = more expensive" is wrong in the way that
matters. The cost of an aggregation surface is dominated not by row count —
the engine folds rows cheaply — but by **the size of the output**: distinct
group keys × buckets. One series over a year of millions of events is cheap;
a per-key breakdown over an unbounded, user-supplied dimension is a result
set with no ceiling, and it grows adversarially — the busiest tenant, the
noisiest label set, the integration that mints a new key per request. Every
grouped endpoint therefore ships with a bound: top-N with disclosed
truncation, per-key limits, grain coarsening as the range grows. Bounds and
their honesty obligations are the
[cardinality-and-cost](techniques/cardinality-and-cost.md) technique.

## What this subject refuses

- **Aggregating in the display layer.** A component that sums, averages, or
  windows raw events has taken ownership of a metric definition it cannot
  keep; see the client/server split above.
- **A second ad-hoc fold for a second surface.** The export, the alert
  evaluator, and the chart share one aggregation path or they share nothing;
  this is the aggregation-side face of
  [metric-identity](../data-viz/techniques/metric-identity.md).
- **Unbounded group-by on user-controlled keys.** No bound, no endpoint.
- **A rollup without a rebuild story.** If nobody can say how a stored bucket
  gets recomputed, the rollup is scheduled divergence.
- **Windows that lie.** Any response that reports the requested window when it
  served a different one.

## The techniques

- [bucketing-strategy](techniques/bucketing-strategy.md) — grain choice,
  bucket-boundary arithmetic, timezone and clock-shift edges, clamping, and
  echoing the effective window back.
- [period-comparison](techniques/period-comparison.md) — one doubled-window
  read split locally; aligned like-for-like spans; growth math that survives
  zero denominators and partial periods.
- [bundle-endpoints](techniques/bundle-endpoints.md) — summary, series, and
  breakdown computed in one read over one snapshot so co-displayed numbers
  cannot disagree.
- [stored-rollups](techniques/stored-rollups.md) — the materialized fold:
  grain, the live-edge seam, idempotent recomputation, backfill, and
  late-event invalidation.
- [aggregate-honesty](techniques/aggregate-honesty.md) — partial buckets
  marked, empty distinguished from uncovered, provenance surviving merges.
- [cardinality-and-cost](techniques/cardinality-and-cost.md) — output-size
  budgets: top-N with disclosed truncation, per-key limits, pre-aggregation,
  grain coarsening.
