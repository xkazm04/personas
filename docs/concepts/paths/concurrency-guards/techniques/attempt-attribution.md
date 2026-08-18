---
layer: technique
subject: concurrency-guards
technique: attempt-attribution
status: forged
laws:
  - identity-survives-reuse
  - count-carries-predicate
shared_with: []
---

# Attempt attribution

Guards police the entrance. But operations end as well as begin, and endings
are not policed by anything unless the design polices them: an attempt that
was superseded — cancelled, timed out, replaced by a newer attempt for the
same key — may still complete, and its late result arrives at the same write
site as everyone else's. Without attribution, the write site applies whatever
arrives last, and **last-to-finish wins** replaces the intended
**latest-attempt wins**. The symptom is state that flickers backwards: a new
result lands, then an old in-flight straggler overwrites it with stale data,
and the system displays the past with total confidence.

Guards cannot fix this, even perfect ones. A guard serializes *starts*; the
stale-writer race is between a *finish* and a *newer start* that legitimately
acquired the key after the old attempt was released or reclaimed. Entrance
control and finish control are two different mechanisms, and mature designs
carry both.

## The mechanism: mint identity at start, verify at write

- **Mint** — each attempt gets an identity at the moment it starts: a
  generation counter per key, or a unique attempt id. Minted once, carried
  everywhere the attempt's execution flows (law: identity-survives-reuse —
  the identity must survive the attempt's own retries, callbacks, and stream
  chunks; anything re-derived mid-flight can silently change).
- **Record the incumbent** — the key's current-attempt identity lives in one
  authoritative cell: "the attempt whose results I accept is G." Starting a
  new attempt advances the cell; cancelling without a successor clears it.
- **Verify at the write site** — every result, callback, stream event, or
  completion handler compares its carried identity against the incumbent
  *at the moment of writing*, not at the moment of scheduling. Match → apply.
  Mismatch → discard, cheaply and (at debug level) visibly. The check must be
  adjacent to the write; a check performed early in a handler that then
  awaits before writing has reopened the window it existed to close.

This is the same shape at every scale: a UI view ignoring a fetch that
resolved after the filter changed; a streaming consumer dropping chunks from
a superseded run; a lease-holding worker fencing its database write with the
lease generation (see cross-process-exclusion's fencing token — that is this
technique applied across processes). Sibling paths own their local dress —
client-side races in async-race-guards, stream-event attribution in
[run-attribution](../../streaming-output/techniques/run-attribution.md) — this
technique is the invariant under all of them.

## Generation counter or attempt id

A **per-key generation counter** is the lighter form: monotonically
incremented at each start, compared with equality (or with `≥` where the rule
is "newer wins even if I never saw the start"). It answers only "am I still
the incumbent?" — usually the entire question. A **globally unique attempt
id** carries more: it can attribute logs, meter costs per attempt, and
correlate an attempt across process boundaries where a per-key counter has no
authority cell to live in. Use the counter for in-process supersession; use
ids when attempts are durable, distributed, or need a paper trail. Both
require the same discipline: minted at start, immutable, compared at the
write.

## Discard is an outcome, not an error

A stale writer being discarded is the mechanism *working*. It should be cheap,
non-throwing, and invisible to users — but countable. A discard rate of
zero forever suggests the check is miswired (nothing is ever stale?); a
sudden spike says attempts are being superseded faster than they complete,
which is a capacity or debounce problem surfacing in the one place
instrumented to see it. The count carries its predicate: "results discarded
because a newer attempt superseded them," not a bare number.

## What the old attempt should still do

Attribution decides what the old attempt may *write*, not whether it may
*run*. Best effort is to cancel superseded attempts (why pay for a result
that will be discarded?), but cancellation is cooperative and eventual —
attribution is what makes the design correct even when cancellation is late
or impossible. One asymmetry deserves care: side effects that are not writes
to the guarded state (charging an external meter, sending a notification)
are not protected by write-site verification. An attempt that can be
superseded must either perform such effects only after confirming incumbency,
or make them idempotent (see idempotency-by-design) — discarding the state
write does not un-send the email.

## Decision rules

- Any operation whose result arrives asynchronously *and* whose key can be
  restarted needs attribution; the guard alone leaves the finish race open.
- Mint identity at attempt start, in one place; never re-derive it mid-
  flight.
- Keep one authoritative incumbent cell per key; verify against it adjacent
  to the write, after any awaiting is done.
- Prefer per-key generation counters in-process; attempt ids where results
  cross process or durability boundaries.
- Count discards with their predicate; alert on the rate changing shape, not
  on individual discards.
- Cancel superseded attempts as an economy measure, never as the correctness
  measure — attribution is the correctness measure.
- Route non-write side effects through incumbency confirmation or make them
  idempotent; the write-site check does not protect them.
