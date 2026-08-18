---
layer: technique
subject: audit-logging
technique: append-only-design
status: forged
laws: [deletion-is-not-repair, identity-survives-reuse]
shared_with: []
---

# Append-only design

An audit record is worth exactly as much as the reader's confidence that
it has not changed since it was written. This technique is how that
confidence is manufactured structurally — by making mutation impossible to
express — rather than promised procedurally.

## No mutation surface

The audit module's public shape is the guarantee:

- **Exports**: an insert operation, read operations, and (if retention is
  enforced here) a horizon-trim that removes only whole records older than
  the stated policy. Nothing else.
- **Absent by construction**: no update operation, no arbitrary delete, no
  upsert, no "fix this record" helper. Not deprecated, not
  permission-gated — *absent*. A gated edit path is an edit path; the
  question "who has used it?" reopens every claim the trail makes.

The test an auditor (or a new contributor) can run in one minute: read the
module's exports. If mutation cannot be expressed through the only door
that touches the ledger, then every record's integrity claim reduces to
the integrity of one small module — reviewable, testable, and stable —
instead of the discipline of every caller in the codebase forever.

Where the underlying store cannot itself forbid mutation (most embedded
and relational stores cannot, short of triggers or permissions), the
module boundary *is* the enforcement layer, which is one more reason the
ledger has exactly one door (see
[write-chokepoint](write-chokepoint.md)). Store-level hardening —
revoking update/delete rights from the application's own database
principal, or write-once storage classes for exported archives — is
defense in depth, worth taking where the platform offers it cheaply.

## Correction is a new record

Records will be wrong — a bug misattributes an actor, an outcome is
recorded before a late failure, an operator fat-fingers a subject. The
append-only answer is uniform: **write a new record that references the
old one and states the correction**. The original stays readable; the
trail now contains the error, the correction, and the metadata of the
correction itself (who corrected, when, why) — which is precisely the
evidence a reviewer needs to decide whether the error was innocent.

Editing in place is the tempting alternative and it is a category error:
it optimizes the trail for *looking right* at the cost of *being
trustworthy*, and a trail that has been edited once, for a good reason, is
a trail whose every record now carries an asterisk
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) — the
wrong record is the artifact that exposes the defect; removing it removes
the evidence that the defect occurred). The supersession pattern requires
only two fields: a stable record identifier to point at
([identity-survives-reuse](../../_laws.md#identity-survives-reuse) — the
reference must survive export, re-import, and store compaction, so it is a
minted identifier, never a row position or a timestamp), and a record type
that distinguishes corrections from first-writes so counts don't double.

## Ordering is part of the claim

"What happened" includes "in what order." Two disciplines keep order
honest:

- **One clock per ledger**: the timestamp is assigned at the chokepoint,
  by the ledger's own clock, at insert — never passed in by callers whose
  clocks and honesty vary. A caller-supplied "when it happened" can be
  carried as a *separate, labeled* field when the domain needs it
  (event-time vs. record-time); the two must never share a column.
- **A monotonic tiebreaker**: same-instant records need a stable order
  (an insertion sequence), because reconstructions read the trail as a
  narrative and a narrative that reorders under re-query invites doubt
  about everything else.

## Tamper-evidence, priced honestly

Plain append-only defends against *casual* history-editing — the
convenience edit, the well-meaning cleanup. Against a *privileged
adversary* (someone with direct store access) it defends nothing, and a
principal engineer says so rather than gesturing at immutability. The
escalation ladder, each step bought only when a real reader demands it:

1. **Nothing beyond module shape** — right for trails whose audience is
   the operating team itself. Most internal trails live here, and
   pretending otherwise buys cost without a threat model.
2. **Hash chaining** — each record carries a digest of its content plus
   the previous record's digest; editing or deleting any interior record
   breaks the chain from that point forward. Cheap at write time; makes
   tampering *detectable*, not impossible. Requires deciding what anchors
   the chain's head (a periodically exported checkpoint, or the chain is
   only as trustworthy as the store it lives in).
3. **External anchoring** — periodically ship the chain head (or the
   records themselves) to a store under different administrative control.
   This is the only rung that survives a fully privileged local
   adversary, and it converts the integrity claim into "these two
   independently controlled systems would both have to be corrupted."

Retention-trimming and hash chains interact: trimming the tail breaks
naive verification, so chained ledgers trim at checkpoint boundaries and
retain the checkpoint digests. Decide this when adopting rung 2, not
during the first trim.
