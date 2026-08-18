---
layer: technique
subject: import-normalization
technique: lossy-conversion-disclosure
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Lossy-conversion disclosure

Every foreign-format conversion loses something — semantics with no host
counterpart, parameters with no home, behaviors approximated rather than
reproduced. The engineering choice is not *whether* to lose (that was
decided when the formats diverged) but **whether the loss is enumerated or
absorbed**. This technique makes enumeration structural: loss is recorded
where it happens, graded on a closed scale, carried with the data, and
shown where decisions are made. "Imported successfully" over silent loss is
this subject's rendition of failure spelled as empty success — the
statement is true of the entities that survived and a lie about the file.

## The conversion-grade vocabulary

Loss is only communicable if it is graded on a **closed, small scale**,
applied per entity (and, where it earns its keep, per field):

| Grade | Meaning | User expectation set |
| --- | --- | --- |
| **full** | semantics preserved | works as it did at home |
| **approximate** | works, differs in a stated way | read the note before relying on it |
| **data-only** | carried as inert configuration | finish this by hand |
| **dropped** | not carried, with reason | rebuild or live without |

Four-ish grades is the sweet spot: two ("imported / not") cannot express
approximation, which is where the dangerous surprises live; ten produces
badge salad nobody reads. The grade is assigned in the adapter's capability
table at mapping-authoring time (see
[adapter-capability-tables](adapter-capability-tables.md)) — by the person
who knew exactly what the mapping does — not reconstructed later by
whoever writes the release notes.

## The ledger is data with provenance, not log lines

Each loss entry carries: the entity (and field, where applicable), the
grade, a human-readable reason ("the foreign retry-with-backoff policy has
no counterpart; retries import as a fixed count"), and enough provenance to
point back into the source file. The ledger travels **with** the proposal —
into the review gate, and, for the committed subset, into the durable
import receipt — because the user's question ("why doesn't this behave like
it used to?") arrives weeks after any log has rotated. An entry that names
its foreign source precisely doubles as the support team's answer and the
roadmap's evidence.

Aggregates obey
[count-carries-predicate](../../_laws.md#count-carries-predicate): "42 of
51 nodes imported" is an honest sentence only when the ledger can expand it
— 42 at which grades, 9 lost for which reasons, counted over which file and
table version. A bare percentage on a success toast is how disclosure decays
into marketing.

## Disclosure lives at the decision point — and after it

The primary rendering is inside the review gate, attached to the entities
(that half of the contract is
[review-before-commit](review-before-commit.md)'s). The obligations that
remain after commit:

- **The receipt persists.** The committed entities' grades and reasons
  survive as a queryable record of the import, not a dismissed dialog.
- **Approximations stay visible at the point of use.** An entity that
  imported `approximate` or `data-only` carries a durable marker the user
  encounters when editing or running it — the moment the difference
  matters — not only in the long-forgotten import summary.
- **Nothing upgrades itself.** When the user finishes a `data-only` entity
  by hand, the marker clears through their action, not through the
  system's optimism.

## Round-trip honesty is disclosure's outbound face

The same ledger answers the export-back question truthfully, and the answer
is asymmetric by nature: entities that imported `full` might round-trip;
everything `approximate` or below **cannot** return to its source format
intact, because the information is already gone. State the round-trip
contract in the product surface — typically "import is one-way; exported
copies of imported entities are in the host's own format" — and never let
an export UI imply that the foreign original can be regenerated from the
host copy. A product that discloses loss on the way in and implies
losslessness on the way out has spent its honesty budget on half the trip.
