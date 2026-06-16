# Bug Hunter — Tauri IPC Bridge & API

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: tauri-ipc-bridge-api | Group: Platform Foundation

## 1. PostgREST filter injection via unvalidated `id` in remote-command handlers
- **Severity**: Critical
- **Category**: Trust boundary / injection
- **File**: `src-tauri/src/cloud/remote_commands.rs:307` (also `:233`, `:253`, `:105`)
- **Scenario**: `remote_command_reject(id)` and `remote_command_approve(id)` interpolate the caller-supplied `id: String` straight into a PostgREST query path: `format!("pending_commands?id=eq.{id}")`. The frontend wrapper (`remoteCommands.ts:14`) types `id` as a bare `string` with no UUID check, and neither the Rust command nor `SyncClient::patch`/`get` (`cloud/sync/client.rs:95,117`) escape or validate it. An `id` like `status=eq.pending&persona_id=not.is.null` (or any extra `&`-delimited filter) is appended verbatim to the URL. Because the request is sent with the user's own JWT, this lets a compromised/buggy renderer rewrite the WHERE clause of a tenant-scoped PATCH — e.g. mass-reject every pending command, or steer `executing`/`completed` status writes onto arbitrary rows the user owns.
- **Root cause**: String-formatted query construction with no input validation; PostgREST treats `&`/`=`/`eq.` as structured query syntax, so an unescaped path segment is a query-injection primitive. RLS only scopes to the tenant, not to a single row, so a widened filter still passes.
- **Impact**: Tenant-wide tampering with `pending_commands` rows (reject-all DoS, status spoofing, approving a command targeted at a different device by appending a permissive filter — defeating the device-scope mitigation added at `:229`).
- **Fix sketch**: Validate `id` is a canonical UUID (`uuid::Uuid::parse_str`) at the top of each handler before formatting, and/or percent-encode path segments in `SyncClient`. Reject non-UUID ids with `AppError::Validation`.

## 2. `remote_command_reject` runs on any device + skips device scoping (cross-device tampering)
- **Severity**: High
- **Category**: Trust boundary / silent failure
- **File**: `src-tauri/src/cloud/remote_commands.rs:297`
- **Scenario**: `remote_command_approve` was deliberately hardened to fetch the row scoped to `target_device_id=eq.{device}` (comment at `:228` explains a wrong-device approval would execute under the wrong sandbox/creds). `remote_command_reject` has no such scoping — it PATCHes `pending_commands?id=eq.{id}` with no device filter and no status/ownership pre-check. On a multi-device account, device A can silently reject a run-request queued for device B (the user on B never sees the prompt and assumes their command was never delivered). It also blindly overwrites rows already in `executing`/`completed` state back to `rejected`, with no read-back to confirm the transition was valid.
- **Root cause**: Asymmetric mitigation — the device-scope guard was added to approve but not to the parallel reject path; PostgREST PATCH silently succeeds (returns 2xx) even when it matches a row in an unexpected state or zero rows.
- **Impact**: Cross-device denial of legitimate run-requests; state corruption of in-flight/finished commands; no error surfaced to the user (the reject "succeeds").
- **Fix sketch**: Mirror the approve path: scope the PATCH to `target_device_id=eq.{device}` AND `status=eq.pending`, and treat a zero-row result (use `Prefer: return=representation` or a count) as "not found / no longer pending" rather than silent success.

