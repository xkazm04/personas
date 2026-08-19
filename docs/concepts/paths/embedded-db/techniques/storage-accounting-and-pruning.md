---
layer: technique
subject: embedded-db
technique: storage-accounting-and-pruning
status: forged
laws: [creation-names-reaper, count-carries-predicate, deletion-is-not-repair]
shared_with: []
---

# Storage accounting and pruning

An embedded store grows monotonically by default: every event log, execution
record, message, and metric row is appended by code that will never think
about it again, into a file in a hidden directory on a disk the application
does not monitor. [creation-names-reaper](../../_laws.md#creation-names-reaper)
is the governing law, applied at the granularity of tables: **every table
whose rows accumulate names its pruning policy at design time**, or the
table is an incident with a long fuse. This technique is the two artifacts
that make the law operational — an accounting report and a pruner with
unattended-destructive-operation safety rails — plus the space-reclamation
step both of them get confused with.

## Accounting: the per-table usage report

"The database is 2 GB" triggers panic; "one table is 1.7 GB of it" triggers
a fix. The unit of actionability is the table, so the report is per-table:
row count, estimated bytes (engines expose page-accounting facilities for
this; row-count × average-size is an acceptable fallback *labeled as an
estimate*), and share of the total. Per
[count-carries-predicate](../../_laws.md#count-carries-predicate), every
number in the report carries how it was measured — a byte figure that might
be "pages allocated" or "bytes in live rows" (they diverge by exactly the
reclaimable space) is two different claims, and conflating them makes the
report unable to answer its own follow-up question ("will pruning shrink
the file?").

The report is cheap enough to run on demand, is exposed to the user in
some form — it is their disk — and covers **every store the application
opens**, not just the main one: the second database evades accounting by
being nobody's table, which is precisely how it becomes the incident.

## Pruning: destructive, therefore ceremonial

The pruner deletes the user's data, unattended, from the only copy. Its
design borrows the ceremony of any destructive unattended operation:

- **Dry-run is the default.** Invoked without an explicit flag, the pruner
  *reports* — per table: candidate rows, bytes, oldest and newest candidate —
  and deletes nothing. Actual deletion requires the affirmative parameter.
  This inverts the usual CLI convention on purpose: the cost of a
  dry-run-when-you-meant-delete is running it again; the cost of the inverse
  error is permanent.
- **Age floors.** No row younger than a stated horizon is ever a candidate,
  regardless of any other property. The floor exists because every
  eligibility predicate eventually has a bug, and the floor bounds the
  blast radius of that bug to data old enough that a snapshot or export
  likely covers it.
- **Terminal-state allowlists.** Only rows in explicitly enumerated
  terminal states — completed, failed, expired, superseded — are candidates.
  An allowlist, not a blocklist: when a new state is added to the
  vocabulary, the fail-safe direction is "new state is not prunable until
  someone says so." In-flight, pending, or referenced rows are never
  candidates at any age; age does not make live work deletable.
- **Referential closure.** A prunable parent takes its dependent rows with
  it in the same transaction, or is not prunable; orphans created by
  pruning are corruption on the installment plan.
- **Observability.** Every run — dry or live — records what it selected,
  what it deleted, and under which policy version. The pruner is the one
  writer whose write is *disappearance*; without its own ledger, "where did
  my history go?" has no answer and the pruner is indistinguishable from a
  bug. Which is also the boundary of
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair): pruning
  manages capacity under a stated policy — it must never be the response to
  a defect ("the table is huge because a retry loop went wild — prune it"),
  because deleting the evidence and keeping the defect converts a visible
  incident into a recurring invisible one.

## Reclamation: deleting rows does not shrink the file

Embedded engines recycle freed pages internally; the file does not shrink
when rows die. Users measure the promise "pruning frees space" in file
bytes, so the gap between "rows deleted" and "bytes returned to the disk"
is a support ticket unless the design closes it. Space reclamation —
whether incremental page-release or a full compacting rewrite — is a
**separate, heavier act**: it contends for the store (quiet-window work —
[quiet-window-maintenance](quiet-window-maintenance.md)), a full rewrite
transiently needs up to double the disk (worth checking *before* starting,
on the user's possibly-nearly-full drive — the tool that frees space must
not be the tool that fills the disk), and it is triggered by evidence from
the accounting report (reclaimable share crossing a threshold), not by
schedule. The report, the pruner, and the reclaimer form a deliberate
pipeline: measure, then delete under policy, then compact when the measured
free-space ratio says it pays.

## Retention is a product decision wearing an engineering costume

The age floor and the allowlist encode "how much history does this
application owe its user" — a question engineering cannot answer alone.
What engineering owes the decision is the shape above: policies stated per
table, enforced in one pruner (not N ad-hoc delete-old-rows queries — one
door, enumerable writers), defaulting to keeping data when uncertain, and
observable after the fact. A user who asks "why is last March gone?" gets
an answer that names a policy; a user who asks "why is my disk full?" gets
a report that names a table. Both questions arriving with no answer is
what this technique exists to prevent.
