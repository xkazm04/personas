---
layer: technique
subject: retry-backoff
technique: backoff-design
status: forged
laws: []
shared_with: []
---

# Backoff design

Backoff answers one question — *how long until the next attempt* — and the answer
serves two masters at once: the caller, who wants the earliest attempt likely to
succeed, and the dependency, which wants pressure removed while it recovers. A
ladder tuned only for the caller (short, fixed delays) keeps the dependency pinned;
one tuned only for the dependency (long, cautious delays) turns thirty seconds of
blip into ten minutes of self-inflicted outage. The design space is small and every
knob has a known failure mode.

## The ladder

The standard shape is a geometric ladder: `delay(n) = min(base × factor^n, cap)`.

- **Base** sets first-retry latency. For interactive paths it is small (hundreds of
  milliseconds) because most transients clear almost instantly; for background work
  it starts where interactive ladders end.
- **Factor** of 2 is conventional and fine. Below ~1.5 the ladder barely sheds
  load; above ~4 it skips the delays most likely to succeed.
- **Cap** bounds the worst case. Without one, rung twelve of a doubling ladder is
  over an hour — at which point the retry is not resilience but a forgotten
  appointment. The cap encodes "beyond this delay, waiting longer adds no
  information"; past it, the ladder is flat. Cap the *exponent*, not just the
  product: `base × 2^n` computed with machine integers overflows or wraps when
  `n` is an unbounded live counter, and a wrapped shift silently resets the
  ladder to its shortest delay at the exact moment the failure streak is
  longest. Clamp `n` before it feeds the arithmetic.
- **Exhaustion is a separate knob.** Max attempts or max elapsed time ends the
  ladder; the cap only flattens it. Conflating the two produces ladders that
  either never end or end before the cap ever matters. The classic disguise is
  the delay table indexed with a clamped index — `steps[min(attempt, last)]` —
  which *reads* like a bound and bounds nothing: the index saturates, the
  attempts do not, and rung four repeats forever while every reviewer sees a
  four-rung ladder. If the ladder has no exhaustion rule, it is an unbounded
  retry wearing a schedule.

## Jitter, or: the herd is the point

A deterministic ladder synchronizes the herd. Every caller that failed at the same
moment — and an outage fails them all at the same moment — computes the same delays
and returns in waves exactly when the dependency tries to stand up. The waves are
the well-known thundering-herd signature: recovery, collapse, recovery, collapse.

Jitter decorrelates the herd. **Full jitter** — draw uniformly from `[0, delay(n)]`
— is the strongest decorrelator and the right default; it trades individual-caller
predictability (which almost never matters) for fleet-level smoothness (which
always does). **Equal jitter** — `delay(n)/2` plus a draw from the other half —
suits the rare case where a floor on the delay is contractual. Jitter applied as a
small percentage wobble (±10%) is cosmetic: callers that failed together stay
together.

Jitter belongs on *every* scheduled delay in the resilience layer, not only ladder
rungs: dependency-stated reset times, breaker cooldowns, and startup reconnects all
synchronize herds in exactly the same way (see storm-control).

## Reset conditions — the subtle knob

When does the ladder return to rung zero? "On success" is the reflex answer and it
contains a trap: if the dependency accepts the connection and then dies — accept,
crash, accept, crash — success-resets snap the ladder back to its shortest delay
every cycle, producing a tight crash loop with the backoff machinery *actively
disabled* by its own reset rule. The system retries fastest precisely when the
dependency is sickest.

The fix is a **minimum-stability window**: the ladder resets only after the
connection or the call pattern has been healthy for a stated duration — long enough
to prove the recovery is real, not just an accepted handshake. Until the window
elapses, a new failure resumes from the previous rung. The same idea appears in the
breaker's half-open state (one probe does not close the breaker until it actually
succeeds; see circuit-breakers) — both are instances of *demand demonstrated
stability before believing in recovery*.

## Decision rules

- **A stated schedule outranks the ladder.** When classification extracted a
  retry-after hint (see error-classification-for-retry), the next attempt honors
  it — plus jitter — and the ladder resumes only if the stated time also fails.
  Backing off exponentially against a limiter that already told you the reset time
  is either too early (banned harder) or too late (capacity wasted).
- **Ladder position is per-key state.** One key per failure domain — per
  dependency, per endpoint, per account — never a single global rung. Too coarse a
  key lets one sick dependency slow retries against healthy ones; too fine a key
  (per request) means no rung ever advances and every failure retries at base
  delay. The key granularity *is* the statement of what you believe fails
  together, and per-key state must be bounded (see storm-control).
- **The ladder needs a total-time budget, not just an attempt count.** Five
  attempts on a capped ladder is a knowable worst-case duration; state it, and
  check it against what the work can tolerate. Work with a deadline shorter than
  the ladder's worst case needs a shorter ladder, not hope.
- **Long delays outlive processes.** Any rung that schedules minutes ahead has
  left the lifetime a process can promise; that rung belongs in a persisted
  retry-at, not a sleeping task (see durable-retries).
