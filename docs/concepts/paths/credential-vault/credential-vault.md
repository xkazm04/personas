---
layer: golden-path
subject: credential-vault
status: forged
techniques:
  - encryption-at-rest
  - token-refresh-lifecycle
  - rotation-and-remediation
  - brokered-egress
  - acquisition
  - health-probing
evidence:
  - src-tauri/src/engine/credential_broker.rs      # the cardinal rule as code: intent in, outcome out, plaintext never
  - src-tauri/core/src/crypto.rs                   # sealing, key custody ladder, zeroization, instrumented legacy-path retirement
  - src-tauri/src/engine/oauth_refresh.rs          # the maintenance loop: refresh-ahead, startup staleness sweep, honest failure classes
  - src-tauri/src/engine/healthcheck.rs            # three-state probe honesty (verified / failed / unverifiable)
counter_evidence:
  - src-tauri/src/mcp_server/install.rs            # a never-expiring token written into a config file with no named reaper — vault discipline absent one step outside the vault
deviations:
  - w1-credential-vault   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Credential vault

A credential vault is the subsystem that holds **other people's secrets** —
credentials issued by external authorities, granting powers the application
does not own and cannot re-mint. An API key, a delegated-authorization grant, a
service password: each is a live capability against someone else's system, on
loan. That framing decides everything. The vault's job is not storage; storage
is the trivial third of it. The job is **custody**: keeping the value sealed,
mediating every use, walking each credential through its lifecycle, and telling
the truth about its state. A vault that stores perfectly but hands plaintext to
anyone who asks is a well-encrypted leak.

What is *not* this subject: configuration that merely shouldn't be public
(feature flags, endpoints), secrets the application itself mints and owns (its
own signing keys — related discipline, different lifecycle, because the owner
can revoke and re-mint at will), and pass-through values the user supplies per
request and the system never retains. The vault exists precisely where the
application must **retain** a foreign secret across sessions and use it
unattended.

## The lifecycle is the spine

Every credential is always at exactly one point on one path:

> **acquire → store → use → refresh/rotate → retire**

and every design question about a vault locates on that spine. Acquisition is
how a working credential enters custody without leaking on the way in. Storage
is sealing it against the disk. Use is applying it without surrendering it.
Refresh and rotation are the maintenance loop that keeps it alive and bounds
the damage of exposure. Retirement is the funeral: revoke upstream where the
protocol allows, destroy locally always. A vault design that cannot answer
"what state is this credential in, and what transition happens next" for every
record it holds has secrets, but not custody of them.

The spine also names the classic omission: teams build store and use, bolt on
acquire, and discover refresh, rotation, and retirement in production — one at
a time, each as an incident. The last three stages are not extensions; they are
the majority of the subject.

## The cardinal rule: secrets are used where they are stored

The single most consequential decision in a vault is what crosses its boundary.
The principal-engineer answer: **actions cross the boundary; values do not.**
A caller that needs an authenticated request made says "make this call with
credential X" — it does not receive X and make the call itself. The vault
brokers.

The reasoning is blast-radius arithmetic. Every boundary a plaintext secret
crosses — into another module's memory, another process, a message payload, a
return value — extends the vault's attack surface into territory that has none
of the vault's discipline: no zeroization, no redaction, no audit. Handing out
plaintext converts every consumer into a vault, involuntarily and without the
training. Keeping use adjacent to storage means there is one place where
plaintext exists, one place to harden, one place to audit, and one door to
watch. The full treatment — intent contracts, destination binding, scope
intersection, derived short-lived handles for callers that genuinely must hold
something — is the [brokered-egress](techniques/brokered-egress.md) technique.

The corollary reaches the small surfaces too: the value never appears in logs,
error messages, serialized state, diagnostic dumps, or the UI. Confirmation is
by identity, never by value — "authenticated as X with scopes Y", not the key
with middle characters starred out. Every partial echo is a partial leak and
trains users to expect secrets on screens.

## Two-part record: public metadata, sealed value

Structurally, a credential record splits in two:

- **Metadata** — name, target service, scopes, provenance, timestamps, health
  status, expiry. Plain, queryable, renderable. Everything a list view, an
  audit trail, a scheduler, or a health dashboard needs lives here.
- **The value** — sealed under the vault's encryption, touched only by the
  seal/unseal door, decrypted only at the moment of use.

This split is what makes "never log the secret" enforceable rather than
aspirational: surfaces that operate on metadata *cannot* leak the value,
because they never hold it. When the split is absent — one blob, decrypted to
render a list — every screen and every log line is one refactor away from
disclosure. Design the split into the data contract on day one; it does not
retrofit cleanly.

## Blast radius is a design input

Assume partial compromise and design for containment, not for the fiction of
an impenetrable perimeter:

- **Layered keys.** Each secret sealed under its own data key, data keys
  sealed under a master key held elsewhere — so disk theft yields ciphertext,
  and a single decryption does not open the whole store. Key custody options
  and their trade-offs are the
  [encryption-at-rest](techniques/encryption-at-rest.md) technique.
