---
layer: technique
subject: wizard-flows
technique: step-state-model
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse, one-validation-door]
shared_with: []
---

# Step state model

Everything a wizard promises — go back freely, jump by indicator, resume
after interruption, validate the whole before commit — is downstream of one
decision: **all step state lives in one owned model, and steps are views
over it**. Get this right and the rest of the subject is assembly; get it
wrong and every feature above is a special case fighting the architecture.

## The model

One reducer or state machine owns four things:

- **Answers** — every value collected so far, keyed by a stable name, in
  canonical (typed, parsed) form. The parse/format boundary from the form
  standard applies per field; the model stores what the system means, not
  what the user typed.
- **Position** — the current step, as an identifier.
- **Visited set** — which steps the user has actually been shown. Visited is
  not valid and valid is not visited: a prefilled step can be valid and
  unvisited; a step the user rushed past can be visited and invalid. Flows
  that collapse the two either block prefilled users pointlessly or let
  unseen defaults ride into the commit.
- **In-flight status** — whether the flow is idle, validating, running a
  step's long operation, or committing. Navigation availability derives
  from this too; "next" during an in-flight step operation is a policy
  decision the model makes once, not something each screen improvises.

Steps render from the model and dispatch **events** — answer changed, next
requested, jump requested, step's async work completed — rather than poking
setters. The event vocabulary is small and closed, which is what makes
keyboard advancement, deep links, programmatic resume, and tests all drive
the flow through the same door instead of each growing a private side
channel.

## Steps are declared, not discovered

The flow's structure lives in a **step registry**: one ordered declaration
listing each step's identifier, title, relevance predicate (for branching),
and validity predicate. Every consumer — the navigation guards, the
progress indicator, the commit assembler — derives from this registry
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The alternative is the drift trap: a step order encoded once in the
renderer's switch, again in the indicator's label list, again in the
"can continue" checks — three copies that disagree the first time a step is
inserted.

Two consequences of the registry being data:

- **Step identity is a name, not an index**
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
  Branching inserts and removes steps; anything keyed by position — the
  visited set, the answers, the "furthest reached" marker — corrupts the
  moment the path reshapes. Indices are a rendering concern, computed at
  display time from the currently-relevant sequence.
- **Order is a property of the registry**, so reordering steps is an edit
  to one list, not an archaeology project.

A cross-codebase observation worth its weight: teams repeatedly *decline*
to extract a universal wizard component, and the ones that try produce a
primitive shaped like their first wizard that no second wizard can use.
What actually recurs across independent codebases is not a component but
this **shape** — steps declared as data, one engine walking them, guards
inside the transitions. Reuse the shape; be suspicious of the widget.

## Validity is a predicate, not a flag

Each step's validity is **computed from the answers on demand**, through the
same predicate everywhere
([one-validation-door](../../_laws.md#one-validation-door)). The
anti-pattern is the exit-stamp: a screen validates itself on "next" and
writes `stepThreeValid = true` into the model. That flag is stale the
moment any earlier answer it depended on changes — and in a wizard, earlier
answers changing is a supported operation, not an anomaly. The stamp turns
"go back and fix something" into "go back, fix something, and silently
invalidate a flag nobody will recompute".

Derived from the same predicates, in one place:

- **canAdvance(current)** — the current step's validity gates "next".
- **canJumpTo(step)** — typically: every relevant step before it is valid,
  or it has been visited before. Whatever the policy, it is *one function*;
  the indicator's clickability and the keyboard shortcut's guard call the
  same one.
- **canCommit** — every relevant step valid. The commit button and the
  review step's readiness banner agree because they cannot disagree.

**The guard is written twice, because the two copies guarantee different
things.** The control's disabled state is the *courtesy* copy — it tells
the user before they click. The precondition check *inside the transition
itself* — the event handler that returns the model unchanged when the
guard fails — is the *guarantee*: it is the only copy that also covers the
step rail, the keyboard shortcut, the deep link, the restore path, and
every trigger added next quarter. Independent implementations converge on
writing both, and the convergence is physics, not style: a disabled
attribute guards one control; a guarded transition guards the transition.
A wizard whose only guard is a disabled button is unguarded from every
direction but one.

## What may stay local

Presentation transients only: which accordion is open, scroll position,
an animation's direction. The test is brutal and easy to apply — **if losing
it on unmount would lose anything the user said, or anything resume needs,
it goes in the model.** When in doubt it goes in the model; the cost of an
over-large model is aesthetic, the cost of an under-large one is user data.

## Long operations belong to steps, run in the model

Some steps trigger real work — a generation, an import, an analysis — whose
result later steps consume. The work's lifecycle (requested, running,
succeeded with result, failed with reason) is state *in the model*, keyed to
the step, so that navigating away and back does not re-trigger it, the
progress surface can represent it, and the snapshot can carry its identity
for re-attachment (see
[snapshot-and-resume](snapshot-and-resume.md)). A step that fires work from
its own screen-local effect re-runs it on every revisit — the interruption
tax applied to the system's most expensive operations.
