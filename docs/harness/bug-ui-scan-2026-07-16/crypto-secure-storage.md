# Crypto & Secure Storage — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 1, High: 1, Medium: 3, Low: 0)

## 1. Enclave verify trusts the archive-embedded public key, never binding it to the claimed `signer_peer_id`
- **Severity**: Critical
- **Category**: bug
- **File**: src-tauri/src/engine/enclave.rs:219-234
- **Scenario**: An attacker crafts a malicious `.enclave` for a victim to import. They generate their *own* Ed25519 keypair, sign the manifest with it, and put that key in `signature.json` as `signer_public_key_b64`, but set `signer_peer_id` to the peer_id of someone the victim already trusts (peer_ids are public — they're `base58(sha256(pubkey))` shared via identity cards).
- **Root cause**: `verify()` computes `signature_valid` by verifying the signature against `sig.signer_public_key_b64` (a value read straight from the untrusted archive), while `creator_trusted` is computed by looking up `sig.signer_peer_id` in `trusted_peers`. Nothing checks that the embedded public key (a) hashes to the claimed peer_id or (b) equals the public key actually stored for that trusted peer. The sibling module `bundle.rs::verify_against_trusted_key` (line 543) does this correctly — it verifies against `peer.public_key_b64` fetched from the DB — so the safe pattern was already known in-repo.
- **Impact**: A forged enclave verifies as `signature_valid: true` AND `creator_trusted: true` while being signed by a key the victim has never trusted. The entire enclave trust model (sovereign, host-untrusted persona bundles) is defeated; a hostile persona config with attacker-chosen capabilities/policy is presented to the user as authored by a trusted peer.
- **Fix sketch**: Ignore the archive-embedded public key for trust decisions. Look up `signer_peer_id` in `trusted_peers`, and verify the signature against that stored `public_key_b64` (as `bundle.rs` does). At minimum, reject unless `public_key_to_peer_id(sig.signer_public_key_b64) == sig.signer_peer_id` before any trust lookup.

## 2. `get_cipher()` permanently caches the first master-key failure, re-introducing the exact brick bug `get_master_key` was fixed to avoid
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/crypto.rs:1289-1299
- **Scenario**: At startup the credential migrations (`migrate_plaintext_credentials`, `assure_sensitive_fields_encrypted`) call `encrypt_for_db` → `get_cipher()` before the OS keychain backend is ready (a common transient condition on cold boot / login-time races). That first call fails.
- **Root cause**: `get_cipher` stores `OnceLock<Result<Aes256Gcm, String>>` and populates it with `get_or_init`, which caches whatever the closure returns — including `Err`. `get_master_key` was deliberately rewritten (see its comment, lines 498-503) to cache *only success* in `KEY_STORE` so a transient keychain failure can be retried. `get_cipher` sits in front of it and defeats that: it caches the first `Err` for the entire process lifetime.
- **Impact**: One transient keychain hiccup at startup bricks all at-rest credential encryption/decryption (`encrypt_for_db`/`decrypt_from_db`, and thus every credential field, trigger secret, notification secret, and CDC event-payload decrypt) for the whole session, recoverable only by restart — precisely the failure mode the `get_master_key` fix set out to eliminate.
- **Fix sketch**: Don't cache the error. Build the cipher on demand from `get_master_key()?` each call (the key itself is already cached/mlock-pinned so this is cheap), or cache only the `Ok(Aes256Gcm)` variant and retry on the `Err` path.

## 3. Scope enforcement fails OPEN when a credential's per-resource picks are structurally malformed
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/scope_enforcement.rs:141-155
- **Scenario**: A credential was narrowed to specific repos, but its `scoped_resources_json` value for a resource is not the expected array-of-`{id}` shape (schema drift, a partial/truncated write, or a manual edit), e.g. `{"repositories": {"id":"x"}}` or `{"repositories": "xkazm04/personas"}`.
- **Root cause**: The module fails *closed* on a malformed top-level blob (line 106-107), but per-resource it uses `picks.get(&spec.id).and_then(|v| v.as_array())...unwrap_or_default()`. Any non-array value silently yields an empty `allowed_ids`, and `if allowed_ids.is_empty() { continue; }` (line 153) then treats that resource as broad-scoped — allowing everything.
- **Impact**: A deliberately narrowed credential regains full reach for the affected resource with no `Block`/`WarnOnly` and no log line, contradicting the module's own stated fail-closed philosophy. A corrupt or tampered scope blob silently re-widens access.
- **Fix sketch**: Distinguish "resource key absent" (legitimately unscoped → continue) from "resource key present but not a valid `[{id}]` array" (corrupt → fail closed: return `Block`/error, or log a warning and deny for that resource).

## 4. `is_sensitive_credential_path` blocklist omits several high-value token files, leaving `sign_document` exfil gaps
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/path_safety.rs:31-61
- **Scenario**: A persona tool (or a future IPC caller) invokes the signing/read path directly, bypassing the renderer guard, and targets a secret file the backend blocklist doesn't recognize — e.g. `~/.git-credentials`, `~/.config/gh/hosts.yml` (GitHub CLI OAuth token), `~/.kube/config`, `~/.aws/config`, `~/.docker/config.json`, or a `.env` file.
- **Root cause**: The function is a curated denylist meant to mirror the renderer's `SENSITIVE_PATH_PATTERNS` and be the backend's last line of defense. It covers `.ssh`, `.gnupg`, `.aws/credentials`, gcloud, key extensions, and a few named files, but a denylist is inherently incomplete and these common credential stores are missing. `.aws/config` in particular is excluded while `.aws/credentials` is caught, and plaintext `~/.git-credentials` holds full git remote passwords.
- **Impact**: `sign_document` (and any privileged read gated by this function) can be turned into an exfiltration oracle over tokens/credentials the denylist doesn't name — the very bypass this function exists to prevent.
- **Fix sketch**: Add the missing high-value patterns (`.git-credentials`, `/.config/gh/`, `/.kube/config`, `/.aws/` broadly, `/.docker/config.json`, `.env`/`.env.*`), and keep this list in sync with the renderer's. Longer term, prefer an allowlist of signable locations over a denylist of secrets.

## 5. `validate_watch_path` fails OPEN (allows the path) when the home directory can't be determined
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/path_safety.rs:154-163
- **Scenario**: The app runs in an environment where `dirs::home_dir()` returns `None` (unset `HOME`/`USERPROFILE`, a service/sandbox context, or an unusual profile). A malicious persona template supplies a watch path outside the intended home tree, e.g. `/data/other-user/secrets` or a UNC/`/mnt` path.
- **Root cause**: `is_under_user_home` returns `true` when `home_dir()` is `None` ("fail-open for usability"), so the final home-containment gate in `validate_watch_path` (line 110) is a no-op in that state. Only the fixed system-prefix denylist still applies, which does not cover arbitrary non-system locations.
- **Impact**: The home-tree confinement — the primary defense against a template watching and leaking file names / change patterns from sensitive non-system directories — is silently disabled whenever home resolution fails, allowing watches on locations the design intends to forbid.
- **Fix sketch**: Fail closed when home is undeterminable (reject with a clear "cannot verify path is within your home directory" error), or require an explicit opt-in env flag before allowing watches without a resolvable home.
