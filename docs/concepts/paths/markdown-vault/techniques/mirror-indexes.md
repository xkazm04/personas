---
layer: technique
subject: markdown-vault
technique: mirror-indexes
status: forged
laws: [derivation-names-recomputation, gate-sees-target]
shared_with: []
---

# Mirror indexes

A filesystem engine has no indexes, no joins, no change feed. The moment
queries outgrow the walk, a second store appears beside the vault — a
relational mirror, a search index, a projection of application data rendered
as notes. Every one of these is a **derivation**, and the technique is the
set of honesty obligations that keep a derivation from quietly becoming a
second authority.

## The vault is authoritative; the mirror names its rebuild

Per [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):
a mirror without a documented, invokable path back from the source is a
future discrepancy with no arbiter. Concretely:

- **Full rebuild exists and is cheap to reach for** — a backfill operation
  that walks the source and regenerates every mirrored record, exposed as a
  first-class action (invoked when the mirror is first enabled, and
  whenever doubt arises), not as a folk procedure in someone's head.
- **Incremental writes are hash-gated.** Each mirrored record's content
  hash is ledgered at write time; a re-run recomputes the hash and skips
  unchanged records. This makes the mirror loop idempotent and cheap enough
  to run eagerly — the property that keeps it *actually* run, which is the
  property that keeps it fresh.
- **Mirror failure never breaks the primary path.** Mirroring rides along
  on source-side writes; an error there is logged observability, not a
  gate. A knowledge projection that can fail the transaction it observes
  has inverted the dependency the word "mirror" promises.

## Confess what the skip-gate reads

The hash gate compares the new content against **the ledger's record of the
last write — not against the file on disk**. Per
[gate-sees-target](../../_laws.md#gate-sees-target), that gap must be named:
if the human deletes or edits a mirrored note in their editor, the ledger
still says "current", and the incremental pass will skip the record forever
while the disk disagrees. For a one-way projection this may be acceptable —
and then it is *declared* acceptable — or a periodic reconcile pass compares
ledger to disk and re-emits divergent records. What is not acceptable is the
default that emerges from silence: a gate that reads a proxy, believed to
read the target.

## Direction is the contract

Two different promises hide under "the database and the vault hold the same
data", and conflating them is the technique's classic defect:

- **One-way projection (application → vault).** Application records rendered
  as notes so the human can read, search, and link them in their own editor.
  The projection is **disposable output**: regenerated at will, overwritten
  on source change — which means human edits to projected notes are lost by
  contract. That contract must be visible (in the projected note's own
  metadata is the honest place), because a note sitting in the human's vault
  *looks* editable, and silently reverting a human's edit teaches them the
  application fights them for their files.
- **Two-way sync (application ↔ vault).** Both sides are live edit surfaces.
  This is strictly harder and cannot be improvised from the projection: it
  requires remembering each record's content at last sync (the base), and
  classifying every subsequent state by three-way comparison — base vs
  current application content vs current vault content. Only-one-side-moved
  flows automatically; both-moved is a **conflict escalated to the human**,
  never auto-resolved by timestamp or by whoever wrote last. Even the lucky
  case — both sides changed and converged on identical content — is
  surfaced distinctly rather than collapsed into "no change", because the
  audit trail's job is to record that a real conflict was avoided by
  chance. The comparison-and-policy discipline is
  [sync-replication](../../sync-replication/sync-replication.md)'s ground;
  this technique consumes it and adds only the vault-specific frame: content
  hashes as the cheap identity of a text record.

Choose the direction per record class, on purpose. A store can legitimately
host both — projections for read-mostly reference material, two-way sync
for records the human co-authors — but each record class carries exactly
one of the two contracts, and everyone can see which.

## The high-stakes instance

An agent that keeps its long-term memory as markdown under a relational
mirror inherits every rule above with the stakes raised: there the mirror
divergence is not a stale dashboard, it is an agent believing something its
own store no longer says. [agent-memory](../../agent-memory/agent-memory.md)
holds that evidence and the provenance discipline layered on top.
