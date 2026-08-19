---
layer: technique
subject: migrations
technique: data-migrations
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Data migrations

A schema change alters shape; a data migration rewrites contents — backfills
a new column from existing fields, converts every stored payload from one
serialization format to another, splits a field into two, re-keys a
relationship. The two ride the same chain but carry different risk: shape
changes are near-instant and structurally atomic, while data rewrites are
long-running, crash-exposed in the middle, and capable of destroying
information. The first rule is therefore separation: **a step is a shape
change or a data rewrite, never both fused**, so each can be atomic, timed,
and retried on its own terms. (Add the column in one step; backfill it in
the next.)

## Crash-safety has two regimes, chosen by volume

**Small enough to fit one transaction** (the common case on end-user
stores): do the entire rewrite inside the step's atomic unit and inherit
all of [transactional-ddl](transactional-ddl.md)'s guarantees. Do not
build batching machinery for ten thousand rows; the machinery is where the
bugs live.

**Too large for one transaction**: batch with a **resumable watermark** —
a durable record of progress, committed with each batch. The watermark
obeys the identity law
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): it is
keyed by stable row identity ("all rows with key ≤ K are converted"), never
by offset or count, because a crash-resume against a store that took
writes in between shifts every position. Offset watermarks re-convert some
rows and skip others; identity watermarks partition the dataset exactly.
Rows must also be *classifiable* — the migration can tell converted from
unconverted by looking (a format tag, a null-until-filled column) — or
resume is guesswork.

While a batched migration is in flight across a crash boundary, the store
is legitimately mixed. That mixed state must be invisible above the
migration: either the application does not start until the rewrite
completes (the default posture at boot), or every reader handles both
forms for the duration — a cost to charge, not to discover.

## Lossy transforms need escrow

Some rewrites are reversible from their own output; many are not (parsed
approximations, dropped precision, merged fields). For any transform that
cannot be inverted, the source representation stays reachable until the new
one is verified: keep the old column through a verification window and drop
it in a later release, or rely — explicitly, by name — on the
pre-migration snapshot as the escrow, which binds the verification window
to the snapshot's retention. A derived value whose derivation can no longer
be recomputed has no arbiter when it is disputed
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation));
a lossy rewrite with no escrow is that condition inflicted on every row at
once.

Backfills deserve the same scrutiny in miniature: a new column's default
answers only the question "what do *new* rows get". What existing rows get
is a per-row decision — computed from their other fields, a sentinel that
readers understand, or an honest null — made explicitly in the backfill
step, not left to whatever the engine's default machinery happened to
stamp.

## Eager at the boundary beats lazy at read time

The alternative to rewriting at migration time is rewriting lazily — each
record converted when next read, format tag per record, readers accept all
versions forever. Lazy conversion is seductive because it makes the boot
instant, and it is usually the wrong trade on machines you do not operate:

- the mixed state stops being a bounded window and becomes a permanent
  property — every reader, present and future, parses every historical
  format;
- the conversion code can never be deleted, because some record somewhere
  may still be unconverted years later;
- failures move from one observable, snapshot-protected moment at boot to
  scattered read paths in ordinary operation, where no snapshot is fresh
  and no one is watching for them.

Eager conversion pays the whole cost once, at the exact moment the system
is *designed* to be dangerous — behind the snapshot gate, before the
application runs. Choose lazy only when volume makes boot-time rewriting
genuinely unacceptable, and then adopt the full discipline (per-record
version tags, readers tested against every live format, a background
sweeper that names the date the old format dies).

## Verify by counting — with predicates

Every data migration ends with arithmetic: rows read, rows written, rows
skipped-with-reason must reconcile, and the check compares counts *with
their predicates* ([count-carries-predicate](../../_laws.md#count-carries-predicate))
— "12,041 rows matching the old format before; 12,041 matching the new
format after; 0 matching neither" is a verification, while a bare "12,041
processed" is a number that will be quoted to defend a rewrite it does not
actually vouch for. Spot-check invariants that the transform was supposed
to preserve (totals, referential pairings, non-null-ness) while the
snapshot is still fresh enough to make a discrepancy recoverable — this
arithmetic is the step's post-condition in the sense of
[idempotent-steps](idempotent-steps.md), and it fails the step loudly, not
logs-and-continues.
