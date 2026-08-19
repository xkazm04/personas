---
layer: technique
subject: admission-queue
technique: load-aware-admission
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Load-aware admission

Slot counts and depth bounds are models of capacity; the host is the
reality. The models fail in both directions — a cap of eight is too many
when each unit turned out heavy today, too few when the machine is
otherwise idle — because a static count cannot see what this workload, on
this machine, right now, actually costs. Load-aware admission adds the
missing gate: before promoting queued work, consult the host's condition,
and **defer** while pressure is real.

## The prime directive: defer new, never disturb running

The pressure gate acts on exactly one thing: **promotion of not-yet-started
work**. It never pauses, throttles, or kills work already admitted —
in-flight work embodies spent resources and held promises, and destroying
it to relieve pressure spends more of exactly what is scarce, then adds a
retry. (Terminating a run that individually exceeds its own budget is a
different instrument with a different trigger — that is the process
layer's resource-protection ground, aimed at one offender, not at
admission.) The queue absorbs the deferral: entries wait longer, depth
rises, and if pressure persists the depth bound refuses new arrivals with
the resource-pressure reason — the system degrades in the designed order,
loudest at the edge, gentlest at the core.

## Signals: few, cheap, and meaning-bearing

The gate reads a small set of host signals — processor saturation, memory
occupancy, sometimes storage headroom — and the discipline is knowing what
each *means*, because they are not interchangeable:

- **Processor saturation is self-healing.** A busy processor queues work;
  the backlog clears when demand does. Sustained saturation argues for
  deferring, but brief spikes are the normal texture of work starting.
- **Memory occupancy is not.** Past the ceiling the platform kills
  something, and high occupancy is often *healthy* — caches and warm state
  reclaimed on demand — so the raw number over-reports danger. The
  threshold sits high, near where occupancy stops being reclaimable, not
  at where it merely looks busy.

This asymmetry of meaning is why thresholds are **per-signal**, chosen from
what each signal implies about the next admission, never one global
"pressure percent" applied uniformly.

## Hysteresis: two thresholds, or a flapping gate

A single threshold produces oscillation by construction: admission stops
at the line, pressure eases just below it, admission resumes, the new work
pushes back over, and the gate flaps — admitting in stutters, spraying
state-change noise, and coupling every admission decision to measurement
jitter. The repair is **asymmetric thresholds with a gap**: close the gate
at a high-water mark, reopen only below a *distinctly lower* low-water
mark. The gap is sized against the cost of one admission — reopening must
mean "there is room for at least one unit of new work without re-crossing
the line", not "we are a rounding error below the mark." Time-based
damping (a minimum closed duration, or requiring N consecutive calm
samples) composes with the gap when the signal itself is spiky.

## The probe is a component, and it can lie

The gate is only as honest as its measurement
([gate-sees-target](../../_laws.md#gate-sees-target) — a pressure gate
reading a stale, cached, or wrong-scope number gates against a fiction):

- **Scope.** Host-level numbers and per-container allowances diverge;
  measure the boundary that will actually kill you.
- **Warm-up.** Rate-based signals (saturation over an interval) are
  undefined on the first sample; a gate that acts on the first read acts
  on noise. Skip it, and say so.
- **Cost.** The probe itself consumes what it measures. Sample on a
  modest cadence and reuse the reading across admission decisions in the
  window; probing per-request turns the gate into load.
- **Failure.** When the probe cannot read the host, the gate must choose
  a posture out loud
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  "could not measure" is never reported as "no pressure"). Fail-open with
  a logged warning is usually right — a broken probe should not halt all
  admission — but the choice is the designer's, made once, stated in the
  gate.

## The gate is visible

Every transition — closed at threshold X on signal Y, reopened below Z —
is logged with the reading that caused it, and the gate's current state is
queryable next to queue depth. The operator diagnosing "why is nothing
starting?" must find "pressure gate closed since 14:02, memory 91%" in one
lookup, because the alternative diagnosis — the queue silently deferring
with no stated cause — is indistinguishable from the queue being broken,
and will be treated as such, usually with a restart that destroys exactly
the state the gate was protecting. Duration-in-state is worth alarming on:
a gate closed for minutes is doing its job; a gate closed for a day is a
capacity problem wearing a safety feature's uniform.
