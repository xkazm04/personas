---
layer: technique
subject: device-pairing
technique: timing-defenses
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Timing defenses

Every response the pre-trust surface emits is a measurement taken by a
party who has proven nothing. This technique makes those measurements
worthless: a refusal carries one bit — "no" — and nothing else, not in its
latency, not in its shape, not in its ordering. The defender's copy of the
distinctions moves to the audit ledger, where it belongs.

## Constant-time comparison, and where it actually matters

An early-exit byte comparison of a presented credential against a stored
one returns faster the earlier the first mismatch — leaking, through
latency, how many leading bytes matched. To a caller who can measure round
trips, that converts an unguessable value into a guessable-byte-at-a-time
value. On a local or same-network surface the attacker's timing resolution
is excellent, so the defense is not paranoia; it matches the measured
channel.

The discipline:

- **compare fingerprints, in constant time, over the full length** — XOR
  and accumulate every byte, decide at the end. Comparing *hashes* of the
  presented and stored values (rather than the values) adds a second
  property: the comparison length is fixed and public, so even the
  length-mismatch early return leaks nothing an attacker did not already
  know.
- **audit every equality on a secret path.** The one comparison inside the
  verification function is easy; the leaks live in the periphery — a map
  lookup keyed by the raw token, a string equality in a session check, a
  deduplication pass — each of which is an early-exit comparison someone
  did not think of as one. The review question is mechanical: list every
  place a secret-derived value meets `==`, and justify each or replace it.
- **iterate the whole registry.** When resolving a presented credential
  against N stored fingerprints, check every entry rather than returning
  on the first match. The marginal timing signal of early return over a
  small registry is modest, but the loop shape also removes "how many
  devices exist before mine" from the signal — and the registry is small,
  so the full scan costs nothing.

## The fixed-delay refusal

Failed authentication answers after a **fixed artificial delay** — a few
hundred milliseconds inserted before the refusal leaves. The successes
answer at natural speed. This costs a legitimate user nothing (their
requests succeed) and costs an online brute-forcer everything: the delay
divides guess throughput by orders of magnitude without any lockout
table, counter state, or denial-of-service lever (a lockout keyed on an
attacker-suppliable identifier is a tool for locking *out the legitimate
holder*). The delay is applied on the failure path uniformly — wrong
token and unknown token take the same fixed pause, or the difference
becomes the oracle the constant-time comparison just closed.

The fixed delay does not defend the byte-comparison channel (its jitter
is orders of magnitude above comparison timing, but "delay plus noisy
compare" is still measurable in aggregate) — the two defenses are layered
because they close *different* channels: constant-time closes the
which-byte oracle, fixed-delay throttles the how-many-guesses budget.

## Uniform refusal shapes

Distinct causes must not produce distinct responses on the pre-trust
surface. Wrong credential and missing credential; unknown claim ticket
and expired claim ticket — to the caller these collapse into the same
status, the same body shape, the same latency envelope. Every
distinguishable difference is a probe result: "expired" confirms the
nonce existed; "wrong origin" confirms the nonce is approved and worth
attacking from elsewhere.

Two principled exceptions, both deliberate:

- **the requester's own state machine needs coarse states** — a claim
  poll must distinguish pending / delivered / refused / gone, or the
  legitimate requester cannot function. Grant the minimum vocabulary the
  protocol requires, and note that "gone" (already claimed) is
  deliberately distinguishable because it is the legitimate holder's
  theft alarm.
- **the ledger gets everything.** The refusal the caller sees is uniform;
  the record the defender writes carries the true cause, the peer
  address, the presented identity, the timestamp. Collapsing the response
  without writing the ledger row would be discarding the signal entirely
  — the point is to move it, not to lose it
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  a surface under attack and a surface nobody visits must be
  distinguishable *to the defender*, and the ledger is where they
  differ).

## The budget is part of the contract

Write the numbers down where the code lives: the delay constant, the
comparison discipline, the refusal vocabulary. These are protocol
commitments, not implementation details — a future optimization that
shaves the failure path, or a helpful refactor that adds a descriptive
error message, silently reopens a closed channel, and no test fails
unless one was written. The cheap tests: assert the failure path's
minimum duration, and assert that the set of distinct refusal responses
on the pre-trust surface has exactly the cardinality the protocol
documents.
