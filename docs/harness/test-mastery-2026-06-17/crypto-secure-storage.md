# Test Mastery — Crypto & Secure Storage
> Total: 7 findings (3 critical, 3 high, 1 medium, 0 low)

## 1. Capability gate (`desktop_security.rs`) has ZERO tests — path-traversal / ADS / binary-allowlist bypass slips through
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/desktop_security.rs:103-226, 384-395, 551-580
- **Current test state**: none (no `#[cfg(test)]` module; no caller references `is_path_allowed`/`is_binary_allowed`/`check_permission` from a test anywhere in `src-tauri`)
- **Scenario**: `is_path_allowed` / `is_binary_allowed` / `has_ntfs_ads` / `check_permission` are the *entire* enforcement boundary for what a desktop connector (VS Code, terminal, Docker, Obsidian, browser) may read/write/spawn. A regression that, say, drops the `..` segment check, mishandles the empty-allowlist deny default, mis-parses an NTFS ADS (`c:/dir/file.txt:hidden`), or accepts a bare binary name without canonicalization would hand a malicious persona template arbitrary file read/write or process spawn — with no failing test to stop it.
- **Root cause**: The module was shipped without any unit tests despite carrying carefully-worded security invariants in its doc comments (empty `allowed_paths` = deny, parent-canonicalization for non-existent files, ADS rejection). Invariants documented in prose but never asserted drift silently.
- **Impact**: Capability-model bypass = local file exfiltration / tampering / RCE-adjacent process spawn. Highest blast radius in this context.
- **Fix sketch**: Add a `#[cfg(test)]` module asserting the invariants directly (these are pure functions over strings/manifests — largely **llm-generatable**). Invariants to assert: (a) empty `allowed_paths` ⇒ `is_path_allowed` returns `false`; (b) `"/allowed/../etc/passwd"` and `"..\.."` rejected; (c) `has_ntfs_ads("c:/x/file.txt:ads")==true` but `has_ntfs_ads("c:/x/file.txt")==false` and drive colon `c:/` not flagged; (d) empty `allowed_binaries` ⇒ deny; bare-name match (`"docker"` vs `"docker"`) and suffix match work; (e) `check_permission` returns `Forbidden` for an unapproved declared capability and `Validation` for an undeclared capability / unknown connector. Use a temp dir (via `tempfile`) for the canonicalize-real-path cases.

## 2. Enclave `seal()` / `verify()` signature + content-integrity has ZERO tests — forged/tampered enclaves verify as valid
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/enclave.rs:127-305
- **Current test state**: none (file has no test module; the two doc comments at lines 213-224 and 261-263 each describe a *real* regression that already shipped: signing `to_string_pretty` but verifying re-serialized compact JSON, and silently dropping unsigned/extra manifest fields on round-trip)
- **Scenario**: `verify()` is the trust decision for a portable `.enclave` that runs another party's persona on the user's machine. Today nothing asserts that (a) a freshly sealed enclave verifies with `signature_valid && content_intact`, (b) flipping a byte of `persona.json` flips `content_intact` to false, (c) tampering with `manifest.json` (e.g. raising `policy.max_cost_usd`) breaks `signature_valid`, (d) a mismatched/forged `signature.json` is rejected. The very bug the lines-213 comment fixed (every honest enclave failing, then a compact re-serialize letting altered fields past) would silently regress.
- **Root cause**: Crypto verification logic written with two prior known-bug fixes baked into comments, but no regression test pinning the corrected behavior (sign-over-exact-bytes, hash-over-actual-persona-json).
- **Impact**: A tampered enclave with a relaxed cost/tool/domain policy or a swapped persona body executes as "verified" — policy/budget bypass and supply-chain trust failure.
- **Fix sketch**: Add a DB-backed test (mirror the in-memory `test_pool()` helper used in `external_api_keys.rs`) that seals a persona, then asserts: round-trip verify is fully valid; byte-flip in the ZIP's `persona.json` ⇒ `content_intact=false`; mutate `manifest.json` policy ⇒ `signature_valid=false`; missing entry / oversized entry (>`MAX_DECOMPRESSED_SIZE`) ⇒ `Validation` error from `parse_enclave`. Invariant: **no single-byte mutation of any archive entry survives verification as both signature-valid and content-intact.**

