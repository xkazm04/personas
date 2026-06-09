# Bug Hunter — credential-vault-connectors
> Total: 5
> Severity: 1 critical, 2 high, 2 medium

## 1. Clearing all credential fields silently retains the old encrypted secrets
- **Severity**: critical
- **Category**: state-corruption|secret-leak
- **File**: src-tauri/src/db/repos/resources/credentials.rs:389-418
- **Scenario**: A user edits a credential and submits `data: {}` (removed every field — e.g. revoking a leaked key by clearing it) or any flow that ends up with an empty field map. `update_credential` (crud.rs:141-157) parses `{}` into an empty `HashMap` and passes `Some(empty_map)` to `update_with_fields`. The save block is gated `if let Some(field_map) = fields { if !field_map.is_empty() { DELETE … ; re-insert } }`. With an empty map, the inner guard is false, so the `DELETE FROM credential_fields` never runs. The old `encrypted_value`/`iv` rows survive untouched.
- **Root cause**: `Some(empty)` is conflated with `None` ("don't touch fields"). The empty map is a meaningful instruction ("the field set is now empty"), but the code treats "clear everything" identically to "no field change", so a delete-to-empty is a no-op.
- **Impact**: security / data corruption. The UI reports the update succeeded (optimistic replace in credentialSlice.ts:166-171, backend returns Ok), but the secret the user believed they removed is still decryptable in `credential_fields`. A user who clears a compromised key to neutralize it gets false assurance; the credential also stays "usable"/Ready (see #2) off ghost fields.
- **Fix sketch**: Distinguish `None` (no field change) from `Some(map)` (authoritative new field set, including empty). When `fields.is_some()`, always run the `DELETE`, then re-insert whatever the map contains (zero rows for an empty map). Make "fields provided" the trigger for the delete, never "fields provided AND non-empty".

## 2. Edited secret keeps a stale "healthcheck passed" verdict → connector promoted Ready while broken
- **Severity**: high
- **Category**: silent-failure|recovery-gap
- **File**: src-tauri/src/commands/credentials/crud.rs:402-440 (update_credential_field) vs src-tauri/src/commands/design/connector_readiness.rs:474-485 (credential_is_usable)
- **Scenario**: A credential passed a healthcheck once, so `ledger.healthcheck_last_success = Some(true)` is persisted. The user later edits the secret to a wrong value via `update_credential_field`. That command upserts the new field and writes an audit row but never touches the ledger. `credential_is_usable` decides Ready when `healthcheck_last_success != Some(false)` — the stale `Some(true)` still satisfies it, so `connector_readiness` returns `Ready` and the persona is promoted as runnable with a now-invalid credential.
- **Root cause**: The healthcheck verdict is treated as a durable property of the credential rather than of a specific secret value. Mutating the secret does not invalidate the verdict, so readiness gates on evidence that no longer applies.
- **Impact**: success theater / UX degradation. A persona executes "blind" against a broken credential and 401s at runtime instead of being flagged NeedsSetup — exactly the failure class `credential_is_usable` (bug-hunt 2026-06-07 #4) was added to prevent, reopened on the edit path.
- **Fix sketch**: On any field/secret mutation (`update_credential_field`, the `update_with_fields` field-save branch), reset `healthcheck_last_success`/`_at` to `None` (unverified) via the atomic ledger updater, so readiness falls back to the never-probed-but-has-fields state rather than trusting a verdict for a value that no longer exists.

## 3. Rotation-failure restore swallows its error and still reports "credentials restored"
- **Severity**: high
- **Category**: silent-failure|state-corruption
- **File**: src-tauri/src/engine/connector_strategy.rs:131-149
- **Scenario**: During credential rotation the new secret is written, then healthchecked. On a failed/errored healthcheck the code restores the original fields: `let _ = credentials::save_fields(pool, &credential.id, &original_fields);` and returns `Err("Rotation failed (credentials restored): …")`. If that restore `save_fields` itself fails (DB lock, pool exhaustion, an encryption error from `encrypt_field`), the `let _ =` discards it. The credential is left holding the NEW (rotated, non-working) secret, yet the returned message states the originals were restored.
- **Root cause**: The compensating action of a saga is treated as infallible. A best-effort `let _ =` on the rollback write means a failed rollback is indistinguishable from a successful one to every caller and to the user-facing message.
- **Impact**: data loss / corruption. The previously-working secret is gone, replaced by a broken one, while the system claims it was restored — the worst combination (real loss + false reassurance). Subsequent runs fail until the user manually re-enters the secret.
- **Fix sketch**: Capture the restore result; if it errs, log loudly and return an error whose message reflects the true state ("rotation failed AND restore failed — credential may be in the rotated state, re-enter the secret"), never the unconditional "credentials restored" string. Better: perform rotate + healthcheck + persist inside one transaction so a failed probe rolls the new secret back atomically with no separate compensating write.

## 4. user-facing single-field secret write is not round-trip verified before success is reported
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/credentials/crud.rs:424-439; src-tauri/src/db/repos/resources/credentials.rs:1273-1288
- **Scenario**: The OAuth-refresh write path pairs every `upsert_field_on_conn` with `verify_field_roundtrip_on_conn` (oauth_refresh.rs:516-534) so a field that cannot be decrypted back is caught before commit. The user-facing `update_credential_field` command calls `upsert_field` (no `_on_conn` transaction, no verify). If the master key/cipher is in a subtly bad state, or a future encryption regression produces ciphertext that cannot be decrypted, the row is written and the command returns `Ok(true)` — the UI shows the field saved (credentialSlice.ts:218-226 bumps `updated_at`) — but the secret is unrecoverable on next read.
- **Root cause**: Post-write integrity verification was applied to the engine write path but not to the primary human edit path, so the two paths have asymmetric guarantees against an encrypt-that-cannot-decrypt failure.
- **Impact**: silent secret corruption. A "saved" secret that fails to decrypt later surfaces only at runtime as a decrypt error, with no signal at save time.
- **Fix sketch**: Route `update_credential_field` through a transaction that calls `upsert_field_on_conn` then `verify_field_roundtrip_on_conn` against the just-decrypted plaintext before commit, mirroring the OAuth path — make "write a secret without verifying it reads back" impossible.

## 5. Decryption error strings from AES-GCM/RSA are surfaced verbatim into the error chain
- **Severity**: medium
- **Category**: secret-leak
- **File**: src-tauri/src/engine/crypto.rs:125,164,1294; src-tauri/src/db/repos/resources/credentials.rs:1325-1330
- **Scenario**: `decrypt_from_db` and `SessionKeyPair::decrypt` wrap the underlying crate error with `format!("AES-GCM decryption failed: {e}")` / `RSA decryption failed: {e}`. `get_decrypted_fields` (credentials.rs:1325) further embeds the field key and credential *name* into the message. While the IPC command handlers (crud.rs:45,131,332,414) deliberately return a generic `"Decryption failed"` to the frontend, these richer strings are produced one layer down and flow into `tracing::error!`, `AppError::Internal`, and any non-command caller (healthcheck, runner, rotation) that bubbles the raw `AppError`. The metadata column is sanitized via `sanitize_secrets`, but these error paths are not.
- **Root cause**: Crypto errors are formatted with the source error and contextual identifiers as if they were ordinary failures; there is no guarantee the underlying library or an embedded value never carries plaintext-derived detail, and the credential name is included unconditionally.
- **Impact**: security (defense-in-depth). Error text reaches logs/crash reports/non-command callers carrying credential identifiers and crate-internal detail, widening the secret-adjacent surface the rest of the engine (SecureString redaction, metadata sanitization, generic IPC errors) works hard to keep narrow.
- **Fix sketch**: Make crypto errors opaque at the source — return a fixed `CryptoError::Decrypt("decryption failed")` without interpolating `{e}` or the credential name, and log any diagnostic detail only behind a redaction pass. Treat "an error string may quote secret-adjacent data" as the default and require an explicit, sanitized opt-in to include any identifier.
