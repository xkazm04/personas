# Bug Hunt — Credentials Management

> Group: Vault & Credentials
> Files scanned: 14
> Total: 2C / 5H / 5M / 1L = 13 findings

---

## 1. healthcheck_credential and healthcheck_credential_preview skip IPC auth — unauth secret-using HTTP calls and decrypt-oracle

- **Severity**: critical
- **Category**: audit-bypass
- **File**: `src-tauri/src/commands/credentials/crud.rs:240` and `:284`
- **Scenario**: Every other credential-touching command (`create_credential`, `update_credential`, `delete_credential`, `update_credential_field`, rotation, design) calls `require_privileged_sync` / `require_privileged`. `healthcheck_credential` and `healthcheck_credential_preview` do NOT. Any in-process IPC caller — including a compromised renderer running before the user has authenticated, or a third-party content-script that wins the race against the auth gate — can invoke `healthcheck_credential(credential_id)` for any credential ID and the backend will (a) decrypt the field rows via `crypto::decrypt_field`, (b) make an authenticated outbound HTTP request to the connector's healthcheck URL using those secrets, and (c) write a `healthcheck` audit row whose existence is the ONLY evidence — no privilege check has been satisfied.
- **Root cause**: Drift: when `require_privileged_sync` was added across the file the two healthcheck entry points were missed. The TODO/comment on `vault_status` ("public command — read-only status check") was almost certainly the template, but `healthcheck_credential` is not read-only — it triggers a network call that uses live secrets and produces side-effects (audit log row, ring-buffer entry, anomaly score recomputation).
- **Impact**: Pre-auth credential exfiltration. The HTTP response (which often echoes the token or includes the email of the authenticated user) will be returned to the unauth caller. With `healthcheck_credential_preview` an attacker can additionally feed arbitrary `field_values` (decrypted from a session-encrypted blob the renderer constructs) and observe error/success — this is a yes/no oracle for guessing credential structures and is invokable without privileges.
- **Fix sketch**: Add `require_privileged_sync(&state, "healthcheck_credential")?` at line 244 and `require_privileged(&state, "healthcheck_credential_preview").await?` at line 288 — match the pattern used everywhere else in the same file.

## 2. Silent attacker-controlled-key downgrade via 32-byte short-circuit in platform_unprotect (Unix)

- **Severity**: critical
- **Category**: downgrade
- **File**: `src-tauri/src/engine/crypto.rs:849-857`
- **Scenario**: An attacker who can write to `$APPDATA/com.personas.desktop/master.key` (e.g. shared host, restored from backup, sync conflict, unprivileged tenant on the same machine that races the chmod 600) writes a file containing `DPAPI:` + base64 of any 32 attacker-controlled bytes. On next startup `load_local_fallback_key` strips the `DPAPI:` prefix, base64-decodes to exactly 32 bytes, calls `platform_unprotect`, which sees `data.len() == 32` and returns the bytes verbatim as the master key.
- **Root cause**: The "legacy plaintext fallback" branch was meant to migrate raw 32-byte master.key files written by very early builds, but it lives in `platform_unprotect` (which is called only AFTER the `DPAPI:` prefix has been stripped). So a `DPAPI:`-prefixed file claiming to contain protected data but actually 32 bytes of plaintext is honoured silently. The 32-byte check is also a length-confusion oracle — every legitimate AES-GCM `unix_local_protect` output is `12 + plaintext + 16` bytes, so 32 bytes can never legitimately appear in the new-format path.
- **Impact**: An attacker with file-write but not memory-read access can force the app to use a key they know. Every subsequent `encrypt_for_db` and existing ciphertext decrypt is now under attacker key. This becomes total credential vault compromise — the attacker exfiltrates the SQLite DB and decrypts everything offline with their key.
- **Fix sketch**: Delete the 32-byte branch in `platform_unprotect` (lines 851-855). The legacy migration path lives in the `else` branch of `load_local_fallback_key` (the `B64.decode(trimmed)` branch with `needs_resave = true`), which is the correct place. If migration of `DPAPI:`-prefixed-but-actually-plaintext files is genuinely needed, gate it on a separate file marker like `LEGACY32:` rather than length.

## 3. Single-active rotation policy invariant has TOCTOU between disable and INSERT (no surrounding transaction)

