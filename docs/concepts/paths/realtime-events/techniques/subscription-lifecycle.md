---
layer: technique
subject: realtime-events
technique: subscription-lifecycle
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Subscription lifecycle

A subscription is a resource: it holds a callback alive, the callback holds
its closure alive, and the closure usually holds a view or a store alive. The
technique is the discipline that every subscription created is destroyed
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — including
in the awkward interleavings that actually occur in long-lived interactive
applications, which are the whole game. The happy path (attach on mount,
detach on unmount) is one line; the technique is the other five cases.

## The zombie is worse than the leak

A leaked subscription costs memory. A **zombie** subscription — one whose
owner is gone but whose callback still fires — costs correctness: it paints
state into a store nobody renders, double-fires side effects when its
replacement also fires, and throws from closures over dead resources. Every
rule below exists to prevent zombies first and leaks second.

## The cancelled flag: teardown races the handshake

Where subscribing is asynchronous — any process-boundary subscription is —
there is a window between *requesting* the subscription and *holding* it.
If the owner tears down inside that window, a naive cleanup finds nothing to
detach (the handle doesn't exist yet) and the handshake completes afterward
into a subscription that nobody owns: a zombie born fully formed.

The discipline is a cancelled flag scoped to each attach attempt:

- teardown sets `cancelled` and detaches the handle *if it exists*;
- the handshake continuation checks `cancelled` **first** — if set, it
  immediately releases the just-created subscription instead of storing it.

Both halves are mandatory. The flag without the continuation check is a
comment; the continuation check without the flag has nothing to read. And
the flag is per-attempt, not per-owner: an owner that detaches and rapidly
re-attaches (remount, dependency change) has two attempts in flight, and a
shared flag lets the stale handshake adopt the new attempt's identity —
identity must survive reuse
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

## Singleton at the boundary, fan-out inside

Boundary subscriptions are expensive: a handshake, a serialization channel,
sometimes a per-subscription resource on the far side. When N consumers in
one process want the same event name, N boundary subscriptions is N times
the cost for one unit of information — and N opportunities for the races
above. The correct topology:

- **One native listener per event name**, created lazily when the first
  consumer arrives.
- **An in-process subscriber set** the native callback fans out to.
  Attaching a consumer is a set insertion; detaching is a removal. Cheap,
  synchronous, unable to race the boundary.
- **Reaping**: when the last consumer leaves, the native listener is
  released — after a grace period if thrash is expected (a view detaching
  and reattaching within one navigation should not cycle the boundary
  handshake). The singleton's creation names its reaper: last-out releases,
  or an explicit registry shutdown does.

The fan-out loop has one sharp edge: a consumer's callback may detach other
consumers (or itself) mid-dispatch. Iterate over a snapshot of the set, and
define whether a consumer detached mid-dispatch still receives the in-flight
event (either answer is fine; undefined is not).

## The early-arrival buffer

The singleton creates a gap the naive design doesn't have: events can arrive
after the native listener is live but before the first in-process consumer
attaches — or between one consumer's detach and the next's attach. For
events that mark rare, important transitions (a completion, a failure),
dropping the early arrival means a consumer that attaches milliseconds late
misses the only event it cared about.

The remedy is a small **bounded** buffer in the singleton: events arriving
with zero consumers are held (newest-retained, oldest evicted — the buffer
must not become an unbounded queue with its own outage); the next consumer
to attach is replayed the buffer, marked as replay if consumers care about
tense. Two disciplines keep it honest:

- the buffer is *per name* and *small* — it is a race-closer, not a history;
  consumers needing history need a read path, not a longer buffer (see
  [push-vs-refetch-reconciliation](push-vs-refetch-reconciliation.md));
- eviction is counted, per the shedding rule in the
  [golden path](../realtime-events.md).

## Teardown is idempotent and total

Detach paths get called twice (defensive callers, error paths that also run
finally paths), and they get called in every state: before the handshake,
during it, after it, after the far side already died. Teardown therefore:

- is idempotent — a second call is a no-op, not a crash;
- never assumes the far side is alive — releasing a handle whose channel is
  already gone must succeed locally;
- runs in a context that cannot be interrupted by the very event flow it is
  tearing down.

## The audit question

The lifecycle is healthy when the system can answer, at any moment: *which
names have native listeners, how many in-process consumers each has, and
how many buffered early arrivals are waiting*. That census is a debugging
tool on day one and a leak detector forever — a native listener with zero
consumers outside its grace period is a reaper that failed, found by
counting rather than by profiling a heap dump six months later.
