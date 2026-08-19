---
layer: technique
subject: credential-vault
technique: token-refresh-lifecycle
status: forged
laws: [failure-not-empty-success, derivation-names-recomputation, creation-names-reaper, gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Token refresh lifecycle

Delegated-authorization systems split a credential into two artifacts with
opposite risk profiles: a **long-lived grant** (the refresh token — the real
secret, hard to replace, custody-critical) and a **short-lived proof** (the
access token — disposable working currency whose exposure is bounded by its
clock). The vault's job is to keep the proof continuously fresh *from* the
grant, unattended, across sleep, crashes, and concurrency — without ever
putting the grant at risk to do it. Every subsection below is a place where a
naive implementation works in the demo and fails in month three.

The cached proof is a derived value, and it names its recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
the refresh path *is* the recomputation, invokable on demand, which is why a
stale or lost proof is an inconvenience while a lost grant is an incident.

## Refresh ahead, never at the moment of need

Refreshing when a caller hits an expired proof adds the refresh round-trip to
that caller's latency, races every other caller doing the same, and converts
provider hiccups into user-visible failures. Instead:

- **Refresh at a threshold before expiry** — a fraction of the proof's
  lifetime (refresh when, say, the final quarter begins), with an absolute
  floor so very short lifetimes still get a real margin and an absolute
  ceiling so very long lifetimes don't wait days to discover a revoked grant.
- **Clock skew is real.** The expiry timestamp was minted on the provider's
  clock; treat it with a safety margin rather than trusting second-precision
  agreement between two machines.
- **Scheduled, not lazy-only.** A background cadence walks credentials
  approaching their threshold. Lazy refresh as the *only* trigger means the
  first request after a quiet period always eats the latency and the failure.
- **One threshold authority.** The scheduler that decides "refresh now" and
  the resolver that decides "actually exchange vs hand back the cached proof"
  must read the *same* freshness predicate
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
  applied to a boundary value). Two hand-written predicates over the same
  expiry disagree precisely inside the refresh-ahead band — producing the
  refresh that does not refresh: the cadence fires, the resolver declines,
  and both report success while the proof keeps aging toward the cliff.
- **Local expiry math is a prediction; the provider is the authority**
  ([gate-sees-target](../../_laws.md#gate-sees-target)). A proof the local
  clock calls fresh can be rejected right now — server-side revocation,
  rotation, skew. On an authoritative rejection of a locally-fresh proof,
  bypass the freshness short-circuit and force one real exchange before
  failing the caller; the rejection *is* the fresher fact.
- **Never fabricate provider facts.** When a provider omits the proof's
  lifetime, an assumed default may be used for scheduling — but it must be
  *labeled as assumed*, never written where downstream logic will read it as
  the provider's claim. A fabricated expiry poisons everything fed by it:
  staleness ceilings trip on synthetic timestamps, dashboards report a death
  date nobody issued, and the record can no longer distinguish "the provider
  said nothing" from "the provider was never asked".

## Resume is suspicion, not business as usual

An application that was suspended, hibernated, or simply closed for a week
wakes holding proofs that expired long ago and a queue of scheduled work eager
to run. The wrong behavior is letting that queue stampede into authenticated
calls that all fail and all trigger refresh simultaneously. On resume:
re-evaluate every credential's freshness *first*, refresh what needs it, then
release the work. Staleness after offline periods is a lifecycle state to
handle deliberately, not an edge case to discover in support tickets.

Two refinements make the resume sweep honest. **A wider threshold than the
steady-state cadence** — the sweep exists to catch what expired while nobody
was watching, so it refreshes anything expired or imminent, not just the
usual refresh-ahead band. And **a staleness ceiling**: a grant untouched for
weeks is refreshed *once, deliberately*, or routed to re-acquisition — but
there is a bound beyond which automatic refresh stops, because hammering a
long-dead grant looks like an attack to the provider and hides the real state
("this needs a human") behind an endless retry loop. The ceiling compares
against *provider-issued* timestamps only — see the fabrication rule above;
a ceiling tripped by a locally-invented expiry silently abandons a healthy
credential.

## Refresh storms and single-flight

When one credential serves many consumers, the moment its proof crosses the
threshold every consumer notices at once. Uncoordinated, they issue N
concurrent refreshes; with providers that rotate grants (below), N−1 of those
responses invalidate each other and the vault can end holding a dead grant.

- **Single-flight per credential**: one refresh in flight; concurrent askers
  wait on its result rather than launching their own. And the classic
  double-checked discipline applies: after *acquiring* the lock, re-read the
  stored credential before exchanging — the refresh you were queued behind
  may already have done the work, and exchanging again with the pre-lock
  snapshot re-creates the exact race the lock exists to prevent.
- **The lock matches the sharing scope.** If two processes share the stored
  credential, an in-process mutex is theater — the lock must live where both
  processes can see it (the shared store itself, or an OS-level primitive).
- **The lock names its reaper**
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)): a holder
  that crashes mid-refresh must not wedge the credential forever. Locks carry
  a TTL or heartbeat, and the expiry path is tested, because it will run.

## Rotating grants: persist before use

Some providers rotate the grant itself on every refresh — the response carries
a *new* refresh token and the old one dies (immediately, or on first use of
the new one). This makes the refresh response briefly the **only copy of the
credential in existence**, and the ordering rule absolute:

> **Persist the new grant before acting on the new proof.**

A crash between receiving and persisting loses the credential permanently —
recoverable only by human re-acquisition. Write-ahead ordering, in the same
durability domain as the rest of the vault. And when the provider tolerates a
grace window for the old grant, do not design against the grace window; design
against the strict rotation, and the grace window becomes margin instead of
load-bearing behavior.

## Classify refresh failure honestly

The refresh endpoint's failures divide into kinds that demand opposite
responses, and misclassification in either direction is expensive
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) — a
refresh that could not run must be spelled differently from a refresh the
provider rejected):

| Kind | Examples | Correct response |
| --- | --- | --- |
| **Definitive rejection** | grant revoked, grant expired, consent withdrawn, client deregistered | Mark the credential dead, stop the cadence, route the human to re-acquisition. Retrying is pointless and looks like an attack. |
| **Transient failure** | network unreachable, timeout, provider 5xx, rate limit | Retry with backoff and jitter. The grant is presumed alive; marking it dead forces a needless human re-acquisition. |
| **Ambiguous** | malformed response, unexpected status | Neither retry blindly nor kill; surface for diagnosis with the raw evidence preserved (sans secrets). |

The failure taxonomy deserves the same care as the happy path: retry-forever
on a definitive rejection hammers the provider (and can escalate to account
lockout), while kill-on-first-blip converts every tunnel and every provider
deploy into a re-onboarding ceremony. Repeated *transient* failures feed the
degradation ladder in
[rotation-and-remediation](rotation-and-remediation.md); one definitive
rejection is already conclusive.

## What the consumer sees

None of this machinery leaks to consumers. A consumer asks for an
authenticated action (or, at most, a currently-valid proof through the
brokered door) and receives one that is fresh *enough*; whether it was cached,
refreshed just now, or waited behind another caller's refresh is the vault's
private business. The one consumer-visible state is the honest one: "this
credential is dead and a human must re-acquire it" — which must surface
promptly and exactly once, not as a thousand downstream request failures.
