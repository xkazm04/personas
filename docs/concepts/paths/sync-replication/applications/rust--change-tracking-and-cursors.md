---
layer: application
subject: sync-replication
technique: change-tracking-and-cursors
stack: rust
---

# Change tracking and cursors — the cloud sync writer's loop

How this repo implements the
[change-tracking-and-cursors](../techniques/change-tracking-and-cursors.md)
technique: `src-tauri/src/cloud/sync/mod.rs` (the loop and the pass) plus
`src-tauri/src/cloud/sync/cursor.rs` (the durable per-table cursors,
persisted as `app_settings` rows under `CLOUD_SYNC_CURSOR_PREFIX`).

## Tick + lossy wake + persistent dirty mark — all three layers, literally

`spawn_sync_loop` (`mod.rs:447-482`) is the technique's three-layer
cadence in one `tokio::select!`:

- the **periodic tick** is a 45s `tokio::time::interval` — the floor;
- the **change wake** is a `static SYNC_WAKE: Notify` poked by
  `notify_dirty()` from the CDC drain on local mutations, debounced 2s to
  coalesce bursts;
- the **persistent dirty mark** is `SYNC_DIRTY: AtomicBool`
  (`mod.rs:38-44`), and its comment is the technique's argument verbatim:
  `Notify` alone is lossy — its single permit can be consumed by the
  `notified()` future that `select!` drops when the tick wins the same
  poll, and a mutation landing mid-pass (after its table was already
  read) has nothing durable to force a follow-up.

The ordering discipline is exactly right in both directions:
`notify_dirty()` (`mod.rs:147-152`) sets the flag *before* waking, so a
lost permit still leaves the flag observable; the loop clears the flag
*before* the pass (`mod.rs:468`) and re-wakes itself after the pass if
it was re-set (`mod.rs:477-479`), so a mutation that lands mid-pass gets
a prompt follow-up instead of being silently folded into a pass that
already missed it.

## Per-stream cursors, bounded first backfill

`SYNC_TABLES` (`mod.rs:57-69`) is the stream declaration: 11 tables,
each with its own cursor key — a unit test (`mod.rs:524-527`) asserts
key uniqueness so two streams can never share a cursor. First-run policy
is per stream too: `cursor::get_cursor(pool, name, full_backfill)`
(`cursor.rs:33-45`) starts config-sized tables at the epoch (sync
everything) and append-heavy log tables 90 days back (bound the first
push) — the technique's "bounded backfill" as a declared per-stream
flag rather than a hardcoded behavior. `peek_cursor` (`cursor.rs:56-59`)
returns the raw value with no default substituted, so the status surface
can render "never synced" distinctly from a real position.

## Advance from observed data — fixed on one path, still broken on its sibling

`sync_table_inner` (`mod.rs:271-283`) is the observed-max rule with its
rationale in a nine-line comment: the cursor advances to the MAX
watermark value present in the rows just pushed (`observed_max
.unwrap_or(cursor_prev_fallback)`), because the previous version —
wall-clock `now()` captured at pass start — moved the cursor past any
row committed after the SELECT's read snapshot but stamped before that
instant, permanently excluding it from every later pass.

**The counter-example lives 110 lines away in the same file.**
`process_tombstones` (`mod.rs:372-395`) captures
`tick_start = now_rfc3339()` at `:374` and writes it as the cursor at
`:393` — the exact race the comment above describes — and does it
through `let _ =`, discarding the cursor write's failure. Two deviations
from the technique in one line (clock-derived value, swallowed persist
error), sitting in the same module that documents why the first one is
wrong. This is the technique's "apply the rule at every cursor, not just
the busiest one" warning made concrete.

## Watermark-column choice: the bet is visible in the declaration

Six of the 11 synced tables have no last-modified column, so their
streams watermark on `created_at` with a 24-hour resync window
(`resync: true` in `SYNC_TABLES`; the floor computed at `mod.rs:255-259`)
— the technique's "a window is a stopgap with a measured margin, not a
design". The margin was measured (worst observed in-place mutation lag:
11h against the 24h window); any mutation later than the window is
permanently invisible to the far side. The durable fix the technique
prescribes — a last-modified column every write path touches — is a
schema change, tracked in the legacy corpus document for this area
(`docs/concepts/golden-paths/sync-reconciliation-and-conflicts.md` §8).

## What settlement means here

`client.upsert(...)` is awaited before `cursor::set_cursor` runs
(`mod.rs:271-282`), so the cursor advances only past rows the remote
store durably accepted — advance-after-settle. The upsert is idempotent
by row id on the receiving side, which is what makes the crash-between-
settle-and-advance replay harmless, and per-table failures are captured
into the pass report (`sync_table`, `mod.rs:198-236`) rather than
propagated, so one stream's failure pins only its own cursor — fault
isolation as the technique and the golden path both require.
