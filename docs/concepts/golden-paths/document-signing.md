# Document signing

> Situation node: `integrations-security` / `vault-security` / `document-signing` ·
> [situation spine](../situation-spine.json)
> `sides: "client"` · `convergence: "converged"` · `twoSided: true` · `risk: high` ·
> `recurrence: 4` · dimensions: security · function · ui
> Spine's own framing: *"Signing a file, writing/importing a sidecar signature, and verifying it."*
>
> Composed 2026-08-17 against `master` @ `2a874e692`. Sweep: the whole signing
> surface read in full — `src-tauri/src/commands/signing/mod.rs` (317 lines),
> `src-tauri/engine/src/identity.rs` (546), `src-tauri/engine/src/enclave.rs`
> (322), `src-tauri/src/engine/bundle.rs` (1,010), `src-tauri/engine/src/path_safety.rs`,
> `src-tauri/db/src/repos/resources/signing.rs` (96), the four frontend files in
> `src/features/plugins/drive/signing/`, `src/api/signing/index.ts`, the Tauri
> updater config, and `.github/workflows/release.yml`. All 963 `src-tauri/**/*.rs`
> files walked by two independent matchers. Row counts measured against the
> **2026-08-17 purge backup**, not the live database (see §0.4).
>
> **Both spine labels are contradicted. Neither survived.** See §12.

---

## 0. The headline, before anything else

This repository contains **five** Ed25519 signature-verification call sites. Four
of them refuse to trust a public key that arrived in the same envelope as the
signature — they either bind the claimed identity to the key, or ignore the
embedded key entirely and verify against one already in the local trust store.

The fifth is `verify_document`, the command the leaf is named after, and it does
neither. It verifies a document against **the public key printed inside the
signature file being checked**, then returns that file's self-declared
`display_name` to a dialog that renders a green check and the words *"Valid
signature"* next to it.

The consequence is not subtle and needs no cryptographic weakness. Anyone can
generate a keypair in a few lines, sign any file with it, write a sidecar JSON
naming themselves `"Personas Security Team"`, and hand both to a user. All three
booleans the backend computes come back `true`:

```
file_hash_match : true   (the hash really is the hash of the file)
signature_valid : true   (the signature really was made by the enclosed key)
valid           : true   (= file_hash_match && signature_valid)
```

The one question that would fail — *whose key is that?* — is never asked.

**What makes this a documented omission rather than an oversight is that the fix
is written out, in this repository, in a comment above a sibling function.**
`enclave.rs:222-228` says:

> Bind the archive-embedded public key to the claimed peer_id BEFORE using it.
> peer_id is base58(sha256(public_key)); without this check verify() trusted
> `signer_public_key_b64` for the signature while separately trusting
> `signer_peer_id` for the trust lookup, so an attacker could sign with their own
> key but claim a trusted peer's id and read as signed-and-trusted. The sibling
> `bundle.rs::verify_against_trusted_key` already binds key↔peer;
> `parse_identity_card` does the same check for cards.

That comment enumerates **three** places the check lives and fixes a fourth. It
does not mention `verify_document` — the only one of the five that reads its
envelope from a textarea the user pastes into.

This is the doctrine's own rule about fix passes, caught in the wild:

> When you fix a defect class, enumerate the places that need the behaviour, not
> the places that exhibit the bug.

The pass searched for archives. The sidecar path is not an archive.

### 0.1 The identity module states the requirement and no caller enforces it here

`identity.rs:81-86`, on `peer_id_from_public_key_b64`:

> Callers that receive a `(peer_id, public_key)` pair **from an untrusted source
> MUST check that this derivation matches the claimed peer_id before trusting
> either** — peer_id is `base58(sha256(public_key))`, so binding one to the other
> is what stops a signer from claiming someone else's identity while signing with
> their own key.

Measured call sites of `peer_id_from_public_key_b64` in 963 `.rs` files: **three**,
and one is the definition.

| site | binds? |
|---|---|
| `engine/src/identity.rs:87` | the definition |
| `engine/src/enclave.rs:227` | ✅ binds |
| `engine/src/p2p/protocol.rs:290` | ✅ binds |
| `src/commands/signing/mod.rs:197` | ❌ **does not call it** |

### 0.2 The five verification doors, ranked

| # | site | key comes from | binds id↔key | consults trust store | verdict |
|---|---|---|---|---|---|
| 1 | `src/engine/bundle.rs:582` | `trusted_peers` row | n/a — uses stored key | ✅ + revocation check | strongest |
| 2 | `src/engine/bundle.rs:590` | local identity row | n/a — uses stored key | ✅ | strongest |
| 3 | `engine/src/enclave.rs:232` | the archive | ✅ `:227` | ✅ `:238-244`, incl. stored-key equality | strong |
| 4 | `engine/src/p2p/protocol.rs:297` | the handshake | ✅ `:290`, hard reject | caller's job | strong |
| 5 | **`src/commands/signing/mod.rs:197`** | **the sidecar JSON** | ❌ | ❌ | **unauthenticated** |