- **Severity**: high
- **Category**: rotation-race
- **File**: `src-tauri/src/db/repos/resources/rotation.rs:110-147` (create_policy) and `:149-195` (update_policy)
- **Scenario**: Two privileged callers invoke `create_rotation_policy` for the same credential at the same moment.
  - T0: caller A calls `disable_policies_for_credential` (line 127) — opens its own connection, runs UPDATE, drops connection.
  - T1: caller B calls `disable_policies_for_credential` — sees no enabled rows (A's pending INSERT hasn't happened) — UPDATE affects 0 rows, drops connection.
  - T2: caller A calls `pool.get()` (line 136), INSERTs an enabled row.
  - T3: caller B calls `pool.get()`, INSERTs another enabled row.
  Both INSERTs succeed; two enabled policies now exist for the same credential, violating the invariant the comment claims is "enforced".
- **Root cause**: `disable_policies_for_credential` and the INSERT each grab their own connection from the pool. There is no surrounding transaction nor any DB-level UNIQUE constraint to enforce single-enabled (you cannot easily express "at most one row with enabled=1 per credential_id" in plain SQLite without a partial unique index, which is not present here per the migration registry).
- **Impact**: Once two policies are enabled, `evaluate_due_rotations` will fire `rotate()` twice in close succession; the per-credential lock at `evaluate_due_rotations` line 554 prevents simultaneous rotation, but the second policy will still be marked `mark_rotated`, causing the connector strategy to provision a second OAuth refresh / API key rotation — invalidating the credential the first run just provisioned. Symptoms: every rotation tick the credential breaks until disabled.
- **Fix sketch**: Wrap `disable_policies_for_credential` + INSERT in a single `conn.transaction()` inside `create_policy`/`update_policy`. Even better, add a partial unique index `CREATE UNIQUE INDEX rotation_one_enabled_per_credential ON credential_rotation_policies(credential_id) WHERE enabled = 1;` so the DB rejects the second insert.

## 4. Empty-IV sentinel makes "is_plaintext" indistinguishable from corrupted/tampered IV

- **Severity**: high
- **Category**: downgrade
- **File**: `src-tauri/src/engine/crypto.rs:1207-1231` (`is_plaintext`, `decrypt_field`) + `:1226-1230`
- **Scenario**: `decrypt_field` checks `if is_plaintext(iv) { return Ok(encrypted_value.to_string()); }` where `is_plaintext` simply returns `iv.is_empty()`. An attacker with write access to `credential_fields` (e.g. via a Tauri command that takes raw `iv` parameters, or a SQL injection elsewhere, or a backup-restore from an old plaintext-era DB) can wipe the `iv` column to the empty string and the `encrypted_value` column to attacker-chosen text; the next `decrypt_field` call will return the attacker's text as if it had been decrypted, with no integrity check fired. Combined with the migration code on line 1248 (`SELECT id, encrypted_data FROM persona_credentials WHERE iv = ''`) the attacker can also pre-stage a row to be auto-encrypted with the legitimate master key on next migration tick — a permanent corruption with valid AEAD on attacker-supplied plaintext.
- **Root cause**: Empty string is used as a sentinel for "field was never encrypted." This is the textbook downgrade-to-plaintext anti-pattern in mixed-encryption-state schemas. There is no MAC over the per-field (encrypted_value, iv, is_sensitive) tuple, so an attacker who can edit any one column unilaterally can force a plaintext read.
- **Impact**: Anyone with write access to the SQLite file (which sits in a user-readable AppData directory with NO additional ACL) can replace any sensitive credential field with chosen plaintext without being detected by `crypto::decrypt_field` — and worse, every subsequent read silently returns the substitution.
- **Fix sketch**: Encrypt every field (no plaintext mode). Migrate all existing iv='' rows to encrypted form on startup and reject any iv='' encountered after migration with `CryptoError::Decrypt("plaintext field rejected — DB possibly tampered")`. Bind ciphertext, IV, and `is_sensitive` together via AAD: `cipher.encrypt(nonce, Payload { msg: pt, aad: format!("{credential_id}:{field_key}").as_bytes() })`. The `is_sensitive` flag must be inside the AAD so it cannot be flipped to make a sensitive field render as plaintext.

## 5. Per-field AES-GCM has no AAD — credential_id/field_key swapping is not detected

