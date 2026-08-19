---
layer: application
subject: realtime-events
technique: change-data-capture
stack: rust
---

# Change data capture — SQLite update hook feeding Tauri events

How this repo implements the [change-data-capture](../techniques/change-data-capture.md)
technique: `src-tauri/db/src/cdc.rs` registers a `rusqlite` `update_hook` on
every pooled connection (via the r2d2 `CdcCustomizer`) and forwards change
facts to the frontend as Tauri events.

## The hook observes, doesn't act

The hook body does exactly what the technique's hot-path rule demands —
allowlist check, minimal fact, non-blocking send, return:

```rust
conn.update_hook(Some(move |action, _db, table: &str, rowid: i64| {
    if table_to_event(table, action.into()).is_some() {   // cheap allowlist
        let event = CdcEvent { action: action.into(), table: table.to_owned(), rowid };
        match tx.try_send(event) {                        // bounded, non-blocking
            Ok(()) => {}
            Err(TrySendError::Full(dropped)) => note_cdc_drop(&dropped.table),
            Err(TrySendError::Disconnected(_)) => {}      // shutdown — nothing to record
        }
    }
}))?;
```

The payload is identity-shaped (`action`, `table`, `rowid`) — no row data
crosses the hook. Coarsening and enrichment happen on the consumer side of
the channel: the drain task maps physical table names to registry event names
(`table_to_event`), and only for `persona_events` rows does it fetch the full
row (decrypting the at-rest payload — the delivery path must not leak
ciphertext to the bus).

## The drop ledger

`note_cdc_drop` is the shed-with-accounting rule, allocation-free because it
runs inside the write path: a global `AtomicU64` (`CDC_DROPPED`), a **loud
warning on the first drop** ever, then a heartbeat warning every 1,000 —
so a newly overloaded channel is immediately visible and a persistently
saturated one stays visible without flooding the log. The count carries its
predicate (which table, running total), is exported via
`cdc_dropped_count()`, and is exercised by a test that overflows a
capacity-1 channel and asserts the delta. The technique's remaining gap here:
the counter is readable but not yet wired to a health surface, and no
"capture degraded, refetch advised" event is emitted on drops — consumers
heal via their poll/refetch floors.

## The consumer that is not born yet

The startup-blackout section of the technique is implemented literally.
Emitting before the WebView IPC bridge exists produces tens of thousands of
rejected sends, so the drain task must wait ~6s — but writes start
immediately. The three-part remedy:

1. **Drain immediately**: a dedicated reader thread drains the bounded
   `sync_channel` into an unbounded tokio channel from the first moment, so
   the fixed-capacity channel is never left filling with nobody consuming
   (the earlier defect: the 512-slot channel overflowed during boot bursts).
2. **Watermark before the blackout**: `max_persona_event_rowid` is captured
   *before* the wait; after the bridge is ready,
   `replay_persona_events_after` re-emits every row past the watermark from
   the database — the durable rows are the authority, the channel was only
   the fast path.
3. **Consumer dedupe by identity**: the frontend event log dedupes by id, so
   replay overlapping queued channel deliveries is harmless double-delivery,
   not duplication.

## Deviation from the technique: no commit gating

The technique requires captured facts to be staged per transaction and
released on commit; `update_hook` fires per row *inside* write transactions,
and the drain task emits without commit staging — a rolled-back write can be
advertised, and a fast reader can refetch before the commit lands. The repo
mitigates rather than solves: the bus wake for new `persona_events` rows is
signalled from the drain consumer ("effectively committed" by then, per the
in-code comment), UPDATE re-fetches the now-current row so late reads
self-correct, and every frontend consumer is invalidation-style with a poll
heartbeat as the floor. The mitigation holds because push is never the
source of truth here — which is the golden path's core rule doing exactly
the load-bearing work it was designed for.

Second deviation, doubling as the subject's counter-example: six of the
`table_to_event` target names (`"memory-updated"`, `"credential-updated"`,
`"trigger-updated"`, `"subscription-updated"`, `"automation-updated"`,
`"tool-updated"`) are string literals minted outside both registry files —
invisible to `scripts/check-event-registry.mjs`, which only compares names
declared *in* the two registries. The
[event-registry](../techniques/event-registry.md) gate rule (a name emitted
anywhere that is not in the registry fails) is the missing enforcement.
