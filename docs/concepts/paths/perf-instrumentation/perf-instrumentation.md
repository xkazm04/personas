---
layer: golden-path
subject: perf-instrumentation
status: forged
techniques:
  - ring-buffer-metrics
  - semantic-flags-over-heuristics
  - startup-phasing
  - continuous-monitors
  - probe-cost-budgeting
  - perf-data-lifecycle
evidence:
  - src/lib/ipcMetrics.ts                                       # 500-record ring + never-evicted lifetime counters; nearest-rank p50/p95/p99 derived at read; timedOut flag with the duration-heuristic trap named in a comment
  - src/lib/tauriInvoke.ts                                      # the one chokepoint: records every call at settlement; timedOut stamped from the actual timeout error type, in the branch that knows
  - src-tauri/src/startup_timing.rs                             # ~35 named phases, marks emitted by the owning setup code; frontend TTI merged into the same report; TTI is None (missing), never zero, until reported
  - src-tauri/src/freeze_monitor.rs                             # always-on production memory sampler: 10s cadence, slope alert (+100MB/10s), append-only line-delimited sink, liveness record every 60th probe
  - src/lib/debug/freezeDetector.ts                             # rAF-heartbeat freeze detector, flag-gated after its own stall-time DOM census worsened the jank it measured; runtime kill-switch, ring of 50
  - src-tauri/db/src/perf.rs                                    # embedded-db's ground, cited as cross-domain confirmation: 2048-sample shared ring grouped per-table at read, nearest-rank p95, explicit 100ms slow threshold, warn budget 5/60s with disclosed suppression summary
  - src/features/overview/sub_observability/components/IpcPerformancePanel.tsx  # the surface: subscribe + derive-on-read, per-command n rendered beside the percentiles
counter_evidence:
  - src-tauri/src/freeze_monitor.rs                             # the durable sink is truncated at every launch (create, then append) — the record of the session that crashed dies with the relaunch that follows it
deviations:
  - w5-perf-instrumentation   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Performance instrumentation

Performance instrumentation is the product **measuring itself, in production,
on the user's machine**. Not a lab benchmark, not an external monitoring
service, not a profiler attached during development — the shipped application
carrying its own instruments and answering, from inside, the questions "how
fast?", "how heavy?", and "how responsive?" with numbers that carry their own
predicates. The sibling question — "does it work at all?" — belongs to
[health-checks](../health-checks/health-checks.md); the border between the two
is the border between a verdict and a distribution. A timeout is a verdict
about one call (theirs); a timeout *rate* over the last five hundred calls is
a distribution (ours). And once the numbers exist, rendering them — the
sparkline, the meter, the panel — is [data-viz](../data-viz/data-viz.md)'s
subject; this one ends at the moment it hands over a series with its
sample count, window, and units attached.

Everything below descends from one structural fact: **the instrument lives
inside the thing it measures.** It shares the process's memory, the
interactive thread's time, the disk the user paid for. That gives it powers
no external monitor has — it can stamp outcomes at the moment they are known,
attribute time to the exact phase that spent it, feel a freeze from the
inside — and it imposes two duties no external monitor carries: the
instrument must never become the leak, and the act of measuring must never
become the load. A metrics array that grows without bound is a memory leak
filed under the name of the feature it was watching. A watchdog whose own
polling causes stutter has manufactured the symptom it exists to detect —
and that is not a hypothetical; it is a scar.

## The instrument must never become the leak

