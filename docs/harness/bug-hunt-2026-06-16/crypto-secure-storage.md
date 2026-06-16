# Bug Hunter — Crypto & Secure Storage

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: crypto-secure-storage | Group: Data & Persistence

## 1. Enclave signature verifies re-serialized struct, not signed bytes (pretty vs compact mismatch)
- **Severity**: Critical
- **Category**: 🔮 Latent failure / signature bypass (trust boundary)
- **File**: `src-tauri/src/engine/enclave.rs:157` (seal) vs `src-tauri/src/engine/enclave.rs:214` (verify)
- **Scenario**: `seal()` signs `serde_json::to_string_pretty(&manifest)` (indented, multi-line). `verify()` re-parses `manifest.json` into an `EnclaveManifest`, then recomputes the signed message with `serde_json::to_string(&manifest)` (compact, no whitespace) and runs strict Ed25519 verification (`identity::verify_signature`, which does exact-byte `verifying_key.verify`). Pretty and compact JSON are different byte strings.
- **Root cause**: The signature message is reconstructed from the parsed struct using a *different serializer* than the one used at signing time, instead of verifying over the exact `manifest.json` bytes that were read from the archive. Two compounding defects: (a) `to_string_pretty` ≠ `to_string`, and (b) signing/verifying a round-tripped struct silently drops any unknown/extra JSON fields and ignores key ordering.
- **Impact**: Every honestly-sealed enclave fails `signature_valid` (verification is simply broken), OR — worse for trust — because verification operates on the canonical re-serialized struct rather than raw bytes, an attacker can add unsigned fields to `manifest.json` (or reorder/reformat) that the verifier discards before checking, so the on-disk manifest is not what was actually authenticated. Combined with finding #2, an untrusted enclave can be presented as authentic.
- **Fix sketch**: Capture the *raw* `manifest.json` bytes in `parse_enclave` and feed those identical bytes to both `sign_message` (seal) and `verify_signature` (verify). Never re-serialize the struct for signature purposes. Add a round-trip test that seals then verifies a real enclave.

## 2. Enclave `verify()` returns advisory flags; caller never enforces signature/integrity/trust
- **Severity**: High
- **Category**: 💀 Silent failure / fail-open trust boundary
- **File**: `src-tauri/src/engine/enclave.rs:232` and `src-tauri/src/commands/network/enclave.rs:39`
- **Scenario**: `verify_enclave` reads an attacker-supplied `.enclave` file and returns `EnclaveVerifyResult { signature_valid, content_intact, creator_trusted, policy, persona, ... }` to the frontend. The function returns `Ok(...)` regardless of whether the signature is valid, the content hash matches, or the creator is trusted. Note `creator_trusted` already defaults to `false` on any DB error (`.unwrap_or(false)`), and `signature_valid` is `.unwrap_or(false)` on verify errors — failures collapse into plain booleans with no hard rejection.
- **Root cause**: The verification layer is purely informational; there is no backend gate that refuses to import/instantiate a persona from an enclave whose `signature_valid && content_intact` is false. Enforcement is implicitly delegated to UI booleans (mirrors the document-signing pattern, but here the verified payload becomes an executable persona/policy).
- **Impact**: If the UI (or any future direct IPC caller) ignores or mis-renders the flags, a tampered or unsigned enclave's persona config + capability/cost policy is adopted as if authentic. The whole point of the sealed-enclave trust model is defeated. Especially dangerous combined with #1.
- **Fix sketch**: Add a hard-fail path: `verify()` (or a new `verify_strict`) should return `Err(AppError::Forbidden)` when `!signature_valid || !content_intact`, and any import/run-from-enclave command must call the strict variant before using the persona or policy. Keep the advisory result only for a display-only "inspect" command.

