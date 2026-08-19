---
layer: technique
subject: sync-replication
technique: sync-observability
status: forged
laws: [failure-not-empty-success, count-carries-predicate, deletion-is-not-repair]
shared_with: []
---

# Sync observability

A sync engine's defining hazard is that its failure is invisible by
default: the application keeps working — reads serve, writes land,
nothing errors in front of the user — while propagation has quietly
stopped. The gap between "believed synced" and "actually synced" widens
until an external event cashes it in: a device is lost, a teammate acts
on a stale view, a restore picks the wrong side. **A sync that fails
silently is data loss on a schedule.** The counter is a surface the
engine owes the operator, per stream, kept as rigorously as the data
path itself.

## The per-stream status snapshot

One inspectable record per stream, updated by the loop itself:

- **state** — from a closed vocabulary: idle, syncing, degraded, failed,
  disabled. "Never ran" is its own state, distinct from "ran and found
  nothing" ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **cursor position and source tail** — progress is only meaningful as
  the *pair*; a still cursor beside a still tail is health, the same
  cursor beside a moving tail is lag.
- **lag, with its predicate** — how many changes pending, since when,
  measured how ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
  "Behind" is a feeling; "214 changes pending, oldest 3 days, counted as
  tail minus cursor" is actionable.
- **last success and last attempt, separately** — the two clocks
  diverge exactly when things break, and their gap is the age of the
  problem.
- **last error, verbatim** — the terse category for the dashboard, the
  full text for the operator. A status that says only "error" makes
  every incident start with reproduction instead of reading.

The snapshot is written by the loop as it works — not derived by a
second system watching the loop, which adds a second thing to doubt.

## Fault isolation: one stream's failure strands nothing else

The loop iterates streams such that a failing stream — schema drift, a
poison record, a far-side rejection — marks *its own* status failed and
the pass continues to the next stream. The alternative, one exception
aborting the whole pass, converts any single stream's defect into total
sync stoppage, and (worse) attributes it to whichever stream happened to
run first. Isolation is also what makes the status surface trustworthy:
"streams A–F healthy, G failed with X" is a diagnosis; "sync is broken"
is a support ticket. The same isolation demands per-stream backoff — a
chronically failing stream retreats to a slower cadence without
dragging its healthy siblings' latency down with it.

Isolation has a boundary worth stating: streams with integrity
dependencies (a child stream referencing a parent stream's records)
fail *together* toward the dependent side — parent failed means child
holds, not child proceeds into dangling references. Declared dependency,
not discovered breakage.

## Staged inbound: land beside, review, then apply

Where inbound changes are risky — a merge that could overwrite local
work, an external source of variable trust, a first sync against a
store with existing content — the honest posture is **staging**: land
incoming changes in a holding area beside the live data, present what
would change (adds, updates, deletes, conflicts, as a diff), and apply
on review. Staging converts "the sync did something surprising" from a
forensic reconstruction into a preview that was declined. It is the
inbound sibling of the conflict lane's park-preserve-present, applied
to whole batches; like parked conflicts, staged batches age visibly and
name an owner, because a staging area nobody drains is just divergence
with a waiting room.

Two disciplines make a staging area trustworthy. **One consumer**: the
reviewing/reconciling process is the only path from staged to applied —
a second path that force-writes around it makes the review theater.
**Mark consumed, don't delete**: a staged item is stamped with what
consumed it and when, rather than removed — a redelivered duplicate is
then visibly already-processed (echo prevention for free), and a bad
apply is auditable back to the exact batch that caused it instead of
merely regrettable.

## Alarms fire on the gap, not the error count

The pager-worthy signal is not "an attempt failed" — transient failures
are the outbound leg's weather — but **the widening gap**: last success
older than a threshold while local changes accumulate; backlog age
crossing the horizon that tombstone retention or history pruning
assumes (a replica about to fall off the incremental path is an
emergency *before* it does); a stream disabled by strike-out that no
human has acknowledged. And the standing rule for quieting an alarm:
fix the stream or explicitly accept the lag — never delete the status
row, widen the threshold at incident time, or drop the stream from the
loop to make the dashboard green
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)); the
alarm was the one place the silent failure was visible.
