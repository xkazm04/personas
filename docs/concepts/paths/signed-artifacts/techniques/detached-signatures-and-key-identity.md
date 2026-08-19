---
layer: technique
subject: signed-artifacts
technique: detached-signatures-and-key-identity
status: forged
laws: [gate-sees-target, identity-survives-reuse]
shared_with: []
---

# Detached signatures and key identity

A detached signature lives **beside** the artifact, not inside it: a sidecar
file named by convention next to the document, or a distinct member inside an
archive next to the payload. Detachment is the right default for artifact
signing because it leaves the original bytes untouched (any tool can still
read the document; the hash covers the document alone), works for any format
including opaque binaries, and lets signatures multiply — several signers,
re-signing after edits — without rewriting the artifact. The sidecar carries
the signature plus a **signer block**: the claimed identity, the public key,
a display name, a timestamp. Which brings us immediately to the only rule in
this technique that is worth a cardinal ranking:

> **Never verify against the key that arrived in the same envelope as the
> signature — and structure the verifier so that callers cannot.**

A signature checked with the enclosed key proves one thing: the envelope is
internally consistent. Every forged envelope is internally consistent —
anyone can mint a keypair, sign anything, and write a signer block naming
themselves after your security team. The math will pass; the hash will match;
a naive UI will render the attacker's chosen words beside a green check. The
question that would have failed — *whose key is that?* — is the entire
content of provenance, and the enclosed key can never answer it
([gate-sees-target](../../_laws.md#gate-sees-target): the thing being gated
is the signer's identity, and an envelope observing itself observes nothing).

## Identity derived from the key

Give every signer an identifier **derived from the public key** — a digest of
the key, encoded short. This one design decision converts an expensive
distributed-systems problem into a one-line check: claiming an identity and
holding a key are now the *same cryptographic claim*, so a verifier holding
an untrusted `(identity, key)` pair binds them by recomputing the derivation
and comparing. Without the binding, a verifier that trusts the enclosed key
for the signature while separately trusting the claimed identity for a trust
lookup is open to the splice attack: sign with your own key, claim a trusted
peer's identity, read as signed-and-trusted. The derivation must be one
authority both sides share forever — it *is* the identity scheme
([identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
identity survives because it is recomputable from the credential, not stored
beside it).

State the binding rule where the derivation is defined, as an obligation on
callers: any code receiving an identity-key pair from an untrusted source
MUST check the derivation before trusting either half. Then audit that every
verification door actually does — the door most likely to skip it is the one
added last, for the input channel the original enumeration did not include.

## The trust-store lookup is the strongest door

Rank the ways a verifier can obtain the key, strongest first:

1. **Stored-key lookup.** Take the claimed identity out of the envelope and
   use it *only as a lookup key* into the local trust store. Not found →
   unverifiable, stop. Found but revoked → refused, stop. Otherwise verify
   with the **stored** key. A forged envelope cannot influence the key used,
   because the key never came from the envelope. If the envelope also embeds
   a key, assert it equals the stored one — belt and braces, not the
   mechanism.
2. **Bound embedded key.** Where no store row can exist yet (first contact,
   self-describing archives), verify with the embedded key *only after* the
   id↔key binding check passes, and report the signer as bound-but-unknown —
   this proves the signer holds the identity they claim, and nothing about
   whether you should care.
3. **Enclosed key, unbound.** Not a door. A hole.

When both 1 and 2 are available, reach for 1 and add 2's binding as the
cross-check. And make the strongest door the *easiest to call*: if the raw
verify primitive takes a public key as a parameter, every correct call site
must add the lookup by hand and the incorrect one gets to skip it — the
shortest spelling is the broken one. Wrap it: expose a verifier that takes
the claimed identity and a handle to the trust store, and demote the raw
key-parameter form to internal visibility. Then the envelope's key has no
parameter through which to reach the verification.

## Verification names WHO — as two facts, never one

The verdict of a signature check is two independent booleans: *the signature
is mathematically valid* and *the signer is someone this install trusts*.
Collapsing them into one `valid` flag destroys the vocabulary downstream — a
UI holding one boolean cannot say "real signature, stranger", so it says
"valid", which is the lie. Return both, let the caller's policy decide what
each combination means, and never let a display name travel from an untrusted
envelope to a rendered identity without the trust flag traveling beside it.
The display name in a signer block is decoration supplied by the signer;
until the signer is trusted, rendering it as an identity hands the attacker
the words next to your green check.

## First contact is a pairing ceremony

A signer absent from the trust store is not an error and not an attack — it
is the default state of the world. The honest response is "unknown signer,
unverifiable", *plus a next step*: an explicit, human-confirmed adoption flow
(compare the identity out-of-band, then insert the trust row), after which
re-verification succeeds against the stored key. Building verification
without the adoption path converts every real-world first artifact into a
permanent red with no exit — which teaches users that red is wallpaper. The
ceremony belongs to the person, not the artifact: adoption is never a side
effect of verifying, importing, or opening anything.

## Sidecar discovery is a convention, not a guess

Name sidecars derivably from the artifact — one suffix, appended to the full
artifact name — so tools can auto-locate them, offer them at verify time, and
badge artifacts that have one. Auto-discovery is a convenience on top of the
verification, never a substitute for it: a sidecar found beside a file is
exactly as untrusted as one pasted into a textbox.
