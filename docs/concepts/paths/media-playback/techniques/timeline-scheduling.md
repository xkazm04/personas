---
layer: technique
subject: media-playback
technique: timeline-scheduling
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation]
shared_with: []
---

# Timeline scheduling

Timeline scheduling is playback of *composed* content: clips arranged on
lanes, a gapless sequence of items, a narration laid over music — anything
where what plays is assembled from parts rather than read from one opaque
source. The technique exists because the intuitive implementation — play
part one, and when it ends, start part two — is a chain, and chains are the
wrong physics: every link adds error (end-detection latency becomes a gap or
an overlap at each seam), one sick link stalls everything behind it, and
seeking means simulating the whole chain up to the target. Composition needs
a different spine.

## Schedule against the clock, never against the predecessor

The spine is the subject's authoritative clock (see
[playback-clock](playback-clock.md)). Every scheduled piece knows its
**timeline interval** — start and end on the shared clock — computed from
the composition, not from whenever the previous piece happened to finish.
The scheduler's whole job is then a single honest loop: as the clock
advances, pieces whose interval has arrived are started *at their offset*
(a piece entered late starts mid-content, not from its beginning — that is
what keeps a briefly-stalled lane from shifting everything after it), pieces
whose interval has passed are stopped and reaped, and nothing downstream of
the clock has an opinion about time.

This is also what makes multi-lane composition tractable: audio lane, video
lane, overlay lane all sample the *same* clock, so they cannot drift apart
as a group. Lane-to-lane synchronization (video waits for audio, captions
chase video) rebuilds the chain sideways; the rule is every lane to the
clock, no lane to another lane.

## The schedule is a derivation of the timeline model

The user edits a *model* — clips with positions, durations, trims, lanes.
The scheduler consumes a *schedule* — the resolved set of intervals. The
schedule is a *derivation* of the model, recomputed by a named function
whenever the model changes
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)),
never incrementally hand-patched in place. The moment schedule entries are
edited directly ("just move this one interval, it's faster than
recomputing"), the model and the schedule become two authorities, and every
future edit is a merge between them. Recomputation is cheap at the scale of
human-edited timelines; correctness of a single derivation direction is
worth far more than the saved microseconds.

Edits during playback are the interesting case: recompute the schedule,
then **diff against the running state** — pieces playing now that are
unchanged keep playing untouched; pieces whose interval moved or vanished
are stopped or restarted at their new offset; pieces newly overlapping the
playhead are started. The playhead does not move because the content under
it changed; the content under it changes.

## Identity is the diff's foundation

That diff — "is the thing playing now the same thing the new schedule says
should be playing?" — is only answerable if pieces have **identity that
survives editing**: minted at clip creation, carried through reorder, trim,
lane moves, and duplication (a duplicated clip is a *new* identity with
copied properties)
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Index-based identity fails at the first insertion — every clip after the
insertion point appears to be a different clip, and the scheduler restarts
them all, audibly. Identity also names which clip a late asynchronous result
belongs to (a decode that finished after its clip was deleted is discarded,
not played), which is the composed-timeline instance of the stale-result
discipline running through this whole subject.

## Lookahead: the window between now and prepared

Starting a piece takes real time — fetch, decode, pipeline setup — so the
scheduler prepares work **ahead of the clock** inside a bounded lookahead
window: pieces whose interval begins within the window are readied now, so
their start at interval time is a cheap trigger, not a cold load. The window
size is a genuine tradeoff, not a constant to cargo-cult:

- too small, and seams stutter — pieces start late because preparation
  couldn't finish inside the window;
- too large, and three costs grow together: resource residency (prepared
  pipelines held warm), wasted work under seeking (everything prepared is
  abandoned on every jump), and edit latency (an edit inside the prepared
  window must cancel and re-prepare, so a big window makes more edits
  expensive).

Preparation inside the window follows the same reaper discipline as
everything else: a prepared-but-not-started piece that gets seeked past,
edited away, or superseded is released at that moment, not when it would
have played.

## Gaps and ends are content, not accidents

A composed timeline has holes — an empty half-second between clips, a lane
with nothing scheduled, a timeline that simply ends. Each is **scheduled
content whose content is nothing**, handled deliberately:

- a gap plays as intended silence/blankness with the clock still advancing
  — the transport stays in *playing* (time is advancing by design), never
  in *buffering*, which would be a lie that something is being worked on;
- end-of-timeline is a designed terminal: stop, hold on the last frame,
  loop, or advance to the next composition — chosen by the product, and
  distinct from a mid-timeline stall, which is a defect;
- a piece that *fails* inside a composition converts to a gap of its own
  duration rather than shifting its successors — in composed content,
  **timing is the contract**: everything after the failure plays when it
  was authored to play, and the failure is reported through the transport
  rather than absorbed as a silent re-timing of the whole work.

## Seek is a pure function of the composition

Because every piece knows its interval, seeking is: stop what is running,
find the pieces whose intervals contain the target (with their internal
offsets), prepare them, and resume — no chain simulation, no replaying from
the start. The find must be efficient at the composition's real scale
(sorted intervals make it a search, not a scan), and rapid seeks coalesce
exactly as raw transport seeks do: latest target wins, preparation for
abandoned targets is cancelled and reaped.
