---
layer: application
subject: signed-artifacts
technique: detached-signatures-and-key-identity
stack: rust
---

# Five verification doors, one identity scheme — and the door that skips both

The repo derives peer identity from the key exactly as the technique
prescribes — `peer_id = base58(sha256(public_key))`
(`src-tauri/engine/src/identity.rs:74-77`) — and states the binding
obligation at the derivation site: callers receiving an untrusted
`(peer_id, public_key)` pair "MUST check that this derivation matches the
claimed peer_id before trusting either" (`identity.rs:81-86`). Five call
sites verify Ed25519 signatures; ranked by the technique's door ordering
(measurement inherited from the legacy composition,
`docs/concepts/golden-paths/document-signing.md` §0.2):

| door | key comes from | binds id↔key | trust store | class |
|---|---|---|---|---|
| `src/engine/bundle.rs:582` | `trusted_peers` row | n/a — stored key | ✅ + revocation | **door 1** |
| `src/engine/bundle.rs:590` | local identity row | n/a — stored key | ✅ | door 1 |
| `engine/src/enclave.rs:226-237` | the archive | ✅ `:227` | ✅ `:246-251`, incl. stored-key equality | door 2 + 1 |
| `engine/src/p2p/protocol.rs:297` | the handshake | ✅ `:290`, hard reject | caller's job (first contact) | door 2 |
| `src/commands/signing/mod.rs:196-198` | **the pasted sidecar** | ❌ | ❌ | **the hole** |

## The exemplar: `verify_against_trusted_key`

`src-tauri/src/engine/bundle.rs:557-605` is the copy-this implementation.
The claimed `signer_peer_id` is used **only as a lookup key**: found in
`trusted_peers` → `trust_level.is_revoked()` checked first → signature
verified against the **stored** `public_key_b64`; the envelope's embedded
key is never consulted. Not found and not the local identity → the third
branch returns `(false, false)` with the honest log line "Bundle signer is
not in trusted peers — signature unverifiable" (`bundle.rs:603`). The
return type is the technique's two-boolean verdict,
`(signature_valid, signer_trusted)` — validity and trust never collapsed.

`enclave.rs` shows the belt-and-braces composite for self-describing
archives: `key_binds_to_peer_id` computed via
`peer_id_from_public_key_b64` *before* the embedded key is used
(`enclave.rs:226-229`), `signature_valid` as the conjunction (`:231-237`),
and `creator_trusted` additionally requiring a non-revoked trust row whose
**stored key equals the embedded key** (`:246-251`). The comment above it
(`:219-225`) narrates the splice attack the binding kills — "an attacker
could sign with their own key but claim a trusted peer's id and read as
signed-and-trusted" — and enumerates the sibling sites that already bind.

## The hole: `verify_document`

`sign_document` builds the detached sidecar correctly — a
`SignatureSidecar` (`src-tauri/core/src/models/signing.rs:54-70`) with
`version`, `algorithm`, `document_hash`, `signature`, signer block, written
as `<name>.sig.json` beside the file. But `verify_document`
(`src-tauri/src/commands/signing/mod.rs:196-198`) verifies with
`&sidecar.signer.public_key` — both key and signature from the same pasted
envelope, no `peer_id_from_public_key_b64` binding, no `get_trusted_peer`
lookup, no revocation check. Every forged sidecar is internally consistent,
so `valid = file_hash_match && signature_valid` (`:200`) comes back `true`
for any attacker-minted keypair, and the envelope's `display_name` flows
into the result (`:204-205`) for the UI to render as an identity. This is
deferred-fix entry 76 (`docs/concepts/golden-path-deferred-fixes.md`
"## 76."), left unapplied per the security-control standing rule.

The primitive's shape is the root cause the technique names:
`identity::verify_signature(public_key_b64, message, signature_b64)`
(`identity.rs`) takes the key as a parameter, so the shortest call is the
broken one — three correct doors each added lookup code by hand; the
incorrect one added nothing. The prescribed wrap (a
`verify_signature_by_peer(pool, claimed_peer_id, …)` with the raw form
demoted to crate-private) is specified in the legacy analysis §9.1.

## Sidecar discovery as convenience, not substitute

`useSigning.findSidecarInDrive`
(`src/features/plugins/drive/signing/useSigning.ts:138-157`) auto-locates
`<path>.sig.json` siblings for the verify dialog, treating absence as the
common quiet path (breadcrumb-level logging, no toast). The discovered
sidecar then goes through the same `verify_document` door as a pasted one —
correct layering; the door itself is what needs the trust store.
