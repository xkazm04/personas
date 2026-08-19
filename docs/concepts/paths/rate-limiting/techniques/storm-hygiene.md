---
layer: technique
subject: rate-limiting
technique: storm-hygiene
status: forged
laws:
  - creation-names-reaper
shared_with: []
---

# Storm hygiene

A limiter's busiest day is the day it says no ten thousand times a minute —
that is the load profile it was *bought for* — and everything the limiter does
per refusal happens at storm rate. A limiter that logs each rejection, allocates
freely on the refusal path, or lets per-key state grow with the attack becomes a
second incident running alongside the first: the defense joining the storm. This
technique is the limiter's own resource discipline, designed against the peak,
because the peak is the point.

## The refusal path is a hot path

Design the *refusing* branch as the fast branch. An admission does real work
afterward, so its overhead is amortized; a refusal is pure overhead, multiplied
by the storm. The refusal path should be: read state, compute verdict and
retry-after from arithmetic already in hand, increment a counter, return. Things
that do not belong on it: building large human-readable strings per event,
consulting anything remote, taking locks shared with unrelated work, or emitting
one telemetry event per rejection to a pipeline that bills or backpressures per
event. The contract fields (see refusal-contract) are small and computed —
nothing about a complete refusal requires an expensive one.

## Warn-once latching

The logging discipline during a rejection streak is **one line per key per
episode, plus a summary at the end**:

- The *first* refusal of a streak logs at notice level with the full context —
  key, limit, window — because the transition from admitting to refusing is
  the operationally interesting event.
- Subsequent refusals in the same streak increment a suppressed-count on the
  latch and log nothing. The latch is a per-key flag plus a counter, living in
  the same bounded per-key state the limiter already owns.
- The streak's *end* — the first admission after refusals, or the streak's
  entry expiring — logs the summary: refused count and duration. The end-line
  matters as much as the first: it is what turns ten thousand suppressed
  events into one sentence with a number in it, and it is the difference
  between "we suppressed the noise" and "we suppressed the information."

The latch resets when the streak ends, so the *next* episode logs its own first
line. Without the reset, warn-once decays into warn-once-ever, and the limiter
goes permanently silent about a recurring problem — the suppression mechanism
must be an episode boundary, not a lifetime mute.

Rejection *counters* have no such problem and no such latch: metrics are
storm-safe by construction — a counter incremented ten thousand times costs the
same to read as one incremented once — which is why the volume story belongs to
metrics and the narrative story to the latched log (see limit-observability for
what those counters feed).

## State under storm

Storms are also when per-key state grows fastest — hostile traffic mints keys
(see key-design for the cardinality bounds themselves). The hygiene half of
that contract is the **reaper**: pruning is a named, scheduled activity, not a
side effect hoped to happen (law: creation-names-reaper).

- **Periodic, not per-request.** Prune on a timer or every Nth operation —
  a cadence chosen so the map's worst-case size between sweeps is still
  within budget. Pruning "whenever we happen to touch an entry" leaves the
  untouched majority immortal, and untouched is exactly what abandoned keys
  are.
- **The sweep is bounded too.** A reaper that walks a million-entry map under
  a lock during the storm is its own latency incident. Bound each sweep
  (time-boxed or count-boxed) and let the cadence, not the sweep size, carry
  the load.
- **The reaper is observable.** Entries pruned, map size before and after, on
  the limiter's own metrics. A reaper that stops running is invisible right
  up until the map isn't.

## The limiter never amplifies

Cross-cutting checks that keep the limiter out of its own incident:

- **Per-refusal cost is O(1) and small** — no growth in work per event as
  event volume grows.
- **Per-key state is capped** — storms change the map's churn, never its
  ceiling.
- **Log volume is per-episode** — storms change the counters, not the line
  count.
- **Downstream noise is bounded**: whatever the limiter notifies (alert
  channels, operator surfaces) receives episode-grade events, never
  per-rejection events. Alert cooldown machinery downstream is a second
  net, not an excuse — suppression at the source is what protects the
  telemetry pipe itself.

The design review question for every element of a limiter: *what does this line
cost times ten thousand per minute?* Any answer that includes "a log line each"
or "an allocation proportional to the attack" fails the review.

## Decision rules

- **Design the refusal branch as the hot branch.** Budget it like an inner
  loop, because in the scenario that justifies the limiter's existence, it is
  one.
- **Latch per key, summarize per episode, reset at streak end.** First event
  loud, middle silent-but-counted, end summarized. Any other logging shape is
  either a flood or a mute.
- **Ship the reaper with the map.** Cadence, sweep bound, and metrics chosen
  at creation. "We'll add pruning if it grows" means the growth incident is
  the pruning ticket's due date.
- **Test at storm scale.** The meaningful test refuses ten thousand times
  across a thousand keys and asserts the aggregate: log lines emitted ≈ number
  of episodes, map size ≤ cap, per-refusal latency flat from first to last.
  Testing one polite rejection proves the feature; only the storm test proves
  the hygiene.
