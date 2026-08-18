---
layer: technique
subject: realtime-events
technique: outbound-fan-out
status: forged
laws: [derivation-names-recomputation, failure-not-empty-success, creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Outbound fan-out

The outbound leg delivers named events to consumers outside the process —
notification channels, partner endpoints, chat integrations — and it
inverts every comfortable assumption of the in-process bus. Delivery is
slow (a network round trip per attempt), unreliable (the receiver is down,
rate-limiting, or gone), and costly (quotas, per-message billing, the
receiver's patience). Fire-and-forget fan-out at emit time couples the
emitter's latency and failure to systems it has never heard of — the exact
coupling the bus exists to remove. The technique is a different machine:
**a pull loop over a durable event record, with per-subscription progress
marks**.

## The watermark: subscriptions pull, deliveries advance a mark

The event record is an append-only sequence with a monotonic position
(sequence number or equivalent). Each outbound subscription owns one
durable **watermark**: the position up to which delivery has been settled.
A periodic dispatch tick, per subscription:

1. read events after the watermark, filtered to the subscription's names;
2. attempt delivery, in order;
3. advance the watermark past what settled; leave it on what did not.

Every property the emit-time push lacks falls out of the shape: crash
recovery is free (the watermark is durable; the tick resumes where
delivery actually stood — the mark is the stored derivation of "what has
been delivered", and the tick is its named recomputation,
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation));
a slow receiver slows only its own subscription's mark; the emitter never
blocks on, or even knows about, the outbound leg. The one discipline the
shape demands: **advance after settlement, never before** — a mark moved
optimistically before the attempt converts each crash into silent loss,
and at-least-once quietly becomes at-most-once with no one deciding it.

The corollary receivers must live with: at-least-once means duplicates
after a crash-between-deliver-and-advance. Carry a stable event identity
in the payload so idempotent receivers can deduplicate; do not promise
exactly-once you cannot implement.

Two shape details that look optional and are not. **The mark is per
subscription.** A single cursor shared across subscriptions couples their
fates: one failing receiver pins the shared mark to retry *its* events, which
re-fetches — and re-delivers — everyone else's; the patches this forces
(excluding chronically-failing receivers from pinning, probing them
occasionally) reintroduce the loss-accounting problems the watermark existed
to solve. **The position pairs the clock with an identity tiebreaker.** A
timestamp alone is not a position: two events sharing one tick make "after
the watermark" ambiguous, and the boundary event's siblings are silently
skipped or re-sent depending on comparison direction. Position = (monotonic
ordinate, unique id), compared as a tuple —
[identity-survives-reuse](../../_laws.md#identity-survives-reuse), applied to
a cursor.

## Forward-only on first enable

When a subscription is created or re-enabled, its watermark initializes to
**now** — the current tail of the record — not to zero. A subscriber
enabling a channel wants to hear what happens next; replaying the entire
retained history *into an external channel* is at best a spam incident and
at worst disclosure of months of history to a receiver whose authorization
is new. Backfill, where a receiver genuinely wants history, is an explicit
separate request with its own bounds and its own consent — never the
accidental meaning of "on".

The same rule governs long-disabled subscriptions on re-enable, and the
gap deserves one honest summary event ("N events occurred while paused")
rather than either silent skipping or a flood
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) —
the pause happened; say so).

## Per-tick caps: the flood is always coming

Some tick will wake up to a thousand pending events — a bulk operation, a
long outage ending, a runaway producer. Uncapped, the dispatch loop
becomes the flood's amplifier into rate-limited external systems, which
respond by throttling, which extends the backlog, which deepens the next
flood. Bounds, all present at once:

- **per-tick delivery cap** per subscription — the backlog drains over
  ticks at a survivable rate, and the watermark makes partial drains safe
  by construction;
- **coalescing where the channel is for humans** — fifty occurrences of
  one event name in one tick is one digest message with a count, not
  fifty pings ([count-carries-predicate](../../_laws.md#count-carries-predicate):
  the digest states what it collapsed);
- **backlog-age alarm** — when the oldest undelivered event exceeds a
  threshold, that is an operator signal, not a reason to silently widen
  the cap.

## Failure taxonomy: retry, back off, or dead-letter

Attempts fail differently and the loop treats the classes differently:

- **transient** (timeout, 5xx-equivalent, rate-limit): leave the watermark,
  retry next tick with per-subscription exponential backoff — one dead
  receiver must not consume the tick's budget every cycle;
- **permanent for the event** (payload rejected as malformed): dead-letter
  *the event* — record it with its reason, advance past it. One poison
  event must not dam the subscription forever;
- **permanent for the subscription** (endpoint gone, credentials revoked):
  after a bounded strike count, disable the subscription and surface it to
  its owner. Retrying into a revoked credential forever is noise in the
  logs and a security smell on the wire.

The dead-letter record is the leg's honesty ledger: every event that will
never be delivered is written down with its reason. Silent abandonment —
advancing the mark past a failure with no record — is the outbound form of
shed-without-counting.

## Subscriptions are owned resources

An outbound subscription carries credentials, an endpoint, and an implied
consent, so its creation names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)): who can
disable it, what auto-disables it (the strike rule), and what happens to
its watermark and dead-letter record when it is deleted. The audit
question that finds rot: *which subscriptions delivered nothing in N days,
and is that because nothing matched — or because every attempt failed and
nobody was told?* The two must be distinguishable from the records alone;
if they are not, the ledger is decoration.
