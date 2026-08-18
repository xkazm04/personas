---
layer: technique
subject: pipeline-dag
technique: conditional-edges
status: forged
laws:
  - failure-not-empty-success
  - count-carries-predicate
  - one-validation-door
shared_with: []
---

# Conditional edges

Branching is where a pipeline stops being a checklist and becomes a program —
and where the user's mental model and the engine's behavior most often part
ways. The technique's core commitment: **conditions are data, not code**, and
one evaluator interprets them with failure semantics honest enough that a
branch which didn't fire can always explain itself.

## Conditions are data

An edge condition is a declarative structure — a field reference into the
source node's output, an operator from a closed vocabulary (equals, contains,
greater-than, exists, matches…), and a comparison value; compound conditions
compose these with explicit and/or, not string concatenation. Storing
predicates as data rather than as user-supplied executable code buys four
properties at once: they can be **validated** at the door (parse, known
operator — see [graph-validation](graph-validation.md)); **rendered** back to
the user as the same structure they authored; **evaluated** without an
embedded interpreter's attack surface; and **recorded** — the branch decision
can log exactly what was compared. If a full expression language is ever
warranted, it is a sandboxed, resource-bounded interpreter behind the same
evaluator interface — an escalation to be resisted until real predicates
demand it, because every power added to the language is subtracted from
static analysis.

## One evaluator

Exactly one component evaluates conditions, and every consumer — the dispatch
loop deciding readiness, the preview surface showing "this branch would
fire", the test harness — calls it ([one-validation-door](../../_laws.md#one-validation-door)
applied to interpretation: one door through which meaning is assigned). Two
evaluators are two dialects; they agree until the first nested-field access
or type coercion difference, and then the preview lies about what the run
will do — the most trust-destroying bug a branching UI can have.

## Unevaluable is not false

Evaluation has **three** outcomes, not two: *fired*, *not fired*, and
*unevaluable* — the referenced field is absent, the types don't compare, the
predicate is malformed despite the door (data drifted since authoring). The
degenerate design collapses unevaluable into false, and it is worth being
precise about why that is catastrophic rather than merely sloppy: a typo in a
field name silently converts "route on the result" into "never take this
branch", the run completes green, and the miss is discovered by absence —
weeks later, as "the notification step never seems to happen"
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

The collapse has a second pole, equally observed in the wild and equally
wrong: **fail-open**, where a malformed predicate or unknown operator is
treated as *fired* "so bad configuration doesn't break the pipeline". Now the
typo runs the branch the condition existed to gate — side effects included —
and the run again completes green. Collapsing unevaluable into *either*
verdict is the same defect; the two poles just choose which lie to tell.

Unevaluable resolves by declared policy, per edge or per graph: **halt** the
downstream join with an evaluation error (the conservative default — wrong
routing is usually worse than no routing), or **route to an explicit error
branch** if the graph authors one. What it never does is impersonate a
legitimate verdict, in either direction.

## The branch record

Every evaluation persists its outcome alongside the run: edge, verdict
(fired / not-fired / unevaluable), and *what the predicate saw* — the actual
left-hand value at evaluation time, the operator, the expected value
([count-carries-predicate](../../_laws.md#count-carries-predicate): a branch
decision without its operands is a verdict with no evidence). This record is
what makes the post-run question "why did it go left?" answerable from data
instead of from re-running with a debugger. It also powers the visibility
surface: on the run's rendering of the graph, taken edges, rejected edges,
and unevaluable edges are visually distinct — a user staring at their own
graph should see the run's control flow *on* the topology, not reconstruct
it from logs.

## Branch semantics at the join

Conditionals interact with joins, and the interactions are where engines
disagree with their users:

- **Skip propagation.** A node whose every incoming edge either did not fire
  or descends from a skipped node is itself skipped — transitively, without
  executing, and recorded as branch-not-taken, never as failure. The
  not-taken subtree settling (as skipped) rather than dangling is what lets
  downstream joins resolve at all. The subtle hazard when propagation is
  missing: engines commonly give a node with no upstream output a *fallback*
  input (the run's global input), so a descendant of a gated-off branch does
  not fail visibly — it **runs anyway on the wrong input**, produces
  plausible output, and threads it downstream as if the branch had fired.
  Skip propagation exists to make "my inputs were gated off" mean *skip*,
  never *improvise*.
- **Join mode is explicit.** A node fed by multiple conditional edges
  declares whether it runs when *any* incoming edge fires or only when *all*
  do. Defaulting silently to either is a coin flip over user intent; the
  authoring surface should make the mode visible at every join.
- **Mutual exclusivity is not assumed.** Two conditions on sibling edges can
  both fire; both branches then run (that is fan-out, and it is legal). If
  the user means if/else, the graph needs an explicit else edge — one that
  fires exactly when its siblings all resolved as not-fired. Providing
  else/default as a first-class edge kind is cheap and removes the most
  common authoring trap: a value falling through every condition and the
  run just… ending, with nothing to show why.

## Decision rules

- Closed operator vocabulary; adding an operator is a schema change that
  updates the one evaluator and the one validator together.
- Comparisons are type-honest: comparing a number to a string is
  unevaluable, not a lexicographic surprise. Coercions, if offered, are
  enumerated and documented, never inherited from a host language's equality
  table.
- Condition evaluation is pure: read the recorded upstream outputs, produce
  a verdict, touch nothing. An evaluator with side effects makes preview
  unsafe by definition.
- Evaluate at readiness time, from persisted outputs — never earlier
  (against data that might still change) and never from live re-computation
  (which can disagree with what the producing node recorded).
