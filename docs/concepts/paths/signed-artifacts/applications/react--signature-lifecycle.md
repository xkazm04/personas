---
layer: application
subject: signed-artifacts
technique: signature-lifecycle
stack: react
---

# The Drive signing ledger: normalization, re-export, and deletion honesty

`src/features/plugins/drive/signing/useSigning.ts` is the bridge between
the signature ledger (`document_signatures`, repo at
`src-tauri/db/src/repos/resources/signing.rs`) and the Drive Finder, and it
exercises most of the lifecycle surface.

## A path is a spelling: `toDriveRelative`

The ledger stores the *absolute* path passed to `sign_document` (root + OS
separator + relative). The Finder matches entries by *drive-relative,
forward-slashed* paths. `toDriveRelative` (`useSigning.ts:34-41`) is the
normalizer: backslashes → `/` on both sides, trailing separators stripped
from the root, prefix-match against `"{root}/"`. Its doc comment carries
the technique's escape clause verbatim in miniature: it "returns null when
the path isn't under the given root (e.g. a sidecar imported from
elsewhere)" — a record that does not reduce to the current root is "not one
of ours here", skipped in `signedPaths` (`:195-199`) rather than crashed on
or misreported. The write side mirrors the same convention: `signDriveFile`
and `verifyDriveFile` rebuild the absolute path with the root's own
separator (`:114-115`, `:169-170`), so records land in one canonical
spelling per platform.

Two calibration notes against the technique. The normalizer is a
module-local function consumed through the memoized `signedPaths` set —
one authority in practice because every badge consumer reads the set
rather than re-deriving the mapping (the comment at `:189-191` names that
as the point). And matching is path-only: a file renamed inside the drive
loses its badge even though its bytes still verify against the record's
`file_hash` — the digest-fallback the technique prescribes is unbuilt.

## Listing and re-export

`refreshSignatures` (`:94-104`) loads the ledger lazily ("defers the
history query until `refreshSignatures()` is called", `:47-50`);
`DriveSignaturesPanel.tsx` renders it. Re-export is a pure projection of
the ledger row: `export_signature_sidecar`
(`src-tauri/src/commands/signing/mod.rs:264-292`) rebuilds the full
`SignatureSidecar` — digest, signature, signer block, timestamp — from the
stored record, so a lost sidecar is one click from regenerated.

## Deletion is local memory, not revocation

`removeSignature` (`useSigning.ts:176-182`) calls
`delete_document_signature` (`signing/mod.rs:255-262`), which deletes the
ledger row and nothing else. Exported `.sig.json` sidecars keep verifying
everywhere they already are — the mathematics never consulted this ledger.
The technique's demand that UI copy say so plainly is currently unmet: the
panel offers deletion without distinguishing "forget this record" from any
implied recall. Real revocation lives on the verifier side, and the
machinery exists — `TrustLevel::is_revoked()` is checked by both trust-
store doors (`src/engine/bundle.rs:578`, `engine/src/enclave.rs:246-251`)
— but the document-verify door consults no trust store at all
(deferred-fix entry 76), so for sidecar-verified documents there is nowhere
a revocation *could* take effect yet. The verdict-is-live rule is upheld
where it can be: every `verify_bundle` / enclave `verify()` call recomputes
against the current `trusted_peers` row; no verdict is cached.

## Re-signing

There is no re-sign flow; signing the same file twice inserts two ledger
rows (fresh `uuid` per record, `signing/mod.rs:96` — minted identity,
correctly). History is therefore preserved by accident of insert-only
storage rather than by design: nothing links the records of successive
versions of one file, and the panel presents them as unrelated rows. The
versioned-artifact composition the technique sketches remains open ground.
