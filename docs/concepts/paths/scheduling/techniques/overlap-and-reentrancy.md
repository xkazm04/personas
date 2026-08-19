---
layer: technique
subject: scheduling
technique: overlap-and-reentrancy
status: forged
laws:
  - identity-survives-reuse
  - creation-names-reaper
shared_with: []
---

# Overlap and reentrancy

A run of item X is still executing when X comes due again — because the run is slow,
the interval is short, a manual trigger landed mid-run, or a catch-up policy queued
make-up work. Without a stated policy the outcomes are the worst ones: two writers on
one resource, doubled side effects, and load that compounds each period until something
falls over.

## The policy menu

| Policy | When X is due but running | Choose when |
|---|---|---|
| **Single-flight, drop** | the new occurrence is discarded (recorded as *suppressed-overlap*) | the run reconciles state; the in-flight run already covers the newcomer's work |
| **Single-flight, latest-pending** | at most one occurrence waits; newer arrivals replace it | the run must eventually reflect the *latest* request, but intermediate ones are redundant |
| **Queue** | occurrences line up and execute serially | every occurrence has independent effect and order matters |
| **Concurrent, bounded** | run in parallel up to a per-item limit | occurrences are independent and parallel-safe, and you can prove it |

Single-flight-drop is the correct default for periodic jobs; it composes with the
coalesce missed-run policy into one shape: *at most one runner, at most one waiter*.
Unbounded concurrency is not on the menu — it is the absence of a menu.

## Procedure

1. **Guard at dispatch, in one place.** The reconciliation loop checks the item's
   in-flight state *when it would dispatch*, not inside the job body. Guards inside job
   bodies proliferate, diverge, and miss the manual-trigger path.
2. **The in-flight marker is a claim with an identity, not a boolean.** Record *which
   run* holds the claim (its run id, start time, and holder — process/worker identity
   if more than one can dispatch). A bare `is_running` flag cannot answer "is this
   claim stale?" and cannot be safely cleared (law: identity-survives-reuse).
3. **Every claim names its reaper** (law: creation-names-reaper). Runs end by
   completing, failing, or *being declared dead*: a startup sweep releases claims held
   by previous process incarnations, and a liveness horizon (heartbeat or generous
   timeout) releases claims whose holder vanished without a trace. A claim with no
   reaper is a job that can never run again — the stuck-`running` row is this
   subject's signature leak.
4. **Release and advance atomically.** Completion writes the terminal status, releases
   the claim, and (for completion-anchored schedules) computes the next due time in one
   transition. A crash between "work finished" and "claim released" must resolve on the
   next sweep, in bounded time, without a human.
5. **Reentrancy includes the humans.** The manual "run now" affordance passes through
   the same dispatch guard. If pressing the button twice produces two concurrent runs,
   the guard is decoration.
6. **Reentrancy includes the scheduler itself.** Stop-then-restart of the scheduling
   loop is a reentrancy event: in most async runtimes, dropping the handle to a
   spawned loop does not stop the loop, so a restart leaves the previous incarnation
   ticking beside the new one — every schedule fires twice from then on. A bare
   running-flag cannot fix this (the restart flips it back to true, and the orphan
   reads it as "I'm still current"). The fix is a **generation counter**: bump it on
   every start *and* stop; each loop captures the generation at spawn and self-retires
   the moment a fresh read disagrees. Guard the start transition itself with a
   compare-and-set too — two concurrent starts that both observe "not running" spawn
   two full loop sets, which is the same double-fire by another door.

## Idempotency is the second line, not a substitute

Single-flight makes overlap *rare*; it cannot make it impossible across multiple
dispatchers or crash-recovery races. The job body's defense is idempotency keyed on
durable identity: effects are written as "ensure state S for key K" or deduplicated on
the run id, so the occasional double execution converges instead of doubling. A
scheduler that relies on locking alone is betting the business logic on the lock's
weakest failure mode; one that relies on idempotency alone runs everything twice under
load. Use both, and let the lock carry performance while idempotency carries
correctness.

## Decision rules

- Default: single-flight-drop, with suppressed occurrences recorded (an invisible drop
  is indistinguishable from a scheduler bug — see schedule-observability).
- Choose queue only when you can state why order matters and what bounds the queue.
- Any policy but drop needs a depth limit and an overflow behavior, decided before the
  first overflow.
- If the claim store is shared by multiple processes, the claim write must be an atomic
  compare-and-set; check-then-write across two steps is the race it was meant to fix.
- Decide the guard's failure direction consciously. When the overlap *check itself*
  errors (store unreachable, query failed), fail **open** for work whose double
  execution is tolerable — a rare overlap, absorbed by idempotency, beats silently
  dropping a legitimate fire on a transient hiccup — and fail **closed** only where a
  double run is destructive. Either way, log the degraded check; a guard that fails
  silently in either direction is unmeasurable.
