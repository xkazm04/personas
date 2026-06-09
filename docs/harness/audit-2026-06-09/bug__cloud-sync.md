# Bug Hunter — cloud-sync
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Remote-command approve fetches by id only — runs a command targeted at another device
- **Severity**: critical
- **Category**: security
- **File**: src-tauri/src/cloud/remote_commands.rs:226-237
- **Scenario**: The poll loop and `remote_command_list_pending` both scope the PostgREST query with `target_device_id=eq.{device}` (lines 137, 202). But `remote_command_approve` re-fetches the row with `pending_commands?id=eq.{id}&{SELECT}` — **no `target_device_id` filter**. RLS only scopes rows to the user's tenant, not to a device. A multi-device user (laptop + desktop, both same Google account) who clicks Approve on a prompt that was actually targeted at device B can have it execute on device A. More importantly, the row's `target_device_id` is never validated against `resolve_device_id(pool)` before `execute_persona_inner` runs — the device-targeting guarantee in the module doc ("polls those rows for THIS device") is silently dropped on the approve path.
- **Root cause**: Authorization (device targeting) is enforced at *surface* time but re-checked only for `status == "pending"` at *approve* time. The id is treated as a sufficient capability token, but it is a predictable/listable UUID, not a per-device secret.
- **Impact**: security — a run-request meant for one device executes on another (wrong sandbox, wrong local credentials, wrong working tree). Cross-device command misdirection.
- **Fix sketch**: In `remote_command_approve`, add `&target_device_id=eq.{device}` to the fetch query (resolve `device` first, exactly like `poll_once`), and reject if the row's `target_device_id != resolve_device_id(pool)`. Make device scoping a property of a single shared query-builder so no call site can omit it.

## 2. Approve does not atomically claim the command — double-approve / concurrent-device double-run
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/cloud/remote_commands.rs:233-245
- **Scenario**: Approve reads `status`, checks `== "pending"` in app code, then later PATCHes status to `"executing"` (line 245) — a non-atomic read-modify-write against a shared cloud row. Two instances of the same user (the loop is leader-gated, but `remote_command_approve` is a Tauri command callable from any window/instance, and a second desktop on the same account is a separate leader) can both pass the `pending` check and both call `execute_persona_inner`. The persona runs twice, producing duplicate executions, duplicate cost, duplicate side effects. The `SURFACED` set (line 30) is per-process in-memory only, so it provides no cross-instance dedup either.
- **Root cause**: The "claim" is a check-then-act with no conditional write. PostgREST supports a guarded PATCH (`?id=eq.{id}&status=eq.pending`) that returns whether a row was actually transitioned; this code instead trusts a stale read.
- **Impact**: corruption / data loss — duplicate persona runs, double-charged budget, duplicated downstream events/messages.
- **Fix sketch**: Claim atomically: `PATCH pending_commands?id=eq.{id}&status=eq.pending` setting `executing` with `Prefer: return=representation`, and only proceed if exactly one row came back. Treat "0 rows transitioned" as "already taken" and abort.

## 3. Last-writer-wins upsert on config tables silently overwrites a newer device's edits
- **Severity**: high
- **Category**: conflict
- **File**: src-tauri/src/cloud/sync/client.rs:64-92 + src-tauri/src/cloud/sync/mod.rs:49-61
- **Scenario**: Personas/memories/triggers/knowledge sync with `full_backfill = true` and a `updated_at` cursor, upserting via `resolution=merge-duplicates` on the PK. With two devices on one account, device A edits persona P at 10:00 and pushes; device B (which still has P at 09:00) later edits P's *color only* at 10:05 and pushes its whole row — its upsert overwrites every column of the cloud row with B's stale copy of A's 10:00 fields. The cloud mirror is the same `synced_*` table for all of the user's devices (RLS is per-user, not per-device), so there is no per-row conflict check: the most recent *pusher* wins wholesale, not the most recent *editor* per field. `updated_at` is carried in the row but never used as an upsert precondition.
- **Root cause**: Multi-device write convergence assumed but never designed — the upsert has no `WHERE excluded.updated_at > synced.updated_at` guard, so a stale full-row push clobbers fresher data.
- **Impact**: data loss — a newer device's persona/memory/trigger edits vanish from the cloud mirror, and (if the cloud ever becomes a read source, e.g. the dashboard or a future pull) propagate the loss back.
- **Fix sketch**: Make the upsert a conditional merge keyed on `updated_at` (server-side trigger or RPC that rejects rows older than the stored `updated_at`), or move to per-device row scoping (PK includes `device_id`) so two devices never share a mutable row.

