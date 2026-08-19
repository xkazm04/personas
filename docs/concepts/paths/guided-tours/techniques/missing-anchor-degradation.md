---
layer: technique
subject: guided-tours
technique: missing-anchor-degradation
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Missing-anchor degradation

Anchor contracts catch references to elements that no longer exist anywhere.
They cannot catch elements that legitimately are not on screen *right now*:
a control gated by an entitlement this user lacks, a panel that renders only
with data the fresh account does not have, a button behind a feature flag, a
row that exists on wide viewports and collapses on narrow ones. A tour that
treats these as impossible will meet them in production; a tour that treats
them as fatal will die on them. This technique makes the missing anchor an
**expected condition with a declared, per-step policy**.

## The never-strand invariant

Before any policy choice, one invariant is absolute: **degradation must never
leave the user trapped**. The catastrophic form is specific and worth naming —
the overlay dims the product, the spotlight finds nothing to cut out, the
step's continue affordance is anchored to the element that is not there, and
the user is left staring at a darkened, dead application. That outcome is
strictly worse than any bug in the tour's content, because it converts a
coaching defect into a product outage.

The invariant in mechanism form: the dimming, the escape affordance, and the
step's forward/exit controls must never depend on anchor resolution
succeeding. They render unconditionally; only the spotlight and the pointer
are conditional on the anchor.

## The two honest policies

When resolution fails after a bounded wait, a step does one of two things:

- **Skip.** The step is about the missing control; without the control the
  step has no subject. Advance to the next step silently, or with a light
  acknowledgment. Right for steps that are purely about the absent feature —
  an entitlement-gated control, a panel this configuration does not show.
- **Re-center.** The step's content still carries value without a spotlight —
  the guidance detaches from the anchor and presents centered, without
  pointing at anything. Right for steps whose text teaches a concept and the
  spotlight was illustration, not substance.

Which policy applies is **declared per step at authoring time**, because only
the author knows whether the step's value survives the anchor's absence. A
single global fallback is a category error: global-skip silently deletes
conceptual steps for some users; global-recenter shows "here is the export
button" with no export button in sight, which reads as a broken product.

Two refinements both policies share:

- **Bounded patience.** Interfaces render late — data loads, panels animate
  in, routes settle. Resolution retries briefly before declaring absence, so
  a slow anchor is not misread as a missing one. The bound is short and
  fixed; an unbounded wait is the stranding invariant violated in slow
  motion.
- **A tour that degrades to nothing ends.** If skipping cascades through
  every remaining step, the tour completes gracefully rather than marching
  the user through a sequence of apologies.

## Degradation is a signal, not just a save

Every degradation event is evidence that reality diverged from the tour's
model — the anchor contract drifted, a flag rollout changed the surface, a
layout collapse hid the control. Per the law that failure must be spelled
differently from empty success, the degraded path **records itself**: which
tour, which step, which anchor, which policy fired. A tour run that skipped
four of nine steps and one that showed all nine must be distinguishable in
whatever the product uses for telemetry — both to the team (a spike in
degradations on one step is a regression alarm) and in completion accounting
(a "completed" tour that was mostly skipped is a different fact than a
completed tour).

Silent degradation is the tempting failure: the tour "works" for everyone,
nobody is stranded, and the coaching quietly evaporates step by step over
months while its authors believe it is running. The save without the signal
converts a visible defect into an invisible one.

## What this technique refuses

- Any step whose exit or continue affordance requires the anchor to exist.
- A global degradation policy substituting for per-step declarations.
- Unbounded waiting for an anchor to appear.
- Degradation that leaves no trace — the skip that spelled itself exactly
  like success.
- Treating degradation frequency as noise. It is the drift gauge for the
  whole subject.
