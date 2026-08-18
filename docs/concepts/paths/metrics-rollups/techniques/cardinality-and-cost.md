---
layer: technique
subject: metrics-rollups
technique: cardinality-and-cost
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Cardinality and cost

The cost model most engineers carry into aggregation — "more events, more
expensive" — points at the wrong axis. Storage engines fold rows cheaply and
sequentially; what they cannot compress is the **output**: one result row per
distinct group key per bucket. The cost of an aggregation surface is

> distinct keys × buckets per key × bytes per point,

and of the three factors, only key cardinality is unbounded. Time is bounded
by the window; the schema bounds the bytes; but the key space — tenant,
label, error string, endpoint, model name — grows with usage and grows
**adversarially**: the busiest customer, the integration that interpolates an
id into a label, the retry loop that mints a new key per attempt. An
aggregation endpoint with no cardinality bound is an endpoint whose worst
case is decided by whoever writes the weirdest events into the log.

## Every grouped read ships with a bound

The bound is not an optimization to add when a page gets slow; it is part of
the endpoint's contract from the first version, because retrofitting one
changes answers consumers already rely on.

- **Top-N with an overflow bucket.** The endpoint returns the N largest keys
  by a declared ranking measure, plus one synthetic remainder aggregating
  everything else. The remainder is what keeps the result *composable*: rows
  still sum to the total, so a consumer that adds them up (they always do)
  gets the right number. Top-N without a remainder silently underreports
  every total derived from it.
- **Truncation is disclosed, not inferred.** The result says that it
  truncated, at what N, ranked by what measure, and how many keys the
  remainder absorbed. A truncated list indistinguishable from a complete one
  violates [count-carries-predicate](../../_laws.md#count-carries-predicate)
  at the list level — the predicate of "these are the keys" is really "these
  are the top 20 of 3,407 by volume", and the consumer must be able to tell.
- **Ranking is chosen, and chosen once.** Top-N by count, by cost, and by
  recency are three different lists. The measure is part of the request
  contract, and the same measure ranks the drill-down that follows — a list
  ranked one way whose detail view ranks another reads as data corruption to
  the user.
- **Per-key series get a series budget.** A "series per key" surface
  multiplies both axes; N keys × B buckets explodes politely. The budget
  covers the product, not each axis separately — fewer keys at fine grain,
  or more keys at coarse grain, per
  [bucketing-strategy](bucketing-strategy.md)'s output-budget rule.

## Bound the fold, not just the response

Truncating *after* folding the full key space protects the payload but not
the engine — the group table still materialized every key. For the hostile
tail (thousands of distinct keys), the fold itself is staged: aggregate
totals per key first (one row per key — cheap), rank, select the top N, and
only then compute the expensive per-bucket series for the selected keys.
Two passes over cheap shapes beat one pass that materializes an unbounded
intermediate.

## Pre-aggregation is the structural bound

The bounds above cap a single read. The structural fix caps the *space reads
happen in*: roll up along the dimensions the product actually breaks down by
([stored-rollups](stored-rollups.md)), so grouped queries read one row per
(bucket, key) instead of re-deriving keys from raw events every time. Two
disciplines keep pre-aggregation from importing the problem it solves:

- **Rolled dimensions are enumerated, not open.** A rollup keyed by a
  free-text field inherits that field's unbounded cardinality in *storage* —
  permanent, and growing nightly. Dimensions worth rolling are the ones with
  a bounded, product-meaningful key space; unbounded ones get normalized
  first (bucketed, canonicalized, mapped through a registry) or stay
  query-time-only with the read bounds above.
- **The rollup's own row count is a watched number.** rows ≈ buckets ×
  ∏(dimension cardinalities); adding one innocent dimension multiplies it.
  The growth rate is reviewed when a dimension is added, not discovered when
  the rollup outweighs the log it summarizes.

## Degrade by declared policy, not by timeout

When a request's honest cost exceeds the budget — a year at hourly grain
across all keys — the endpoint has three honest answers: **coarsen** (serve
daily, disclose the grain served, per the effective-window echo), **truncate**
(serve top-N, disclose), or **refuse** (a stated limit with the workable
alternatives named). The dishonest answers are the defaults: time out, or
silently serve whatever finished. Degradation chosen by policy is a contract;
degradation chosen by the timeout race is a different answer every time the
load shifts.

## Smells

- A group-by whose key is any user-supplied string, unbounded.
- A breakdown whose rows sum to less than the summary total, with nothing
  disclosing the difference (truncation without a remainder).
- A per-key chart that renders 400 legend entries — no series budget, and
  the display layer is absorbing an aggregation failure.
- A rollup table growing faster than its source log.
- Latency on the aggregation endpoint tracking a specific tenant's traffic
  shape — cardinality has become someone's feature.
