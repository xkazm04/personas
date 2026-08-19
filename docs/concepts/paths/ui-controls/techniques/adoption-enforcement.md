---
layer: technique
subject: ui-controls
technique: adoption-enforcement
status: forged
laws:
  - gate-sees-target
  - count-carries-predicate
  - failure-not-empty-success
shared_with: []
---

# Adoption enforcement

Discovery routes the willing; this technique handles everything else. Its
premise is measured, not moralized: in a codebase with no enforcement
loop, the shadow copies **outnumber the adopters** — a field primitive
with four consumers and nineteen hand-rolled look-alikes is a normal
outcome, not an anomaly. Enforcement is a loop with four parts: detect the
shadows, nudge at authoring time, gate what must hold, and ratchet the
backlog down without a big-bang migration.

## Detect by signature, not by name

A shadow copy never calls itself one. Detectors that key on the
primitive's name or its typical markup find nothing; the reliable anchor
is the **temptation signature** — the low-level act the primitive exists
to wrap:

- the raw clipboard call, not "components named like CopyButton";
- the full-viewport fixed backdrop, not "elements with a dialog role"
  (hand-rolled modals are precisely the ones that never set the role);
- the checkbox styled as a switch, the native title attribute, the
  hand-built spinner branch.

Every detector is validated **against ground truth in both directions**
before its count is believed: run it over the tree and hand-check the hits
(precision — a rule that flags correct popovers as modals teaches people
to dismiss it) and hand-collect known shadows and confirm the rule fires
on them (recall — a rule keyed on an attribute the offenders never write
scores zero and reports victory). A detector satisfied by an *import* of
the blessed primitive, rather than by absence of the signature, checks a
proxy and will pass the exact file it exists for
([gate-sees-target](../../_laws.md#gate-sees-target)). And a detector run
that finds nothing must be distinguishable from a detector that ran on
nothing ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Nudge at authoring time; gate what must hold

Enforcement has tiers, and confusing them produces either wallpaper or
revolt:

- **Editor-time warnings** are routing, not enforcement. A warn-level rule
  surfaces the primitive's existence at the exact moment of temptation —
  the cheapest possible nudge — but it **enforces nothing at any gate, by
  construction**: check pipelines that tolerate warnings exit green at any
  warning count, and quiet modes suppress them entirely. Warn-level rules
  correlate with adoption; they never guarantee it. Know which one you
  deployed, and never cite a warn rule as if it were a gate.
- **Build-failing rules** are for the contracts whose violation is a
  defect, not a style drift — the disarmed double-press guard, the
  swallowed error door. Promote a rule to failing only after its precision
  is proven on the real tree, because a failing rule that fires on correct
  code gets deleted, and deleting the gate is how the defect class goes
  invisible again (deletion is not repair).
- **Review-time tables** — the don't-hand-roll table from
  [control-inventory-and-discovery](control-inventory-and-discovery.md) —
  catch what static detectors cannot phrase.

## The ratchet: fix as you touch

Big-bang migrations of a shadow population lose to the calendar; freezes
("no new hand-rolls") without conversion leave the debt permanent. The
ratchet is the sustainable middle:

1. **New code adopts.** The nudges and gates above make the primitive the
   path of least resistance going forward.
2. **Touched code converts.** Any edit that lands in a file containing a
   detected shadow converts it in the same change — small, reviewable,
   already in context. Nobody opens files just to migrate them.
3. **The backlog only shrinks.** The detector count is recorded; a change
   that increases it fails or at least announces itself. Direction is the
   guarantee; speed is whatever the touch rate provides.

## Adoption is a ratio with a stated predicate

The tracked metric is *adopters : shadows*, and both numbers are defined
by the detector that produced them, or they will be reused for claims
they do not support ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
"Eighty-six percent adoption" means: N sites render the primitive, M sites
match signature S as measured by detector D on date T. Re-measure before
citing; inherited metrics drift, and a stale adoption figure has ended
more than one migration prematurely.

Read the ratio in both directions. Shadows outnumbering adopters indicts
the *system* — routing, seams, or contract weight — before it indicts any
author; each shadow is a recorded instance of the library losing a
build-vs-reuse decision it was supposed to win, and the fix begins with
asking why (undiscoverable? missing variant? sealed seam? too heavy?). A
primitive at **zero adopters** is the inverse reading: a standard nobody
ratified. Do not count it as library coverage, and do not leave it in the
catalog unexamined — route consumers to it or retire it.
