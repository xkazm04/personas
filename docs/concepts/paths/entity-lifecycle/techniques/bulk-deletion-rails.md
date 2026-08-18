---
layer: technique
subject: entity-lifecycle
technique: bulk-deletion-rails
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Bulk-deletion rails

Delete-all, purge, reset: operations that destroy a *class* of entities
rather than one. They multiply the blast radius by the population while
removing the per-item deliberation single deletes get — nobody reviews
ten thousand rows one confirmation at a time — so the safety budget that
single deletion spends on per-item ceremony gets spent here on
**structural rails**: scope, preservation, preview, proportional
confirmation, and accounting. A bulk delete with single-delete ceremony
is the most dangerous operation a product ships.

## Rail 1 — scoped, never global by default

Every bulk destruction names its scope as a required, explicit
parameter: this module's data, this category, this time window, this
owner. "Everything" is never the default and ideally never a single
operation at all — a true full reset is a composition of named scopes,
each individually consented. Scoping does two jobs: it bounds the worst
case of a misfired call, and it makes the operation's name honest —
"delete all X in Y" is a reviewable claim; "delete all" is a prayer.
The scope predicate travels with the operation into logs and previews
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
what was deleted is only meaningful alongside what was *asked* to be
deleted.

## Rail 2 — the preserved core is the operation's promise

Most populations contain members that must survive any purge: system
defaults, seeded content, a protected tier the product depends on to
function. The preservation is enforced **inside the bulk operation
itself** — a predicate the delete query carries — never left to callers
to re-seed afterward or to remember to exclude. Caller-side preservation
is a convention; operation-side preservation is a contract, and the
difference shows the first time a new surface calls the operation
without the folklore. The preserved-core predicate is documented on the
operation, tested (run the purge, assert the core stands), and shown in
the preview ("N items will be deleted; the M core items are kept").

## Rail 3 — dry-run counts before execution

Before the operation arms, the user sees what it will remove: counts
per type or per table, produced by **the same predicate the deletion
will execute** — a dry-run mode of the destroyer, not a parallel
estimate that can drift from it
([gate-sees-target](../../_laws.md#gate-sees-target)). The dry run is
the bulk form of blast-radius computation, and the same honesty rules
apply: the count carries its as-of moment, and if the population can
shift between preview and execution, the executed operation reports
what it actually did rather than assuming the preview held.

## Rail 4 — confirmation proportional to the radius

Bulk confirmation earns real friction: the scope named back in the
user's own confirmation (type the scope's name, not "yes"), the counts
displayed at the moment of consent, and — above a magnitude threshold —
escalation (a second actor, a cooling-off delay, or an export-first
suggestion). The proportionality argument from single-delete ceremony
applies with the sign flipped: bulk operations are rare enough that
friction costs little, and large enough that its absence is
unrecoverable.

## Rail 5 — post-execution accounting

The operation reports what it removed — per type, per table, against
the preview's numbers — and records that accounting in the transition
log (change-logging's consequence summary, at bulk scale). The report
closes the consent loop: the user agreed to the preview, the accounting
shows the delivery, and a material gap between them is a defect worth
an incident, not a shrug. Silent bulk deletion — an operation that
returns "ok" — leaves the operator unable to distinguish "deleted ten
thousand" from "matched nothing," and those are very different
outcomes to be uncertain between.

## The reversibility ladder, applied at bulk scale

Before shipping any bulk delete, climb down the ladder first: can this
be bulk *archive*? Can the purge run through a retention window
(archive now, hard-delete after N days) so there is an undo horizon?
Bulk operations are where wrong clicks have their largest cost, which
makes them exactly where the reversible promise pays most — hard bulk
deletion is the right design only when storage, privacy, or contractual
obligations genuinely demand the data be gone.
