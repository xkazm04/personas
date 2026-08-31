---
layer: golden-path
subject: client-fetch-cache
status: forged
techniques:
  - swr-design
  - in-flight-dedup
  - cache-key-discipline
  - warm-remount-caches
  - prefetch-and-defer
  - parse-and-derive-caches
evidence:
  - src/lib/utils/staleWhileRevalidate.ts                                        # SWR: fresh window, stale-serve + background revalidate, fused keyed dedup, 500-entry insertion-order eviction, invalidate door, test clear hatch
  - src/lib/utils/deduplicateFetch.ts                                            # keyed in-flight dedup; settle-time removal on success AND failure
  - src/lib/async/createCachedFetch.ts                                           # slice-seam dedup + TTL; freshness stamped only on success; declares its seam vs the transport-level auto-dedup
  - src/lib/async/createTtlValueCache.ts                                         # module-scoped value cache with TTL + per-key invalidation, extracted from two inline precedents
  - src/hooks/utility/data/useModuleSubscription.ts                              # createModuleCache: keyed module cache with TTL + maxSize eviction + invalidate/invalidateAll, paired useSyncExternalStore subscription hook; preferred for multi-entry value caches (added 2026-08-30, found late — see shared-fetch-cache.md §12.10)
  - src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx # single-slot warm-remount cache keyed by scope; warm paint, silent refresh behind, never flashes a neighbor's data
  - src/features/plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx               # warm-remount precedent (unkeyed, correct: data is app-global); always revalidates on mount
  - src/features/overview/sub_certification/useCertificationData.ts             # idle-deferred first load with timeout fallback and unmount cancellation
  - src/i18n/useTranslation.ts                                                   # intent prefetch with debounce delay + cancel; loads explicit, read path pure (render-storm lesson)
  - src/features/templates/sub_generated/gallery/cards/reviewParseCache.ts       # reference-keyed derive cache; weak map makes GC the reaper; lazy heavy tiers on expansion
  - src/features/agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx    # TTL + cap output cache; expiry sweep on write, LRU via re-insertion
counter_evidence: []
deviations:
  - w10-client-fetch-cache   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Client data fetching & caching

Every client that talks to an authority holds a cache, whether or not anyone
designed one. The moment a response is kept in memory past the call that
produced it — in a store, in a component, in a closure — the client is
caching, and all the classic cache questions apply: what identifies an entry,
how long is it believable, who throws it away, and who else is asking for the
same thing right now. A fetch layer that grows by accretion answers none of
them, and the symptoms are recognizable from across the room: three widgets
on one screen issuing three identical requests at mount; a view that re-loads
cold every time the user navigates back to it, showing a ghost for data the
application held two seconds ago; a refetch storm on every window focus; a
memory footprint that only ever grows because nothing evicts.

This subject owns the layer between the surfaces and the transport: how
requests are issued, shared, remembered, and kept warm. Its neighbors own the
rest, and the boundaries matter. The *structure* of the store the fetched
data lands in, and the strategy by which cached truth learns it is wrong, are
[client-state](../client-state/client-state.md) — specifically its
[invalidation-strategy](../client-state/techniques/invalidation-strategy.md)
and [async-race-guards](../client-state/techniques/async-race-guards.md).
What the surfaces *show* while a fetch is in flight — ghosts, warm paints,
failure presentation — is
[async-ui-states](../async-ui-states/async-ui-states.md). The general
discipline of "one flight per key" across processes and job runners is
[concurrency-guards](../concurrency-guards/concurrency-guards.md) — this
subject's request dedup is the client dress of its
[single-flight-primitives](../concurrency-guards/techniques/single-flight-primitives.md).
And the call itself — the wrapper every request passes through, its timeout
and error shaping — is [ipc-contract](../ipc-contract/ipc-contract.md)'s
[call-wrapping](../ipc-contract/techniques/call-wrapping.md). This subject
sits on top of that wrapper and below those stores and surfaces.

