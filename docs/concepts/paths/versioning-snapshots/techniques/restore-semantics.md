---
layer: technique
subject: versioning-snapshots
technique: restore-semantics
status: forged
laws: [deletion-is-not-repair, failure-not-empty-success]
shared_with: []
---

# Restore semantics

Restore is the operation the whole subject exists for, and the operation
most often built wrong. The wrong build is intuitive: "go back to v3"
sounds like rewinding, so the naive restore overwrites the live entity
with v3's content, or worse, deletes v4 through v7 to make v3 the head
again. Both are undo mechanisms wearing version clothes, and both destroy
precisely what versioning promised to preserve: the record of what
happened, and the ability to change one's mind about changing one's mind.
Truncating the newer versions is the canonical instance of
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) — the
"repair" consists of destroying the evidence that anything else was ever
tried.

## Restore mints a version

The correct mechanics, in one sentence: **restoring vN creates vM (M >
N), whose content is vN's snapshot and whose lineage says "restored from
vN".** The timeline only moves forward. Consequences, each of them the
point:

- **Restore is reversible by restore.** Went back to v3 as v8, regretted
  it? Restore v7 as v9. No special undo path, no dialog, no data loss —
  the safety property is structural, not procedural.
- **Browsing is free.** Because nothing is destroyed, the version list
  becomes an exploration surface: restore, run it, compare, restore
  back. A destructive restore makes every restore a commitment; a
  forward-only restore makes it an experiment.
- **The audit trail is complete.** "v8 (restored from v3)" is a fact
  future readers can interpret; a rewound head is a lie of omission —
  history that shows v3 as current with no record that v4–v7 were live
  in between.
- **Every restore passes through the one snapshot door.** The restore
  writes a full version like any other creation event — same capture
  routine, same scope, same identity minting. Restores that shortcut the
  snapshot path (copying only the fields the restore author remembered)
  re-create the chimera defect from the opposite direction.

## The re-activation variant

There is a second legitimate implementation, common where versions *run*:
the live entity is treated as a **projection of the active version**, and
restore is a pointer move — re-activate vN, then materialize vN's content
onto the live entity. No new version row is minted, and that is sound
*provided three conditions hold together*: version rows are immutable
(re-activating cannot mutate the past); every change to the live entity
passes through the capture door first (so the pre-restore state already
exists as a version and nothing unversioned is overwritten); and the
activation itself leaves a durable record — who activated what, when,
displacing which incumbent. Miss the second condition and the restore
silently destroys the only copy of the current state; miss the third and
the history shows *states* but not *service* — which version was live
during last Tuesday's incident becomes unanswerable. The append model and
the re-activation model are both forward-only; what neither may do is
rewind: overwrite live state that exists nowhere else, or erase the
record that the timeline took a detour.

## The reconcile step: live state moved since vN

The subtle half of restore. Between vN's capture and today, the live
entity may have accumulated state *outside* the snapshot scope — new
execution history, ratings, references from other entities — and state
*inside* the scope that the operator may not intend to lose (edits made
since the last version was cut, sitting uncaptured in the live entity).
A restore owes two reconciliations:

1. **Capture-before-restore.** If the live entity has uncaptured changes,
   snapshot them first — automatically, as the restore's opening move —
   so the restore never destroys the only copy of the current state. The
   pre-restore capture is the durable-history sibling of the same rule in
   session-scale checkpointing.
2. **Out-of-scope state stays.** The exclusion ledger (snapshot-scope)
   now earns its keep in reverse: everything the snapshot deliberately
   excluded — statistics, history, inbound references — belongs to the
   *entity*, not the version, and survives the restore untouched. A
   restore that resets the entity's execution history restored more past
   than anyone asked for.

## Partial restore is a fork, not a favor

"Restore just the instructions from v3, keep today's configuration" is a
legitimate want and a dangerous operation: its output is a state that
never existed, i.e. a deliberate chimera. Support it only as an explicit
compose operation whose result is — as always — a new version whose
lineage records *both* sources ("instructions from v3 onto v7"). What
must not exist is a partial restore that silently presents itself as
"v3": a version list where the entry labeled v3 may or may not mean v3's
actual state destroys the trust the whole mechanism runs on.

## Failure is loud, and success says what it did

A restore that could not complete — snapshot unreadable, schema
incompatible, referenced dependency gone — fails as a failure, not as a
partial application
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
either the new version exists with the full restored graph, or nothing
changed. Half-restored entities are the worst output this operation can
produce, and "transaction around the whole restore" is the entire cure.
On success, the surface says what happened in this technique's terms —
"created v8 from v3" — because operators who believe restore *rewound*
will misread everything the version list shows them afterwards.

## Prohibitions

1. No overwrite of live state that exists in no version — restore either
   mints the pre-restore state or verifies it is already captured.
2. No truncation of versions newer than the restore point — the timeline
   is append-only.
3. No restore without capture-before-restore when uncaptured live
   changes exist.
4. No restore path that bypasses the single snapshot/capture routine.
5. No partial restore that labels its output as the source version.
6. No partially-applied restore surviving a failure — one transaction,
   all or nothing.
7. No re-activation restore without a durable record of the activation —
   which version went live, when, displacing which incumbent.
