---
layer: technique
subject: time-travel-replay
technique: estimate-labeling
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Estimate labeling under playback

Replay arrives after history: some runs predate the instrumentation that
would have recorded them playably, some producers stamped totals but not
timings, some boundaries stripped detail. Reconstructing a playable timeline
from what survived is legitimate — and the reconstruction discipline itself
(evidence tiers, versioned derivations, keeping estimates out of measured
aggregates) is owned by tracing's
[synthetic-and-estimated-traces](../../tracing/techniques/synthetic-and-estimated-traces.md);
this technique does not restate it. What replay adds is a rendering problem
that static views never face: **motion launders estimates.**

## Why playback raises the stakes

A static timeline with an estimated timestamp is a chart with a soft datum.
The same datum *played back* becomes an event that visibly **happens** — it
animates in at 14:03:07, after this and before that, while a counter ticks —
and the performance asserts precision, ordering, and causality with a
confidence the underlying evidence may not carry at all. Every affordance of
the transport compounds it: pausing "at" an estimated moment, scrubbing to
"just before" an interpolated event, reading tempo off spacing that an
apportionment rule invented. A viewer cannot un-see a sequence; if the order
was guessed, the guess is now their memory of the run.

So the rule that suffices elsewhere — label estimates at the datum — gets a
stricter reading here: **the label must survive playback.** It must be
attached per element, visible while the element is in motion, present at
every zoom, restated wherever the element lands (paused frame, hover detail,
export), and never summarized into a banner that detaches the moment one
frame is screenshotted
([count-carries-predicate](../../_laws.md#count-carries-predicate) — a datum
that travels carries what it is).

## What must be marked, per element

- **Estimated timing** — the element renders visually distinct in motion
  (treatment legible without color), and its detail view states the tier
  of evidence behind the timing and what it was derived from.
- **Estimated ordering** — when only order survives and spacing was
  invented, the *region* says so: "sequence known, timing reconstructed."
  Proportional-looking spacing over apportioned timestamps is the costume
  to refuse; even spacing with an explicit reconstruction note is honest.
- **Estimated quantities** — an accrual that folds estimated records marks
  the overlay from the first such fold onward ("cost so far — includes
  estimates"), because a counter is an aggregate and aggregates strip
  provenance by default.
- **The recorded/reconstructed boundary** — mixed timelines are the steady
  state (an instrumented tail behind an uninstrumented head); the scrubber
  shades the regions so the viewer knows *before seeking* which kind of
  ground they'll land on.

## Precision honesty in a moving medium

An estimated moment rendered at millisecond precision wears a measurement's
costume, and playback tailors it: the playhead readout itself becomes the
laundering device if it prints exact stamps while crossing reconstructed
regions. In estimated territory the readout coarsens to what the evidence
supports ("~14:03", "step 3 of 7") — the coarseness *is* the disclosure.
Transport behavior follows: stepping "to the next event" is exact where
recorded and approximate where reconstructed, and the control's feedback
says which just happened.

## Disclosure before motion

The label-per-element rule has one structural complement: **the replay
opens with its provenance summary** — "fully recorded", or "reconstructed
from run totals (timing estimated)", or "recorded from step 4; earlier
steps reconstructed" — shown in the idle state, before the first frame
moves. Not as a substitute for per-element marking (banners detach; this
one is read exactly once), but because consent to a fiction requires
knowing its genre in advance: a viewer who learns mid-playback that the
first half was invented rereads everything they already watched, and the
feature's credibility — its only asset — does not survive many such
moments.
