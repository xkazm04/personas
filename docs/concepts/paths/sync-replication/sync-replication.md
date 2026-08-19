---
layer: golden-path
subject: sync-replication
status: forged
techniques:
  - topology-declaration
  - change-tracking-and-cursors
  - tombstone-propagation
  - conflict-detection-and-policy
  - projection-security
  - sync-observability
evidence:
  - src-tauri/src/cloud/sync/mod.rs                       # periodic tick + lossy wake + persistent dirty flag; per-table fault isolation; status snapshot; tombstone cascade with hold-on-failure
  - src-tauri/src/cloud/sync/cursor.rs                    # durable per-stream cursors in the settings store; bounded first backfill (epoch vs 90-day per table); peek vs get so "never synced" stays distinguishable
  - src-tauri/src/cloud/sync/rows.rs                      # secret-free projections (SELECTs structurally never read vault/encrypted columns); payload sanitization (key + value heuristics, size bound); tombstone reads
  - src-tauri/src/commands/obsidian_brain/conflict.rs     # three-way compare on content hashes; ConvergedConflict as a distinct outcome from NoChange, with the audit-trail rationale written down
  - src-tauri/engine/src/workspace_sync/merge.rs          # deterministic LWW scoped to same-user devices (total function: modified_at, tie by device id); tombstone as a first-class enum variant; generic over snapshot types
  - src-tauri/engine/src/workspace_sync/snapshot.rs       # allowlist-by-construction projection ("a secret field simply has no home on this struct"); content hash excludes the LWW timestamp
  - src-tauri/engine/src/workspace_sync/crypto.rs         # encrypted payloads: HKDF-derived shared key per device group, sealed snapshots for the untrusted transport
  - src-tauri/src/companion/brain/sync_staging.rs         # staged inbound changes: single consumer (the reconcile phase), mark-processed-not-delete, no force-write path into memory
counter_evidence:
  - src-tauri/src/cloud/sync/mod.rs                       # ALSO the key counter-example: process_tombstones advances its cursor from a clock read captured at tick start (the exact race the table path's own comment fixes 110 lines earlier) and discards the write's Result; and the tombstone table it reads has no producer — the whole delete cascade is dead code that reads as shipped
deviations:
  - w8-sync-replication   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Sync, replication & conflict resolution

Sync is the machinery you build when the same data must exist in more than
one place on purpose: a local store mirrored to a hosted one so teammates
can see it, a working set carried across a user's devices, a note
collection kept coherent between an application and an external editor.
The unit of currency is the **replicated record** — a durable row or
document that has a life on both sides of a boundary — and the job is to
keep the copies converging toward agreement while each side keeps
operating independently.

That definition decides when *not* to build sync:

- **When one side is a cache**, not a peer. A cache is repaired by
  invalidation and refetch from the single authority; it never pushes
  back, never merges, never holds a tombstone. Building merge machinery
  for a cache buys conflict bugs for data that has no conflicts.
- **When the copies never operate disconnected.** If every consumer can
  afford a call to the source at read time, replicate nothing — the
  cheapest sync is the one you did not build, and every copy you create
  is a divergence you now owe convergence for.
- **When what crosses the boundary is a fact, not a record.** "Something
  changed" is an event, and event plumbing — named vocabularies,
  subscriptions, delivery honesty — is a different subject with different
  physics ([event bus & realtime
  subscriptions](../realtime-events/realtime-events.md)). Sync *uses*
  events as its wake signal, but the event channel is allowed to be
  lossy precisely because the durable transfer loop, not the event,
  carries the truth.

Everything else in this subject is the discipline of holding four
promises that replicated systems break by default: the topology is what
it claims to be, progress marks survive restart without loss or replay,
deletes propagate as faithfully as writes, and disagreement is detected
and resolved by a policy someone actually chose.

## Declare the topology, honestly

The first design act is naming the shape of the flow, because each shape
has different conflict physics and the machinery for one silently
corrupts under another:

- **One-way mirror**: a source projects into a replica that never writes
  back. No conflicts can exist *if the promise holds* — which means the
  promise must be enforced, not assumed. A "read-only" replica that
  quietly accepts local edits is a two-way sync with no conflict
  detection: the next mirror pass overwrites the local edit, or worse,
  half of it.
- **Hub and spoke**: many replicas converge through one authority that
  orders writes. Conflicts exist but are adjudicated in one place, with
  one clock worth trusting.
- **Peer merge**: replicas exchange changes with no distinguished
  authority. Conflicts are structural, not exceptional; every record
  needs enough history or versioning to detect concurrent edits, and the
  merge function is the system's constitution.

The declaration is **per stream, not per system**. A grown sync surface
carries different tables in different directions — this one mirrors down,
that one pushes up, a third merges — and the honest artifact is a table
of (stream, direction, authority, conflict policy). A system that
declares one global direction and implements exceptions in code has
undeclared two-way streams, and undeclared two-way streams corrupt
silently: nothing detects what nothing admits can happen. The
[topology-declaration](techniques/topology-declaration.md) technique owns
the shapes and their enforcement.

## Progress is a durable, per-stream cursor

A sync loop's memory of "how far did I get" is a cursor, and two
properties are non-negotiable. **Durable**: the cursor survives restart,
because the alternative is re-delivering everything (expensive, and a
duplicate storm on the far side) or skipping to now (silent loss of the
gap). **Per stream**: one cursor per replicated stream, because a shared
cursor couples unrelated streams' fates — one stream's bad batch pins
everyone's progress, and one stream's advance marks another's undelivered
changes as done. The cursor is a stored derivation of "what has settled",
and the loop that reads past it is its named recomputation
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).

