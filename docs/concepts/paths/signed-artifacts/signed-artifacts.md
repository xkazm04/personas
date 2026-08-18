---
layer: golden-path
subject: signed-artifacts
status: forged
techniques:
  - canonical-hashing
  - detached-signatures-and-key-identity
  - verification-ux
  - key-custody
  - import-verification-flow
  - signature-lifecycle
evidence:
  - src-tauri/src/engine/bundle.rs                 # verify_against_trusted_key — the strongest verification door: stored key, revocation checked, two-boolean verdict
  - src-tauri/engine/src/enclave.rs                # raw-signed-bytes verification + id↔key binding, with both post-mortems in comments
  - src-tauri/src/commands/signing/mod.rs          # read-once hashing (TOCTOU closed twice), all-or-nothing sign, sidecar build/export
  - src-tauri/src/commands/network/bundle.rs       # preview→commit hash pinning on every ingress channel; the hashless share-link decision, tested
  - src/features/settings/sub_network/components/BundleImportDialog.tsx   # danger-kind-matched consent that re-arms when the danger context changes
  - src/features/plugins/drive/signing/useSigning.ts                      # absolute↔relative path normalization so records match files across spellings
counter_evidence:
  - src/features/plugins/drive/signing/DriveVerifyDialog.tsx   # a two-state verdict card that renders an envelope-supplied name under a green check
deviations:
  - w11-signed-artifacts   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-76   # entry "## 76." in docs/concepts/golden-path-deferred-fixes.md — verify_document verifies against the key inside the file it checks
  - deferred-fix-77   # entry "## 77." — the sensitive-path denylists miss the platform spelling they name, and guard the wrong door
  - deferred-fix-78   # entry "## 78." — the signing surface is absent from the default dev build and the UI does not know
---

# Signed artifacts & provenance

This is the subject you own the moment data leaves your process as a file
meant to be **carried**: an export bundle, a sealed configuration archive, a
document with a signature saved beside it, a link that promises "these bytes,
from this person". The producing program and the consuming program are no
longer the same process — often not the same machine, not the same install,
not the same year — so everything that used to be guaranteed by a shared heap
becomes a **claim** one side makes and the other side must test. Three claims,
precisely:

1. **Integrity** — these are the bytes the producer produced, unchanged.
2. **Provenance** — a *named* identity produced them, and the verifier can say
   who, not merely that someone did.
3. **Admissibility** — the consumer examined both claims *before* merging
   anything, and refused or demanded informed consent when either failed.

A signed artifact system is those three claims made checkable, plus the honest
reporting of what the check found. Everything else — archive formats, sidecar
conventions, key ceremonies — is machinery in service of them.

What is *not* this subject. Installer and platform code-signing — satisfying
an operating system's trust machinery so your product launches without a
warning — belongs to packaging's
[signing-and-trust](../packaging/techniques/signing-and-trust.md): different
authority (the platform vendor), different key custody class, different
failure surface. Custody of **other people's** secrets is the
[credential-vault](../credential-vault/credential-vault.md); the signing key
this subject uses is a secret the application *mints and owns*, which that
subject explicitly carves out as a related discipline with a different
lifecycle — [key-custody](techniques/key-custody.md) is where that carve-out
lands. Verifying artifacts you *consume from third-party ecosystems* —
dependencies, downloaded runtimes, registry tarballs — is the supply-chain
subject (forging concurrently). And plain change-detection hashing with no
signer is not provenance at all; it answers "did this change", never "who says
so".

## The spine

Every design question in this subject locates on one path:

> **produce → carry → verify → decide → commit**

**Produce**: choose the exact bytes the signature covers and say so —
[canonical-hashing](techniques/canonical-hashing.md). "The same content" has
many byte spellings, and a signature covers exactly one of them.

**Carry**: the signature travels detached, in a sidecar or a named archive
member, carrying the signer's identity with it —
[detached-signatures-and-key-identity](techniques/detached-signatures-and-key-identity.md).
What it must *not* carry is the authority to verify itself.

**Verify**: the consumer tests both claims against things it already holds —
the declared bytes recomputed, the claimed identity resolved through a local
trust store — and produces a verdict with three honest states —
[verification-ux](techniques/verification-ux.md).

**Decide**: a human (or a policy standing in for one) sees the verdict and the
provenance *before* anything merges, and any decision to proceed despite a
failed or unverifiable claim is explicit, specific, and re-asked when the
facts change — [import-verification-flow](techniques/import-verification-flow.md).

