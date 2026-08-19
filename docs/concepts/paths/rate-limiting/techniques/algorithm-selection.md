---
layer: technique
subject: rate-limiting
technique: algorithm-selection
status: forged
laws: []
shared_with: []
---

# Algorithm selection

All the classic limiter algorithms enforce the same average — N events per
period — and differ almost entirely in two places: **what happens at window
boundaries** and **what an idle key may do all at once**. Choosing an algorithm
is choosing a burst semantic and paying for it in state; the average takes care
of itself.

## The families and what they actually trade

- **Fixed window.** One counter per key, reset at each window edge. State is one
  integer and a window identifier; arithmetic is a comparison. Its defect is the
  boundary: a key can spend its full allowance in the last instant of one window
  and again in the first instant of the next — up to 2× the stated rate across
  the seam, delivered as one burst. Acceptable when the protected resource
  tolerates short doubling and the limit exists mainly to stop *sustained*
  abuse; wrong when the burst itself is the harm.
- **Sliding window log.** Record every admitted event's timestamp; count the
  ones younger than the window. Exact — no boundary artifact at all — but state
  grows with the admitted rate, which means the *most active keys cost the most
  memory*, an inversion worth noticing before choosing it for hostile traffic.
  Right for low-rate, high-value limits (sign-ins, expensive mutations) where
  exactness per event matters more than per-key bytes.
- **Sliding window over sub-buckets.** Divide the window into B fixed buckets;
  count across the live buckets, aging the oldest out as time advances. State is
  B small counters per key; boundary error shrinks as B grows. This is the
  general workhorse: precision purchased in explicit, tunable increments of
  memory, with worst-case error you can state ("at most one bucket's worth of
  events misattributed at the seam").
- **Token bucket.** A balance that refills continuously at the sustained rate up
  to a capacity; each admission spends. Two parameters — **rate** and **burst
  capacity** — and it is the only family that states the burst policy as an
  explicit, separately-tunable number rather than as an artifact of window
  arithmetic. State is a balance and a last-refill instant; refill is computed
  lazily on access, so an idle key costs no background work. Right whenever
  bursts are *legitimate* (a client waking up and syncing) but must be bounded.
- **Leaky bucket / smoothed variants.** Enforce spacing between admissions
  rather than a count per window — the output side becomes a steady drip. Right
  when the resource cares about inter-arrival time (a fragile downstream that
  wants pacing, not quotas); wrong as a general ingress limit, because it
  penalizes even trivial bursts that the resource could absorb.

Two composition notes. First, families combine: a token bucket whose capacity
equals its per-window rate degenerates into (roughly) a sliding window, and a
"rate + burst" requirement stated by a product owner is a token bucket spec
whether or not anyone says the words. Second, the burst question must be asked
*of the resource*, not of the algorithm: "if a key that has been silent for an
hour sends its entire allowance in one instant, does anything break?" If yes,
the burst capacity is a real design number and the token bucket makes it
explicit; if no, the cheapest counter that survives the boundary artifact wins.

## What a refusal does to state: nothing

Whatever the family, one invariant is non-negotiable: **a refused attempt
consumes no allowance.** Recording rejected attempts into the window looks
symmetric and is a self-perpetuation bug — a one-second spike over the limit
becomes a lockout that renews itself for as long as the caller keeps knocking,
because each refused knock re-fills the window that refuses it. The window
counts *admissions* (work actually caused), refusals count only into their own
telemetry counter, and the retry-after stays honest because it is derived from
events that will actually age out. This bug has been shipped and painfully
fixed enough times across ecosystems that it belongs in the review checklist
for any hand-rolled limiter: find the line that records the event, and confirm
it is unreachable from the refusing branch.

Two more state disciplines ride along. **The window's durability class is part
of the contract**: an in-memory window resets on process restart, which on
frequently-restarted systems means every limit silently re-opens — acceptable
for second-and-minute windows, but a budget that must span hours or days must
be counted from durable evidence (persisted records), not from in-memory
timestamps, and either way the limiter's surface states which it is. And
**"unlimited" is a short-circuit, not a sentinel**: modeling an unlimited tier
as an astronomically large budget means the limiter still records and ages
every event at full bookkeeping cost for a limit that can never refuse — the
unlimited case skips the machinery, explicitly.

## Clock discipline

Every family is arithmetic over "now", and the clock is a dependency with
failure modes:

- **Intervals come from a monotonic source.** Wall time steps backward (clock
  sync, manual adjustment) and a limiter doing elapsed-time arithmetic on it
  will mint negative elapsed time — which, in a token bucket, mints tokens. Use
  the clock that cannot go backward for refill and aging; use wall time only
  where the window is a *published* boundary ("per calendar minute") that
  callers were told about.
- **A clock step must not become an allowance.** Decide explicitly what a
  backward or forward jump does: clamp elapsed time at zero, cap any single
  refill at the burst capacity, and treat an absurd elapsed value as "refill to
  full at most once" rather than as arithmetic to honor.
- **Window arithmetic lives in one place.** The functions that compute
  window-start, bucket-index, refill amount, and time-to-next-token are the
  same arithmetic the refusal contract's retry-after depends on; two
  implementations of it will disagree at exactly the boundary cases the tests
  never cover. One module owns the time math; everything else calls it.

## Decision rules

- **Name the burst semantic before naming the algorithm.** "N per minute" is an
  incomplete spec; "N per minute, at most M in any instant" is complete, and M
  picks the family for you.
- **State per key is part of the choice.** Multiply the per-key state by the
  key cardinality bound (see key-design) before committing; an exact algorithm
  on an unbounded key space is a precision you pay for in someone else's
  memory.
- **Lazy over background.** Prefer families whose state advances on access
  (lazy refill, aging-on-read) over ones needing a background ticker per key;
  a limiter whose idle cost is zero scales with traffic, not with key count.
  The one background job worth having is the reaper (see storm-hygiene), which
  runs per map, not per key.
- **Derive retry-after from the same state.** Whatever family you choose must
  be able to answer "when would this exact request succeed?" from its state in
  O(1) — time to window edge, time for the oldest event to age out, time for
  the balance to reach the request's cost. A family that cannot answer cheaply
  forces the refusal contract to lie (see refusal-contract).
- **Precision claims carry their error bound.** A sub-bucketed window is
  "exact to within one bucket", a fixed window is "exact to within one
  window". Say which, in the limit's documentation — operators comparing a
  dashboard against a contract need to know whether a small overage is a bug
  or the stated error.