## 3. `validate_file_access_path` never canonicalizes — symlink/junction escape past home/system guards
- **Severity**: High
- **Category**: 🕳️ Path safety / symlink escape
- **File**: `src-tauri/src/engine/path_safety.rs:299`
- **Scenario**: `validate_file_access_path` (used for OCR and sidecar read/write, both reachable via gated IPC commands) rejects literal `../` segments and prefix-matches the raw `normalized` string against system dirs / app-data / under-home, then returns `raw.to_path_buf()` unchanged. It performs **no `canonicalize()`**. An attacker who controls a path under `~` can point at `~/link` where `~/link` is a symlink/NTFS junction to `/etc`, `C:\Windows`, or the app-data dir (`com.personas.desktop`, containing the SQLite vault + `master.key`). The string-prefix checks pass because the literal path is under home and contains no `..`.
- **Root cause**: Unlike its sibling `validate_save_path` (which canonicalizes the parent) and `DesktopConnectorManifest::is_path_allowed` (which canonicalizes), this validator trusts lexical normalization only. Symlinks/junctions are resolved by the OS at I/O time, after the guard has approved the path.
- **Impact**: Read primitive over arbitrary files (OCR can exfiltrate `/etc/passwd`, SSH keys, the master key file) and a write primitive (sidecar) into protected locations, bypassing the home/system/app-data trust boundary that this module *is*.
- **Fix sketch**: Canonicalize the target (or its parent for not-yet-existing files, as `validate_save_path` does) and run the system-dir / app-data / under-home checks against the canonical form. Also route the sensitive-credential-path check (`is_sensitive_credential_path`) on the canonical path.

## 4. CDC silently drops change events under load → stale UI / missed credential & audit notifications
- **Severity**: Medium
- **Category**: 💀 Silent failure / dropped events
- **File**: `src-tauri/src/db/cdc.rs:129` (`tx.try_send`) and `:84` (bounded `sync_channel`)
- **Scenario**: The SQLite `update_hook` fires synchronously inside write transactions and pushes onto a **bounded** `sync_channel`; on a full buffer it does `let _ = tx.try_send(event)` — discarding the event with no counter, log, or retry. The drain task additionally sleeps 6s at startup (`:204`), during which the buffer can fill from migrations/bulk writes. A burst of writes (startup credential migration `migrate_plaintext_*`, bulk imports, healing) overflows the buffer.
- **Root cause**: Deliberate non-blocking design (correct — the hook must not block the write txn) but with no overflow accounting and no resync signal. Dropped `credential-updated`, `audit-entry-created`, and `persona_events` notifications are lost permanently.
- **Impact**: Frontend shows stale credential/execution/health state; audit-log "new entry" notifications can be silently missed (forensic/observability gap); cloud `notify_dirty()` nudge is skipped so the web dashboard misses mutations. Worst during exactly the high-write moments (startup migration) when correctness matters most.
- **Fix sketch**: Count drops (atomic counter surfaced like `legacy_ipc_decrypt_calls`) and `tracing::warn!` on first overflow; emit a coalesced "resync needed" event when drops occur so the frontend can refetch; consider a larger buffer or a periodic full-refresh tick as a safety net.

## 5. External API key compared by indexed SQL equality on SHA-256 hash (no per-token salt; lookup is non-constant-time)
- **Severity**: Low
- **Category**: 🔐 Crypto hygiene / timing & precompute exposure
- **File**: `src-tauri/src/db/repos/resources/external_api_keys.rs:30` (`hash_token`) and `:114` (`WHERE key_hash = ?1`)
- **Scenario**: Management-HTTP-API tokens are stored as bare unsalted `SHA-256(token)` and authenticated via `SELECT ... WHERE key_hash = ?1`. SQLite's indexed B-tree equality on the hex string is not constant-time, and the hash is unsalted. (Tokens are 128-bit random `pk_<32hex>`, which is the main mitigation — hence Low, not Medium.) Contrast with the IPC session token, which correctly uses `constant_time_eq` (`ipc_auth.rs:545`).
- **Root cause**: Token verification reuses the storage index for equality instead of fetching the candidate row by `key_prefix` (or id) and doing a constant-time compare of the full hash; and the digest is a single unsalted SHA-256.
- **Impact**: Limited by 128-bit entropy, but the pattern is fragile: any future move to shorter/structured tokens, or a DB read leak, exposes directly-usable precomputable hashes; index-equality timing is theoretically observable on a network-facing management API.
- **Fix sketch**: Keep the indexed-hash *lookup* for performance but re-verify the fetched row's `key_hash` against `hash_token(input)` with a constant-time comparison before accepting; consider a keyed hash (HMAC with the master key) so a DB leak isn't directly precomputable.
