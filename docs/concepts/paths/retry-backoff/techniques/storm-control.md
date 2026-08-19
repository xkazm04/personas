---
layer: technique
subject: retry-backoff
technique: storm-control
status: forged
laws:
  - creation-names-reaper
shared_with: []
---

# Storm control

Every mechanism in this subject is locally reasonable and globally dangerous. One
retry loop is polite; ten thousand of them, correlated by the same outage, are a
weapon. This technique is about the aggregate: bounding what the resilience layer
can do to the system that hosts it and the dependencies it faces, on the
assumption — always eventually true — that failures arrive *correlated*, not one
at a time.

## Amplification math

Retries multiply through layers. A user intent that crosses three layers, each
retrying three times on failure, can issue up to 3³ = 27 calls against the deepest
dependency — a 27× amplifier that switches on precisely when that dependency
starts failing. The multiplication is a property of the *composition*: every layer
audits as "modest, bounded, three attempts" in isolation, and no single call site
contains the problem. Two structural rules keep the exponent down:

- **Retry at one layer per failure domain** — the layer that can classify the
  failure and act on the result, usually the boundary adapter. Layers above it
  propagate failure; they do not add their own ladder on top. When an outer layer
  legitimately retries (it can repair something — refresh a credential, choose
  another provider), the inner layer's attempts are part of the outer layer's
  budget, not a hidden multiplier under it.
- **Cap the aggregate with a retry budget.** Per-attempt ladders bound one
  operation; a budget bounds the *fleet*: retries may not exceed a stated
  fraction of recent request volume (a tenth is a common, defensible number) per
  dependency. Under the cap, retries behave normally; over it, further retries
  are denied as a policy outcome — the same spelled-differently discipline as a
  breaker denial. The budget is the system's stated answer to "how much worse can
  our resilience make an outage," and without one the honest answer is the
  product of every ladder in the call graph.

## Correlated wake-ups

The other storm shape is temporal: events that synchronize many actors onto one
instant. A process restart reconnects every session at once; a breaker closing
releases every queued caller; a rate-limit window expiring un-blocks every
throttled row; a reconciliation loop waking after downtime finds the whole backlog
due (see durable-retries). Deterministic delays *preserve* synchronization —
whatever correlated the actors keeps them correlated through equal delays — so the
treatment is always the same pair: **jitter the schedule** (see backoff-design)
and **pace the release** (a bounded number admitted per tick, not a floodgate).
Recovery is the highest-risk moment in the whole subject: the dependency is
weakest exactly when the accumulated herd is largest, and a recovery executed as a
stampede re-creates the outage and re-arms the herd.

## The resilience layer's own resources

Per-key state — ladder rungs, breaker counters, last-failure timestamps,
warn-latches — is allocated per *failure domain key*, and key spaces sized by the
world (per peer, per session, per remote account) are unbounded. An unbounded map
that grows one entry per misbehaving remote is a memory leak whose growth rate is
controlled by the adversary. Every such map is bounded at creation (law:
creation-names-reaper): a TTL that expires entries idle past the longest
meaningful suppression window, or a size cap with least-recently-touched
eviction — and eviction must fail *safe for the system*, degrading to default
(un-backed-off) behavior for the evicted key rather than blocking work on
bookkeeping that no longer exists.

Logging is a resource too, and it fails in the same correlated way: a retry loop
that logs every attempt at error severity turns a dependency outage into a
telemetry outage — disks, pipelines, and attention all flooded by restatements of
one fact. The discipline is **warn-once latching per key per episode**: the first
failure of an episode logs loudly, subsequent identical failures increment a
counter silently, and the episode's *end* logs the summary — "recovered after 41
suppressed failures over 12 minutes." The latch state is part of the same bounded
per-key map, and the counter it carries is what makes the summary possible at all.
(The neighboring discipline for *alert* traffic — cooldowns, debounce, hysteresis
— belongs to the scheduling subject's cooldown-and-debounce; this technique owns
keeping the attempt and log volume sane.)

## Decision rules

- **Assume correlation.** Any design reasoning that starts "for a single failing
  call…" must be re-run as "for every call failing at once," because the second
  scenario is the one retries were bought for. If the aggregate behavior under
  total dependency failure cannot be stated (peak attempt rate, peak memory, peak
  log volume), it has not been designed.
- **Deny is a valid verb.** Budget exhaustion and pacing delays are policy
  outcomes, spelled and counted like breaker denials — never disguised as
  dependency failures, never silent.
- **Per-item budgets structurally miss correlated failure — add a cross-item
  cap.** Every individual ladder can be under its own budget while the fleet,
  in aggregate, hammers a provider mid-incident; and a breaker that (correctly)
  excludes environmental failures from its evidence cannot backstop this
  either. The missing piece is a storm cap: when one actor or one dependency
  accumulates N environmental failures in a window, stop *scheduling new
  retries* for it and surface one loud item instead — with the observed count
  in the message, so the human sees a number, not a mood.
- **Bound before shipping, not after the leak.** The TTL/size cap on per-key
  state ships with the map. A resilience layer that OOMs the process during an
  outage has inverted its purpose in the least dignified way available.
- **Test the storm, not the retry.** The unit test for one ladder passes
  trivially; the test that matters simulates N keys failing simultaneously and
  asserts the aggregate: attempts per second stays under the budget, the state
  map stays under its cap, the log emits one line per key per episode.
