# Credential Vault CRUD — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: credential-vault-crud | Group: Credential Vault & Connectors
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. Editing a credential silently destroys every field the form did not re-submit
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent secret loss / data integrity
- **File**: src-tauri/src/db/repos/resources/credentials.rs:393 (also crud.rs:138-157, src/features/vault/shared/playground/tabs/OverviewTab.tsx:64-69, src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:54-60)
- **Scenario**: User opens an existing OAuth credential (e.g. Gmail/GitHub) in the Vault, clicks "Edit fields", changes only the display name or base URL, and saves. The `access_token`/`refresh_token` rows — never shown in the form — are deleted and never re-inserted. The connection breaks; the user must re-run the whole OAuth consent. Same for any *optional* secret left blank in the form: it is re-saved as an encrypted empty string, overwriting the still-good value.
- **Root cause**: `update_with_fields` treats `Some(field_map)` as the *authoritative* full field set: it `DELETE FROM credential_fields WHERE credential_id = ?` then re-inserts only the map (credentials.rs:393-420, by design per the comment at :388). But the edit form (`CredentialEditForm`) seeds `values` only from `connector.fields`, defaulting each to `''` (CredentialEditForm.tsx:54-60), and `OverviewTab` passes `initialValues={googleOAuth.getValues()}` — the decrypted stored field values are never loaded (there is no IPC that returns them). So `updateCredential(id, { data: values })` (OverviewTab.tsx:69) ships a set that omits hidden token fields and carries blank optional secrets, and the authoritative replace wipes them.
- **Impact**: Routine edits silently revoke OAuth tokens and erase optional secrets, breaking the credential with no warning; the audit log records only a benign "credential data changed".
- **Fix sketch**: Make the update path merge, not replace: in `update_credential`/`update_with_fields`, skip keys whose submitted value is empty AND a row already exists (treat blank as "unchanged"), or have the form drop untouched/empty fields before calling `updateCredential`. Prefer per-field `update_credential_field` for edits, leaving omitted fields intact. Add a "leave blank to keep current" affordance.
- **Value**: impact=8 effort=3

## 2. Field encryption is opt-out via an untrusted connector flag, with no secret-name backstop
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: plaintext-at-rest
- **File**: src-tauri/src/db/repos/resources/credentials.rs:89-100 (also engine/crypto.rs:1311-1316, repo classify_field_type at credentials.rs:1390-1407)
- **Scenario**: A connector authored by the AI design flow (`CredentialDesignModal`) or imported defines an `api_key` field with `"sensitive": false`. On save, `is_field_sensitive` returns false, `encrypt_field` returns `(value, "")` (crypto.rs:1312-1314), and the API key is written to `credential_fields.encrypted_value` as **cleartext, iv=''**. It sits unencrypted in the local SQLite DB.
- **Root cause**: `is_field_sensitive` makes the connector schema the single source of truth for whether a secret is encrypted (credentials.rs:93-96). The only safety net is "unknown key defaults to sensitive", but an *explicit* `sensitive:false` is honored verbatim. Meanwhile `classify_field_type` already recognizes the same key as a `"secret"` (credentials.rs:1394-1399) — that knowledge is never used to force encryption. Encryption is therefore opt-out, gated on data the user/AI can author incorrectly.
- **Impact**: A single mis-authored connector silently downgrades real secrets to plaintext-at-rest; `vault_status` would even count them "plaintext" but offers no path to encrypt field-stored rows. Defeats the AES-256-GCM guarantee the vault advertises.
- **Fix sketch**: Add a server-side backstop in `is_field_sensitive`/insert path: if `classify_field_type(key) == "secret"` (or key matches token/key/secret/password), force `is_sensitive = true` regardless of the schema flag. Optionally log a warning when a schema tries to mark a secret-typed field non-sensitive.
- **Value**: impact=8 effort=2

