---
layer: golden-path
subject: authorization
status: forged
techniques:
  - privilege-tiers
  - dispatch-chokepoint-gating
  - scope-design
  - declarative-requirements
  - authorization-audit
  - failure-direction
evidence:
  - src-tauri/src/ipc_auth.rs                       # three-tier vocabulary (AuthTier), gate at the invoke wrapper before dispatch, CSPRNG channel proof, constant-time compare, drift-guard tests with instrument assertions
  - src-tauri/macros/src/lib.rs                     # #[requires(level)] — declarative requirement adjacent to the handler; name derived from the fn ident; unknown level = compile error
  - src-tauri/src/engine/credential_broker.rs       # the pure default-deny kernel: exact-match scope intersection, empty set authorizes nothing, returns WHICH grant authorized (not a boolean)
  - src-tauri/engine/src/scope_enforcement.rs       # three-outcome allow/warn-only/block; corrupt metadata resolves stricter than absent metadata
  - src-tauri/src/engine/management_api.rs          # per-route scope matrix on issued keys; parsed_scopes fails closed to empty; derived handles cannot mint handles
counter_evidence:
  - src-tauri/src/ipc_auth.rs                       # same file, other face: command_tier falls through to Public (unlisted = ungated, not refused), and the async in-handler guard verifies only that the system booted — audit, not enforcement
deviations:
  - w3-authorization   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Authorization & capability scoping

Authorization is the subsystem that answers, for every operation the
application can perform, **"is this caller allowed to do this, right now?"**
— and refuses when the answer is not a provable yes. It is not authentication
(knowing *who* is asking), and it is not the credential vault (holding the
keys that make actions possible — that subject is
[credential-vault](../credential-vault/credential-vault.md), and the two meet
at exactly one boundary, treated below). Authorization owns the mapping from
*identity* to *permitted action*, the vocabulary that mapping is written in,
and the enforcement point where the mapping becomes a refusal.

The framing that decides everything: authorization is a **property of the
dispatch architecture, not of the handlers**. A system where each operation
remembers to check permission has as much authorization as its most forgetful
handler — which, measured across any codebase old enough to have had three
contributors, is none. The discipline of this whole subject is moving the
decision from N places that could forget to one place that cannot be
bypassed, and then making the requirements themselves data the gate reads
rather than code the gate hopes was written.

## Default-deny is the only stable posture

Every authorization design begins with a single fork: is the unlisted case
allowed or refused? Default-allow feels cheaper — nothing breaks when a new
operation ships — and that is precisely its failure mode: **nothing breaks
when a new operation ships**, including operations that should have been
restricted. Under default-allow, every addition to the system silently widens
the attack surface, and the widening is invisible because it produces no
error, no log line, no review comment. The security posture decays
monotonically, one forgotten annotation at a time.

Default-deny inverts the decay. A new operation that nobody classified is
*unusable* until someone states its requirements — an error surfaced on the
first test run, in development, to the person best positioned to decide. The
cost of default-deny is paid loudly, immediately, and by the author; the cost
of default-allow is paid silently, later, and by the user whose data walked
out. This asymmetry is not a preference; it is the reason no mature
authorization system on record has held the default-allow line for long. The
unlisted case, the unparseable rule, the errored lookup, and the
crashed-mid-decision gate all resolve the same direction:
**when in doubt, refuse** — the full treatment is the
[failure-direction](techniques/failure-direction.md) technique.

## The gate stands at the dispatch chokepoint

Almost every application has a natural narrowing: the point where requests
from outside the trust boundary funnel into a dispatcher that routes them to
handlers. That chokepoint is where the gate belongs — **before dispatch,
before any handler code runs, before argument parsing does anything
interesting with attacker-supplied input**. Placed there, the gate sees every
operation by construction: a handler added next quarter is covered on the day
it ships because it is *reached through* the gate, not because its author
remembered the gate exists.

Gating inside handlers — the tempting alternative, because each handler
"knows its own requirements" — fails structurally, not occasionally.
Handler-level checks are N copies of one decision, and N copies drift; worse,
they run *after* the untrusted input has already been parsed, deserialized,
and partially acted upon, so a bug anywhere in that preamble is reachable by
an unauthorized caller. The chokepoint gate closes that entire class: to an
unauthorized caller, the handler might as well not exist.

