---
layer: technique
subject: time-travel-replay
technique: scrub-performance
status: forged
laws: [derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Scrub performance

Replay state at position *t* is a fold over every record before *t*. Nothing
in that sentence is negotiable — it is what makes replay honest — but taken
naively it makes every seek a replay-from-start, and a scrub gesture is
hundreds of seeks in two seconds. This technique owns the engineering that
makes the fold feel free.

## The stake: a laggy scrubber deletes the feature

Scrubbing is replay's core verb — the second viewing, the "wait, go back",
the hunt for the moment things turned. A scrubber that stutters for 300ms
per sample does not merely feel slow; it **trains users not to scrub**, and
they stop within a session or two. The feature then survives organizationally
(the button exists, the demo works) while being dead in practice — worse
than absent, because its existence blocks anyone from proposing it. Budget
accordingly: scrub feedback belongs in the perceptual-immediacy class
(~100ms), and the budget is per *sample*, not per gesture.

## Making position evaluation cheap

Three complementary structures, all computed at timeline build:

- **Prefix sums** for every accrued quantity (the accrual-overlays
  technique's requirement): totals at any position by binary search, O(1)
  after lookup, direction-free.
- **Keyframes** for state that is genuinely a fold — the visible transcript,
  open-items set, phase state: snapshot the folded state every N items or M
  seconds of record time. Seek = restore nearest keyframe ≤ *t*, re-fold
  only the tail. Keyframe spacing is the knob trading memory for worst-case
  seek: bound the *tail length*, and the worst seek is bounded regardless
  of run size.
- **Indexed release points**: the item index sorted by record time, so
  "what's between the playhead and the seek target" is a range query, never
  a scan.

Every one of these is a cached derivation of the record and names its
recomputation — rebuild from the record, or re-fold from the previous
keyframe
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
None is ever authoritative: a suspicious frame is settled by re-folding from
zero, and the two must agree. A keyframe store that can disagree with the
fold it summarizes — and win — is a corrupted replay with no arbiter.

## Preview-then-settle

The scrub interaction itself is two-phase, because not all of the surface
is equally cheap:

- **While dragging**: update the cheap layer every sample — playhead
  readout, accrual overlays (prefix lookups), scrubber shading, a
  lightweight frame preview if one is precomputed. This layer must never
  miss the budget.
- **On release (or drag-pause debounce)**: settle the full surface —
  restore keyframe, re-fold tail, materialize the transcript at *t*.

The contract between the phases is honesty about which is showing: the
preview layer must be visually incapable of being mistaken for the settled
surface (dimmed content, or overlays-only), because a preview that looks
settled while showing a stale frame puts wrong content under a correct
timestamp — precisely the lie the transport exists not to tell.

Forward *play* is the cheap case — an incremental fold at human speed — and
must never be implemented as repeated seeks. Backward stepping is a seek;
with keyframes it is a short one.

## Rendering scale

The fold's output has its own scale problem: a long run's transcript at
*t = end* is the entire output. Re-rendering the whole materialized
transcript per sample is quadratic across a gesture. The remedies are the
live surface's own — the renderer-reuse principle pays off here, because the
live pipeline already solved arrival-scale rendering: virtualized viewports,
append-only paths for forward motion, bounded buffers with honest
truncation. Replay adds one case the live surface never has: **backward
jumps invalidate append-only assumptions** — a seek back must reset to a
keyframe's rendered state, not attempt to un-append.

## Caches name their reaper

Keyframes, prefix arrays, and preview frames are per-run memory that grows
with run size and lingers after the viewer moves on. Each cache states its
bounds and its end
([creation-names-reaper](../../_laws.md#creation-names-reaper)): sized
against the run (spacing scales up on huge runs), scoped to the replay
session, and released when it closes — measured, in long-lived multi-run
products, not assumed. A replay surface that leaks one run's keyframes per
viewing is a memory incident scheduled by its most engaged users.
