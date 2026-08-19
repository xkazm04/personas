---
layer: technique
subject: scoring-rubrics
technique: weight-design
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation]
shared_with: []
---

# Weight design

A weight is not arithmetic — it is a **policy statement**: "this dimension
matters twice as much as that one, toward this decision." Policy statements
need what all policy needs: an owner, a rationale, and a change history. The
weight vector is therefore a first-class, checked-in artifact — a named
structure a reviewer can read in one screen — never a scatter of magic
numbers inlined where the multiplication happens.

## The vector is explicit and it sums to a stated total

Two structural rules, both trivially checkable and both routinely violated:

- **One vector, one place.** All weights for a rubric live in a single
  declaration, adjacent to each other, so their *relative* sizes — which is
  all a weight is — can be read at a glance. Weights spread across the code
  that consumes them cannot be compared, which means they cannot be
  reviewed, which means they are not policy, just residue. This is
  [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
  applied to importance: the rubric's dimension set and its weights are a
  closed vocabulary with exactly one authoritative definition.
- **The sum is stated and asserted.** Whether the convention is "weights sum
  to one" or "weights sum to one hundred", the total is declared and a test
  (or a startup assertion) enforces it. Without the invariant, adding a
  dimension quietly deflates every other dimension's influence — or worse,
  inflates the maximum attainable score so historical values stop being
  comparable. With it, adding a dimension forces the conversation the sum
  exists to force: *what does the new one displace?* Importance is a budget;
  a rubric that only ever adds weight is claiming everything matters more,
  which is the same as nothing mattering.

## Every weight carries its rationale

Beside each weight, one line: why this magnitude, relative to its neighbors.
Not an essay — a sentence that lets the next maintainer distinguish "chosen
deliberately after the incident where X" from "seemed fine at the time". The
rationale is the difference between a weight vector a reviewer can challenge
("is dimension A really worth three times B?") and one they can only accept.
Vectors without rationales converge on the committee failure mode: every
dimension drifts toward the same middling weight because nobody can defend a
difference, and a rubric where everything weighs the same is an unweighted
average that spent complexity pretending otherwise.

## Weight changes are versioned events

Changing a weight re-scores the world. Every stored historical score, every
trend line, every threshold crossing was computed under the old vector; the
day after the change, a rising trend may be an artifact of the rubric, not
the subject. So:

- The rubric carries a **version identifier**, and it changes when the
  weights (or dimensions, or normalization anchors) change.
- A stored score stores the rubric version it was computed under — a stored
  derivation names its recomputation
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)),
  and for a composite the rubric version *is* the recomputation's name.
- Surfaces that draw history across a version boundary either recompute the
  old inputs under the new rubric (when inputs are retained) or mark the
  boundary visibly (when they are not). Splicing two rubrics into one
  unmarked line fabricates a trend.

## Sensitivity: know whether the weights matter

Before shipping a vector, perturb it: move each weight a modest fraction and
observe whether the *ranking* the score exists to produce actually changes.
Two findings are common and both are informative. If rankings are insensitive
to any plausible perturbation, the weights are ceremony — the dimension
values dominate, and the honest move is simpler weights (or none) plus the
saved argument time. If a small perturbation reshuffles the top of the
ranking, the score is a knife-edge instrument and its consumers should see
bands ("strong / adequate / weak"), not a false-precision two-decimal number.
Banding thresholds are part of the vector artifact and version with it.

## Per-cohort targets are weights in disguise

A rubric that applies different expectations to different classes of subject
— stricter thresholds for one archetype, relaxed for another — is maintaining
several weight vectors, and every rule above applies to each: explicit,
summed, rationalized, versioned. The common defect is a lovingly governed
default vector with per-cohort overrides scattered as inline exceptions;
overrides are policy too, and they live in the same artifact, same format,
same review path as the defaults they shadow.