## Stale-while-revalidate is the honest default

For read surfaces, the default policy is **paint what you have, refresh
behind, and never block the paint on freshness you do not need**. A cached
answer that is minutes old is almost always more useful *right now* than a
blank region that will be authoritative in four hundred milliseconds — the
user gets orientation instantly and correction shortly, instead of nothing
and then everything.

The policy has three zones, and naming them is most of the design. Within
the **fresh window**, serve the cached value and do not fetch — the entry is
recent enough that a refetch is pure waste. Within the **stale window**,
serve the cached value *and* start a background revalidation — the paint is
instant, the correction arrives behind it. On a **miss** (or past any hard
expiry), fetch before anything can be served — and what the surface shows
during that gap is async-ui-states' problem, fed honestly: "showing cache,
refreshing" and "have nothing yet" are different states and the status layer
must distinguish them.

Blocking on freshness is the exception that must be argued for, and it has
legitimate cases: a value about to be *acted on* rather than looked at — a
balance before a transfer, a permission before an irreversible operation.
The test is consequence, not habit: reads feeding decisions may demand
freshness; reads feeding orientation almost never do. The full shape — TTL
selection, revalidation triggers, eviction, and failure handling that keeps
stale truth visible — is the [swr-design](techniques/swr-design.md)
technique.

## Every cache declares three policies

A cache is not a map with optimism. It is a map plus three declared
policies, and a cache missing any one of them is either a leak or a lie:

- **Key** — what identifies an entry. The key must be derived from *every*
  argument that changes the answer; an under-specified key silently serves
  one question's answer to a different question, which is the lie. Key
  derivation, canonical serialization, versioning on shape change, and the
  collision audit are [cache-key-discipline](techniques/cache-key-discipline.md).
- **Lifetime** — when an entry stops being believable: a TTL, an
  invalidation event, or both. An entry with no lifetime is asserted to be
  true forever, which no server-owned datum is.
- **Eviction** — when an entry is removed regardless of believability,
  because memory is finite. A cache keyed by an unbounded population
  (entities, queries, users) with no size cap is the leak; every cache names
  its reaper at creation
  ([creation-names-reaper](../_laws.md#creation-names-reaper)).

The discipline is to state all three at the cache's construction site — as
configuration, not as folklore. A reviewer looking at a new cache should be
able to read its key rule, its lifetime rule, and its eviction rule without
reading its callers.

The machinery itself is subject to the same law that governs vocabularies
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)):
the cache and dedup primitives are built **once**, as a small named set, and
every new surface adopts from the set. Left to accretion, a codebase grows
one caching micro-primitive per team per quarter — overlapping remits,
subtly different policies, each new call site choosing by folklore — and
the population becomes large enough that even a deliberate audit misses
members. Where more than one primitive legitimately exists, each declares
its **seam** (transport-level burst collapse, fetch-level keyed sharing,
value-holding module cache) and how it composes with the others; two
primitives at one seam is one too many.

## Duplicate in-flight requests join, not race

When two callers ask the same question while one flight is already in the
air, the correct behavior is for the second to **join** the first: one
request leaves the client, both callers receive the answer, and both receive
the *failure* if it fails. The accretion default — both fetch — is not just
wasteful; it creates ordering races between identical requests and doubles
load exactly when the system is busiest (a screen full of components
mounting at once is the peak, and it is also when every component asks).

Dedup lives **at the fetch layer, keyed by request identity**, so that every
caller gets it without opting in — a view-level guard protects one call site
and nothing else. It is the join policy of the general single-flight
primitive, specialized to the client's promise-shaped reads; the general
acquire/refuse/queue forms belong to
[single-flight-primitives](../concurrency-guards/techniques/single-flight-primitives.md).
And it must not be confused with its sibling guard: dedup shares one answer
between *concurrent identical* questions; latest-wins tokens arbitrate
between *successive different* questions competing for one slot. A mature
fetch layer has both, and they are different tools —
[async-race-guards](../client-state/techniques/async-race-guards.md) owns
the latter. The registry mechanics, failure fan-out, and the boundary with
idempotency are [in-flight-dedup](techniques/in-flight-dedup.md).

