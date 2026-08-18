---
layer: golden-path
subject: client-state
status: forged
techniques:
  - store-slicing
  - status-fsms
  - async-race-guards
  - persistence-and-migration
  - invalidation-strategy
  - singleton-lifecycle
evidence:
  - src/stores/slices/processActivitySlice.ts                  # keyed status FSM: exhaustive vocabulary, per-run keying, separator guard, stale reaper
  - src/stores/agentStore.ts                                   # sliced composition + persistence allowlist (partialize) + in-band shape migration
  - src/stores/util/latestWins.ts                              # the latest-wins token guard, centralized so the comparison direction is right once
  - src/lib/utils/deduplicateFetch.ts                          # in-flight dedup keyed by argument; entry removed on settle (success AND failure)
  - src/stores/util/dedupedStorage.ts                          # storage write dedup: compare serialized payload before writing
  - src/lib/execution/executionSink.ts                         # generation counter making stale singleton copies inert (module const, no global)
  - src/features/teams/sub_mastermind/lib/sceneStore.ts        # per-family status FSM incl. stale-on-failed-reload; surgical invalidation; refetch floors
  - src/stores/slices/agents/matrixBuildSlice.ts               # domain drafts persisted to the app's real datastore, not client storage
  - docs/concepts/golden-paths/hmr-safe-singletons.md          # measured singleton census: 25 global keys / 13 state slots; refcount-vs-latch discriminator
counter_evidence:
  - src/stores/slices/system/tourSlice.ts                      # slice hand-rolls its own storage key beside the store's persist layer — two writers for one persisted state
deviations:
  - w3-client-state   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Client state management

A long-lived client application accumulates state the way a building
accumulates wiring: continuously, under deadline, by many hands, and with
every shortcut invisible until something shorts. The failures that emerge at
scale — a stale list that never learns its row was deleted, a busy flag that
one late response turns off while another request is still running, a
persisted blob that crashes the app on the release after its shape changed,
two copies of a live buffer double-applying every event after a development
reload — are not random. They trace to a small set of structural decisions
made (or defaulted) early: what kind of state each datum is, who owns it,
how it is subscribed to, whether its lifecycle is explicit, what earns
persistence, and how cached truth learns it is wrong.

This subject owns how client state is **structured, persisted, and
invalidated**. What the surfaces *show* while state is in flight — ghosts,
busy affordances, empty and failure presentation — is owned by
[async-ui-states](../async-ui-states/async-ui-states.md); the boundary is
that this subject produces the truthful status a surface derives its
presentation from, and that subject spends it.

## The three species of state

The first structural decision precedes any store, library, or pattern:
**classify every datum by who owns its truth.** The three species have
different lifecycles, different failure modes, and different correct
treatments, and most chronic state bugs are a species error — one kind
handled with the machinery of another.

**Server state** is a *local cache of truth owned elsewhere*. The list of
records, the entity detail, the account profile: the authoritative copy
lives across a boundary, and the client's copy is a snapshot that started
aging the moment it arrived. Everything difficult about server state follows
from cache-hood: it can be stale, it can be refetched, concurrent requests
for it can land out of order, and local edits to it are *staged intents*
awaiting reconciliation, not truth. The design problems are freshness and
invalidation — never "where do I put it".

**Client state** is truth *born in the client*: the current selection, an
unsaved draft, panel sizes, an in-progress wizard, which sections are
collapsed, the active filter set. There is no authority to refetch it from;
losing it destroys user work or context outright. Its design problems are
scope (which lifetime does it belong to — a view, a session, the
installation?) and persistence (what deserves to survive a restart).

**Derived state** is computed from the other two: the filtered-and-sorted
view of a cached list, the count of unread items, the "can submit" flag that
is really five validations conjoined. The rule for derived state is the
oldest one in the discipline: **derive at read time; do not store**. A
stored copy of a computable value is a second authority that will disagree
with the first — the classic symptom is a badge count that no longer matches
the list it summarizes. When cost genuinely forces materialization, the
stored value names how it is recomputed and when
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)),
because a cached derivation without an invokable recomputation path is a
future discrepancy with no arbiter.

