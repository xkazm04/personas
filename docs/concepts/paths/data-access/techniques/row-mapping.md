---
layer: technique
subject: data-access
technique: row-mapping
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Row mapping

Row mapping is the decode seam: the point where an untyped column tuple from
the store becomes a typed domain record. Everything the application believes
about its data — field types, nullability, enum membership, the shape of
serialized payloads — is enforced here or nowhere. The technique has two
halves: keeping the seam *single* (one mapper per record type, derived from
one declaration), and deciding *in advance* what happens when a row refuses
to decode.

## One declaration, everything derived

A record type stored in a table implies at least four artifacts that must
agree: the column list a read selects, the mapper that decodes a row, the
column-and-placeholder set a write binds, and the domain type itself. Written
by hand, these are four parallel copies of one fact — the table's shape —
and parallel copies drift. The classic incident: a field is added, the type
and the insert learn about it, one of the three read paths does not, and the
field silently round-trips as its default until someone notices the data was
never really there.

The repair is the one-authority rule applied to the column set
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
**declare the shape once — fields, column names, decode rules — and derive
the rest.** Whether the derivation is macro expansion, code generation, or a
carefully factored set of shared constants matters less than the property:
adding a field is a one-site edit, and a read that forgets the field becomes
unrepresentable rather than undetectable. Positional decoding (column 0,
column 1, …) hand-synchronized with a select list is the same parallel-copy
defect in its most fragile costume; if positions must be used, they and the
select list must come from the same declaration.

## Decode decisions are made once, at the seam

Every judgment call about a column's meaning belongs in the mapper, not in
callers:

- **Nullability**: whether a null becomes an optional, a default, or an
  error is decided per column, once. A caller that re-checks "just in case"
  is evidence the seam's contract is not trusted or not stated.
- **Serialized payload columns** (a document, a list, a settings blob
  stored as text): parsed at the seam, so downstream code never sees the
  raw text and cannot half-parse it differently.
- **Closed vocabularies stored as text** (status columns, kind columns):
  converted to the domain enum at the seam. The unknown-variant policy —
  reject the row, or map to an explicit quarantine variant that downstream
  code must handle — is chosen deliberately per column. What is banned is
  the silent third option: passing unknown text through as if it were a
  member, which defers the explosion to whichever caller switches on it
  furthest from the evidence.

## The corrupt-row policy

Stores accumulate rows that no longer decode: a crash mid-write, a bug in a
past release, a hand edit. The mapper is where the damage is *discovered*,
so the mapper's contract is where the response is *defined* — per read
shape, not per incident:

**Collection reads choose between two honest policies — per read, by
consumer.** *Fail whole*: one corrupt row aborts the list. Right when the
consumer will act on the list as if it were complete and can retry — for
an interactive surface, an error beats a silently short answer it cannot
detect. *Degrade visibly*: the healthy rows return, and the skip is
recorded — the row's identity, the decode error, a counter telemetry can
see. Right when aborting turns one bad row into an outage, or when the
consumer is a background worker for which a dropped row is a job nobody
will ever run again unless the log says so. The mapper itself takes no
side: it *propagates* per-row failures unchanged, and the collection site
— which knows the consumer — picks the policy. What no consumer ever
justifies is the third option: skipping *silently*. Corruption becomes
data that "never existed", the count quietly disagrees with the sum
elsewhere, and the first symptom surfaces in a report no one can
reconcile. A skip with no record is empty success wearing success's
uniform ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The strongest observed form goes one step past logging: carry a taint flag
on the returned collection ("this list is incomplete") so the *consumer* —
not just an operator reading logs — can see the degradation.

**Single-record reads fail loud.** When a caller asks for one record by
identity, "no such record" and "record exists but cannot be decoded" are
different facts and must not share the empty answer. The absent-shaped
response invites the caller to recreate the record — and now the identity
exists twice, the corruption has bred, and the eventual cleanup must first
decide which twin is real. Unreadable-by-id is an error carrying the decode
failure, distinct from not-found.

**Write paths never launder.** A mapper that "helpfully" repairs a bad value
on read (clamping, defaulting, re-serializing) and then writes the repaired
form back has destroyed the evidence and stamped the corruption with a fresh
timestamp. Repair is a deliberate act by code that knows what the data
means, operating on the recorded skip reports — not a side effect of
reading.

## Resilience is for damage, not for programmer error

The skip-and-log contract covers *data* corruption: this row's bytes are
wrong. It must not be stretched to cover *code* being wrong about the
schema — a select list naming a column that does not exist, a mapper
disagreeing with the declaration about arity or type. Those fail every row,
not one, and the correct response is an immediate, loud failure of the
operation: a thousand skip-log entries that all say "no such column" is an
outage reported at the wrong severity through the wrong channel. Distinguish
the two at the seam: per-row decode errors engage the policy; statement-level
errors propagate.

## The seam is where honest reads are cheap

A final property worth designing for: because every row passes this one
seam, the seam is the natural place for read-side accounting — how many rows
decoded, how many skipped, which tables produce skips at what rate. That
running answer to "how healthy is the stored data" costs almost nothing to
collect here and is unobtainable anywhere else, because no other layer sees
every row. A system that wires the skip counter into its observability
surface finds its corruption in a dashboard; one that does not finds it in
support tickets.
