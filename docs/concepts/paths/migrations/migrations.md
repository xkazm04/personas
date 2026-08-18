---
layer: golden-path
subject: migrations
status: forged
techniques:
  - idempotent-steps
  - pre-migration-snapshots
  - transactional-ddl
  - data-migrations
  - error-propagation
  - schema-drift-detection
evidence:
  - src-tauri/db/src/migrations/mod.rs            # the chain: consolidated initial + incremental replay, ledger-less convergent variant
  - src-tauri/db/src/migrations/incremental.rs    # guarded steps (run_step/already_applied), ddl_step atomic unit, reference table rebuilds, swallow-regression tests
  - src-tauri/db/src/backup.rs                    # snapshot-before-migrate incl. journal sidecars, boundary-keyed rotation, every-boot policy priced in its module doc
  - src-tauri/db/src/migrations/fk_hygiene.rs     # referential-hygiene retrofit via rebuild, idempotency gated on live FK list
  - src-tauri/db/src/migrations/helpers.rs        # data migration with escrow: blob cleared only after every field confirmed extracted; boot invariant assertion
counter_evidence:
  - src-tauri/db/src/migrations/initial.rs        # unguarded `let _ =` ALTER blocks — swallows every error, not just the expected duplicate; the posture the standard bans
deviations:
  - w1-migrations   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Schema migrations

A schema migration is a rewrite of the shape of persistent data, performed on
the data in place. The subject exists because storage outlives code: every
release ships new logic against records written by old logic, and something
must carry those records across the gap. That something runs with elevated
trust — it is the only code in the system explicitly licensed to rewrite the
user's data wholesale — and it runs at the worst possible moment: startup,
before the application has proven it works at all.

The discipline changes completely with **who is present when it runs**. On a
server, a migration is an operational event: an operator watches it, a staging
copy rehearsed it, a central backup predates it, and there is exactly one
database. On an end-user machine, none of that holds. There are as many
databases as there are users; each one is the *only* copy of that user's data;
each migrates unattended at boot, starting from whatever version that machine
last saw — which may be any version ever shipped; and when it fails, the
"operator" is a person who did not know they had a database. Everything below
is written for that harder case. The server case is the same doctrine with the
stakes lowered.

## Migrations are one-way doors

A migration step that has shipped has already run on machines you cannot
reach. From that moment it is history, not code:

- **Never edit a shipped step.** Machines that already ran it will never run
  the edited version; machines that have not yet will. One edit forks the
  fleet into two populations whose stores differ while both report the same
  version — the least diagnosable state this subject can produce. Fix a bad
  shipped step by appending a corrective step after it.
- **Never renumber, reorder, or delete shipped steps.** The chain is an
  append-only ledger. Every version ever shipped is a live starting point
  forever, because somewhere a machine has been powered off since that
  release and will boot tomorrow.
- **Downgrade is refusal, not tolerance.** When code meets a store whose
  version is *newer* than the code knows, the only correct response is to
  refuse to open, naming both versions. "No steps pending" and "this store is
  from the future" must never share an outcome: silently operating on a
  schema the code has never seen corrupts on write, and the corruption is
  attributed to the older, innocent release.

The practical consequence of one-way doors is the **snapshot-before-migrate
contract**: because there is no undo, the system manufactures one — a copy of
the store taken after deciding that at least one step is pending and before
running the first one. A failed migration with a fresh snapshot is a support
case; a failed migration without one is data loss. The full contract —
sidecar files, verification, rotation, the restore path — is the
[pre-migration-snapshots](techniques/pre-migration-snapshots.md) technique.

## Anatomy of the runner

Every serious implementation converges on the same five parts:

1. **A version ledger stored in the data itself.** The store carries its own
   schema version — data about the data, read before anything else. The code
   carries the version it expects. The delta between them is the work list.
2. **An ordered, append-only chain of steps**, each moving the schema from
   exactly version *n* to *n+1*. Steps are small and single-purpose; a
   release may append several.
3. **A snapshot gate** in front of the first pending step (above).
4. **An atomic unit per step**: the step's changes and its version bump
   commit together or not at all. The crash window between "changed the
   schema" and "recorded that I did" is where fleets fork; closing it is the
   [transactional-ddl](techniques/transactional-ddl.md) technique, and
   covering the residue when the engine cannot close it fully is half of
   [idempotent-steps](techniques/idempotent-steps.md).
5. **A halt policy**: the first failing step stops the chain, the ledger
   stays at the last completed step, and the application refuses to start in
   a "maybe migrated" state. What that failure must look like — and why a
   step that swallows its own error is worse than a crash — is
   [error-propagation](techniques/error-propagation.md).

A sixth part is commonly missing and marks the difference between a runner
and a *trustworthy* runner: **a post-migration assertion** that the schema
now actually matches what the version claims. Version ledgers record that
steps *ran*; they do not prove the steps *did what the current code
believes they did*. The gap between those two is real (see the fleet-fork
failure below) and cheap to close at boot.

