---
layer: technique
subject: perf-instrumentation
technique: probe-cost-budgeting
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Probe cost budgeting

Measurement spends the resource it measures: timers spend time, memory
probes allocate, sampling wakes the scheduler, sinks touch the disk. In a
shipped product the spend comes out of the user's budget, not a lab's, so
it is treated like any other cost — **declared, tiered, and capped**,
rather than accreted one well-meaning instrument at a time until the
observability layer is a measurable fraction of the load. The working
ceiling is a stated one: measurement overhead is held to a small,
named fraction of the measured resource, and any instrument that cannot
demonstrate it fits is redesigned, gated, or cut.

## Tier instruments by cost

- **Counters** — increment an integer, stamp a flag. Effectively free;
  always on; the backbone of every rate.
- **Timers into fixed storage** — a monotonic clock read at start and
  settlement, a constant-time write into a pre-allocated ring (see
  [ring-buffer-metrics](ring-buffer-metrics.md)). Cheap enough for every
  call on the hot path, *provided* the write path stays free of
  formatting, serialization, and contended locks — everything expensive
  deferred to read time, where one asker pays instead of every operation.
- **Expensive probes** — process spawns, directory walks, full scans,
  queries against the system. Never on the hot path, never per-render,
  never in a loop whose frequency the probe author doesn't control.
  These are cached and shared (below) or demoted to on-demand.
- **Profilers and traces** — orders of magnitude above budget; on-demand
  only, run by a human who is hunting, never shipped always-on.

The tier is decided by measuring the instrument itself once, not by
intuition — hot-path authors are reliably wrong in both directions about
what costs.

## Cache the expensive, share the cached

An expensive probe's result is cached under a TTL sized to how fast the
underlying fact changes, and the cache sits **beside the probe, not
beside the caller**, so N interested surfaces produce one probe instead
of N. This is the same machinery the
[health-checks](../../health-checks/health-checks.md) subject builds for
verdicts (its probe-caching technique is the fuller treatment of TTLs,
stamps, and invalidation); here it caches *measurements*, and inherits
the same honesty rules: the timestamp travels with the cached value, and
every consumer that renders it can also demand recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
— a stale number with no refresh path is a complaint the reader cannot
act on.

## Sampling is honest only when declared

When even a cheap record is too dear at full volume — per-frame events,
per-row operations — sample: record one in K, or reservoir-sample the
stream. The discipline is not the sampling; it is the **declaration**.
The sampling rate becomes part of every derived number's predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"p95 over a 1-in-10 sample of completions" and "p95 of completions" are
different claims with different error bars, and a surface that renders
the sampled one unlabeled has upgraded its confidence without paying for
it. Counts derived from samples are estimates and say so. And the rate
lives in one place, adjustable, not hard-coded into five instruments
that will drift apart.

## Every instrument ships a kill-switch

Any instrument that could misbehave in the field — and the observer-effect
scar in [continuous-monitors](continuous-monitors.md) proves they do —
ships with an off-switch reachable **without a rebuild**: a flag, a
setting, an environment toggle. The switch is the difference between "we
shipped a bad instrument, users toggle it off today" and "we shipped a
bad instrument, users wait for the next release while the app stutters".
Two rules keep switches honest: the switch's state is observable wherever
the instrument's output appears (a silent off reads as healthy — the
failure mode continuous-monitors names), and a switch thrown in anger is
a defect filed, not a problem solved.

## The budget is periodically re-audited

Instruments accrete: each is individually justified, and the sum is
nobody's decision. The budget is re-measured occasionally as a whole —
what does the observability layer cost when everything default-on is on?
— because the ceiling is a property of the *sum*, and the sum changes
every time a feature ships with its own well-meaning timer. An
observability layer nobody has measured is the one part of the system
exempted from its own discipline, which is exactly backwards.