Door 1 is the one to copy, and it is worth stating precisely *why* it is stronger
than door 3. Door 3 proves the signer holds the key that hashes to the id it
claims — which is real, and stops identity theft. Door 1 never looks at the
embedded key at all: it takes the claimed `signer_peer_id`, looks it up in
`trusted_peers`, checks `trust_level.is_revoked()`, and verifies against the
**stored** `public_key_b64`. A forged envelope cannot influence the key used,
because the key never came from the envelope.

### 0.3 The UI has no vocabulary for "valid but unknown"

`bundle.rs` returns **two** booleans — `(signature_valid, signer_trusted)` — and
`enclave.rs` returns three, including `creator_trusted`. `VerifyDocumentResult`
(`src/api/signing/index.ts:22-30`) has **no trust field at all**: `valid`,
`signer_peer_id`, `signer_display_name`, `signed_at`, `file_hash_match`,
`signature_valid`, `error`.

So `DriveVerifyDialog.tsx:184-250` cannot show a trust state even if the backend
computed one. `VerifyResultCard` branches on `result.valid` alone, paints the
card emerald, and renders `result.signer_display_name` — a string that came out
of the pasted JSON — under a `<dt>` labelled *"Signer"*.

**The type is upstream of the UI defect.** A field that does not exist cannot be
rendered, and no amount of care in the dialog can recover a distinction the
backend never returned.

### 0.4 Two facts that bound how alarming this is — and one that does not

Measured against `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`
(347,054,080 B), because the 2026-08-17 purge removed 20,342 rows and the live
file would give a falsely clean answer:

| table | rows (pre-purge) |
|---|---|
| `document_signatures` | **0** |
| `trusted_peers` | **0** |
| `local_identity` | 1 |

So the feature has never signed a document, and — more importantly — **the trust
store that doors 1–3 depend on has never held a row.** `verify_against_trusted_key`
falls to branch 3 (*"Unknown signer — unverifiable"*) for every bundle not signed
by this machine. The best answer in the repo is currently also a total-refusal
answer, because nothing has ever been paired.

Second bound: the whole surface is `p2p`-gated. `commands/mod.rs:18-19` and nine
`#[cfg(feature = "p2p")]` attributes at `lib.rs:2708-2726` mean **the nine signing
commands do not exist in a `desktop`-only build** — which is `tauri:build:lite`
and `tauri:dev:lite`, the variant `.claude/CLAUDE.md` names as *"Default to
`tauri:dev:lite` for daily work."* Shipped installers use `tauri.conf.json` →
`desktop-full`, so production has them.

**Neither bound makes this not-a-defect, and the reason is the whole point of
this corpus.** Zero rows is a statement about adoption, not about correctness;
the first document a user verifies runs exactly this code. And per the campaign's
standing warning — *a defect is not resolved by the absence of rows that exhibit
it.*

---

## 1. Trigger

You are in this situation when you are about to write, or find yourself typing:

- *"sign this file and give the user something they can send along with it"*
- *"verify that this document hasn't been tampered with"*
- *"read the `.sig.json` next to the file and tell me if it's good"*
- *"who signed this?"* — the moment attribution appears in a UI, you are here
- *"the signature checks out, so show a green tick"*
- **The `if you are about to write X` test:** if you are about to write
  `verify(key_from_the_thing_being_verified, …)`, stop. That is this situation,
  and the answer is never to use that key.

You are **not** here for: hashing a file for change detection with no signer
(`sha256:` alone is `derived-index-sync`), TLS/QUIC certificate handling
(`cross-device-pairing`), or the installer's own minisign signature, which is
Tauri's and is covered in §6.4.

---

## 2. The one way

**Verify against a key you already trust, never against the key the artifact
brought with it — and make the caller unable to supply one.** Concretely: take
the claimed identity out of the envelope and use it only as a *lookup key* into a
local trust store; fetch the public key from that store; check revocation; verify
with the stored key. Return **two** booleans, never one — *the signature is
mathematically valid* and *the signer is someone this install has decided to
trust* are different facts, and collapsing them is the defect. Bind identity to
credential by construction (`peer_id = base58(sha256(public_key))`,
`identity.rs:74-77`) so the cheap lookup is cryptographically the same question
as the expensive comparison — this repo already derives ids that way, so the
binding costs one function call. If you genuinely must accept a first-contact
key, that is a *pairing ceremony* with a human confirmation step, not a
verification result: surface it as "unknown signer" and make the user adopt the
key explicitly before anything renders as trusted. Read the file **once** and
derive both the hash and the signature check from the same buffer
(`signing/mod.rs:80-88` gets this right and says why). And never let an
attribution string travel from an untrusted envelope to a UI label without a
trust boolean travelling beside it.

