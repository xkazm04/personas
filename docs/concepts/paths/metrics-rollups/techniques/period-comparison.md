---
layer: technique
subject: metrics-rollups
technique: period-comparison
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Period comparison

"Up 12% vs last week" compresses two aggregations and a division into one
glanceable claim, which is why products lean on it — and why it is the most
frequently wrong number on a dashboard. The claim is only as good as three
guarantees: both periods were measured **identically**, the periods are
**comparable spans**, and the arithmetic **survives its edge cases**. Each
guarantee has a technique.

## One doubled read, split locally

The naive shape — fetch the current period, fetch the previous period,
divide — is two requests that can and will diverge:

- They read at **different moments**. Events land between the two reads; on
  a busy log the "current" read is systematically fresher than whichever
  fired first.
- They are **two call sites**. Filters, timezone parameters, and metric
  definitions drift between them independently — the classic fork the
  [metric-identity](../../data-viz/techniques/metric-identity.md) contract
  exists to prevent, recreated at request granularity.
- They **fail independently**. One succeeds, one times out, and the surface
  renders a delta between a number and a stale cache — or spins forever on
  half an answer.

The correct shape: **one request for a window of twice the length, split at
the period boundary after it returns.** One filter interpretation, one
snapshot, one failure domain; the split is pure arithmetic on data already in
hand.

One precondition on that arithmetic, easy to violate silently: **the split
point is a moment in time, not a position in an array.** Splitting a doubled
series at "length minus period" is only correct when the series is dense —
every bucket present, including empty ones. Aggregation sources are typically
sparse (a grouped fold returns only buckets that contained rows), and over a
sparse series the ordinal midpoint drifts by exactly the number of quiet
buckets: the "previous half" becomes the first N surplus points, which is not
the previous period. Either densify first (zero-fill over the effective
window, per [bucketing-strategy](bucketing-strategy.md)) or split by bucket
timestamp. An ordinal split over a sparse feed degrades worst on exactly the
installs least equipped to notice — the quiet ones.

The doubled read is also the cheap shape — the doubled window is one scan, not two,
and the previous period is almost always adjacent to the current one so the
engine reads it in the same pass. When periods are *not* adjacent (this March
vs last March), the single-read discipline still holds: one request naming
both windows, answered from one snapshot, even if the engine internally
performs two range reads.

## Compare like spans or say you didn't

Alignment errors produce deltas that are precisely computed and meaningless:

- **Equal lengths.** The previous window is the same number of buckets, at
  the same grain, in the same zone. Calendar months violate this constantly
  (28–31 days); either compare per-day rates or disclose that the spans
  differ.
- **Same boundary style.** Week-to-week comparisons align weekday to weekday;
  comparing a Mon–Sun week against a trailing arbitrary 7 days mixes weekend
  effects into the delta.
- **The partial-period lie.** The most common comparison defect in the wild:
  today is Tuesday, and the tile compares two elapsed days of this week
  against seven days of last week, then reports business down 70%. A period
  still in progress compares against the **same elapsed portion** of the
  prior period (period-to-date vs prior-period-to-date), or the comparison
  waits until the period closes. Which convention the tile uses is stated on
  the tile — "vs same point last week" and "vs all of last week" are
  different claims, and [a count carries its
  predicate](../../_laws.md#count-carries-predicate).
- **Clock shifts.** In a shifting zone, one of the two windows may contain
  the 23- or 25-hour day. Per-bucket comparisons absorb this; whole-window
  totals across a shift differ by an hour of traffic. Bucket arithmetic
  rules live in [bucketing-strategy](bucketing-strategy.md).

## Growth math that survives its denominators

The delta arithmetic is trivial until the previous period is small, then it
is a lie generator:

- **Previous = 0, current > 0** is not "+∞%" and not "+100%"; it is **new** —
  a categorically different fact that gets its own rendering. Any formula
  that divides by the previous value must branch before it divides.
- **Previous = 0, current = 0** is *no change*, but displaying "0%" implies
  measurement of a trend that has no data; prefer an explicit no-activity
  state.
- **Tiny denominators** produce honest-but-useless percentages: 1 → 3 is
  "+200%" and pure noise. Below a floor the surface shows absolute change
  ("+2") or withholds the percentage; the floor is a product decision, but
  *having* one is the technique.
- **Sign and goodness are different axes.** The computation returns the
  signed delta; whether positive is good belongs to the metric's declared
  polarity — owned by
  [metric-identity](../../data-viz/techniques/metric-identity.md), resolved
  once, never re-decided per tile.
- **Rates compare as differences, not ratios of ratios.** A success rate
  moving 98% → 99% is "+1 point", not "+1.02%"; percentage-change-of-a-
  percentage double-encodes and misleads in both directions.

## The comparison is one derived object

The output of this technique is not two numbers a component subtracts — it is
one structure: current value, previous value, the delta in declared form
(percent, points, absolute, or *new*), and the two effective windows it
compared. Computing it in one place, once per metric, keeps the branching
rules above from being re-implemented — divergently — in every tile that
shows an arrow.

## Smells

- Two fetch calls whose argument lists differ only by a date range,
  feeding one delta.
- A rendered "+∞%", "NaN%", or a delta of exactly +100% appearing
  suspiciously often (the previous=0 branch collapsed into the formula).
- A this-week/last-week tile that plunges every Monday morning.
- A component that computes `(a - b) / b` inline — the derived-object rule
  above has been bypassed, and at least one edge case is unhandled.