## 3. `system_ops_*` write/run commands are auth-gated only by a no-op guard
- **Severity**: High
- **Category**: Trust boundary / privilege
- **File**: `src-tauri/src/commands/infrastructure/system_ops.rs:51,121,129,140`
- **Scenario**: `system_ops_create_automation`, `system_ops_set_enabled`, `system_ops_delete_automation`, and especially `system_ops_run_now` only call `require_auth_sync(&state)`, which is a hard-coded `Ok(())` no-op (`ipc_auth.rs:354`). None of these command names appear in `PRIVILEGED_COMMANDS` (`ipc_auth.rs:120`), so the invoke-handler wrapper never validates the `x-ipc-token` header for them either. `system_ops_run_now` calls `ops::run_op`, which for `context_scan` spawns a backend scan/subprocess against a caller-supplied `projectId` (`systemOps.ts:69`). The result: any code that can reach the IPC bridge can create persistent scheduled automations, flip their enabled state, delete them, or trigger an immediate subprocess-spawning op — with zero authentication beyond "the app is running."
- **Root cause**: These commands are treated as Public tier (no entry in the privileged set) and the only in-body guard is the no-op `require_auth_sync`. Subprocess-spawning + persistence (cron rows that fire later) makes Public the wrong tier.
- **Impact**: Unauthenticated persistence + subprocess-spawn primitive reachable from any renderer-context compromise (XSS, malicious embedded content, dev-tools); attacker can schedule recurring background scans or wipe a user's automations.
- **Fix sketch**: Promote at least `system_ops_run_now`/`create`/`delete`/`set_enabled` to `#[requires(privileged)]` and add them to `PRIVILEGED_COMMANDS` so the wrapper enforces the session token; validate `op_kind`/`projectId` against an allowlist before spawning.

## 4. Enum drift: `twin_record_interaction` accepts any `channel`/`direction` string, silently persisting garbage
- **Severity**: Medium
- **Category**: Silent failure / enum drift
- **File**: `src-tauri/src/commands/infrastructure/twin.rs:491` (and repo `db/repos/twin.rs:562`, `:316`)
- **Scenario**: `enums.ts:38,72` defines `TwinChannelKind` / `TwinInteractionDirection` and explicitly documents "Rust handlers additionally validate the serialised value and return an error for unknowns (rather than silently defaulting)." That contract is false here: `twin_record_interaction` takes `channel: String` and `direction: String` and passes them straight into `repo::record_interaction`, which `INSERT`s them raw with no `match`/`from_str`/CHECK validation (contrast `obsidian_brain_resolve_conflict` at `mod.rs:1346`, which correctly rejects unknowns). A frontend typo or out-of-sync value (`"outbound"` instead of `"out"`, `"Slack"` instead of `"slack"`) is persisted silently. Later exact-match lookups — `twin_get_tone(channel)` (`twin.rs:392`) and `list_communications(channel)` filters keyed on the same string — then miss, so the interaction exists but its tone/filtering breaks with no error anywhere.
- **Root cause**: The TS union is compile-time only; the documented Rust-side validation was never implemented for the twin endpoints, so the string flows untyped to SQLite which has no enum CHECK.
- **Impact**: Data-integrity drift (channel/direction values that no UI filter or tone profile will match), silently corrupting communication history and breaking tone selection — exactly the "wrong branch / silent else" failure the enums module was created to prevent.
- **Fix sketch**: Add `ChannelKind::from_str` / direction validation at the top of `twin_record_interaction`, `twin_upsert_tone`, `twin_get_tone`, `twin_create_channel`, returning `AppError::Validation` on unknowns; or a SQLite CHECK constraint. Align reality with the `enums.ts` docstring.

## 5. `use_vault` conflict resolution logs success even when the DB update is silently skipped
- **Severity**: Low
- **Category**: Silent failure
- **File**: `src-tauri/src/commands/obsidian_brain/mod.rs:1276`
- **Scenario**: In `obsidian_brain_resolve_conflict`, the `"use_vault"` branch only updates `persona_memories` when `entity_type == "memory"` AND `parse_frontmatter(&conflict.vault_content)` returns `Some`. If the vault content lacks parseable frontmatter (truncated file, hand-edited note, non-memory entity), the `UPDATE` is skipped entirely — yet control falls through to unconditionally `upsert_sync_state(..., "pull")` and `log_sync(..., "resolved_use_vault")`. The function returns `Ok(())`, so the UI marks the conflict resolved and the sync-state hash is advanced to match the vault, but the app DB was never changed.
- **Root cause**: The "did we actually apply the vault content?" outcome isn't tracked; sync-state + log writes happen regardless of whether the memory update ran.
- **Impact**: A conflict the user chose to resolve "keep vault version" silently leaves the app DB stale while recording it as resolved, and the advanced sync hash suppresses re-detection — the divergence is now invisible and won't re-surface.
- **Fix sketch**: Treat a missing/unparseable frontmatter (or unhandled `entity_type`) on the `use_vault` path as `AppError::Validation`/`Internal` instead of silently no-op'ing, and only advance sync-state + log success after the DB write actually applied.
