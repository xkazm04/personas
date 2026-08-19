---
layer: technique
subject: entity-lifecycle
technique: cascade-design
status: forged
laws: [creation-names-reaper, count-carries-predicate, one-validation-door]
shared_with: []
---

# Cascade design

When an entity dies, every record that references it needs a decided
fate. This technique is about *where that decision lives* and *how its
consequences are known*. The principal-engineer position: the fate of
every reference is **declared in the schema** wherever the store can
enforce it, application-level reapers cover only what the schema cannot
reach, and the composed yield of the declarations has been **measured**,
because a cascade nobody has counted is a surprise with a timer on it.

## The three postures

Every inbound reference to a deletable entity takes exactly one of three
declared postures:

- **Cascade** — the referencing record is a casualty; it dies with the
  entity. Right for records that are meaningless without their parent
  (line items, per-entity settings, join rows).
- **Detach** — the reference degrades to an honest absence while the
  record survives. Right for history and anything with independent
  meaning; pairs with provenance-denormalization so the surviving record
  stays legible after the pointer nulls out.
- **Block** — the reference forbids the delete while it exists. Right
  when the referencing record is the more important of the two, or when
  deletion should force a human to resolve the dependency first.

"Unspecified" is not a posture; it is the store's default applied by
omission, and defaults differ across stores and across time. A schema
review of a deletable entity is a walk of its inbound references
checking that each carries an explicit, intended declaration — and the
rare reference that is *deliberately* left unconstrained (a history
table that must outlive its subject, in a store that would otherwise
enforce presence) carries a written "retained by design" note at the
declaration site, so absence of a constraint can never again be read
as absence of a decision. The failure mode this kills is quiet and
cumulative: reference-shaped columns accumulate without declarations,
nothing cascades them, no sweep covers them, and the orphans are not
merely dead rows — where the referencing record drives runtime
behavior, the system keeps *acting* on behalf of something the user
deleted.

## Declared beats programmatic — where declaration is possible

The schema is the one door every delete passes through, including the
code paths written next year and the manual operation run during an
incident ([one-validation-door](../../_laws.md#one-validation-door)
applied to destruction). Application code that "remembers" to clean up
dependents is complete exactly until the entity gains a new dependent
type or a new delete path — the two events most likely to happen.
Declared constraints also make the cascade set *readable*: what one
delete takes with it is answerable from the schema alone, without
tracing application call graphs. How the declarations evolve — adding a
posture to an existing reference, changing cascade to detach — is
schema-change work owned by the migrations subject.

Two things the declaration cannot give you:

- **Reach.** Files on disk, external registrations, caches, scheduled
  work in another system — the store's constraints cannot touch them.
  These get an application-level **reaper, named at the creation site**
  of the resource ([creation-names-reaper](../../_laws.md#creation-names-reaper)):
  the code that writes the file states what deletes it. Reapers run
  after the transactional delete succeeds, tolerate already-gone
  targets, and their failures are counted, not swallowed — a half-run
  reaper is how orphaned resources accumulate invisibly.
- **Sequencing.** When the delete must interleave with running work
  (cancel in-flight jobs, then delete), that orchestration is
  application logic in the one delete door, wrapping the declared
  cascade rather than replacing it.

## Measure the yield

Declarations compose transitively, and the honest answer to "how many
rows does deleting one of these remove?" exists only empirically: run
the delete against realistic data and **count the casualties per
table**. The five-figure surprise — one top-level delete taking tens of
thousands of rows across dozens of tables — is a class of incident that
is only ever discovered in a measurement or in production, and the
measurement is cheaper. The measured number, with its predicate — which
entity, what data shape, casualties per table
([count-carries-predicate](../../_laws.md#count-carries-predicate)) —
feeds three consumers: the blast-radius preview (users see honest
magnitudes), performance design (a cascade that large may need batching
or deferral to keep the transaction from locking the world), and the
design review itself (a yield that surprises the team is a posture that
deserves re-deciding — perhaps that reference should detach, not
cascade).

## The survivor list is part of the design

Reviews fixate on what dies; the sharper question is what *must not*.
History, provenance-carrying records, and the transition log that
records the delete itself are all survivors by design — each declared to
detach, each carrying its denormalized copy of what it needs to stay
legible. A cascade design is complete when both lists are written:
casualties (with measured magnitudes) and survivors (with the mechanism
by which each stays meaningful after the entity is gone).