When both a stored-key lookup and an id↔key binding are available, reach for the
**stored-key lookup first** (`bundle.rs:571-599`); add the binding as
belt-and-braces the way `enclave.rs:238-244` does.

---

## 3. Mandated primitives

Never invent a second one of these. Every name below was read during composition.

| primitive | what it gives you |
|---|---|
| `engine/identity.rs::verify_signature(public_key_b64, message, signature_b64) -> Result<bool>` | the raw Ed25519 check. **Correct, and dangerous by signature** — see §8.1 |
| `engine/identity.rs::peer_id_from_public_key_b64(&str) -> Result<String>` | the binding. Its doc comment is the contract; obey it |
| `engine/identity.rs::public_key_to_peer_id(&VerifyingKey) -> String` | `base58(sha256(pk))` — the derivation both sides must agree on |
| `engine/identity.rs::sign_message(&DbPool, &[u8]) -> Result<String>` | signs with the cached keyring key **and re-checks it against the DB identity** (`:277-293`) before caching. Returns `AppError::KeyringLost` rather than a wrong signature |
| `engine/identity.rs::get_or_create_identity(&DbPool)` | race-safe first-launch keygen; see the 30-line contract at `:31-57` |
| `engine/identity.rs::parse_identity_card(&str)` | the reference implementation of "reject a `(peer_id, public_key)` pair that disagrees" (`:399-405`) |
| `db::repos::resources::identity::get_trusted_peer(pool, peer_id)` | the trust store lookup — returns `trust_level`, `public_key_b64` |
| `TrustLevel::is_revoked()` | revocation. `bundle.rs:578` and `enclave.rs:241` both check it; `verify_document` has nothing to check |
| `engine/path_safety.rs::validate_file_access_path(path, Some(exts))` | canonicalises first, then blocks system dirs, the app-data dir, and anything outside `$HOME`. Symlink-safe by construction (`:396-399`) |
| `engine/path_safety.rs::is_sensitive_credential_path(&str)` | the credential denylist. Backend-enforced |
| `SignatureSidecar` / `SignatureSidecarSigner` (`db::models`) | the portable envelope: `version`, `algorithm`, `document_hash`, `signature`, `signer{peer_id, public_key, display_name}`, `signed_at`, `metadata` |

**There is no primitive for "verify against the trust store".** That absence is
the gap (§8.1) and the type fix (§9).

---

## 4. Steps

1. **Decide whether you are verifying or pairing.** If the signer might be
   unknown, you are pairing, and pairing needs a human. Do not blend the two.
2. **Resolve the path through `validate_file_access_path`** with an extension
   allowlist. Never `std::fs::read` a caller-supplied path directly.
3. **Apply `is_sensitive_credential_path` to the resolved path** — not the raw
   string, so a symlink cannot smuggle past it (`signing/mod.rs:50-60` explains
   the ordering).
4. **Read the bytes once.** Derive the hash and run the signature check against
   that one buffer. Two `fs::read` calls is a TOCTOU window, and this repo has
   already paid for it — `signing/mod.rs:80-88` and `:186-191` both carry the
   post-mortem.
5. **Parse the envelope, then immediately reduce it to a claimed id.** Everything
   else in the envelope is decoration until the signer is established.
6. **Look the id up in `trusted_peers`.** Not found → return `trusted: false` and
   stop. Found and revoked → return `trusted: false` and stop.
7. **Verify with the STORED key.** If you also hold an embedded key, assert it
   equals the stored one (`enclave.rs:243`) and assert
   `peer_id_from_public_key_b64(embedded) == claimed` (`enclave.rs:227`).
8. **Return two booleans and stop.** Do not compute a single `valid`. The caller
   decides what combination its UI means — that is the caller's policy, not
   yours.
9. **And then stop.** Do not sanitise, truncate, or "clean up" the signer's
   display name for rendering. If it is untrusted it must not be rendered as an
   identity at all; if it is trusted it came from your own trust store and needs
   nothing.

### Can the type make the wrong call impossible? — asked before §9

Yes, and decisively. See §9; the answer is to withhold the public-key parameter.

---

## 5. Anti-patterns

**Verifying against the enclosed key.** Failure mode: the signature proves the
envelope is internally consistent and nothing else. Every forged envelope is
internally consistent. `signing/mod.rs:196-198`.

**Collapsing validity and trust into one boolean.** Failure mode: the UI has no
way to say "real signature, stranger", so it says "valid". `VerifyDocumentResult.valid`.

**Rendering an envelope-supplied name as an identity.** Failure mode: the
attacker chooses the words next to your green tick.
`DriveVerifyDialog.tsx:213-217`.

**Trusting `peer_id` and `public_key` independently from the same untrusted
blob.** Failure mode: sign with your key, claim someone else's id — the exact
attack `enclave.rs:222-228` describes.

**Two reads between hashing and signing.** Failure mode: a signature over bytes
the stored hash does not describe; verification then fails on files nobody
touched. Already fixed here — do not regress it.

