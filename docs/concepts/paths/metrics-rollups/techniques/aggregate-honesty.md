---
layer: technique
subject: metrics-rollups
technique: aggregate-honesty
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Aggregate honesty

Aggregation's output *looks* uniform — a tidy array of buckets, every slot a
number — but the inputs behind those slots differ in kind: some buckets are
final, one is still filling; some measured genuine silence, others were never
measured at all; some numbers came from a live fold, others from a frozen
rollup, others from a merge of both. The technique is a single obligation
applied repeatedly: **distinctions that exist at aggregation time must
survive into the result format**, because the aggregation layer is the last
place they exist — a display layer cannot mark a partial bucket it cannot
identify, and an alert cannot ignore one. Flattening is not simplification;
it is deletion of the part of the answer that says what the answer is.

## Partial buckets are a different kind of value

The trailing bucket of any live series is not finished. Summed and plotted
as if final, it renders the same lie on every dashboard in the industry: a
cliff at the right edge, re-manufactured on every render, decaying toward
truth as the bucket fills. The aggregation result must mark it —
a flag on the bucket, or the effective-window metadata that lets any
consumer derive "this bucket's interval extends past the snapshot moment."
What consumers then do (dash the last segment, exclude it from the trend
fit, suppress it from period totals) is display policy; *that they can* is
aggregation's obligation. The same marking rules the comparison lane: a
[period comparison](period-comparison.md) that includes the partial bucket
on one side only is structurally wrong, whatever its arithmetic.

## Empty is a measurement; missing is the absence of one

Two facts collapse into the same rendered zero unless the format separates
them:

- **Empty**: the interval was covered and zero events occurred. A true zero
  — plot it at the floor, include it in averages.
- **Missing**: the interval was not covered — before the log began, beyond
  the clamp, during an outage of the collector itself. Not zero; *no
  measurement exists*. Including it in an average deflates the average with
  fabricated data; plotting it at zero draws a crash that never happened.

The zero-fill rules in [bucketing-strategy](bucketing-strategy.md) implement
the boundary mechanically (fill inside the effective window, never outside);
this technique states why the boundary is sacred: it is
[failure-not-empty-success](../../_laws.md#failure-not-empty-success) applied
to data itself. "We measured nothing happening" and "we did not measure" must
be spelled differently all the way to the last consumer. The subtlest case is
ratio metrics: a success *rate* over a bucket with zero attempts has no
value — not 0% (spelled: everything failed) and not 100% (spelled:
everything succeeded). The slot holds an explicit no-value, and downstream
math skips it rather than averaging it in.

## Provenance survives the merge

Rollup-backed series are merges: stored final buckets spliced with a live
partial edge; sometimes a cache layered over both. At merge time the code
knows, per point, exactly which source answered and how final it is — and
the observed failure shape is that the code computes precisely that and then
**drops it**, because the wire type has a slot for the number and none for
its origin. Every consumer downstream of that type is then structurally
unable to say what it is showing; two populations with different freshness
and different completeness render as one continuous line, and no display-side
honesty can recover the distinction. The rule: the result type carries
provenance — per point where sources interleave, per range where a single
splice boundary suffices — and the merge function's knowledge outlives the
merge function. A wire format is not "done" when the numbers fit; it is done
when the *account of the numbers* fits.

## Composition honesty

Folds of folds have their own lying shapes:

- **Averages do not average.** A mean of daily means weights a two-event day
  equally with a ten-thousand-event day. Re-aggregating requires the parts
  that compose: store sums and counts (or the appropriate mergeable sketch)
  and divide at the end. The same holds for rates and percentiles —
  percentiles compose only through sketches, never through averaging the
  percentile values themselves. A rollup schema that stores only the
  finished ratio has amputated its own coarser grains: weekly can no longer
  be derived from daily, and someone will derive it anyway, wrongly.
- **A count travels with its predicate.** Every aggregate in the result is
  answerable to *what was counted, over what interval, under what filters* —
  [count-carries-predicate](../../_laws.md#count-carries-predicate). In
  practice: the envelope's effective window and filter echo (per
  [bundle-endpoints](bundle-endpoints.md)) is that predicate, and any
  aggregate that escapes the envelope (an export, an alert payload) carries
  it along.
- **Truncation is disclosed where it happened.** A breakdown cut to top-N
  whose rows are then summed by a consumer silently underreports the total;
  the disclosure rules live in
  [cardinality-and-cost](cardinality-and-cost.md).

## Smells

- Every dashboard trend ends in a dip, and everyone has learned to ignore
  the last point — the users are compensating for the format.
- A time series type that is exactly `array of (time, number)` fed by a
  merge of sources — the provenance slot is missing by construction.
- A rollup schema storing ratios or percentile values without their
  composable parts.
- An average that changes when an outage period is included — missing
  intervals are being counted as zeros.
- "0%" rendered on a bucket with no attempts.
