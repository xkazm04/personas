---
layer: technique
subject: webhook-ingestion
technique: duplicate-and-replay-dedup
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Duplicate and replay dedup

At-least-once delivery is the standing promise of every serious webhook
producer, and it means exactly what it says: the same fact will arrive more
than once, on purpose, whenever the sender's machinery doubts your answer. A
timeout counts as doubt even when your processing succeeded — the sender
never saw the acknowledgment, so it retries. An ingress that treats each
arrival as a fresh fact turns the sender's reliability mechanism into your
correctness bug: double-fired automations, double-minted events, double
side effects. The fix is identity, applied once, at the mint point.

## Delivery identity: prefer the sender's, fall back to content

The dedup key is the **delivery's identity**, and the best identity is the
one the sender minted: mature producers stamp each delivery with a unique
identifier that is *stable across their retries* — the retry of a delivery
carries the original's identifier, which is precisely the property dedup
needs ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
When the sender provides one, use it, namespaced by source (two senders'
identifier schemes may collide; a delivery's identity is
`(source, sender-delivery-id)`, never the bare id).

When the sender provides none, fall back to a **content digest within a
bounded time window**: the digest of the raw body (already in hand from
signature verification's raw-bytes discipline), valid as a dedup key for a
window sized to the sender's documented retry horizon. The window matters:
content-identical deliveries *outside* it may be legitimately distinct facts
(a sensor reporting the same reading twice), so an unwindowed content key
quietly deduplicates reality. Sender id when available, windowed digest when
not — and record *which* kind of key each delivery was deduplicated by.

One more rung on the ladder when deliveries arrive over a subscription
channel rather than direct requests: **the transport's own message position**
(a stream's per-message identifier) outranks even the sender's delivery id,
because it serves double duty — it is a dedup key *and* a resume cursor. A
channel that replays recent history on every reconnect stops manufacturing
duplicates entirely when the receiver presents the last position it
processed; dedup then only has to absorb what resumption could not prevent.
Prevention by cursor, absorption by key, in that order.

## Dedup at the mint point, before the event exists

The check-and-mint is one operation at one place: look up the delivery
identity; if seen, record the arrival as a duplicate (verdict attached, in
the delivery log) and acknowledge the sender with success — **a duplicate is
a successful delivery from the sender's point of view**, and answering it
with an error trains their retry machinery to keep trying; if unseen, mark
and mint atomically. The mark-then-mint pair must not have a gap a second
concurrent arrival can slip through: two copies of one delivery arriving
milliseconds apart (senders do this) both find "unseen" unless the mark is a
uniqueness-enforced write, not a read-then-write.

Downstream of the mint, responsibility changes hands: whether the *internal*
processing of a minted event runs exactly once, retries, or requeues is
delivery-guarantees' ground, not this technique's. The boundary artifact is
clean — one external fact, one minted internal event with its own identity;
everything after that identity exists is another subject.

## Sender retry vs replay attack: same bytes, different threat

Two phenomena produce a repeated delivery, and conflating them mis-assigns
both owners:

- A **sender retry** is benign and contractual: same delivery id, arriving
  within the retry horizon, signature valid, timestamp original-or-fresh per
  the sender's convention. Dedup absorbs it silently and counts it.
- A **replay attack** is an adversary re-transmitting a captured legitimate
  delivery — signature valid by construction (the bytes are legitimate),
  identity identical. Dedup *also* absorbs it while the identity is
  remembered — but dedup memory is bounded and the attacker is patient. The
  durable countermeasure is the **timestamp window** inside sender
  authentication: a replayed delivery eventually presents a stale signed
  timestamp, and the window rejects it regardless of dedup state.

The division of labor: dedup owns the bounded recent past; the timestamp
window owns everything older. Both must exist — dedup without the window
leaves old-replay open; the window without dedup leaves the retry horizon
full of double-mints.

## Bounded memory, honest counters

Dedup marks are state, and unbounded state is a slow leak. The mark store is
bounded — by age at minimum, sized comfortably past both the sender retry
horizon and the authentication timestamp window (a mark that expires before
the window closes re-opens the gap between the two defenses). Expiry is the
mark's named reaper, and the bound is a visible number, not an accident of
memory pressure.

And the counters: duplicates absorbed, per source, per key kind
([count-carries-predicate](../../_laws.md#count-carries-predicate)). A
gentle background rate of duplicates is the sender's contract working; a
spike is a diagnosis — their timeout is misconfigured, your acknowledgment
is slow, or someone is replaying traffic. The counter is how the three are
told apart, and an ingress that absorbs duplicates without counting them has
converted its best early-warning signal into silence.
