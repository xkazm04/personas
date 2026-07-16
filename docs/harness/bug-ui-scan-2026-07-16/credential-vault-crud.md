# Credential Vault CRUD — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Vault init failure leaves a permanent full-screen spinner and hides the error banner
- **Severity**: High
- **Category**: bug
- **File**: src/features/vault/sub_credentials/manager/useCredentialManagerState.ts:87-93 (with src/features/vault/sub_credentials/manager/CredentialManager.tsx:37-43)
- **Scenario**: If the user opens the Credential Vault while either startup fetch fails (DB locked at boot, IPC hiccup, backend error), `fetchCredentials()` rethrows after `reportError` (src/stores/slices/vault/credentialSlice.ts:132-135). The init effect awaits `Promise.all([fetchCredentials(), fetchConnectorDefinitions()])` with no try/catch/finally, so `setLoading(false)` is never reached.
- **Root cause**: The design assumes the two startup fetches always resolve. On rejection the effect's promise dies unhandled and `loading` stays `true` forever; `CredentialManager` early-returns the `LoadingSpinner` before the `VaultErrorBanner`, so the very error `reportError` stored can never render.
- **Impact**: Infinite "Loading credentials..." spinner with no error message, no retry affordance, and no way out short of navigating away and back (which re-runs the same failing init). The failure is invisible — classic silent failure turned UX dead end.
- **Fix sketch**: Wrap the init in try/finally (`finally { setLoading(false) }`) and route the caught error into `setError`; the existing banner + empty list then render, giving the user visibility and a retry path.

## 2. Corrupt credential metadata is silently reset to defaults and persisted, destroying OAuth/usage state
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/models/credential_ledger.rs:123-126 (with src-tauri/src/db/repos/resources/credentials.rs:842-879)
- **Scenario**: If a credential's `metadata` column ever contains invalid JSON (torn write on power loss, a future serialization bug, manual DB edit), the next writer that does a read-modify-write — e.g. any healthcheck via `append_healthcheck_metadata`, the daily sweep, or the backoff updater at credentials.rs:801 — calls `CredentialLedger::parse`, which returns `Default` via `.ok().unwrap_or_default()` with no log, then serializes that default back over the column.
- **Root cause**: `parse` conflates "no metadata" with "unreadable metadata". Every read-modify-write path trusts the parse result as the full current state, so one bad read is laundered into an authoritative empty ledger and committed.
- **Impact**: Permanent, silent loss of the entire ledger for that credential: `oauth_token_expires_at`/refresh counters (the proactive refresh engine's staleness guard then skips it — the documented "daily-401" failure returns), usage stats, anomaly tolerance, and all `custom` keys (`healthcheck_config`, `kb_id`, `imported_from`, ...). No error surfaces anywhere.
- **Fix sketch**: Make parse failures loud and non-destructive: return `Result` (or at least `tracing::error!` with the credential id) and have read-modify-write callers abort the write — or stash the unparseable original under a `corrupt_metadata_backup` custom key — instead of overwriting with defaults.

## 3. Successful create misreported as "Failed to create credential" — retry produces duplicates
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/vault/sub_credentials/manager/useCatalogHandlers.ts:84-106
- **Scenario**: User saves a catalog credential; `createCredential` succeeds (row committed, optimistic store append done), but the follow-up `await fetchCredentials()` or `await promptIfScoped(...)` inside the same try block rejects (transient IPC/list failure, scope-picker error). The single `catch` shows "Failed to create credential" and leaves the filled form mounted.
- **Root cause**: Post-create side effects share the create's try/catch, so any post-commit failure is attributed to the create itself. The catch also discards the real error (`catch {}`), so nothing distinguishes the cases.
- **Impact**: User is told the save failed when it succeeded; the natural retry submits again and creates a duplicate credential (no unique-name constraint — `create_with_fields` happily inserts a second row). Two credentials for one service then confuse healthchecks, rotation, and persona binding.
- **Fix sketch**: Scope the try/catch to the `createCredential` call only; run `fetchCredentials`/`promptIfScoped` after it with their own non-fatal error handling (e.g. `toastCatch`, as `onMcpComplete` in CredentialManagerViews already does), and proceed to GO_LIST since the credential exists.

## 4. Deleting a credential erases its entire audit history before logging the delete
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/resources/credentials.rs:480-483 (with src-tauri/src/commands/credentials/crud.rs:247-273)
- **Scenario**: User (or any privileged IPC caller — including a compromised renderer) deletes a credential. `repo::delete` explicitly `DELETE FROM credential_audit_log WHERE credential_id = ?` inside the transaction, wiping every create/update/field_update/healthcheck/rotation audit row; afterwards `delete_credential` inserts a single fresh "delete" entry.
- **Root cause**: The audit log is treated as a dependent child table to garbage-collect (avoiding "orphans"), but an audit trail's whole purpose is to outlive its subject. `credential_audit_log` has no FK constraint (schema.rs:671-683), so the cleanup isn't even needed for integrity.
- **Impact**: The forensic record of a secret's lifetime is destroyed at the exact moment it matters most — after deletion there is no way to answer "when was this token edited, tested, or rotated, and by which flow". A malicious or accidental delete self-launders; the vault's audit feature silently under-delivers its security promise.
- **Fix sketch**: Stop deleting `credential_audit_log` rows in `repo::delete` (the table is FK-free and keeps `credential_name` denormalized precisely so entries stay meaningful after the parent is gone). If unbounded growth is a concern, add a time-based retention sweep instead.

## 5. Databases view: empty state is a dead end and the provided back handler is discarded
- **Severity**: Low
- **Category**: ui
- **File**: src/features/vault/sub_databases/DatabaseListView.tsx:17,87-98
- **Scenario**: User navigates Vault → Databases with zero database-type credentials (the common first-run case). They see only an illustration with heading + hint text — no button to add a database credential and no in-view back action; the component even receives `onBack` from CredentialAddViews.tsx:123 but renames it to `_onBack` and never renders it.
- **Root cause**: The view assumes the breadcrumb above is sufficient navigation and that users arrive with data already present, so the empty state was left action-less while sibling vault views (e.g. CredentialList) pair empty states with CTAs.
- **Impact**: First-run users hit a cul-de-sac: the screen names the feature but offers no path to use it, even though the add-database form is one dispatch away (`GO_ADD_DATABASE`). Inconsistent with the vault's other empty states and wasted affordance (dead prop) invites future regressions.
- **Fix sketch**: Add a primary CTA ("Add database connection") to the `EmptyIllustration` that dispatches to the add-database flow (pass a handler from CredentialAddViews), and either wire `onBack` to a visible back control or remove the prop from the interface.
