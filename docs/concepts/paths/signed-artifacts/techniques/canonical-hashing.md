---
layer: technique
subject: signed-artifacts
technique: canonical-hashing
status: forged
laws: [gate-sees-target, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Canonical hashing

A signature does not cover "the document" or "the manifest". It covers **a
byte sequence**, exactly one, and the first design decision of any signed
artifact is to declare which one — because "the same content" has many byte
spellings. A structure serialized pretty-printed and the same structure
serialized compact are different bytes. Two serializers that order keys
differently produce different bytes. Line-ending conventions, trailing
newlines, unicode normalization forms, a field added by a newer version and
ignored by an older parser — all of these preserve *meaning* and change
*bytes*, and a signature knows only bytes. A system that has not declared its
canonical form has two implementations of "the same content" waiting to
disagree, and the disagreement surfaces as the worst possible symptom:
**honest artifacts failing verification**, teaching everyone that red means
noise.

## The two sound strategies — and the trap between them

**Strategy A — sign exact bytes and preserve them.** The producer serializes
once, signs those bytes, and stores *those very bytes* in the artifact as a
distinct member. The verifier reads the member raw and verifies over it —
never over a parse-and-re-serialize round trip. This is the strongest form:
no canonicalization function to keep in sync, no dependence on serializer
stability, and unknown fields cannot silently vanish between signing and
verifying, because nothing between them ever re-encodes. Its one obligation
is discipline at the verifier: the raw bytes must stay available and the
verification must reach for them, not for the convenient parsed struct.

**Strategy B — one canonicalization authority.** Where the signed content
must be reconstructed rather than carried (a database row, a computed
manifest), define a single canonicalization — one function, one place — that
both producer and verifier call, and treat it as a closed vocabulary with one
authoritative definition. Every property that affects bytes (key order,
whitespace, encoding, escaping) is now part of your signature format,
versioned with it.

**The trap is the hybrid nobody chose:** sign one serialization on the way
out, verify a *re-serialization of the parsed structure* on the way back, and
hope the two agree. They agree exactly as long as both sides run the same
serializer version with the same field set — that is, during the demo. The
failure arrives from either direction: a formatting difference makes every
honest artifact fail; a schema difference makes verification pass over a
struct that silently dropped the fields it did not know, so the bytes checked
are not the bytes the artifact carries. Both directions have been paid for in
production — this subject's application layer holds the fix-comment receipts.
If you find yourself
verifying anything other than (a) preserved raw bytes or (b) the output of
the one named canonicalization function, stop
([gate-sees-target](../../_laws.md#gate-sees-target): the gate must observe
the artifact's actual bytes, not a proxy reconstruction of them).

## The hash names its own recomputation

A stored digest is a derived value, and a derived value names how it is
recomputed ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The cheapest honest form is a prefix inside the stored value itself —
`sha256:<hex>` — so that a reader holding only the value knows the algorithm,
and an algorithm migration becomes a visible format event instead of a silent
reinterpretation. A bare hex string is a number with no predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): future
code will guess what it digests and how, and guess wrong.

## Read once

Hashing and signing (or hashing and verifying) must operate on **one buffer
read once**. Two reads of the same path — one to hash, one to sign — open a
window in which an editor autosave, a build tool, or a file sync rewrites the
content between them, producing a record whose stored hash describes bytes
the signature was never taken over. The symptom, again, lands on the honest
user: "signature invalid" on a file nobody tampered with. The verifying side
has the mirror-image window: hash checked against one read, signature against
another, and a swap between them makes both checks pass against a file that
matches neither end-to-end. One read, one buffer, every derivation from it.

## Digest chains must reach the bytes you will use

Layered artifacts sign a small thing that *names* a big thing: the signature
covers a manifest; the manifest carries a digest of the payload; the payload
is what actually gets imported or executed. That chain is only as real as its
weakest recomputation. A signature over the manifest authenticates the
manifest; if nothing recomputes the payload digest against the actual payload
member, the payload is unsigned in practice while the artifact reads as
signed. Verification walks the whole chain: signature over the preserved
manifest bytes, then declared payload digest recomputed over the payload
bytes about to be used. Skipping the second half is the
marker-written-never-read failure wearing cryptographic clothes.

## Sign the statement, not just the content

A detached signature travels with claims: who signed, when, optional
metadata, the content digest itself. If the signature covers only the raw
content bytes, every one of those claims is attacker-mutable after the fact —
the timestamp can be rewritten, the metadata replaced, and the signature
still verifies. The robust form signs a canonical serialization of the **whole
statement minus the signature field**: content digest plus claims. Then
tampering with any displayed fact breaks the same seal that protects the
content. Content-only signatures are acceptable exactly when the envelope's
other fields are treated as unverified decoration by every consumer — which
is a promise about *all future consumers*, and therefore rarely one worth
making.
