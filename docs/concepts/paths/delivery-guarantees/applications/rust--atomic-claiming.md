---
layer: application
subject: delivery-guarantees
technique: atomic-claiming
stack: rust
---

# Atomic claiming in the Rust event bus

The event pipeline's claim discipline lives in two files:
`src-tauri/db/src/repos/communication/events.rs` (the conditional writes) and
`src-tauri/src/engine/background/` (the tick that orders everything around
them). It demonstrates the technique's core move exactly — and its one
omission is the repo's cleanest illustration of why the technique demands
claim evidence.

## The claim is one conditional write

`claim_pending` (`events.rs:239-256`) is the election in a single statement:

```sql
UPDATE persona_events SET status = 'processing'
WHERE id IN (SELECT id FROM persona_events WHERE status = 'pending'
             ORDER BY created_at ASC, id ASC LIMIT ?1)
RETURNING *
```

No read-then-write pair, no lock: the store's atomicity on one guarded
`UPDATE` is the whole mechanism, and the `RETURNING` rows are the election
result — the doc comment states the purpose ("prevents duplicate processing
when tick intervals overlap"). Batch claiming is the same write with a limit
(50 per tick, `background.rs:1189`), exactly the technique's "batch claims
are the same write" rule.

`claim_pending_headless` (`events.rs:266-287`) shows claim-scope discipline
evolving under fire: the daemon (a *separate process* on the same store)
claims only rows it owns by filtering ownership inside the claim SQL itself.
The comment records why — the earlier claim-then-release ping-pong re-claimed
the same 5 non-headless rows every 5s tick, plus a starvation window. Claim
only what you will process; releasing is not free.

## Claim before compute; complete conditionally

`event_bus_tick` (`background.rs:1155+`) orders the tick per the technique:
reap first (step 0, `:1180`), claim atomically (step 1, `:1189`), and only
then match subscriptions and dispatch. The full-batch wake re-arm
(`:1196-1204`) leans on the claim's atomicity explicitly: "Claim atomicity
(pending→processing above) makes redundant wakes harmless."

The completion side is `reap_stuck_processing` (`events.rs:961-999`): the
reaper's verdict is one `UPDATE … WHERE id = ?5 AND status = 'processing'`,
so a terminal write from the tick that actually owns the row always wins the
race — the reaper observing `None` counts it as `raced`, not an error
(`background.rs:1130-1134`). Slow-but-alive loses politely, precisely as the
technique's completion protocol requires.

## The omission: anonymous claims, and what they cost

`claim_pending` writes *only* the status. No holder id, no claimed-at
timestamp, no lease — the doc comment on `list_processing_ids`
(`events.rs:936` block) says it outright: "the row carries no claim timestamp
to lean on (`claim_pending` sets only `status`)." The downstream bill is paid
in `background.rs`: because stuck detection has no evidence to read, the
reaper runs the technique's floor protocol — the two-snapshot watch
(`stuck_reap_seen`, `background.rs:117-122`; `partition_stuck_candidates`,
`:1051-1062`) with a 5-minute interval whose safety argument is a comment
about worst-case cadences (`:1028-1037`), i.e. a folklore threshold defended
by prose instead of a lease deadline defended by data. This is the
registered claims-without-identity deviation (anchor `w2-background-jobs` in
`docs/concepts/golden-path-deferred-fixes.md`); the degraded-but-honest
reaper it forces is documented as the fallback tier in stuck-reaping.
