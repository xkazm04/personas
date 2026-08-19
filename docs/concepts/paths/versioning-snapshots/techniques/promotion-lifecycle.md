---
layer: technique
subject: versioning-snapshots
technique: promotion-lifecycle
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Promotion lifecycle

In any system where versions *run* — a prompt that serves traffic, a
configuration that executes, a pipeline that ships — one question
dominates all others: **which version is live right now, and why is it
allowed to be?** The promotion lifecycle is the declared answer. Without
it, "live" is decided by accident: the highest number wins, or the most
recently saved, or whichever a caller cached — and the team discovers
during an incident that three subsystems disagree about which version is
active.

## The states are declared, and there is one pointer

A minimal honest lifecycle has three states: **experimental** (exists,
may be run in trials, serves nothing by default), **active** (the one the
runtime uses), **retired** (superseded; kept for history and rollback).
Richer sets — candidate, canary, deprecated — are fine when the product
needs them; what is not fine is an undeclared set, where state is
inferred from tags, timestamps, or tribal knowledge, each consumer
inferring differently
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).

Two structural rules make the states trustworthy:

- **One active pointer per entity (per environment).** "Active" is a
  single authoritative reference the runtime reads — a column on the
  entity, not a flag scattered across version rows where two rows can
  both claim it. Activation and deactivation are one atomic swap.
- **Creation is not promotion.** Saving a new version never implicitly
  activates it. "Latest" and "active" are different concepts, and every
  system that fuses them eventually ships an experiment to production by
  pressing save. The promotion is its own act, separately authorized,
  separately logged.

This lifecycle governs the *version record*; whether the entity itself is
draft, live, or archived is the entity-lifecycle subject's state machine.
Keep them in separate fields — an active version of an archived entity is
a coherent (and common) state, and a fused column cannot express it.

## Promotion has criteria, and the criteria are written down

"Experimental → active" is a gate, and a gate must see its target
([gate-sees-target](../../_laws.md#gate-sees-target)): the promotion
decision observes evidence *about the candidate version itself* — trial
runs of that exact snapshot, measurements pinned to its id, a human
approval naming it — not proxies ("the edits looked small", "it worked in
the author's session", which observed the live entity, not the version).
The criteria worth writing down:

- **Measured against the incumbent** on the comparisons the product
  cares about — the measurement machinery is the eval-harness subject's
  ground; promotion consumes its verdicts and records which verdict
  justified the act.
- **Accountable approval** where the version's blast radius warrants a
  human in the loop; the promotion record carries who and when.
- **A trial period** where feasible: promoted-but-watched, with the
  incumbent held ready.

A promotion *proposal* — machine-suggested, human-ratified — is the
natural shape when automation generates candidate versions faster than
humans review them: the system nominates with evidence attached, and the
lifecycle state only changes through the ratification act.

## Demotion is the same lifecycle, backwards, and it is pre-wired

The rollback story is where promotion lifecycles earn their keep.
Because retirement is a state (not deletion), the previous active
version is sitting one atomic pointer-swap away — which makes rollback
cheap enough to automate: a regression detector that observes the
newly-active version's live behavior and, on breach, swaps the pointer
back and records why. The detection-and-decision machinery is the
self-healing subject's ground (its auto-rollback technique); this
lifecycle's obligation is to make that machinery *possible*: the
incumbent retained, the swap atomic, the demotion recorded as a
first-class lifecycle event with the triggering evidence attached — not
as a silent re-save of old content, which would strand the history with
a rollback nobody can later see happened.

## Prohibitions

1. No undeclared state set — the lifecycle's states and transitions are
   enumerated in one authoritative place.
2. No "active = highest version number" — activation is an explicit act
   on an explicit pointer.
3. No implicit promotion on save.
4. No two rows simultaneously active for one entity in one environment.
5. No promotion without recorded evidence and (where required) recorded
   approver.
6. No demotion by content re-save — rollback is a lifecycle event that
   names its trigger.
7. No fusing the version lifecycle with the entity's own lifecycle
   state.
