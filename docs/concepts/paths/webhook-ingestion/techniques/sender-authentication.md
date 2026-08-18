---
layer: technique
subject: webhook-ingestion
technique: sender-authentication
status: forged
laws: [gate-sees-target, failure-not-empty-success, one-validation-door]
shared_with: []
---

# Sender authentication

An inbound delivery arrives with no session, no logged-in principal, and no
interactive credential exchange — the only proof of origin it can carry is
cryptographic. The dominant convention, and the one worth standardizing on:
the sender computes a **keyed digest (HMAC) of the exact request body** using
a secret shared when the subscription was configured, and transmits the
digest in a header. The receiver recomputes and compares. Everything in this
technique is the discipline around those two sentences, because every part of
them has a well-known way to go wrong.

## Verify the bytes, not a reconstruction

The digest must be computed over the **raw bytes as received** — before any
parsing, decoding, normalization, or re-serialization. The failure pattern is
seductive: parse the body first (to find the subscription identifier, say),
then verify a digest computed over the re-serialized object. Serializers do
not round-trip byte-identically — key order, whitespace, numeric formatting,
escape choices all drift — so this either rejects legitimate deliveries
intermittently, or, worse, tempts someone into "normalize both sides," at
which point the gate no longer observes the thing it gates
([gate-sees-target](../../_laws.md#gate-sees-target)). If routing metadata is
needed before verification, it comes from the URL path or headers — parts of
the request that identify *which secret to use*, never parts that are
believed before the digest passes.

## Constant-time comparison

The digest comparison uses a constant-time equality primitive, never ordinary
string or byte equality. Short-circuiting comparison leaks, through response
timing, how many leading bytes of the attacker's guess were correct — which
converts a 2^256 search into a byte-at-a-time one. This is a one-line
decision that cannot be retrofitted by review later, because the two
spellings look identical in every test you will ever write; it is cheapest to
adopt the constant-time primitive as the *only* way secrets and digests are
ever compared, everywhere, and let the convention carry the sites nobody
audits.

## Fail closed: unverifiable means rejected

Enumerate the degenerate states, because each one arrives eventually:

- **No secret configured** for the subscription the delivery claims — reject.
  The alternative ("accept unsigned while unconfigured") means a skipped
  setup step silently disables authentication with zero behavioral signal
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
  traffic flows, everything looks healthy, and the control is gone.
- **Signature header absent** — reject. Absent is not "legacy mode".
- **Unrecognized scheme or version** prefix on the signature — reject, and
  count it distinctly; a sudden spike means the sender upgraded their scheme
  and you are about to drop everything they send.
- **Secret present but unreadable** (storage error, decryption failure) —
  reject *and alarm*; this is an operational failure wearing an
  authentication failure's clothes, and the two must be distinguishable in
  the record.

The rejection response to an unauthenticated caller is deliberately bland — a
status code, no diagnostic detail. Telling an attacker *why* the signature
failed is free oracle service. The detail goes in the delivery record, where
the operator reads it.

## Timestamp windows against replay

A valid signature proves the bytes were produced by someone holding the
secret — it does not prove *when*. An adversary who captures one legitimate
delivery can re-transmit it forever, signature intact. The countermeasure:
the sender includes a timestamp in the signed material, and the receiver
rejects deliveries whose timestamp falls outside a bounded window (minutes,
not hours). The window's size is a real trade-off — too tight and legitimate
senders with clock skew or retry backlogs get rejected; too loose and the
replay budget grows — and it must tolerate the sender's *own* documented
retry horizon, since a legitimate retry carries the original timestamp in
some conventions and a fresh one in others. Know which convention each
sender follows before tuning the window.

What the window does not do: protect against duplicates from the sender's own
retry machinery. That is a different problem with a different key (see the
duplicate-and-replay-dedup technique).

## Secrets: storage, rotation, plurality

The shared secret is a credential and lives where credentials live — in the
encrypted store with an owner and an audit trail
([credential-vault](../../credential-vault/credential-vault.md)) — never
inline in subscription rows, never in logs, never echoed back through any
management surface after initial capture.

Rotation must be possible without a coordinated cutover, which means the
verifier accepts **a small set of active secrets per source** (current and
previous) for a bounded overlap period: verify against each until one
matches, constant-time per attempt. Single-secret verifiers make rotation an
outage, and secrets that cannot be rotated without an outage do not get
rotated.

## One verifier, all mouths

However many ingress paths exist — direct listener, relay bridge, replayed
record — signature verification is **one function, called from one admission
path** ([one-validation-door](../../_laws.md#one-validation-door)). The
relay case is where this discipline earns its keep: a reachable intermediary
that forwards deliveries must forward them *byte-intact with headers
preserved*, and verification happens at the final hop, against the receiver's
own copy of the secret. An intermediary that "already verified" is an
intermediary you have promoted to holding your secrets and being in your
trust boundary — usually neither was intended.
