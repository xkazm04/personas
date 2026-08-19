---
layer: technique
subject: client-state
technique: invalidation-strategy
status: forged
laws: [derivation-names-recomputation, gate-sees-target, creation-names-reaper]
shared_with: []
---

# Invalidation strategy

Cached server state is a stored derivation of remote truth, and like every
stored derivation it owes an answer to the question *how does this learn it
is wrong?*
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
A cache with no invalidation design has an answer anyway — "when someone
notices and restarts" — it is just not one anybody chose. This technique is
about choosing.

## The hierarchy of freshness mechanisms

From strongest to weakest, with the strong ones doing the work and the weak
ones demoted to backstops:

1. **Write-through from the client's own mutations.** When this client
   changes data, it knows — the completion handler patches or invalidates
   the affected cache entries directly. This path covers most staleness a
   user actually notices ("I just renamed it and the list still shows the
   old name") and requires no infrastructure at all. Getting it wrong is
   inexcusable; getting *only* it right is the common local maximum.
2. **Event-driven invalidation.** The system of record (or the process that
   fronts it) emits change facts — entity kind, identity, operation — and
   the client maps each fact to the cache entries it invalidates. This is
   the primary mechanism for changes the client did not make: other
   sessions, background jobs, scheduled work, collaborating users.
3. **Refetch triggers.** Coarse liveness heuristics — window regained
   focus, connection restored, navigation returned to a long-dormant view.
   Legitimate as *re-entry points* after a period of known blindness (focus
   loss, offline), not as the primary mechanism.
4. **The refetch floor.** A slow periodic revalidation whose only job is to
   bound the damage of a missed event. Its interval is set by asking "how
   stale is tolerable when everything above this failed?" — minutes, not
   seconds. A floor doing visible work (users noticing data update on the
   floor's cadence) is a monitor firing: some event above it is not being
   emitted or not being mapped, and the fix is there, not in tightening the
   interval.

Polling *as the primary mechanism* combines the worst of everything —
maximal request load and staleness still bounded only by the interval — and
one more cost that gets missed: it hides missing events. A product that
polls everywhere never discovers which change facts its backend fails to
emit, and the discovery arrives years later, as an architecture problem,
when polling finally has to be removed for load reasons.

## Events that can be acted on

An invalidation event is useful in proportion to the precision of its
claim. "Something changed" forces the client to invalidate everything —
one such event per second equals no cache at all. The event contract that
makes surgical invalidation possible:

- **what kind** of entity changed (names the cache families affected);
- **which one** — the durable identity (names the entries);
- **what happened** — created, updated, deleted, plus the fields or facets
  affected when cheap to include (decides patch vs invalidate, and whether
  list membership changed or only row content).

Deletion events deserve explicit care: they must *remove* entries and
propagate to state that references the deleted identity (selections,
statuses keyed by it, open editors), not merely mark a cache entry stale —
a stale entry for a deleted entity refetches into a not-found error;
dangling references resurrect it as a ghost.

Two delivery caveats, both instances of
[gate-sees-target](../../_laws.md#gate-sees-target): the event stream is a
proxy for the authority's change history, so (a) events can be lost —
disconnections need a mark-all-suspect-and-revalidate on reconnect, since
the client cannot know what it missed; and (b) events can arrive for
entities the client has never seen — invalidating a nonexistent entry must
be a no-op, not a fetch trigger that turns the event stream into a firehose
of prefetches.

## Patch or invalidate

On learning of a change, the client either **patches** the cached entry
from the event payload or **invalidates** and refetches:

- Patch when the event carries the full new truth for what it names and
  the client's rendering derives from exactly that. Cheap, instant, no
  request — and quietly dangerous: a patch path is a second writer of
  cached truth, and it drifts from the fetch path's shape the release
  after someone changes one and not the other.
- Invalidate-and-refetch when the event is a notification rather than a
  payload, when derived server-side fields accompany the change, or when
  ordering matters (two patches applied out of order produce a state the
  authority never held; a refetch cannot).

The safe default is invalidate; patch is an optimization adopted per entry
kind, with the drift risk owned. Hybrid is often right: patch the visible
list row for immediacy, invalidate the detail entry behind it.

Refresh failures scope to what was refreshed. One entity's failed
revalidation marks *that entry* suspect and keeps the rest of the family
loaded; flipping a whole family's status because one member's refetch died
converts a scoped problem into a page-wide one, and the family-level
failure presentation then lies about every entry that is still current.

## Keys are the invalidation surface

Surgical invalidation presupposes that cache keys were designed for it. The
key schema is a hierarchy — family, then identity, then variant (filter,
page, scope) — so that an event naming an entity can address "every variant
of this entity" and "every list that could contain it" without enumerating
them. Design the key schema and the event contract together; they are two
halves of one addressing scheme. Keys also obey the same identity law as
everything else: durable identities, never indexes or display names.

Variant explosion is the failure mode: keys embedding volatile arguments
(free-text search terms, cursor positions) accumulate entries no event will
ever name again. Volatile variants get short lifetimes and eviction by
recency, and the eviction policy is part of the invalidation design —
every entry names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)).

## Invalidation is not display

This technique decides *when cached truth is suspect and how it is
refreshed*. What the user sees during a revalidation — held content with
ambient refresh, never a placeholder over data — is the async-ui-states
subject's contract (its
[state-model](../../async-ui-states/techniques/state-model.md) `refreshing`
state). The two connect through the status machine: invalidation moves
entries from loaded to stale; it never blanks data.
