---
layer: golden-path
subject: scheduling
status: forged
techniques:
  - next-run-computation
  - missed-run-semantics
  - overlap-and-reentrancy
  - trigger-matching
  - cooldown-and-debounce
  - schedule-observability
evidence:
  - src-tauri/core/src/scheduler.rs          # next-run computation: one tz policy, anchored intervals, bounded slot enumeration
  - src-tauri/src/engine/background/       # reconciliation tick, overlap skip-with-signal, backfill claims, EventGateLedger
counter_evidence:
  - src/features/triggers/lib/eventReason.ts # non-fire reason vocabulary hand-duplicated from the backend enum ("keep in sync")
deviations:
  - scheduling-dup-nonfire-vocab      # anchors in docs/concepts/golden-path-deferred-fixes.md
  - scheduling-tz-fallback
  - scheduling-claims-without-identity
  - scheduling-subscription-health-volatile
---

# Scheduling & triggers

A long-running application accumulates work that must happen *later* or *when something
else happens*: periodic maintenance, user-defined recurring jobs, reactions to events,
threshold alarms. The subject of this path is the machinery that decides **when work
fires, exactly how many times, and how anyone finds out why** — which is a different and
harder problem than the work itself.

## The core stance: a scheduler is a reconciliation loop, not a pile of timers

The naive design sets one timer per scheduled item at registration time ("fire in 3,600
seconds"). It fails on every axis a real system cares about: timers die with the process,
drift with suspend/resume, multiply on re-registration, and leave no queryable record of
what is pending. Every mature scheduler converges on the same alternative:

> **Store the schedule as durable data. Run a loop that periodically compares
> `now` against each item's persisted `next_run_at` and fires whatever is due.**

The consequences of that stance are the spine of this subject:

1. **The schedule is state, not control flow.** Each schedulable item persists its
   definition (the recurrence rule or the subscription), its computed `next_run_at`,
   its `last_run_at`, and its enabled/disabled flag. Restart recovery is then free:
   the loop wakes, reads the table, and continues. Nothing about "what should happen
   next" lives only in memory.
2. **Firing is a state transition, not a callback.** When an item comes due, the loop
   records the run (with a minted run identity), advances `next_run_at` by recomputing
   it from the rule (see next-run-computation), and only then dispatches the work.
   Advancing *before* dispatch is deliberate: a crash mid-dispatch produces at most one
   lost run, never an infinite refire of the same due moment.
3. **The tick is cheap and dumb; the intelligence is in the data.** The loop's cadence
   bounds firing latency (a 30-second tick means jobs fire up to 30 seconds late) but
   carries no per-item logic. Precision requirements change the tick interval, not the
   architecture.
4. **Every fire decision is explainable after the fact.** Because due-ness is computed
   from persisted state, "why did this fire at 09:00:14" and "why didn't this fire at
   all" are answerable by replaying data — the property the schedule-observability
   technique builds on. A scheduler whose decisions cannot be reconstructed will consume
   its operators' trust one silent non-fire at a time (law: failure-not-empty-success).

## The trigger taxonomy

Four trigger families cover practice. They share the firing pipeline but differ in what
arms them:

| Family | Armed by | Fires when | Canonical hazards |
|---|---|---|---|
| **Clock** | a recurrence rule (cron-style expression, fixed interval, one-shot at a timestamp) | the reconciliation loop finds `next_run_at <= now` | timezone/DST math, missed runs across downtime, drift |
| **Event** | a subscription (event kind + optional filter) | a matching event is published | routing correctness, fan-out amplification, ordering |
| **Condition** | a predicate over observed state ("queue depth > N", "no heartbeat for 5m") | evaluation flips false→true | re-fire storms while the condition stays true — edge vs level distinction |
| **Manual** | nothing — a human or an API call | on demand | must still flow through the same pipeline so it gets a run identity, overlap protection, and a log entry |

Two rules cut across the taxonomy. First, **condition triggers are edge-triggered by
default**: fire on the transition into the bad state, then arm a cooldown, or the
evaluator becomes a siren (see cooldown-and-debounce). Second, **manual triggers are not
a bypass**: the "just run it now" button enters the same dispatch path as the clock, or
it silently escapes overlap guards, run history, and rate limits — and the one run
nobody can explain later is always the manual one.

## Durability across restarts

The restart is not an edge case; for a desktop-class or frequently deployed application
it is the *common* case. The contract:

- **Schedule definitions and `next_run_at` survive** — they are rows, not timers.
- **On wake, the loop must decide what to do about the past**, because `now` may be far
  beyond several `next_run_at` values. That decision — run everything missed, run once
  and coalesce, or skip to the future — is per-item policy, never a global accident of
  implementation (see missed-run-semantics).
- **In-flight runs interrupted by the crash need an owner.** A run row stuck in
  `running` forever is the scheduler's equivalent of a leaked resource; startup must
  sweep and mark them (law: creation-names-reaper).
- **Run identity survives the restart** (law: identity-survives-reuse). A run minted
  before the crash and observed after it is the same run; dedup, logs, and downstream
  effects all key on that identity, never on (job, timestamp) pairs that reuse and
  collide.

## Exactly-how-many-times

"Exactly once" is not achievable across crashes without distributed-transaction
machinery few applications can justify; the honest contract is **at-most-once or
at-least-once per due moment, chosen per item and stated**. The scheduler's job is to
make the choice explicit and to keep the multiplicity small and observable:

- concurrency of the *same* item is governed by single-flight policy
  (overlap-and-reentrancy);
- multiplicity of *reactions* to one event is governed by the routing layer
  (trigger-matching);
- multiplicity of *alerts* about one persisting condition is governed by suppression
  windows (cooldown-and-debounce).

## What "done" looks like for this subject

A scheduling layer meets the bar when an operator can, without reading source code:
list what is armed and when each item next fires; see for any past window what fired,
what was skipped, and *why* in both cases; restart the process with no lost schedule and
a stated policy for the gap; and trust that a firing storm — from a mis-authored rule, a
flapping condition, or an event loop — will be dampened by design rather than by
hotfix.
