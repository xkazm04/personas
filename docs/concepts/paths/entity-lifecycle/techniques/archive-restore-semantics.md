---
layer: technique
subject: entity-lifecycle
technique: archive-restore-semantics
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Archive / restore semantics

Archive is the lifecycle's reversible promise: the entity keeps its
identity, content, and relationships; it leaves the default views and
stops acting; restore brings it back whole. The promise sounds simple
and is not, because "stops acting" and "comes back whole" each hide an
enumeration most teams skip — and every behavior left unenumerated is a
behavior that will surprise someone, in production, with an archived
entity doing (or failing to do) something nobody decided.

## The archived-behavior matrix

For every behavior the entity participates in, the design states what
archived means — a table, written once, owned next to the entity's
definition:

- **Visibility**: filtered from default lists and pickers; reachable
  through an explicit "show archived" affordance. An archived entity
  that still appears in a selection dropdown is a bug; one that cannot
  be found *anywhere* is indistinguishable from deleted, which breaks
  the promise in the other direction.
- **Activity**: automations, schedules, and subscriptions held by the
  entity do not fire. This is usually the *reason* for archiving — quiet
  without destruction — and it is the clause most often missed, because
  the firing paths query the entity table directly and each one must
  honor the archived predicate.
- **Referential duties**: things that reference the archived entity keep
  working — history renders, links resolve (to a clearly-archived
  surface, not a not-found error). Archive never breaks inbound edges;
  that is delete's territory.
- **Resource claims**: does an archived entity still hold its unique
  name? Count against quotas? Consume a license seat? Each is a product
  decision; the technique's demand is only that each is *decided* and
  the decision is discoverable.

The predicate "is this entity visible/active?" is defined **exactly
once** and every consumer derives from it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The characteristic decay of archive features is each list, each firing
path, and each counter re-implementing "where not archived" by hand
until one of them doesn't — centralize the predicate in the data-access
layer or a single shared filter, and treat a hand-written archived check
in a caller as a review flag.

## Flag versus status

Two encodings compete. A dedicated **archived-at timestamp** (absent =
live) is the stronger default: it is simultaneously the flag, the audit
fact (when), and — paired with an archived-by — the attribution; it
composes with an existing status enum instead of fighting it; and it
cannot collide with the entity's domain states. Folding "archived" into
a status enum that also holds domain states (draft, active, failed)
tangles two vocabularies — one describes what the entity *is doing*, the
other whether it *participates at all* — and every status transition
now has to reason about whether it may overwrite archival. Keep the
axes orthogonal: domain status on one field, existence state on
another.

## Restore into a world that changed

Restore is not "clear the flag." While the entity slept, the world moved:
its unique name may have been claimed, entities it referenced may have
been deleted, the vocabulary of its category may have migrated. Restore
therefore validates the entity against the *current* world through the
same door creation uses ([one door](../../_laws.md#one-validation-door)
— restore is a writer too), and resolves conflicts explicitly: name
collisions surfaced to the user rather than silently suffixed, dangling
outbound references repaired or reported, migrations applied so the
restored entity is current-shaped, not archaeology. The entity's
identity never changes across the round trip
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) —
restore that re-creates under a new identifier is not restore; it
orphans every inbound reference and every line of history the original
accumulated.

## Archive is not a delete queue — unless it explicitly is

Some products layer the two promises: archive now, hard-delete after a
retention window. The layering is legitimate but must be **stated on the
archive act itself** ("archived items are permanently deleted after N
days") — an archive that silently expires is a delete wearing archive's
reassurance. If a window exists, the sweep that enforces it is a named
reaper with the full ceremony of deletion (blast radius, survivors,
transition record), not a cleanup job that quietly does what no user
confirmed.