Species errors, for recognition:

| Error | Symptom |
| --- | --- |
| server state treated as client state | data loaded once and never invalidated; the app shows deletions and edits from nowhere but its own session |
| client state treated as server state | selections and drafts round-tripped through a remote authority; latency in interactions that should be instant; user context lost to a failed request |
| derived state stored | counts, flags, and rollups that drift from the data they summarize; "refresh fixes it" |
| derived state persisted | stale computations resurrected across restarts, outliving the inputs that produced them |

## The store is a sliced composition

A single global store is right for exactly one reason: one place to look.
A single global *module* is wrong for the same reason a single source file
is: every domain's churn lands in one hotspot, ownership blurs, and any
change risks everything. The resolution is **one store, many slices** — each
slice a self-contained unit owning one domain's state and every mutation of
it, composed into the store at creation.

Two disciplines make the composition hold at scale:

- **Selective subscription.** A consumer subscribes to the narrowest
  projection it reads, not to the store. Coarse subscription is the quiet
  performance cliff of centralized state: every write anywhere re-renders
  every reader everywhere, and the cost arrives gradually enough that no
  single change gets blamed.
- **Mutations live with their slice.** Every write to a slice's state goes
  through operations the slice itself defines — the slice is the one
  validation door for its domain, and its writers are enumerable
  ([one-validation-door](../_laws.md#one-validation-door)). External code
  requests changes; it never reaches in.

Slices need to talk — completing a run updates activity, changing a
selection resets dependent panels — and cross-slice coupling is where sliced
designs rot back into a monolith. The patterns that keep the seams clean are
the [store-slicing](techniques/store-slicing.md) technique.

## Status is a machine, not a pile of booleans

Every asynchronous family of operations — loading a collection, saving an
entity, running a job — has a lifecycle, and the lifecycle is a small finite
state machine whether or not the code admits it. The anti-pattern is the
**boolean soup**: `isLoading`, `hasLoaded`, `isError`, `isRefreshing`
accumulated one bugfix at a time, encoding sixteen representable
combinations of which perhaps five are meaningful and none are named.

The standard is an **explicit status value per operation family** — one
field holding one of an enumerated set of states, with the legal transitions
known — and, critically, **keyed per entity** when operations run
concurrently: a scalar `saving` flag shared by twenty rows lights up all
twenty when one saves, and the second concurrent save corrupts the first's
bookkeeping. Failure is a distinct state carrying its evidence, never
"loaded, but with a flag"
([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

The FSM lives in the state layer as *truth*; the presentation layer derives
what to show from it. That derivation — placeholders, busy affordances,
empty-vs-failed presentation — is
[async-ui-states](../async-ui-states/async-ui-states.md)' state model, which
this machine feeds. The design of the machine itself — state sets, keying,
transitions, and the sticky settled bit — is the
[status-fsms](techniques/status-fsms.md) technique.

## Concurrency: last to arrive is not newest

Requests resolve out of order. The user types "ab", then "abc"; the "abc"
response arrives first; the "ab" response arrives second and overwrites the
better answer. This is the fundamental race of client state, it needs no
exotic timing — one slow response is enough — and no store design prevents
it: it is defeated only by **guards at the write site**.

The two standing guards:

- **Latest-wins tokens.** Each request family holds an identity for the most
  recent request; every response checks its own identity against the current
  one before writing, and a stale response is *inert, not an error*.
- **In-flight deduplication keyed by argument.** Concurrent identical
  requests share one flight; the key includes every argument that changes
  the answer, or two different questions share one answer.

These are the same family as run attribution in streaming systems — where
events, not responses, must be matched to the run that produced them, and
where the consumer additionally needs generation guards against its own
resubscription lifecycle; that elaboration is
[run-attribution](../streaming-output/techniques/run-attribution.md). The
request-shaped forms — tokens, keyed dedup, out-of-order handling, and where
each guard belongs — are the
[async-race-guards](techniques/async-race-guards.md) technique.

## Persistence is a versioned contract

Everything persisted is a message to a future version of the application,
which will be running different code. The moment state outlives the process,
its shape becomes a **contract**, and contracts need versioning: a version
stamp written with the data, and **migrations** that carry each historical
shape forward step by step. The alternative — rehydrating yesterday's shape
into today's assumptions — produces the worst bug class in client software:
crashes and corruption that only occur on *upgraded installations*, which is
to say only in the field, never on a developer's fresh profile.

Persistence is also earned, not defaulted — and it starts with the same
question as everything else in this subject: *who is the authority?* Server
state generally does not earn client persistence (the authority is a refetch
away; a persisted copy is a second cache with independent staleness); secrets
never earn general-purpose storage; derived state never earns it; and when
the application has a durable datastore of its own within reach, anything
whose loss would genuinely be felt belongs *there*, with client-local storage
demoted to a cache. What remains for the client-local contract — durable
preferences, small drafts, layout — is small, and keeping it small is the
discipline that keeps migrations tractable. Rehydration is an untrusted read: validated, bounded,
and failing toward defaults rather than toward a crash. The full contract —
selection, versioning, migration chains, rehydration validation, and
write-path hygiene — is the
[persistence-and-migration](techniques/persistence-and-migration.md)
technique.

## Invalidation: events over polling

A cache of server state is wrong the moment the authority changes; the
question is how the client finds out. Polling — refetch on a timer, refetch
on every focus, refetch on navigation — is the default that emerges without
design, and it combines the worst properties: maximal load, and staleness
still bounded only by the interval.

The standard is **event-driven, surgical invalidation**: the system that
changes data emits the fact that it changed, carrying enough identity to
name *what* changed, and the client invalidates or patches exactly the
affected entries. Polling survives only as a demoted backstop — a slow
refetch floor that catches missed events, not the primary freshness
mechanism. Cache keys, patch-vs-invalidate, event granularity, and the floor
are the [invalidation-strategy](techniques/invalidation-strategy.md)
technique.

## Module lifetime and the replacement hazard

Some state cannot live in the store: a live connection, an event buffer
pumping at high frequency, a registry of timers. The pragmatic home is
**module scope** — created once when the module loads, imported everywhere.
The hazard is that "once" is a lie in two environments: during development,
live code replacement re-evaluates modules, producing a *second* instance
while the first — and everything holding a reference to it — lives on; and
under test, module state leaks between cases that assume a fresh world.

The failure is duplication, not absence: two buffers each applying every
event, two schedulers each firing every timer. The structural answer is to
make **stale copies inert rather than trying to prevent their existence** —
a generation token that each instance captures and checks, so a superseded
copy's callbacks become no-ops — plus an explicit reset hatch for tests,
because a singleton without one forces every test to inherit its
predecessor's world ([creation-names-reaper](../_laws.md#creation-names-reaper)).
Placement (module vs global scope), the generation pattern, and the
discriminator for which globals are actually state are the
[singleton-lifecycle](techniques/singleton-lifecycle.md) technique.

## The techniques

- [store-slicing](techniques/store-slicing.md) — slice boundaries, selective
  subscription, cross-slice signals without import cycles.
- [status-fsms](techniques/status-fsms.md) — enumerated status per operation
  family, per-entity keying, legal transitions, failure as a state.
- [async-race-guards](techniques/async-race-guards.md) — latest-wins tokens,
  in-flight dedup keyed by argument, out-of-order response handling.
- [persistence-and-migration](techniques/persistence-and-migration.md) —
  what earns persistence, versioned shapes, migration chains, rehydration
  validation.
- [invalidation-strategy](techniques/invalidation-strategy.md) —
  event-driven surgical invalidation, cache keys, refetch floors.
- [singleton-lifecycle](techniques/singleton-lifecycle.md) — module state
  under live replacement, generation counters, the test-reset hatch.
