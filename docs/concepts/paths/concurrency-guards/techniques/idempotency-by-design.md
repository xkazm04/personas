---
layer: technique
subject: concurrency-guards
technique: idempotency-by-design
status: forged
laws:
  - identity-survives-reuse
shared_with: []
---

# Idempotency by design

Guards prevent duplicates the guard can see. A whole class of duplicates is
invisible to any guard: the retry of a request whose response was lost (the
work succeeded; the caller couldn't know), the replayed message from an
at-least-once queue, the re-run of a startup sweep after a crash mid-batch,
the second delivery of a webhook. In every one of these the *first* attempt
already finished — there is nothing in flight to collide with, so no
in-flight set can object. The only defense that covers them is making the
operation **safe to run twice**: the second execution converges on the same
final state as the first, instead of stacking a second effect on top.

Idempotency is therefore not the fallback for when guarding is impractical —
it is the stronger property. A guarded, non-idempotent operation is protected
against exactly one duplication channel; an idempotent operation is protected
against all of them, including the channels nobody has imagined yet. The
mature posture (the golden path's belt-and-suspenders stance) is: idempotency
wherever the operation's semantics allow it, guards layered on where starting
twice is itself expensive or visible.

## The three tools

- **Natural keys.** Give the created thing an identity derived from what it
  *is*, not from when it was made (law: identity-survives-reuse) — the
  import keyed by source identity, the report keyed by period, the
  registration keyed by the registered entity. The second attempt computes
  the same key, collides with the first at the uniqueness boundary, and the
  collision *is* the dedup — handled as "already done," not as an error. The
  store's uniqueness enforcement does atomically what any hand-rolled
  check-then-insert only approximates.
- **Conditional writes.** State the precondition in the write itself:
  update-where-status-is-pending, create-if-absent, set-if-version-matches.
  The first attempt satisfies the condition and flips it; the second finds
  the condition false and affects zero rows — and "zero rows affected" is
  read as *already done*, a success variant, not a failure. Absolute writes
  ("set counter to 5") are idempotent by arithmetic; relative writes
  ("increment counter") never are, and every relative write in a
  possibly-replayed path is a bug waiting for its replay. One discipline
  binds this tool: **the already-done verdict comes from the write itself**
  — the affected-row count, a created-vs-found flag returned by the atomic
  insert — never re-derived afterwards by reading the resulting state. A
  proxy read ("the row's status says it already started, so skip the side
  effect") is false precisely in the window the dedup exists for: the
  deduplicated row looks exactly like a fresh one until the first attempt
  progresses, so both callers pass the proxy check and the effect doubles
  anyway. Only the writer knows whether it wrote.
- **Dedup at the effect.** Where the operation's effect leaves the system —
  a message sent, a charge made, an external record created — carry an
  operation identity to the boundary and let the receiving side (or a local
  effect ledger consulted before emitting) drop the repeat. This is the
  idempotency-key pattern: the *intent* is minted once, upstream, and every
  physical attempt to realize it presents the same key. The key must be
  minted before the first attempt and survive retries — a key minted per
  attempt deduplicates nothing.

## Idempotency has a scope and a window

"Safe to run twice" is a claim with fine print, and the fine print should be
written down. **Scope:** which effects converge — the state write may be
idempotent while a log line, a metric increment, or a notification still
doubles. Either widen the design until the doubled effects are harmless, or
name the non-idempotent residue explicitly so nobody assumes it is covered.
**Window:** dedup-at-the-effect usually remembers keys for a bounded period;
a replay arriving after the ledger expired is a duplicate again. The window
must comfortably exceed the longest plausible replay (queue retention, retry
horizon), and the expiry choice is a documented trade, not an accident of
cache defaults.

## Convergent, not silent

An idempotent operation that detects "already done" should still *report*
distinguishably — same final state, honest account. Returning the original
outcome (or an explicit already-applied marker) preserves observability:
operators can see replay rates, and callers that care can tell first
application from repeat. Collapsing both into an indistinguishable "ok"
works until someone needs to know why an operation reports success while its
side effect visibly happened days ago.

## Decision rules

- Enumerate the duplicate channels for each operation: concurrent start
  (guards can cover it), post-completion replay (only idempotency covers
  it). An operation with any replay channel needs idempotency regardless of
  how well it is guarded.
- Prefer natural keys over generated ones wherever the domain offers an
  identity; let the store's uniqueness boundary be the dedup point.
- Write conditionally; treat condition-not-met as the already-done success
  variant, and reserve failure spelling for actual failure.
- Ban relative writes on any path that can replay.
- Mint idempotency keys with the intent, before the first attempt; a
  per-attempt key is decoration.
- Document each operation's idempotency scope (which effects converge) and
  window (how long dedup memory lasts), and size the window from real replay
  horizons.
