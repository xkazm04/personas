---
layer: technique
subject: signed-artifacts
technique: signature-lifecycle
status: forged
laws: [identity-survives-reuse, deletion-is-not-repair, derivation-names-recomputation]
shared_with: []
---

# Signature lifecycle

Signing is not an event; it opens a record with a long life. The moment a
signature exists there are three durable things — the artifact, the sidecar,
and the **local record** of having signed — and they age at different rates,
move independently, and are consulted by different features. This technique
owns what happens after the ink dries: listing, matching, re-export,
revocation, and the honest meaning of deletion.

## The ledger of what you signed

Every signing operation writes a local record: artifact name, the path it
had, the content digest, the signature, the signer identity, timestamps.
This ledger is what powers listing ("what have I signed?"), badging
("is this file signed?"), re-export, and audit. Two disciplines keep it
useful:

- **The record's identity is minted, not derived from circumstance.** A
  fresh unique id per record — not the path, not the timestamp — so records
  survive file renames, re-signs of the same file, and two files signed in
  the same second
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
- **The record stores enough to regenerate the sidecar.** A sidecar is a
  *projection* of the record — digest, signature, signer block, timestamp —
  so re-export is a pure function of the ledger row
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
  A user who lost the sidecar gets a new one; a record that cannot
  reconstruct its sidecar is a receipt for a document nobody can check.

## Matching records to files: a path is a spelling

The record stores a path because that is how the signing call received the
file — typically absolute, in the host platform's separator convention. The
features that consume the ledger meet the same file under other spellings:
relative to a managed root, forward-slashed by a UI layer, moved one folder
up. **Path normalization is part of matching, not a cosmetic afterthought.**
Normalize both sides to one canonical form before comparing — one separator
convention, one root-relativity, trailing separators stripped — and make the
normalizer a single shared function rather than a per-call-site regex, or
the spellings will drift per feature. A record whose path does not reduce to
anything under the current root is not an error; it is a signature imported
from elsewhere, and the honest match result is "not one of ours here", not
a crash and not a false negative rendered as "unsigned".

And remember which identity is load-bearing: the path is a **locator**, the
content digest is the **identity**. Renames break the locator and leave the
identity intact; edits do the reverse. A matching layer that can fall back
from path to digest survives reorganizations; one that trusts path equality
alone reports a moved-but-intact file as unsigned and a replaced file at the
old path as signed.

## The verdict is live, never archived

A verification verdict is a function of three inputs: the bytes, the
signature, and **the trust store as of now**. The first two are frozen; the
third moves. Revoking a peer must flip every future verification of their
artifacts to untrusted *immediately* — which means verdicts are recomputed
at each ask, and any cache of "verified" is keyed to trust-store state or
does not exist. The badge that says "verified" a week after the signer was
revoked is not stale; it is wrong, at the exact moment the revocation
existed to protect.

## Deletion: what removing a record does and does not do

Deleting a ledger record removes *your memory of signing* — the listing row,
the badge, the ability to re-export. It does **not** revoke anything:
sidecars already exported verify exactly as before, on every machine that
holds them, because the mathematics never consulted your ledger
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) — removing
the local artifact of a decision does not undo the decision). The UI copy
for record deletion says this plainly. If what the user wants is "make that
signature stop counting", the answer is on the verifier side: their peers
revoke the signer, or — for a compromised key — the whole identity retires
per [key-custody](key-custody.md). There is no remote-recall button, and a
lifecycle design that implies one is writing a check the cryptography
cannot cash.

## Re-signing and versions

Content changes invalidate signatures by design — a tampered verdict on an
edited file is the system working. The lifecycle answer is a *re-sign* flow
that treats the old record as history, not garbage: sign the new bytes,
mint a new record, keep the old one (it truthfully describes the version
that existed). A file's signing history is then a sequence of records, each
pinned to a digest — which composes naturally with the
[versioning-snapshots](../../versioning-snapshots/versioning-snapshots.md)
subject if the artifact is itself versioned. Deleting the old record on
re-sign silently rewrites history; keeping it costs one row and preserves
the answer to "was this version ever legitimately signed?"
