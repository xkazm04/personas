---
layer: technique
subject: versioning-snapshots
technique: version-identity
status: forged
laws: [identity-survives-reuse, one-authority-per-vocabulary]
shared_with: []
---

# Version identity

A version has two names, and confusing their jobs produces most identity
defects in versioning systems. The **global id** — opaque, unique across
the whole store, minted once at creation — is the identity that foreign
keys, ratings, logs, and links attach to. The **per-entity version
number** — 1, 2, 3 within one entity's history — is the human handle: what
appears in the picker, the audit line, and the conversation ("roll back to
v7"). The global id is for machines and never changes meaning; the number
is for people and must never be asked to do the machine's job. A schema
that uses (entity, number) as the join key for measurements has bet its
audit trail on the number never being renumbered, recycled, or
misassigned — a bet that pruning, restores, and concurrent writers all
take the other side of
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

## The number is derived at insert, nowhere else

The monotonic number is computed **inside the same transaction that
inserts the version**: read the entity's current maximum, add one, write.
Three properties follow, each load-bearing:

- **Never caller-supplied.** A caller passing "this should be v9" is a
  second authority over a vocabulary that has exactly one
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
  the entity's own history. Callers race, retry, and cache stale reads;
  the insert-time derivation cannot.
- **Concurrent-writer safe** — but only if the read-max-and-insert is
  actually atomic. Under serialized writes (a single-writer store, or a
  transaction that locks the entity's history), max-plus-one is safe by
  construction. Under genuinely concurrent writers, derive the number in
  the insert statement itself (the number computed by a subquery inside
  the very insert — one statement, no window) or take a per-entity lock;
  two transactions that both read max=6 will both mint v7. Either way,
  **the schema owns the sequence**: a uniqueness constraint on (entity,
  number) is the backstop that turns a silent collision into a loud
  retry. Without it, "the latest version" queried by highest number is
  not merely wrong on a duplicate — it is *unstable*, returning whichever
  row the query plan prefers. Constraint plus retry, not hope.
- **Gap-tolerant, forever.** Deleting or pruning v6 leaves a hole, and the
  hole is correct: v7 stays v7, and no future version is ever numbered 6
  again. Renumbering to close gaps is identity fraud against every
  artifact that recorded the old numbers — the log line that said "v7
  regressed" now points at what used to be v8. Displays that dislike gaps
  may render an ordinal position *label* separately; the stored number
  does not move.

## Deletion does not free the name

The corollary that teams re-learn expensively: the number sequence is
append-only even though the version rows are not. If the numbering scheme
is max-plus-one and the *latest* version is deleted, the next insert would
re-mint that number — the one case where max-plus-one and never-reuse
disagree. Either derive from a stored per-entity counter that never
decrements, or forbid hard-deleting the head of the sequence (tombstone
it instead). A recycled number is worse than a gap in every way that
matters: gaps confuse nobody, reuse rewrites history.

## Identity spans the graph

The version's owned children (the snapshot's copied limbs) carry their own
fresh ids in the copy — a snapshot that reuses the live children's ids has
not copied them, it has aliased them, and the first edit to the live
entity mutates the past. The copy is a new graph keyed to the new
version's id; only the *lineage* edge (see lineage-and-variants) points
back.

## Prohibitions

1. No caller-supplied version numbers — derivation at insert is the only
   mint.
2. No renumbering, ever; gaps are permanent and correct.
3. No reuse of a number after deletion — counter or tombstone, not
   max-plus-one over a shrinking set.
4. No (entity, number) pair without a uniqueness constraint backing the
   derivation.
5. No foreign keys on the human number — machines join on the global id.
6. No shared child ids between the live entity and its snapshots.
