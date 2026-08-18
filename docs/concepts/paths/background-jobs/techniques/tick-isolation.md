---
layer: technique
subject: background-jobs
technique: tick-isolation
status: forged
laws: [failure-not-empty-success, deletion-is-not-repair]
shared_with: []
---

# Tick isolation

A supervised runtime hosts many loops written by many hands over many years.
Tick isolation is the envelope that makes the runtime's failure model
independent of the quality of any one tick body: **one bad tick costs one
tick, never the loop, never the runtime.** The envelope has four layers, and
each answers a different failure.

## Layer 1: crash capture

The tick body runs inside a barrier that catches the platform's unit of
sudden death — an uncaught exception, a panic, an abort short of
process-fatal. The barrier's obligations:

- **The loop survives.** A crash marks the tick failed and the loop schedules
  its next tick normally (or enters backoff — layer 4). The alternative — a
  crash silently unhooking the loop — creates the worst diagnostic in the
  genre: a loop that ran fine for weeks, died on one malformed row, and
  stopped doing its job with no signal at all.
- **The crash is recorded as a crash.** Distinct from a handled error, which
  is distinct from an empty success
  ([failure ≠ empty success](../../_laws.md#failure-not-empty-success)). The
  health snapshot for that tick carries the failure and its message; a loop
  whose ticks fail 100% of the time while the runtime reports green has
  isolation without telemetry, which is a padded cell with no window.
- **Capture is the envelope's job, not the body's.** Tick authors write
  ordinary error handling for expected errors; the barrier exists for the
  unexpected. Requiring every body to be crash-proof is the per-author
  discipline the supervisor was built to replace.

One boundary is honest to state: some deaths are not catchable (out-of-memory
kills, stack exhaustion in some environments, the process being terminated).
Isolation reduces the fatal surface; it cannot make the runtime immortal.
That residue is one of the reasons [startup sweeps](startup-sweeps.md) exist.

## Layer 2: re-entrancy guard

Cadence and duration are independent, so eventually a tick will still be
running when its next firing comes due. Without a guard, overlapping ticks
stack: same work claimed twice, double-processing, and — under sustained
slowness — an unbounded pileup of concurrent copies that turns one slow
dependency into resource exhaustion.

The guard is a per-loop in-flight flag checked at dispatch: if the previous
tick is live, the new firing is **skipped, and the skip is recorded**. The
record matters as much as the skip — a loop that silently skips 90% of its
firings is a loop whose effective cadence is a lie, and only the skip count
reveals it. Persistent skipping is a signal to fix the tick's duration or
lengthen its cadence, not a normal operating mode.

Skipping (drop the firing) is almost always right for ticks, because a tick's
contract is idempotent recurrence — the next firing will cover the same
ground. Queueing the missed firing re-introduces the pileup with a delay.
The related-but-different question — whether two *scheduled occurrences* of a
recurring rule may overlap, and what a deliberate concurrency policy looks
like — belongs to scheduling's overlap-and-re-entrancy treatment
(see [scheduling](../../scheduling/scheduling.md)); this guard is the
runtime's floor under whatever policy is chosen above it.

## Layer 3: the per-tick deadline

A tick that never returns is worse than one that crashes: it holds the
in-flight flag forever, which — through the re-entrancy guard — silently
converts a hang into a permanently skipped loop. Every tick therefore runs
under a deadline generous against the tick's honest worst case (a deadline
that fires on legitimate slow days trains everyone to ignore it).

What the deadline does on expiry depends on what the platform allows.
Cooperative cancellation (signal the tick, let it unwind) is the clean form.
Where the work cannot be interrupted, the honest fallback is **abandonment
with attribution**: mark the tick timed-out in the health record, release the
loop for future firings *only if* the abandoned work cannot corrupt shared
state, and otherwise leave the loop parked-and-flagged — visibly wedged
rather than silently wedged. The unacceptable option is the silent one.

## Layer 4: quarantine after repeated failure

Crash capture makes a permanently broken tick survivable — and therefore easy
to ignore: fail, wait, fail, forever, each cycle burning resources and
spamming the failure channel. The envelope tracks **consecutive failures per
loop** and responds with escalating backoff (stretch the cadence after N
straight failures) and, past a higher threshold, **quarantine**: the loop is
parked, prominently flagged on the health surface, and revivable by an
explicit operator action or a process restart.

Two disciplines keep quarantine honest:

- The thresholds are per-loop-visible, and a quarantined loop is *loud*.
  Quarantine is triage, not resolution — parking a loop and forgetting it is
  [deleting the artifact that exposes the defect](../../_laws.md#deletion-is-not-repair)
  in slow motion.
- Success resets the counters. A loop that fails nightly at 03:00 against a
  rebooting dependency and succeeds all day should oscillate in backoff, not
  ratchet into quarantine.

## The composed envelope

Order matters, and the correct nesting is: deadline outside, crash barrier
around the body, re-entrancy checked at dispatch before either, failure
accounting updated in every exit path — success, handled error, crash,
timeout, skip. Five exits, five distinct marks in the tick record. Every one
of the classic supervised-runtime bugs is one of these exits going
unrecorded.