## 3. `decrypt_field` empty-iv sentinel conflates "plaintext by design" with "lost nonce"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent decrypt failure
- **File**: src-tauri/src/engine/crypto.rs:1320-1325 (consumed at credentials.rs:1361 in get_decrypted_fields)
- **Scenario**: A sensitive field row whose `iv` becomes empty — from a partial/interrupted write, a botched migration, or a future bug that forgets to copy the nonce — is read back. `decrypt_field` sees `iv.is_empty()` and returns `encrypted_value` *as-is*, i.e. the raw base64 ciphertext is handed back as if it were the plaintext secret. No error, no integrity check.
- **Root cause**: `is_plaintext(iv)` (crypto.rs:1301-1303) uses an empty iv as the sole signal for "non-sensitive plaintext field". The encrypted vs. plaintext distinction is carried only by an absent nonce; there is no per-row `is_sensitive`-aware verification at decrypt time, so a sensitive field that has lost its nonce is indistinguishable from a legitimately-plaintext field.
- **Impact**: The credential silently starts authenticating with a garbage value (the ciphertext); the ciphertext "secret" may then be surfaced/logged. The failure is invisible — exactly the "decryption error swallowed as a value" anti-pattern. Bounded likelihood (needs iv loss) but high blast radius when it hits.
- **Fix sketch**: Pass `is_sensitive` (from the row) into `decrypt_field`; if a row is marked sensitive but `iv` is empty, return a hard `CryptoError` instead of the raw value. Optionally store an HMAC/marker so plaintext-by-design and lost-nonce are distinguishable.
- **Value**: impact=6 effort=3

## 4. No version guard on credential_fields — concurrent authoritative rewrites clobber each other
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / last-writer-wins
- **File**: src-tauri/src/db/repos/resources/credentials.rs:320-426 (interacts with engine/oauth_refresh.rs:504-515 and engine/connector_strategy.rs:132,390)
- **Scenario**: The proactive OAuth refresh engine writes a fresh `access_token`/`refresh_token` into `credential_fields` (oauth_refresh.rs:504-515) while the user has an edit form open. The user saves; `update_with_fields` does its DELETE-all + reinsert and the just-refreshed token is gone. Symmetrically, a rotation "restore original fields" (`save_fields`, connector_strategy.rs:132) and a manual edit racing each other resolve as pure last-writer-wins, each carrying only its own view of the field set.
- **Root cause**: `update_with_fields`/`save_fields` read existing state outside any optimistic-lock check (the `get_by_id` at credentials.rs:331 is only for `service_type`) and then authoritatively replace the whole field set. `updated_at` is written but never compared. Multiple independent subsystems mutate the same rows with no row-version/`If-Match` coordination.
- **Impact**: Silent loss of freshly-refreshed tokens or of fields written by a concurrent subsystem; manifests as intermittent "credential suddenly broken" with no error. Likelihood is modest in a single-user local app but real given the background refresh timer.
- **Fix sketch**: Add an `updated_at`/version token to `update_credential`; reject the write (or re-read+merge) if the row changed since the form loaded. Have engine token writes use only the non-destructive `upsert_field_on_conn` (as oauth_refresh already does) rather than delete-all `save_fields`.
- **Value**: impact=6 effort=4

## 5. `vault_status` mislabels field-only-plaintext credentials as unencrypted
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: misleading security signal
- **File**: src-tauri/src/db/repos/resources/credentials.rs:122-144 (surfaced via crud.rs:362-376 vault_status)
- **Scenario**: A credential whose every field is legitimately non-sensitive (e.g. a DB connection with only host/port/database/username, or an MCP with just a base_url) has zero `credential_fields` rows with `iv != ''`. `count_vault_status` therefore counts it as **plaintext**, and the Vault trust badge / migration prompt warns the user about "unencrypted credentials" that hold no secret — while the "Encrypt"/migrate path (which targets legacy `iv=''` blob rows) cannot change the count.
- **Root cause**: "encrypted" is defined as `COUNT(DISTINCT credential_id) FROM credential_fields WHERE iv != ''` (credentials.rs:133-138). A credential with no sensitive fields is structurally indistinguishable from one whose secrets failed to encrypt, so the KPI conflates "no secret to encrypt" with "secret stored in the clear".
- **Impact**: False-positive security warnings erode trust in the vault's status signal and can send users chasing a non-issue (or, worse, desensitize them to a real plaintext warning — see finding #2).
- **Fix sketch**: Count a credential as "needs encryption" only if it has at least one field classified sensitive (or a non-empty legacy blob) that is stored without an iv; treat credentials with zero sensitive fields as N/A rather than "plaintext".
- **Value**: impact=4 effort=3