Handler-level guards still exist — as **defense in depth, not as the
mechanism**. The most sensitive operations re-assert their requirement
locally, so that a future refactor that reroutes dispatch, adds a second
entry point, or invokes the handler internally cannot silently uncover them.
The two layers have different jobs: the chokepoint is the enforcement, the
in-handler guard is the tripwire that detects a broken chokepoint. The
mechanics — including how the caller proves channel identity and why that
proof is compared in constant time — are the
[dispatch-chokepoint-gating](techniques/dispatch-chokepoint-gating.md)
technique.

## The local-application twist: the caller is not a network principal

In a served system, the principal is remote and hostile by default, and the
whole industry's authorization reflexes are tuned to that shape. A local
application inverts the geometry: the "caller" is the application's own
embedded UI layer or a child process it spawned — same machine, same user
account, often same process tree. It is tempting to conclude the boundary is
theater. It is not, for three reasons that survive scrutiny:

- **The UI layer executes foreign code.** An embedded rendering surface runs
  scripts, loads content, and hosts third-party material; a single injection
  or compromised dependency turns "our own UI" into an attacker with a direct
  line to every backend operation. The dispatch boundary is the only membrane
  between rendered content and the machine.
- **The machine is shared territory.** Other local processes — other
  applications, other users' sessions, malware with user-level access — can
  reach local sockets, inspect the environment of child processes they can
  observe, and probe any endpoint the backend exposes. "Local" is a network
  with a very short wire, not the absence of one.
- **Powers differ by an order of magnitude.** The same dispatch surface
  typically carries both "read a display preference" and "decrypt a stored
  credential" or "execute a shell command". Treating those uniformly means
  the weakest content that ever renders in the UI holds the strongest power
  the backend has.

So the local answer to "who is asking" is **channel identity, not user
identity**: the backend mints an unguessable proof at startup, injects it
into exactly the surfaces it trusts, and requires it on every privileged
call. The user authenticated to the OS; the *channel* authenticates to the
backend. What each channel may then do is governed by tiers and scopes.

One consequence deserves naming at this altitude because it shapes the whole
tier table: **the reliability of the proof channel is itself a security
property.** Every operation the trusted surface must call before the proof
is deliverably in place — and every call the delivery mechanism
intermittently drops — generates pressure to downgrade that operation's
tier so the product works. Those downgrades are rational, permanent, and
invisible in aggregate; a year of them is a public surface nobody designed.
Harden the injection path first, and treat every reliability-motivated
downgrade as a dated exception with an owner, not a classification.

## Privilege tiers: a closed vocabulary, not a per-operation judgment

With hundreds of operations, per-operation ad-hoc decisions ("this one seems
sensitive") produce an unauditable smear. The stable structure is a **small,
closed set of privilege tiers** — ordered levels with named meanings, e.g.
open to any caller / requires trusted-channel proof / additionally requires
an out-of-band grant — and a total assignment: **every operation names its
tier, no operation is unclassified**. Closed means closed
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
applied to privilege): a new tier is a design event with review, not a string
someone typed. The payoffs compound: the security review of N operations
collapses to reviewing the tier assignment table; the gate's logic is a
comparison, not a policy engine; and "what can a compromised UI reach"
becomes a query over the table instead of a code audit. Tier design,
assignment discipline, and the audit that keeps the table honest are the
[privilege-tiers](techniques/privilege-tiers.md) technique.

Tiers answer *how trusted must the channel be*. They deliberately do not
answer *which resources* — that is the next axis.

## Scopes: capability strings as contracts

Where tiers grade the caller, **scopes bound the action**: named capabilities
("read resource class X", "act on resource instance Y") attached to a grant
and checked against each use. The principal-engineer stance is that a scope
string is a **contract, not a label** — the moment a scope is defined, the
system is promising that holders of a grant *without* that scope cannot
perform the action it names, and that promise is only as real as the
enforcement point that checks it. A scope vocabulary nobody enforces is
security documentation of the most dangerous kind: it changes what reviewers
believe without changing what the system does.

