---
layer: technique
subject: retry-backoff
technique: durable-retries
status: forged
laws:
  - identity-survives-reuse
  - creation-names-reaper
shared_with: []
---

# Durable retries

Retry state has a lifetime, and the lifetime is a design decision most systems make
by accident: whatever the retry loop holds in memory dies with the process. For an
in-flight interactive request that is correct — the user's intent died with the
session too. For everything else, the accident has two faces. Work face: the
pending retry of a delivery, a sync, a provisioning step simply evaporates, and
nothing ever runs it. Memory face: the ladder positions, breaker states, and
"stop until Thursday" verdicts all reset to optimism, so **a restart reads as a
recovery** — the process wakes believing every dependency is healthy and every
ladder is at rung zero, and opens with a burst of the exact traffic the
pre-restart state existed to suppress. Deploys correlate with incidents; the
incident is when restarts happen most.

## The durable form: a persisted retry-at schedule

The durable retry is a row, not a sleeping task:

> work identity · attempt count · next retry-at · last failure class · terminal
> state (if any)

A persisted retry is thereby a scheduled item, and it deliberately joins the
scheduling subject's discipline — a reconciliation loop compares retry-at against
the clock and fires what is due — rather than growing a second, private timer
system. Division of labor: scheduling owns the loop, its tick, and what happens to
schedules missed across downtime; *this* technique owns what goes **into** the row
(how retry-at was computed, what the attempt count means) and how the row **ends**.

## Procedure

1. **Persist at the failure boundary.** The transition "attempt failed, will retry
   later" writes the row in the same step that records the failure — not when a
   background sweep notices the work is stale. A retry that exists only as an
   intention is not durable; a retry that exists as a row survives anything short
   of losing the store.
2. **Compute retry-at from the ladder — or from the dependency's own statement.**
   The row's retry-at is `now + jittered delay(attempt_count)` (see
   backoff-design) *unless* classification extracted a stated reset time — a
   rate-limit window, a quota that refills at a known instant, a maintenance
   horizon. A stated time is written as-is, plus jitter, even when it is hours
   out: that is knowledge, and the whole point of durability is that a schedule
   hours out survives the processes in between. Record *which* of the two sources
   produced the retry-at; when the schedule looks wrong later, the first question
   is whose schedule it was. **Stated times have a horizon**: a reset hours away
   is a schedulable retry; a cap that refills next week is not — beyond the
   horizon of what auto-retry can usefully bridge, the honest move is a terminal
   state surfaced to a human, not a row that haunts the schedule for seven days.
3. **Attempt count lives in the row and only the row.** The rung of the ladder is
   derived from persisted attempts, never from a parallel in-memory counter that
   restarts erase. This is what makes the ladder itself durable: attempt six after
   a restart is still attempt six.
4. **Identity survives the schedule** (law: identity-survives-reuse). The row
   carries the *work's* identity, minted once when the work was first accepted —
   not a fresh id per attempt, and never a (work, timestamp) pair. Everything
   downstream — dedup, idempotency checks, log correlation, "is this already
   pending?" queries — keys on that identity across all attempts and restarts.
   Retrying non-idempotent work without a stable identity to dedup on is not a
   retry; it is a duplicate with a delay.
5. **Every row names its reaper** (law: creation-names-reaper). Three enders,
   all explicit: *exhaustion* (attempts or elapsed-time budget spent → terminal
   failed state, surfaced to a dead-letter lane an operator actually reviews);
   *supersession* (the underlying work was cancelled, replaced, or completed by
   another path → the pending retry is swept, or it will faithfully re-execute
   something nobody wants); *expiry* (a staleness bound relative to when the work
   mattered — retrying a "device just connected" reaction two days later is not
   resilience, it is a haunting). A retry table with no reaper is a queue that
   only grows, and it grows fastest during outages.

   **Durability and boundedness are the same design step.** The persisted retry
   is the only kind that can run for months, so the budget and the terminal
   state ship in the same change as the persistence — never as a follow-up. The
   recurring field failure has one shape: a well-built durable ladder, restart-
   proof and atomic, whose author never wrote the third number (what happens
   when it stops), discovered a season later still faithfully retrying a
   credential that was revoked in the spring. And the ending must be **this
   subsystem's own decision**: a retry that stops only because a staleness
   filter in a neighboring concern quietly excluded its input has not
   terminated — it has been orphaned, its terminal flag unset, its failure
   unreported, and it resumes the moment the neighbor's threshold moves.
6. **Claim before dispatch, and re-check the budget at dispatch.** The loop that
   fires a due row consumes it (delete or CAS-claim) *before* spawning the work
   — a retry that fails to spawn must not re-fire every tick — and re-reads the
   live attempt count rather than trusting the one persisted with the schedule,
   because the world may have retried, cancelled, or completed the work through
   another path since the row was written. Claim-by-consume makes the durable
   lane at-most-once per due moment; if the work class needs at-least-once,
   that is a stated choice with a different claim shape, not an accident.

## Decision rules

- **Durability class is declared per work type, not discovered per incident.**
  The honest default: user-interactive attempts are in-memory and die with the
  session; anything a user would expect to *eventually happen* — deliveries,
  syncs, provisioning, notifications — is a row. Writing the decision down is the
  deliverable; either answer can be right.
- **Terminal states are spelled, not implied.** A row that stops being retried
  carries *why* — exhausted, reclassified permanent, superseded, expired — as
  data. Distinguishing "gave up" from "done" from "still waiting" must not
  require archaeology (see retry-observability).
- **Breaker state gets the same treatment, with a freshness bound.** Persisted
  breaker state rehydrates on startup so the restart doesn't reset the system's
  beliefs — but stale state is discarded past a TTL, because yesterday's open
  breaker is not evidence about today. Durable memory with an honesty horizon.
- **Wake-up is a stampede risk.** After long downtime, many rows are
  simultaneously due; releasing them all at once aims the accumulated backlog at
  dependencies that may themselves be freshly recovering. Due-work release is
  paced and jittered (see storm-control), and the missed-run policy question —
  run all, coalesce, or skip — is answered per work type by the scheduling
  subject's missed-run semantics.
