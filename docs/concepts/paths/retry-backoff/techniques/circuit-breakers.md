---
layer: technique
subject: retry-backoff
technique: circuit-breakers
status: forged
laws:
  - gate-sees-target
  - failure-not-empty-success
shared_with: []
---

# Circuit breakers

Backoff spaces out one caller's attempts against one failing operation. It cannot
express the stronger claim a system eventually earns the evidence for: *this
dependency is down for everyone, and every new attempt — from any caller, for any
operation — is a waste that slows the recovery.* The circuit breaker is the
component that holds that claim. It is an honesty device: the system stops
pretending each call is a fresh question and admits it already knows the answer.

## The state machine

Three states, each with one job:

- **Closed** — normal operation. The breaker observes outcomes and accumulates
  evidence. Trip condition: either *N consecutive failures* (simple, right for
  low-volume dependencies where rates are noise) or *failure rate over a rolling
  window with a minimum-volume floor* (right for high-volume paths — without the
  floor, two failures out of two requests at 4 a.m. reads as a 100% failure rate
  and trips the breaker on nothing).
- **Open** — calls are refused without being attempted, for a cooldown period.
  The refusal must be instant and cheap; that is the entire economic point.
- **Half-open** — the cooldown elapsed, and the breaker admits a *strictly
  bounded* number of probe calls (one is a fine bound). Probe succeeds → closed,
  counters reset. Probe fails → open again, and the cooldown may itself back off
  (a dependency that fails its third consecutive probe deserves a longer wait
  than its first — the ladder logic of backoff-design, applied to cooldowns).

The half-open bound is load-bearing. If cooldown expiry re-admits *all* waiting
traffic, the "probe" is a stampede, the sick dependency is knocked back down, and
the breaker has automated the thundering herd it existed to prevent. Recovery is
probed deliberately, by a budgeted trickle, and the herd stays behind the breaker
until a probe actually succeeds.

## What counts as evidence

The breaker must observe the thing it gates (law: gate-sees-target) — actual call
outcomes against the actual dependency, not a proxy like a health endpoint that
can be green while real calls time out. And not every failure is evidence of
ill-health: the classification layer (see error-classification-for-retry) decides
what feeds the breaker. Transient and unknown failures count; *permanent* failures
do not — one caller's malformed request must not lock every other caller out of a
healthy dependency; *rate-limited* responses are their own lane — the dependency
is alive and stating its own schedule, and tripping the breaker on top of it turns
a stated wait into an unstated one.

## Scope: per-dependency, plus a stated precedence for anything coarser

A breaker's scope is a failure-domain hypothesis: everything behind one breaker is
believed to fail together. The default scope is **per dependency** (per provider,
per endpoint, per account — whatever unit actually fails as one). One global
breaker over unrelated dependencies punishes all for one; per-request-type
breakers under one dependency mostly just multiply state without adding signal.

Layered scopes are legitimate — a per-dependency breaker under a global "the whole
egress path is broken" breaker — but the moment two breakers can both speak, their
**precedence must be a documented contract**, not an accident of check order:

- **Deny wins.** A call proceeds only if every applicable breaker admits it.
- **Attribution is specific.** The refusal names *which* breaker denied it; "a
  breaker said no" is not actionable, and an operator resetting the wrong breaker
  will conclude resets don't work.
- **Probes are scoped to their own breaker.** A global half-open probe's outcome
  feeds the global breaker only; letting it also count against per-dependency
  breakers double-charges one failure to two ledgers and makes recovery order
  dependent on bookkeeping.

## The open breaker must be loud

A breaker denial is a policy decision, not a dependency failure, and it must be
spelled differently from both success and failure (law: failure-not-empty-success).
Three distinguishable outcomes leave the resilience layer: *succeeded*, *failed —
the dependency answered badly*, and *denied — never attempted, breaker X, open
since T, cooldown until T′*. Collapsing denied into failed sends engineers
debugging a dependency that was never called; collapsing it into a quiet nothing
produces the worst outage shape there is: the system looks idle while the breaker
silently refuses everything (retry-observability owns the surfacing).

## Decision rules

- **Breaker state outlives the process or the trip evidence re-accumulates from
  zero after every restart** — during exactly the kind of incident that causes
  restarts. Persist state with a freshness bound: rehydrate recent state, discard
  stale (a breaker opened yesterday says nothing about now; see durable-retries
  for the durability discipline).
- **Manual override is part of the design.** An operator can force-open (planned
  maintenance) and force-close-with-reset (known-fixed). Without the lever, the
  incident channel becomes "restart the whole process to reset one breaker."
- **The breaker and the ladder compose; the breaker wins.** An open breaker
  preempts any scheduled retry attempt — the attempt is denied, and (policy
  choice, stated) the denial either re-schedules without consuming ladder budget
  or counts against it. Deciding this ad hoc per call site is how one outage
  exhausts every budget in the system.
- **Successes offset evidence one-for-one; they do not purge it.** In a
  rate-over-window breaker, letting a single success clear the whole failure
  window means one lucky call through a struggling dependency erases the
  accumulated case for tripping — and under a cascading failure there is always
  an occasional lucky call. Decrement, don't reset; only demonstrated stability
  (the same minimum-stability window backoff-design uses for ladder resets)
  earns a clean slate.
- **Trip thresholds are data, not code.** The first incident will prove the
  threshold wrong for exactly one dependency; changing a number must not require
  a deploy.
