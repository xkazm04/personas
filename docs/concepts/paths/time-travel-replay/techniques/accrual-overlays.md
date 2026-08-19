---
layer: technique
subject: time-travel-replay
technique: accrual-overlays
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Accrual overlays

Every running total the live surface showed — cost, tokens, lines emitted,
steps completed, elapsed time — must **move with the replay clock**: the
value displayed at playhead position *t* is the fold of the record up to
*t*, nothing more. This is the technique that makes replay feel alive rather
than narrated, and it is also where replay most easily lies.

## Why finals-at-zero breaks the feature

Showing the settled totals from the first frame — the path of least
implementation resistance, since the totals are right there on the run row —
breaks both things replay is for:

- **The illusion**: a counter that already knows the ending announces that
  nothing on screen is live. Viewers notice instantly; the fiction dies in
  the first second.
- **The pedagogy**: the viewer came to see *what was known at each moment* —
  "we were already at 80% of budget before the retry loop started" is
  exactly the kind of insight replay exists to produce, and it is only
  visible if the counter climbs. The final total teaches nothing about
  trajectory; the trajectory is the lesson.

The same applies to every derived gauge: progress bars, budget-remaining
meters, rate displays ("tokens/min" over a trailing window of *replay*
time). Any figure computed from "the run so far" recomputes against the
playhead's "so far".

## Accruals are position functions, precomputed

The accrual at *t* is a pure function of playhead position — which means it
must be **O(1) to evaluate at any position**, or scrubbing (which samples
hundreds of positions per gesture) dies. The standard shape:

- at timeline build, compute **prefix sums** per accrued quantity: each
  timeline item carries the cumulative totals *as of itself*;
- the overlay at position *t* reads the prefix at the last item ≤ *t* —
  binary search, no folding at render time;
- backward seeks cost the same as forward ones, because position lookup has
  no direction. A counter implemented as "increment as events play" is
  wrong twice: it drifts when ticks drop events, and it cannot seek
  backward without replaying from zero.

Prefix data is a cached derivation and names its recomputation — a re-fold
of the record
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
— and is rebuilt whenever the timeline is re-derived.

## The reconciliation invariant

The accrual at *t = end* must equal the settled totals the record's rollups
report. This is not an implementation detail — it is a **cross-check between
two derivations of the same record** (the replay fold and the settled
rollup), and a mismatch means one of them is wrong: the rollup was computed
by a different rule, the timeline dropped records, or the run's stored total
was stamped by a producer the record never saw. The contract:

- **check it** — at timeline build, compare the final prefix against the
  settled totals;
- **surface it, never smooth it** — a discrepancy renders as a disclosure
  ("replay accounts for 96% of recorded cost"), not as a final-frame snap
  to the official number. Snapping hides the exact evidence that one of the
  two bookkeeping paths is broken, at the only spot where anyone would
  notice.

## Labels carry the accrual's predicate

An accruing figure travels — into screenshots, into a paused frame someone
quotes in a bug report. It carries what it is: "cost *so far*" at a stated
playhead time, visually distinct from the settled total the run's summary
shows ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
The unit vocabulary — what "cost" and "tokens" mean, which rates convert
them — is not replay's to define; it folds the same fields, in the same
units, that the product's metering discipline owns, so a number seen during
replay and the same number seen on the run's summary can never disagree
about meaning. When part of the record's quantities are estimates rather
than measurements, the accrual inherits the mix and says so at the moment
the first estimated record folds in — the estimate-labeling technique owns
that disclosure.
