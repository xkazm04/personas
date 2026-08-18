---
layer: golden-path
subject: entity-lifecycle
status: forged
techniques:
  - blast-radius-computation
  - archive-restore-semantics
  - cascade-design
  - provenance-denormalization
  - change-logging
  - bulk-deletion-rails
evidence:
  - src-tauri/src/commands/core/personas.rs            # persona_blast_radius before delete; two-phase drain delete_persona; DeletePersonaResult receipt; pure deletion_forbidden_reason guard
  - src-tauri/db/src/repos/core/personas.rs            # blast_radius enumeration; archive_persona/restore_persona (lifecycle orthogonal to enabled); set_lifecycle single door
  - src-tauri/core/src/models/persona_change_log.rs    # per-field change history with redaction — who changed what, when, from what source
  - src-tauri/db/src/repos/execution/executions.rs     # resolve_recipe_provenance: provenance denormalized onto runs at insert; "NULL is the honest answer — never a sentinel"
  - src-tauri/db/src/repos/core/memories.rs            # delete_all preserving the core tier inside the operation (WHERE tier != 'core')
  - src/features/vault/sub_dependencies/credentialGraph.ts   # blast radius on credential revoke + simulateRevocation what-if, shared severity thresholds
  - docs/concepts/golden-path-deferred-fixes.md        # the measured cascade: 2026-08-17 purge, 20,342 rows across 25 tables through the declared ON DELETE CASCADE graph
counter_evidence:
  - src/features/overview/sub_memories/components/MemoriesPageDense.tsx   # bulk-delete confirm shows a client-computed count (page size) while the server predicate preserves core tier — preview and predicate decoupled
deviations:
  - w9-entity-lifecycle   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Entity lifecycle

Every central entity in a system carries an **existence contract**: how it
comes into being, which states lie between live and gone, and — the part
that decides whether the system can be trusted with years of data — what
its removal does to everything that points at it. Creation is the easy
half; teams design creation forms with care because creation is where the
product demos. The lifecycle subject exists because the *other* half is
where systems accumulate their scars: deletion is the one mutation that
cannot be inspected after the fact. Every other operation leaves the
evidence of what it did; a bad delete leaves an absence, and absences
don't file bug reports. The principal-engineer stance is therefore
asymmetric on purpose: creation gets validation, destruction gets
**ceremony** — computed consequences shown before the act, distinct
promises for reversible and irreversible removal, history that survives
the entity, cascades that are declared and measured, and extra rails
wherever destruction is bulk.

What this subject does not own, though each borders it: the **version
history of an entity's content** — the ability to see or restore what an
entity said last week — belongs to versioning-snapshots; this subject
owns whether the entity *exists*, not what it contained. The
**schema-level mechanics** of relational constraints and how cascade
declarations evolve across schema changes belong to
[migrations](../migrations/migrations.md). And the **trail** — the ledger
discipline that makes a recorded transition believable later — belongs to
[audit-logging](../audit-logging/audit-logging.md); this subject owes
that ledger its transition events and defines what they must carry.

## Creation mints identity; everything after depends on it

