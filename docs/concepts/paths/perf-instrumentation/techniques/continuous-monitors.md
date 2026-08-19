---
layer: technique
subject: perf-instrumentation
technique: continuous-monitors
status: forged
laws: [failure-not-empty-success, creation-names-reaper, deletion-is-not-repair]
shared_with: []
---

# Continuous monitors

Some performance facts exist only in the moment: a frozen interactive
thread, a memory ramp, a stutter under load. No on-demand probe can catch
them, because by the time anyone asks, the moment has passed. These facts
get **continuous monitors** — instruments that run for the life of the
process, on a cadence, watching for a condition and writing a durable
record when it occurs. A monitor differs from a probe (see
[probe-cost-budgeting](probe-cost-budgeting.md) for the on-demand kind) in
audience and tense: probes answer a present question for a present asker;
monitors write history for a future investigator. Design them for the
reader they will actually have — someone reconstructing an incident days
later, not someone watching a demo.

## Freeze detection is a heartbeat, not a guess

The honest freeze detector is a **heartbeat on the thread being watched**:
schedule a trivial task on the interactive thread at a fixed interval and
measure, from outside it, the gap between beats. When the thread stalls,
the gap *is* the freeze — its duration measured directly, with a start
timestamp, rather than inferred from downstream symptoms (missed frames,
slow responses) that conflate a dozen causes. The measured gap carries its
own predicate: "the interactive thread did not run scheduled work for
2.3s" is a fact; "the app felt frozen" is a report.

## Memory watching is sampling plus thresholds

The memory monitor samples the process's footprint — resident set,
heap-in-use, whichever measures the concern — on a fixed cadence into a
bounded window, and converts samples into **alert records** when a
threshold is crossed. Thresholds are the monitor's entire editorial
policy: without them it is a data hoarder, accumulating samples nobody
reads; with them it is an instrument, writing few records that each mean
"look here". Threshold rules worth stealing: alert on level (absolute
footprint), alert on slope (sustained growth across the window — the leak
signature), and re-alert with hysteresis, not on every sample above the
line, or the sink fills with one incident's echo.

The same editorial duty applies where a monitor emits into a shared log
or error channel: a burst — a retry storm, a hot loop — can fire the
same alert hundreds of times a second and drown the signal it carries.
The honest cap is an **alert budget**: at most N emissions per key per
window, with everything beyond the budget *counted rather than dropped*,
and the count disclosed when the window rolls over — one summary record
carrying the suppressed total and the worst value seen among the
suppressed. Suppression that discloses its count is rate-limiting;
suppression that doesn't is the monitor quietly lying about the burst,
at exactly the moment the burst was the finding.

## The sink is append-only and names its reaper

Monitor output lands in an **append-only, line-delimited durable sink** —
one self-describing record per line, written at alert time, readable with
nothing but a text tool during the incident. Append-only because the
writer must be crash-safe and constant-cost; line-delimited because the
reader arrives without the application running. And bounded: rotation or
retention is declared at creation
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — a
monitor that appends forever converts its host's disk into its own
long-term symptom. Each record carries timestamp, the measured values,
the threshold that fired, and enough process context to be interpretable
alone, because the investigator reading line 4,000 will not have line 1.

## The observer-effect duty

A monitor is code running inside the process it judges, on a cadence, and
its own work — sampling, allocating records, waking timers — is load. The
formative scar of this technique: an always-on freeze detector whose
periodic allocations triggered collection pauses, **manufacturing the
exact jank it existed to detect**. The duties that follow:

- **Know the monitor's own cost** before shipping it always-on; measure
  the instrument the way it measures the product.
- **Prefer passive over active**: reading a counter the platform already
  maintains beats scheduling work to generate one.
- **Gate the expensive ones.** A monitor whose cost is only justified
  during a hunt ships behind a flag, default-off, enabled when someone is
  hunting. Gating is containment, not cure
  ([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)): the
  flag records that the instrument's cost problem exists and remains
  unfixed — turning the monitor off must never be filed as fixing the
  jank, and the gap in coverage it leaves is part of the trade,
  consciously carried.

## Silence must be legible

A quiet monitor is ambiguous: healthy, or off, or dead? The three must be
distinguishable
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The monitor's enabled/disabled state is surfaced wherever its findings
would appear, so an empty alert list under "monitor: off" reads as no
coverage, not as no problems. And the monitor proves its own liveness —
a periodic mark, a last-sample timestamp — because a watchdog that died
in month two provides negative value thereafter: confidence without
coverage, precisely inverted from its purpose.