**Putting the denylist on the frontend.** Failure mode: any direct
`invoke("sign_document", …)` bypasses it. Fixed here (`signing/mod.rs:50-60`);
the stale comment claiming otherwise is §7.C.

**A `.unwrap_or(false)` you have not thought about.** Fail-closed is correct for
a verification — but it also merges "forged" with "malformed base64", which is
why `verify_document` reports *"Cryptographic signature verification failed"* for
a corrupt key string. Acceptable; know that you chose it.

---

## 6. Evidence

**Copy this one:** `src-tauri/src/engine/bundle.rs:571-599`,
`verify_against_trusted_key`. Twenty-eight lines, a three-branch doc comment that
states the policy before the code, revocation checked first, the embedded key
never touched, and a `(bool, bool)` return. It is the best answer in the
repository and in the fleet.

Also exemplary:

- `engine/src/enclave.rs:222-244` — the binding, with the comment that explains
  the attack and names its siblings. The `signature_valid = key_binds_to_peer_id && verify(…)`
  conjunction at `:229-236` is the shape to copy when you must use an embedded key.
- `engine/src/p2p/protocol.rs:277-303` — `verify_handshake_proof`. Both halves,
  both hard rejects, each with the reason in the error string. The doc comment
  *"Both halves matter"* is the one-sentence version of this whole document.
- `engine/src/identity.rs:31-57` — the `IDENTITY_WRITE_LOCK` contract. A 27-line
  comment explaining a first-launch race between mDNS and the first IPC call, and
  why `Mutex<()>` rather than `OnceLock`. Two tests pin it (`:447`, `:501`).
- `engine/src/identity.rs:164-186` — `local_peer_id_for_status`, which replaced a
  `.unwrap_or_default()` that *"swallowed the error and returned an empty
  local_peer_id — success-theatre that left the dashboard looking healthy while
  signing was silently broken."* Returns `(String, bool)`; the `degraded` flag is
  the pattern §0.3 says `VerifyDocumentResult` is missing.
- `.github/workflows/release.yml:496` — an updater-artifact check that **fails
  loudly when its own precondition is absent**: `"::error::Missing updater
  bundles/signatures for:${MISSING}. Check bundle.createUpdaterArtifacts,
  TAURI_SIGNING_PRIVATE_KEY, and the asset-name patterns above."` This is exactly
  what the contract's §9 demands of a gate, already built, for the *other*
  signing subject in this repo.

### 6.4 The installer half — what is and is not signed

| artifact | signed? | mechanism |
|---|---|---|
| updater bundles | ✅ | minisign; pubkey at `tauri.conf.json:62`, private key from `secrets.TAURI_SIGNING_PRIVATE_KEY` (`release.yml:302-303`) |
| update manifest fetch | ✅ | `endpoints: ["https://github.com/xkazm04/personas/releases/latest/download/latest.json"]`, verified against the embedded pubkey by `tauri_plugin_updater` (`lib.rs:578`) |
| Windows installer (Authenticode) | ❌ | `tauri.conf.json:99` — `"certificateThumbprint": null` |

The updater chain is complete and correctly wired. Authenticode is absent; that
is a cost decision, not a bug, and it is listed here only so a later reader does
not "discover" it.

---

## 7. Deviations found

### 7.A `verify_document` authenticates nothing — `src/commands/signing/mod.rs:196-198`

```rust
let signature_valid =
    identity::verify_signature(&sidecar.signer.public_key, &file_bytes, &sidecar.signature)
        .unwrap_or(false);
```

Both arguments come from `input.sidecar_json`, which arrives from a textarea
(`DriveVerifyDialog.tsx:132-139`). No `peer_id_from_public_key_b64`, no
`get_trusted_peer`, no revocation check. `valid = file_hash_match &&
signature_valid` (`:200`). **Severity: this is the leaf.**

### 7.B The verdict struct cannot express distrust — `src/api/signing/index.ts:22-30` + `db::models::VerifyDocumentResult`

Seven fields, none of them a trust flag, while the two sibling verifiers both
return one. Fixing 7.A without adding this field produces a backend that knows
better and a UI that still cannot say so.

### 7.C Two comments describe the same guard and contradict each other

`src/api/signing/index.ts:48-56`:

> Trust assumption: backend enforcement of the same allowlist **has NOT been
> verified** by this audit… **treat this guard as the PRIMARY gate, not defense in
> depth**.

`src-tauri/src/commands/signing/mod.rs:50-53`:

> Backend enforcement of the sensitive-credential denylist… **This is now the
> PRIMARY gate; the TS guard is defense-in-depth.**

The Rust one is correct — `is_sensitive_credential_path` exists
(`path_safety.rs:45-75`) and is called on the *resolved* path (`mod.rs:54`). The
TS trust statement is stale by at least one implementation. **Comment-only; safe
to apply** under the runbook's apply-freely list, but left to the orchestrator so
this document's measurements land first.

