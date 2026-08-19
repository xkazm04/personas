---
layer: technique
subject: self-healing
technique: auto-rollback
status: forged
laws:
  - gate-sees-target
  - failure-not-empty-success
shared_with: []
---

# Auto-rollback

Every healing change is an experiment run without a review, applied by the least
supervised writer in the system, usually while nobody is watching. An experiment
needs two things the reflex-arc healer lacks: a control comparison and an abort
lever. Auto-rollback is both — the healer watching its own wake and undoing
changes that made things worse, automatically, before the operator wakes up to an
incident the maintenance system caused.

## Watch the aggregate, not the target

The subtle trap: the healer's own confirmation predicate (did the thing I fixed
start working?) is the *wrong* signal for rollback, because a fix can cure its
target while poisoning its neighbors. A configuration "correction" that unwedges
one work stream and breaks three others passes its confirmation check with
flying colors. The regression gate therefore observes the widest honest signal —
**aggregate error rate across the surface the change could plausibly reach** —
not the healer's report card on itself (law: gate-sees-target: the healer's
success claim is a proxy; the system's failure stream is the target). The two
loops divide cleanly: effectiveness-accounting asks *did it help the patient*;
auto-rollback asks *did it hurt the ward*.

## Baseline at apply time, verdict after a window

Mechanics, in order:

1. **Capture the baseline when the change is applied** — error rate over the
   trailing window, recorded into the attempt record. A baseline reconstructed
   later, during the regression, is reconstructed by the party under suspicion
   from data the incident is already distorting.
2. **Watch a post-change window** sized to the system's natural rhythm: long
   enough for the error rate to mean something, short enough that the rollback
   still helps.
3. **Compare with a minimum-volume floor.** Two failures out of three events is
   not a regression, it is a quiet evening plus bad luck; rate deltas only count
   above a stated event volume — the same floor discipline breaker trip
   conditions use, for the same reason.
4. **Thresholds are data, not code.** The first real regression will prove the
   threshold wrong for at least one surface; tuning must be an edit, not a
   deploy.

Attribution rides a **change identifier** minted at apply time and carried by
the attempt record, the baseline, the regression verdict, and the rollback
record — one key joining the whole episode, so the post-incident question "what
did the machine do and what did it cost" is a query.

## The undo is designed at apply time

A rollback improvised during a regression is a second experiment, run during an
incident, by the same actor that caused it. The alternative is structural: **no
change enters an autonomous tier without a stated undo**, and the undo's inputs
are captured *at apply time* — the previous value, the snapshot, the inverse
operation — into the attempt record, before the change lands (see
blast-radius-bounds: undo-definition is an admission criterion, and tier 3
exists precisely for changes that have no undo).

Undo-by-stored-prior-state beats undo-by-inverse-logic where both are possible:
the stored prior state is a fact, the inverse operation is a belief about the
change's semantics, and beliefs about semantics are exactly what a misbehaving
strategy has already gotten wrong once. Where the change is *re-derivable* (a
cache, a token, a computed setting), the cheapest correct undo is deletion plus
recomputation by the normal path — the one case where removing the artifact is
the repair, because the artifact is a derivation, not a source.

## After the rollback: stop, quarantine, escalate

One rollback ends the machine's autonomy over that case. The naive loop —
rollback restores the old state, the old failure recurs, the tree selects the
same strategy, the same regression follows — is an oscillator that converts one
bad mapping into a permanent background churn. Three rules break it:

- **The rollback marks the attempt *reverted*** in the effectiveness ledger
  (law: failure-not-empty-success — a rolled-back heal is not a quiet nothing;
  it is the most expensive outcome the ledger records).
- **The (signature, strategy) pair is quarantined** — the tree will not select
  that strategy for that signature again without human release.
- **The episode is promoted** with its full history: diagnosis, selection
  reasoning, change, baseline, regression evidence, rollback (see
  incident-promotion). A change bad enough to auto-undo is by definition beyond
  the machine's current competence; the human should start from the machine's
  complete notebook, not from a fresh symptom.

And the rollback itself is **loud**: surfaced on the operator plane as an event
in its own class, not buried as one more log line. A system that silently
applies and silently reverts is oscillating invisibly — the operator sees only
an unexplained ripple in the error graph, and the healer's involvement is
discoverable only by archaeology.

## Decision rules

- **The rollback target must itself qualify.** "Previous" is not a synonym for
  "good": before rolling back, verify the target's own record — its error rate
  is actually lower than the current one, below an absolute ceiling, and built
  on enough volume to be a track record rather than one lucky run (the same
  minimum-volume floor, applied symmetrically to both sides of the
  comparison). Rolling a 90%-error present onto an 80%-error past lands on a
  still-broken state while emitting a confident "recovered" event — the worst
  of both worlds. And when no qualifying target exists, the regression was
  still *detected*: declining to roll back must promote the finding, not
  drop it.
- **The rollback path is exercised in tests and drills, not first executed
  during a real regression.** An undo that has never run is a hypothesis;
  strategies ship with their undo tested against the same fixtures as their
  apply.
- **Rollback must be cheaper and safer than the change.** If undoing requires
  a heavier mutation than doing (a cascading reset to revert a flag), the
  strategy is mis-tiered — the true blast radius is the union of apply and
  undo.
- **Concurrent changes share the verdict conservatively.** When two healing
  changes are in flight on overlapping surfaces and the aggregate regresses,
  attribution is ambiguous — roll back both rather than adjudicating with
  guesswork. Better: the selection layer's budgets should make overlapping
  in-flight changes rare enough that this stays a corner case.
- **A rollback that fails is a page, immediately.** The system is now in a
  third state — not the old one, not the intended new one — created by the
  remediation layer. This is the one place in the subject where the correct
  response is always: stop healing entirely on that surface and summon a
  human.
