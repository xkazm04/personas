---
layer: technique
subject: time-travel-replay
technique: timeline-derivation
status: forged
laws: [derivation-names-recomputation, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Timeline derivation

The scrubber's contents are not authored — they are **derived** from the
persisted record: timestamped events, spans, transcript entries, status
transitions. This technique owns the derivation: how raw records become an
ordered, playable timeline, and how the derivation stays honest where the
record is imperfect — which it always is.

## The derivation is pure, stated, and recomputable

The timeline is a function of the record and nothing else
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
same record in, same timeline out, rebuildable at any moment. It is **never a
second store** — a persisted "replay track" written alongside the record is a
copy that will drift the first time the record is amended (late-arriving
spans, backfilled roots, post-hoc reclassification all happen). If a built
timeline is cached for performance, it is a cache keyed to the record's
version and invalidated by it, and the derivation rule itself is versioned so
an improved builder can regenerate old timelines rather than fossilizing the
first heuristic.

## Ordering: timestamps sort, identity breaks ties

Records are ordered by their recorded time — but timestamps tie, and clocks
across process boundaries skew. Rules:

- **Ties break on a stable identity**, never on array position or arrival
  order: a monotonic sequence number minted at capture, or the record's own
  id ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
  Position-based tiebreaks reorder on re-derivation, and a timeline that
  shuffles between two openings of the same run destroys the viewer's trust
  in everything else it shows.
- **Causal order beats stamped order where both exist.** A child span
  stamped (by a skewed clock) before its parent is a physical impossibility
  the derivation must resolve in causality's favor — and *record* the
  adjustment on the item, because a silently repaired timestamp is an
  estimate wearing a measurement's face.
- **Out-of-range records are disclosed, not clamped.** An event stamped
  after the run's recorded end (late flush, timezone bug) either extends the
  timeline visibly or is excluded with a count — never quietly pinned to the
  edge where it fabricates a final flurry.

## Gaps are content

A stretch of record time with no records is **rendered as disclosed
silence**: a marked quiet region on the scrubber, distinguishable at a
glance from dense regions. Two failure modes, both fabrication:

- **Interpolation** — inventing plausible intermediate activity ("probably
  still processing") to make the timeline look continuous.
- **Elision** — splicing the gap out so the timeline looks dense, which
  falsifies every duration the viewer reads off the axis. (Compressing gaps
  *at playback* with a marker is the transport's job and is disclosed;
  removing them *from the derived timeline* is not compression, it is
  editing the record.)

A gap means one of two things — the run was idle, or capture failed — and
when the record can distinguish them (heartbeats, capture-error markers), the
gap says which. An idle run and a blind recorder must not render identically
([failure-not-empty-success](../../_laws.md#failure-not-empty-success));
"no data because nothing happened" and "no data because nothing was written
down" lead the viewer to opposite conclusions.

## Unclosed and half-recorded items

Records from interrupted runs arrive incomplete: spans opened and never
closed, a transcript that stops mid-line, a status that never reached
terminal. The derivation's contract:

- an item with a start and no end plays as **open until the record's own
  end**, rendered as interrupted — not assigned an invented duration, and
  not dropped (dropping the unclosed items from a crashed run deletes
  precisely the evidence the viewer came for);
- the run's end, for timeline purposes, is the **latest recorded moment**,
  not the nominal completion stamp — a run that died writes no completion;
- a record too damaged to derive from produces a **stated failure** ("could
  not build timeline: N unparseable records"), never an empty-but-playable
  timeline. Zero playable items from a nonzero record is a derivation error
  until proven otherwise.

## Merging several record streams onto one axis

Real replays braid multiple streams — output lines, span opens/closes,
status transitions, cost events — each persisted separately, into one
timeline. The merge needs **one time authority**: a single reference clock
that every stream's stamps are mapped into, with per-stream offsets resolved
once at derivation (streams stamped by different clocks *will* disagree;
picking the authority and stating the mapping beats pretending they agree).
Each derived item keeps its source stream and source identity, so any moment
on the scrubber can answer "which record put you here?" — the timeline is an
argument from evidence, and every item is a citation.
