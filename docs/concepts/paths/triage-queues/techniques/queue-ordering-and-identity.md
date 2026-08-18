---
layer: technique
subject: triage-queues
technique: queue-ordering-and-identity
status: forged
laws:
  - identity-survives-reuse
shared_with: []
---

# Queue ordering and identity

A triage queue is a live collection under concurrent mutation: producers
insert while the operator works, verdicts remove items mid-pass, refreshes
replace the underlying arrays wholesale. The two properties that keep the
surface coherent through all of that are a deterministic ordering policy
and per-item identity that nothing can shake. They are one technique
because each is worthless without the other: stable identity with unstable
order makes the queue feel haunted; a beautiful ordering keyed by position
collapses the first time an item is removed from the middle.

## Ordering is policy, and policy is total

The queue's order is an assertion about what the operator should handle
first. Encode it as an explicit comparator built from named tiers —
severity first, then age, then a domain-specific impact signal, with a
final tiebreak on identity so the ordering is *total*. Totality is not
pedantry: two items that compare equal are ordered by whatever the sort
implementation happened to do, which differs across runs and platforms, and
"the queue shuffles a little every refresh" is exactly the haunting the
technique exists to prevent. Every item must have a defined position, the
same one every time, on every machine.

Three policy rules that recur across domains:

- **Severity dominates age** — an old low item never outranks a fresh
  critical one; but **within a severity tier, oldest first**, or the queue
  becomes a stack and old items starve forever behind the arrival stream.
- **Deferral sorts last, never hides.** If the operator can skip or snooze
  an item (see [focus-mode](focus-mode.md)), the item moves to the end of
  the ordering — it does not leave the collection. Hidden items are the
  queue lying about its own size.
- **The operator adjusts by filter, not by re-sort.** Narrowing to one
  source or one severity respects the policy inside the subset; free
  re-sorting silently repeals the policy. If a genuine second ordering is
  needed (a review-by-source pass), make it a named mode, not a column
  click.

## Identity is minted by the source, qualified by the adapter

Each item's key is the source's own durable identifier, prefixed or
namespaced by the source tag. Never mint identity in the aggregation layer
from position, arrival time, or content hash: positions shift on every
mutation, arrival times collide and change across refreshes, and content
hashes change exactly when a producer updates an item in place — which is
precisely the moment identity must *hold* so the update lands on the item
rather than duplicating it
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

Identity is what makes every other behaviour possible: refresh reconciles
new data onto existing items instead of rebuilding the world; selection
survives a background update; the focus cursor survives an insertion; a
verdict in flight targets the item, not whatever now sits at its index.

## Cursors are removal, not index

The canonical mistake in any worked-through-queue is tracking progress as
an integer index into the ordered array. The array is not stable — that is
the premise of the whole technique — so the index dereferences to a
different item after any insertion, removal, or reorder above the cursor.
The failure is silent and vicious: the operator verdicts item seven, the
array shifts, and their next keystroke verdicts an item they never saw.

The correct model has no index at all. Progress is **removal from a
remaining-set**: the queue holds the set of unresolved item identities; the
current item is *the first remaining item under the ordering*; a verdict
removes an identity from the set; the next item is again the first
remaining. Insertions and reorders are automatically harmless — the
ordering simply re-evaluates over the remaining set. Deferred items are the
one nuance: they stay in the set, deprioritized by the ordering's deferral
rule, so the "first remaining" definition handles them with no special
case.

When the operator can *jump* — pick an item mid-list and continue from
there — keep **order and position as separate concerns**. Position is a
cursor holding an item *identity*, resolved to its place in the ordering at
render time; jumping moves the cursor and reorders nothing. The tempting
alternative — hoisting the picked item to the front — silently renumbers
the list around the operator's own click, and the queue they were reading
is no longer the queue in front of them. A cursor whose identity no longer
projects (decided elsewhere, filtered away) falls back to the front: one
rule covers resolution, filtering, and walking off the end.

## Grouping versus flat

Grouping (by source, by severity, by affected entity) helps a *scanning*
operator build a mental map and helps bulk verdicts find their natural
batch boundaries. It must remain a **presentation fold over the same
ordered set** — the moment groups become separate collections with separate
cursors, the queue has quietly become N queues again, and the global
ordering policy (the whole point of fusion) no longer holds anywhere. Flat
ordering with visual group headers keeps one truth; collapsed groups must
still count toward the headline number, or collapsing becomes a way to
hide work from the surface whose job is to show it.