Every instrument that accumulates records declares its bound at creation.
The canonical shape is the **ring buffer**: a fixed-size window of the most
recent records per metric key, where writing the N+1th record evicts the
1st. The bound is the retention policy; the reaper is built into the data
structure, so nobody has to remember to run it
([creation-names-reaper](../_laws.md#creation-names-reaper) satisfied by
construction). Reservoir sampling is the same promise for streams too hot to
keep even a window of. What is never acceptable is the growing array with a
cleanup TODO — in a long-lived process, "we'll trim it later" is the leak.

Bounding records per key is only half the discipline: a map of bounded rings
under **unbounded keys** is still unbounded. The key space gets the same
treatment as the record space — capped, expired, or drawn from a closed
vocabulary. The full shape, including how percentiles are derived from the
window and what eviction does to their meaning, is
[ring-buffer-metrics](techniques/ring-buffer-metrics.md).

## Percentiles over averages, and the derivation stated

The average is the one statistic that describes no user. Latency
distributions are long-tailed: the mean sits in a valley between the fast
majority and the slow tail, describing neither, and one outlier drags it
anywhere. The numbers that correspond to experience are **percentiles** —
the median for the typical interaction, p95/p99 for the tail, and the tail
is where the complaints come from: a p99 of four seconds means every user
who performs the action a few dozen times hits four seconds *today*.

A percentile is a derivation over a window, and it travels with its
derivation or it is a rumor
([count-carries-predicate](../_laws.md#count-carries-predicate)): *p95 of
what window, over how many samples, computed how?* "p95 = 240ms" is not a
finding; "p95 = 240ms over the last 500 calls to this operation,
nearest-rank on the sorted window" is. Sample count is part of the honesty —
a p99 over twelve samples is a coin flip wearing a lab coat, and the surface
that renders it discloses the n or misleads. Storing raw records and
deriving statistics at read time keeps every derived number recomputable
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation));
storing only a rolling aggregate is a number that can never be re-questioned.

## Flags over heuristics

The rates people act on — timeout rate, failure rate, cancellation rate —
must be derived from **explicit outcome flags stamped at the moment the
outcome is known**, by the code that knows it. The tempting shortcut is the
duration heuristic: "any call slower than thirty seconds was probably a
timeout". It is wrong in both directions at once — an operation with a
shorter configured deadline times out *fast* and the heuristic files it as a
failure; a slow success crosses the threshold and is filed as a timeout that
never happened. The heuristic observes a proxy (duration) instead of the
target (the outcome), which is the exact failure mode
[gate-sees-target](../_laws.md#gate-sees-target) names: it diverges from the
truth precisely in the cases the metric exists to count.

The outcome vocabulary — completed, failed, timed out, cancelled — is
defined once and stamped onto the record at settlement; every rate
downstream is a count of flags, never a reinterpretation of durations. The
full discipline, including what cancelled durations do to a latency
distribution, is
[semantic-flags-over-heuristics](techniques/semantic-flags-over-heuristics.md).

## Startup is a pipeline, not a moment

"Startup took six seconds" is a complaint; it is not a finding, because
nothing in it says *which* six seconds. Startup is instrumented as a
**phased pipeline**: named phases with explicit boundaries, each phase's
mark emitted by the code that owns the phase, durations derived from the
boundary timestamps. The phase names are a closed vocabulary with one
definition, or two reports will disagree about what "init" covers.

The subtle obligation is that startup **does not end where the process that
began it ends**. The backend finishing its boot is not startup; startup ends
when a human can act. In a multi-process application that means the last
phase completes in a different process — the interface process measures its
own time-to-interactive and **reports it back into the same startup
record**, so one record tells the whole story across the process boundary
(the boundary itself, and the discipline of calls across it, is
[ipc-contract](../ipc-contract/ipc-contract.md)'s subject; what the
application's boot sequence *is* belongs to
[app-shell](../app-shell/app-shell.md) — this subject only times it). A
phase that never reported is rendered as *missing*, never as zero
([failure-not-empty-success](../_laws.md#failure-not-empty-success)), and
the gap between the sum of phases and the wall clock is itself a finding.
The full shape is [startup-phasing](techniques/startup-phasing.md).

## Continuous monitors are production instruments

Some conditions cannot be measured on demand because they are only true for
moments: a frozen interactive thread, a memory ramp, a stutter. These get
**continuous monitors** — watchdogs that run in the shipped product, on a
cadence, with thresholds that mean *alert* and sinks that are append-only
and bounded. A freeze detector is a heartbeat on the interactive thread: the
gap between beats *is* the freeze, measured rather than inferred. A memory
watchdog samples the process's footprint and writes an alert record when a
threshold is crossed — with enough context in the record to be useful when
it is read days later, because continuous monitors are read during
incidents, not during demos.

Monitors carry the observer-effect duty in its sharpest form. This
subject's formative scar: an always-on freeze detector whose own periodic
work caused collection pauses — **the instrument manufactured the jank it
was built to detect**, and the fix was to gate it behind a flag so it runs
only when someone is actually hunting freezes. Every monitor therefore
ships with a switch, knows its own cost, and its off-state is visible —
silence from a disabled monitor must never read as health
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
full discipline is [continuous-monitors](techniques/continuous-monitors.md).

## Measurement cost is a budget

The meta-rule over all instruments: **measurement spends the resource it
measures**, and the spend is budgeted like any other cost. Cheap counters
run always; timers run on the hot path only if recording is constant-time
against pre-allocated storage; expensive probes — process spawns, full
scans, anything with a syscall storm — are cached under a TTL and shared
across askers (the caching machinery is the same one
[health-checks](../health-checks/health-checks.md) uses for verdicts; here
it caches measurements). Where full capture is too dear, sampling is the
honest fallback — and the sampling rate becomes part of every derived
number's predicate, because "p95 of a 1-in-10 sample" and "p95" are
different claims. Every instrument that could misbehave ships a
kill-switch reachable without a rebuild. Budgets, tiers, caches, and
switches are [probe-cost-budgeting](techniques/probe-cost-budgeting.md).

## The numbers must land where regressions become visible

An instrument whose output lands nowhere is cost with no return. Every
number has a **lifecycle**: captured into a bounded live store, surfaced on
a panel a developer actually opens (rendering rules are
[data-viz](../data-viz/data-viz.md)'s), persisted where cross-run
comparison needs it, compared against a baseline so a regression is a
*diff* rather than a feeling, and expired by a named retention rule. The
lifecycle — including reset semantics, baselines as stored derivations, and
the escalation path from threshold to human — is
[perf-data-lifecycle](techniques/perf-data-lifecycle.md).

## The pattern recurs below the surface

The strongest evidence that these are the right rules is that the storage
layer inside the same product converged on them independently: the embedded
database keeps its own fixed-size per-table latency rings, derives p95 at
read time, and counts slow queries against an explicit threshold — rings,
percentiles, flags, bounds, the same grammar one layer down (that layer's
own discipline is the embedded-db subject, not yet forged). When two
subsystems with different authors and different constraints arrive at the
same instrument shape, the shape is the subject.

## The techniques

- [ring-buffer-metrics](techniques/ring-buffer-metrics.md) — fixed-size
  per-key record windows; percentile derivation at read time; eviction
  honesty; the key-cardinality trap.
- [semantic-flags-over-heuristics](techniques/semantic-flags-over-heuristics.md)
  — outcome flags stamped at settlement; the duration-threshold trap; one
  outcome vocabulary; what cancellation does to a latency pool.
- [startup-phasing](techniques/startup-phasing.md) — named phase
  boundaries; per-phase attribution; the cross-process finish line;
  missing-phase honesty.
- [continuous-monitors](techniques/continuous-monitors.md) — freeze
  heartbeats, memory watchdogs, append-only bounded sinks, alert
  thresholds, and the observer-effect duty.
- [probe-cost-budgeting](techniques/probe-cost-budgeting.md) — cost tiers,
  TTL-cached expensive probes, declared sampling, kill-switches, hot-path
  recording discipline.
- [perf-data-lifecycle](techniques/perf-data-lifecycle.md) — live stores,
  durable sinks, baselines, retention, reset semantics, and the path from
  number to human.
