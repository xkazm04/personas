---
layer: technique
subject: diff-comparison
technique: semantic-level-selection
status: forged
laws: [identity-survives-reuse, one-authority-per-vocabulary]
shared_with: []
---

# Semantic level selection

A diff is computed at a **level** — bytes, lines, tokens, tree nodes,
schema fields, domain semantics — and the level decides what counts as "a
difference" before any algorithm runs. Choose the level from the entity's
own nature, not from what the tooling makes convenient. The universal
failure is the convenient one: serialize a structured entity and diff the
text. Every reordered key, requoted string, re-indented block, and
float-formatting wobble becomes a marked change; the reader scrolls
through forty phantom edits to find the one real one, learns that this
surface is noisy, and starts skimming. A noisy diff does not merely waste
attention — it *trains the reader to ignore the surface*, which is how the
change that mattered ships unseen.

The inverse failure is rarer but real: prose forced through a structural
diff. Splitting a paragraph into a token tree and reporting node
operations answers no question a human editor has. **Field-level diffs
over the entity's own schema for structured data; text diffs for text.**

## The level ladder

- **Bytes** — answers only "identical or not". Legitimate as a cheap
  pre-check (hash equality short-circuits everything above) and as the
  honest level for opaque blobs. Never a presentation level.
- **Lines/text** — the right level for things humans author *as* text:
  prose, source, templates. Word/token refinement within changed lines is
  presentation polish at the same level, not a different level.
- **Structural** — trees and documents with nesting but weak schemas.
  Differences are node operations (added/removed/changed/moved subtrees),
  insensitive to serialization order and formatting by construction.
- **Field-level** — entities with a schema. The diff enumerates the
  schema's fields and compares each with an equality chosen *per field*:
  exact for identifiers, tolerance-based for measured numbers, set-based
  for unordered collections, "excluded" for volatile operational fields.
  The schema — one authority, the same one that validates the entity —
  drives the enumeration ([_laws:
  one-authority-per-vocabulary_](../../_laws.md#one-authority-per-vocabulary));
  a diff that hand-maintains its own field list drifts from the schema at
  the first added field, and the new field becomes invisible to
  comparison precisely because it is new.
- **Domain semantics** — equality classes the domain defines: two
  schedules equivalent though spelled differently, two queries equal up to
  ordering. The most honest level and the most expensive; used where the
  domain's notion of "same" is the one the reader is asking about.

## Levels compose

Real entities are mixed: a structured record whose fields include prose,
embedded documents, and blobs. Compose levels hierarchically — a
field-level outer diff, and *within* a changed field, the level that field
deserves: a text diff inside a changed prose field, a structural diff
inside a changed document field, "changed (binary)" for a blob. The outer
level locates the change; the inner level explains it. What does not
compose is *skipping* the outer level: diffing the whole entity at the
inner level (all fields concatenated into one text) re-creates the noise
problem with extra steps.

## Lists align by key, not by position

Ordered collections are the level trap inside the level. Aligning two
lists by index turns one insertion at the head into N spurious "changes" —
every subsequent element compared against its neighbor's former occupant.
Align by each element's durable key ([_laws:
identity-survives-reuse_](../../_laws.md#identity-survives-reuse)); then
the diff distinguishes added, removed, changed, and **moved** — where
moved-with-content-change renders as both, not as remove-plus-add. Where
elements have no durable key, the honest choices are: derive a content
key when elements are immutable values; or fall back to sequence
alignment *and say so*, because "changed" under positional alignment is a
weaker claim than "changed" under keyed alignment, and the reader cannot
tell which they are getting unless told.

## Three ways a structural diff lies while looking structural

Measured, not hypothesized — each of these was found in a shipping
comparison surface, and each passes casual review because the output has
the *shape* of a field diff:

- **Equality decided by serialization.** Comparing two values by their
  serialized bytes is a byte-level diff wearing a field-level costume:
  serialization preserves insertion order, so a value read from storage
  and an equivalent one built in code compare unequal by bytes and equal
  by meaning. Two semantically identical records diverging only in nested
  key order render as "changed". Compare key by key, or serialize both
  sides through one *canonicalizing* serializer — never through the
  default one on both sides of an equality operator.
- **Depth one.** A "structural" diff that stringifies each top-level
  value whole and compares the strings reports every nested change as a
  change on the top-level key, with the entire old and new subtree as the
  two sides. It never reaches the level where the reader's question lives
  ("which nested field?"), and it never gets to ask whether ordering
  mattered, because it never descends far enough to see an ordering.
- **Absent collapsed into null.** A diff that defaults missing keys to a
  null sentinel before comparing makes "key absent" and "key present with
  an explicit null" indistinguishable — and a schema-driven system
  frequently treats those as different states (unset vs cleared). The
  presence of a field is part of its value; the diff must carry a
  presence bit, not a default.

And the projection failure, which is the worst of the family: a diff that
normalizes both sides through a projection reading N of the entity's M
fields, then computes "no differences" **over the projection**, has
affirmatively denied any change in the M−N fields it never read. The
enumeration must come from the schema; and if a fixed list is ever
unavoidable, the "nothing changed" claim is computed over the whole
entity, so an unseen field can at worst be *undescribed*, never declared
equal.

## Normalization is a declared claim, not a cleanup

Every normalization applied before comparison — sorting unordered keys,
collapsing whitespace, stripping timestamps, rounding floats — is a
standing assertion: *this is not a difference*. Each such assertion hides
a real class of change forever, on purpose. So normalizations live in a
**declared ledger** attached to the comparison (what is normalized away
and why), not scattered inline where they accumulate silently; and the
excluded classes surface as "not compared" rather than "unchanged"
(diff-honesty owns that rendering). The ledger is reviewed like any other
contract, because the most expensive comparison bug is a normalization
that was right when written and wrong after the domain moved — it does
not fail; it *specifically* suppresses the change that would have revealed
it.

The ledger is also **one function**, not a policy restated wherever a
comparison happens to run. A product with several diff kernels grows
several whitespace policies — one drops blank lines, one trims, one does
neither — none written down, and the same pair produces different
"differences" depending on which surface the reader opened. Worse, the
common shape of an off-thread kernel with a synchronous fallback duplicates
the normalization verbatim in both, and nothing asserts they agree
([_laws:
one-authority-per-vocabulary_](../../_laws.md#one-authority-per-vocabulary)).
Normalize through one shared function that every kernel and every fallback
calls; the ledger *is* that function's contract.

## The surface states its level

"No differences" is only meaningful relative to a level: byte-identical is
a different claim from field-equal, which is a different claim from
semantically-equivalent. Two states can be field-equal while their
serializations differ (formatting churn) and semantically equal while
their fields differ (reordered unordered list). The surface therefore
names its level — "no differences at field level", "3 fields changed" —
so that absence of a marker is a scoped claim, not an unbounded one. The
level statement costs a few words and closes the gap where a reader
mistakes "this tool saw nothing" for "nothing is different".
