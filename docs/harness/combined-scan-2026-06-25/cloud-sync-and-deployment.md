# Cloud Sync & Deployment — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: cloud-sync-and-deployment | Group: Onboarding, Home & Settings
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

Scope note: the live sync path (`cloud/sync/*`, `commands/infrastructure/cloud_sync.rs`, `CloudSyncCard.tsx`) is a **one-way desktop→cloud read-mirror** — local SQLite is authoritative, the cloud is a dashboard projection. So no finding is "Critical data loss": the worst live outcome is a silently-stale cloud mirror, not loss of user data. (The bidirectional last-writer-wins merge in `engine/workspace_sync/merge.rs` is explicitly Stage-1 dead code with *no production caller* — its LWW edit-vs-tombstone data-loss risk is real but unreachable today, so it is intentionally not filed as a live bug.)

## 1. In-place mutations to rows older than the 24h resync window never reach the cloud (silent, permanent divergence)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-divergence / data-correctness
- **File**: src-tauri/src/cloud/sync/rows.rs:506 (and the watermark at :530); resync floor at src-tauri/src/cloud/sync/mod.rs:255; resync flags at src-tauri/src/cloud/sync/mod.rs:57
- **Scenario**: An execution is created and synced while `status='running'`, then completes 30 hours later (long/queued/retried run). Or a notification message is created today and the user marks it read 3 days later (`is_read` flips). Or a healing issue stays `open` for a week before being resolved. The cloud dashboard shows the row forever in its *original* state: execution stuck "running", message stuck unread, issue stuck open.
- **Root cause**: For the in-place-mutating append tables (executions, events, messages, metrics, healing_issues) the watermark column AND the resync filter are both the **immutable `created_at`**: `WHERE datetime(created_at) > ?cursor OR datetime(created_at) > ?floor` where `floor = now-24h`. Once a row's `created_at` is older than 24h it is below both the advancing cursor and the resync floor, so a later in-place mutation (which does not change `created_at`) is never re-selected. There is no `updated_at`/version column driving re-pull for these tables, so any mutation landing >24h after creation is invisible to the cloud forever. The pass still reports "clean".
- **Impact**: Permanent, silent staleness of the cloud dashboard for any slowly-mutated row — wrong execution statuses, wrong unread counts, stale open-issue lists. Not user-data loss (local is correct), but the dashboard quietly lies and there is no signal it diverged.
- **Fix sketch**: Add an `updated_at` (or `synced_dirty`/version) column to the mutating tables and use it as the watermark + change filter instead of `created_at`+fixed-window; or maintain a CDC "dirty id" set so in-place mutations re-enqueue the specific rows regardless of age. At minimum, document the 24h staleness horizon as an explicit, surfaced contract.
- **Value**: impact=6 effort=4

## 2. Every pass re-pushes the entire trailing 24h of all resync tables; the per-table cursor is effectively inert for them
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance / write-amplification
- **File**: src-tauri/src/cloud/sync/mod.rs:254 (cursor read/advance) + src-tauri/src/cloud/sync/rows.rs:506 (the `OR created_at > floor` clause)
- **Scenario**: An active user generates hundreds of executions/events/messages per day. The background loop fires every ~45s (plus every local-mutation nudge). Each pass re-reads and re-upserts *every* row from the last 24 hours of 5 tables, continuously, forever — even when nothing changed.
- **Root cause**: After a healthy pass the cursor sits near `now` (max `created_at` synced). But the resync branch ORs in `created_at > (now-24h)`, a floor that is always *behind* the cursor, so it dominates the predicate and returns the full trailing-24h window on every pass. `set_cursor(observed_max)` (mod.rs:281) therefore never bounds the resync set — the cursor advancement is moot for resync tables. (It can even regress: on a pass whose only hits are old resync rows, `observed_max` < current cursor, walking the cursor backwards.)
- **Impact**: Continuous, activity-proportional redundant Supabase writes + bandwidth + battery, 24/7, scaling with user volume — likely the single largest operational cost of the feature. Upserts are idempotent so no correctness loss, but it is a permanent silent tax that also *masks* Finding 1 (you pay to re-read 24h yet still miss >24h mutations).
- **Fix sketch**: Drive re-pull off a real mutation signal (`updated_at` watermark or a dirty-row set) so a quiet table sends 0 rows; reserve a bounded resync only for rows actually touched. Track the resync watermark separately from the forward cursor so the forward cursor can't regress.
- **Value**: impact=5 effort=5