## 3. Security-critical env-gated branches in `crypto.rs` (legacy-IPC reject, fallback-key deny, legacy-key migration) are untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/crypto.rs:80-169, 442-459, 670-701, 929-951
- **Current test state**: exists-but-weak — the test module covers `encrypt_for_db`/`decrypt_from_db` round-trips, the hybrid happy-path, and the non-32-byte AES-key guard, but NOT the fail-closed policy branches that three separate bug-hunt fixes (#1, #2, #5, dated 2026-06-07) deliberately hardened.
- **Scenario**: The fail-closed default is the whole point of those fixes: (a) `SessionKeyPair::decrypt` must REJECT a separator-less (legacy RSA-only) payload unless `PERSONAS_ALLOW_LEGACY_IPC=1` — a downgrade here lets a malicious renderer force every credential write down the weaker path; (b) `fallback_policy()` must return `Deny` by default and `Allow` only with `PERSONAS_ALLOW_FALLBACK_KEY=1`; (c) `legacy_key_migration_allowed()` must default false so an attacker who can write the app-data dir can't plant a known 32-byte master key. None of these branches has a test, so a regression flipping any default back to fail-open would pass CI.
- **Root cause**: Behavior depends on process env vars, which are awkward (and order-dependent) to test, so the hardening landed without locking the policy in a test.
- **Impact**: Silent reversion to a fail-open default = credential downgrade / planted-master-key compromise (the exact scenarios the fixes closed).
- **Fix sketch**: Add tests that set/clear the env var within the test (serialize them with a mutex or `#[serial]`-style guard since env is process-global, OR test the pure helpers): assert legacy-IPC payload (no `.`) returns `Err(CryptoError::Decrypt(_))` with the var unset; assert `fallback_policy()`==`Deny` unset / `Allow` set; assert `legacy_key_migration_allowed()`==false unset. Invariant: **every secure-default is `Deny`/reject when its opt-in env var is absent.** Add a CI gate marking `crypto.rs` / `enclave.rs` / `desktop_security.rs` as ratchet-protected (new code must ship with tests).

## 4. `path_safety::is_sensitive_credential_path` — signing exfil-oracle guard is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/path_safety.rs:31-61
- **Current test state**: none — the test module covers `validate_watch_path`/`validate_save_path` but not this function, even though its doc says it backstops `sign_document` against being turned "into an exfil oracle over SSH keys / cloud credentials / wallets".
- **Scenario**: This is the backend mirror of the renderer's `SENSITIVE_PATH_PATTERNS`, the only guard a direct IPC caller hits. If a future edit drops `.pem`/`.key` extensions, the `/.aws/credentials` match, or the `id_rsa`/`wallet.dat` filename checks, a persona tool could sign (and thereby read/leak) private keys with no failing test.
- **Root cause**: Added as defense-in-depth without pinning the match set; pure string predicate so the gap is purely "nobody wrote it".
- **Impact**: Private-key / cloud-credential / wallet exfiltration via the signing command.
- **Fix sketch**: Pure-function batch — **llm-generatable**. Assert `true` for `~/.ssh/id_rsa`, `C:\Users\x\.aws\credentials`, `foo.pem`, `bar.p12`, `id_ed25519`, `wallet.dat`, `.npmrc`, `.netrc`, and a `private_key.json`; assert `false` for an ordinary `~/projects/readme.md` and `notes.txt`. Cover the backslash-normalization and case-insensitivity paths. Invariant: **every name/extension in the documented sensitive set is matched, in both `/` and `\` form.**

## 5. `validate_file_access_path` (OCR / sidecar gate) untested for its accept path and extension allowlist
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/path_safety.rs:299-374
- **Current test state**: none — only `validate_watch_path` and `validate_save_path` are exercised; this sibling function (used by OCR `commands/ocr/mod.rs` and sidecar reads) is uncovered.
- **Scenario**: It enforces traversal rejection, system-dir + app-data-dir blocking, home-dir confinement, and an optional extension allowlist (`ALLOWED_OCR_EXTENSIONS`). A regression that, e.g., stops blocking the app-data dir (where the SQLite credential DB lives) or accepts a non-allowlisted extension would let an OCR/sidecar call read the credential database or arbitrary system files — silently.
- **Root cause**: The two adjacent validators got tests; this one was missed despite identical risk surface.
- **Impact**: Read access to the credential SQLite DB / system files through the OCR or sidecar IPC commands.
- **Fix sketch**: Add tests paralleling the `validate_save_path` set: reject empty / `../` traversal / `/etc/...` / a path inside `app_data_dir_normalised()`; reject a `.exe` when `Some(ALLOWED_OCR_EXTENSIONS)` is passed and accept a `.png` under home; with `None` allowlist, accept an extension-less home path. Invariant: **app-data dir and system dirs are never accessible, and the extension allowlist is enforced when provided.**

## 6. CDC `table_to_event` mapping + `CdcAction::From<Action>` untested — silent drop of live updates
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/cdc.rs:40-49, 146-186
- **Current test state**: none — pure mapping functions with a documented prior data-loss bug (lines 252-260: `persona_events` UPDATE used to fall through to the lightweight payload the live-stream UI rejects, freezing rows on first-seen status).
- **Scenario**: `table_to_event` decides which table mutations reach the frontend event bus and under what event name; `CdcAction::From` maps SQLite actions (with an `UNKNOWN → Update` fallback). If a tracked table is dropped from the match or an event name is renamed without the frontend, the UI silently stops updating (executions, messages, credentials, healing) — exactly the failure mode the code comment already had to fix once.
- **Root cause**: Treated as glue code; the async drain task is hard to test, but the *mapping* underneath is trivially testable and was never split out for testing.
- **Impact**: Live dashboards (executions, credential changes, healing) silently freeze — operators act on stale state.
- **Fix sketch**: Pure-function batch — **llm-generatable**. Assert `table_to_event` returns the expected event name for each tracked table; returns `None` for an unknown table; returns `None` for `audit_log` on UPDATE/DELETE but `Some` on INSERT; assert `CdcAction::from(SQLITE_INSERT/UPDATE/DELETE)` map correctly. Invariant: **every table the frontend subscribes to maps to a stable, non-`None` event name; `audit_log` is INSERT-only.** (Pair with a renderer-side constant cross-check if event names are duplicated there.)

## 7. `ExternalApiKey::parsed_scopes()` JSON fallback untested + `find_by_token` uses non-constant-time hash equality
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/db/models/external_api_key.rs:33-35 (and src-tauri/src/db/repos/resources/external_api_keys.rs:30-45, 102-134)
- **Current test state**: exists-but-weak — the repo CRUD/round-trip is well tested, but `parsed_scopes()` (the function that turns the stored scopes column into the authorization decision input) has no test, and the "empty vec on parse failure" fallback is a security-relevant default (corrupt scopes ⇒ *no* scopes, fail-closed) that nothing pins.
- **Scenario**: If `parsed_scopes()` ever changed its error fallback to, say, returning a permissive default, a malformed `scopes` column would grant broader access than intended — with no failing test. Separately, `find_by_token`/`hash_token` compares SHA-256 hashes via plain string equality (not constant-time); worth a documented note even though hashing the input first largely mitigates timing leakage.
- **Root cause**: The model method was added as a thin helper and skipped in the repo's otherwise-solid test module; the constant-time concern is a latent quality note, not an active break.
- **Impact**: A future regression in scope parsing silently widens API-key authorization (the management HTTP API gates CLI/MCP/A2A access).
- **Fix sketch**: **llm-generatable** unit tests on the model: `parsed_scopes()` returns the parsed vec for valid JSON (`["personas:read","personas:execute"]`), returns an **empty** vec for `""`, `"not json"`, and a non-array (`"{}"`). Invariant: **scope parse failure is fail-closed (empty scopes, never permissive).** Optionally add a quality-gate note to migrate `find_by_token` to a constant-time compare if/when token lookup moves off the hashed-and-indexed column.
