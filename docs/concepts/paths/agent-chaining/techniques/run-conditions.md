---
layer: technique
subject: agent-chaining
technique: run-conditions
status: forged
laws:
  - failure-not-empty-success
  - one-validation-door
  - one-authority-per-vocabulary
shared_with: []
---

# Run conditions

An arrow rarely means "always." The user drawing it means one of a small
set of things, and the system's job is to make that set explicit, closed,
and honestly evaluated — because a condition that misfires does not look
like an error; it looks like the product deciding on its own which agents
run.

## The trigger modes are a closed vocabulary

Every edge declares when it is even *considered*, from a closed set
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):

- **On success** — the default arrow: continue when upstream completed
  cleanly.
- **On failure** — the escalation arrow: route to a handler, a notifier, a
  fallback agent. This mode is what makes failure a *first-class routing
  outcome* instead of a dead end; a chaining system without it forces
  users to encode error handling inside agents, where it is invisible to
  the graph.
- **Always** — the audit arrow: fires on either outcome, for logging,
  summarizing, cleanup.

The mode is evaluated against the upstream link's *terminal status*, which
means the chaining layer needs an honest status from the execution layer —
a link that crashed, timed out, or was cancelled must not present as
success to the edge evaluator. Distinguishing cancelled from failed is
worth the extra vocabulary entry: an operator who stops a run usually does
*not* want the on-failure escalation chain to fire on their own
cancellation.

## Output predicates route, on top of trigger modes

The second layer is content routing: an edge that fires only when the
upstream output satisfies a predicate — a path expression into the output
document, an operator from a closed set, a comparison value. The full
discipline for predicates-as-data is owned by
[pipeline conditional edges](../../pipeline-dag/techniques/conditional-edges.md)
and transfers wholesale: conditions are declarative structures, not code;
one evaluator interprets them for every consumer
([one-validation-door](../../_laws.md#one-validation-door) applied to
meaning); comparisons are type-honest.

The two layers compose in a fixed order: trigger mode first (is this edge
in play for this outcome at all?), predicate second (does the content
route here?). Keeping them separate in the model — rather than encoding
"on failure" as a predicate over a status field — keeps the common cases
declarative and renderable, and reserves predicate machinery for the case
that needs it.

## Unevaluable is a stop, never a guess

The lesson [pipeline conditional edges](../../pipeline-dag/techniques/conditional-edges.md)
paid for transfers here with *higher* stakes. When a predicate cannot be
evaluated — the referenced field is absent, types do not compare, the
output that was supposed to be structured came back as prose — there are
three honest outcomes (fired / not fired / unevaluable) and two tempting
lies. Fail-closed-silently converts a typo into "the next agent never
runs," discovered weeks later by absence. **Fail-open is strictly worse
here than in an orchestrated pipeline**: the pipeline's fail-open runs a
node inside a bounded, supervised run; a chain's fail-open *starts an
autonomous agent* — new execution, new cost, possibly new outgoing
handoffs — on the strength of a predicate that never actually evaluated.
An unevaluable condition on a chain edge is an edge that did not fire,
**plus a recorded evaluation error, plus a typed stop reason if no other
edge fired** ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The chain stops loudly, and the stop record carries what the evaluator saw:
the expression, the operator, and the actual value (or its absence) it
choked on.

## Evaluation reads the recorded output, once

The evaluator reads the upstream link's *persisted* output — the same
artifact the handoff envelope forwards — never a live re-derivation, and
never the model's streaming channel. Predicate evaluation happens at the
handoff decision point, alongside the depth guard (cycle-and-depth-guards,
this subject), so a single pass over a completed link answers: which edges
are in play (trigger mode), which route (predicate), which are blocked
(guards), and — if the answer is none — which typed stop reason to write.
One decision point, one record, one place to look.

## Decision rules

- Trigger modes are a closed enum; adding one is a schema change, not a
  string.
- Predicates are data with one evaluator shared by execution and preview;
  the pipeline discipline applies unchanged.
- Unevaluable never impersonates a verdict; on a chain edge it is
  fail-closed *and loud* — evaluation error recorded, stop reason typed.
- Mode before predicate, always; a status test is a mode, not a predicate.
- Every evaluation that gated a real handoff persists its verdict and
  operands with the chain record — routing decisions are part of the
  chain's history, not transient control flow.
