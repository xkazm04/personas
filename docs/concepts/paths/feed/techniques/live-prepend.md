---
layer: technique
subject: feed
technique: live-prepend
status: forged
laws:
  - identity-survives-reuse
  - failure-not-empty-success
shared_with: []
---

# Live prepend

A live feed grows at the top — the same edge the reader enters from and the
opposite edge from where a transcript grows. That inversion is why feed
scroll handling cannot be copied from chat: a transcript's new content lands
*below* the reading position and pin-to-tail is the follow mode; a feed's
new content lands *above* it, where insertion physically pushes the reader's
text down the screen unless the surface intervenes. Everything in this
technique is that intervention.

## The two reader modes

The scroll position is a declaration, and the surface reads it:

- **At the head** (within a small tolerance band of the top): the reader is
  asking for live. New occurrences render in place as they arrive; the
  viewport stays at the head and the newest row is always visible. This is
  the feed's follow mode.
- **Scrolled away**: the reader is reading. The surface must hold the
  viewport absolutely still — not "mostly still", still — while arrivals
  accumulate out of sight, and must announce them through an affordance the
  reader controls: a "N new" pill at the top edge, doubling as
  jump-to-latest. Invoking it scrolls to the head, flushes the held
  arrivals into view, and re-arms follow mode.

The band matters. A pixel-exact "at top" test drops the reader out of follow
mode on sub-pixel scroll jitter; a band that is too generous yanks a reader
who has deliberately nudged down one row. Small, tolerant, and biased toward
*reading* is correct: when in doubt, do not move the viewport.

## Holding the viewport still

When rows are inserted above the visible region, naive rendering shifts the
content by the inserted height. Two implementation families fix it:

- **Buffer-and-defer** (the default): arrivals that would insert above the
  viewport are *not rendered at all* — they sit in a held buffer, counted by
  the affordance, and enter the layout only on jump-to-latest or on return
  to head. The viewport never needs correcting because nothing above it ever
  changes. This is also the honest form of the "N new" count: N is the size
  of the held buffer, a number the surface owns exactly.
- **Insert-and-compensate**: render the rows and adjust scroll position by
  the measured inserted height in the same frame. Required when the design
  insists the list be continuous at all times, but it is fighting the
  platform — every miss (fonts settling, images loading, async row heights)
  appears as a visible lurch. Prefer buffer-and-defer unless a hard
  requirement forbids it.

Either way, **row identity is the anchor of correctness**: reconciliation
by stable id is what lets the renderer distinguish "rows inserted above"
from "everything changed". Feeds re-keyed by index re-render the world on
every prepend and make both strategies impossible.

Identity also guards the **entrance choreography**. If arriving rows play an
entrance animation, the "has this row entered before" test must be keyed by
occurrence id and remembered — a polling refetch or reconnect re-delivering
the same rows must render them plainly, with only genuinely new ids
animating. An animation keyed to render order replays on every refresh,
which turns the liveliness cue into noise and teaches the reader to ignore
exactly the signal it exists to give. The same guard bounds cost: animate
only within the first viewport; rows entering off-screen or under scroll
render plainly, because motion the reader cannot see is pure jank budget.

## Batching and cadence

Producers burst; renderers must not. Arrivals are coalesced on a throttle
window so the feed updates in calm beats rather than per event — the
mechanics (buffer, flush cadence, why the flush must be aligned with the
scroll logic that reads it) are inherited from streaming-output's
[render-throttling](../../streaming-output/techniques/render-throttling.md)
and are not re-derived here. The feed-specific addendum: the flush and the
mode test run together. Deciding "is the reader at head" *after* a flush has
moved layout reads the wrong geometry; the sequence is test, then apply.

## Reconnect and the seam

Live transports drop. On reconnect the feed owns a seam: everything between
the last delivered tuple and the current head may have been missed, and the
live stream may replay some of what was already shown.

- **Catch-up is a cursor walk, not a refresh.** The feed queries
  newer-than-(last delivered tuple) — the same keyset mechanics as history
  paging, pointed the other way — and merges the result. Wholesale refetch
  discards the reader's position and re-renders the world; the cursor walk
  fetches exactly the gap.
- **Dedupe by identity at the merge door.** Overlap between catch-up and
  the resumed live stream is normal; the merge admits an occurrence only if
  its id is not already present. Identity, not timestamp equality — two
  occurrences can share a timestamp legitimately.
- **A failed catch-up is not an empty catch-up.** If the gap query fails,
  the surface knows it *may have missed events* and must say so (a quiet
  "connection restored — refresh to be sure" affordance) rather than
  resuming as if the seam were clean. Silence here is the feed asserting
  "nothing happened" on no evidence — failure spelled as empty success.
- **A gap that exceeds the transport's replay horizon degrades to a stated
  reset**: "you were away a while — showing latest" with history reachable
  below. Quietly showing latest *without* the statement makes the missing
  span look like a span where nothing happened.

## Ordering discipline at the head

Prepend is where the total order is easiest to violate: the temptation is to
append arrivals to the top in delivery order. Delivery order is not event
order — bursts interleave, transports reorder. Arrivals merge at their
tuple-correct positions within the held buffer and the head region, so that
when the buffer flushes, the feed reads as chronology, not as network
weather. (Late arrivals that belong far below the head are the
[reverse-chronology-semantics](reverse-chronology-semantics.md) late-arrival
case, not a prepend case.)
