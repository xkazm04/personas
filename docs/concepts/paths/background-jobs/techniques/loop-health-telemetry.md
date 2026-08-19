---
layer: technique
subject: background-jobs
technique: loop-health-telemetry
status: forged
laws: [failure-not-empty-success, count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Loop health telemetry

Background work is work nobody watches, which means its failure mode is not
an error on someone's screen — it is an absence that compounds quietly:
deliveries not retried, rows not expired, tokens not refreshed, discovered
weeks later by their consequences. Health telemetry is the counterweight: it
makes every loop's recent history observable, and — the harder half — makes
**silence itself detectable**.

## The per-tick snapshot

The unit of health is a snapshot written by the supervisor's envelope at
every tick exit, in one shape for every loop:

- loop name (from the closed roster — the join key for everything);
- tick start time and duration;
- outcome, from a closed vocabulary: **succeeded · succeeded-empty ·
  failed · crashed · timed-out · skipped**;
- an error summary when the outcome carries one;
- a work count when the outcome carries one — *with its predicate*
  ("processed 12 due deliveries", not "12")
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)).

Two distinctions in that vocabulary do disproportionate work. **Succeeded vs
succeeded-empty** separates "ran and acted" from "ran and found nothing" —
the difference between a healthy quiet system and a loop whose query has been
returning zero rows since a schema change broke its filter
([failure ≠ empty success](../../_laws.md#failure-not-empty-success)).
**Skipped** (re-entrancy guard) as a first-class outcome makes effective
cadence auditable: a loop whose record is one long run and thirty skips is
running at one-thirtieth of its declared rate, and nothing but this outcome
reveals that.

Snapshots are written by the envelope, not by tick bodies. A body that
self-reports can lie by omission — precisely in the crash and timeout paths
where reporting matters most.

## The health surface

Raw snapshots feed two consumers with different needs:

- **A queryable current-state surface**: for each registered loop, the last
  snapshot, the last *successful* tick time, and the consecutive-failure
  count. This is the roster joined with its most recent evidence — the page
  an operator opens to answer "is the background runtime OK", and the input
  a health probe evaluates. Its cardinality is the roster's, so it stays
  cheap forever.
- **A bounded event stream**: transitions worth pushing — first failure after
  successes, quarantine entry and exit, takeover of the ownership claim,
  silence detected. Stream *transitions*, not every tick: a per-tick event
  stream from a fast loop is telemetry that DDoSes its own audience, and the
  interesting information was in the edges anyway.

Aggregates on the surface (failure rates, average durations) are derived
values, and each names how it is recomputed from snapshots
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
— otherwise the first "rate says 2%, snapshots say 20%" discrepancy has no
arbiter.

## Silence detection: the absent signal

Everything above reports what ticks *did*. The failure it cannot catch is the
tick that never ran: a loop unhooked by a bug, a supervisor that died, a
process wedged with its heartbeat frozen. Detecting absence requires a
different mechanism, because no snapshot will announce it.

The mechanism is an **expectation check**: something with independent
liveness compares, for each loop, *now − last snapshot time* against that
loop's declared cadence (times a generosity factor — 3–5×, absorbing skips,
backoff, and honest slow ticks). Overdue → the loop is silent; raise it as a
first-class health event naming the loop and the gap.

Two structural requirements, both learned the hard way:

- **The checker's liveness must not depend on the thing it checks.** A
  silence detector implemented as another loop in the same supervisor dies
  with the supervisor — precisely the failure it exists to catch. Run the
  expectation check from an independent timer, a different component's
  heartbeat handler, or an external probe; at minimum, cross-check from a
  second vantage point (a client surface that displays staleness when the
  data it polls stops moving is a legitimate poor-man's detector).
- **The declared cadence is the contract, so keep it machine-readable.** The
  expectation check needs each loop's expected rate from the registration
  itself — a hand-maintained list of "loop X should tick every Y" drifts the
  first time someone changes a cadence, and a detector driven by stale
  expectations pages people about healthy loops until it gets turned off.

## Retention and the debugging window

Current-state answers "is it OK now"; debugging needs "what happened around
02:00". Keep a bounded history of snapshots — a ring per loop or a
time-capped table — sized to cover the plausible investigation lag (days,
not hours: background failures are discovered late by nature). Bound it at
write time; an unbounded health log is a disk leak with excellent
intentions, and the telemetry system should not itself violate
[creation-names-reaper](../../_laws.md#creation-names-reaper).
