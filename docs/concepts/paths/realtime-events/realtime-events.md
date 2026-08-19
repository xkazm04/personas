---
layer: golden-path
subject: realtime-events
status: forged
techniques:
  - event-registry
  - subscription-lifecycle
  - coalescing-and-batching
  - push-vs-refetch-reconciliation
  - change-data-capture
  - outbound-fan-out
evidence:
  - src/lib/eventRegistry.ts                          # TS side of the mirrored registry: EventName constants + EventPayloadMap + compile-time exhaustiveness assertions + typedListen/typedEmit
  - src-tauri/core/src/events.rs                      # Rust authority: event_names! macro, compile-time constants, ALL_EVENT_NAMES
  - scripts/check-event-registry.mjs                  # the parity gate — fails the build when the two registries' name sets diverge
  - src/hooks/realtime/createSingletonListener.ts     # singleton native listener + fanned-out subscriber set + bounded early-arrival buffer (50) with counted drops + per-frame coalescing + last-out teardown
  - src/hooks/useTauriEvent.ts                        # cancelled-flag subscription lifecycle (both halves: teardown sets, handshake continuation checks)
  - src-tauri/db/src/cdc.rs                           # storage change hook → bounded channel with drop counter (loud first drop, per-1000 heartbeat) + startup-blackout watermark replay
  - src-tauri/engine/src/bus.rs                       # subscription matching: self-scoping default, cross-team wildcard bleed guard, capability-scoped dedupe
  - src-tauri/src/engine/webhook_notifier.rs          # outbound leg: durable watermark advanced only past settled deliveries, forward-only seeding, per-tick cap, circuit breaker
  - src/stores/slices/overview/eventSlice.ts          # push-with-reconcile consumer: dedupe by id, bounded list, authoritative fetch path retained
counter_evidence:
  - src-tauri/db/src/cdc.rs                           # ALSO the key counter-example: table_to_event mints six event names as string literals outside both registries — invisible to the parity gate, which only compares the two registry files
deviations:
  - w2-realtime-events   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Event bus & realtime subscriptions

An event bus is the surface you build when parts of a long-lived application
must react to facts they did not cause: a background engine finishes a job and
a dashboard three layers away must reflect it; a record changes in storage and
every view holding a copy must know; an external channel wants to be told when
something notable happens. The unit of currency is the **discrete named
event** — a fact with a name from a closed vocabulary and a payload with a
declared shape — not a byte stream, not a growing transcript. (The continuous
per-run output stream — tokens, log lines, incremental text — is a different
subject with different physics; see
[streaming output](../streaming-output/streaming-output.md). The boundary is
sharp: a stream carries *one producer's unbounded output*, an event carries
*one fact*. When a stream ends, its terminal outcome crosses back into this
subject as a named event.)

The job is not "deliver messages". The job is to let N producers inform M
consumers **without either side knowing the other exists**, while keeping
three promises that decoupled systems break by default: the vocabulary of
event names stays coherent as it grows, every subscription that is created is
also destroyed, and a delivery path that sheds load says how much it shed.

That definition decides when *not* to use events:

- **When the producer knows its consumer**, a direct call is better. An event
  between two modules that always fire-and-catch in lockstep is a function
  call wearing a disguise — you pay the decoupling tax (no compile-time
  reachability, no stack trace across the hop) and collect none of the
  decoupling benefit.
- **When the consumer needs every occurrence, in order, across restarts**, a
  bus is the wrong organ. In-process events are at-most-once and die with the
  process; what that requirement describes is a durable queue or log, with
  acknowledgement and replay. Pretending a bus is a queue is how "we missed
  one" becomes a data-integrity incident instead of a cosmetic staleness.
- **When the "event" is a request** — the emitter expects an answer, a
  success/failure, a return value — that is a command, and commands deserve a
  call boundary with a real error path, not a broadcast into the dark.

## The name is the contract

