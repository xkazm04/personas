---
layer: technique
subject: delivery-guarantees
technique: retry-escalation
status: forged
laws:
  - count-carries-predicate
  - deletion-is-not-repair
shared_with: []
---

# Retry escalation

An attempt failed. The [retry-backoff](../../retry-backoff/retry-backoff.md)
subject owns what happens next in *time* — whether this failure class retries
at all, and how long the wait is (jittered, laddered:
[backoff-design](../../retry-backoff/techniques/backoff-design.md)). This
technique owns what happens next in *count*: the persisted attempt counter,
the threshold that bounds it, and the state transition that fires when the
bound is crossed. The two compose into one sentence: **backoff decides when
the next attempt happens; escalation decides that there is a last one.**

## The counter is persisted, incremented on every attempt, by every path

The attempt count lives on the event row — not in a worker's memory (dies
with the worker, which is precisely when it mattered), not derived from log
archaeology. And *every* consumption of an attempt increments it:

- handler returned failure — the obvious increment;
- worker crashed mid-processing and the reaper requeued — the forgotten one.
  A reaper that requeues without incrementing creates events that crash
  forever while their counter reads zero (see stuck-reaping);
- attempt aborted by shutdown, cancelled by timeout — still attempts; the
  event consumed a slot of the system's willingness.

The counter also carries its predicate (law: count-carries-predicate):
*attempts of what?* Redelivery from upstream, after deduplication, must not
re-increment a counter that means "our processing attempts" — otherwise a
chatty sender exhausts an event's budget without a single handler failure.
Conversely, if the pipeline distinguishes crash-reaps from clean failures
(worth doing — they triage differently), either count separately or record
the kind alongside; a single number summing unlike things supports no later
claim about what went wrong.

## The threshold is a transition, not a comparison

The bound exists as a state change: when attempts reach the limit, the event
*moves* — out of the retry cycle, into the dead-letter lane, with the final
failure attached (see dead-letter-design). The defining anti-pattern of this
technique deserves its full statement:

> **A retry counter that increments forever is a dead letter without the
> letter.** The failure is just as permanent — the event will never succeed —
> but nothing marks it, nothing surfaces it, and the system spends real
> resources on attempt 40,000 while the operator believes the pipeline is
> healthy. Unbounded retrying is not persistence; it is a slow leak of
> compute wrapped around a silent loss of the event.

Three refinements on the threshold:

- **Permanent failures escalate immediately.** When failure classification
  (owned by
  [error-classification-for-retry](../../retry-backoff/techniques/error-classification-for-retry.md))
  says the failure cannot heal — malformed payload, rejected authorization,
  a target that no longer exists — the remaining budget is worthless.
  Escalate at attempt one; spending the full ladder on a permanent failure
  delays the human who could actually fix it.
- **The budget is per event class.** A cheap idempotent recomputation can
  afford ten attempts; an amplifying handler whose retries have side costs
  wants two or three. One global constant is either waste or recklessness,
  class by class.
- **An elapsed-time bound backs the count.** Attempts × maximum backoff can
  stretch a small count across days; for events whose value expires, a
  deadline ("no attempts after T") escalates staleness on its own, whatever
  the counter says. Escalation by staleness records a different reason token
  than escalation by exhaustion — the triage differs (see
  non-delivery-ledgers).

## Escalation preserves; it never destroys

The transition to dead-letter carries the event's full context forward:
payload, identity, attempt history, the final error verbatim. Escalation that
truncates — keeping a count but dropping the payload, keeping an error string
but losing which attempt produced it — converts a triageable record into a
tombstone (law: deletion-is-not-repair; discarding the evidence of a failure
is not handling the failure). The rule of thumb: the dead-letter record must
contain everything a human needs to decide *retry or discard* without
consulting a second system, because the second system's retention will have
expired by the time anyone looks.

## Decision rules

- **Escalation is the pipeline's decision, not the operator's default.** The
  threshold fires automatically; the operator's role begins at the triage
  surface. A design where humans must notice a high counter and manually
  move the event has a dead-letter lane staffed by hope.
- **Reset the counter only across an operator retry.** When a human
  re-queues a dead-lettered event after fixing the cause, that is a new
  campaign and the count restarts — but the record keeps its lineage (this
  is redrive attempt two of an event dead-lettered once before; a repeat
  offender is a signal). Automatic resets — on deploy, on restart, on
  partial success of a batch — quietly convert the bound back into infinity.
- **Watch the aggregate, not just the individual.** One event at the
  threshold is routine; a cohort marching toward it together is an outage in
  progress. Escalation *rate* is the pipeline's leading health indicator,
  and it belongs on the same surface as the reaper's counts.
