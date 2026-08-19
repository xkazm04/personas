---
layer: technique
subject: device-pairing
technique: token-binding-and-transport
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Token binding & transport

The ceremony's product is a credential, and this technique governs its two
most dangerous moments: **birth** (what constraints it carries from the
first instant) and **transit** (how the plaintext reaches its holder without
leaving copies). The organizing rule: after the ceremony ends, the plaintext
exists in exactly one place — the holder — and the granting side holds only
what it needs to *verify*, never to *reproduce*.

## Born bound: constraints attach at mint, not at use

A credential minted by a pairing is never a bare bearer secret. At the
moment of creation it already carries:

- **An identity binding.** The credential is tied to the approved origin or
  device — recorded with the grant, and checked on every presentation by
  the verifying layer. A bound credential presented from anywhere else
  fails even in the hands of a thief. Binding recorded at mint is what
  makes the later per-request check possible at all; a credential minted
  loose can never be tightened, because every copy already made is loose.
- **The narrowed scopes.** What the human left checked, not what was
  requested. The grant is the input the authorization layer will intersect
  forever after; minting broad "to be safe" defeats the narrowing the
  ceremony surface offered.
- **An expiry.** Chosen at approval, stamped by the *granting* side's
  clock — never computed from a lifetime the requester supplied, because
  the requester's clock and honesty are both unverified
  ([creation-names-reaper](../../_laws.md#creation-names-reaper): the
  credential names its end at birth).

Bindings compose as defense in depth: an origin-bound credential delivered
only to the approved origin through an origin-checked claim is protected
twice — interception without the origin yields a useless artifact, and
presentation without the origin yields a refusal.

## Identifier and key material are different substances

Two rules keep them apart, and both are unfixable retroactively:

- **Derive the public identifier from the credential, never the credential
  from the identifier.** When a peer's identifier is a one-way fingerprint
  of its key or token, a registry lookup by identifier *is* a credential
  check — the cheap check becomes the strong check for free, and the
  identifier can be logged, displayed, and exported safely. When the
  identifier is claimed by the peer, every registry read is another place
  the binding can be forgotten.
- **A value that seeds key material must never double as an identifier.**
  The moment one string is both "how devices recognize each other" and
  "what their shared key derives from", every surface that legitimately
  displays, transports, or exports the identifier becomes a key-disclosure
  channel — built by someone who read the identifier's docstring, not the
  key's. Separate them at birth: derive keys from the secret, and a public
  identifier from the key.

## Fingerprint-only storage on the granting side

The granting side stores a **one-way fingerprint** of the credential — a
cryptographic hash — sufficient to verify a presentation, insufficient to
reconstruct the plaintext. The consequences are the point:

- a read of the trust registry (backup, sync, debug dump, another local
  process with database access) yields no usable credential;
- "show me the token again" is structurally impossible — the honest answer
  is a re-pairing, which is the correct answer;
- the persisted rows can flow to status surfaces and lists without
  redaction logic, because there is nothing to redact.

Write the invariant as a test: serialize the registry and assert the
plaintext does not appear in it. That one assertion outlives every refactor
of the storage layer. The plaintext's brief life on the granting side —
minted, stashed for the claim, handed over once — should be measured in
seconds, and the stash cleared or claim-marked at delivery
([identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
claim is keyed by the ceremony's nonce, so retries and reordering hit the
same record and cannot mint twice).

## The channel-leakage ranking

Channels differ in where they leave copies, and the ranking decides which
are permissible for a secret:

| channel | where copies land | verdict |
|---|---|---|
| deep-link / URL **query string** | operating-system logs, shell history, launcher telemetry, referrer headers | **never** — this is the named doctrine: the deep link may carry the *nonce* and the request metadata, never the credential |
| HTTP **request line / headers** toward a logging intermediary | server logs, proxies | avoid for plaintext delivery; acceptable for *presentation* over an encrypted, non-logging hop |
| URL **fragment** | stays in the client; never sent in request lines, never in server logs | acceptable for local hand-off (a scanned code encoding a fragment URL) |
| **one-shot authenticated claim** | nowhere — delivered once, to the verified identity, then gone | the standard |

The claim channel is the strongest and is the default: after approval, the
requester polls a claim endpoint keyed by its nonce; the response carries
the plaintext exactly once, only when the claimant's channel-stamped
identity matches the approved identity; a second claim returns a
distinguishable "already claimed" — which doubles as a **theft alarm**,
because the legitimate holder knows whether it already claimed. Pending
and rejected are likewise distinct poll answers, so the requester's state
machine never confuses "wait" with "no".

A visual hand-off (a scanned code) is a fragment-class channel: the code
encodes the address plus the credential in fragment position, the image is
rendered locally and never persisted, and the encoding is modules on a
screen — the plaintext must not additionally appear as selectable text
beside it "for convenience", which silently re-opens the clipboard and
screenshot channels the fragment choice closed.

## Show-once display, and what the UI owes the secret

When a human must transport the credential (read it, scan it, paste it),
the display is **show-once**: rendered at mint, marked as unrecoverable in
the copy ("you will not see this again"), and absent from every later
listing. Status surfaces show name, creation time, last-seen time, expiry,
scopes — never the credential, and ideally not even the fingerprint, which
is useless to the operator and one more string that looks secret in a
screenshot.
