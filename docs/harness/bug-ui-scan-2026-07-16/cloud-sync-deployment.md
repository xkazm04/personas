# Cloud Sync & Deployment — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Concurrent sync passes are not serialized — "Sync now" races the background loop, double-pushing rows, double-counting the lifetime total, and bypassing the leader gate
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/cloud/sync/mod.rs:402 (also src-tauri/src/commands/infrastructure/cloud_sync.rs:37-42, mod.rs:447-481)
- **Scenario**: The background loop's 45s tick (or a `notify_dirty` wake) starts a pass. Mid-pass, the user clicks "Sync now" in Settings — the button's `disabled={syncing || status?.syncing}` guard is unreliable because the UI's syncing state is polled (and the poll itself is broken, see #4). `cloud_sync_now` calls `run_sync_once` directly with no mutex/guard, so two passes run concurrently.
- **Root cause**: `run_sync_once` assumes a single caller. Both passes read the same per-table cursors before either advances them, so both fetch and upsert the same row set; both then call `cursor::add_total_rows(report.total)`. Additionally, `cloud_sync_now` skips the `state.leadership.is_leader()` check that gates the loop, so a second (non-leader) app instance on the same machine can push concurrently — exactly what leader-gating was built to prevent. Finally, the first pass to finish sets `RUNTIME.syncing = false` while the other is still in flight, so `status()` lies.
- **Impact**: `total_rows_synced` (persisted, monotonic) is permanently inflated by the duplicated pass; duplicate upserts hit Supabase; the two passes can interleave `set_cursor` writes (the slower pass rewinds the faster one's watermark, causing yet another re-push); the UI shows "active" while a pass is running.
- **Fix sketch**: Wrap `run_sync_once` in a `tokio::sync::Mutex` (or a `try_lock` that makes an overlapping call a no-op returning current status), and apply the same leader check inside `run_sync_once` so `cloud_sync_now` can't bypass it.

## 2. Tombstone cursor advances to wall-clock pass-start — a persona deleted mid-pass can be permanently skipped, leaving deleted user data in the cloud forever
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/cloud/sync/mod.rs:372-394
- **Scenario**: A sync pass begins; `process_tombstones` captures `tick_start = now()` (line 374), then reads tombstones newer than the cursor. If a persona deletion commits to SQLite just after that SELECT's read snapshot but its tombstone timestamp is stamped before `tick_start` (timestamp assigned at statement start, commit lands milliseconds later — or clock skew between the stamping and the read), the pass doesn't see it, yet still advances the cursor to `tick_start` (line 393).
- **Root cause**: The cursor is advanced to a wall-clock time instead of the max watermark actually observed in the fetched rows. The module *itself* documents and fixes this exact failure class for the data tables (comment at mod.rs:276-283: "moved it past any row committed... after the SELECT's read snapshot — permanently excluding it from every later pass"), but the tombstone path kept the old wall-clock pattern.
- **Impact**: The skipped tombstone is never reprocessed (`fetch_tombstones` only returns rows newer than the cursor), so the deleted persona and all its child rows (executions, messages, memories, ...) remain in the user's Supabase tenant indefinitely — a silent data-retention/privacy failure with no error surfaced anywhere.
- **Fix sketch**: Mirror the data-table fix: advance the tombstone cursor to the max `deleted_at` observed among successfully processed tombstones (leave unchanged when none), never to `now()`.

## 3. "Sync now" without a live session is a silent no-op that shows a success toast with the previous pass's row count
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/cloud/sync/mod.rs:408-414 (surfaced at src/features/settings/sub_account/components/CloudSyncCard.tsx:93-97)
- **Scenario**: User's Google/Supabase session has expired (or the token was cleared) while the Settings panel is open. They click "Sync now". `run_sync_once` hits `auth.access_token == None` and returns immediately — no error, no status update. `cloud_sync_now` then returns the *stale* status, and `CloudSyncCard.onSyncNow` fires a success toast: "Synced {rowsSyncedLast} rows" using `rows_synced_last` from the last real pass, plus `lastSyncAt` still shows the old time as if fresh.
- **Root cause**: `run_sync_once` treats "no JWT" as "nothing to do" (fine for the background loop) but the explicit user-initiated command reuses it verbatim, conflating "skipped" with "succeeded". The UI trusts any resolved promise as success.
- **Impact**: Success theater — the user believes their data just synced (with a plausible non-zero row count) when nothing was pushed; nobody learns the session is dead until they notice the dashboard is stale.
- **Fix sketch**: Have `cloud_sync_now` return `Err(AppError::Auth(...))` (or a `skipped: bool` in the status) when there is no access token or sync is disabled; the card already has an error toast path for it.

## 4. CloudSyncCard's in-flight polling re-arms only once — a pass longer than ~1.5s leaves the card stuck on "Syncing…" with the Sync button disabled
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/settings/sub_account/components/CloudSyncCard.tsx:58-66
- **Scenario**: A background pass is in flight (11 tables + heartbeat + tombstones over the network — easily several seconds) when the user opens Settings. `refresh()` returns `syncing: true`; the effect schedules ONE `setTimeout(refresh, 1500)`. That poll returns `syncing: true` again with the same `lastSyncAt` — the effect's deps `[status?.syncing, status?.lastSyncAt, refresh]` are all `Object.is`-equal, so the effect never re-runs and no further timeout is scheduled.
- **Root cause**: The "poll until it settles" loop is keyed on state values that don't change between polls while the pass is still running; `setStatus` with a new object of identical primitive fields doesn't re-trigger the effect. The chain only continues if each poll happens to observe a changed value.
- **Impact**: The badge stays "Syncing…", the spinner spins, and "Sync now" stays disabled indefinitely (until toggle/remount) even after the pass finished minutes ago — the exact live-update promise the comment on lines 56-57 claims. It also feeds finding #1: the UI's stale `syncing:false` in the opposite direction lets users trigger overlapping passes.
- **Fix sketch**: Re-arm from the data flow, not the deps: schedule the next poll inside `refresh`'s resolution while `syncing` is true (recursive timeout or `setInterval` cleared when `syncing` flips false), or add a monotonically changing value (poll counter) to the effect.

## 5. Deployment health column shows a permanent fake "Loading" for cloud rows whose stats fetch failed or never ran
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/sub_deployment/components/DeploymentTable.tsx:122-130 (data source: src/features/agents/sub_deployment/hooks/useDeploymentHealth.ts:63-93)
- **Scenario**: The dashboard lists cloud deployments; `useDeploymentHealth` fetches `cloudExecutionStats` per persona via `Promise.allSettled` and silently drops rejected results (network error, deleted persona, backend error) — no entry is written to `healthMap` and no error state exists. The table cell renders `health ? <Sparkline/> : (cloud ? t.common.loading : '-')`.
- **Root cause**: Presence-in-map is used as the loading indicator; the hook's real `isLoading` flag is computed but never consumed by the dashboard or table, and fetch failures are indistinguishable from "still loading".
- **Impact**: Every cloud row whose stats call failed shows "Loading" forever — a dishonest perpetual-loading state (the exact "success theater" anti-pattern, inverted). Users can't tell a broken stats endpoint from a slow one; the label also never resolves for a persona with zero executions if the API rejects for unknown personas.
- **Fix sketch**: Propagate `isLoading` from the hook into the cell (`isLoading ? loading : health ? sparkline : '-'`), and record rejected personas in the map (e.g. `null` = failed) so failures render as a dash or a small error glyph with a tooltip.
