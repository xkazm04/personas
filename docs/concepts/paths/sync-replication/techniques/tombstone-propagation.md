---
layer: technique
subject: sync-replication
technique: tombstone-propagation
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Tombstone propagation

Deletion is the operation sync implementations get wrong first, because
locally it is modeled as absence — the row is simply gone — and absence
transfers no information. A sync engine is an information-transfer
machine; what it cannot see, it cannot propagate, and what it cannot
propagate, the other side still has. The fix is structural: **a delete
is a write** — a first-class record, the tombstone, stating "this
identity was deleted, at this position, by this actor" — flowing through
the same cursor loop, subject to the same conflict policy, observable in
the same status surface as any other change.

## Resurrection: the failure that names the technique

Side A deletes record X. Side B, not yet synced, still holds X. Without
tombstones, the next reconciliation sees X present on B and absent on A
and faces an ambiguity it cannot resolve from state alone: *was X
created on B (propagate it to A) or deleted on A (remove it from B)?*
Naive engines guess "created" — presence looks like information, absence
looks like a gap — and the deleted record walks back onto A. The user
deletes it again; it comes back again; the system is now arguing with
its operator. Every merge-shaped topology and every two-way stream has
this failure latent in it; one-way mirrors escape only because the
authority's absence is definitionally correct — and even a mirror must
transfer deletes explicitly, or the replica accretes rows forever.

The tombstone dissolves the ambiguity: X-was-deleted is a record with a
position in the change order, so the reconciler compares *two facts*
(B's copy, A's tombstone) instead of a fact and a void. Which fact wins
is then the declared conflict policy's job — a delete concurrent with an
edit is a genuine conflict, and "delete wins" versus "edit revives" is a
policy choice to make once, in writing, not per incident.

## Tombstones carry identity, not content

A tombstone needs the record's durable identity, the deletion's position
in the change order, and enough attribution to audit it. It should carry
the *content* of the deleted record only if the policy needs it for
conflict presentation (showing a human what the losing edit would have
been); otherwise content in tombstones is a retention liability — the
data was deleted, and its ghost should not re-disclose it. Identity must
be the stable kind that survives reuse
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): if
identities are ever recycled, a tombstone for the old bearer will
assassinate the new one at the next merge. Mint identities once, never
reuse them, and tombstone-by-identity is safe forever.

## Soft-delete flags versus tombstone rows

Two implementations, one contract. A **soft-delete flag** keeps the row
and marks it deleted — simplest, keeps identity and position in one
place, and the change-tracking machinery sees the delete as an ordinary
update; the cost is that every reader must filter, forever, through one
shared predicate (a reader that forgets shows ghosts). A **tombstone
row** in a side structure keeps the live table clean but splits identity
across two structures the reconciler must join. Either works; what does
not work is the flagless hard delete, and the choice should be uniform
per stream — a stream where some deletes are flags and some are hard
removals has reintroduced the void for exactly the removals that
bypassed the flag. The enforcement follows the one-door shape: deletes
go through the path that records them, and the direct-removal path is
structurally unavailable to application code. The tombstone is written
**in the same transaction as the delete** — a tombstone written after,
by a separate step, is a tombstone that a crash between the two writes
never creates, and that one gap is a resurrection seed with no trace.

## The producer comes before the propagator

The audit question that catches dead deletion machinery: **name the
line that writes the tombstone.** The recurring field defect — observed
independently in unrelated codebases — is a fully built consumer side
(the tombstone table, the reader, the cascade that deletes downstream
copies, the cursor discipline around it) with **zero producers**: no
delete path anywhere writes the record the machinery reads. Everything
compiles, the propagation logic is even correct, and no delete has ever
propagated — the feature is dead and reads as shipped. The review
question "is there a tombstone design?" passes this; only "show me the
write" fails it. The trap is worst across module boundaries: a
half-finished foundation honestly labeled *not wired yet* in its own
module cannot stop a distant consumer from treating its empty table as
a live feed, so the propagator's author must verify the producer
exists rather than inferring it from the schema.

## Retention: every tombstone names its reaper

Tombstones accumulate — a long-lived store's deletion history can dwarf
its live data — so they must be reaped; but a tombstone reaped too early
resurrects, because a replica that never saw it will re-contribute the
record it existed to kill. The safe reaping condition is provable
delivery: **a tombstone may be discarded once every replica's cursor has
passed its position** — knowable exactly in hub topologies (the hub sees
all cursors) and by horizon agreement in peer ones (a declared maximum
offline window, after which a replica must full-resync rather than
increment). The reaping rule is decided when the tombstone design is
decided, not discovered when the table is large
([creation-names-reaper](../../_laws.md#creation-names-reaper)); and a
replica returning from beyond the horizon must be *detected* — its
cursor predates the reaping watermark — and forced through
reconciliation-from-state, never allowed to increment across the gap as
if the missing tombstones had said nothing.
