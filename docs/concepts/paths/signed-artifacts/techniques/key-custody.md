---
layer: technique
subject: signed-artifacts
technique: key-custody
status: forged
laws: [identity-survives-reuse, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Key custody

The signing key is a secret, but it is a different *kind* of secret from the
ones the [credential-vault](../../credential-vault/credential-vault.md)
holds. Vault credentials are issued by external authorities and cannot be
re-minted; the signing key is **minted and owned locally** — the application
can generate a new one at will. That sounds like lower stakes and is the
opposite: what the key accumulates over its lifetime is *other people's trust
decisions*, and those cannot be re-minted by you at all. Losing a vault
credential costs a re-acquisition flow; losing (or carelessly regenerating) a
signing key voids every trust relationship the old identity had earned, on
machines you do not control. Custody decisions follow from that asymmetry.

(Platform code-signing keys — the ones that satisfy an operating system's
installer trust machinery — are a third class again, with hardware-custody
norms and vendor-run revocation; they belong to packaging's
[signing-and-trust](../../packaging/techniques/signing-and-trust.md). This
technique owns the application's own artifact-signing identity.)

## Generation: once, lazily, race-safely

Mint the identity at first need, not at install — most installs never sign
anything, and an unminted key is the one key that cannot leak. But "first
need" arrives concurrently: a background discovery service and the first
user-triggered signing call can both find no identity and both mint one,
leaving the store and the OS keychain describing different keys. Generation
must be serialized and double-checked — one writer path, check-again inside
the lock — so exactly one identity exists however the first callers race.
The identifier is derived from the public key at mint time and carried from
then on ([identity-survives-reuse](../../_laws.md#identity-survives-reuse));
it is the stable name every future signature and trust row hangs off.

## Storage: split the halves, then keep them honest

The private half belongs in the operating system's protected secret store;
the public half and the derived identifier live in ordinary application
state, where queries and UIs can reach them freely. This split creates a new
obligation: **the two stores can diverge** — a keychain wiped by an OS
reinstall, a database restored from backup, a sync tool that moved one store
and not the other. Divergence must be *detected at signing time* (does the
loaded private key actually correspond to the persisted public key?) and must
fail loudly with a named error — never by silently signing with whichever key
was found, which produces signatures nobody can verify and no one can explain
([failure-not-empty-success](../../_laws.md#failure-not-empty-success): a
signing operation that cannot use the right key must be distinguishable from
one that succeeded).

## Device-bound by default

Let the key be the **device's** identity, not the person's. Private-key
export and cross-device sync multiply the compromise surface and blur what a
signature attests ("this artifact came from my laptop" is a checkable claim;
"from me, wherever I was" is not). A person with three devices pairs three
identities with their peers — mildly tedious, wholly explicit, and each
device's compromise is separately containable and separately revocable.

## Loss, rotation, and the funeral rites

Name what each event means *before* it happens:

- **Private key lost** (keychain wiped, device gone): this install can no
  longer sign. Everything already signed still verifies — verifiers hold the
  public key — but new signatures require a new identity, which peers must
  re-adopt. Loss is an identity funeral, and the UI should say so rather
  than offering a quiet "regenerate" that pretends continuity.
- **Rotation** (deliberate new key): same funeral, scheduled. The operation
  is destructive by definition and must be spelled as such — an explicit,
  confirmed, separately-named action. The classic hazard is a function named
  "regenerate" that actually get-or-creates: harmless in the safe direction,
  but its name and docs promise destruction, and a future caller who believes
  them will build a rotation flow that rotates nothing. Name operations for
  what they do; make the destructive one impossible to trigger as a side
  effect ([creation-names-reaper](../../_laws.md#creation-names-reaper) —
  the identity's destroyer is a named, deliberate operation, decided at
  design time, not an emergent property of a getter).
- **Compromise**: revocation lives on the *verifier's* side — there is no
  central authority to appeal to. Peers mark the identity revoked in their
  trust stores, after which its signatures verify as untrusted. Your side of
  the rite is notification and re-pairing under the new key. Design the
  revocation state into the trust store from day one (a trust level that can
  express "was trusted, now revoked" — see
  [signature-lifecycle](signature-lifecycle.md)) because retrofitting it
  after the first incident is retrofitting it during the incident.