Everything in this subject hangs off one discipline: **the set of event names
is a closed vocabulary with exactly one authoritative definition**, and every
producer, every consumer, and every mirror of the vocabulary in another
language derives from it
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
An event system where names are string literals minted at emit sites is not a
contract, it is a rumor mill: a renamed event silently orphans its
subscribers, a typo'd subscription listens forever to nothing, and both
failures are indistinguishable from "no events happened" — the empty-success
lie ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

The payload is part of the contract, not an afterthought: each name binds to
one declared payload shape, and a consumer may assume that shape *because the
registry promised it*, not because the last few payloads happened to look
that way. When the vocabulary must exist on both sides of a language boundary
— it almost always does — the mirrors are generated or gate-checked against
the authority, never hand-maintained in parallel. The
[event-registry](techniques/event-registry.md) technique owns the vocabulary,
the mirroring, and the parity gate.

## Push is an optimization over refetch — never the source of truth

The single most consequential design decision in a realtime UI layer: **what
does a pushed event mean to the consumer's state?** The durable answer is
*invalidation, not replication*. An event tells a consumer that a fact it
cares about changed — carrying enough identity to be surgical about it — and
the consumer refreshes from the same authoritative read path it would have
used with no events at all. The pushed payload may pre-paint the obvious
delta for latency, but the fetch remains the arbiter.

The alternative — treating the event payload as the new state — builds a
second synchronization protocol by accident, and it fails on every axis at
once: a missed event (process asleep, subscription raced, channel shed) is
now a permanent divergence rather than a moment of staleness; payload shape
becomes load-bearing for correctness rather than latency; and reconnection
requires replaying history instead of issuing one fresh read. A system where
push is an optimization degrades to a working system when push fails. A
system where push is the truth degrades to a wrong one. The
[push-vs-refetch-reconciliation](techniques/push-vs-refetch-reconciliation.md)
technique owns the invalidation grammar and the races between events and
in-flight reads.

## Anatomy: three legs, one spine

A grown application's event plumbing has three distinct legs, and conflating
them is where architectures rot:

- **Backend → frontend**: facts produced by engines, schedulers, and storage
  cross a process or serialization boundary to reach interactive surfaces.
  This leg pays per-message serialization cost and must respect subscription
  lifecycles on the far side.
- **Store → store, in-process**: one state owner informs siblings without
  importing them. Cheapest leg, loosest discipline — and therefore the one
  where ad-hoc emitter singletons multiply. It deserves the same named
  vocabulary as the boundary leg.
- **Application → external channels**: outbound notifications to systems that
  are slow, flaky, rate-limited, and not yours. This leg inverts every
  assumption of the other two — delivery is expensive, failure is normal,
  and the consumer cannot be trusted to keep up — and so it runs on a pull
  loop with durable progress marks, not on the in-process bus's
  fire-and-forget. The [outbound-fan-out](techniques/outbound-fan-out.md)
  technique owns it.

The spine they share is the registry. The legs may differ in transport,
guarantees, and cost; the *names* must not fork per leg, or the system grows
three dialects and translation bugs between them.

## Subscriptions are resources with lifecycles

