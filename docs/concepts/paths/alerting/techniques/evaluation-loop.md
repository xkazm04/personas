---
layer: technique
subject: alerting
technique: evaluation-loop
status: forged
laws:
  - gate-sees-target
  - failure-not-empty-success
shared_with: []
---

# The evaluation loop

Rules do not evaluate themselves. Somewhere a loop wakes on a cadence, loads
the enabled rules, computes each rule's signal over its window, compares,
and fires. The loop is the most boring component in the subject and the one
whose placement errors are the most expensive, because every error is
systemic: a mistake here does not break one rule, it breaks the *contract*
that enabled rules are being watched.

## The loop's lifetime is the system's lifetime

The evaluator runs **because alerting is on, not because anyone is
looking**. Mounting the loop inside a monitoring screen — the natural first
implementation, since that screen already has the data — creates a system
that only watches while it is being watched: alerts fire when the operator
happens to have the dashboard open and sleep otherwise, which is precisely
backwards. The loop is anchored to the application or service lifetime, in
a component or process that exists exactly once and always. If the host
platform makes "exactly once and always" nontrivial (multiple windows,
worker restarts, hot reloads), the singularity is engineered explicitly —
because two live loops is the double-fire problem described in
[dedup-and-cooldown](dedup-and-cooldown.md).

## A private window: the viewed filter must not skew evaluation

The subtlest loop bug: sharing data with a display surface. A dashboard
holds metrics filtered by whatever the user is currently viewing — a time
range, a subset of sources, a search. If the evaluator reads that same
in-memory series, then **changing a chart filter changes what the alert
rules see**, and a rule can be silenced by scrolling. The loop maintains or
fetches its **own** window per signal — sized by the rules' needs, immune
to view state — and the fact that this duplicates a little memory or a
query is the price of the gate seeing its target
([gate-sees-target](../../_laws.md#gate-sees-target)). The display window
answers "what does the user want to look at"; the evaluation window answers
"what is true"; these are different questions with different owners.

## Cadence and overlap

The loop runs on a **fixed cadence** chosen from the rules' windows — fast
enough that the shortest sustained-for duration is sampled several times,
slow enough that evaluation cost stays negligible. Two guard disciplines
come from the scheduling subject and are applied, not re-derived here:

- **Overlap guard** — if a tick is still evaluating when the next fires,
  the next is skipped, not queued; the general treatment is
  [overlap-and-reentrancy](../../scheduling/techniques/overlap-and-reentrancy.md).
  For alerting the skip is safe by design *because evaluation is
  idempotent over state*: rules compare current windows and consult
  persisted fire history, so a skipped tick is a slightly late evaluation,
  never a lost fire.
- **Missed ticks** — after a suspend or stall, the loop evaluates *now*
  against *current* data; it does not replay the gap pretending each missed
  tick happened. Threshold rules are about the present. What the gap does
  owe is honesty: a loop that was not running is disclosed as such
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
  "no alerts overnight" and "no evaluation overnight" must be
  distinguishable afterward, e.g. by a persisted last-evaluated stamp.

## An empty window has no value, and zero is not it

The quietest bug in the genre: a rate or average computed over a window
containing **no samples**. The arithmetic wants a denominator; the tempting
convenience is to answer zero — and zero is a *claim*: error rate zero
means "everything succeeded", which is the opposite of "nothing happened".
On an idle system, manufactured zeros make every **below-threshold** rule
true: "alert me when success rate drops below 90%" fires forever on a
machine doing nothing, and each fire is arithmetically defensible and
semantically absurd. The correct answer for an empty window is **no
value** — and the evaluator *skips* a rule whose signal has no value this
tick, recording "not evaluable" rather than comparing against an invented
number ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
again: absence of data spelled differently from a measurement of zero).
Test suites obey a matching discipline: emptiness tests must cover the
below-threshold comparators, because those are precisely the ones that
manufactured zeros set off, and a test that only proves ">" rules stay
quiet on empty data proves nothing about the direction that pages.

## Evaluate windows, not instants

A rule with a window ("above 5% for ten minutes") is evaluated as an
aggregate over that window — mean, max, or count-of-breaching-samples,
chosen per rule semantics and named in the rule — not as "the instantaneous
value happened to breach at tick time". Instant sampling turns cadence into
a lottery: a spike between ticks is missed, a spike at a tick fires, and
the rule's behavior becomes a function of phase alignment rather than of
the system being watched. The window aggregate also makes the loop robust
to its own jitter: evaluating three seconds late changes a ten-minute mean
by nothing.

## Decision rules

- One loop, all rules — per-rule timers multiply overlap and ordering
  problems for zero benefit at any realistic rule count.
- The loop reads rules fresh each tick (or subscribes to changes): a rule
  edited or disabled takes effect at the next tick, not at the next
  restart.
- Evaluation failures for one rule (signal missing, arithmetic error) are
  contained per-rule and surfaced on that rule's status — one broken rule
  must not abort the tick for the other forty.
- The loop exposes its own liveness (last tick time, rules evaluated,
  duration) — the watcher is itself watchable, and its silence is a fact
  someone can observe rather than infer.
