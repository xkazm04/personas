---
layer: technique
subject: migrations
technique: pre-migration-snapshots
status: forged
laws: [creation-names-reaper, gate-sees-target, count-carries-predicate]
shared_with: []
---

# Pre-migration snapshots

Migrations are one-way doors, so the system manufactures its own undo: a
copy of the store taken immediately before the door swings. On an end-user
machine this snapshot is usually the *only* backup in existence — there is
no central copy, no operator's dump from last night. That makes its contract
worth specifying as carefully as the migration itself.

## When: after the decision, before the first step

The snapshot is taken when the runner has determined that at least one step
is pending, and before that step executes. Not on every boot — a fleet-wide
copy of every store on every startup is churn that buys nothing and ages the
rotation window prematurely. Not per-step — the meaningful restore point is
"the last shape the previous release ran happily against", which is the
pre-chain state; mid-chain snapshots restore to a version no released code
targets. And never *after* — a snapshot of the migrated store preserves the
outcome you might need to escape from.

One refinement: snapshot only when the pending work is real. A ledger
comparison that says "zero steps pending" must produce zero snapshots; a
runner that cannot read the ledger must *fail*, not shrug and skip both the
snapshot and the chain (that distinction is the boot contract in
[error-propagation](error-propagation.md)).

A ledger-less replay design has no "is work pending?" signal at all, so it
cannot implement this refinement — it is forced to snapshot on **every boot
of an existing store** and lean on rotation to cap the cost. That is a
workable posture (and honest systems document it as a priced consequence of
going ledger-less, not as a feature), but note what it spends: the rotation
window now ages in *boots*, not in *migration boundaries*, so a few
restarts after a bad migration can rotate away the only good copy exactly
when it matters most. If every-boot is the only option, the retention count
must be sized for restart storms, not calm weeks.

## What: the store is more than one file

Storage engines with journaling keep recent state in **sidecar files**
alongside the main file — a write-ahead journal, a rollback journal, shared
memory scratch. Between checkpoints, real committed data lives *only* in the
sidecar. Copying the main file alone therefore snapshots a torn state: it
can be missing the last minutes or hours of the user's work, and the tear is
invisible until restore day.

Two correct spellings:

1. **Quiesce, then copy**: checkpoint/flush so the main file is complete,
   hold writers off, copy the file set, release. Simple, and honest about
   its exclusivity requirement.
2. **Use the engine's own backup facility**, which produces a consistent
   copy under concurrent activity. Preferable where it exists; the engine
   knows its own file topology better than the caller does.

What is never correct is a bytewise copy of a live, journaling store taken
while writers run.

## Verify at creation, not at restore

The worst possible moment to discover a snapshot is unreadable is the moment
you need it. So the writer verifies before proceeding: the copy exists, has
plausible size, carries a valid header — ideally opens read-only and passes
the engine's integrity check. Only then does the migration chain get to run.
An unverified backup is a gate that never looked at its target
([gate-sees-target](../../_laws.md#gate-sees-target)): the thing being gated
is "recoverability", and only opening the copy observes it.

What if the copy *fails* — disk full, file locked, permissions? The honest
policy keys on what is known about the pending work. When the runner knows
a destructive step is pending, proceeding without a snapshot is running the
one-way door with the safety net cut: refuse. When the pending work is
additive, or the design cannot know what is pending, blocking every boot on
backup failure converts a hypothetical risk into a certain outage — proceed,
but *loudly*: the skipped snapshot is named in the log and carried into any
later failure report, so "migration failed AND there was no snapshot" is
never discovered as a surprise. What is indefensible is the quiet middle:
a failed copy logged at debug level and a chain that runs as if protected.

## Name the snapshot with what it preserves

A restore must know what code can open the file it is restoring. So the
snapshot's name (or manifest) carries the **schema version it preserves**
and the moment it was taken — a count with its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "backup,
version 41, taken before attempting 42–45" is actionable; `backup-final-2`
is archaeology.

## Rotation: creation names the reaper

Snapshots are created automatically, so they must be destroyed
automatically, by policy declared where they are created
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — otherwise
the fleet slowly fills user disks with copies of their own data, and the
"fix" someone eventually ships is deleting all of them.

Rotation is keyed by **migration boundary, not by date**: keep the last N
pre-migration snapshots. Date-based expiry deletes the only good copy on the
machine that has been powered off for a year; boundary-based retention keeps
one restore point per one-way door, which is exactly what the doors demand.
Retain at minimum the most recent boundary; more if disk allows. And the
rotation deletes the *whole* snapshot — main file plus any sidecars captured
with it — or restore day meets the torn-state problem from the other side.

## The restore path is a deliverable, not a hope

A snapshot nobody can apply is storage, not safety. The restore path must
exist as a first-class artifact:

- **Mechanics**: stop all store access; move the damaged store aside
  (never delete it — it is evidence, and sometimes the failed migration is
  the recoverable one); put the snapshot's file set in place; restart. The
  restored store's ledger reads the old version, so the next boot will
  re-attempt the chain — which is correct, and is why restore pairs with
  fixing the step, not with retry loops.
- **Semantics**: restoring discards everything written after the snapshot.
  Automatic restore is defensible only in the one window where that loss is
  provably empty — the same boot, when the failed chain halted the
  application before it wrote anything. Outside that window, restore is a
  consented act: the person losing the delta decides.
- **Exercised**: the restore procedure is executed in tests — snapshot,
  damage, restore, verify — or it will be executed for the first time in
  production, by whoever is worst positioned to debug it.
