---
layer: technique
subject: client-state
technique: status-fsms
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success, identity-survives-reuse, one-validation-door]
shared_with: []
---

# Status FSMs

Every asynchronous operation family has a lifecycle: it has not started, it
is running, it finished with a result, it finished with a failure, its
result has aged. That lifecycle is a finite state machine whether the code
models it or not — the only choice is whether the machine is explicit, with
named states and known transitions, or implicit, smeared across independent
booleans whose combinations nobody enumerated.

## The boolean soup and why it always loses

The soup accumulates innocently. `isLoading` ships first. A bug report
("empty state flashes before the first load") adds `hasLoaded`. Another
("error and data showing together") adds `isError`. A refresh feature adds
`isRefreshing`. Four booleans now encode sixteen representable states; the
domain has perhaps six meaningful ones; the other ten are *reachable* —
each one a bug with no name, produced by some interleaving that sets one
flag and misses another. The defining property of the soup is that **every
illegal state must be prevented at every write site**, and write sites
multiply.

An explicit status field inverts the burden: one value from an enumerated
set, so illegal *states* are unrepresentable and only illegal *transitions*
remain to be guarded — and those are guarded in one place, the slice
operation that performs the transition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary):
the status vocabulary is defined once, and every consumer switches over the
same set).

## The canonical state set

Most operation families need exactly these, and should start from them:

- **idle** — never attempted. Distinct from empty-after-load; conflating
  the two is the empty-flash defect at the data layer.
- **loading** — first attempt in flight, nothing held.
- **loaded** — attempt completed, result held (a held *empty* result is
  still loaded; emptiness is a property of the data, not a status).
- **failed** — attempt completed unsuccessfully, evidence attached. Failure
  is its own state, never "loaded with a flag" and never silently "idle
  again" ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **stale** *(or a refreshing marker alongside loaded)* — result held but
  known or suspected to be outdated; a refetch is warranted or in flight.
  What distinguishes it from loading: **data presence** — the consumer keeps
  rendering the held result.

One transition rule follows from data presence and deserves to be written
into the machine rather than left to call sites: **where failure lands
depends on what is held.** A failed *first* attempt goes to `failed` —
nothing is held, and rendering emptiness would dress failure as absence. A
failed *reload* of a family that has data goes to `stale`, not `failed`:
the shown data is still real, merely no longer guaranteed current, and
discarding it (or presenting a failure screen over it) punishes the user
for a background refresh dying. Encode this as one shared
transition-on-failure function so every operation family answers it the
same way.

Two structural refinements carried over from hard experience:

- **The settled bit is sticky.** "Has this family ever completed at least
  once" is recorded and never unset; it is what makes "empty" assertable
  and what lets a remount distinguish *return visit* from *first visit*.
- **Failure carries its evidence.** The failed state holds the error (or a
  reference to it), because the consumer that renders failure needs the
  cause, and re-deriving it later is impossible.

The presentation this machine feeds — what a surface actually shows in each
state — is owned by the async-ui-states subject's
[state-model](../../async-ui-states/techniques/state-model.md); this
technique ends where truthful status is available to derive from.

## Key the machine by what runs concurrently

A status field's scope must match the concurrency of the operations it
tracks. The classic defect: one scalar `saving` flag for a list where each
row has its own save action. Two concurrent saves interleave —
`saving=true`, `saving=true`, first completes, `saving=false` — and the
second save now runs unmarked: its busy affordance vanished early, the
double-submit guard is down, and its completion writes bookkeeping that was
already cleared. The visual symptom (every row's button spinning when one
row saves) is the mild version; the corrupted lifecycle is the real cost.

The rule: **one machine per independently-running operation instance**,
which in practice means a map keyed by entity identity — statuses per
record id, per request key, per run. The key must be the durable identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse) governs
what qualifies), not an index or a name. Scalar status is correct only when
the domain genuinely serializes the operation (one global import job at a
time — and then the machine should also *enforce* that exclusivity by
rejecting a start while running).

Three disciplines keep keyed machines honest:

- **Composite keys guard their separator.** A key built as
  "family + separator + identity" collides the moment either component can
  contain the separator — two different (family, identity) pairs producing
  one string. Enforce the invariant at the single key-construction site
  (reject or escape), not by hoping identifiers stay clean; identifier
  schemes change, and the collision they cause corrupts a *different*
  entity's lifecycle, which is among the hardest defects to trace back.
- **Ambiguity is refused, not resolved arbitrarily.** When an operation
  addresses an entry with partial identity (family without instance) and
  more than one entry matches, refuse and demand the full key — loudly. The
  alternative, picking whichever match enumeration order yields, completes
  the *wrong* lifecycle: a finished run stays "running" forever while a
  live one is marked done, and the corruption is silent.
- **Entries name their reaper.** Statuses for deleted entities and
  completed transient operations are removed by the same operations that
  remove the entities — plus a staleness reaper for entries whose terminal
  transition can be lost in transit (a completion event that never arrived
  leaves a permanent "running" unless something bounds how long running can
  credibly last). Without both, the map is a leak of dead lifecycles that
  renders as phantom activity.

## Transitions are the API

Expose transitions, not the field. A slice operation per lifecycle event —
started, succeeded, failed, invalidated — each of which knows which source
states are legal and what else the transition implies (stamping timestamps,
clearing stale errors, recording the settled bit). Consumers never write the
status directly; that is the slice's
[one door](../../_laws.md#one-validation-door) doing its job.

Illegal transitions deserve a decision, not an accident. A completion
arriving in a state that should not receive one (see
[async-race-guards](async-race-guards.md) — usually a stale response) is
dropped as inert; a start arriving while running either joins the in-flight
attempt or replaces it, but explicitly. The one rule with no exceptions:
**an unexpected transition must never half-apply** — partial writes are how
machines end up in states not in the enumeration.
