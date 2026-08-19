---
layer: technique
subject: credential-vault
technique: brokered-egress
status: forged
laws: [one-validation-door, gate-sees-target, creation-names-reaper]
shared_with: []
---

# Brokered egress

The golden path's cardinal rule — secrets are used where they are stored —
becomes architecture here: **one outbound door** through which every
credentialed call to the outside world passes. Callers submit *intent*; the
broker resolves the credential, applies it at the last possible moment,
forwards the call, scrubs the response, and writes the audit line. The
credential's plaintext exists only inside the door.

This is [one-validation-door](../../_laws.md#one-validation-door) applied to
egress: with one door, the security properties below hold *by construction*
and the writers are enumerable. With N call sites each fetching a value and
attaching it themselves, every property degrades to a convention, and
conventions hold until the next contributor.

## The caller's contract: intent, not value

A calling surface — a feature, an automation, a plugin — submits:

- a **credential reference** (an identity, never a value),
- the **operation**: destination, method, payload,
- optionally the **scope of intent**: what capability this call believes it
  exercises.

It receives the *outcome* of the call. It never holds the secret, so it cannot
log it, serialize it into state, ship it to an error tracker, or leak it in a
crash — entire defect classes closed by shape rather than review. The
corollary discipline: the broker's own errors and traces are written as if
they will be read publicly, because the broker is now the one place where a
secret could meet a log line.

## Destination binding — the confused-deputy gate

A credential is bound at admission to its **home service** — the host or
service family it was issued for — and the broker refuses to apply it
anywhere else. This is the gate against the confused deputy: a compromised or
merely buggy caller saying "call attacker-controlled-host with credential X"
must fail *at the door*, not succeed and exfiltrate the proof in an outbound
header. The binding is data on the credential record, not a judgment the
broker improvises per call; redirect handling deserves explicit attention (a
redirect to another host must not carry the credential along).

## Scope intersection

Effective capability for a brokered call is the **intersection** of what the
grant actually carries and what the caller's context is entitled to. The
credential's full scope is the ceiling, never the default: a caller wired for
read-only work gets read scope through the door even when the underlying
grant could write. Requests exceeding the intersection fail loudly **at the
door** — a scope failure surfaced locally, before egress, names itself; the
same failure surfaced as the provider's generic authorization error two hops
downstream costs a diagnosis session.

The gate must see the real grant
([gate-sees-target](../../_laws.md#gate-sees-target)): scope checks evaluate
against the credential's *current* recorded capability — refreshed when the
provider reports it, re-validated on rotation — not against a copy cached at
wiring time. Grants narrow: providers withdraw scopes, re-consent drops
permissions, rotation resets to defaults. A check against the stale copy
passes exactly when the grant has narrowed, which is the moment the check
existed for.

## Derived handles — when a caller must hold something

Some callers genuinely cannot call through the door — a spawned subprocess, a
sandboxed tool, a short-lived worker. The answer is still never the parent
credential. Mint a **derived handle**:

- **narrowed** — scope intersected down to the task at hand,
- **short-lived** — validity bounded by the task's expected duration, not the
  parent's lifetime,
- **linked** — the handle records its parent, so audit lines through the
  handle attribute back to the grant and the issuance that authorized it,
- **revocable as a family** — retiring or suspending the parent kills every
  outstanding child.

Every handle names its reaper at mint time
([creation-names-reaper](../../_laws.md#creation-names-reaper)): expiry
enforced by the broker, plus revocation on parent death. A derived handle
with no expiry is the parent credential with extra steps and better PR.

## Response hygiene

The outbound door is also an inbound filter. Providers echo: authorization
headers reflected in error bodies, tokens embedded in returned URLs or
diagnostic payloads, request dumps in failure responses. The broker scrubs
known echo shapes before the response crosses back to the caller — the caller
was promised it would never hold the secret, and a provider's error format
must not be able to break that promise.

## Audit at the door

Every brokered call writes one audit line: **caller identity, credential
reference, destination, operation class, outcome, timestamp** — and never the
value or the raw authenticated request. Because the door is singular, the
trail is complete by construction; "which automations used this credential
last month" is a query, not an archaeology project. The audit write must not
*block* the call — an audit-store hiccup taking down every automation inverts
the priorities — but a use that went unaudited is counted and surfaced as a
visible integrity gap, never silently shrugged off.

The singular door earns one more dividend: it is the natural seat for
**consumption governance**. Per-credential rate limits and quotas applied at
the door bound what a compromised or runaway caller can spend through any
credential — containment that N independent call sites cannot provide,
because no one of them sees the aggregate. This is the record that
makes retirement safe (who still depends on this?), makes remediation
proportionate (how much traffic does degrading this affect?), and makes an
exposure post-mortem answerable (what did the leaked credential touch, and
when?).

## What refuses the pattern

Watch for the pressure points where plaintext tries to escape: a third-party
library that insists on owning the whole connection, a config file a sidecar
reads at boot, a template that interpolates "just this once". Each is either a
case for a derived handle with a tight reaper, or a genuine boundary of the
architecture to be recorded as such — an enumerated, audited exception.

Two escape routes deserve standing suspicion because they leak *by default*:

- **The process environment.** Anything in the parent's environment is handed
  to every child it spawns, transitively, forever — so a broker or session
  token placed there for one consumer's convenience is silently distributed
  to every subprocess the application ever launches. Tokens travel to
  children by *explicit, per-spawn* injection (a scrubbed environment plus
  exactly the variables this child needs), never by ambient inheritance.
- **Files written for children to read.** A config file carrying a derived
  handle is a credential artifact: it gets restrictive permissions *at
  creation* (not default-inherited ones — temp directories often inherit
  broader access than the vault's own store), and its deletion is owned by a
  guard tied to the child's lifetime, not by a cleanup task that "should"
  run. Measured reality in one audited system: the sealed store and master
  key were owner-only, while the broker-token files in the temp directory
  inherited access for other accounts and outlived their consumers by a week
  — the perimeter hardened, the spill unguarded. The
unacceptable outcome is the silent one: a copy of the parent credential living
outside the vault's custody, unknown to rotation, invisible to audit, and
still valid.