Around the cursor sits the cadence machinery: a periodic tick as the
floor, a change-notification wake as the accelerator, and a persistent
dirty mark bridging the two — because the wake channel is allowed to be
lossy (a missed wake costs latency, the next tick heals it) only if the
*fact that work is pending* is stored somewhere lossless. And the first
run of any stream is special: a bounded backfill, not an unbounded replay
of history into a channel sized for increments. The
[change-tracking-and-cursors](techniques/change-tracking-and-cursors.md)
technique owns the loop.

## Deletes are records, or they come back

The signature failure of naive sync is **resurrection**: side A deletes a
record, side B still holds it, the next merge sees B's copy as data A is
missing, and the deleted record walks back in. The cause is treating
delete as the absence of a row; absence carries no information, and sync
is an information-transfer machine. The fix is the **tombstone** — a
first-class record stating "this identity was deleted, here, at this
point" — which propagates through the same cursor loop as any write,
wins or loses against concurrent edits by the same declared policy, and
is reaped only when every replica has provably seen it
([creation-names-reaper](../_laws.md#creation-names-reaper)). The
[tombstone-propagation](techniques/tombstone-propagation.md) technique
owns deletion end to end.

## Conflicts: detect first, resolve by declared policy

Two copies of a record differ. Before any policy applies, the system must
answer a question most implementations skip: **did they diverge, or did
they converge independently?** Two sides that made the same edit are not
in conflict — flagging them as one trains humans to ignore the conflict
lane; silently merging genuinely divergent edits destroys one side's
work. Detection is therefore a comparison of *content* (hashes, not
timestamps — clocks on two devices are an opinion, not a fact) and, where
history is available, a three-way compare against the last common
ancestor, which is what distinguishes "B changed it" from "both changed
it".

Resolution is a policy with a **scope**. Last-writer-wins is legitimate
where the writers are one human on several devices — the "conflict" is
the same mind at two keyboards, and losing the older edit loses nothing
the newer did not supersede. The same policy across *users* is silent
data destruction with a timestamp for an alibi. Where the writers are
peers, the honest lanes are: merge automatically where the structure
permits, and otherwise **park the conflict for a human** — both versions
preserved, neither silently discarded, the disagreement surfaced as a
distinct outcome rather than laundered into a winner
([failure-not-empty-success](../_laws.md#failure-not-empty-success):
"resolved by policy" and "no conflict existed" must be spelled
differently, because only one of them destroyed information). The
[conflict-detection-and-policy](techniques/conflict-detection-and-policy.md)
technique owns detection, the policy taxonomy, and the human lane.

## The projection is a security boundary

What leaves the source is not "the row" — it is an **allowlisted
projection** of the row, built at one door. Replication multiplies every
disclosure by the number of replicas and the lifetime of their backups;
a secret that syncs is a secret you no longer control. So the outbound
edge enumerates fields it sends rather than fields it withholds (a new
column added next quarter defaults to *not replicated*), strips or
re-derives anything secret-adjacent, and — where the transport or the
far store is less trusted than the source — encrypts payloads so the
relay learns nothing. Secrets themselves never replicate at all; they
live behind their own boundary with their own custody rules
([credential vault](../credential-vault/credential-vault.md)), and what
crosses is at most a reference. The receiving side has its own half of
the boundary: every inbound write lands scoped to its tenant, because a
merge that trusts the payload's claimed ownership is a cross-tenant
write primitive. The
[projection-security](techniques/projection-security.md) technique owns
both halves.

## Silent sync failure is data loss on a schedule

A sync that stops and says nothing is worse than no sync: users keep
operating on the belief that their work is propagating, and the gap
between belief and fact widens until something — a lost device, a
teammate's stale view, a restore from the wrong side — cashes it in all
at once. The surface therefore owes the operator, **per stream**: current
status, the cursor's position, when progress last advanced, and the
last error verbatim. Lag is a number with a predicate, not a feeling
([count-carries-predicate](../_laws.md#count-carries-predicate)). And the
loop itself is built so one stream's failure cannot strand its siblings —
fault isolation per stream, the same reason the cursor is per stream.
Where inbound changes are risky enough that applying them blindly is the
hazard, the honest posture is staging: land them beside the live data,
show the diff, apply on review. The
[sync-observability](techniques/sync-observability.md) technique owns
the surface.

## The techniques

- [topology-declaration](techniques/topology-declaration.md) — one-way /
  hub-spoke / peer shapes, per-stream direction tables, enforcing the
  read-only promise, what each shape demands of records.
- [change-tracking-and-cursors](techniques/change-tracking-and-cursors.md)
  — durable per-stream cursors, tick + lossy wake + persistent dirty
  mark, bounded first backfill, advance-after-settle.
- [tombstone-propagation](techniques/tombstone-propagation.md) — deletes
  as first-class records, resurrection-proofing, tombstone retention and
  reaping.
- [conflict-detection-and-policy](techniques/conflict-detection-and-policy.md)
  — content hashing, three-way compare, convergence as a distinct
  outcome, LWW scoping, the human-merge lane.
- [projection-security](techniques/projection-security.md) — field
  allowlists, secret-free projections, encrypted payloads, tenant
  scoping on the receiving side.
- [sync-observability](techniques/sync-observability.md) — per-stream
  status snapshots, fault isolation, staged inbound changes, lag with a
  predicate.
