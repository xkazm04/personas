---
layer: technique
subject: health-checks
technique: probe-design
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Probe design

A probe is the part of a health check that touches the world. Its design
answers four questions: *what* does it observe, *how long* may it take, *what
must it never change*, and *who else is asking the same thing right now*.

## Observe the target, not its shadow

The single most common probe defect is observing a proxy
([gate-sees-target](../../_laws.md#gate-sees-target)). The proxy is always
cheaper to check than the target, which is exactly why it gets checked — and
it diverges from the target in precisely the failure modes the check exists
to catch:

| Proxy checked | Target it stands in for | The divergence that burns |
| --- | --- | --- |
| install path exists | tool executes and answers | corrupted, wrong-architecture, or half-updated tool |
| process is running | process is serving | wedged process; deadlocked event loop; full queue |
| port accepts connection | service completes the protocol | listener up, backend down behind it |
| config value is set | configured thing responds | value points at something dead, moved, or misspelled |
| version file says N | running thing reports N | upgrade written to disk but old instance still live |

The honest probe performs the **smallest real interaction the verdict
requires**: execute the tool and parse its self-report; complete the
handshake and issue the cheapest genuine request; ask the running instance
its version rather than reading it off a shelf. "Smallest" matters as much as
"real" — a probe that runs an expensive representative workload is measuring
performance, a different discipline; health asks only *does it work at all*.

Depth is a dial, and the check names its setting: existence → executes →
answers correctly → answers within tolerance. A probe that stops at a
shallower depth than its verdict claims is proxy-checking with extra steps.

## Timeout discipline

Every probe carries an explicit deadline, chosen per target, and the deadline
expiring concludes **unverifiable** (or, where the target's contract makes
slowness itself a failure, **failed** — but that is a deliberate per-check
decision, not a default). Three rules:

- **No unbounded waits, ever.** A probe without a deadline turns one wedged
  dependency into a wedged diagnostic layer — the checker inherits the
  outage it was meant to report. The hang propagates upward into whatever
  awaits the check.
- **Deadline ≪ caller's patience.** A probe embedded in a startup sequence
  or a pre-flight gate budgets its worst case against the total the caller
  can spend; ten checks × their timeouts is the real number to design.
- **Timeout is evidence, not just absence.** Record that the deadline
  expired and at what threshold — "no answer within 2s" and "refused
  immediately" are different facts that route to different remedies, even
  though both end non-green.
- **A timeout must reap what it abandoned.** Giving up on *awaiting* a probe
  is not the same as *stopping* it: a spawned process, an open connection, a
  held handle keeps running after the deadline unless explicitly terminated.
  A scheduled sweep that times out against a hung dependency and merely stops
  waiting leaks one orphan per run — invisible for months, until the machine
  runs out of the resource being leaked. On deadline expiry, kill the child
  work and confirm it is gone; belt-and-suspenders cleanup on every
  cancellation path besides.

## Side-effect-free, by construction

A probe must be safe to run at any frequency, from any surface, concurrently
with real work — which means it **changes nothing**: no writes, no state
transitions, no quota-consuming operations beyond the trivial, no lock
acquisition that real work contends on. The test: if the probe ran a
thousand times against a healthy system, the system afterward is
indistinguishable from before, minus log lines. Probes that cannot meet this
bar (some dependencies offer no side-effect-free interaction) do not get
quietly downgraded to a proxy check that *pretends* to meet it — they surface
as structurally unverifiable (see
[three-state-outcomes](three-state-outcomes.md)), or run only with explicit
consent at explicit moments.

Read-only is also what makes caching and dedup legitimate: only a probe with
no effects can be transparently coalesced or replayed from cache without
changing program meaning.

One capability is the principled exception: **when the thing under test is
the write path itself** — can this store persist? does this secure enclave
actually retain what it is given? — a read-only probe is a proxy by
definition (reading proves nothing about writing, and a write layer that
silently no-ops is precisely the failure worth catching). The honest form is
a **scratch round-trip**: write a throwaway artifact under a reserved,
recognizable name, read it back, verify the value, delete it. The scratch
artifact is created infrastructure and names its reaper — deletion is part
of the probe, including on the failure paths — and it never touches real
entities. "Side-effect-free" precisely stated is: *no durable effect on any
state the system cares about*.

## Real work is the strongest probe

A synthetic probe is a rehearsal; actual work is the performance. When real
usage of a dependency observes a definitive health fact — an authentication
definitively rejected, a store definitively refusing writes — that is
*better* evidence than any scheduled probe will ever produce, because it is
the exact operation, under the exact conditions, that health checking exists
to predict. The design consequence: **the health record accepts evidence
from in-band observation, not only from its own probes.** A system whose
scheduled sweep can mark a dependency unhealthy while the live failure path
merely logs and moves on has its evidence hierarchy inverted — the weakest
observer writes the record and the strongest one whispers into a log. Route
both to the same store, through the same vocabulary; the probe schedule then
becomes the *floor* of detection latency, not the ceiling.

## Probe identity and dedup

Two callers asking "is X healthy?" within the same breath must not launch two
probes. That requires probes to have **identity**: a key derived from the
target and the parameters that would change the verdict — and nothing else.
Same key → same in-flight probe; concurrent askers await the one execution
and share its result. The dedup window and the result cache (see
[probe-caching](probe-caching.md)) are two halves of the same economy:
dedup collapses *simultaneous* demand, the cache collapses *repeated* demand.

Identity keys discipline the parameter space too: if two call sites build
different keys for what is semantically the same question, the dedup silently
stops deduplicating — a drift worth an occasional audit, because its symptom
is only cost, never wrongness.

## What the probe emits

A probe returns evidence, not just a verdict: what it exercised, what came
back, how long it took, at what time. The classification of a failure into
kind — refused, absent, timed out, rejected, malformed answer — reuses the
product's one failure taxonomy (the
[error-handling](../../error-handling/error-handling.md) subject) rather than
inventing probe-local categories; the verdict layer and the remediation
lookup both branch on that classification, and they must branch on the same
one.
