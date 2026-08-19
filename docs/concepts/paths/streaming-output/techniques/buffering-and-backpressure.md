---
layer: technique
subject: streaming-output
technique: buffering-and-backpressure
status: forged
laws: [count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Buffering and backpressure

A live stream buffer sits between a producer that emits at machine speed and
a consumer that renders at human speed. The producer being faster is not an
edge case — it is the operating condition. The technique is a bounded buffer
with an eviction policy chosen on purpose, an honest account of what eviction
discarded, and a decision — made explicitly — about what happens when the
producer cannot be slowed.

## The budget is stated in two currencies

A buffer bounded only by entry count is defeated by one enormous entry; a
buffer bounded only by bytes is defeated by a million one-byte entries (the
per-entry bookkeeping overhead becomes the memory hog the byte cap was
supposed to prevent). So the budget is dual:

- **an entry budget** — how many records the live tail retains;
- **a byte budget** — the total payload size across retained records.

Exceeding *either* triggers eviction until both are satisfied. The numbers
themselves are product decisions (enough tail for the user to scroll back
through meaningfully; small enough that a dozen concurrent runs cannot
matter), but the *shape* — two currencies, evict on either — is not
negotiable. And one more cap hides inside: a **single entry larger than the
whole byte budget** must be truncated on admission, or one pathological line
evicts the entire buffer and then busts it anyway.

## Evict from the head, keep the tail

For a live surface, the recent end is the valuable end — the user is watching
the tail, and the tail is what the next flush renders. So the buffer is a
ring: new entries append, and when a budget is exceeded, the **oldest**
entries fall off. The inverse policy (refuse new entries when full) is
correct for queues whose consumers need every element, and exactly wrong
here: it would freeze the live view at the stalest moment of the run while
silently discarding what the producer is saying *now*.

## Truncation is honest

Eviction is not a private implementation detail — it changes what the surface
can truthfully claim. A buffer that has evicted must say so, and the notice
carries its predicate ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
not a vague "output truncated" but *how much* was dropped and *from which
end* — "earliest output dropped (N entries / M kilobytes) to bound memory".
Without the notice, the user reads the top of the buffer as the start of the
run, quotes it, scrolls for context that silently no longer exists, and
concludes the producer never said the thing it said. A truncated transcript
presented as complete is a lie of omission with excellent formatting.

The counters that feed the notice — entries evicted, bytes evicted — are kept
by the buffer itself and travel into the settled record, so the truncation
fact survives the live view.

## The live buffer is not the system of record

The ring holds what the *surface* needs; it must never be mistaken for what
the *record* keeps. If the product promises full retention of long runs, the
full stream spills to a durable append-only store at wire speed — cheap,
sequential, unbounded-friendly — and the ring remains the bounded view over
its tail. If the product does not promise full retention, that is a stated
retention policy, not an accident of buffer sizing. The unacceptable middle
is scraping the ring at finalization and calling it the record: that persists
whatever eviction happened to leave, which varies with timing and budget —
a settled record whose completeness is a race result.

## Backpressure or shedding — decide which world you are in

When the consumer falls behind, there are exactly two honest responses, and
which is available depends on who the producer is:

- **Backpressure** — slow the producer. Available when the producer is
  cooperative: a pull-based source, a channel with blocking send, a protocol
  with flow control. Prefer it when partial loss is unacceptable, and note
  the cost: backpressure propagates, and a slowed producer may time out or
  hold resources longer.
- **Shedding** — accept loss at a defined point with accounting. Mandatory
  when the producer cannot be slowed: an external process writing to a pipe,
  a remote peer on a fire-and-forget channel. The ring's head-eviction *is*
  the shedding point; the accounting above is what keeps it honest.

The dishonest third response — an unbounded intermediate queue "so nothing is
lost" — merely moves the failure from visible truncation to invisible memory
growth, and converts a bounded product decision into an unbounded outage.
Choose loss or choose slowdown; refusing to choose chooses collapse.

## Produce into the buffer, not across the boundary

When the producer and the renderer sit on opposite sides of an expensive
boundary — a process boundary, a serialization hop, an inter-runtime bridge —
the live buffer belongs on the **producer's side**, and lines cross the
boundary only for consumers that exist: a snapshot on attach, increments
while subscribed. The tempting alternative — broadcast every line across the
boundary unconditionally and let surfaces pick what they want — pays
serialization and delivery for every line times every channel, including the
channels nobody is watching, which in a grown product is most of them. The
tell is a producer with many emit sites and no record-only path: every new
stream added copies the broadcast pattern, and the boundary silently becomes
the hottest path in the system carrying data with zero readers.

## Buffers name their reaper

A live buffer is created per run, and its creation names what destroys it
([creation-names-reaper](../../_laws.md#creation-names-reaper)): finalization
releases it, and replacement by a newer run releases it. The leak shape to
design against is buffers keyed by run identity that accumulate forever
because "the map is small" — every run adds an entry, no path removes one,
and the bound on any single buffer is defeated by the unbounded count of
buffers. A registry of per-run buffers has its own budget and its own
eviction, same rules, one level up.
