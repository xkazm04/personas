---
layer: application
subject: admission-queue
technique: load-aware-admission
stack: rust
---

# Load-aware admission in the Personas resource governor

`src-tauri/src/engine/resource_governor.rs` is a 74-line implementation of
the technique's whole core — per-signal asymmetric thresholds, hysteresis,
first-sample honesty, defer-never-disturb — with the rationale written
into the module doc rather than left as folklore. It is worth reading as a
minimal reference implementation, and its two gaps are as instructive as
its virtues.

## Defer new, never disturb running

The module doc states the prime directive verbatim: "Running executions
are NEVER interrupted — only NEW admissions defer to the per-persona
queues, draining as load recovers" (`:10-11`). The gate is a single
boolean on the tracker (`set_resource_throttled`,
`src-tauri/engine/src/queue.rs:196-198`), consulted at *both* promotion
doors — fresh admission (`admit`, `:267`) and queue drain (`drain_next`
`:346`, `drain_next_global` `:397`) — so pressure holds new work in the
queues without touching anything in flight. The queue absorbs the
deferral exactly as the technique describes; if pressure persists, the
per-persona depth bound eventually refuses with `QueueFull`.

## Asymmetric thresholds, with the rationale attached

Four constants (`:27-33`): CPU pauses at **70%** and resumes below
**55%**; memory pauses at **85%** and resumes below **70%**. The module
doc carries the per-signal meaning argument (`:13-16`): high RAM
occupancy is often healthy cache warmth while the OOM kill lives near
95%, so memory's bar is *higher* than CPU's, whose spikes are transient.
This is the technique's "thresholds are per-signal, chosen from what each
signal implies" — implemented as named constants with the why beside
them, not one global pressure percent.

## Hysteresis, in both directions

The loop (`:50-56`) pauses when **either** signal exceeds its pause
watermark, and resumes only when **both** fall below their *resume*
watermarks — a 15-point gap on both signals, plus the conservative
both-must-clear rule on reopen. The 3-second sampling cadence (`:35`) is
deliberately cheap ("no process enumeration"), and the reading is shared
by all admission decisions in the window via the tracker flag — the probe
never runs per-request.

## Probe honesty: one virtue, two gaps

- **Virtue** — the first sample carries no valid CPU delta, and the loop
  skips it rather than acting on a bogus 0% reading (`:46-49`). The
  technique's warm-up rule, exactly.
- **Gap 1 — a silent probe freezes the gate silently.** `continue` on an
  invalid sample keeps the *previous* gate state with no announcement. One
  bad sample is warm-up; a sampler that never becomes valid would leave
  the gate frozen forever, and "could not measure" is indistinguishable
  from "measured healthy" — the fail-open posture is real but implicit,
  never stated or logged, which is the half of the technique's
  probe-failure rule ("the choice is made once, stated in the gate") this
  file skips.
- **Gap 2 — transitions are visible, duration is not.** Every gate flip
  logs both readings and the direction (`:57-71`), and the tracker exposes
  `resource_throttled()` for UI (`queue.rs:202-204`) — but that accessor
  is marked dead code, and nothing alarms on time-in-state. A gate closed
  for a day (the capacity problem wearing a safety feature's uniform) and
  a gate closed for a minute look identical to every consumer that isn't
  tailing logs.

## The composition seam

The governor deliberately mirrors the tracker's *other* environmental
gate: the module doc says it "mirrors the tracker's existing
`quota_cooldown` admission gate, but driven by system load instead of the
AI provider's rate limit" (`:6-8`). Both gates report into the same
admission verdict (`AdmitResult`), and the admit path logs *which* gate
held (`queue.rs:273-281`) — the one-gate-one-vocabulary composition the
subject's vocabulary technique prescribes, with the governor as one voice
in it rather than a second door.