## Warmth is designed

Cold paints are not weather; they are decisions someone failed to make. A
client that is fast in the small — every individual fetch quick — can still
feel slow everywhere if every navigation starts from zero. Warmth is
engineered at three points in time:

- **After the data has been fetched once**: keep it somewhere that survives
  the view. Views die on navigation; module scope does not. A module-scoped
  last-result cache keyed by entity lets a remount paint warm immediately
  and revalidate behind — the stale-while-revalidate policy applied across
  the view's own lifetime. What may live at module scope, and how a warm
  cache learns its entity was deleted, is
  [warm-remount-caches](techniques/warm-remount-caches.md).
- **Before the user commits**: intent signals — hover, focus, the beginning
  of a navigation gesture — arrive hundreds of milliseconds before the
  action they predict. Prefetching on intent converts that dead time into a
  warm cache, so the commit paints instantly.
- **After the critical paint**: data below the fold or behind a secondary
  tab does not deserve a slice of the first paint's budget. Defer its first
  load to idle time, guarded so it runs once — deferred, not forgotten.

Prefetch and deferral are two ends of one priority scheme — pull forward
what intent predicts, push back what the paint does not need — and they are
the [prefetch-and-defer](techniques/prefetch-and-defer.md) technique.

## The cache is subordinate to events

A TTL is a confession of ignorance: "absent better information, distrust
this after N seconds." When better information exists — the system that
changed the data *says so* — the event wins over any timer, in both
directions: a pushed invalidation empties or patches the entry immediately
even if its TTL had minutes to run, and an entry recently confirmed by an
event does not need its timer-driven refetch. A fetch layer that polls hard
while ignoring the event stream has the priorities inverted — maximal load,
and staleness still bounded only by the interval.

The strategy — what events carry, patch versus invalidate, and the slow
refetch floor that survives as a backstop for missed events — is owned by
the store's
[invalidation-strategy](../client-state/techniques/invalidation-strategy.md).
This subject's obligation is structural: every cache built here exposes an
invalidation surface (drop this key, drop this prefix, patch this entry)
that the event side can drive. A cache that can only expire is a cache the
event system cannot correct.

## Not all caches face the network

The same economics apply one layer down: an expensive parse, a heavy
derivation, a transformation of content the client already holds. The input
crossed no boundary, but recomputing it on every render burns the frame
budget just the same. These caches are simpler than fetch caches in one
deep way — keyed by **content identity**, their entries are immutable, so
lifetime collapses to "forever" and the only live policy is eviction — and
they carry one law-shaped obligation: the cache is pure acceleration, and
the recomputation path must remain named and invokable
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
The shape is [parse-and-derive-caches](techniques/parse-and-derive-caches.md).

## The techniques

- [swr-design](techniques/swr-design.md) — the three freshness zones, TTL
  selection, revalidation triggers, size-capped eviction, failure that
  keeps stale truth visible.
- [in-flight-dedup](techniques/in-flight-dedup.md) — the keyed join
  registry, settle-time cleanup, failure fan-out to all joiners, the
  dedup-versus-idempotency boundary.
- [cache-key-discipline](techniques/cache-key-discipline.md) —
  argument-derived keys, canonical serialization, key versioning on shape
  change, the collision audit.
- [warm-remount-caches](techniques/warm-remount-caches.md) — module-scoped
  last-result caches, what may live at module scope, staleness marking on
  the warm paint, deletion propagation.
- [prefetch-and-defer](techniques/prefetch-and-defer.md) — intent-driven
  prefetch, idle-deferred first loads, the priority order between them.
- [parse-and-derive-caches](techniques/parse-and-derive-caches.md) —
  memoized parses and derivations keyed by content identity, bounded and
  recomputable.