### 7.D The mirror has drifted 7 ways out of 22 — and every drift is safe

Differential test, both implementations run over 22 fixtures (bespoke port of the
Rust function vs. the literal TS regex array):

| fixture | TS | Rust |
|---|---|---|
| `…/keys/private_key.txt` | ❌ | ✅ |
| `…/keys/privatekey.bin` | ❌ | ✅ |
| `id_rsa` (bare, no separator) | ❌ | ✅ |
| `.npmrc` (bare) | ❌ | ✅ |
| `.netrc` (bare) | ❌ | ✅ |
| `wallet.dat` (bare) | ❌ | ✅ |
| `private_key` (bare) | ❌ | ✅ |

**7/22 disagree; in all 7 Rust is broader.** There is no fixture the TS list
blocks and Rust allows. So the drift is entirely in the safe direction — which is
the finding, because the two lists have **no parity test**, and this is the exact
shape `client-rule-mirroring` warns about: each side could be edited alone and
nothing would notice. Today the mirror is safe by luck, not by construction.

### 7.E Both denylists miss the Windows location of the file they name

`.config/gcloud/` is the POSIX path. On Windows, application-default credentials
live at `%APPDATA%\gcloud\application_default_credentials.json`. Both
implementations return **false** for it. The list names the threat and then
enumerates one platform's spelling of it — on a codebase whose primary target is
Windows (`.claude/CLAUDE.md`'s entire build section is Windows-first).

**Not applied — this is a security control whose current setting may be
deliberate.** Filed as deferred fix (§11).

### 7.F The denylist guards the command that leaks least

| command | denylist applied? | what it returns to the renderer |
|---|---|---|
| `sign_document` | ✅ `mod.rs:54` | a SHA-256 hash + an Ed25519 signature |
| `read_sidecar_file` | ❌ | **the file's contents** (`mod.rs:315`) |
| `write_sidecar_file` | ❌ | writes caller-supplied bytes (`mod.rs:303`) |

`sign_document`'s own comment (`path_safety.rs:41-43`) worries about turning it
into *"an exfil oracle over SSH keys / cloud credentials / wallets"*. It is a
weak one: a signature does not reveal plaintext and a hash only confirms a guess.
The sibling two doors down performs an actual read.

**Both are meaningfully constrained** — `Some(ALLOWED_SIDECAR_EXTENSIONS)` limits
them to `.json`, and `resolve_and_guard` (`path_safety.rs:209-261`) canonicalises
first, then blocks system prefixes, the app-data directory (so the vault and
`master.key` are out of reach through this door), and anything outside `$HOME`.
The residue is real but narrow: arbitrary `.json` read/write under the user's home
directory, including things like `~/.claude/settings.json`. Filed as a deferred
fix, not applied.

### 7.G The trust store has never held a row

`trusted_peers` = 0, `document_signatures` = 0 (2026-08-17 backup). Doors 1–3 are
correct and, on this install, unexercised — every bundle verification takes
`bundle.rs:596` (*"Bundle signer is not in trusted peers"*) and returns
`(false, false)`. A correct mechanism with no data behind it has never been
tested against a real second party.

### 7.H The feature is absent from the documented default dev build

Nine `#[cfg(feature = "p2p")]` gates (`lib.rs:2708-2726`) plus
`commands/mod.rs:18` plus `path_safety.rs:338-339`. `p2p` is in `desktop-full`
only (`Cargo.toml:61-62`). `tauri:build:lite` / `tauri:dev:lite` use `desktop`
(`tauri.lite.conf.json`). The frontend has **no capability guard** — `useSigning`
and the three dialogs render unconditionally, so in the lite build the buttons
exist and every `invoke` fails with an unknown-command error. Production
(`tauri.conf.json` → `desktop-full`) is unaffected.

### 7.I One ordering hazard that is correct today

`generate_signing_key` (`mod.rs:223-236`) is named as though it generates a key
and its doc says *"Generate or regenerate the local Ed25519 signing identity."*
It calls `get_or_create_identity`, which **never regenerates** — regeneration is
`reinitialize_identity` (`identity.rs:310`). The comment at `:229-230` (*"Force-refresh
the keyring entry by re-storing"*) describes behaviour the function does not have.
Harmless — the safe direction — but the name and doc promise a destructive
operation that would invalidate all trust relationships, and a future caller may
believe them.

### 7.J What this path CLEARED

Stated because an empty-Deviations section is suspicious and a full one is
unbalanced. These were checked and are right:

- **TOCTOU on both sign and verify** — closed, once each, with the post-mortem in
  the comment (`mod.rs:80-88`, `:186-191`).
- **All-or-nothing metadata validation** — the JSON parse was moved *above* the
  DB insert (`mod.rs:67-78`) after a bug where an invalid-metadata request
  returned `Err` while keeping the row.
- **Signature over the exact archive bytes** — `enclave.rs:216-221`: signing
  `to_string_pretty` and verifying a re-serialised compact struct made *every
  honest enclave fail*. Fixed, and the comment says why.
- **Identity keygen race** — serialised, double-checked, and tested under a
  16-thread barrier (`identity.rs:447-493`).
- **Keyring/DB divergence** — `sign_message` compares the loaded key's
  `verifying_key()` against the persisted public key before caching (`:277-293`)
  and returns `KeyringLost` rather than a signature nobody can verify.
- **Zip bomb on import** — `MAX_DECOMPRESSED_SIZE` 50 MB, checked on the declared
  size *and* on the read (`bundle.rs:640-660`).
- **Updater signing** — complete, with a fail-loud CI check (§6.4).

---

## 8. Gaps in the primitives

### 8.1 `verify_signature` takes the key as a parameter

This is the whole gap. Its signature —
`verify_signature(public_key_b64: &str, message: &[u8], signature_b64: &str)` —
makes "verify against a key the attacker chose" not merely possible but the
*shortest* thing to write. Every correct call site had to add code to be correct;
the incorrect one had to add nothing. There is no
`verify_signature_by_peer(pool, claimed_peer_id, message, signature)` to reach
for, so `bundle.rs` hand-rolls the lookup and `verify_document` skips it.

### 8.2 There is no "unknown signer" state anywhere in the stack

Not in `VerifyDocumentResult`, not in the i18n keys
(`t.plugins.doc_signing.{valid_signature,verification_failed,valid,invalid}` —
four tokens, two states), not in `VerifyResultCard`'s two-colour branch. Adding
the boolean is not enough; the vocabulary is binary end to end.

### 8.3 No adoption path from a sidecar

`trusted_peers` can be populated from an identity card
(`parse_identity_card`) or a p2p pairing ceremony. A user who receives a signed
document and its sidecar has no way to say *"I have confirmed out-of-band that
this key is my colleague's — remember it."* So even after 7.A is fixed, the
honest answer for every real-world sidecar is "unknown signer", with no next step.
**This is upstream of 7.A**: fixing the verify without building the adoption path
converts a false green into a permanent red.

### 8.4 The two denylists are prose-mirrored with no parity instrument

`path_safety.rs:39-40` says *"Mirrors the renderer's SENSITIVE_PATH_PATTERNS
(src/api/signing/index.ts)"*. Nothing checks that claim. §7.D measured 7/22
divergence already.

### 8.5 `sign_document` signs raw bytes, not a statement about them

The signature covers `file_bytes` alone. It does not cover the `metadata`, the
`signed_at`, the `document_hash`, or the signer's own declared name — all of
which sit in the sidecar unsigned and mutable. An attacker holding a legitimately
signed document can rewrite `signed_at` and `metadata` freely and the signature
still verifies. The conventional answer is to sign a canonical serialisation of
the whole envelope-minus-signature; `bundle.rs:262` and `enclave.rs:158` both do
this (they sign `manifest_json`), and only the document path signs bare content.

---

## 9. The missing gate — a reasoned decline, with the numbers, and the instruments that do fit

**Declined.** No census rule is proposed for this leaf. The type change below is
the fix; §9.2 gives the numbers that refused the two candidate rules; §9.3
specifies the two instruments that do fit. (`merge-published-rules.mjs` will
report *"no ```json block in this path"* for this document — that is the intended
state, the same one [`secret-leak-scanning`](./secret-leak-scanning.md) is in.)

### 9.1 Prefer the type — and here it is decisive

Held against the doctrine's seven qualifications:

- **Q5 (withholding beats requiring)** — the fix is to stop handing callers the
  public key. Replace the pub surface with
  `verify_signature_by_peer(pool, claimed_peer_id, message, signature) -> Result<Verified>`
  where `Verified { signature_valid, signer_trusted }`, and demote the raw
  three-argument form to `pub(crate)`. Then §7.A is **unspellable**: there is no
  parameter through which an envelope's key can reach the verifier.
- **Q6 (withhold the dangerous freedom, not the answer)** — the freedom to remove
  is *choosing the key*, not *naming the signer*. `claimed_peer_id` stays a
  caller-supplied `String`, because it is used as a lookup key into local state,
  never as an authenticator. That is exactly `cross-device-pairing`'s
  prescription, and the id↔key derivation this repo already uses is what makes it
  sound.
- **Q3 (count the construction sites)** — five. Three (`bundle.rs` ×2,
  `enclave.rs`) get *simpler*, because the lookup they hand-roll moves into the
  primitive. One (`protocol.rs`) is a genuine exception — a handshake is
  first-contact by definition — and keeps the `pub(crate)` form. One
  (`verify_document`) becomes correct by construction.
- **Q4 (a type anyone can construct authenticates nothing)** — satisfied, because
  the value being protected is not the type but the *pool handle*: the key can
  only come from the database.
- **Q1 / Q2 / Q7** — no bearing; nothing here is about requiredness or a tag
  beside a value.

Where a type cannot reach: **the serialization boundary** (doctrine, "where types
cannot reach" #5). `SignatureSidecar` is parsed from a user-pasted string; no
Rust type stops a JSON body from carrying whatever it likes. That is precisely
why the answer is to make the parsed value *unusable as a key* rather than to
make it well-typed.

### 9.2 The census rule — DECLINED, with the numbers

I built the natural rule and it does not clear the bar. Reporting both attempts,
because the doctrine asks for the numbers that made a refusal.

**Attempt 1 — envelope-supplied verification key.** The anchor
(`verify_signature\s*\(\s*&\w+\.`) has a population of **five call sites total**,
of which **one** violates. A ratchet whose baseline is 1 and whose target is 0 is
the case the doctrine explicitly says to decline: *"The census cannot express
'must be zero' by construction — a rule with zero matches fails structurally."*
The rule would have to be deleted the day it succeeded. Worse, the only pattern
that isolates the violating site keys on the **depth of the field path**
(`sidecar.signer.public_key` has three segments; `sig.signer_public_key_b64` has
two) — which is the contract's named failure mode: *a signal that keys on the
markup a deviation happened to wear in one repo, not on the semantic condition.*
In a repo that spelled its struct `sig.signer.key` it reports green forever.

**Attempt 2 — `unwrap_or(false)` on a verification.** Population 5 across 3 files
(`signing/mod.rs:198`, `bundle.rs:583`, `bundle.rs:595`, `enclave.rs:229`,
`enclave.rs:236`). **Precision 0/5.** Every one of them is fail-closed and
correct. *A gate that fires on correct content is worse than no gate.*

**Overlap check against the existing registry** (182 rules; ids inspected:
`peer-credential-compared-by-value`, `secret-as-bare-string-field`,
`crypto-failure-yields-the-plaintext`, `delimiterless-credential-prefix-class`,
`render-time-redaction-toggle`, `opaque-artifact-outcome`,
`discarded-sync-watermark-write`). `peer-credential-compared-by-value`
(`cross-device-pairing`, baseline 2 files / 2 matches, `roots: ["src-tauri"]`,
pattern `\b(?:token|secret|passcode|fingerprint|api_key)\b\s*==\s*|…`) is the
nearest neighbour. It does **not** match any of my five sites — its vocabulary
has no `public_key` and its shape is an equality comparison, not a call — so
overlap is **0 sites**. The decline is on merit, not on redundancy.

### 9.3 What to build instead

The condition is an **absence** (*no trust lookup happened*), and per doctrine the
census ratchets presence, not absence. The right instrument is a Rust test,
because a test can call the real function and observe the verdict rather than
pattern-match the source:

```rust
#[test]
fn verify_document_refuses_an_unknown_signer() {
    // Sign a file with a keypair that is NOT in trusted_peers and is NOT the
    // local identity. `valid` must be false and `signer_trusted` must be false,
    // however mathematically sound the signature is.
}
```

This fails today, will keep failing until 7.A and 7.B land, and — unlike a
census rule — stays meaningful at zero violations forever. Pair it with a second
test asserting `peer_id_from_public_key_b64(sidecar.signer.public_key) == sidecar.signer.peer_id`
is enforced, mirroring `enclave.rs`'s own guarantee.

**And one instrument the census *can* host, for a different condition:** the
TS↔Rust denylist parity of §7.D/§8.4 is a *set-covers-a-set* question, which the
doctrine notes cannot live in the census either (`check-csp-hosts.mjs` exists for
exactly this shape). A `scripts/check-sensitive-path-parity.mjs` that runs both
implementations over one shared fixture list and **exits 2 if it finds fewer than
N fixtures** — the fail-loud precondition — is the correct home. My differential
harness is the prototype; it found 7 divergences on 22 fixtures in one run.

---

## 10. Composing with the neighbours

Checked against the adjacent leaves' published prescriptions, per doctrine §6.

- **`secret-display-and-transfer`** prescribes `SecureString` for anything
  secret-shaped. It composes cleanly here: a *public* key must not be
  `SecureString` (it needs to be compared and stored in the clear), and this
  path's problem is the opposite of leakage — it is over-acceptance.
- **`secret-and-pii-redaction`** prescribes redacting at the boundary a value
  crosses. `signer_display_name` crosses the IPC boundary from untrusted input;
  redaction is the wrong tool (the string is not secret), but the same *boundary*
  instinct applies — the value should be **dropped**, not scrubbed, when
  untrusted.
- **`cross-device-pairing`** prescribes `id = hash(public_key)`. This path is
  downstream of that decision and is the clearest demonstration of why it pays:
  the binding check is one function call precisely *because* pairing made ids
  derivable. **No conflict; this document routes to it rather than restating it.**
- **`portable-export-bundle`** prescribes that a success type carry a count.
  Composes: `Verified { signature_valid, signer_trusted }` is the same
  instinct — make the outcome type carry the facts the caller must branch on.

No harmful interaction found.

---

## 11. Deferred fixes filed

Three findings touch a security control whose current setting may be deliberate,
so per the standing rules they were **written down, not applied**. See
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) entries
**#76** (7.A + 7.B — bind and split the verdict), **#77** (7.E + 7.F — Windows
gcloud path; denylist on the sidecar read/write doors), and **#78** (7.H —
frontend capability guard for the p2p-gated signing commands).

