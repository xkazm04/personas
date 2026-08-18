---
layer: technique
subject: background-jobs
technique: loop-supervision
status: forged
laws: [creation-names-reaper, one-validation-door, identity-survives-reuse]
shared_with: []
---

# Loop supervision

Supervision is the discipline that turns a pile of timers into a runtime. Its
core artifact is the **registration door**: one function every recurring loop
passes through to come into existence, and one roster that afterwards knows
everything that exists. All other guarantees — isolation, telemetry, shutdown,
ownership — are implemented once, at the door, and inherited by every loop
([one door](../../_laws.md#one-validation-door), applied to execution).

## The registration model

A loop registers with, at minimum:

- **A stable name.** The name keys everything downstream: health snapshots,
  log attribution, quarantine decisions, the shutdown report. Names come from
  a single closed set, not free-form strings minted at call sites — two loops
  that accidentally share a name will alias in every one of those systems.
- **A cadence.** Either a fixed interval or an (active, idle) pair — see
  [adaptive-cadence](adaptive-cadence.md). The cadence belongs to the
  registration, not to the loop body; a body that sleeps internally has smuggled
  scheduling decisions past the supervisor and made them invisible to it.
- **A tick body.** The unit of work, written to the tick contract: bounded,
  idempotent across repeats, no assumption about time since the last tick.
- **A stop handle,** created by the supervisor and retained by it. Every loop
  names its reaper at creation
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)); "the process
  will die eventually" is not a reaper, it is a leak with an alibi.
- **An optional first-tick delay.** Startup is the one moment every loop would
  otherwise fire at once, on top of everything else boot is doing; a staggered
  first firing per loop turns the boot stampede into a ramp. The delay belongs
  in the registration, where it is visible, not as a sleep hidden in the body.

Heterogeneity lives inside the tick body; uniformity lives in the envelope.
The supervisor should not care whether a tick polls a queue, expires rows, or
relays events — and precisely because it does not care, it can treat all of
them identically for isolation and health.

## Why the swarm loses

The alternative — each module arms its own timer — fails four ways, and each
failure is invisible until it is expensive:

1. **Shutdown leaks.** Nobody stops what nobody tracks. Orphaned timers keep
   firing into torn-down state, producing the distinctive post-shutdown error
   spray, or keep the process alive when it should exit.
2. **Isolation is per-author.** Each timer callback has whatever error
   handling its author remembered. The crash behavior of the system is the
   minimum of N disciplines.
3. **Health is unknowable.** Without a roster there is no list to check
   liveness against; a silently dead loop is undetectable *by construction*.
4. **Interference is accidental.** N independent clocks produce wake patterns
   nobody designed — synchronized stampedes after a suspend/resume, or a
   steady drizzle that defeats power management.

The moment a system has two recurring loops, the supervisor is cheaper than
the swarm. Retrofitting one later means finding every timer first — the exact
enumeration problem the supervisor exists to make trivial.

## Shutdown ordering

The supervisor owns the stop sequence, and the sequence is ordered, not
broadcast-and-hope:

1. **Close the door.** No new loop registrations, no new ticks dispatched.
   In-flight ticks are now a finite set.
2. **Signal.** Fire every stop handle; propagate cancellation to in-flight
   ticks and to any jobs the runtime hosts (see
   [job-progress-and-cancellation](job-progress-and-cancellation.md)).
3. **Drain, bounded.** Wait for in-flight work up to a grace deadline. The
   deadline is a design constant, not infinity — a shutdown that can hang is
   a shutdown that will be force-killed, which is the worst of both worlds.
4. **Record the cut.** Whatever missed the deadline is abandoned *and named*:
   the shutdown record lists what was interrupted, because that record is the
   first input to the next startup's [sweep](startup-sweeps.md).

**Stop signals must be epochal when the runtime can restart.** A supervisor
that can be stopped and started again within one process lifetime cannot
signal stop through a shared boolean, because the boolean flips back: a loop
whose platform does not forcibly kill its task keeps running after "stop",
checks the flag on its next firing, finds it true again after the restart,
and concludes it is current — yielding two live copies of every loop against
the same state, double-firing everything they touch. The fix is a
**generation counter**: every start mints a new generation, every spawned
loop captures the generation it was born under, and each tick compares its
own captured value against the current one — retiring itself the moment the
world has moved on, regardless of what any boolean says. A boolean answers
"is a runtime running?"; only an epoch answers "am I still *that* runtime's
loop?" — the same reasoning that makes
[identity survive reuse](../../_laws.md#identity-survives-reuse) elsewhere.

## Ownership across processes: the heartbeat claim

Sometimes the same loop could run in more than one process: an old instance
still alive during an upgrade, a detached worker that outlives its parent, a
second launch of the application. The invariant is **at most one live runner
per loop family**, and it must be enforced with a mechanism, not an
assumption.

The standard mechanism is a **heartbeat claim**: the running supervisor
periodically writes a liveness stamp (timestamp plus an owner identity —
process id, instance token) to a shared location both candidates can read. The
protocol:

- **Claim before running.** A candidate checks the stamp; a fresh stamp means
  the loops are owned, and the candidate either stands down or runs in a
  degraded mode that excludes the singleton loops.
- **Staleness has a threshold, and the threshold has slack.** A stamp is
  stale when its age exceeds several missed heartbeats — not one, because a
  single delayed write (a paused machine, a slow disk) must not trigger a
  false takeover. The ratio between heartbeat period and staleness threshold
  is the protocol's tolerance for clock noise; choose it deliberately.
- **Takeover is announced, not silent.** When a candidate claims a stale
  stamp it records the takeover — the previous owner's identity, the stamp
  age — because a takeover is either a normal handoff (old process exited
  uncleanly) or the visible symptom of two instances fighting, and only the
  record distinguishes the two.
- **The loser must actually stop.** If the previous owner is alive but late,
  it will eventually write again; each writer must verify it still owns the
  claim before acting on singleton work (its own identity still in the
  stamp). Writing a heartbeat is cheap; acting without ownership corrupts.

This is a lease, informally held. Where the shared location supports atomic
compare-and-swap, use it; where it does not (a file, a row without
transactions), the verify-before-acting step carries the safety.

## The supervisor is also a loop

Watch the watcher. The supervisor's own liveness — "the dispatch mechanism
ticked recently" — must appear on the health surface like any loop's, because
a dead supervisor over a full roster is indistinguishable from a healthy idle
system in every other signal. The cheapest implementation is honest: the
heartbeat claim above doubles as the supervisor's own pulse.
