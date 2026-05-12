# Code-refactor scan — Credential Vault & CRUD

> Total: 10 findings (3 high, 5 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

## 1. `classify_field_type` duplicated 3x with verbatim bodies

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/resources/credentials.rs:1354`, `src-tauri/src/db/migrations/helpers.rs:346`, `src-tauri/src/commands/core/data_portability.rs:2368`
- **Scenario**: Three byte-identical copies of the credential field-type classifier (url / secret / number / identity / text) live in three different modules. `data_portability.rs:2367` even self-documents the duplication: "Mirrors the private `classify_field_type` in cred_repo." The repo version is `pub fn` already but is `fn` in helpers.rs and `fn classify_credential_field_type` in data_portability.rs.
- **Root cause**: Original was `fn` (private) in cred_repo. Migrations and data-portability needed it before someone promoted visibility, so two clones were stamped.
- **Impact**: Three places to update when a new field type (e.g. `oauth_redirect_uri` → "url") needs to be recognized. Drift risk: a fix in one path silently leaves the other two classifying the field as "text", which then leaks into UI badges and field rendering.
- **Fix sketch**: Promote `credentials::classify_field_type` to `pub` (already done — line 1354 just needs visibility flip from `fn` to `pub fn`). Delete `helpers.rs:346` and `data_portability.rs:2368`. Update the two callsites in data_portability.rs (`:1909`, `:2339`) to call `cred_repo::classify_field_type`. ~40 LOC removed.

## 2. `NON_SENSITIVE_KEYS` constant duplicated verbatim across modules

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/resources/credentials.rs:37` and `src-tauri/src/db/migrations/helpers.rs:38`
- **Scenario**: Two identical 17-entry `&[&str]` arrays of non-sensitive field key names. Both are then used inline with `!NON_SENSITIVE_KEYS.contains(&key.to_lowercase().as_str())` to derive `is_sensitive`. The repo version is `pub const` (already exported); the migration helper redeclares it locally as `const NON_SENSITIVE_KEYS: &[&str] = &[...]` instead of importing.
- **Root cause**: Migration helper was written before the constant was promoted to `pub`; nobody collapsed it after the fact.
- **Impact**: Adding a key like `tenant_id` to the non-sensitive list (the natural request when on-prem deployments hit) means remembering to edit it in two places. The migrations helper is silent — bugs only surface as fields encrypted at rest that should have been queryable plaintext.
- **Fix sketch**: Delete the local `const` in `helpers.rs:38` and use `super::super::repos::resources::credentials::NON_SENSITIVE_KEYS` (or shorter via `use` import). One-liner removal of ~19 lines.

## 3. `INSERT INTO credential_fields` body duplicated across 5 callsites

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/resources/credentials.rs:265, 408, 1181, 1221`, `src-tauri/src/commands/core/data_portability.rs:2343`
- **Scenario**: The same `INSERT INTO credential_fields (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at) VALUES (?1..?8, ?8)` plus the surrounding `encrypt_field` + `classify_field_type` + uuid::new_v4 scaffolding appears in: `insert_credential_and_fields_tx`, `update_with_fields` (inline loop), `save_fields`, `upsert_field_on_conn`, and `data_portability.rs:2333` (export-restore restorer). All 5 build the same 8-tuple of params.
- **Root cause**: The crud.rs path was atomicized for transaction safety in two phases (create then update), then data_portability needed the same logic again. Each evolved its own slight variation (`INSERT OR IGNORE` vs plain INSERT vs UPSERT) but the encrypt/classify/uuid steps are textually identical.
- **Impact**: ~25-30 LOC duplicated per site × 5 sites. When the credential_fields schema adds a column (e.g. `last_decrypted_at` for the proposed audit trail), 5 INSERT bodies need synchronized edits. High drift risk because each lives in a different module.
- **Fix sketch**: Extract a private helper `fn insert_field_row(conn: &Connection, credential_id: &str, key: &str, value: &str, is_sensitive: bool, now: &str) -> Result<(), AppError>` in `credentials.rs` that owns encrypt+classify+uuid+execute. Callers reduce to a 1-line call inside the field loop. Saves ~80 LOC of duplicated INSERT scaffolding.

## 4. `state.session_key.decrypt(...)` boilerplate duplicated in 4 commands

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/credentials/crud.rs:38-48, 99-109, 293-301, 377-383`
- **Scenario**: Every command that accepts session-encrypted IPC payloads repeats the same 8-10 line match: take `session_encrypted_data`, call `state.session_key.decrypt`, on Err `tracing::error!("Failed to decrypt session-encrypted payload: ...")` then return `AppError::Internal("Decryption failed".into())`. Four sites: `create_credential`, `update_credential`, `healthcheck_credential_preview`, `update_credential_field`.
- **Root cause**: Pattern grew incrementally as each new field-level command was added; no helper was extracted.
- **Impact**: ~40 LOC of duplicated error handling. Any change to the IPC decryption error contract (e.g. wanting to distinguish "session key rotated" from "malformed ciphertext") requires touching 4 places. Easy to forget the `tracing::error!` in a new command and leak the raw `e` upward.
- **Fix sketch**: Add `fn decrypt_session_payload(state: &AppState, payload: &str) -> Result<String, AppError>` (or method on `SessionKeyPair`) that bundles the decrypt + error log. Callsites collapse to `let decrypted = decrypt_session_payload(&state, &encrypted)?;`.

## 5. `pendingDelete*` Set-mutation pattern duplicated 4x in one file

- **Severity**: low
- **Category**: duplication
- **File**: `src/stores/slices/vault/credentialSlice.ts:127-150, 301-323`
- **Scenario**: `deleteCredential` and `deleteCredentialEvent` each implement the same optimistic-pending pattern by hand: clone-Set-and-add on optimistic start, clone-Set-and-delete on success, clone-Set-and-delete on failure. Lines 128, 133-134, 145-146 mirror lines 304, 309-310, 319-320 with only the variable name (`pendingDeleteCredentialIds` vs `pendingDeleteEventIds`) and the entity-filter callback differing.
- **Root cause**: Copy-paste between the two CRUD blocks in the same slice.
- **Impact**: ~30 LOC of near-identical Set juggling. A future improvement (e.g. timeout-based auto-rollback if delete hangs >Xs, or analytics on optimistic UI) has to be applied twice.
- **Fix sketch**: Extract a helper `withPendingDelete<T>(set, getCurrent, key, id, action)` that owns the set/unset bookkeeping. Or a generic `optimisticDelete(id, pendingKey, listKey)` closing over the Zustand `set`. Saves ~15 LOC and unifies the optimistic UX policy.

## 6. `useCredentialListFilters` exports `grouped` and `groupCredentials` — neither used

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts:93-96, 110`, `src/features/vault/sub_credentials/components/list/credentialListTypes.ts:155-173`
- **Scenario**: The hook computes `grouped: GroupedCredentials[]` via `groupCredentials(...)` inside `useMemo` and returns it. `CredentialList.tsx` (the sole consumer of this hook) destructures only `filteredCredentials` and never reads `grouped`. The underlying `groupCredentials` function in `credentialListTypes.ts:155` is exported only to be called from this dead callsite — no other file in `src/` imports it. The `GroupedCredentials` type at `credentialListTypes.ts:45` is also only used here.
- **Root cause**: Layout refactor swapped grouped category sections for a flat DataGrid in `CredentialList.tsx`, but the upstream hook + type + helper weren't pruned.
- **Impact**: ~25 LOC dead in `credentialListTypes.ts` (the function + interface) plus a needless O(N) memo computation on every credential list re-render. Confusing for future readers since the hook's signature implies grouped rendering is supported.
- **Fix sketch**: Delete `groupCredentials` (lines 155-173), the `GroupedCredentials` interface (line 45-48), and the `grouped` useMemo + return value in `useCredentialListFilters.ts`. Drop the `groupCredentials` and `GroupedCredentials` imports at the top of the hook.

## 7. `healthFilterLabel` and `sortLabel` exported but never imported

- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/components/list/credentialListTypes.ts:15-32`
- **Scenario**: Two label-formatter functions (`healthFilterLabel`, `sortLabel`) exported from `credentialListTypes.ts`. A repo-wide search returns zero importers — only their declaration site shows up. The DataGrid in `CredentialList.tsx` now drives its label text through the `categoryOptions` / `healthOptions` arrays inline, leaving these as orphaned helpers.
- **Root cause**: Filter UI was inlined when the column-filter UX moved into `CredentialListColumns.tsx`; the legacy dropdown helpers stayed behind.
- **Impact**: ~18 LOC of orphan code that adds to bundle (tree-shaking should handle it but ESLint warnings noise persists).
- **Fix sketch**: Delete both functions. If translations are wanted later, hard-code into `healthOptions` (already exists) or move into i18n.

## 8. Frontend FieldActionButtons re-implements `useCopyToClipboard` inline

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:65-113`
- **Scenario**: `FieldActionButtons` manages its own `copied` state, its own `copiedTimerRef` cleanup useEffect, its own `clipboardWipeTimerRef`, and its own `navigator.clipboard.writeText` call — exact behavior already provided by `src/hooks/utility/interaction/useCopyToClipboard.ts` (which is used in 27 other files including the sibling `useCredentialTags.ts`). Only the additional secret-wipe-after-TTL is unique to this component.
- **Root cause**: This file predates the shared hook (or was written by someone who didn't notice it). It manually reimplements the timer-cleanup pattern the hook exists to encapsulate.
- **Impact**: ~25 LOC duplicated. Two timer-cleanup paths instead of one; unmount-safety logic exists twice. The TTL-wipe behavior could ride on top of the shared hook with a 5-line extension instead.
- **Fix sketch**: Replace local `copied` state + `copiedTimerRef` + the inline `setTimeout` with `const { copied, copy } = useCopyToClipboard(1500);`. Keep the secret-clipboard-wipe `clipboardWipeTimerRef` block (that's the actual unique value) but trigger it from `copy()` instead of duplicating the entire flow.

## 9. `update_with_fields` re-implements `save_fields` inside its transaction

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/resources/credentials.rs:388-418` (inside `update_with_fields`) vs `:1150-1201` (`save_fields`)
- **Scenario**: `update_with_fields` inlines the same "DELETE FROM credential_fields WHERE credential_id = ?1, then per-field encrypt + classify + INSERT" loop that `save_fields` already implements. Both run inside their own transaction. The only structural difference is that `update_with_fields` holds an outer tx for metadata too, so it can't call `save_fields` directly (which opens its own tx).
- **Root cause**: When `update_with_fields` was added for atomic metadata+fields updates, the inline body was copied from `save_fields` rather than refactoring the latter to accept a `&Transaction`.
- **Impact**: ~40 LOC duplicated. Schema migrations (e.g. adding `created_by_persona_id` to credential_fields) need to be made in both spots. Real example: the IV-handling logic differs — `save_fields` uses `crypto::encrypt_field`, `update_with_fields` also uses `crypto::encrypt_field`, but a future change to encryption (e.g. adding a per-credential salt) has to be replicated.
- **Fix sketch**: Extract `fn save_fields_on_tx(tx: &Transaction, pool: &DbPool, credential_id: &str, fields: &HashMap<String, String>, sens_map: Option<&HashMap<String, bool>>, now: &str) -> Result<(), AppError>` and have both `save_fields` (which opens a tx and calls it) and `update_with_fields` (already has a tx) delegate. Saves ~40 LOC and consolidates the per-field write path.

## 10. Stale comment in crud.rs:408-409 hanging at end of file

- **Severity**: low
- **Category**: cruft
- **File**: `src-tauri/src/commands/credentials/crud.rs:408-409`
- **Scenario**: The last two lines of the file are an orphan comment header:
  ```
  // ============================================================================
  // Audit Log — moved to intelligence.rs to avoid duplicate tauri::command definitions
  ```
  with no code following. The intelligence.rs migration happened previously and the file already only contains commands, but the section header was left as a tombstone.
- **Root cause**: Incomplete cleanup after the audit-log commands were extracted to `intelligence.rs`.
- **Impact**: Pure noise. Confuses readers searching for audit-log commands (they grep the file, find this comment, then have to chase the actual location).
- **Fix sketch**: Delete the two trailing lines.
