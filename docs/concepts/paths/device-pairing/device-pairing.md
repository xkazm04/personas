---
layer: golden-path
subject: device-pairing
status: forged
techniques:
  - pairing-ceremony
  - token-binding-and-transport
  - admission-scoping
  - timing-defenses
  - verb-allowlists
  - revocation-and-expiry
evidence:
  - src-tauri/engine/src/pairing.rs                                      # cloud-origin ceremony: nonce-keyed pending store, approval-only mint, origin-checked single-use claim
  - src-tauri/src/commands/fleet/pairing.rs                              # device ceremony: fingerprint-only storage, constant-time verify, device cap, revocation
  - src-tauri/src/commands/fleet/companion_api.rs                        # admission scoping (LAN peer classes), fixed-delay 401, closed five-verb act grammar, per-act audit
  - src-tauri/src/commands/credentials/external_api_keys.rs              # the mint gate itself: approve_pairing mints origin-bound scoped expiring key, warms CORS allowlist
  - src/features/settings/sub_api_keys/components/PairApprovalModal.tsx  # the human gate: arm-delayed approve, scope narrowing, insecure-origin warning
counter_evidence:
  - src-tauri/src/commands/network/owned_devices.rs                      # a second writer into a trust registry that skips the ceremony — rows the reader cannot tell from ceremony rows
deviations:
  - w11-device-pairing   # anchor in docs/concepts/golden-path-deferred-fixes.md   # registered upward in the forge report; wave anchor in docs/concepts/golden-path-deferred-fixes.md to be minted by the wave lead
---

# Device pairing & trust

Device pairing is the ceremony by which an outside origin or device — a web
application on another host, a phone on the same network, a peer machine —
becomes trusted enough to drive the local application. It is the one moment
in a system's life where the trust boundary is **deliberately opened**: a
principal that yesterday could not even get a socket accepted is handed a
credential that tomorrow will authenticate thousands of requests. Everything
downstream of that moment is enforcement of a decision made here.
[Authorization](../authorization/authorization.md) owns the ongoing
enforcement — the per-call "may this caller do this" — and the
[credential vault](../credential-vault/credential-vault.md) owns the custody
of stored secrets; this subject owns the *establishment* of trust: how a
stranger asks, who says yes, what artifact the yes produces, how that
artifact travels, and how the yes is later withdrawn. Where the peer lives on
the wire — discovery, transport, session encryption — belongs to
p2p-networking, which is a different subject: it carries bytes between
machines; this subject decides when a machine becomes *yours*.

The framing that organizes everything below: **a pairing ceremony produces a
fact, and every later trust decision is a re-derivation of that fact.** The
ceremony proves something expensive — a human's eyes on a request, an
operator's click, possession of a key. What survives into the trust registry
is usually just a row. Every subsequent check reads the row, not the
ceremony; so the system's real authentication strength is the strength of
whatever can *write* a row. A registry with two writers of different
strength, and one reader that cannot tell their rows apart, authenticates at
the strength of its weakest writer — not as a bug in the reader, but because
the reader is asking the only question the schema lets it ask. Count the
writers before you trust the reader; if any writer skips the ceremony,
delete it or make its rows a visibly different type.

## The human approval is the only mint gate

