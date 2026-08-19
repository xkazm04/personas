---
layer: technique
subject: import-normalization
technique: intermediate-representation
status: forged
laws: [identity-survives-reuse, one-authority-per-vocabulary, one-validation-door]
shared_with: []
---

# The normalized intermediate representation

Every adapter lowers into one internal representation — the IR — and
everything downstream (validation, review, disclosure, commit) consumes the
IR only. The technique is the compiler industry's oldest structural lesson
applied to imports: N source formats and M consumers connected pairwise is
N×M converters; connected through a waist it is N+M, and the waist is where
every cross-cutting guarantee gets enforced exactly once.

## What the IR is — and is not

The IR is **your product's vocabulary with the source scrubbed out**:
whatever set of entities the host model can actually absorb (steps,
connections, triggers, credential requirements, parameters, metadata),
expressed in host semantics. It is *not* a superset of all source formats —
an IR that grows a field per vendor quirk becomes a museum of everyone
else's design decisions, and the waist stops being narrow. When a foreign
concept has no host counterpart, it does not get an IR field; it gets a loss
ledger entry (grade `data-only` or `unsupported` — see
[adapter-capability-tables](adapter-capability-tables.md)).

The IR is also **not the host's persistence model**. It is a staging shape:
richer than the store in provenance and loss data, poorer in anything the
store computes (timestamps, ownership, defaults the creation door fills).
Committing means translating IR → normal creation calls, not bulk-inserting
IR rows.

## Identity is minted at the waist

Foreign identifiers are the classic trap. They are locally unique at best —
they collide across two files from the same vendor, across a re-import of
the same file, and trivially across different formats. Per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse), internal
identity is **minted at IR construction** — one fresh id per proposed
entity — and every intra-document reference (this connection joins those two
steps; this step needs that credential) is **rewritten to the minted ids at
lowering time**. After the waist, foreign ids exist only as provenance
strings; nothing dereferences them.

Getting reference rewriting right at the waist is what makes the review gate
cheap: when the user deselects an entity, the dangling references are
findable by minted id; when two selected entities both point at one
deselected credential requirement, the gate can say so precisely.

Two corollaries, both learned by measurement rather than by taste:

- **Never re-derive an association from display text.** One pipeline let
  each connector claim its triggers by scanning human-readable descriptions
  for its own service name — and every service whose name was a substring of
  another's cross-claimed ("mail" claimed the mail-service *and* the
  webmail-vendor triggers). The fix carried identity alongside the entity —
  an association slot populated at construction — instead of reconstructing
  it from prose later. Association *is* identity data; prose is for humans.
- **Synthetic entities carry empty provenance on purpose.** When the
  pipeline fabricates what the source lacked (a fallback trigger for a
  document that declared none), the fabricated entity belongs to no foreign
  source and no consolidated service — and its provenance fields must say
  so explicitly, so that every provenance-based join (which connector owns
  this? which source line produced that?) skips it instead of matching it
  by accident.

## Provenance and the loss ledger are IR citizens

Each IR entity carries: source format and version, the foreign id and
name it came from, the adapter table row (or absence of one) that produced
it, and its conversion grade with human-readable reasons. The loss ledger is
not a log line emitted during adaptation — it is **part of the IR
document**, traveling with the proposal into review (where it renders as
disclosure) and into the commit record (where it becomes the permanent
answer to "why does this imported thing lack the behavior it had at home").
A ledger that lives in a log dies with the log; the user's question arrives
weeks later.

## The IR is versioned and validated like any contract

The IR sits between two moving worlds — adapters that change with vendor
formats, consumers that change with the host model — so it is a schema with
a version, validated at construction. An adapter that emits an invalid IR
document fails *loudly at the waist*, attributed to the adapter, instead of
surfacing three stages later as a review screen with impossible entries.
This is the [one-validation-door](../../_laws.md#one-validation-door)
pattern applied one level up: the door for "may enter the pipeline's second
half" is the IR schema, and the adapters are its enumerable writers.

One authority holds the IR type definitions; adapters and consumers import
them from that single place
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Two IR definitions — one the adapters target, one the review UI renders —
is the waist split back into a matrix, with extra steps.