Every subscription is a resource whose creation names its reaper
([creation-names-reaper](../_laws.md#creation-names-reaper)). The consumer
side of this subject is dominated by one shape: a view or store subscribes on
attach, and must detach on teardown — where teardown includes the awkward
cases that actually occur: the component unmounted *while the subscription
handshake was still in flight* (the cancelled-flag discipline), the same
surface mounted twice transiently, the whole page replaced. Leaked
subscriptions are the slow-motion memory leak of this surface, and worse than
leaks: a zombie subscriber still *acts* — painting dead views, double-firing
side effects.

At a process boundary, subscription setup is expensive enough that the
correct topology is **one native listener per event name, fanned out to N
in-process consumers** — the singleton owns the boundary handshake once, and
consumers attach and detach at in-process cost. The singleton must then solve
what it created: events that arrive after the native handshake completes but
before the first consumer attaches (buffer them, bounded), and the reaping of
the native listener itself when the last consumer leaves. The
[subscription-lifecycle](techniques/subscription-lifecycle.md) technique owns
all of it.

## Delivery honesty: shed with a ledger

In-process delivery is at-most-once, and every hop that crosses a speed
mismatch — a storage engine's change hook feeding a channel, a boundary
bridge, a burst of thousands of row changes hitting a UI — must be **bounded,
and honest about what the bound cost**. The rule is absolute: **a channel
that sheds counts what it shed**, and the count travels somewhere a human or
a health check can see it ([count-carries-predicate](../_laws.md#count-carries-predicate)).
A bounded channel that drops silently converts overload into unexplainable
staleness — the worst bug class, because the system looks healthy at every
point you can observe. Because push is only an optimization (above), shed
events must degrade to staleness that the next refetch heals; the drop
counter is what tells you healing is being asked to do real work. The
[change-data-capture](techniques/change-data-capture.md) technique owns the
storage-side instance of this; the shedding doctrine itself is shared with
[buffering and backpressure](../streaming-output/techniques/buffering-and-backpressure.md)
on the streaming side.

## Cadence: consumers batch, producers don't wait

Producers emit at machine cadence — a bulk operation can fire hundreds of
change events in one tick — and consumers render at human cadence. The
producer must never slow down to spare the consumer (that inverts the
dependency the bus exists to remove); the consumer must never process at
arrival cadence (that melts the interface). The consumer-side answer is
coalescing: absorb a burst, collapse it by key where later facts supersede
earlier ones, apply once per perceptual beat. Where the rendering layer
already batches synchronous cascades, the bus's job is to *not defeat* that
batching by hopping through timers and microtasks mid-cascade. The
[coalescing-and-batching](techniques/coalescing-and-batching.md) technique
owns the collapse rules and the flush guarantees.

## Matching is exact by default

Subscription matching — which subscribers see which event — is part of the
contract, and the default is **exact name match**. Prefix and wildcard
subscriptions are a real need (an observability surface that wants a whole
family) but they are where bleed lives: a wildcard written for one family
matching a sibling family that shares a prefix, an event renamed *into* an
existing wildcard's shadow. Wildcards are therefore explicit, anchored at
declared family boundaries (a segment separator, not a raw prefix), and owned
by the registry so the blast radius of every pattern is enumerable. A
subscriber receiving events it never named is the bus equivalent of a
validation bypass — one door, enumerable writers, applies to readers too
([one-validation-door](../_laws.md#one-validation-door)).

## What the surface owes the operator

A bus is infrastructure; its health claims are observability claims:

- **Every drop point is countable**, with the predicate attached: which
  channel, since when, how many.
- **Subscriber census is inspectable**: which names have listeners, how many,
  since when. A production incident on this surface starts with "who is
  listening to X?" and the system should be able to answer.
- **A dead-letter posture for the outbound leg**: an external delivery that
  fails terminally is recorded with its reason, not retried forever and not
  silently abandoned.

## The techniques

- [event-registry](techniques/event-registry.md) — the closed vocabulary,
  payload contracts, cross-language mirroring, and the parity gate that keeps
  mirrors honest.
- [subscription-lifecycle](techniques/subscription-lifecycle.md) — singleton
  boundary listeners fanned out to consumers, early-arrival buffering,
  cancelled flags, teardown discipline.
- [coalescing-and-batching](techniques/coalescing-and-batching.md) — keyed
  collapse of bursts, perceptual-cadence application, cooperating with the
  renderer's own batching.
- [push-vs-refetch-reconciliation](techniques/push-vs-refetch-reconciliation.md)
  — events invalidate, reads decide; surgical invalidation grammar; the
  event-versus-in-flight-read race.
- [change-data-capture](techniques/change-data-capture.md) — storage-level
  change hooks feeding the bus, transaction-boundary discipline, bounded
  channels with drop ledgers.
- [outbound-fan-out](techniques/outbound-fan-out.md) — durable watermarks,
  forward-only enablement, per-tick caps, retry taxonomy for channels you
  don't control.
