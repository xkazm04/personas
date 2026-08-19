---
layer: technique
subject: scoring-rubrics
technique: gap-ranking
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Gap ranking

The score exists to rank actions, so the terminal artifact of a rubric run
is rarely the number — it is the **ordered list of gaps**: for each
dimension below its target, what closing it would buy and what closing it
would cost, sorted so the top row is the next thing to do. A composite
without a gap list tells the reader they are at 61 and leaves them to
reverse-engineer the rubric to find out why; the gap list is the rubric
doing its own job.

## A gap is a computed object, not a sentence

Each gap carries, explicitly: the dimension; the measured value and the
target it missed; the **impact** (how much composite improvement closing it
yields — which is the distance-to-target *times the dimension's weight*, in
post-normalization space, so a small shortfall on a heavy dimension can
outrank a chasm on a light one); the **effort** (an estimate of the cost to
close, even a coarse ordinal one); and the derived priority. Computing
impact in rubric space rather than raw space is the point of having a
rubric — it is what makes gaps in milliseconds comparable with gaps in
percentages.

## Impact per effort, then severity — the ordering is the recommendation

Ranking by impact alone recommends the biggest mountain; ranking by effort
alone recommends busywork. The default ordering is **impact per unit
effort** — the steepest available improvement slope. Even a three-level
effort ordinal (small / medium / large) captures most of the value; the
precision of the effort estimate matters far less than its existence,
because the alternative is an implicit "all efforts are equal", which is
the one estimate known to be wrong.

Two legitimate overrides sit above the quotient, in declared order:

- **Severity**: a dimension can be marked as blocking below a stated
  threshold — a floor violation outranks any quotient, because some gaps
  are not trade-offs, they are stop conditions.
- **Prerequisite structure**: when dimensions have a dependency order
  (foundations before refinements), the tie-break — and sometimes the
  whole ordering within a band — leans toward the foundational end, so the
  recommended sequence is *buildable*, not just individually attractive.

Whatever the policy, it is declared in the rubric artifact and versioned
with it: the ordering is policy exactly as weights are.

## Determinism: a re-run must not reshuffle

The gap list is consumed as a work queue, and a queue that reshuffles on
every recomputation destroys the trust the ranking exists to create —
yesterday's #1 becoming today's #4 with no input change reads as the
instrument churning, and readers respond by ignoring it. Two rules:

- **Total, stable ordering.** Quotients tie, floats compare within noise,
  and sort implementations disagree on equal keys. The comparator ends in
  a deterministic chain that cannot tie: after priority, severity, and
  declared structure, the final key is the dimension's **stable identity**
  — its permanent id, not its display name, list position, or insertion
  order ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
  Same inputs, same list, byte for byte.
- **Hysteresis at the boundaries** when inputs jitter. If measured values
  wobble within noise, near-equal priorities swap on every run even with a
  stable comparator. Where the list drives standing work rather than a
  one-shot report, quantize priorities into bands (and order stably within
  a band) so re-ranking happens on real movement, not on noise.

## The top gap is named as an action

The final rendering duty (shared with score-explanation): the first row of
the list is phrased as the *next action* — "close X: worth +7 for small
effort" — not as a scored observation. A ranked list of nouns still makes
the reader do the last translation; the rubric knows the verb, because the
target, the distance, and the weight are all its own artifacts. If the
rubric cannot phrase the top gap as an action, that dimension's target was
never actionable — which is a finding about the rubric, and a reason to
revisit the dimension, not to ship the noun.