- **Severity**: high
- **Category**: aad-missing
- **File**: `src-tauri/src/engine/crypto.rs:1169-1181` (`encrypt_for_db`) and `:1183-1204` (`decrypt_from_db`)
- **Scenario**: An attacker with DB write access swaps the (`encrypted_value`, `iv`) pair from row A's `client_secret` field into row B's `api_key` field. Because the same master key encrypts every field across every credential and AES-GCM is invoked without AAD, decryption succeeds and credential B silently inherits credential A's secret. The `connector_strategy::rotate` path will then send credential A's secret to credential B's service endpoint — leaking A's secret to B's service.
- **Root cause**: `encrypt_for_db` calls `cipher.encrypt(nonce, plaintext.as_bytes())`, which uses the empty AAD. There is nothing binding a ciphertext to its credential_id/field_key context, so blobs are interchangeable.
- **Impact**: Cross-credential leakage (Credential B's healthcheck/proxy emits Credential A's secret to a different service operator) and full integrity bypass on field renames or row migrations. SQL injection elsewhere in the schema becomes a vault-wide vulnerability instead of a single-row one.
- **Fix sketch**: Use the `Payload { msg, aad }` form everywhere field crypto is invoked, with AAD derived from `format!("v1:{credential_id}:{field_key}")` (or `v1:trigger:{trigger_id}:{key}` for trigger configs). Include a one-shot migration path that re-encrypts all existing rows with AAD on first run, gated on a metadata flag.

## 6. RSA legacy IPC fallback is a permanent unrequested-downgrade primitive

- **Severity**: high
- **Category**: downgrade
- **File**: `src-tauri/src/engine/crypto.rs:80-142` (`SessionKeyPair::decrypt`)
- **Scenario**: When `ciphertext_b64` contains no `.`, the code dispatches plain RSA-OAEP decryption regardless of how recent the renderer build is. A compromised renderer (XSS, malicious Tauri plugin, dev-tools-injected code) constructs a single base64 RSA-only payload and submits it to any of the IPC commands that accept session-encrypted data (`create_credential`, `update_credential`, `update_credential_field`, `healthcheck_credential_preview`). The backend accepts it, increments a counter, emits a `tracing::warn!`, and proceeds — there is no enforcement, no rate-limit, and no rejection.
- **Root cause**: The retirement plan is policy-only: "once the counter has stayed at zero for a release cycle, replace the fallback with an error." Until that is done — and it has not been — the legacy branch is a permanent backdoor. The fallback also has no explicit version tag: `ciphertext_b64.find('.')` is the only discriminator, which makes it easy to bypass by accident in renderer code that incorrectly URL-encodes the dot.
- **Impact**: Any IPC payload an attacker can submit can ride the weaker (smaller-payload, smaller-attack-surface but fundamentally older) code path. More importantly, the warn-and-continue policy means an attacker who finds a bug in the legacy RSA-OAEP impl (e.g. a future rust-rsa CVE) gets a free runway because the path is unguardable today.
- **Fix sketch**: Replace the `else` branch at line 117-141 with `return Err(CryptoError::Decrypt("legacy RSA-only IPC payload rejected — renderer must use hybrid format".into()))` immediately. The retirement counter has done its job; the policy ("after 2026-Q3") is an aspirational note that should be enforced as a hard cutoff. If telemetry shows callers still on it, fix THEM, do not keep the pathway open.

## 7. update_credential_field audit detail leaks attacker-controlled field_key into the audit log via format string interpolation

- **Severity**: medium
- **Category**: audit-bypass
- **File**: `src-tauri/src/commands/credentials/crud.rs:396-402`
- **Scenario**: An attacker passes `field_key = "client_secret', deletion_marker='1"` (or similar) to `update_credential_field`. The audit detail is built via `format!("field '{field_key}' updated")` and passed to `audit_log::insert_warn`. The audit log layer (`db/repos/resources/audit_log.rs:29`) does call `sanitize_secrets`, but the `field_key` is not validated against the connector's known schema — the request is honoured even when `field_key` is not in `sensitivity_map_for_connector`'s output (line 386: `is_field_sensitive` returns `false` on unknown keys, so the attacker-controlled key is stored as a NON-sensitive field). The audit row records the chosen field as "updated" but the row sits in `credential_fields` with `is_sensitive=0` and `iv=''` — see Finding #4.
- **Root cause**: `update_credential_field` accepts ANY field_key string. Combined with the empty-iv plaintext sentinel, an attacker can plant arbitrary plaintext rows (with arbitrary keys) into a victim credential without ever encrypting them.
- **Impact**: Persistence beachhead: attacker stores arbitrary plaintext under unrecognised keys (`__exfil`, `cmd_eval`, etc.) which connector strategies, rotation, and other components may pick up later. Combined with Finding #4, attacker can read it back via any caller of `get_decrypted_fields`.
- **Fix sketch**: At the top of `update_credential_field`, look up the connector schema and reject any `field_key` not listed in the connector's `fields` JSON. Also reject `is_field_sensitive(...) == false` for fields that don't exist in the schema (rather than treating "unknown" as "non-sensitive") — a missing field should be a hard error, not a silent plaintext write.

## 8. delete_credential audits BEFORE deleting cred_fields → race-window where audit records "deleted" but fields linger

