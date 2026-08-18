---
layer: technique
subject: subprocess-lifecycle
technique: host-resource-protection
status: forged
laws: [gate-sees-target, count-carries-predicate, deletion-is-not-repair]
shared_with: []
---

# Host resource protection

The host is a long-lived program with users, state, and siblings; a child
is one operation's disposable worker. When the two compete for the
machine, the design must already have chosen: **the host survives its
children.** A host that lets one child's appetite take down the process —
or degrade the machine until the host cannot respond — loses every other
child, every queued request, and the user's trust in the same instant.
This technique owns the ceilings, the pressure gates, and the budgets that
make the choice structural.

## Timeouts are ceilings, not estimates

Every run is admitted under a **hard timeout**, and the number is a
*ceiling*: generous, per tool class, chosen to be crossed only by runs
that are genuinely wrong. The distinction matters because the two framings
fail differently:

- A timeout tuned as an *estimate* ("this usually takes 40 seconds, allow
  60") kills honest work at the tail of its natural distribution, and the
  fix-of-the-day becomes nudging the number upward forever.
- A timeout as a *ceiling* ("no legitimate run of this class exceeds ten
  minutes") almost never fires — and when it does, it is evidence, not
  noise.

When the ceiling fires, the standard
[termination ladder](termination-and-reaping.md) runs, and the outcome is
recorded as *exceeded-ceiling* with the ceiling's value — never as a
generic failure, because the operator's first question will be "against
what limit?" ([count-carries-predicate](../../_laws.md#count-carries-predicate):
a timeout without its configured value is a number without a predicate).
Progress-aware extensions — a run that is demonstrably producing may earn
more time — are legitimate, but they extend from the liveness evidence
([liveness-and-heartbeats](liveness-and-heartbeats.md)), never from hope,
and they extend toward a second, absolute ceiling, or the first stall that
also stops producing evidence holds a slot forever.

**Nested deadlines are ordered, deliberately.** A child often has its own
internal timeout (a network request budget, a tool-level deadline) beneath
the host's kill ceiling. If the two are set independently, the outer one
fires first by accident on some machines — and the child is killed
mid-flight instead of surfacing its own, far more informative timeout
error. The rule: derive the inner deadline *from* the outer one, minus a
margin wide enough for the child to fail cleanly and say why, with a floor
so a misconfigured tiny ceiling cannot drive the inner budget to zero. One
subtraction at the spawn door buys every timeout a diagnosis instead of a
corpse.

## Admission consults the machine

Slot caps bound *how many* children run; they say nothing about whether
the machine can afford **this one now**. A loaded machine — memory
pressure from an unrelated tool, the host's own heavy phase — turns an
in-cap spawn into the marginal straw. So the admission gate samples **real
machine signals** (memory pressure, processor saturation) at spawn time
and defers new admissions while the machine is over threshold.

Two disciplines keep this gate from becoming its own failure mode:

- **Measure the machine, not the bookkeeping**
  ([gate-sees-target](../../_laws.md#gate-sees-target)). The gate's input
  is the platform's account of actual pressure — not the host's ledger of
  what its own children *should* be using, which is blind to every other
  tenant of the machine and to children whose real usage diverges from
  their class profile.
- **Hysteresis, or the gate flaps.** A single threshold read on a noisy
  signal admits, defers, admits, defers at the boundary — queue latency
  oscillates and every measurement blip becomes user-visible. The gate
  opens below a low-water mark and closes above a high-water mark, with
  the band between them sized to the signal's noise; entering and leaving
  the deferred state are both logged events, so "spawns were slow this
  afternoon" has a findable cause. And the gate honors
  [assert-the-instrument](../../_laws.md#failure-not-empty-success) in
  miniature: a sampler's first reading, or any reading it marks invalid,
  is skipped — acting on a bogus zero is worse than waiting one interval.
- **Thresholds are per-signal, because the signals mean different
  things.** High memory occupancy is often healthy (a platform keeping
  caches warm) right up to the cliff where it is fatal, so its pause bar
  sits high; processor spikes are transient and recoverable, so its bar
  sits lower with the hysteresis absorbing the noise. One uniform
  percentage across unlike signals encodes a claim about the machine that
  is false for at least one of them.

Deferral is queueing with honesty: the queued requester is told *why*
(machine pressure, not cap), because the two conditions have different
remedies and different owners.

## Budgets are per-child

Machine-level gates catch aggregate pressure; **per-child budgets** catch
the one bad actor before it becomes aggregate pressure:

- **Memory** — a child class carries an expected envelope; a child
  observed far outside it is terminated by policy while the machine is
  still healthy.
- **Scratch disk** — the run's private directory has a growth bound;
  unbounded scratch growth is the leak that survives reboots.
- **Output volume** — bounded upstream by the stream machinery's budgets
  ([streaming-output](../../streaming-output/streaming-output.md) owns
  those buffers); this technique's concern is only that a child producing
  pathological volume is a *termination candidate*, not merely a
  truncation candidate.

A budget kill is an outcome in the closed vocabulary with the budget and
the measured value attached — the record that lets the class profile be
corrected if the budget, not the child, was wrong.

## Shedding order is designed

Under sustained pressure the host sheds load in a deliberate order, and
the order is written down before the incident, not improvised during it:

1. **Idle warmth first** — pooled warm sessions
   ([session-reuse](session-reuse.md)) cost latency to rebuild, nothing
   else.
2. **Queued work next** — defer admissions; nothing running is harmed.
3. **Running children last, newest first** — killing running work
   destroys value; when it must happen, prefer the run that has invested
   the least, and let the ladder and the record do their normal jobs.
4. **The host, never.** There is no rung where the host sacrifices its
   own responsiveness to keep children alive.

One anti-pattern deserves its name: responding to recurring pressure by
**removing the instruments** — widening every ceiling to infinity,
disabling the admission gate, silencing the budget kills — because the
alerts were noisy. That is
[deleting the artifact that exposes the defect](../../_laws.md#deletion-is-not-repair):
the pressure remains, and the next symptom is the host's own death, which
has no alert because the alerting process died with it. Noisy protection
is re-tuned from the ledger's evidence; it is not turned off.
