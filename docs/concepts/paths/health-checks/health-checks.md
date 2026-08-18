---
layer: golden-path
subject: health-checks
status: forged
techniques:
  - three-state-outcomes
  - probe-design
  - probe-caching
  - remediation-affordances
  - health-rollup
  - check-scheduling
evidence:
  - src-tauri/src/commands/infrastructure/system/health.rs         # per-check status enum + remediation string + installable flag; all_ok is worst-of; keyring/db scratch round-trip probes
  - src-tauri/src/engine/healthcheck.rs                            # Verified/Unverifiable/Failed three-state; 5s deadline that kills the hung child; sweep buckets counted on typed state, not the legacy boolean; stamp-before-sweep daily cadence
  - src-tauri/src/commands/infrastructure/system/binary_probe.rs   # one TTL cache shared by every caller that probes the same executables; probe runs outside the lock
  - src/features/overview/components/health/SystemHealthPanel.tsx  # refresh affordance; re-runs checks after an applied install — the fix's success claim is the re-probe
  - src/features/agents/sub_health/useHealthCheck.ts               # penalty-weighted composite with shared grade cutoffs; a sub-check that could not run discloses the score as incomplete
  - src/features/agents/sub_health/useHealthDigestScheduler.ts     # weekly digest cadence; corrupt-stamp-means-due-once; one-attempt-per-session latch against retry storms
  - src/features/vault/shared/hooks/health/useCredentialHealth.ts  # three-layer result storage with declared priority; persisted fallback explicitly marked stale
counter_evidence:
  - docs/concepts/golden-paths/connection-health-check.md          # measured: the live-run 401/invalid_grant path logs but never writes the health record — in-band evidence weaker than the scheduled probe, inverted hierarchy
deviations:
  - w4-health-checks   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Health checks & probing

A health check answers one question in the present tense: **does this
dependency work, right now?** Not "was it installed", not "did it work when we
last needed it", not "does its process exist" — *works, now*. Everything that
distinguishes a diagnostic from a decoration follows from taking the present
tense seriously: the check must observe the real dependency (not a proxy for
it), it must admit when it could not find out (not guess), its answer must
carry its age (a green from an hour ago is a fact about an hour ago), and a
red must arrive holding the fix (a red light without a next action is an
alarm, not a diagnostic).

Health checking is the general discipline — environment readiness, subsystem
liveness, external-tool availability, configuration sanity. One of its
domains has a discipline of its own: probing whether a *stored credential*
will be accepted by its provider is owned by the vault subject's
[health-probing](../credential-vault/techniques/health-probing.md) technique,
which applies everything below to the special case where the thing being
verified is a secret and the prober is a guest on someone else's rate limit.
This subject holds the general form; that one holds the credential
specialization. Where the rules here generalize its three-state outcome, they
say so.

## Three verdicts, not two

Every check concludes in exactly one of three states:

- **healthy** — the check observed the dependency working, now;
- **unhealthy** — the check observed the dependency failing, now;
- **could not determine** — the check itself did not complete: timeout,
  missing permission, offline, the probe tool absent, the check
  misconfigured.

The third state is where honesty lives, and collapsing it is the classic lie
of the genre ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
Collapse "could not determine" into **unhealthy** and every transient
environment hiccup paints the board red — the operator learns that red means
"probably nothing", which destroys the only currency a diagnostic has.
Collapse it into **healthy** — or, the subtler form, silently keep showing the
last green — and a dead dependency hides behind an unearned checkmark until
the moment of need finds it. The two collapses fail in opposite directions,
and both are worse than the truth: *we don't know, and here is why we don't
know.*

The vocabulary of verdicts is defined once and consumed everywhere — the
badge, the rollup, the scheduler's backoff decision, the gate that blocks a
launch ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
The full type discipline — including the split between *cannot determine now*
(transient, retried) and *cannot determine ever* (structural, rendered as its
own calm fact) — is [three-state-outcomes](techniques/three-state-outcomes.md).

## Observe the dependency, not a proxy