The one comment correction (§7.C) is apply-freely under the runbook and is left
to the orchestrator.

---

## 12. Corrections to the brief and to the spine

### 12.1 `sides: "client"` — CONTRADICTED, and inverted

The spine says `client`. **Every artifact in this document is server-side Rust.**
The headline defect, all five verification doors, the exemplar, the type fix, the
proposed test, and every one of §7's deviations except 7.B/7.C live in
`src-tauri/`. The frontend's entire contribution is rendering a boolean the
backend already collapsed — and even 7.B (the missing trust field) is a *Rust
struct* that the TS interface mirrors.

This is the eighth recorded contradiction of `sides: "client"`, and it matches the
doctrine's note about the seventh exactly: *sometimes `"client"` is incomplete;
sometimes it is simply inverted.* Here it is **inverted**. A client-scoped brief
would have found a dialog with a colour bug and missed the fact that the backend
never authenticated anything.

The `twoSided: true` flag on the same node is the honest one and it *is* upheld:
the contract between halves (`VerifyDocumentResult`) is where the defect becomes
unfixable from either side alone.

### 12.2 `convergence: "converged"` — CONTRADICTED by a 5/5 silence

Swept `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent` for `ed25519|minisign|verify_signature|createVerify|signature_b64|sign_detached`
across `.ts/.tsx/.rs/.py/.go`: **0 occurrences in 0 files.** Not one sibling signs
or verifies anything.

