---
layer: technique
subject: realtime-events
technique: coalescing-and-batching
status: forged
laws: []
shared_with: []
---

# Coalescing and batching

Producers emit at machine cadence; consumers apply at human cadence. A bulk
operation touches five hundred rows and the change hook dutifully reports
five hundred facts in one tick; an engine transitions through four states in
a millisecond; a reconnecting peer replays a burst. The technique is the
consumer-side collapse that turns *N events* into *one application* without
losing any fact that still matters — and the restraint not to re-implement
batching the platform already provides.

This is the discrete-event sibling of render throttling on the streaming
side (see [render-throttling](../../streaming-output/techniques/render-throttling.md)):
same two-clock insight, different collapse rules — a stream coalesces by
*concatenation*, events coalesce by *supersession*.

## Collapse by key: later facts supersede earlier ones

The property that makes event bursts collapsible is that most events are
**level-triggered in disguise**: "entity X changed" twice in one beat carries
no more information than once, and "X entered state A" followed by "X entered
state B" leaves only B standing. So the coalescing buffer is a keyed map, not
a list:

- the **key** is the entity identity (or name + identity for multi-name
  buffers);
- arrival **replaces** the pending entry for its key — last write wins;
- the flush applies one update per key.

Two event classes refuse this collapse, and misclassifying them is the
technique's characteristic bug:

- **Edge-triggered events** — each occurrence is a distinct fact
  (a completion that increments a counter, an alert that must fire twice if
  it happened twice). These accumulate; they are batched (applied together)
  but never merged (deduplicated).
- **Ordered pairs across keys** — when the consumer's invariant spans two
  entities ("the child never renders without its parent"), per-key collapse
  can reorder their application. The flush applies in a deterministic order
  that respects the declared dependency, or the two keys share one entry.

Declare, per event name, which class it is. A registry (see
[event-registry](event-registry.md)) is a fine place to record it.

## The flush contract

The buffer's clock is perceptual — one flush per frame, or per small fixed
interval — and the contract has the same three clauses wherever this
two-clock pattern appears:

1. **A trailing flush is guaranteed.** The last burst before silence must
   not wait for a next event to arrive; the timer that schedules a flush is
   armed by arrival, not by prior flushes.
2. **Teardown flushes or explicitly discards.** A consumer detaching with a
   non-empty buffer decides which; silently dropping the pending map is a
   correctness hole shaped exactly like the shed-without-counting hole in
   the [golden path](../realtime-events.md).
3. **The flush is one mutation.** The point of collapsing arrival cadence is
   defeated if the flush then applies N entries as N separate state
   transactions, each with its own notification cascade. Batch at the store
   boundary: one transaction, one notification.

## Don't defeat the platform's own batching

Modern rendering and state layers already batch synchronous cascades: all
updates issued within one synchronous task settle in one render. The bus can
*defeat* that for free by being gratuitously asynchronous — fanning one
event out to three consumers via three separate microtask or timer hops
turns one batched render into three. The rules:

- **Fan-out synchronously within a flush.** If three consumers react to one
  event, deliver to all three in the same synchronous pass and let the
  platform settle them together.
- **Add a hop only for a reason you can name** — re-entrancy protection,
  boundary crossing, breaking a synchronous emit-during-apply cycle — and
  add it at one declared point, not sprinkled per subscriber.
- **Measure by settlements, not deliveries.** The health metric is how many
  render/apply settlements a burst caused; a correct implementation is
  O(flushes), not O(events).

## Backstop, not equilibrium

Coalescing absorbs bursts; it does not license unbounded arrival. The keyed
map is bounded in the currency that can actually grow — distinct keys — and
when a burst exceeds it, the honest fallback is not selective drop (which
silently un-updates arbitrary entities) but **degrade to refetch**: discard
the pending map, count the discard, and mark the affected scope stale so the
reconciliation path (see
[push-vs-refetch-reconciliation](push-vs-refetch-reconciliation.md)) issues
one authoritative read. A thousand-key burst usually *means* "everything
changed", and one fresh read is both cheaper and more correct than a
thousand surgical updates.
