---
layer: technique
subject: agent-chaining
technique: graph-to-wiring-translation
status: forged
laws:
  - derivation-names-recomputation
  - creation-names-reaper
  - gate-sees-target
shared_with: []
---

# Graph-to-wiring translation

The user edits a picture; the runtime obeys standing rules. This technique
owns the function between them: drawn edges in, subscription rows out, run
after run, without duplication, without ghosts, and with drift detectable
from data.

## One arrow is several rows

A drawn edge "A → B" decomposes into at least two runtime artifacts with
different owners and different lifetimes: an **emitter-side rule** (agent A,
on completion, publishes event E with a declared payload) and a
**listener-side rule** (agent B subscribes to event E and starts on
arrival). Add a condition on the arrow and there is a third artifact — the
predicate attached to one side or the other. The decomposition is where the
translation earns its name: it is not a copy, it is a *derivation with a
schema change*, and every property below exists because a derivation that
spans stores can half-apply.

Which side owns what is a real decision. Putting the condition on the
emitter ("only publish when…") silences the event for *every* listener;
putting it on the listener ("only start when…") lets other subscribers see
the event and keeps the arrow's semantics local to the arrow. The
listener-side placement is almost always the right default, because it
preserves the invariant that an arrow's meaning is independent of its
siblings — the emitter stays a dumb, unconditional announcer of fact.

## The translation is a reconciliation, not an append

The naive implementation inserts wiring rows when the user saves the graph.
It is wrong on the second save. The correct shape is **reconcile to the
drawing**: compute the wiring the current graph implies, diff it against the
wiring that exists, insert what is missing, delete what is no longer
implied, and leave the intersection untouched. Three properties fall out:

- **Idempotence.** Saving the same graph N times produces the same rows.
  The alternative — duplicate listeners — is not a tidiness problem; a
  duplicated listener *double-starts the downstream agent* on every firing,
  which doubles cost and can double side effects.
- **Deletion cleanup.** An edge removed from the drawing removes its rows in
  the same reconcile pass ([creation-names-reaper](../../_laws.md#creation-names-reaper):
  the reaper of a wiring row is the reconciler, and it runs on every save).
  The orphaned listener is this subject's signature ghost — an agent that
  starts "spontaneously" because an arrow deleted from the picture still
  exists as a standing subscription. Users do not debug this; they lose
  trust in the product.
- **Scoped authority.** The reconciler deletes only rows *it* would have
  created — rows tagged as graph-derived, scoped to this graph. Wiring the
  user authored directly through other surfaces is out of its jurisdiction,
  or the reconcile pass becomes a weapon that silently destroys manual
  configuration.

The pass should be transactional per graph: a translation that inserts the
emitter rule and crashes before the listener rule leaves an arrow that
announces into the void — worse than either wired or unwired, because the
picture and both partial behaviors all disagree.

## Tagging: every derived row names its edge

Each wiring row carries the identity of the drawn edge that implies it.
This single field is what makes everything else cheap: reconciliation
becomes a set difference on edge ids instead of a structural guess;
deletion cleanup becomes an indexed lookup; and the answer to "why does
this listener exist?" is a pointer back into the drawing, renderable in the
authoring surface. A wiring row with no edge id is either manual (fine —
out of scope) or an orphan from a pre-tagging era (a migration debt worth
paying down once, explicitly).

## Drift detection: ask the data, not the changelog

Picture and wiring live in different stores, so they will diverge —
partial saves, direct edits, restores from backup, code changes to the
translation itself. The system needs a **drift check**: recompute the
implied wiring from the current drawing and diff it against the actual rows
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
— the reconciler *is* the named recomputation, and the drift check is
running it in report-only mode). Crucially the check reads the *actual
runtime rows*, not a cache of what was last written
([gate-sees-target](../../_laws.md#gate-sees-target)); the divergence it
exists to catch is precisely the one a write-log would miss. Surfacing
drift in the authoring surface — "this arrow is drawn but not wired" /
"this wiring has no arrow" — turns the subject's worst bug class into a
visible, one-click repair.

## Decision rules

- Reconcile, never append: the wiring after every save is a pure function
  of the drawing.
- Listener-side conditions by default; emitter stays unconditional.
- Every derived row carries its edge id; the reconciler touches only rows
  bearing one, scoped to the graph being saved.
- One translation pass per graph save, transactional; a half-applied arrow
  is a failed save, not a degraded success.
- Ship the drift check with the feature, not after the first ghost — it is
  the same code as the reconciler, run without the writes.