A check is a gate, and a gate must see its target
([gate-sees-target](../_laws.md#gate-sees-target)). The catalog of
health-check proxies is long and every entry has burned someone:

- checking that a tool's install *directory* exists instead of executing the
  tool — validates the installer's past, not the tool's present;
- pinging a host instead of exercising the protocol — validates routing, not
  service;
- reading a version string from a manifest instead of asking the running
  thing — validates a file, not a process;
- confirming a configuration value is *set* instead of confirming the thing
  it configures *responds* — validates intent, not reality.

Each proxy check passes exactly when the proxy diverges from the target —
which is the only situation the check existed for. The honest probe performs
a minimal real interaction: run the tool and read its answer, open the
connection and complete the handshake, issue the cheapest genuine request the
dependency supports. And the strongest observation of all is not a probe:
it is **real work using the dependency** — when a live operation observes a
definitive failure, that evidence feeds the same health record the probes
feed, or the weakest observer ends up writing the record while the strongest
one only logs. Doing all this without durable side effects, within a
deadline, and identifiably (so concurrent callers can share one probe) is
[probe-design](techniques/probe-design.md).

## A red carries its remedy

The difference between monitoring and diagnostics is what happens after red.
A monitoring light says *something is wrong*; a diagnostic says *this is
wrong, and here is what to do about it*. Every check is therefore authored as
a triple: the observation, the verdict, and the **remediation** — a concrete,
human-executable next action, written at the same time as the check, by the
author who at that moment knows exactly what failure means and what fixes it.
Bolting remediation on later never happens; the knowledge has evaporated.

Remediation has grades. The floor is a fix *instruction*. Above it: a fix the
system can apply itself on request — with its own confirmation rules, because
"click to fix" that silently mutates an environment is a new hazard wearing a
helpful face. And the check declares *whether* its failure is fixable at all
from inside the product, so the surface can distinguish "press this button"
from "go change something out in the world". All of this is
[remediation-affordances](techniques/remediation-affordances.md).

## Checking must not become the load

Probes cost: process launches, network round-trips, rate-limit budget,
latency on the surfaces that wait for them. A naive design lets every
interested caller run its own probe on its own schedule, and the diagnostic
layer becomes a measurable fraction of the system's load — occasionally the
*cause* of the degradation it reports. The economics are solved structurally,
not by discipline:

- **one shared probe per target**, deduplicated so concurrent askers await a
  single in-flight check rather than racing their own;
- **results cached under a TTL** sized to how fast the underlying fact can
  actually change;
- **invalidation on relevant change** — an install completed, a setting
  saved, a network transition — so the cache never outlives the event that
  falsified it.

A cached verdict is a stored derivation, and it names its recomputation
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)):
every surface that renders a cached result can also demand a fresh one. The
cache/dedup/invalidation machinery is
[probe-caching](techniques/probe-caching.md).

## Staleness is part of the result

Because results are cached, every consumer is potentially reading the past —
so the age of the answer is part of the answer. A result is stored with its
timestamp, rendered with its age, and judged for sufficiency **by the
consumer**: a dashboard glance tolerates minutes; a pre-flight gate before
launching unattended work may demand a probe now. The store's job is to serve
the verdict *and* its age; deciding whether that age is acceptable belongs to
the caller, because only the caller knows the stakes of being wrong. A
surface that renders yesterday's green as today's green has quietly rejoined
the two-state lie by another door.

## Many checks, one honest summary

Real systems run dozens of checks, and someone always wants the number: "is
the system healthy — yes or no, or out of a hundred?" A rollup is legitimate
only under two rules. First, **the summary names its failing members** — a
composite that says "73" without saying *which* checks dragged it down is a
mood ring; the drill-down from summary to member verdict to remediation must
never break. Second, the aggregation function is chosen deliberately —
worst-of for gate decisions (one hard failure fails the launch, whatever the
average says), weighted only where members genuinely differ in consequence —
and "could not determine" members are surfaced in the summary, never
laundered into either side of it. Composite *scoring mathematics* in general
— weights, normalization, banding — is the scoring-rubrics subject (not yet
forged); what lives here is only the health-specific honesty of rollups:
[health-rollup](techniques/health-rollup.md). How a score or status renders —
the meter, the badge, the trend — is the display side and belongs to
[data-viz](../data-viz/data-viz.md).

## Attention is not a schedule

When checks run is a design decision, not an accident of which screen the
user opened. Probing on render couples cost to curiosity — the watched
dependency gets hammered, the unwatched one (serving tonight's unattended
work) is never checked at all, which inverts the entire purpose. The mature
shape: checks run **on demand** (a human asks), **on watch** (a dependency
someone declared they care about, probed on cadence and summarized on a
digest rhythm rather than interrupting per-flap), and **on event**
(post-install, post-configuration, resume from sleep). Repeated failure earns
backoff, not a tighter loop — a red that has been red for an hour does not
need re-confirming every ten seconds. Cadence, digests, prefetch, and backoff
are [check-scheduling](techniques/check-scheduling.md).

## What a check observes, classified

When a probe fails, the failure itself needs classifying — timeout, refusal,
absence, rejection — because the verdict and the remediation both branch on
the kind. That classification discipline (structured fields over prose,
one classifier, category surviving boundaries) is the
[error-handling](../error-handling/error-handling.md) subject; a health check
is one of its consumers, not a re-inventor of it. Likewise, a probe that
retries before concluding borrows its policy from
[retry-backoff](../retry-backoff/retry-backoff.md) rather than improvising —
with the health-specific twist that *exhausting retries* concludes "could not
determine" or "unhealthy" per the classification, never a silent nothing.

## The techniques

- [three-state-outcomes](techniques/three-state-outcomes.md) — the verdict
  vocabulary as distinct types with distinct render and retry semantics;
  cannot-determine-now vs cannot-determine-ever; why collapsing is the
  classic lie.
- [probe-design](techniques/probe-design.md) — observing the real
  dependency; timeout discipline; side-effect-free probes; probe identity
  and dedup.
- [probe-caching](techniques/probe-caching.md) — shared TTL caches,
  staleness stamps, invalidation on relevant change, the refresh path every
  consumer can invoke.
- [remediation-affordances](techniques/remediation-affordances.md) —
  per-check fix instructions, self-applying fixes and their confirmation
  rules, fixability as a declared property.
- [health-rollup](techniques/health-rollup.md) — composite verdicts that
  name their members; worst-of vs weighted; the undetermined member's place
  in the summary.
- [check-scheduling](techniques/check-scheduling.md) — on-demand vs watched
  vs event-driven; digest cadence; prefetch; backoff on repeated failure.