## 3. `run_sync_once` is not serialized: manual `cloud_sync_now` races the background loop and bypasses the leader gate
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / concurrency
- **File**: src-tauri/src/commands/infrastructure/cloud_sync.rs:40 (direct call) + src-tauri/src/cloud/sync/mod.rs:402 (`run_sync_once`) and :460 (leader gate lives only in the loop)
- **Scenario**: The 45s loop begins a pass; mid-pass the user clicks "Sync now". `cloud_sync_now` invokes `run_sync_once` directly — a second pass runs concurrently with the first. In a multi-window/multi-instance checkout, a non-leader window's "Sync now" also runs, even though the loop is leader-gated.
- **Root cause**: `RUNTIME.lock()` is only held momentarily to flip the `syncing` flag (mod.rs:418), not across the pass, so nothing serializes two `run_sync_once` calls. The manual command path skips the `state.leadership.is_leader()` check that gates the loop (mod.rs:460). Two passes read the same pre-advance cursor and both `add_total_rows(report.total)`; whichever finishes first sets `syncing=false` and overwrites `rt.tables`/`rt.last_error`.
- **Impact**: `total_rows_synced` (the lifetime counter shown in the UI) over-counts; the `syncing` flag flickers off mid-pass, re-enabling the "Sync now" button so the user can launch a *third* concurrent pass; per-table error/row status from one pass can be clobbered by the other; duplicate concurrent PostgREST load. No data loss (idempotent), but the status surface becomes unreliable.
- **Fix sketch**: Hold a `tokio::sync::Mutex` (a "pass in progress" guard) for the duration of `run_sync_once`; if already held, have `cloud_sync_now` await/return the in-flight result instead of starting a second pass. Optionally apply the leader gate (or an explicit "manual override") to the command path too.
- **Value**: impact=4 effort=3

## 4. Sync success/recency signals mislead on partial-failure passes (green toast + frozen "Last synced")
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: misleading-status / silent-failure
- **File**: src/features/settings/sub_account/components/CloudSyncCard.tsx:93 (unconditional success toast) + src-tauri/src/cloud/sync/mod.rs:433 (`last_sync_at` only on a fully-clean pass)
- **Scenario**: One table fails every pass (e.g. a schema drift on `synced_metrics_snapshots`) while the other 10 sync fine. (a) User clicks "Sync now": `cloudSyncNow()` resolves Ok (the command returns status, not an error, even with per-table errors), so the `try` block fires the green "Synced N rows" toast — *and* the red error panel renders, from the same result. (b) Because `report.is_clean()` is false, `set_last_at` is never called, so the headline "Last synced 3 days ago" freezes permanently even though data is being pushed every 45s.
- **Root cause**: Fault-isolated passes (good) are not reflected in the two most prominent signals. `cloud_sync_now`/`onSyncNow` treat a returned status as unconditional success; `last_sync_at` is an all-or-nothing field that a single persistently-failing table can pin forever. The honest per-table grid is hidden behind a collapsible.
- **Impact**: Contradictory UX (success toast beside an error banner); a healthy-but-partial sync looks dead ("last synced" stuck days back), or a failing sync looks fine (green toast). Erodes trust and hides real, actionable per-table failures.
- **Fix sketch**: Make the toast reflect `status.lastError`/per-table errors (success only when clean; otherwise warn with the failing-table count). Either advance `last_sync_at` to the last pass that synced *anything* and show "N tables failing" separately, or render the headline from the per-table cursor maxima so it can't be frozen by one table.
- **Value**: impact=4 effort=2

## 5. Windows app discovery resolves the first matching user profile, not the current user
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: wrong-runtime / discovery
- **File**: src-tauri/src/engine/desktop_discovery.rs:364 (`expand_windows_glob`, returning the first match at :379-385)
- **Scenario**: On a shared/multi-user Windows machine, user "Bob" (current session) has not installed Obsidian per-user, but "Alice" has at `C:\Users\Alice\AppData\Local\Programs\Obsidian\Obsidian.exe`. Discovery globs `C:\Users\*\AppData\Local\...` and returns Alice's path. The Obsidian bridge is then configured with — and launches/points at — another user's install (wrong vault context, or an `Access is denied` failure Bob can't diagnose).
- **Root cause**: `expand_windows_glob` enumerates `read_dir` of `C:\Users` and returns the *first* directory whose expansion exists, with no constraint that it belong to the current user. It should resolve against the current profile (`%LOCALAPPDATA%`) directly rather than wildcarding every user folder. (Lower-order: `get_app_version` at :592 spawns `<bin> --version` without `kill_on_drop`, so a binary that hangs on `--version` is orphaned, not killed, when the 1s timeout fires.)
- **Impact**: Discovery reports an "installed" runtime path that is wrong/unusable for the current user → bridge actions silently target the wrong install or fail opaquely. Bounded to multi-user hosts, but a confusing, hard-to-attribute failure when it hits.
- **Fix sketch**: Replace the `C:\Users\*` glob with the current user's `%LOCALAPPDATA%`/`%PROGRAMFILES%` resolved via env vars; drop the cross-profile wildcard. Set `kill_on_drop(true)` on the version probe command.
- **Value**: impact=4 effort=2
