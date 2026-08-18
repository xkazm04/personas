---
layer: technique
subject: client-fetch-cache
technique: warm-remount-caches
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Warm remount caches

Views die on navigation. In an application whose sections load lazily and
unmount fully when the user leaves them, every piece of view-held state —
including the fetched data — dies with the view, and the user's return is
greeted with a ghost for data the application displayed intact ten seconds
ago. The fetch was cheap; the *forgetting* is what the user feels.

The fix is a **module-scoped last-result cache**: a small map, keyed by
entity or query, living at module scope beside the fetch logic, holding
the most recent successful result. Module scope survives the view — that
is the entire point — so a remount reads the cache synchronously, paints
warm on first render, and revalidates behind the paint.

The minimal honest form is a **single slot**: one last result plus the key
it belongs to. Bounded at one entry by construction, no eviction policy
needed, and the key comparison on read ("is this cached result *mine*?")
carries the whole correctness burden — a return to the same scope paints
warm, a switch to a different scope correctly starts cold rather than
flashing a neighbor's data. Reach for the map only when the working set
genuinely holds several scopes at once; the slot is not a lesser version,
it is the right size for "the view the user just left." This is
stale-while-revalidate ([swr-design](swr-design.md)) applied across the
view's own lifetime rather than across a timer: the "stale read" trigger
is the remount itself.

## The warm paint is a stale paint

The remount must not *pretend* the cached data is fresh. Two obligations:

- **Revalidate on every warm paint** (subject to the fresh-window
  economics — a remount two seconds after unmount can skip the refetch; a
  remount an hour later must not). The cache buys instant orientation; the
  refetch buys correction; the pattern requires both.
- **Tell the status layer the truth.** "Painting from cache, refreshing"
  is a different state from "fresh" and from "loading with nothing" — the
  presentation layer downstream decides whether to show a subtle refresh
  affordance or nothing at all, but it can only decide honestly if the
  fetch layer distinguishes the states. Collapsing warm-stale into
  "loaded" is how month-old data ends up wearing a fresh face after the
  revalidation quietly fails.

The don't-refetch-if-loaded guard deserves its own caution. Skipping the
fetch when data already exists is correct as a *fresh-window* decision and
wrong as a *permanent* one: a boolean "loaded" latch with no age attached
converts the warm cache into a never-refreshes cache after the first
visit. The guard's question is "is this fresh enough," never "has this
ever loaded."

## What may live at module scope

Module scope is the least governed lifetime in a client — nothing unmounts
it, nothing resets it, everything can import it. The privilege is earned
by keeping the tenants boring:

- **Snapshot data only** — plain, serializable last-results. Live handles,
  subscriptions, and timers have lifecycles and belong to the singleton
  discipline in the client-state subject, not in a passive cache.
- **Keyed and bounded.** Keyed by entity identity
  ([cache-key-discipline](cache-key-discipline.md)) and capped, because the
  key population grows with every entity the user visits and module scope
  outlives them all. An uncapped warm cache is the textbook slow leak
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)): name the
  cap and the eviction order at the declaration site.
- **Scoped to one request family.** One module, one cache, one shape. A
  shared "misc warm data" bag becomes an untyped second store with no
  owner.
- **Cleared on identity change.** Module scope happily outlives a logout.
  A warm cache that survives an identity switch paints the previous
  identity's data for the next one — the cross-identity leak from the
  collision audit, arrived at through lifetime instead of key. Identity
  change either clears these caches or is an axis in their keys; something
  must enforce whichever is chosen.

Two environmental caveats inherit from module lifetime: under live code
replacement in development, module state duplicates rather than resets
(the general treatment is the singleton-lifecycle territory of
[client-state](../../client-state/client-state.md)); and under test, a
module cache leaks between cases unless it exposes a reset hatch. A warm
cache is state; it needs the hatch.

## Deletion and invalidation reach module scope too

The warm cache is a cache, and the event stream must be able to correct
it. The embarrassing failure is entity deletion: the user deletes an
entity elsewhere, navigates back, and the warm cache faithfully repaints
the deleted entity — a ghost with full fidelity, corrected only when the
revalidation lands (or not corrected, if the guard above latched). Wire
the module cache into the same invalidation surface the store caches use
(the strategy is
[invalidation-strategy](../../client-state/techniques/invalidation-strategy.md)):
a deletion event drops the key; an update event drops or patches it. A
cache reachable only by its own remount-revalidation is a cache the event
system cannot correct, and it will be the last surface in the application
to learn any fact.

## Decision rules

- One module-scoped map per request family, keyed by entity, size-capped,
  holding plain snapshots only.
- Paint warm synchronously on remount; revalidate unless within a declared
  fresh window. Never guard with an ageless "already loaded" boolean.
- Report warm-stale as its own status; do not impersonate fresh.
- Subscribe the cache to deletion/update invalidation; remount
  revalidation is the floor, not the mechanism.
- Clear on identity change, or key by identity — and point to the code
  that enforces it.
- Expose a test reset hatch; module state with no reaper and no hatch is
  a leak in production and a poltergeist in tests.

## Boundary — the cost this eliminates is a network round-trip

Warm-remount and SWR earn their complexity against a *network* fetch: the
round-trip is the expense worth caching past an unmount. Against a cheap
local-first store — an embedded database, a local key-value store, a synchronous
module read — a re-read on remount costs microseconds, and a warm module cache
adds invalidation surface for no latency saved. Scope the claim to network-backed surfaces. A local-first view
that "re-reads on every remount" is not missing this technique; it is correctly
declining a cache it does not need — and if one genuinely expensive operation
exists (a live run that must survive remount), cache *that* above the component,
not the whole read path.