So the label points at a total silence. Per doctrine this makes it the
**fourteenth** `convergence: converged` leaf tested and the fourteenth to fail,
and the failure mode is the one `embedded-terminal-session` recorded: *zero of
five siblings has the problem at all*, so the label's direction is backwards.
**Personas is the only repo in the cohort with a signature primitive, and it owns
both the fleet's best answer (`verify_against_trusted_key`) and its only
instance of this defect.** Stated as self-comparison, as the doctrine requires.

The cohort here is effectively **1** — not 5, and not the 2–3 other leaves have
measured — because a silence cannot be inflated by lineage.

### 12.3 The brief's own leads, tested

- **"First establish whether this repo signs anything at all… a leaf can be
  honestly answered *this situation does not occur here*."** — It does occur, and
  substantially: 5 verification doors, 3 signing doors, a 9-command IPC surface, a
  sidecar format, and a wired updater chain. The escape hatch was not needed.
- **"Webhook signature verification is the likeliest real subject."** — **Wrong.**
  I searched for inbound HMAC verification and the repo has none of the shape the
  brief predicted; `hmac` in `Cargo.toml:157` is not used for payload
  verification on any inbound route. The real subject is the one the spine named
  literally — signing a file and writing a sidecar.
- **"The defect to look for is a comparison that is not constant-time, or a
  verification that is skipped when the secret is unset."** — **Neither.** All
  comparisons go through `ed25519_dalek::Verifier`, which is constant-time by
  construction, and no verification is conditional on a secret being present. The
  actual defect is orthogonal to both: the verification *runs*, correctly, against
  the wrong key.