- **Severity**: medium
- **Category**: audit-bypass
- **File**: `src-tauri/src/commands/credentials/crud.rs:189-193` + `db/repos/resources/credentials.rs` repo::delete
- **Scenario**: The command flow is: `repo::delete(&state.db, &id)?` returns the `bool result`, then if true, `audit_log::insert_warn(... "delete" ...)`. If `audit_log::insert_warn` fails (DB locked, disk full, pool exhausted) the function still returns `Ok(true)` because `insert_warn` is fire-and-forget (logs a warning). The attacker now has a successfully-deleted credential with no audit record. Combined with the lack of foreign-key cascade in `credential_fields` (the schema relies on a separate manual delete flow), there is also a risk of orphan rows surviving.
- **Root cause**: `audit_log::insert_warn` is "fire-and-forget" by design — its return value is `()`. So a failed audit write is invisible to callers. Multiple critical state-changing commands depend on this path: `delete_credential`, `update_credential` (line 137), `healthcheck_credential` (line 255), `rotate_credential_now` (line 106), `refresh_credential_oauth_now` (line 151). None of them refuse to commit when audit fails.
- **Impact**: An attacker who can repeatedly hammer the DB into a momentary lock state (e.g. trigger a slow migration, parallel writes) gets unaudited deletions. For a "vault & credentials" context where audit is a security control, this is a meaningful gap.
- **Fix sketch**: Wrap delete + audit_log insert in a single transaction. If audit_log insert fails, abort the delete. At minimum, change `insert_warn` to `insert` for security-critical operations (delete, update, rotation) and propagate the error to the caller; the existing `insert_warn` can stay for low-priority paths like `healthcheck`.

## 9. evaluate_due_rotations sets ROTATION_EVAL_RUNNING but does not propagate errors from rotation_repo::record_rotation — silent rotation losses

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/rotation.rs:594-775`
- **Scenario**: After a successful `strategy.rotate(...).await`, the engine calls `let _ = rotation_repo::record_rotation(...)` and `let _ = rotation_repo::mark_rotated(...)` (lines 597 and 604) — both with `let _ =`. If either fails (DB locked because of the global eval guard, transient pool exhaustion), the ROTATION_COMPLETED event still fires with status=success, but `mark_rotated` has not run — meaning `next_rotation_at` was not advanced. The next scheduler tick re-rotates the credential, and the connector strategy may invalidate the just-issued OAuth refresh token (causing real downtime).
- **Root cause**: All `record_rotation`, `mark_rotated`, `disable_policy`, `schedule_failed_retry`, and `update_ledger` results are discarded. The pattern is consistent and therefore intentional, but for `mark_rotated` specifically — where DB failure leaks into operational behaviour — it is wrong.
- **Impact**: On a busy machine, occasional double-rotation bursts that revoke a freshly-issued credential. Mostly visible to OAuth services that do refresh-token-rotation (Google, Microsoft Graph) where the refresh_token from rotation #2 invalidates the one returned by rotation #1.
- **Fix sketch**: Treat `mark_rotated` failure as a hard error: `if let Err(e) = rotation_repo::mark_rotated(...) { tracing::error!(...); /* don't emit success event */ continue; }`. The other repo calls are accounting and can stay best-effort but should at minimum increment a counter so the data-stale field on AnomalyScore reflects reality.

## 10. RotationGuard drops AFTER per-credential locks but does not free them on panic — held locks leak forever

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src-tauri/src/engine/rotation.rs:551-779` (the for loop) and `:49-65` (try_lock_credential / unlock_credential)
- **Scenario**: Inside the for loop, `try_lock_credential(&policy.credential_id)` adds the id to `ROTATING_CREDENTIALS`, then `unlock_credential(...)` is called explicitly at the end of each iteration. There is NO RAII guard for the per-credential lock. If `strategy.rotate(...).await` panics — Tauri/tokio will catch it but the panic unwinds the for-loop iteration — the `unlock_credential` call is never executed. The credential id remains in `ROTATING_CREDENTIALS` for the lifetime of the process, and ALL future rotation attempts (manual `rotate_now` and scheduled) for that credential silently fail with "already being rotated".
- **Root cause**: Manual lock/unlock in async code without an RAII guard. The outer `RotationGuard` only manages `ROTATION_EVAL_RUNNING`, not per-credential.
- **Impact**: One panic in a connector strategy permanently disables rotation for that credential without surfacing any error — by design the per-credential lock is a "stale rotation in progress" check. Recovery requires app restart.
- **Fix sketch**: Introduce `struct CredentialRotationGuard(String); impl Drop for CredentialRotationGuard { fn drop(&mut self) { unlock_credential(&self.0); } }` and replace the manual `unlock_credential` calls with letting the guard go out of scope at the end of each iteration.