## 4. `last_sync_at` reflects "clean pass" but per-table cursors still advanced on partial failure — success theater + skipped rows
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/cloud/sync/mod.rs:225-257, 404-408
- **Scenario**: `sync_table_inner` advances the cursor only after a *successful* `client.upsert` (line 254-255), which is correct. But the resync window (rows.rs:496-503) re-reads rows mutated in the last 24h *in addition* to `cursor_col > cursor_prev`. A row whose `created_at` is older than 24h but which mutates in place (e.g. an execution that flips `completed` after 25h of running, or a message read-flag toggled days later) falls outside *both* the cursor window (its `created_at`/watermark predates the cursor) and the 24h resync floor — so its mutation is never re-synced. The cloud keeps the stale value forever, while `last_sync_at` and a green per-table status claim everything is current. Combined with `is_clean()` gating `last_sync_at`, the UI shows "synced" for data it never re-read.
- **Root cause**: The resync window is a fixed 24h heuristic against `created_at`, but in-place mutations have no upper bound on age. Append-table cursors track insert-time, not mutation-time, so long-lived mutable rows are permanently stranded.
- **Impact**: data loss (stale cloud mirror) + UX degradation (success theater — status reports synced/clean when specific rows silently never updated).
- **Fix sketch**: Drive the cursor and the changed-row query off a real `mutated_at`/`updated_at` column on the mutable tables (executions, messages, healing issues), not `created_at` + a bounded resync. Then every in-place mutation re-enters the changed-set regardless of age.

## 5. Execution `input_data` / `output_data` synced verbatim — no secret scrubbing on the exec path
- **Severity**: medium
- **Category**: secret-leak
- **File**: src-tauri/src/cloud/sync/rows.rs:340-359, 461-463
- **Scenario**: Event payloads get a deliberate sanitize pass (`project_event_payload` → `redact_secrets`, lines 99-120) precisely because they can carry tokens. But `SyncedExecutionRow.input_data` and `output_data` (lines 346-347) are pushed straight from the DB columns with **no** scrubbing. A persona prompt or tool output frequently echoes an API key, a `Bearer` header, a `git remote` URL with an embedded PAT, or a webhook secret it was handed. Those land in the cloud `synced_executions` table in cleartext. The trigger projection explicitly drops `config` for exactly this reason (lines 287-289); the same threat applies to exec I/O but the same control was not applied.
- **Root cause**: Secret-scrubbing was implemented as a per-field opt-in (events only) rather than a wire-boundary invariant covering every free-text projection.
- **Impact**: security — credentials a persona handled can be mirrored to Supabase in plaintext (scoped to the user's tenant, so blast radius is the user's own cloud, but still off-device and outside the credential-stay-local guarantee the module advertises).
- **Fix sketch**: Run `input_data`/`output_data` (and any other free-text exec/message/review fields) through the same `redact_secrets` + size-bound used for events, applied centrally so adding a new text column can't bypass it.

## 6. OAuth pending-state timeout uses a module-global ref — concurrent flows leak/clobber each other and a stale timeout can wipe a fresh state
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/stores/slices/system/cloudSlice.ts:98-106, 208-241
- **Scenario**: `pendingOAuthTimeoutRef` is a single module-level variable. `cloudStartOAuth` sets `cloudPendingOAuthState` and schedules a 10-min timeout that, on fire, blanks `cloudPendingOAuthState` and toasts "timed out" — but it only `clearPendingOAuthTimeout()`s on the *next* start/complete/cancel/disconnect. If a user starts OAuth, the callback completes via a path that doesn't run `cloudCompleteOAuth` (e.g. the deep-link handler sets state elsewhere, or a second `cloudStartOAuth` races), an older timer can fire and set `cloudError: "OAuth authorization timed out"` plus null the state *after* a new flow has already begun — killing a legitimately pending authorization. The `if (!get().cloudPendingOAuthState) return;` guard (line 215) does not distinguish *which* flow's state is present, so a stale timer still clobbers a fresh one.
- **Root cause**: A per-flow timer is stored in shared module scope with no flow/nonce identity, so timers and the single `cloudPendingOAuthState` slot can't be correlated.
- **Impact**: UX degradation — spurious "timed out" errors and a silently cancelled OAuth flow; user is locked out of connecting until they retry.
- **Fix sketch**: Tag each flow with the `state` nonce; the timeout closure should re-check `get().cloudPendingOAuthState === thisNonce` before mutating, and store the timer keyed by nonce (or just compare identity) so a stale timer no-ops instead of clobbering.