A pairing request — arriving by deep link, by an unauthenticated local
endpoint, by a scanned code — creates exactly one thing: a **pending
record**, keyed by a requester-supplied nonce with an entropy floor,
carrying the requester's claimed identity, its *requested* capabilities, and
a short time-to-live. Nothing about the request is trusted; the pending
record is a question, not a grant. It becomes a credential through exactly
one door: **a person approves it in the application's own chrome**, on a
surface the requester cannot draw, cannot pre-fill, and cannot click. This
is [one-validation-door](../_laws.md#one-validation-door) applied to trust
itself: multiple entry doors may *register* the question (and should
converge on one pending store, so a duplicate submission cannot reset an
already-resolved answer), but only one door mints — and that door has a
human behind it.

Two properties make the gate real rather than ceremonial. First, the
approval surface must let the person **narrow the request** — deselect
capabilities, shorten the lifetime — because "approve exactly what was
asked" trains people to rubber-stamp maximal requests. Second, the approving
control must be **harder to trigger than the declining one**: an arm delay
before the approve affordance accepts input, a visible warning when the
requesting origin is not on a secure transport. The most common inversion in
the wild is guarding the *destructive* action (unpair, revoke) behind
confirmation while the *trust-granting* action is a bare primary button —
exactly backwards, because an accidental revocation costs a re-pairing and
an accidental approval costs the machine. The full ceremony shape — pending
stores, nonce discipline, resolution states, and what may never be disclosed
before the human says yes — is the
[pairing-ceremony](techniques/pairing-ceremony.md) technique; the approval
surface itself is a consent gate in the sense of
[hitl-approval](../hitl-approval/hitl-approval.md), specialized to the
highest-stakes decision an application ever asks its operator to make.

## Tokens are born bound

The artifact the ceremony mints is never a bare bearer secret. It is born
with its constraints already attached: **bound** to the identity that was
approved (an origin, a device), so it is useless presented from anywhere
else; **scoped** to the capabilities the human left checked; **expiring**,
with a lifetime chosen at approval time; and delivered through a
**single-use claim** — the requester retrieves the plaintext exactly once,
through a channel that verifies the claimant is the approved identity, and a
second retrieval is a distinguishable, loggable event rather than a quiet
success.

Transport is half the design. Channels differ enormously in where they leave
copies: a token in a deep-link query string lands in operating-system logs
and shell histories; a token in a request line lands in server logs and
proxies; a token in a URL fragment never leaves the client; a token handed
back once, over a claim the approved identity must authenticate to, leaves
no copy at all. The rule is that **the plaintext exists in exactly one place
after the ceremony ends — the holder** — and the granting side keeps only a
one-way fingerprint sufficient to verify presentation. The binding
mechanics, the fingerprint-only storage rule, and the channel-leakage
ranking are the
[token-binding-and-transport](techniques/token-binding-and-transport.md)
technique. Where minted credentials *rest* long-term — encrypted stores,
key-rings — is the [credential vault](../credential-vault/credential-vault.md)'s
subject; this subject ends when the artifact is safely in the holder's hands
and its fingerprint safely in the registry.

## Admission is scoped before authentication runs

Every pairing system has an unavoidable pre-trust surface: the endpoint
where strangers ask to be paired, and the endpoint where not-yet-verified
holders present tokens. The discipline is to make that surface **small by
construction, before any authentication code runs**. Three structural moves
do most of the work: classify the peer *address* first and refuse whole
classes (only the local machine; only private-network ranges) with zero
secret-bearing computation spent on the refusal; keep the pre-trust listener
**off until trust exists** — a pairing-capable server that runs
unconditionally is attack surface on every machine that never pairs, while
one started by the first approval and re-started only when live pairings
exist is surface only where it earns its keep; and derive every allowlist
the admission layer consults — permitted origins, known devices — **from
persisted trust state at startup**, so that a restart neither forgets an
approval nor resurrects a revoked one. An allowlist warmed from the
registry is [gate-sees-target](../_laws.md#gate-sees-target) at the
admission layer: the gate reads the durable record of who was approved, not
an in-memory shadow that drifts from it. The peer-class taxonomy, the
listener-lifecycle rule, and the warm-from-persistence pattern are the
[admission-scoping](techniques/admission-scoping.md) technique.

## Refusals leak nothing

The pre-trust surface is, by definition, exercised by parties who have not
proven anything — including attackers enumerating it. Every refusal it emits
is therefore a measurement an adversary took, and the design goal is that
the measurement carries no information beyond "no". Two channels leak in
practice. **Timing**: an early-exit comparison of a presented credential
against a stored one leaks, through response latency, how many leading bytes
matched — converting an unguessable secret into a guessable-per-byte one for
any caller that can measure round trips. Compare fingerprints in constant
time, always over the full length. **Shape**: refusals that differ by cause
("no such pending request" vs "wrong origin" vs "already claimed") tell the
prober which guesses were *almost* right; and failed authentication that
returns instantly invites brute force at network speed. A fixed artificial
delay on the failure path makes online guessing glacial without maintaining
lockout state, and a uniform refusal shape keeps the distinctions in the
audit log — where the defender needs them — rather than in the response,
where the attacker reads them. The constant-time discipline, the fixed-delay
budget, and what may vary between refusal causes are the
[timing-defenses](techniques/timing-defenses.md) technique.

## Capability is granted per verb, not wholesale

What a paired principal may *do* must be a written allowlist of verbs, never
"whatever the local user could do, arriving over a different keyboard". That
sentence is true about intent and false about blast radius: the remote
keyboard is attached to a device that can be lost, and the population that
can reach it is a network, not a person. The strong form makes the
allowlist **structural**: the remote surface accepts a closed grammar in
which only the permitted verbs *parse*, so an un-permitted action is a
deserialization failure, not a policy decision someone had to remember to
code ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
— the verb set is a closed vocabulary with one definition, and the parser is
its enforcement). Reads are a **projection**: a purpose-built view carrying
labels and states, never transcripts, paths, or credentials. Writes act only
on what the projection showed — a remote approval must reference an item the
principal could legitimately see, checked at execution time, so a remote
holder can never aim at an object outside its own window. And free-text
inputs from the remote side are sanitized as hostile at the door. The
grammar-closure trick, the projection discipline, and the trap of *borrowed*
controls — safety arguments that lean on a constraint another subsystem
enforces, which rot silently when that subsystem changes — are the
[verb-allowlists](techniques/verb-allowlists.md) technique. Note the
division of labor: this subject fixes *what verbs exist for a paired
principal*; [authorization](../authorization/authorization.md) owns the
general mapping from any caller to any permitted action, and the two meet
where a pairing's scopes are handed to the authorization kernel as the
grant it intersects.

## Trust is revocable and expiring

Every grant this subject mints names its end
([creation-names-reaper](../_laws.md#creation-names-reaper), applied to
trust): pending requests expire in minutes; minted credentials carry an
expiry chosen at approval; devices are capped in number so the trust surface
stays enumerable by a human; and every grant has a revocation affordance
next to where it is displayed. Revocation semantics must be stated
honestly, in two tiers. **Reaching the door** — the revoked credential fails
its next authentication — is the floor, and it is only real if the verifier
re-reads the trust registry per request rather than caching admission
decisions; a trust cache with a time-to-live is a revocation delay of
exactly that length. **Reaching the work** — closing the revoked peer's open
connections, cancelling its running tasks — is the actual requirement,
because the moment an operator reaches for revocation is precisely the
moment something is already running. A revocation that only a future request
will notice is a policy change, not a control. Expiry ladders, per-request
re-verification, revocation-to-in-flight-work, and the re-pairing ceremony
(re-run the full ceremony; never a "refresh" that inherits old trust with
new lifetime) are the
[revocation-and-expiry](techniques/revocation-and-expiry.md) technique.
Every pairing decision — grant, refusal, revocation, and each remote act
performed under a pairing — lands in a per-decision ledger; the ledger
design itself is [audit-logging](../audit-logging/audit-logging.md)'s
subject, but this subject supplies its most consequential rows, and the
ledger is also how you learn a trust gate has never refused anything —
the only evidence that a gate is a control rather than an unexercised
branch.

## What is *not* this subject

- **Ongoing enforcement** — per-call permission checks against scopes and
  tiers are [authorization](../authorization/authorization.md); pairing
  produces the grant that enforcement later reads.
- **Secret custody** — encrypted storage, key-rings, and brokered use of
  long-lived secrets are the
  [credential vault](../credential-vault/credential-vault.md); pairing mints
  and delivers, then hands off.
- **Transport and discovery** — finding peers, session encryption, connection
  lifecycle are p2p-networking (forging concurrently); pairing decides
  *whether* a discovered peer is trusted, not how its bytes travel.
- **Inbound message authentication at scale** — verifying signed deliveries
  from an already-integrated service is
  [webhook-ingestion](../webhook-ingestion/webhook-ingestion.md); pairing is
  the one-time ceremony, not the per-message check.
- **Human review of individual actions** — approval queues and consent gates
  in general are [hitl-approval](../hitl-approval/hitl-approval.md); this
  subject applies that machinery to one decision, the admission of a
  principal.

## The techniques

- [pairing-ceremony](techniques/pairing-ceremony.md) — the nonce-keyed
  pending store, the human-only mint gate, scope narrowing at approval, and
  the disclosure-ordering rule.
- [token-binding-and-transport](techniques/token-binding-and-transport.md) —
  origin/device binding, single-use claims, fingerprint-only storage, and
  the channel-leakage ranking that bans secrets from query strings.
- [admission-scoping](techniques/admission-scoping.md) — peer-class gates
  before authentication, listeners that exist only when trust exists, and
  allowlists warmed from persisted state.
- [timing-defenses](techniques/timing-defenses.md) — constant-time
  comparison, fixed-delay failures, and uniform refusal shapes on the
  pre-trust surface.
- [verb-allowlists](techniques/verb-allowlists.md) — closed action grammars,
  projection-only reads, act-on-what-you-saw, and the borrowed-control trap.
- [revocation-and-expiry](techniques/revocation-and-expiry.md) — expiry at
  every layer, revocation that reaches in-flight work, device caps, and
  re-pairing over rescue.
