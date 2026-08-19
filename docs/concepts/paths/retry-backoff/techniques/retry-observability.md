---
layer: technique
subject: retry-backoff
technique: retry-observability
status: forged
laws:
  - failure-not-empty-success
  - count-carries-predicate
shared_with: []
---

# Retry observability

Resilience machinery hides things by design — that is its job. A retried failure
never surfaces to the user; an open breaker converts a noisy outage into quiet
refusals; suppression latches eat log lines on purpose. Each mechanism trades
visibility for stability, and the debt compounds: a system with mature retry
machinery and immature observability fails *silently and slowly*, degrading for
weeks behind successful-looking calls until the day the ladders run out all at
once. This technique is the repayment schedule — every mechanism that hides a
failure must emit an account of what it hid.

## The two questions the layer must answer

**"Why is nothing happening?"** — the open-breaker question. Work is submitted,
nothing runs, no errors appear anywhere. This is the worst failure shape the
subject produces, and it is manufactured by exactly three mechanisms: a breaker
denying calls, a budget denying retries, a durable retry-at scheduled far in the
future. All three are *decisions*, and each must be findable as a first-class
answer, not reconstructed from absence of logs.

**"Why did this stop (or never stop)?"** — the post-mortem question, per work
item: how many attempts, on what schedule, ending in which terminal state, decided
by what.

## What to record

1. **Attempt history on the work record.** Each attempt appends: number, time,
   failure class, next scheduled retry-at and *which source computed it* (ladder
   rung vs dependency-stated window). The record reads as a narrative — attempt 3
   of 5, transient, next at T from rung 2 — and the narrative is what turns "it's
   flaky" into a diagnosis.
2. **Terminal states spelled as data** (law: failure-not-empty-success). The four
   endings — succeeded-after-N, exhausted, reclassified-permanent, denied — plus
   the durable-lane enders (superseded, expired) are distinct recorded values.
   *Denied* additionally names its decider: which breaker or which budget. An
   operator must never need source code to distinguish "gave up," "was refused,"
   and "still waiting."
3. **Success under retries is a degradation signal.** A dependency averaging 2.8
   attempts per eventual success has a 100% success rate on every naive dashboard
   and is three failures away from an outage. Attempts-per-success per dependency
   is the leading indicator this layer uniquely owns — nothing downstream can see
   it, because hiding it is precisely what the layer does. First-attempt success
   rate says the same thing upside down; expose either, watch it trend.
4. **Breaker state is an operator surface, not an internal variable.** Per
   breaker: current state, what tripped it (the evidence, not just "failures"),
   open-since, cooldown-until, denials since opening, last probe outcome. State
   *transitions* are logged loudly — open and close are rare, significant, and
   exactly what the warn-once latch (see storm-control) preserves room for.
   Denials themselves are counted, not individually logged.
5. **Suppressed volume rides the summary** (law: count-carries-predicate). Every
   counter this layer emits carries its predicate and window — "41 attempts
   suppressed for key K since the breaker opened at T," never a bare 41. The
   suppression counters are the only surviving witnesses of hidden volume; a
   summary line without them reports an episode with the middle missing.

## Decision rules

- **Aggregate by failure-domain key, drill down by work identity.** The fleet
  view (per dependency: attempt rate, attempts-per-success, breaker state, budget
  consumption) is where degradation shows; the per-item narrative is where one
  stuck delivery gets explained. Both hang off identities the layer already keeps
  — the breaker key and the work id — so neither costs new bookkeeping.
- **Expose the pending schedule.** "What is due to retry in the next hour" is a
  query against the durable retry-at store (see durable-retries), and it is the
  difference between *knowing* the backlog will land at 09:00 and discovering it.
- **The retry lineage must contain only retries.** The parent-link that chains
  attempt to attempt is an attractive place to hang *any* "run again" feature —
  continuations, reruns, manual re-drives — and every borrowed use silently
  pollutes every retry metric built on it (attempt counts, success-after-retry
  rates, spend attribution). Mint a different relation for things that are not
  retries.
- **A dead-letter lane with zero lifetime arrivals is a mechanism, not a
  guarantee.** If the exhaustion path has never once been traversed, nothing
  distinguishes "our retries always succeed" from "the transition to terminal
  is broken and exhausted work loops or vanishes." Drive one poison item
  through it on purpose, in a test, and alarm if the lane's arrival count and
  the exhaustion count ever diverge.
- **The dashboards' empty state must be distinguishable from a dead collector.**
  Zero retries because everything is healthy and zero retries because the counter
  pipeline broke are different facts; the layer that exists to distinguish
  failure from silence owes its own telemetry the same courtesy.
- **Alert cadence is not this technique's job.** What gets recorded and surfaced
  is decided here; how often a human is *paged* about it belongs to the
  suppression discipline in scheduling's cooldown-and-debounce. Keeping the split
  clean prevents the classic inversion — tuning alert cooldowns by deleting the
  underlying counters.