The lifecycle begins with the one act that can never be repeated: minting
the entity's durable identifier
([identity-survives-reuse](../_laws.md#identity-survives-reuse)). Every
downstream discipline in this subject — dependency enumeration, provenance
that outlives the entity, transition logs — keys on that identifier, so it
is minted once, at the creation door, by the system rather than the
caller, and it never encodes mutable facts (a name, a position, a
timestamp doing double duty). Creation is also where the entity's
**reaper is named** ([creation-names-reaper](../_laws.md#creation-names-reaper)):
a principal engineer reviewing a new entity type asks "what deletes this,
and what does that delete take with it?" at the design review, not at the
incident review. An entity type that ships with a create path and no
articulated destruction story is a liability with a delay fuse — the data
will accumulate, references will grow toward it from directions nobody
predicted, and the eventual delete will be designed under pressure,
against production data, by whoever drew the ticket.

## Destruction is informed — the blast radius comes first

The defining ritual of a mature lifecycle: **before any destructive act,
the system computes and shows what depends on the entity and what dies
with it.** Not a generic "are you sure?" — a statement of consequence:
these dependents will be deleted, these will be detached and survive,
these block the operation entirely. A confirmation dialog without a
computed blast radius is a liability transfer, not a safety mechanism —
it moves responsibility for consequences onto the one party who cannot
see them. The enumeration must be produced by the same logic that will
execute the destruction, or the preview drifts from the act
([gate-sees-target](../_laws.md#gate-sees-target)), and the numbers shown
carry their predicate — *what* is counted, as of *when*
([count-carries-predicate](../_laws.md#count-carries-predicate)). The
mechanics — direct and transitive enumeration, casualty vs. survivor vs.
blocker classification, preview freshness — are the
[blast-radius-computation](techniques/blast-radius-computation.md)
technique.

## Archive and delete are different promises

A lifecycle with only "exists" and "deleted" forces every removal
decision to be irreversible, which means users defer it, which means the
system silts up with entities nobody dares remove. The mature contract
offers two distinct promises and never blurs them:

- **Archive** is reversible by contract: the entity keeps its identity,
  content, and relationships; it leaves default views and stops
  participating in active behaviors; restore brings it back whole. It is
  a *filtering* promise, not a destruction promise.
- **Delete** is permanent by contract: the entity and its declared
  casualties are gone, its named survivors persist, and no restore
  exists. Softening delete into "actually just hidden" breaks the
  promise in the other direction — storage, uniqueness constraints, and
  privacy obligations all behave as if the data were gone when it isn't.

The design work is enumerating what "archived" means against every
behavior the entity participates in — automations it would have fired,
lists it would have appeared in, names it still holds — and guaranteeing
that restore lands in a valid live state even though the world moved on
while the entity slept. That enumeration, the flag-vs-status decision,
and restore integrity are the
[archive-restore-semantics](techniques/archive-restore-semantics.md)
technique.

## History outlives the entity

Records that describe **what happened** — runs, events, results,
transitions — routinely outlive the entity that caused them, and the
lifecycle contract must guarantee they survive its deletion *without
lying about it*. The discipline has two halves. First, dependent
historical records carry **denormalized provenance**, copied at write
time: the identifier and the contemporaneous name of the entity that
produced them become part of the record itself, so history remains
legible after the source is gone. Second, when a fact is genuinely
unknowable — the source was already gone, the link was never captured —
the honest value is **the absent one, never a fabricated sentinel**: a
placeholder identifier or a synthetic "unknown" entity is
indistinguishable from a real value to every future query, while an
honest absence is itself a queryable fact. Deleting the source must
never rewrite what happened; the pointer may degrade, the facts may not.
The write-time-vs-read-time argument and the sentinel taxonomy are the
[provenance-denormalization](techniques/provenance-denormalization.md)
technique.

## Cascades are declared — and someone measured them

What a delete takes with it is **schema-level truth**, not application
folklore: the store's own relational declarations are the one place the
entire cascade set is readable, enforceable, and immune to the
application forgetting a code path
([one-validation-door](../_laws.md#one-validation-door) applied to
destruction: the schema is the door every delete passes through). But a
declared cascade is a loaded weapon whose yield nobody has stated:
transitive declarations compose, and the honest number of rows one
top-level delete removes across all tables is knowable only by
**measuring it against realistic data** — the class of surprise where a
single entity's removal silently takes five figures of rows across
dozens of tables is discovered either in a measurement or in production.
The survivor list is as much a part of the design as the casualty list:
history tables are declared to detach rather than cascade, and resources
the schema cannot reach (files, external registrations, caches) get an
application-level reaper that is named at creation time. Declared vs.
reaper vs. blocking postures, and the measurement ritual, are the
[cascade-design](techniques/cascade-design.md) technique; how the
declarations themselves evolve is owned by
[migrations](../migrations/migrations.md).

## Transitions are recorded facts

Created, archived, restored, deleted — each lifecycle transition is a
historical claim (this actor moved this entity from this state to that
state, at this time) and it is recorded at the same door that performs
the transition. The record necessarily outlives the entity for the one
transition that matters most: a delete recorded only on the entity's own
row records nothing. What lifecycle owes the trail — the transition
vocabulary, the actor, the contemporaneous name, the before/after states
— is the [change-logging](techniques/change-logging.md) technique; the
ledger disciplines that make those records believable (append-only
shape, one write door, retention) are owned by
[audit-logging](../audit-logging/audit-logging.md) and apply unchanged.

## Bulk destruction has extra rails

An operation that destroys a *class* of entities — delete-all, purge,
reset — multiplies the blast radius while removing the per-item
deliberation that single deletes get, so it earns rails beyond them:
always **scoped** to a named domain, never global-by-default; a declared
**preserved core** (system defaults, seeded tiers) that the operation
itself protects rather than trusting callers to re-seed; a **dry-run
count** shown before execution, computed by the same predicate that will
delete; confirmation **proportional to the blast radius**; and
post-execution **accounting** that reports what was actually removed so
the operator can compare it against the preview. The scoping and
preservation contracts are the
[bulk-deletion-rails](techniques/bulk-deletion-rails.md) technique.

## The lifecycle state machine, minimally

The techniques converge on a small, explicit state machine every central
entity should be able to print:

- **States**: live → archived → live (round trip, lossless); live or
  archived → deleted (terminal). No hidden states, no "deleted but
  actually present."
- **Transitions carry actors and reasons** and are recorded facts
  (change-logging), with the vocabulary of states defined exactly once
  ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary))
  — every list filter, badge, and permission check derives from the same
  definition of "archived."
- **Terminal means terminal**: after delete, the identifier is never
  reused, the survivors are the ones the design named, and history reads
  correctly with the entity gone.
- **Every consequence was stated before it happened**: to the user via
  blast radius, to the schema via declared cascades, to the operator via
  dry-run counts.

## The techniques

- [blast-radius-computation](techniques/blast-radius-computation.md) —
  enumerate dependents before mutating; casualties, survivors, blockers;
  preview computed by the executing logic; freshness of the shown number.
- [archive-restore-semantics](techniques/archive-restore-semantics.md) —
  the reversible promise: what archived entities still do, flag vs.
  status, restore into a world that changed.
- [cascade-design](techniques/cascade-design.md) — declared cascades as
  schema truth, measured yield, named survivors, reapers for what the
  schema cannot reach.
- [provenance-denormalization](techniques/provenance-denormalization.md)
  — copy identity onto history at write time; the honest absent value
  over the fabricated sentinel; deletion never rewrites the past.
- [change-logging](techniques/change-logging.md) — lifecycle transitions
  as recorded facts that outlive the entity; what the transition record
  carries.
- [bulk-deletion-rails](techniques/bulk-deletion-rails.md) — scoped
  delete-all, preserved cores, dry-run counts, proportional
  confirmation, post-execution accounting.
