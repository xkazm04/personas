---
layer: application
subject: embedded-db
technique: quiet-window-maintenance
stack: rust
---

# Quiet-window maintenance in the Rust data layer

The repo implements the technique's two-condition gate in one small task,
`spawn_idle_maintenance_task` (`src-tauri/db/src/lib.rs:226-260`), and its
activity gauge is a real front-door instrument rather than a proxy — the
core of the technique done right, with three of its refinements absent.

## The gauge: `ipc_in_flight` (`src-tauri/core/src/ipc_gauge.rs`)

An `AtomicUsize` incremented and decremented by the IPC auth layer's RAII
guard around every command (`enter`/`leave`, `ipc_gauge.rs:20-27`). The
module doc states the purpose: *"`db` polls this to pick a quiet moment for
maintenance work."* This satisfies the technique's gate-sees-target demand
exactly — the counter is maintained at the application's actual front door
(every IPC command), not derived from wall clock, OS idle, or last-query
time. The layering note is worth copying too: the *counter* was moved down
to the core crate so the data layer can read it while the guard that
increments it stays in the IPC layer — the gauge is readable from below
without inverting the dependency graph.

## The two-condition gate

```rust
// db/src/lib.rs:229-257 (abridged)
loop {
    if personas_core::ipc_gauge::ipc_in_flight() == 0 {
        for (name, pool) in [("personas.db", &primary_pool),
                             ("personas_data.db", &user_pool)] {
            ... "PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);" ...
        }
    } else {
        tracing::debug!(in_flight = ..., "SQLite idle maintenance deferred while IPC is active");
    }
    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
}
```

Interval (300s) bounds cost, gauge bounds interference — the technique's
standard form. Two details deserve note: the initial 30s sleep (`:228`)
keeps maintenance out of the boot window, and the loop covers **both**
stores, which is the golden path's second-database inventory obligation
honored for maintenance specifically — the user-facing store gets the same
checkpoint discipline as the app store, in the same loop.

## Where the implementation stops short of the technique

Deviations, reported not registered:

1. **No escalation ladder.** The gate defers indefinitely: a session with
   continuous IPC traffic never checkpoints, and nothing measures journal
   size to force the technique's "past a hard bound tied to a measurable
   harm, run regardless" rung. The deferral arm is only a `tracing::debug!`
   (`:252-256`) — below the level anyone reads in production — so a month
   of consecutive deferrals is indistinguishable from a healthy store
   (the technique's failure-not-empty-success point, unhandled).
2. **The aggressive checkpoint form, unconditionally.** `TRUNCATE` is the
   blocking end of the checkpoint spectrum; the technique's chunk-yield
   discipline (bounded batches, gauge re-read between chunks) has no
   purchase here because the whole pass is one `execute_batch`. Defensible
   at current store sizes, but the escalation ladder and the chunked form
   are the same missing structure seen from two sides.
3. **Passes are not recorded.** Success is a `debug!`, failure a `warn!`
   (`:240-248`); nothing lands in the perf ring (`db/src/perf.rs`), so the
   flight-recorder questions — "is maintenance actually running?", "was
   that stall at 14:03 a checkpoint?" — are answerable only if someone
   had tracing at debug level at the time.

One boundary observation confirming the technique's last section: the
correctness-critical maintenance — the pre-migration snapshot
(`db/src/backup.rs:48`, called from `init_db_with_journal` at
`lib.rs:296`) — correctly does *not* wait for a quiet window; it runs at
its mandated moment, before the pool opens the file. The window is for
polite work; recovery-class work ignores it, exactly as the technique
prescribes.