Two rules keep scopes honest. First, the vocabulary is closed and owned —
scopes are parsed against a registry, and an unrecognized scope is a refusal,
not a shrug ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
again). Second, effective capability is always an **intersection**: what the
caller's grant carries ∩ what the resource's own policy permits. Neither side
is the ceiling alone; a broad grant meets a narrow resource pin and gets the
pin. Union semantics — anything either side allows — appear in the wild only
as bugs. Vocabulary design, intersection mechanics, and minimization at
grant time are the [scope-design](techniques/scope-design.md) technique.

**The boundary with the credential vault sits exactly here.** The vault owns
the secrets and the one brokered door through which they are exercised
([brokered-egress](../credential-vault/techniques/brokered-egress.md)); *who
may walk through that door, and with which scopes* is this subject. The
vault's door calls into the authorization kernel for its decision; the
kernel never touches a secret. Keeping the two concerns in separate
subsystems is what lets each be audited on its own terms — one answers "can
the value leak", the other answers "who was allowed" — and neither audit has
to read the other's code.

## Requirements are declared, not coded

The gate can only enforce requirements it can *see*. If each operation's
requirement lives as an if-statement in its handler, the gate at the
chokepoint has nothing to read, and coverage is back to being a convention.
The structural fix is **declarative requirements**: each operation carries
its tier and scope needs as an annotation — data attached to the operation's
definition, adjacent to the code it protects, extracted mechanically into
the table the gate consults. Adjacency is what keeps the declaration honest
during review (the requirement and the behavior are diffed together);
mechanical extraction is what makes the gate's view complete
([gate-sees-target](../_laws.md#gate-sees-target): the gate reads the actual
registry of declared requirements, not a hand-maintained parallel list). The
annotation forms, the "unannotated operation fails the build" rule, and the
tooling contract are the
[declarative-requirements](techniques/declarative-requirements.md) technique.

## Decisions are auditable — especially the refusals

An authorization decision is a security event, and the denied ones are the
most informative events the system produces: a denial is either a bug about
to be reported, a misconfiguration about to cost a support session, or an
attack in progress — three urgent stories, distinguishable only if the
denial was recorded with its context (caller channel, operation, tier
demanded vs. presented, scope missing, timestamp). A gate that refuses
silently converts all three into "the button does nothing", debugged at the
UI layer, where the answer is not.

The decision itself should make this cheap: the kernel returns **the reason,
not a boolean** — which rule matched, which grant authorized, which
requirement fell short — and the audit line inherits it. A yes/no return
type discards, at the one moment it is known, exactly the context every
later question needs.

Allowed decisions are cheaper to record in aggregate but must remain
reconstructable: "which channels exercised which privileged operations last
week" is the question every post-incident review asks first, and it must be
a query, not an archaeology project. What to record per decision, at which
altitude, without logging secrets or drowning in volume, is the
[authorization-audit](techniques/authorization-audit.md) technique.

## What is *not* this subject

- **Authentication** — establishing identity. This subject consumes an
  identity (a channel proof, a caller key) and maps it to permission.
- **Secret custody** — the vault holds and applies credentials;
  authorization decides who may cause them to be applied. The two meet at
  the brokered door and nowhere else.
- **Sandboxing and OS-level containment** — process isolation, filesystem
  permissions, syscall filtering. Adjacent membranes, different enforcement
  substrate; this subject governs the application's own dispatch surface.
- **Rate limiting and quotas** — consumption governance answers "how much",
  authorization answers "whether at all". They share the chokepoint but not
  the decision.

## The techniques

- [privilege-tiers](techniques/privilege-tiers.md) — the closed tier
  vocabulary, total assignment over operations, and the review discipline
  that keeps the table meaningful.
- [dispatch-chokepoint-gating](techniques/dispatch-chokepoint-gating.md) —
  the gate before dispatch, channel-identity proof injection, constant-time
  comparison, and the in-handler tripwire layer.
- [scope-design](techniques/scope-design.md) — scope vocabulary as owned
  contract, intersection semantics, exact matching, and minimization at
  grant time.
- [declarative-requirements](techniques/declarative-requirements.md) —
  binding requirements to operations as adjacent, mechanically extracted
  data so the gate cannot be forgotten.
- [authorization-audit](techniques/authorization-audit.md) — recording
  decisions with context, making denials diagnosable, and keeping the trail
  free of secrets.
- [failure-direction](techniques/failure-direction.md) — fail-closed rules
  for every degraded state the authorization subsystem itself can enter.