## 11. CredentialExportEnvelope (PBKDF2 600k) leaks via filename pattern and lacks per-bundle KDF-version field

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/core/data_portability.rs:1990-1995, 2073-2084`
- **Scenario**: The export filename pattern is `personas_credentials_{timestamp}.cred.enc` (line 2084). Anyone with read access to the user's Downloads folder gets a clear "this file contains the personas vault" marker that tells them where to focus a passphrase brute-force. Combined with PBKDF2-HMAC-SHA256 at 600k iterations and a 16-byte salt, that is well below the OWASP 2026 floor (Argon2id m=64MB, t=3) for offline attack scenarios. The envelope JSON has no `kdf_version` / `iterations` field, so an upgrade to Argon2id will require a full version bump in the format string and ad-hoc detection logic — making the upgrade harder to deliver.
- **Root cause**: PBKDF2 was state-of-the-art ~2017. For an offline-encrypted credential bundle in 2026, Argon2id or scrypt with high memory cost is the standard. The format also bakes the algorithm choice into the implicit `format: "personas_credentials_v1"` constant rather than carrying KDF parameters in the envelope.
- **Impact**: A leaked .cred.enc with a 10-12 char human passphrase falls to dedicated GPU/ASIC offline attack in days rather than centuries. Filename leakage means an attacker scanning a backup volume finds them instantly.
- **Fix sketch**: (1) Add KDF parameters (`kdf: "argon2id"`, `m_cost`, `t_cost`, `parallelism`) to the envelope. (2) Migrate to Argon2id — the `argon2` crate is already used by Rust auth code in the wider codebase. (3) Change the filename to a non-descriptive default like `vault_{timestamp}.enc` or let the user choose freely with no default-pattern hint. (4) Reject envelopes whose KDF version is unknown rather than silently honouring v1.

## 12. apply_encrypted_credentials matches by name+service_type — first-match wins and there is no name-collision check

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src-tauri/src/commands/core/data_portability.rs:1882-1899`
- **Scenario**: The import code finds the imported credential shell with `existing.iter().find(|c| c.name == imported_name && c.service_type == entry.service_type)`. The shell name is constructed with " (imported)" suffix. If the user imports the same bundle twice — or two bundles share a name — the second import silently overwrites the first import's secrets via `INSERT OR REPLACE INTO credential_fields` (line 1915). There is no warning, no audit row distinguishing this from a fresh import, and no rollback.
- **Root cause**: Names are not unique. The match is structural rather than ID-based. The exporter does not embed the credential `id` in `CredentialExportEntry` (line 1953-1958), making content-addressed import impossible.
- **Impact**: Silent loss of credential A's secrets when re-importing or importing two same-named bundles. The audit log records "data_portability:unified_export" decrypts but no corresponding "import" operation is logged for the per-credential overwrite, so forensics cannot reconstruct what happened.
- **Fix sketch**: Embed `id` (or a content hash of name+service_type+source) in `CredentialExportEntry` and match on that. On collision, emit a `CredentialConflict` and return it via the existing `conflicts` field on `CredentialImportResult` instead of silently overwriting. Audit-log every `INSERT OR REPLACE` on `credential_fields` triggered by an import.

## 13. extract_browser_result and extract_partial_values may inadvertently log credential values via crash report

- **Severity**: low
- **Category**: secret-leak
- **File**: `src-tauri/src/commands/credentials/auto_cred_browser.rs:1197-1216`
- **Scenario**: When auto-cred browser flow fails to extract a clean JSON block, the code writes a crash report with the last 1000 bytes of `spawn_result.text_output` to `app_data_dir/crash_logs/autocred_{timestamp}.log` (line 1198-1207). The output_tail can contain the partially-emitted JSON block from Claude that DOES include the API key/token values that were being scraped. There is no `sanitize_secrets` call on `output_tail` before it is written. Crash logs are surfaced to the user via "System Checks → Crash Logs" and are commonly included in support bundles.
- **Root cause**: The browser session is, by design, a credential-creation flow whose output is the very secret being created. Treating its tail as benign log data is wrong. `sanitize_secrets` is applied in rotation paths (line 596 of rotation.rs) but not here.
- **Impact**: A failed auto-cred session leaves the freshly-generated API key visible in plaintext on disk, in a file the user is encouraged to share when filing a bug report.
- **Fix sketch**: Run `output_tail` through `sanitize_secrets` before formatting `extraction_detail`. Better: do not include any of the assistant's text output in the crash log; only structured context (URL, tool counts, duration, error class).

