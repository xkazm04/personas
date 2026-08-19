---
layer: technique
subject: scoring-rubrics
technique: rubric-stability
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Rubric stability

The moment a score is stored, compared over time, shown to more than one
person, or computed in more than one place, the rubric stops being an
implementation detail and becomes an **interface** — and interfaces are
pinned, or they drift. Rubric drift is nastier than most interface drift
because the output stays a plausible number: nothing crashes, no consumer
breaks, the rankings just quietly stop meaning what everyone believes they
mean.

## Golden fixtures: the rubric's own examples, hand-verified

The foundation is a small set of **golden fixtures**: complete input
vectors with the expected composite, per-dimension breakdown, and gap
ordering — each verified by a person once, then enforced by a test forever.
Fixtures are chosen adversarially, one per honesty rule the rubric claims:
the all-measured happy path; the partially measured entity (renormalization
and coverage disclosure); the below-coverage-floor entity (refusal to
score); the inverted-polarity dimension at both extremes; values beyond the
clamp anchors; the tie that exercises the deterministic tie-break; the
cohort edge (single-member cohort, all-identical cohort) if normalization
is cohort-relative. A rubric with only happy-path fixtures is pinned only
where it was never going to break.

Assert on the **full explanation object** — breakdown, coverage, gap order
— not just the final scalar. Two wrongs multiplying into a right scalar is
a real and observed failure shape; the breakdown is where compensating
errors become visible.

## Twin implementations get a parity gate, not good intentions

When two runtimes must both compute the rubric — one aggregating and
persisting, one previewing interactively — the duplication is a standing
liability that comments cannot discharge. "Keep in sync with the other
side" is a wish; the same golden fixtures, executed against **both**
implementations with outputs compared to agreed precision, is a gate. The
gate must actually run both twins on the shared fixtures
([gate-sees-target](../../_laws.md#gate-sees-target)): a test suite that
exercises each twin separately against its own expectations verifies two
rubrics exist, not that one rubric exists twice. Fixtures live in a
neutral, both-sides-readable format, and the parity check runs wherever
either twin can change. Where the platform allows it, the stronger move is
to delete the twin — one implementation, one caller importing it — and the
parity gate is the honest fallback where it does not.
Same-language re-derivations count as twins too: a summary tile, an export,
and a detail view each re-implementing the composite are three twins with
no gate — the rubric is one authority
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)),
and every surface derives from it.

## Version the rubric; stamp the scores

Every material change — a weight, a dimension added or retired, a
normalization anchor, a curve, the coverage floor, the tie-break — bumps a
**rubric version**, and every stored score carries the version that
produced it. This is what keeps history interpretable: a trend line that
crosses a version boundary either recomputes the old inputs under the new
rubric (when raw inputs are retained — the strongly preferred posture,
since stored composites are cheap to re-derive but raw inputs are
irrecoverable) or renders the boundary visibly. An unmarked splice
manufactures a step change that will be investigated as if it were real —
or worse, celebrated.

Version the *artifact*, not the deployment: the version lives beside the
weights in the rubric declaration, so no change to the declaration can
ship without touching the line a reviewer reads.

## Changes are re-baselined deliberately

A rubric change is a policy release, not a refactor. The minimum ritual:
run the new rubric against the current cohort **before** merging and read
the diff in *rankings*, not scores — who moves up, who moves down, does the
recommended next action change for anyone. If the reshuffle is intended,
that diff is the change's review evidence; if it is surprising, the change
was not understood. Fixtures are then re-verified by a person (they encode
the old policy by construction — a fixture update without a human read is
the pinning test approving its own change), and the version bump, the
ranking diff, and the rationale travel together in the change record.
