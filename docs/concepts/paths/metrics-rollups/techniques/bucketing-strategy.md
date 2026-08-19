---
layer: technique
subject: metrics-rollups
technique: bucketing-strategy
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Bucketing strategy

A bucket is the atom of a time series: a half-open interval `[start, end)`
and a fold of the events whose timestamps land inside it. Everything a series
claims rests on how those intervals were drawn — and interval-drawing is where
time stops being a number line and becomes a civil construct with owners,
offsets, and discontinuities. The technique is the set of decisions that make
bucketing deterministic, disclosed, and reproducible.

## Grain is chosen, and chosen per range

The grain (hour, day, week, month) is a function of the range being asked
about, not a constant:

- A day at hourly grain is 24 points — readable. A quarter at hourly grain is
  ~2,160 points — noise to a human and a payload problem to a machine.
- The useful heuristic is an **output budget**: pick the coarsest grain that
  still gives the question enough resolution, and cap the point count a single
  response may return. When a range grows past the cap, the grain coarsens —
  automatically and *visibly*, because a series silently re-grained mid-zoom
  reads as the data changing shape.
- Grain interacts with the rollup layer: a stored daily rollup can serve
  daily and coarser grains directly; an hourly question about last quarter
  either reads the raw log or does not get answered. Offering a grain the
  storage strategy cannot serve is a promise the endpoint will break under
  load.

## Buckets are half-open, aligned, and owned by a zone

Three arithmetic rules, each protecting against a class of double-count or
gap:

1. **Half-open intervals.** `[start, end)`, always. Closed-closed intervals
   assign boundary timestamps to two buckets; open-open drops them. Every
   consumer of a bucket boundary must be able to assume the convention
   without reading the code.
2. **Alignment to calendar boundaries of a named timezone.** "A day" is not
   86,400 seconds from an arbitrary origin — it is midnight-to-midnight *in
   some zone*, and the zone is a parameter of the aggregation, not an
   accident of the server's locale. Bucketing in the storage engine's default
   zone means the series silently changes when the deployment moves.
   Whichever zone is chosen — the user's, the org's, or universal time — it
   is declared, applied consistently between the bucketing fold and the
   boundary computation, and echoed with the result. The classic defect is a
   split brain: boundaries computed in one zone, bucket keys truncated in
   another, producing a first and last "day" that are a few hours short and a
   phantom extra bucket at one edge.
3. **Clock-shift days are real.** In zones with seasonal shifts, one day a
   year has 23 hours and another has 25. Bucketing that assumes uniform
   day length (dividing a timestamp delta by 86,400, adding fixed offsets in
   a loop) drifts by an hour across the shift and mis-assigns every event in
   that hour. Day arithmetic goes through calendar operations, not seconds
   arithmetic. If the product genuinely does not care (universal-time
   bucketing throughout), that is a legitimate choice — *declared*, so nobody
   "fixes" half of it later.

One override outranks user-friendliness in the zone choice: **when the
aggregate mirrors an enforcement boundary** — a budget gate, a quota, a rate
limit — **the enforcer dictates the zone and the boundary.** A display that
buckets a friendlier local-time month while the gate enforces a universal-time
month will disagree with the thing that actually blocks, and that disagreement
reads as a bug in whichever number the user saw second. Measure exactly what
the gate enforces, even at the cost of a less intuitive boundary — and record
that the mismatch with local intuition is deliberate, or someone will "fix"
it back into disagreement.

## Requested window in, effective window out

The window actually served routinely differs from the window asked for:
clamped to a retention horizon or a policy maximum, aligned outward to bucket
boundaries, truncated where the log begins. The rule the parent subject
states as contract, made mechanical here:

- The response carries the **effective window** — start, end, grain, zone —
  as first-class fields beside the points.
- Every downstream computation — axis labels, per-day averages, comparison
  denominators — uses the effective window, never the requested one. A
  per-day average divided by the *requested* day count is wrong every time a
  clamp fires, which is exactly when the user is least likely to notice.
- Clamping is **visible in the data shape**, not only in a field nobody
  reads: a request for 90 days answered with 30 should return 30 buckets,
  not 90 with fabricated leading zeros.

This is [a count carrying its
predicate](../../_laws.md#count-carries-predicate) applied to windows: a
series without its effective window is a number without what was counted.

## Zero-fill inside the window, never outside it

Storage engines return only buckets that contain rows; a series consumer
needs a dense axis. The fill step is where two different facts get conflated
if the code is careless:

- **Inside the effective window, absent buckets are real zeros** — the log
  was covering that interval and nothing happened. Fill them with zero (for
  counts and sums; rate-like metrics with an empty denominator fill with
  *no-value*, not zero — see
  [aggregate-honesty](aggregate-honesty.md)).
- **Outside the effective window there are no buckets at all.** Padding the
  requested-but-unserved range with zeros fabricates measurement; the series
  simply starts where coverage starts.

The fill is generated from the effective window and the grain — the same
boundary arithmetic as the fold, in the same zone. Two implementations of the
boundary walk (one in the fold, one in the fill) is the split-brain defect
from rule 2 waiting to happen; derive both from one function.

## Smells

- Bucket keys built by string-slicing timestamps in one place and by calendar
  truncation in another.
- A response whose first or last bucket is a different length than the rest,
  with nothing marking it.
- Any occurrence of 86,400 (or 3,600 × 24) in code that also claims to honor
  a timezone.
- An endpoint that accepts arbitrary ranges but has one hardcoded grain.
- A per-period average whose denominator is the requested period length.
