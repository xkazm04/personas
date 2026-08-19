---
layer: technique
subject: scheduling
technique: missed-run-semantics
status: forged
laws:
  - failure-not-empty-success
shared_with: []
---

# Missed-run semantics

The process was down — sleep, crash, deploy, laptop lid — and `now` has moved past one
or more `next_run_at` values. The scheduler must now choose, per item, what the past is
worth. There are exactly three coherent policies; the incoherent fourth (whatever the
loop happens to do) is the default in every scheduler that never made the choice.

## The three policies

| Policy | On wake, for each missed due time… | Choose when |
|---|---|---|
| **Skip** | discard it; recompute next-run from `now` | the work is only meaningful at its moment (a "market open" notification at 3pm is noise) |
| **Coalesce** (catch-up-once) | run **one** make-up run, then resume the normal cadence | the work is idempotent state reconciliation — one run repairs any backlog (sync, cleanup, refresh) |
| **Replay** (catch-up-all) | run every missed occurrence, in order, each with its *original* due time attached | each occurrence has independent effect — billing cycles, report periods, per-interval aggregation |

Coalesce is the right default for the majority of periodic maintenance work. Replay is
the rare, expensive one — it must be bounded (see below) and each replayed run must
carry the due time it *represents*, not the time it actually executed, or downstream
consumers aggregate the whole backlog into one bucket.

## Procedure

1. **Make the policy a per-item attribute**, defaulted sensibly, stored with the
   schedule definition. A global constant is a category error: one process schedules
   both "ping every minute" (skip) and "monthly invoice" (replay).
2. **On wake, detect the gap explicitly.** Compare wall-clock `now` against the loop's
   own last-tick heartbeat, persisted each tick. A gap materially larger than the tick
   interval means downtime (or suspend) occurred; record the gap as an event in its own
   right. Silent absorption of a 9-hour gap is a scanner reporting zero findings
   because it never ran (law: failure-not-empty-success).
3. **Apply the policy per item, atomically with the next-run advance — and claim
   before you compute.** The decision "these 4 due times are skipped, one coalesced
   run is minted, next-run is tomorrow 09:00" commits as one state change, then
   dispatch happens. Crash between decision and dispatch loses at most the make-up run
   — it never re-derives a different decision from the same past. When more than one
   actor can perform catch-up (a startup sweep *and* the regular tick are the classic
   pair), the actor must take an atomic compare-and-set claim on the item **before**
   enumerating the missed slots: both actors read the same watermark, so both compute
   the same backlog, and a guard that only protects the final advance runs after both
   have already dispatched the whole backlog once each. The loser of the claim skips
   its attempt entirely and retries next tick.
4. **Record what was decided.** Every skipped occurrence gets a row or log entry
   marked *skipped-due-to-downtime*, distinguishable from *never-due* and from *ran*.
   "Why didn't my 02:00 job fire?" must be answerable with "the process was down
   01:47–06:12; policy skip discarded it" — from data, not from inference.
5. **Bound replay.** Cap by count and by age ("at most 20 occurrences, none older than
   7 days; beyond that, coalesce the remainder and flag it"). An unbounded replay after
   a long outage is a self-inflicted denial of service, and the operator discovering
   400 queued invoice runs has no good options.

## Every skip decides: replayable or consumed

Catch-up computations key off a watermark — "the last due time that actually ran" —
and every *other* part of the scheduler that declines a due slot silently votes on
whether that slot re-enters through catch-up later. Make the vote explicit by keeping
two distinct pointer operations:

- **Advance the schedule pointer only** (watermark untouched) when the skip should be
  *replayable*: the item was outside its permitted window, paused for budget, or held
  by policy. The slot stays inside the catch-up range and comes back under the item's
  missed-run policy.
- **Consume the slot** (watermark advanced too) when the skip is an *intentional
  drop*: an overlap suppression, where the still-running previous occurrence already
  covers the work. Replaying it later would double the very run the suppression
  existed to prevent.

A scheduler with one undifferentiated "skip" primitive gets one of these wrong for
every skip reason it has — either overlap drops resurrect as make-up runs, or
budget-paused work silently vanishes from history.

## The clock-jump corollary

Downtime is only one way `now` jumps. Timezone changes, manual clock edits, and
virtualized suspend/resume produce the same signature — including *backwards* jumps.
The same gap-detection heartbeat covers them: a backwards jump must never fire items
"again" (their due times are re-entered) nor un-fire history. Comparing against
monotonic elapsed time where available, and treating wall-clock regression as a
recorded anomaly rather than a schedule input, keeps a clock edit from becoming a
firing storm.

## Decision rules

- Time-sensitive human-facing output → **skip**. Idempotent reconciliation → **coalesce**.
  Per-period effects with independent value → **replay**, bounded.
- If you cannot say which of the three an item uses, the item uses the fourth policy —
  accident — and the next long weekend will demonstrate it.
- Any policy that runs make-up work must stamp runs with the due time they represent,
  separate from the time they executed.
