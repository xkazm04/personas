---
layer: technique
subject: scheduling
technique: schedule-observability
status: forged
laws:
  - failure-not-empty-success
  - gate-sees-target
shared_with: []
---

# Schedule observability

The defining support question for any scheduler is not "why did this crash" — crashes
leave evidence. It is **"why didn't this fire?"** — and the naive scheduler answers it
with nothing, because not-firing, by construction, executes no code and writes no bytes.
Observability for scheduling is therefore designed backwards from the silences: every
decision *not* to run must leave the same quality of evidence as every run (law:
failure-not-empty-success).

## The four surfaces

1. **The forward ledger — what will happen.** For every armed item: its rule as
   authored, its computed next-fire time, its enabled state, and its current
   suppression state (in cooldown until T / waiting on debounce / claim held by run R).
   This surface answers "is my job even armed?" before anything has gone wrong, and it
   doubles as the smoke test for next-run computation — a wrong next-fire time is
   visible here days before it misfires.
2. **The run ledger — what happened.** One record per run, keyed by minted run id:
   which trigger caused it (clock due-time / event id / condition transition / manual +
   actor), the due time it *represents* vs when it actually started, terminal status,
   duration, and outcome summary. The causing-trigger field is the join point that
   makes "this event produced these runs" and "this run exists because of that rule"
   traversable in both directions.
3. **The non-fire ledger — what deliberately didn't happen.** Every decision point that
   can swallow an occurrence writes a reason: *disabled*, *filtered* (which filter),
   *suppressed-overlap* (which claim), *in-cooldown* (which window, current count),
   *skipped-downtime* (which gap, which policy). This is the surface the whole
   technique exists for; it can only be written at decision time, by the decider —
   reconstructing it later re-runs the logic against state that has moved.
4. **The liveness signal — is the scheduler itself alive.** The reconciliation loop
   persists a heartbeat each tick. Monitoring compares the heartbeat against `now`;
   every other surface is meaningless if the loop is dead, and a dead loop is the one
   failure the loop cannot log. The check must read the heartbeat the loop actually
   writes — not a process-exists proxy (law: gate-sees-target): a live process with a
   wedged loop is precisely the case the proxy passes and the target fails.

## Procedure

1. **Attach cause at dispatch, not in the job.** The dispatcher knows the trigger; the
   job body does not. Threading a cause descriptor into the run record at creation is
   cheap; recovering it afterwards is archaeology.
2. **Distinguish the three silences.** "Never due" (rule says so), "due but declined"
   (non-fire ledger has the reason), and "due but unseen" (loop dead or gap in
   coverage) must be three different query results. The first is health, the second is
   policy, the third is an incident.
3. **Bound the ledgers at design time.** Run and non-fire records are the scheduler's
   own high-frequency data; give them retention rules the day they are created —
   the observability layer must not become the disk-space incident it was built to
   explain. Aggregate before deleting: per-item counters (fires, suppressions, failures
   per window) survive after individual records rotate.
4. **Expose next-fire and last-outcome where the item is edited.** The author staring
   at a rule needs "next: Tue 09:00; last: failed 4m ago" in the same view — round
   trips to a separate log turn a ten-second self-service check into a support ticket.
5. **Alert on schedule health from the outside.** "Item X has not succeeded in N
   periods" and "loop heartbeat stale" are conditions evaluated by something other
   than the loop being judged. The scheduler cannot be the sole monitor of itself.

## Decision rules

- If an occurrence can be swallowed at a decision point and that point writes no
  record, the point is not done — the empty log after an incident is this technique's
  definition of failure.
- Prefer one run ledger with a cause column over per-trigger-family logs; the first
  real investigation spans families ("did the manual run I clicked suppress the
  scheduled one?").
- The forward ledger is computed from live state on demand; the run and non-fire
  ledgers are append-only history. Mixing the two (mutating history to reflect current
  state) destroys the only record of what was believed at decision time.
- Every count displayed carries its predicate and window ("14 suppressed in the last
  hour"), or it will be read as a lifetime total and actioned wrongly.
