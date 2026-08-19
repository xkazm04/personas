---
layer: technique
subject: rate-limiting
technique: limit-observability
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
---

# Limit observability

A limit's numeric value is a guess — an estimate of what the resource can bear
and what legitimate traffic needs, made with the least information the system
will ever have. Observability is how the guess gets corrected: it shows demand
against allowance per key over time, so limits are tuned from evidence rather
than re-guessed after incidents. Without it, a limiter has exactly two
externally visible states — silent and on fire — and every limit change is a
bet placed blind.

## Usage snapshots

The foundational readout: for any key, current standing against its limit —
used, remaining, window, and where layers apply, standing in *each* layer. The
mechanics worth getting right:

- **Read without disturbing.** A snapshot is an observation, not an admission:
  it must not consume allowance, reset idle timers, or extend an entry's
  lifetime under the eviction rules. An observability surface that touches the
  state it reads changes limiter behavior in proportion to how closely anyone
  watches it.
- **Snapshots are derived views, and say from what.** A dashboard aggregating
  many keys may read a cached snapshot rather than hammering live state — the
  limiter's state is hot, and observers can be many. That cache is a stored
  derivation and follows the standing rule (law:
  derivation-names-recomputation): it carries its age and names how it is
  recomputed, so a stale panel reads as "as of 30 seconds ago", never as a
  live contradiction of what callers experience.
- **The snapshot speaks the contract's vocabulary.** The same used/remaining/
  reset numbers the refusal contract sends to callers (see refusal-contract),
  from the same arithmetic — one truth, two audiences. An operator panel that
  computes usage independently of the enforcement path will disagree with it
  during precisely the incidents it exists for. The structural precondition is
  the golden path's policy-ownership stance: when the limit is a call-site
  parameter rather than limiter state, the snapshot *cannot* report a true
  limit — it must guess from the key's spelling, and the guess is wrong for
  whichever key family the guessing table forgot.
- **Show measurement, or say configuration.** A panel that renders configured
  policies alongside runtime counters must not let one impersonate the other:
  counters whose producer is not actually wired render as permanent zeros,
  and an operator reads permanent zero as "nothing is being throttled" — a
  conclusion the surface has no evidence for. Every displayed number traces to
  a live producer, or it is labeled as configuration.

## Warnings before refusals

The cheapest rate-limit incident is the one that never fires. A near-limit
warning — a key crossing a stated fraction of its allowance, sustained rather
than momentary — converts the first refusal from a surprise into a forecast:
the operator (or the tenant) hears "you will hit this wall within the hour"
while every request is still succeeding. Design notes: the threshold is part of
the limit's configuration, not folklore; crossing events are latched per key
per window the same way refusal logging is latched (see storm-hygiene), so a
key oscillating around the threshold emits one warning, not a strobe; and the
warning names the key, the limit, and the fraction — it is a small refusal
contract, delivered early.

## Counters, and what they must carry

The limiter's own metrics, each on its own series: **admitted**, **refused** —
per limit layer, so per-key exhaustion and global exhaustion are different
lines — plus the hygiene series (evictions, unknown-pool refusals, reaper
activity) that key-design and storm-hygiene call for. Two disciplines:

- **Every count names its predicate** (law: count-carries-predicate).
  "Refusals: 4,012" travels into dashboards, incident notes, and capacity
  reviews, and is meaningless without *which limit, which window, which key
  scope*. A refusal count whose limit changed mid-series is two measurements
  wearing one name — annotate the change or split the series.
- **Demand is admitted plus refused.** The resource's own throughput graphs
  show only survivors; during active limiting, served traffic *under*-reports
  demand by exactly the amount that matters. Capacity decisions made from a
  served-only graph will conclude the limit is comfortable at the very moment
  it is turning customers away. The demand series is the one that justifies —
  or indicts — the limit's current value.

## The limit itself is observable

The limit's value is configuration with operational consequences, and it
changes: raised for a big tenant, tightened during an incident, drifted by a
provider on the egress side. Changes to a limit are recorded events — what
changed, from what to what, when, by whom — because every usage series is only
interpretable against the limit that was in force at the time. A refusal spike
and a limit cut at the same timestamp is an explanation; without the change
record it is a mystery with a paging policy.

## Decision rules

- **One arithmetic, two audiences.** Snapshots and refusals derive from the
  same state through the same math. Divergence between "what the operator
  sees" and "what the caller was told" is a defect class of its own.
- **Alert on trajectory, refuse on arrival.** Near-limit warnings do the
  alerting; refusals do the enforcing. Paging humans on refusal counts alone
  means every page arrives after the wall did.
- **Chart demand, not just throughput.** Admitted + refused per key is the
  series that tunes limits; served-only graphs systematically flatter the
  status quo.
- **Keep observation passive.** No allowance consumed, no lifetimes extended,
  no locks contended beyond a read. If watching the limiter changes the
  limiter, the dashboard is a participant.
- **Record limit changes as events.** A usage series without its limit-change
  overlay cannot be read honestly; capacity reviews start from both.