**The ledger-less variant.** A real alternative replaces parts 1–2 with a
chain of *fully replayable* steps run on every single boot: no version
number anywhere, every step guarded by a probe of its own post-condition,
"migrated" meaning "the chain has reached its fixed point". This is
convergent schema management, and it can be operated well — but its costs
must be priced, not discovered. Every guard becomes load-bearing (a wrong
guard is a wrong schema, not a wrong log line); the chain must be globally
convergent, which no per-step property guarantees (see the oscillation
hazard in [idempotent-steps](techniques/idempotent-steps.md)); a
fully-migrated store still pays every probe on every boot, a tax that only
ever grows; and the system loses the "is work pending?" signal, which
forces the snapshot gate to fire on every boot instead of only at real
boundaries. Choose it deliberately or not at all.

## Two roads must arrive at one schema

Almost every system grows two ways to reach the current schema: a **fresh
install** path (create everything at the current shape, no history) and an
**upgrade** path (replay pending steps over an existing store). The moment
both exist there are two authorities for what "the current schema" means,
and they drift — silently, because each is only ever tested against its own
population. New users live in the fresh-install universe, veterans in the
upgraded one, and the first divergence ships a bug that reproduces on
exactly one of them.

The deadliest known variant is the **conditionally-guarded step**: a step
written defensively ("add this column only if it is missing") that, on fresh
stores where the chain runs in an order its author did not anticipate,
finds its precondition unmet — the table it patches does not exist yet —
and skips. No error, version advances, and the fleet forks while every
machine reports the same number. A guard that skips is indistinguishable
from a guard that succeeded; the cure — guards that assert instead of
skip, and post-conditions on every step — is the core of
[idempotent-steps](techniques/idempotent-steps.md). The arbiter for the
two-roads problem as a whole is a **convergence test**: build a store fresh,
migrate another from the oldest supported version, and diff the resulting
schemas — they must be identical, mechanically, in a test that runs before
release. That test and its siblings are
[schema-drift-detection](techniques/schema-drift-detection.md).

## Schema changes and data changes are different animals

Adding a nullable column is a schema change: instantaneous, shape-only,
trivially atomic. Backfilling that column for a million existing rows, or
converting every stored payload from one serialization format to another, is
a **data migration**: long-running, crash-exposed in the middle, and capable
of destroying information (a lossy transform with no source column left and
no snapshot in retention is unrecoverable by construction). Data migrations
get their own discipline — bounded batches, resumable watermarks keyed by
row identity rather than position, escrow of the old representation until
the new one is verified — in
[data-migrations](techniques/data-migrations.md). The design smell to catch
at review time is a "migration" that is really both animals fused: split the
shape change and the rewrite into separate steps so each can be atomic,
reasoned about, and retried on its own terms.

## The drift class nobody's compiler catches

Queries are strings. The compiler that type-checks the application has no
opinion about whether the columns those strings name still exist. So the
schema can move on while a query written three releases ago keeps naming a
column that a migration renamed or dropped — and nothing fails until that
query runs, at runtime, on a user's machine, possibly on a code path
exercised once a month. The same blindness applies to relational integrity:
rebuild-style migrations and periods of relaxed enforcement leave orphaned
rows that no foreign-key declaration will ever flag retroactively. Both are
detectable *before shipping* — compile every query the code can issue
against the real current schema; sweep referential integrity as a test —
and that sweep-shaped countermeasure family is
[schema-drift-detection](techniques/schema-drift-detection.md).

## When not to migrate in place

In-place evolution is the default, not the law:

- **Rebuild-and-swap** — build a new store file at the target schema, copy
  data across, verify, then atomically swap files — beats a long in-place
  chain when the transformation touches most of the data anyway, or when
  the store's own alteration verbs are too weak for the change. It converts
  "mutate the only copy" into "produce a candidate and promote it", which is
  categorically safer; its cost is double the disk and a hard cutover.
- **Refuse and restore** beats heroics when the store fails its own
  integrity check before migration even starts. Migrating a corrupt store
  launders corruption into the new schema with a fresh version stamp on it.
- **Export-reimport through a neutral format** is the honest path across
  changes so large they are effectively a new product generation. Calling a
  rewrite "a migration" hides its true risk class.

## The techniques

- [idempotent-steps](techniques/idempotent-steps.md) — run-once ledgers vs
  replayable steps, the guarded-change silent-no-op hazard, guards that
  assert, post-conditions.
- [pre-migration-snapshots](techniques/pre-migration-snapshots.md) — the
  backup contract: what to copy, when, verification, rotation, and the
  restore path as a first-class artifact.
- [transactional-ddl](techniques/transactional-ddl.md) — the atomic unit,
  per-step vs whole-chain boundaries, the table-rebuild pattern, and
  integrity-safe ordering around enforcement.
- [data-migrations](techniques/data-migrations.md) — backfills and format
  conversions: batching, watermarks, escrow, eager vs lazy rewriting.
- [error-propagation](techniques/error-propagation.md) — failure spelled
  differently from empty success at boot; why a swallowed step error is the
  worst outcome the subject can produce.
- [schema-drift-detection](techniques/schema-drift-detection.md) — the
  convergence test, query-against-schema compilation, boot-time fingerprint
  assertion, and integrity sweeps.