**Commit**: the bytes that merge are the bytes that were verified and
previewed — not a second read of a path that may have changed underneath —
and the committed rows record what the verification found. Afterward, the
records that signing and importing created live on and age —
[signature-lifecycle](techniques/signature-lifecycle.md) — and the keys that
made it all possible get generated, protected, rotated, and mourned —
[key-custody](techniques/key-custody.md).

## The three convergent failures

Measured repeatedly across a six-codebase fleet during this corpus's
composition, the failures of this subject are not exotic cryptography
mistakes. They are three mundane shapes, and each technique exists to kill
one or more of them.

**The marker written on the way out and never read on the way back in.** A
version stamp the importer skips. A content hash nothing recomputes. A
signature verdict computed correctly — then written to a provenance field
while the import proceeds regardless. The work of verification is done; *only
the `if` is missing*. This shape survives review because a diff that adds a
hash looks like a diff that adds integrity. Before any marker enters the
format, name the line that will refuse because of it
([failure-not-empty-success](../_laws.md#failure-not-empty-success)); after
it ships, the gate must read the marker on the artifact actually being
admitted ([gate-sees-target](../_laws.md#gate-sees-target)).

**Trusting the envelope about the envelope.** The signature file carries a
public key and a display name; the naive verifier checks the signature with
that key and shows that name under a green check. The math passes — every
forged envelope is internally consistent — and the one question that matters,
*whose key is that*, was never asked. The cure is structural, not
disciplinary: identity is derived from the key so the two cannot be claimed
independently, and verification resolves the claimed identity through a local
trust store rather than accepting the enclosed key
([detached-signatures-and-key-identity](techniques/detached-signatures-and-key-identity.md)).

**Collapsing three states into two.** "Verified" and "tampered" are
completions; "unverifiable" — unknown signer, no signature present, the check
could not run — is neither, and folding it into either one is a lie with a
long tail. Folded into "tampered", strangers' legitimate artifacts all read as
attacks and users learn to click through red. Folded into "verified", a green
check vouches for a stranger. This is the same three-state discipline the
health-checks subject proved out
([three-state-outcomes](../health-checks/techniques/three-state-outcomes.md)),
applied at a boundary where the third state is not an edge case but the
*default* first-contact experience.

## What "who" means without a central authority

This subject's provenance is peer provenance. There is no certificate
authority handing out identities; there is a keypair minted on a device, an
identifier derived from the public key, and a local table of peers this
install has decided to trust. Three consequences follow, and they shape every
technique:

- **Trust is a local, mutable decision** — a row, adoptable through an
  explicit pairing ceremony and revocable the same way. Verification verdicts
  must therefore be *recomputed against the live store*, never cached across
  trust changes ([signature-lifecycle](techniques/signature-lifecycle.md)).
- **First contact is a ceremony, not a verdict.** An artifact from a signer
  the store has never seen is *unverifiable*, however sound its math. The
  honest system gives the user a way to adopt the signer out-of-band — and
  until then says "unknown", not "invalid" and not "valid".
- **Key loss is identity loss.** Rotation and regeneration void every trust
  relationship the old key had earned; they are destructive, explicit
  operations, never side effects ([key-custody](techniques/key-custody.md)).

## Identity of the artifact itself

An artifact's identity is its **content**, not its location. The signature
record stores a path because humans find files by path — but a path is a
spelling, and the same file has many: different separator conventions,
absolute versus relative to a managed root, renamed parents. An artifact
verified under one spelling must match its record under another, so matching
normalizes both sides to one canonical form — and falls back to the content
hash as the identity of last resort, because the hash survives every rename
([signature-lifecycle](techniques/signature-lifecycle.md),
[identity-survives-reuse](../_laws.md#identity-survives-reuse)). The same law
governs what import does to arriving entities: mint fresh local identity or
match on a stable key — never match on a field the importer itself mutates,
which turns every round trip into a duplicate.

## Order of adoption

For a system that has none of this, the build order that pays at every step:

1. **Content hashing with a declared subject** — what exactly is hashed,
   stated; algorithm named inside the stored value. Integrity without
   provenance is already worth shipping (tamper and corruption detection).
2. **Preview-then-commit with hash pinning** — even unsigned, an import that
   shows what will merge and commits exactly the previewed bytes kills the
   swap-after-preview class.
3. **A signing identity and detached signatures** — now artifacts carry
   provenance claims.
4. **The trust store and three-state verdicts** — now provenance claims can
   be *tested*, and the UI can tell the truth about the result.
5. **Lifecycle: listing, re-export, revocation, re-signing** — now the system
   survives time.

Steps 3–5 are where teams stop early, and the result is worse than stopping
at 2: a signature that is checked against its own envelope, or displayed but
never enforced, manufactures confidence that step 1 alone never claimed. Ship
the honest subset; never ship the decorative superset.
