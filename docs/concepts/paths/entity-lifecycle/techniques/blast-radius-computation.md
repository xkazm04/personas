---
layer: technique
subject: entity-lifecycle
technique: blast-radius-computation
status: forged
laws: [gate-sees-target, count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Blast-radius computation

Before any destructive act, the system enumerates what depends on the
target and presents the consequences — *then* asks. This inverts the
common order, where the confirmation comes first (cheap, generic,
learned-to-be-clicked-through) and the consequences are discovered
after. A dialog that says "delete this? yes/no" without saying what
"this" drags with it is not a safety mechanism; it is a liability
transfer to the one party who cannot see the dependency graph. The
technique has three parts: enumerate, classify, and keep the shown
number honest.

## Enumerate: direct and transitive, by the executing logic

The dependency set is walked from the target outward: everything that
references the entity directly, then everything that references those,
until the frontier closes. Two disciplines make the walk trustworthy:

- **The preview and the execution share one implementation.** If the
  preview is a hand-written summary ("this will also remove its
  attachments") while the delete follows declared cascade rules, the two
  drift the first time someone adds a new dependent type — and the
  preview keeps reassuring users about a cascade it no longer describes
  ([gate-sees-target](../../_laws.md#gate-sees-target)). Derive both
  from the same source: either the preview runs the deletion logic in a
  counting mode, or both are generated from the same declared dependency
  registry.
- **The walk terminates and its depth is stated.** Real graphs contain
  cycles and unexpectedly deep chains; the enumerator handles revisits
  and, if it caps depth or set size for responsiveness, the cap is part
  of the presentation ("at least N dependents"), never silently applied.
- **The preview and the execution share one predicate, clause for
  clause.** A probe that counts only the *active* dependents while the
  delete takes every row is a lie by construction — the dialog reads as
  an exhaustive impact list while omitting the history behind each
  category. Same tables, same filters, or the preview is theater.

Two failure disciplines sit on the enumeration itself. **A probe that
errors must never render as an empty result** — a failed count
swallowed into zero becomes "no dependents found, safe to delete,"
which is the one failure mode a safety surface cannot have
([failure-not-empty-success](../../_laws.md#failure-not-empty-success));
propagate the error and show a broken preview, not a reassuring one.
And **the preview must never be cheaper to obtain than the act it
previews**: an impact enumeration over a sensitive entity is
reconnaissance, so the read carries at least the privilege the
destruction does.

## Classify: casualties, survivors, blockers

A flat count buries the decision the user actually faces. Every
dependent lands in one of three classes, and the presentation keeps them
apart:

- **Casualties** — deleted with the entity. These are the cascade set;
  the user is consenting to their destruction too, so they are named by
  type and counted, with the largest groups called out rather than
  averaged into a total.
- **Survivors** — records that persist with a degraded or denormalized
  reference (history, provenance-carrying records). Showing survivors is
  what makes the promise "your history remains" credible.
- **Blockers** — dependents whose existence forbids the operation
  entirely (an in-flight process using the entity, a dependent another
  team owns). Blockers turn the dialog from confirmation into
  explanation: what must be resolved first, and where it lives.

The same classification powers the **what-if simulation** — the read-only
form of the computation, exposed as its own affordance so a user can ask
"what would deleting this cost?" without arming the operation. The
simulation is the enumeration; only the final act differs.

## Keep the number honest

The count shown carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
what was counted, at what depth, as of when. Two failure modes to
design against:

- **Staleness.** The world moves between preview and click. For
  low-contention entities, recomputing inside the destructive
  transaction and proceeding is fine; for high-stakes deletes, recompute
  and *re-confirm* if the set changed materially. Never execute against
  yesterday's preview on principle — the gap between shown and actual is
  precisely where trust dies.
- **Target drift.** The number is not the only thing that goes stale —
  the *target* can too. The confirmation binds to the entity identity
  captured when it was armed; at the moment of consent, re-resolve
  that identity against the live collection and disarm if it no longer
  matches (the list re-sorted, a selection grew, another actor deleted
  the row). A confirm whose label re-renders against a live selection
  while its armed action stays fixed deletes something the user never
  read.
- **Cost.** The enumeration runs on every open of the confirmation
  surface, so it must be cheap — which is an argument for maintaining
  the dependency registry as a first-class structure rather than
  ad-hoc queries per entity type. If a full walk is genuinely expensive,
  degrade honestly: show the direct set immediately, stream the
  transitive count, label estimates as estimates.

## Proportionality

The ceremony scales with the radius. A leaf entity with zero dependents
deserves one click; an entity whose enumeration returns thousands of
casualties deserves friction — an explicit acknowledgment of the largest
casualty groups, a typed confirmation, or an archive-first suggestion.
Uniform ceremony fails in both directions: heavy ritual on trivial
deletes trains users to click through, and that trained reflex is
exactly what light ritual on catastrophic deletes then exploits. The
strong form of the rule: when the computed radius is empty, skip the
dialog entirely — a confirmation the user always clicks through is
training, not protection. And the ladder must not invert: if
destroying a shared, secret-bearing, or many-dependent entity takes
one click while destroying a leaf takes a typed name, the friction is
allocated by which surface got attention, not by risk.

## Close the loop with a receipt

The destructive act returns an accounting, not a boolean: what was
deleted, what was cancelled or force-stopped along the way, what
failed. The receipt is the preview's counterpart — the user consented
to a stated impact, and the receipt is the only honest way to report
whether that is what happened. A delete that had side effects and
returns only "true" forces every caller to invent its own summary.