- **Least privilege at grant time.** Acquire the narrowest scopes the feature
  needs, not the broadest the provider offers. The cost of a stolen credential
  is its scope; scope requested is scope at risk.
- **Short-lived proofs over long-lived grants.** Where the protocol offers a
  renewable short-lived token, the long-lived grant is the crown jewel and the
  short-lived proof is the working currency; exposure of the proof is bounded
  by its clock. This asymmetry drives the
  [token-refresh-lifecycle](techniques/token-refresh-lifecycle.md) technique.
- **Rotation as hygiene, not as incident response only.** A credential that
  has never rotated has an unbounded exposure window behind it. Policy-driven
  replacement is the [rotation-and-remediation](techniques/rotation-and-remediation.md)
  technique.
- **Memory hygiene.** Plaintext lifetime in memory is minimized and ends in
  explicit wiping, not garbage collection eventually.

## Honesty of state

A vault reports on credentials it cannot control, issued by services it does
not operate, over networks that fail. Its status reporting is therefore an
epistemics problem, and the cardinal distinction is:

> **"could not verify" is not "broken."**

A probe that failed to run — offline machine, provider outage, rate limit —
must produce a different status than a probe the provider answered with a
rejection. Collapse the two and the vault becomes a liar in one direction or
the other: a laptop that goes through a tunnel marks every credential red
(operator learns to ignore red — the one color they must never ignore), or
failures hide inside "unknown" and a dead credential takes an unattended
automation down at 3 a.m. with a green dashboard behind it. Distinguishing
verified-good, verified-bad, and could-not-verify — plus the staleness of each
— is the [health-probing](techniques/health-probing.md) technique; reacting to
verified degradation proportionally, on a ladder instead of a kill switch, is
part of [rotation-and-remediation](techniques/rotation-and-remediation.md).

The same honesty governs expiry: *expires-soon* computed locally from a
timestamp, *rejected-now* observed from the provider, and *revoked upstream*
discovered on refresh are three different facts with three different next
actions. A vault that renders them as one "invalid" badge forces the human to
re-diagnose what the system already knew.

## Every use is attributable; no use is quotable

The audit trail records **who used which credential for what, against which
destination, when, and with what outcome** — and never records the value. The
two halves are one design: because use is brokered through a single door,
complete audit is a property of the architecture rather than a convention each
call site remembers. Scattered direct use makes the audit trail exactly as
complete as the most forgetful call site.

Attribution must survive delegation. When an automation acts with a credential
on a schedule, the trail names the automation *and* the human grant that
authorized it — "the system did it" is not an attribution.

One tension is resolved deliberately, not by accident: **use must not block on
audit** (an audit-store hiccup must not take every automation down), but an
unaudited use is a silent integrity gap. The reconciliation is a visible
counter — audit-write failures are counted and surfaced on the vault's own
health surface, so availability is preserved *and* the gap in the trail is a
number someone can see, not a hole nobody knows about.

## Retirement is part of the contract

Every credential's end is designed at its beginning
([creation-names-reaper](../_laws.md#creation-names-reaper) applied to
secrets):

- **Revoke upstream where the protocol allows.** Local deletion of a live
  credential does not kill the capability; it kills your copy of it. The
  capability lives at the provider until revoked there.
- **Destroy locally always** — the sealed value, cached plaintext, derived
  handles minted from it, and any working copies. What legitimately survives
  is the metadata skeleton for audit continuity: that a credential existed,
  was used, was retired, and when.
- **Retire the failed acquisition too.** Half-acquired credentials — captured
  but never validated, granted but never persisted — are the orphans nobody
  reaps; the acquisition flow names their cleanup as explicitly as the happy
  path.

## The techniques

- [encryption-at-rest](techniques/encryption-at-rest.md) — sealing values
  against the disk: envelope layering, key custody choices, one seal/unseal
  door, memory zeroization, and how to deprecate a weak sealing path with
  instrumentation instead of hope.
- [token-refresh-lifecycle](techniques/token-refresh-lifecycle.md) — keeping
  renewable credentials alive: refresh-ahead thresholds, offline staleness,
  refresh storms and cross-process single-flight, one-time-use grant rotation,
  and classifying refresh failure honestly.
- [rotation-and-remediation](techniques/rotation-and-remediation.md) —
  planned replacement with overlap windows, and the graduated response ladder
  for observed degradation: observe → warn → degrade → suspend, with a way
  back down.
- [brokered-egress](techniques/brokered-egress.md) — the cardinal rule
  realized: one audited outbound door that applies credentials on behalf of
  callers, destination binding, scope intersection, derived short-lived
  handles.
- [acquisition](techniques/acquisition.md) — getting from "the user has an
  account" to "the vault holds a working credential" without hand-copying:
  grant flows, tool capture, foraging, guided manual entry, and
  validation-before-admission.
- [health-probing](techniques/health-probing.md) — three-state truth about
  credentials you don't control: probe design, staleness, layered result
  storage, and status vocabulary with one authority.
