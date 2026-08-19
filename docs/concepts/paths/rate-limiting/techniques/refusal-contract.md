---
layer: technique
subject: rate-limiting
technique: refusal-contract
status: forged
laws:
  - failure-not-empty-success
shared_with: []
---

# The refusal contract

A limiter's refusal is its primary user interface. Admissions are invisible —
nobody inspects a request that simply worked — so everything the outside world
ever learns about the limit, it learns from the shape of the "no". A refusal
that communicates well *reduces* load: the caller sleeps precisely long enough
and returns once. A refusal that communicates nothing *multiplies* load: the
caller probes, guesses, and hammers, and every probe is another request the
limiter must refuse. The refusal is where the limit either becomes a contract
or degenerates into weather.

## What a complete refusal carries

Four fields, all machine-readable, all derived from the limiter's actual state:

- **The key** — which allowance was exhausted. In layered limits (per-key
  inside global — see limiter-topology) the refusal names the *specific* limit
  that refused, because "you are limited" and "everyone is limited" call for
  different caller behavior and different operator escalation.
- **The rule** — the limit and its window ("60 per minute"), so a caller can
  self-pace *before* the next refusal instead of rediscovering the number by
  collision. Publishing the rule in the refusal also keeps documentation
  honest: the enforced number and the advertised number cannot drift apart if
  the refusal is the advertisement.
- **Retry-after** — the computed instant (or delay) at which this request
  would succeed, from the same arithmetic that refused it: time to the window
  edge, time for the oldest counted event to age out, time for the bucket
  balance to cover the cost. Never a constant. A constant retry-after is a
  guess wearing the uniform of a promise, and callers that honor it will be
  refused again — teaching them, correctly, to stop honoring it.
- **Current standing** (optional but cheap) — used and remaining amounts, so
  well-behaved clients can throttle themselves down *before* the first refusal.
  The same numbers feed the near-limit warnings on the observability side (see
  limit-observability).

## Honesty bounds on retry-after

Retry-after is a promise about the limiter's own state, and the technique is
knowing exactly how far that promise extends:

- **It is single-caller-true.** "At time T this request would succeed" holds if
  nothing else consumes the allowance first. When many actors share one key,
  T is an estimate, and the contract should be understood (and documented) as
  "not before T" rather than "guaranteed at T".
- **It synchronizes the herd.** Every caller refused in one window receives
  approximately the same T, and callers that honor it precisely return as one
  wave at T. De-correlating that wave is the *caller's* job — jitter belongs on
  the consuming side, owned by
  [backoff-design](../../retry-backoff/techniques/backoff-design.md) — but the
  limiter can avoid making it worse: compute retry-after from each request's
  own position rather than quantizing everyone to the same boundary instant,
  and never round a spread of true times into one shared value.
- **It must be at least self-consistent.** A caller that waits exactly the
  stated time and is refused again — with no intervening competition — has
  caught the limiter lying, usually because retry-after was computed by
  different arithmetic than admission (two implementations of the window math;
  see algorithm-selection's rule that time math lives in one module).

## A verdict, spelled as one

The refusal is a policy outcome, not an error, and the spelling must keep the
two apart end to end (law: failure-not-empty-success):

- **In the return type:** a limiter's answer is a closed verdict — *admitted*,
  or *refused(contract fields)* — not an exception, not a boolean, not a null.
  Refusal data rides in the verdict, so no call site can observe "refused"
  without also holding the retry-after.
- **On the wire:** whatever protocol carries the refusal, it uses that
  protocol's standard rate-limit signaling — the status and header shapes
  integrations already know how to consume — rather than a bespoke error body
  that every client must special-case. The consuming taxonomy on the caller's
  side files this as its own class
  ([error-classification-for-retry](../../retry-backoff/techniques/error-classification-for-retry.md)),
  and it can only do that if the wire shape is unambiguous.
- **In telemetry:** refusals count on their own series, never blended into
  error rates. A deploy that trips alarms because a big tenant hit its quota is
  an alerting bug with a refusal-spelling root cause.

The failure direction matters equally: a limiter that *could not evaluate* — its
state unavailable — did not refuse, and must not emit the refusal shape. Emitting
"rate limited, retry after 60" because a store timed out sends every caller into
a synchronized, dutiful, pointless wait, and buries the actual outage under
plausible-looking throttling.

## Decision rules

- **Refuse before the world changes.** The limit check runs ahead of anything
  that persists, spends, or spawns; a refusal is a no-op on the world, leaving
  behind nothing but its own counter. A refusal issued after a durable record
  was written strands that record in a state no one owns.
- **A refusal that reaches nobody is a drop.** Every refusal terminates
  somewhere named — the caller's verdict, a dead-letter record, at minimum a
  counter. A check whose result is tested for failure and then simply skipped
  makes "we refused four thousand requests" indistinguishable from "it was
  quiet", which is the empty-success lie wearing a policy hat.
- **No naked no.** Every refusal path — including the deepest, oldest, most
  internal one — produces the full contract. If some door cannot supply the
  fields, that door is bypassing the limiter's verdict type, which is the
  topology defect (see limiter-topology), not a formatting gap.
- **Compute, never configure, retry-after.** The only admissible source is the
  limiter's own state arithmetic. If the algorithm cannot answer cheaply, the
  algorithm was mis-chosen (see algorithm-selection).
- **State the estimate's nature.** Document retry-after as "not before";
  callers building tight schedules on "exactly at" are building on
  single-caller semantics they do not have.
- **Test the contract, not just the counting.** The high-value tests: refusal
  at the boundary carries a retry-after that, when honored in a single-caller
  scenario, admits on the first retry; the could-not-evaluate path emits a
  failure, not a refusal; and the refused verdict is impossible to construct
  without its contract fields.
