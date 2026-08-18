---
layer: technique
subject: realtime-events
technique: push-vs-refetch-reconciliation
status: forged
laws: [derivation-names-recomputation, identity-survives-reuse]
shared_with: []
---

# Push vs refetch reconciliation

Two sources of truth compete for every realtime consumer's state: the events
being pushed at it, and the authoritative read path it could query. The
technique is the division of labor that keeps them from fighting: **events
carry advice, reads carry truth**. An event may tell the consumer *that*
something changed, *which* thing, and — as a latency optimization — *what it
probably looks like now*; only a read against the authority settles what is
actually true. State assembled purely from a pushed event history is a
derived value, and a derived value must name its recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
— for event-derived state the recomputation *is* the refetch, which is why
the refetch path must exist and stay exercised even when push works.

## Why replication-by-payload fails structurally

Building consumer state by applying event payloads as writes feels
efficient and works in the demo. It fails structurally because it quietly
assumes three guarantees the in-process bus never gave:

- **Completeness** — but delivery is at-most-once; a suspended process, a
  raced subscription, or a shed channel means a missing write, and a missing
  write is silent permanent divergence, not visible staleness.
- **Ordering** — but two events through different hops (one direct, one via
  a coalescing buffer) can apply out of order, and last-write-wins on
  arrival order is not last-write-wins on occurrence order.
- **Payload sufficiency** — but payloads were designed as notifications; the
  moment they must reconstruct full state, every producer change becomes a
  consumer-corruption risk.

Invalidation assumes none of these. A missed invalidation is staleness until
the next event, fetch, or focus; a reordered invalidation is a redundant
fetch; a thin payload is exactly enough. The failure mode degrades from
*wrong* to *late* — the entire value of the technique in one sentence.

## The invalidation grammar

An invalidation-carrying event answers three questions, and the payload
should be designed backward from them:

1. **Which scope?** The identity of the changed entity (or collection). The
   grammar is hierarchical — entity, collection, domain — and events name
   the *narrowest* scope they can prove. Surgical invalidation is what makes
   push cheaper than polling; an event that always says "everything changed"
   is a poll with extra steps.
2. **Still relevant?** The consumer checks the scope against what it is
   currently showing. Events for entities nobody displays are dropped at the
   door — this filter is what lets a busy system push freely.
3. **Refetch now or on demand?** Visible scope: refetch now. Cached but
   hidden scope: mark stale, refetch when next shown. The stale mark is the
   cheapest and most underused move in the grammar — it converts push volume
   into deferred, deduplicated reads.

## The race: an event overtakes an in-flight read

The classic incident on this surface: a read is in flight; a change lands
and its event arrives; the consumer refetches; the *first* read — issued
before the change, stale by construction — completes last and overwrites
the fresh result. Now push works, reads work, and the display is still
wrong, because the loser wrote last.

The remedies, in order of robustness:

- **Generation tokens.** Each scope holds a fetch generation; issuing a read
  captures it; invalidation increments it; a completing read whose captured
  generation is stale is discarded. This is
  [identity-survives-reuse](../../_laws.md#identity-survives-reuse) applied
  to reads: the read's identity, minted at issue, decides its authority —
  its arrival time never does.
- **In-flight coalescing.** An invalidation arriving during a fetch marks
  the scope dirty; the completing fetch, seeing dirt, applies and
  immediately re-issues. Simpler; slightly later convergence.
- **Not** timestamps-on-arrival, and **not** "the newest response wins" —
  response arrival order is the thing the race scrambles.

## Optimistic pre-paint, tethered

Pure invalidation pays one round trip before the screen changes, and for
high-signal moments (the user's own action completing, a status flipping to
failed) that beat is perceptible. The payload may carry the obvious delta
and the consumer may paint it immediately — under two tethers:

- the pre-paint is provisional and the refetch it triggers still runs;
  whatever the read returns **replaces** the pre-painted value, agreeing or
  not;
- the pre-paint only ever touches the scope the event names — no inferred
  writes to neighbors ("the parent's count probably incremented too" is how
  divergence sneaks back in through the optimization).

Pre-paint plus mandatory reconcile keeps the latency win and the truth
hierarchy; pre-paint without the reconcile is replication-by-payload again,
arrived at incrementally and shipped by accident.

## The safety net is part of the design

Because push is advisory, the system states how staleness heals when push
fails entirely: refetch on scope re-display, refetch on window focus or
reconnect, and — where the domain warrants it — a slow periodic sweep. These
are not embarrassing fallbacks to hide; they are the floor that makes
aggressive push optimization safe to build on. The drop ledgers from the
[golden path](../realtime-events.md)'s shedding rule tell you how hard this
floor is working; a rising drop count with a healthy floor is a tuning
signal, with no floor it is an incident.
