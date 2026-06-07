# Bug-hunt follow-ups — deferred work (2026-06-08)

Deliberate deferrals from the bug-hunter remediation waves. Each is a real finding
left undone because a safe fix exceeds a single contained commit. Listed so a
future session picks them up without re-discovering them.

## cloud-sync #1 — sync cursor advances to wall-clock, drops rows (Critical)
- **File:** `src-tauri/src/cloud/sync/mod.rs:225-257` (`sync_table_inner`), fetch predicate `src-tauri/src/cloud/sync/rows.rs` per-table fetchers.
- **Why deferred:** `sync_table_inner` is generic over `T` (the row type) and advances the cursor to `tick_start` (wall clock at pass start, line 255), not to `max(cursor_col)` of the rows actually fetched and confirmed-pushed. The correct fix needs the per-table `fetch` closure to *also* return the max cursor timestamp it saw (or `T` to expose its cursor column), so `sync_table_inner` can do `set_cursor(max(seen_ts, cursor_prev))`. That changes the `fetch` signature and **every** table fetcher in `rows.rs`. A wrong partial fix to a data-loss-critical watermark risks worse loss, so it was held back rather than rushed.
- **Recommended fix:** Change `fetch` to return `(Vec<T>, Option<String> /* max cursor ts */)`; advance the cursor to that max only after a confirmed `client.upsert`. `upsert` is idempotent, so a conservative cursor (slightly behind) only causes harmless re-syncs — never loss.

## cloud-sync #2 — fixed 24h resync window misses in-place mutations (High)
- **File:** `src-tauri/src/cloud/sync/mod.rs:241-245`, `SYNC_TABLES` `mod.rs:49-61`, `rows.rs` fetch predicates.
- **Why deferred:** Mutable tables watermark on `created_at` + a 24h `resync` floor, so an in-place mutation (e.g. a `running` execution cancelled 3 days later, a review resolved a week after creation) older than 24h never re-syncs — the cloud mirror shows stale status forever. The fix is to watermark every mutable table on a true `updated_at` that bumps on **every** UPDATE and use `updated_at > cursor` (dropping the `created_at` + 24h hack). This needs `updated_at` columns/triggers on the affected tables → a migration, plus per-table fetch-predicate changes.
- **Recommended fix:** Add/confirm `updated_at` (with an `AFTER UPDATE` trigger or explicit bump) on `synced_executions`, `reviews`, healing tables, etc.; switch their fetch predicate + cursor column to `updated_at`. Pairs naturally with #1's `fetch` refactor.

> Both are best done together as one "data-driven sync cursor" change with focused tests (insert-during-pass, in-place-mutation-after-window) before touching the live mirror.

## execution #2 — concurrency-slot leak on tokio abort (Critical)
- **File:** `src-tauri/src/engine/mod.rs:1117` (cleanup) vs `:1279`, `:1393` (`handle.abort()`).
- **Why deferred:** `engine/mod.rs` had **pre-existing uncommitted working-tree changes** during the bug-hunt run, so a `git add` of the fix would bundle unrelated WIP into the atomic commit (no non-interactive hunk-staging). Commit/stash that WIP, then land the fix on a clean tree.
- **Recommended fix:** Move slot-release + `drain_and_start_next` into a `Drop`-based guard (RAII) so they run on normal completion, panic, **and** abort (`catch_unwind` does not catch abort); or have `force_cancel_all_for_persona` and the cancel-grace-abort path call `drain_and_start_next` explicitly after aborting and clear the tracker/task/waiter maps.
