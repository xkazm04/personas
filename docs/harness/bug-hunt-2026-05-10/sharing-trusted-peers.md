# Bug Hunt — Sharing & Trusted Peers

> Group: Settings, Sharing & Foundation
> Files scanned: 9 (3 spec'd UI files were missing — substituted with their direct analogs in `src/features/sharing/components/` plus `src/api/signing/index.ts`, `src-tauri/src/commands/signing/mod.rs`, `src-tauri/src/commands/network/identity.rs`, `src-tauri/src/commands/core/data_portability.rs`, `src-tauri/src/commands/core/import_export.rs`, `src-tauri/src/engine/identity.rs`, `docs/concepts/invisible-apps-p2p.md`)
> Total: 3C / 5H / 3M / 1L = 12 findings

---

## 1. `verify_document` re-reads the file on disk after computing `file_hash_match` — TOCTOU lets a swapped file pass verification

- **Severity**: critical
- **Category**: signature-bypass
- **File**: `src-tauri/src/commands/signing/mod.rs:164-171`
- **Scenario**: Attacker controls a directory the user is verifying from (or a sync client like Dropbox is racing). User invokes `verify_document(file_path, sidecar_json)`. Backend calls `hash_file(&path)` (line 164, reads bytes once for hash), then a *second* `std::fs::read(&path)` (line 168, reads bytes again to verify the Ed25519 signature). Between the two reads the attacker swaps the file: the first read yields benign content matching `sidecar.document_hash` (so `file_hash_match = true`), the second read yields malicious content over which the legitimate signature does *not* verify — but the attacker can race the other way too: write malicious bytes for the hash window, then restore benign bytes for the signature window so `signature_valid = true && file_hash_match = true && valid = true`, and the user is told the malicious file is signed by a trusted peer. The signing path itself was already hardened against this exact bug (see comment lines 53-58); the verify path was not.
- **Root cause**: signing and verification must operate on the same in-memory byte buffer. `verify_document` reads the file twice with no locking.
- **Impact**: any user verifying a downloaded document can be tricked into trusting attacker content. Defeats the entire signing feature on shared filesystems.
- **Fix sketch**: read the file once into `let bytes = fs::read(&path)?;`, then derive both `current_hash = hash_bytes(&bytes)` and `verify_signature(..., &bytes, ...)` from that buffer. Mirror the comment block at lines 53-58.

## 2. `verify_document` swallows `verify_signature` errors as "signature invalid" — malformed signatures are reported identically to forgeries, but the danger UI treats `signature_valid=false && signer_trusted=true` as "tampering detected" and unlocks an "Import Anyway" button

- **Severity**: high
- **Category**: signature-bypass
- **File**: `src-tauri/src/commands/signing/mod.rs:170-172` (combined with `src/features/sharing/components/BundlePreviewContent.tsx:88-109`)
- **Scenario**: `verify_signature` returns `Result<bool, AppError>` and is squashed by `.unwrap_or(false)` (line 172). Errors include "Invalid public key base64", "Invalid Ed25519 public key", "Invalid signature base64", "Invalid Ed25519 signature". An attacker who already compromised a trusted peer record (or who emits a sidecar with a base64-mangled signature) is rendered identically in the UI to a real tamper. Combined with the "Import Anyway" red button (BundlePreviewContent.tsx:99-107, BundleImportDialog.tsx:412-420), a user trained to think "trusted peer + bad sig = tamper" clicks through and imports the bundle.
- **Root cause**: silent failure — different categories of cryptographic failure are collapsed to one boolean. Combined with a UX that exposes the override button on `signature_valid=false`, even malformed/garbage signatures route to the override path instead of a hard-fail.
- **Impact**: in any flow where a malformed signature can be induced (corrupted download, MITM strip-and-replace of just the sidecar field), a user can be socially engineered into importing untrusted code. Unlocks the override button on programming errors instead of treating them as "DO NOT IMPORT".
- **Fix sketch**: differentiate "signature parse error" from "signature did not verify". Parse errors must produce a hard error path with no override button. Only a successful parse with a verify-returns-false should reach the danger-confirm UI.

## 3. Schema migration loop is unreachable but `migrate_export_bundle_v1_to_v2` exists — future bump to `CURRENT_SCHEMA_VERSION = 2` will silently downgrade-accept v1 bundles via the stub

- **Severity**: high
- **Category**: downgrade
- **File**: `src-tauri/src/commands/core/import_export.rs:97-127`
- **Scenario**: Today `CURRENT_SCHEMA_VERSION = 1` so the `while version < ...` loop at line 97 never executes. The author bumps to `2` and adds real fields. The `migrate_export_bundle_v1_to_v2` function (line 121) is a `#[allow(dead_code)]` stub returning `Err`. The intent is "future migrators will replace this stub". But because the only test for forward-compat (`current_schema_tolerates_additive_unknown_fields`, line 533) is run against the *current* version and the only rejection test (`future_major_schema_is_rejected`, line 545) is run against `CURRENT+1`, the day someone bumps to v2 *without* writing the migrator, every old v1 export the user has on disk will surface as "Export schema v2 migrator is not implemented" at import time — but more dangerously, the loop only rejects when version is unknown via the `_ =>` arm. If the developer adds a `2 => ...` arm but forgets the per-field semantic shift, v1 bundles get rewritten with new field defaults that match the stricter v2 contract, silently accepting an export whose meaning changed. There is no contract test pinning a real v1 fixture to a successful v1→v2 migration.
- **Root cause**: importer is a forward-promise without a forward-compat contract test. Stub migrator returns `Err` rather than panicking, so a forgotten implementation surfaces as "Validation error" instead of a build-time failure.
- **Impact**: a future schema bump silently mis-migrates real user data, or the team ships v2 and every v1 bundle becomes un-importable.
- **Fix sketch**: replace the stub `migrate_export_bundle_v1_to_v2` with `unimplemented!("v2 migrator must be added with the v2 bump")` so a missing migrator is a build/test failure not a runtime validation error. Add a frozen v1 fixture under `tests/fixtures/persona_v1.json` and a test that round-trips it through `migrate_export_bundle` after every schema bump.

## 4. `parse_identity_card` JSON is base64-decoded with no length cap before `serde_json::from_slice` — unbounded memory amplification

- **Severity**: high
- **Category**: untrusted-deserialize
- **File**: `src-tauri/src/engine/identity.rs:345-350`
- **Scenario**: `import_trusted_peer` (commands/network/identity.rs:64) hands `identity_card: String` straight to `parse_identity_card`. The base64 input is decoded with no size limit (line 347). A 6 GB base64 string (≈4.5 GB raw) base64-decodes successfully and then `serde_json::from_slice` parses arbitrary nested JSON — no `serde_json` recursion limit is configured in this repo, default is 128 but a single multi-GB string field still allocates the whole thing. There is also no upstream IPC guard that the `identity_card` parameter is bounded.
- **Root cause**: trust-boundary input from a paste-box has no size cap before the expensive decode → parse pipeline.
- **Impact**: pasting a malicious "identity card" (or being phished into pasting one) crashes the app or produces multi-second lockups before the validation kicks in.
- **Fix sketch**: cap `card_b64` length to a few KB before `B64.decode`, and pass the decoded bytes through `serde_json::from_slice` only after a similar cap. Identity cards in production are <500 bytes; reject anything over 4 KB.

## 5. `import_trusted_peer` has fetch-and-trust TOCTOU vs `revoke_peer_trust` / mDNS cache invalidation

- **Severity**: high
- **Category**: toctou
- **File**: `src-tauri/src/commands/network/identity.rs:60-98`
- **Scenario**: Two IPC calls race: (a) `import_trusted_peer(card_for_peer_X)` and (b) `revoke_peer_trust(peer_id=X)`. Sequence: (a) calls `parse_identity_card`, (a) checks `local.peer_id == card.peer_id` (false), (b) revokes trust + calls `invalidate_trusted_peer_cache`, (a) calls `add_trusted_peer` overwriting the revoke, (a) calls `invalidate_trusted_peer_cache` *but with stale view* — the trust DB row is the just-imported peer, the mdns cache is fresh, the user-visible UI shows trust restored immediately after they revoked. There is no transaction wrapping "check self-id then add", and no monotonic trust-version counter visible to the cache invalidator.
- **Root cause**: the trust-edit path is composed of independent IPC commands rather than serialized through a per-peer trust mutex or a transactional check-and-set in `add_trusted_peer`.
- **Impact**: a user revoking trust during a p2p incident (peer compromise reported) cannot reliably keep trust off if their UI is concurrently re-importing the identity card from cache or share-link auto-prefill. Worst-case in a multi-window session: trust silently gets re-granted seconds after revoke.
- **Fix sketch**: serialize trust edits behind a per-`peer_id` mutex inside `identity_repo`, or rewrite `add_trusted_peer` and `revoke_peer_trust` to take a single `expected_state` parameter (compare-and-swap). Bump a trust-epoch counter inside the same DB transaction and have the mdns cache check it on read.

## 6. mDNS-cache invalidation is best-effort across nodes — `invalidate_trusted_peer_cache()` is called only on the same instance that did the trust edit

- **Severity**: medium
- **Category**: trust-escalation
- **File**: `src-tauri/src/commands/network/identity.rs:90, 119, 131`
- **Scenario**: `invalidate_trusted_peer_cache()` is a synchronous local call. If a user runs two desktop processes (e.g. main app + a background sync helper, or two windows after a buggy single-instance check) that share the SQLite DB, only the process that issued the IPC invalidates its cache. The other process keeps connecting to a peer whose trust was revoked seconds ago, until the cache TTL expires.
- **Root cause**: cache is local but trust state is shared via DB.
- **Impact**: revoke takes effect only on one process; a forked discovery worker keeps treating the peer as trusted.
- **Fix sketch**: read trust list on every mDNS hit (or at least gate by a DB-stored `trust_epoch` check) — never cache trust decisions across processes.

## 7. ZIP "manifest.json" extraction trusts entry name lookup but not entry count or alternate file injection

- **Severity**: medium
- **Category**: untrusted-deserialize
- **File**: `src-tauri/src/commands/core/data_portability.rs:871-904`
- **Scenario**: `read_zip_bundle` opens `archive.by_name("manifest.json")` (line 877) but never enumerates the archive — a hostile bundle can contain *thousands* of entries (or path-traversal entries like `../../../etc/passwd` or `manifest.json/../whatever`) which `zip::ZipArchive::new` will happily accept. Today only `manifest.json` is read, so traversal is dormant — but if a future feature adds icon/preview extraction (`archive.by_name("icon.png")`, etc.) without enumeration guards, the prior unaudited entries are pre-positioned. Additionally there is no cap on the ZIP central directory size (a 1 KB ZIP can declare millions of entries via repeated headers and OOM the parser before line 877 ever runs).
- **Root cause**: defensive entry enumeration / name-validation is omitted because only one entry is consumed today; the assumption that future readers will add their own checks is fragile.
- **Impact**: today: parser DoS via crafted central directory. Tomorrow: zip-slip when more entries are read.
- **Fix sketch**: validate `archive.len() <= MAX_ENTRIES`, iterate every entry, reject any whose `entry.name()` contains `..` / absolute paths / non-printable chars, then read `manifest.json`. Enforce a total-decompressed-size cap across all entries, not just the one read.

## 8. Encrypted-credential decrypt-then-apply runs *after* persona/team rows are committed — partial-import on bad passphrase

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src-tauri/src/commands/core/data_portability.rs:374-400`
- **Scenario**: `import_portability_bundle` calls `import_bundle(pool, &bundle)?` (line 376) which writes personas/teams/groups/tools to the DB, *then* (line 379-397) attempts to decrypt embedded credentials. If the passphrase is wrong, `apply_encrypted_credentials` returns `Err`, the warning is *appended* to `result.warnings`, and the function returns `Ok(Some(result))`. The user now has imported personas referencing credentials by name that have no secrets attached — the personas exist, will fail to authenticate at runtime, and there is no rollback path. Compounding: there is no "preview & confirm passphrase" step; the user is asked for a passphrase up front and only learns it was wrong after personas are committed.
- **Root cause**: import lacks atomicity across (persona rows, credential secrets); credentials are validated last but written first.
- **Impact**: users importing an exported workspace with a typo'd passphrase get a half-imported workspace with broken credentials and no clear recovery path.
- **Fix sketch**: decrypt the credential envelope *first* (rejecting on bad passphrase before any DB write), then run `import_bundle` and `apply_encrypted_credentials` inside a single SQLite transaction so an apply failure rolls back persona creation.

## 9. `signDocument` sensitive-path guard is frontend-only by self-admission and bypassable

- **Severity**: high
- **Category**: key-leak
- **File**: `src/api/signing/index.ts:42-96`
- **Scenario**: The 14-line trust statement (lines 42-56) explicitly says backend enforcement "has NOT been verified" and asks future authors to "route through `signDocument` instead, or confirm the backend enforces these patterns". The Rust `sign_document` (signing/mod.rs:36-45) does *not* check `SENSITIVE_PATH_PATTERNS` — it only calls `validate_file_access_path`. Any persona tool, MCP server, or untrusted JS context that calls `invoke("sign_document", { filePath, metadata })` directly bypasses the regex list entirely and signs arbitrary `~/.ssh/id_ed25519`, `~/.aws/credentials`, `wallet.dat`, etc., producing a publishable signature attestation by the user's identity over their private key contents. The signature does not reveal the private key but the *signed bundle* (file_hash + signed_at) — and the bundle includes the file path (sidecar field, signing/mod.rs:74) — is itself a leak channel: hash of `id_ed25519` is a fingerprint that lets an attacker confirm whether two users share a stolen key.
- **Root cause**: defense-in-depth gap acknowledged in code but never closed; sensitive-file detection happens only on the client side of an IPC boundary that is reachable from non-UI contexts.
- **Impact**: any persona with `invoke` tool access can produce signatures (and file hashes) over user secrets, exfiltrating fingerprints or fooling a trusted peer who later sees a "Signed by [you]" sidecar of `id_rsa`.
- **Fix sketch**: port `SENSITIVE_PATH_PATTERNS` to Rust and apply it inside `sign_document` *after* `validate_file_access_path`. Add a contract test that pairs the two lists. Reject the IPC at the boundary, not at the UI.

## 10. `set_display_name` allows arbitrary user-controlled string with no Unicode normalization or homoglyph filter

- **Severity**: medium
- **Category**: spoof
- **File**: `src-tauri/src/commands/network/identity.rs:20-34`
- **Scenario**: User imports a trusted peer card. Attacker generates a card with `display_name = "Alice"` where `A` is Cyrillic `А` (U+0410). The `BundlePreviewContent` surfaces `signer_display_name` (BundlePreviewContent.tsx:56) and the trusted-peer badge (line 79) reads "trusted peer" once a same-display-name peer has been added. There is no NFKC normalization, no Bidi-control filter, no zero-width-character filter, no homoglyph detection. Two distinct peers can share an identical-looking name and the user cannot distinguish them.
- **Root cause**: validation only checks length (`name.len() > 64`) and emptiness — none of the standard anti-spoofing transforms.
- **Impact**: peer impersonation in the trusted-peers UI; an attacker who shares a LAN with two legit peers can produce a third peer whose name visually matches one of them.
- **Fix sketch**: NFKC-normalize, reject any `Cn`/`Cf`/`Co` category code points, reject Bidi formatting marks (U+202A-202E, U+2066-U+2069), and disambiguate by appending a 4-char hash of the peer_id when two trusted peers share a normalized name.

## 11. `previewBundleImport`/`applyBundleImport` are two separate IPC calls; bundle bytes can be swapped between preview and import

- **Severity**: high
- **Category**: toctou
- **File**: `src/features/sharing/components/BundleImportDialog.tsx:151-234`
- **Scenario**: `handlePickFile` calls `previewBundleImport(path)` (line 151) which returns a `BundleImportPreview` with `bundle_hash` and `signature_valid`. The user reviews and clicks Import. `handleImport` calls `applyBundleImport(filePath, options)` (line 234) with `expected_bundle_hash: preview?.bundle_hash` (line 227). The frontend sends the expected hash, but the *backend* must enforce it. If the backend's `apply_bundle_import` does not refuse when on-disk bytes hash to something different, an attacker who can write to the picked file (or who controls a sync client) can swap content between preview and apply: preview shows benign trusted-signed bundle, apply imports a different malicious bundle. The frontend has no way to verify the hash is enforced server-side.
- **Root cause**: `expected_bundle_hash` exists in the IPC contract but its enforcement is invisible in this scope; without a co-located test it is a UX promise rather than a security property. The disk file is read twice (preview, apply) which is the same TOCTOU shape as finding #1.
- **Impact**: an attacker with write access to the picked path defeats the preview gate.
- **Fix sketch**: in `apply_bundle_import` (out of scope but called here), compare freshly-read bundle hash to `expected_bundle_hash` and refuse on mismatch with a clear error. Better: `previewBundleImport` should pin a `preview_id` server-side that holds the bytes in memory and `applyBundleImport(preview_id)` consumes them — so the user never re-reads the file at all.

## 12. `share-link` deep-link auto-preview races with dialog state — token bump is in `useEffect` after a microtask, allowing prior in-flight previews to flash a stale signer

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/sharing/components/BundleImportDialog.tsx:100-119, 192-217`
- **Scenario**: Two `personas:share-link` events fire within ~100ms (OS replay, double-click on a link). `ShareLinkHandler` bumps `shareLinkKey` twice and `BundleImportDialog`'s effect runs `reset()` (which bumps `requestTokenRef`) then `queueMicrotask(() => handleImportShareLink(initialShareUrl))`. The second event's `reset()` runs while the first event's microtask is still pending. The `queueMicrotask` lambda captures `initialShareUrl` *by closure*, so it may fire `previewShareLink(URL_A)` after `URL_B`'s reset has bumped the token. The token-mismatch check at line 207 saves the UI from rendering the wrong preview, but `previewShareLink(URL_A)` *still hits the network/backend*, so the bundle is fetched and parsed even though no UI ever shows it — and any backend side-effects (analytics, rate-limiting on the peer) fire on a URL the user did not intend to load.
- **Root cause**: closure-captured state in a `queueMicrotask` outliving the effect's reset.
- **Impact**: minor — wasted backend work and a potential information leak (the unintended URL is fetched). Could matter if `previewShareLink` triggers a peer-side audit log entry for "I previewed your bundle" on a URL the user did not knowingly open.
- **Fix sketch**: capture the request token *inside* the microtask and pass it to `handleImportShareLink` so the call itself can early-return before issuing the IPC if the token has been superseded.
