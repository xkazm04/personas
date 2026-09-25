---
layer: golden-path
subject: metric-gates
status: forged
techniques:
  - ratchet-design
evidence:
  - scripts/census/rules.json                       # the committed baselines: per-rule `files`/`matches` numbers living in a diffable, reviewed file rather than a dashboard
  - scripts/census/run-census.mjs                   # the ratchet itself: exit 1 on a rise AND on a silent drop; baselines change only under a deliberate --update that lands in the diff
  - package.json                                    # `census:check` / `census -- --update` — the gate and the re-baseline, kept as two separate commands on purpose
---

# Metric gates

A predicate gate asks a question the codebase answers yes or no: is this
rule violated, does this contract hold, does this artifact parse. A **metric
gate** asks *how much*, and renders its verdict by comparing that answer to a
number someone recorded earlier. Everything that makes a predicate gate
trustworthy — which rung it runs on, what severity it carries by
construction, whether it can be proven alive — still applies, and is owned
next door in [quality gates](../quality-gates/quality-gates.md). What this
subject owns is the pair of problems that appear only once the verdict is a
comparison between two numbers: **where the recorded number came from**, and
**whether the measured number still means what it meant when the number was
recorded**.

## Where this subject starts and stops

The hinge is the shape of the verdict, not the subject matter. A check that
blocks because a forbidden construct appeared belongs to quality gates, even
if it also prints a count. A check that blocks because a count moved in the
wrong direction relative to a recorded value belongs here, even if the thing
being counted is the same construct. The distinction is worth keeping
because the two carry different failure modes: a predicate gate fails by
misjudging an input, a metric gate fails by comparing against a number whose
provenance nobody can reconstruct, or by comparing two measurements taken
with instruments that were not the same instrument.

## Monotonic improvement as a gate

Most quality metrics in a living codebase cannot be zeroed today — hundreds
of legacy violations, a bundle that grew for two years, a warning class with
deep roots. The wrong responses are the common ones: block on zero (instant
bypass culture) or track it on a dashboard (numbers that only ever go up).
The senior structure is the **ratchet**: record the current value as an
explicit, committed baseline, and gate on direction — the metric may fall,
never rise.

A correct ratchet fails in **both** directions. Fail on rise, obviously.
But also fail — or at minimum refuse silence — when the measured value drops
below the baseline without a baseline update, because an unexplained
improvement has two explanations and the likelier one is that **the
measurement broke**. A counter that walked zero files reports zero
violations; celebrating that number buries the instrument failure inside
good news ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
Improvements are welcomed by re-baselining as a deliberate, reviewed diff —
the baseline file is the metric's audit log. Baseline mechanics, bucketing,
and the endgame (a ratchet that reaches zero graduates into a hard ban) are
[ratchet-design](techniques/ratchet-design.md).

## A recorded number carries the conditions it was recorded under

A baseline is not just a value; it is a value plus the predicate that
produced it plus the population it was measured over
([count-carries-predicate](../_laws.md#count-carries-predicate)). Drop any
of the three and the comparison quietly stops being a comparison: the
counter is widened to a new directory and every rule appears to regress; an
exclusion is added and every rule appears to improve; the rule's pattern is
tightened and the baseline now describes a measurement nobody can take
again. The discipline is that **a baseline and its counter change
together, in one reviewed diff**, and that a baseline whose counter has
changed is re-derived rather than carried forward
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).

The practical consequence is that re-baselining is a first-class,
deliberate operation with its own command and its own diff — never a side
effect of running the gate. A gate that silently rewrites the number it is
about to compare against passes by construction, forever, and reads as
green the whole time.

## The techniques

- [ratchet-design](techniques/ratchet-design.md) — committed baselines,
  fail-on-rise and fail-on-silent-drop, reviewed re-baselining, and
  graduating to a ban.
