---
layer: technique
subject: entity-lifecycle
technique: change-logging
status: forged
laws: [deletion-is-not-repair, one-authority-per-vocabulary]
shared_with: []
---

# Change logging

Every lifecycle transition — created, archived, restored, deleted — is a
historical claim: this actor moved this entity from this state to that
state, at this time, for this reason. This technique defines what the
lifecycle owes the record of those claims. The ledger disciplines that
make the records believable — append-only shape, a single write door,
sanitization, retention — are the audit-logging subject's and apply here
unchanged; what is specific to lifecycle is *which* facts the transition
record must carry and *why the log's existence is structural*, not
optional, for one transition in particular.

## The delete problem: the entity cannot testify

Most state can be reconstructed, poorly but passably, from the entity
itself: an archived-at column says when, an updated-at hints at what.
The delete transition breaks this crutch completely — a delete recorded
only on the entity's own row records nothing, because the row is gone.
The transition log is therefore not a nice-to-have audit garnish; for
deletion it is the **only** account that can exist, and it must be a
survivor of the very cascade it describes: stored outside the entity's
cascade set, carrying a denormalized copy of the entity's identity and
contemporaneous name (provenance-denormalization applied to the log
itself). A team that discovers this after shipping delete has a
permanent hole — the deletions that already happened testified to
no one.

## What one transition record carries

- **Entity identity** — the durable identifier, plus the display name it
  had at transition time. The identifier keys the history together; the
  name keeps the record legible after deletion.
- **The transition** — from-state and to-state, drawn from the same
  state vocabulary the entity itself uses, defined once
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
  A log that says "changed" without from/to answers half of every
  question; a log with its own private state names drifts from the
  entity's the first time either vocabulary grows.
- **The actor** — who or what, with delegation preserved: an automation
  acting under a person's standing grant names both. Lifecycle
  transitions are precisely the actions people later ask "who did this?"
  about.
- **The reason** — when the flow collects one (deletion ceremonies
  often do), it is recorded verbatim; when it doesn't, the field is
  honestly absent.
- **The consequence summary** — for destructive transitions, what the
  act took: the casualty counts the blast-radius computation showed and
  the execution confirmed. This turns each delete record into its own
  small accounting, comparable against the preview the user consented
  to.

## Recorded at the door, not near it

Transition records are emitted inside the one code path that performs
the transition — the same door that flips the state — never by callers
remembering to log after calling. A transition that can happen without
its record is a log with unenumerable gaps; placement inside the door
makes completeness structural. (This is the audit subject's
write-chokepoint discipline meeting the lifecycle's own one-door rule:
the entity has one archive path, one delete path, and the record rides
inside them.)

## The log is not the undo stack, and it is not disposable

Two boundary confusions to refuse:

- The change log records *that* transitions happened; it does not store
  the entity's content and cannot resurrect it. Content history and
  restore-from-history belong to versioning-snapshots. Conflating them
  produces either a bloated log carrying full snapshots or — worse — a
  team believing delete is recoverable because "we log everything."
- When the log embarrasses (a mass-deletion incident, an automation run
  amok), the log is the evidence, not the defect
  ([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).
  Trimming it converts a visible incident into an invisible one at the
  exact place visibility existed. Corrections are new records; the
  original stands.
