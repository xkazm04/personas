---
layer: technique
subject: perf-instrumentation
technique: semantic-flags-over-heuristics
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Semantic flags over heuristics

Every rate a performance surface reports — timeout rate, failure rate,
cancellation rate — is a count of **outcomes**, and outcomes are known with
certainty at exactly one moment: settlement, in the code that settled the
call. The technique is to capture them there, as explicit flags on the
metric record, and to derive every downstream rate by counting flags. The
anti-technique is to reconstruct outcomes later from measurements — and it
is always available, always plausible, and always wrong.

## The duration-threshold trap

The canonical heuristic: "calls slower than the timeout budget were
timeouts." It fails in both directions simultaneously:

- **False negatives:** operations carry different deadlines. A call with a
  five-second budget that times out settles at five seconds — far under the
  global threshold — and the heuristic files a real timeout as an ordinary
  failure, or worse, as a slow success.
- **False positives:** a genuinely slow success crosses the threshold and
  is counted as a timeout that never happened. The operator now hunts a
  timeout bug in code that completed correctly.

Both misfilings concentrate in the tail — the exact region the metric
exists to describe. This is
[gate-sees-target](../../_laws.md#gate-sees-target) in metric form: the
heuristic observes a proxy (how long it took) instead of the target (how it
ended), and proxy and target diverge precisely in the interesting cases.
The moment of settlement *knew* the answer — the timeout branch ran, or the
error branch, or the completion branch. Reconstructing later what the code
briefly knew for certain is choosing amnesia and calling it inference.

## Stamp at settlement, in the settling code

The mechanics: the metric record is created when the operation starts and
**settled exactly once**, by whichever branch concludes it — completion,
failure, deadline expiry, cancellation. That branch stamps the flag. No
observer thread infers it; no reader reclassifies it. If the instrument
wraps the operation (the natural shape — one chokepoint through which all
measured calls flow), the wrapper's own timeout branch is the only code
that ever writes `timedOut: true`, which makes the flag exactly as
trustworthy as the timeout mechanism itself. One writer per flag, at the
site of certainty.

## One outcome vocabulary

Completed / failed / timed out / cancelled is a closed vocabulary with one
definition, consumed by the record shape, the rate derivations, and the
display layer alike
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The boundary cases are decided once, in the definition, not per call site:
a timeout *is* a failure for "did the user get their answer" but is *not* a
failure for "is the downstream service returning errors" — so the record
keeps the specific flag and lets each rate choose its predicate, rather
than collapsing to a boolean at write time and losing the distinction
forever. Flags are cheap; un-collapsing is impossible.

## What cancellation does to a latency pool

Outcome flags are not only for rates — they guard the **latency statistics**
too. A cancelled operation's duration measures the user's patience, not the
system's speed; a timed-out operation's duration measures the deadline
configuration, not the operation. Pour those into the same pool as
completions and the percentiles report an average of three different
phenomena. The technique: decide, per statistic, which outcomes enter the
pool, and state the decision in the statistic's predicate — "p95 of
completed calls" is the honest default for speed; "p95 of all settled
calls" is a different, occasionally useful claim. A pool whose membership
rule is unstated will eventually be cited for a claim it does not support.

## Carry the flag; never re-derive it

Once stamped, the flag travels with the record through every aggregation
and display. Any downstream layer that re-derives outcome from duration —
a panel coloring rows red above a threshold and labeling them "timeouts",
an exporter re-bucketing by duration — has reintroduced the heuristic
after the truth was already in hand. Thresholds downstream may *highlight*
("slow"), but they may not *rename* ("timed out"): slowness is a judgment
about a duration; an outcome is a fact about an ending, and the vocabulary
keeps them apart.