- **Deferred-fixes #42 (`assetProtocol` scope includes `$APPDATA/**`)** — verified
  as **not reachable through this leaf**. `resolve_and_guard`
  (`path_safety.rs:244-251`) blocks the app-data directory on the canonicalised
  path, so `master.key` and `personas.db` are out of reach of all three
  file-touching signing commands. #42's concern is a different channel and stands
  on its own; it does not compound here.

### 12.4 A measurement of mine that was wrong, and how it was caught

My first spawn-region matcher (used for the sibling leaf, same harness) reported
**25** unprotected sites; hand-verification found **19 false positives** — `git`,
`npx tsc`, `powershell`, and `--version` probes swept in because my "is this the
Claude CLI?" test matched the word `claude` anywhere in a 1,200-character context
window. A subagent's independent read reported **4**, having missed two real sites
in `ocr/mod.rs`. Neither number was right; the hand-verified answer is **6**.

Recording it here because it is the doctrine's rule earning itself twice in one
session: *a vocabulary-based signal's precision is bounded by its author's word
list* — and my word list came from imagination rather than from the tree.

### 12.5 A tooling hazard worth passing on

A `python -` heredoc used to patch my scratch rule file re-encoded an em-dash in a
JSON string into CP1252 mojibake (`â€”`). Caught immediately
because the file was re-read. Same family as the CRLF hazard the doctrine already
records: **after any programmatic edit to a JSON or Markdown artifact, re-read it
before trusting it.**
