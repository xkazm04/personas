---
layer: technique
subject: authorization
technique: dispatch-chokepoint-gating
status: forged
laws: [one-validation-door, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Dispatch-chokepoint gating

The enforcement point for authorization is the **dispatch chokepoint**: the
single place where every call from outside the trust boundary is routed to
its handler. The gate wraps the dispatcher itself, so the sequence for every
inbound call is fixed and unskippable:

> receive → **gate: identify channel, look up requirement, decide** →
> dispatch → handler

This is [one-validation-door](../../_laws.md#one-validation-door) applied to
authorization: one door, enumerable writers (the operations registered with
the dispatcher), and a property that holds *by construction* rather than by
N handlers' discipline. An operation registered with the dispatcher is gated
because it is *reached through* the gate; there is no code path on which the
question was not asked.

## Before dispatch means before everything

The gate runs before argument deserialization does anything interesting,
before handler preambles, before validation logic that was written assuming
a legitimate caller. The ordering is the security property: every line of
code that executes pre-gate is attack surface available to *unauthorized*
callers, and parsers are historically where that surface breaks. To a caller
that fails the gate, a privileged operation should be indistinguishable from
one that does not exist — same refusal shape, same timing envelope, no
partial execution, no side effects, not even a parse error that confirms the
operation's argument schema.

## Channel identity: the injected proof

In the local-application geometry the caller is the application's own UI
surface or a spawned worker, so the gate's "who is asking" is answered by a
**channel proof**:

- **Minted at startup** from a cryptographically secure random source — an
  unguessable value, regenerated every launch, never persisted. Its lifetime
  is the process's lifetime; restart is revocation
  (the proof's reaper is named at mint time).
- **Injected, not requested**: the backend places the proof into the trusted
  surface at initialization — into the UI layer's bootstrap state, into a
  spawned child's environment or startup handshake — through a path
  untrusted content cannot read. The trust decision is made once, by the
  injector, at injection time; it is not re-negotiable by callers.
- **Presented on every gated call** and compared in **constant time**. An
  early-exit string comparison leaks, through timing, how many leading
  bytes matched — which converts an unguessable value into a
  guessable-byte-at-a-time value for any caller that can measure
  round-trips. On a local IPC surface the attacker's timing resolution is
  excellent; constant-time comparison is not paranoia, it is matching the
  defense to the measured channel.

The proof authenticates the *channel*, not the user — the OS authenticated
the user. Everything the proof gates is therefore anchored on "did this call
arrive through a surface the backend itself provisioned", which is exactly
the question the local threat model asks.

**Delivery ordering and reliability are part of the design, not deployment
detail.** The proof must be in the trusted surface's hands *before its first
privileged call* — mint before the surface is created, attach through a
mechanism that cannot race the surface's startup, and give the surface a
fallback attachment path if the primary one can be late. The failure mode of
a flaky delivery mechanism is not the visible error; it is the quiet
response to the visible error: operations get reclassified downward "so the
app boots reliably", one at a time, each defensible, until the public tier
contains things nobody would have put there on day one. When a delivery
constraint genuinely forces an operation below its natural tier, record it
as a dated exception with a named owner — an exceptions list that can only
shrink — never as the operation's classification.

## The gate reads the declared requirement

The gate's decision input is the operation's declared tier and scope
requirement, looked up from the registry that the
[declarative-requirements](declarative-requirements.md) technique maintains.
The gate must consult the registry the build actually produced — the real
target, not a parallel hand-maintained list
([gate-sees-target](../../_laws.md#gate-sees-target)); a lookup table
maintained by hand next to the dispatcher passes review exactly until the
first operation is added to one and not the other. Lookup failure is a
decision: an operation the registry does not know is **refused**, per
[failure-direction](failure-direction.md) — the unlisted case is the
default-deny case, not a pass-through.

## The second layer: in-handler tripwires

Chokepoint enforcement has one structural weakness: it protects every path
*through the dispatcher*, and nothing else. Refactors create other paths —
a second entry point for a new transport, an internal call that reuses a
handler as a library function, a test harness that bypasses dispatch "just
for setup". For the most sensitive operations, the handler re-asserts its
own requirement locally: one line, checking the same proof against the same
registry entry.

The two layers have distinct jobs and must be understood as such:

- the **chokepoint** is the enforcement — complete coverage, by
  construction;
- the **in-handler guard** is a tripwire — it exists to *detect a broken or
  bypassed chokepoint*, and its firing in production is a sev-1 signal that
  the architecture regressed, not a normal denial.

Because the tripwire duplicates the decision, it must derive from the same
declared requirement (never a second hand-written constant) or the two
layers will eventually disagree, and the disagreement will be resolved by
whichever layer the attacker didn't trigger.

**The tripwire's evidence must survive the execution model.** The natural
implementation — the gate stamps "validated" into ambient per-thread or
per-request state, the handler checks the stamp — silently degrades when
the dispatch model defers work: a handler whose body is scheduled onto
another executor, or runs after the dispatch call returns, reads the stamp
*after the gate has already cleared it*, or from a context that never had
it. The honest outcomes are then two, and a design must know which one it
has: either the evidence channel is rebuilt to travel with the work (a
value passed into the handler, not ambient state), or the in-handler check
is acknowledged as a **breadcrumb** — a log line proving the call happened,
enforcing nothing. A breadcrumb documented as a guard is worse than no
second layer, because reviewers budget trust against it. Where the evidence
channel only works for one execution shape, the audit that keeps the tier
table honest must treat the other shape as having **no second layer at
all**, and weigh chokepoint-list membership accordingly.

The decision the gate makes should return **the reason, not a boolean** —
which requirement was demanded, which grant or proof satisfied or failed
it. The refusal message, the audit line, and the tripwire all consume that
reason; a boolean forces each of them to re-derive context the kernel had
and threw away.

## Refusal shape

A gate refusal is uniform, terminal, and logged. Uniform: one refusal shape
for missing proof, wrong proof, insufficient tier, and unknown operation —
differentiated in the audit record, not in the response, because the
response is readable by the very caller whose trustworthiness is in
question. Terminal: no fallback dispatch, no degraded handler, no
"read-only version" invented at the gate. Logged: every refusal writes the
denial record the [authorization-audit](authorization-audit.md) technique
specifies, because a refusal at this gate is either a bug, a
misconfiguration, or an attack, and all three are someone's next task.
