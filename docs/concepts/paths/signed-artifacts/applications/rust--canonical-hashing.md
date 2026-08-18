---
layer: application
subject: signed-artifacts
technique: canonical-hashing
stack: rust
---

# Canonical bytes in the enclave, the bundle, and the document signer

This repo contains both sound strategies from the technique — and paid for
the trap between them in a shipped bug whose post-mortem now lives in a
comment.

## Strategy A, learned the hard way: `enclave.rs`

`src-tauri/engine/src/enclave.rs` seals a persona into a ZIP of
`manifest.json` + `signature.json` + `persona.json`. `seal()` signs
`serde_json::to_string_pretty(&manifest)` (`enclave.rs:157-158`). The
original `verify()` re-serialized the *parsed* struct with
`serde_json::to_string` (compact) and verified over that — pretty vs compact
meant **"every honest enclave failed verification"**, and the round-trip
also "silently dropped any unsigned/extra fields the on-disk manifest
carried". The fix comment at `enclave.rs:213-218` records both failure
directions of the technique's trap in one place. Today `parse_enclave`
returns the RAW `manifest.json` string alongside the parsed struct
(`enclave.rs:281-283`, with the rationale comment: "the signature is
verified over exactly these … never over a re-serialized struct, so
reformatting/reordering/extra fields can't slip past the check") and
`verify()` checks the signature over `manifest_json.as_bytes()`
(`enclave.rs:231-237`).

The digest chain is walked to the payload: the manifest carries
`content_hash` over `persona.json` (`enclave.rs:139`), and `verify()`
recomputes it against the actual archive member (`enclave.rs:240-241`,
`content_intact`). Signature over preserved manifest bytes, declared digest
recomputed over the payload about to be imported — the full chain the
technique demands.

## The trap, still live next door: `engine/bundle.rs`

The persona-share bundle (`src-tauri/src/engine/bundle.rs`) has the same
ZIP shape but its verifiers re-serialize: `preview_bundle`, `apply_import`,
and `verify_bundle` all verify over
`serde_json::to_string_pretty(&manifest)?` of the *parsed* struct
(`bundle.rs:327`, `:405`, `:540`) rather than the raw archive member. It
works today because export signs the identical pretty serialization of the
identical struct (`bundle.rs:261-262`) — canonicalization-by-shared-
serializer, the fragile middle: a struct field added in a future version
will make older installs' re-serialization diverge from what newer installs
signed, failing honest bundles cross-version, exactly the class
`enclave.rs` already fixed. The compliant sibling is 300 lines away; the
harmonization is a mechanical port of `parse_enclave`'s raw-bytes return.

## Read-once, with both post-mortems: `commands/signing/mod.rs`

Document signing hashes and signs one buffer. `hash_bytes`
(`signing/mod.rs:32-35`) exists precisely so `sign_document` could stop
calling `std::fs::read` twice — the comment at `:80-85` records the
observed failure ("an editor autosave / build tool / cloud-sync between
them produced a record whose stored hash referred to content the signature
was not taken over, making `verify_document` report 'signature invalid' on
files that were never tampered with"). The verify side carries the mirror
comment (`:186-190`): two reads would let a swap pass the hash check
against old content and the signature check against new content, "making
`valid = file_hash_match && signature_valid` true for a file that matches
neither end-to-end".

The stored digest names its recomputation: `hash_bytes` returns
`"sha256:{hex}"` (`:34`), so `document_hash` in every sidecar is
self-describing.

## Where the statement is signed — and where only the content is

`enclave.rs` and `bundle.rs` sign the *manifest* — the statement carrying
the content hash, creator identity, timestamps, and policy — so tampering
with any displayed claim breaks the seal. `sign_document` signs the raw
`file_bytes` alone (`signing/mod.rs:93`): the sidecar's `signed_at`,
`metadata`, and signer `display_name` travel unsigned and mutable, the
content-only compromise the technique warns about. Registered as part of
deferred-fix entry 76's cluster (legacy analysis:
`docs/concepts/golden-paths/document-signing.md` §8.5).
