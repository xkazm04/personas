---
layer: golden-path
subject: embedded-db
status: forged
techniques:
  - connection-pooling
  - quiet-window-maintenance
  - journal-and-durability-modes
  - extension-lifecycle
  - storage-accounting-and-pruning
  - db-self-instrumentation
evidence:
  - src-tauri/db/src/lib.rs                                      # pool construction (sized in a reasoned comment, 5s acquire timeout), acquire_logged instrumentation, STANDARD_PRAGMAS one-authority batch, gauge-gated idle maintenance task
  - src-tauri/db/src/perf.rs                                     # shared latency ring keyed by table, read-time p95, slow-query warn budget with suppression summary
  - src-tauri/db/src/vector_store.rs                             # extension auto-registration BEFORE pool creation, ordering rationale in the doc comment
  - src-tauri/src/commands/infrastructure/system/storage.rs      # usage report + dry-run-default prune with 24h age floor and terminal-state allowlist
  - src-tauri/db/src/backup.rs                                   # journal sidecars named in backup scope (SIDECAR_EXTENSIONS)
counter_evidence: []
deviations:
  - w9-embedded-db   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-migrations   # the second database operated without the first one's discipline — registered under migrations
---

# Embedded database operations

An embedded database runs inside the application process, against a file the
application owns, on a machine the application does not. There is no server to
administer — which is routinely misread as "there is no administration." The
truth is the opposite: every operational duty a database team performs for a
server — capacity planning, maintenance scheduling, durability configuration,
backup scope, connection management, performance triage — still exists, and
all of it lands on the application code, running unattended, on hardware
chosen by someone else, next to a user who is trying to get work done. The
subject of this document is that transfer of duty: **the application is the
database operator**, and operator work that is not written as code simply
does not happen.

Boundaries, so the neighbors stay crisp: how the schema evolves across
releases is [migrations](../migrations/migrations.md); how queries are
built, mapped, and layered is [data-access](../data-access/data-access.md);
how the application measures itself in general is
[perf-instrumentation](../perf-instrumentation/perf-instrumentation.md) —
this subject's self-measurement is the database specialization of that
discipline. What remains here is operating the engine: the pool, the
durability contract, maintenance, extension boot ordering, and the storage
lifecycle.

## The database competes with the user for the machine

On a server, maintenance windows are negotiated with a calendar. In a
user-facing process, the negotiation partner is the user's attention, and it
is renegotiated every second. A compaction pass, a journal checkpoint, an
index rebuild — each is a burst of I/O and page-cache pressure on the same
spindle, the same cores, and often the same database lock that the user's
next click needs. Maintenance scheduled by wall clock **will** eventually
fire mid-interaction, because a timer knows nothing about interactions; the
janky stall it causes is then misattributed to whatever feature the user was
touching, and the actual culprit never appears in any profile because it ran
in a different subsystem.

The standard is therefore: **maintenance runs in quiet windows detected from
real activity signals, never on a bare timer.** The application already knows
whether it is busy — requests in flight, an interaction happening, work
queued. That knowledge must be piped to a gauge the maintenance scheduler
reads at the moment it would start, and re-reads between chunks so a long
pass yields when the user returns. The full discipline — which signals count
as activity, deferral policy, chunking, and what to record about every pass —
is [quiet-window-maintenance](techniques/quiet-window-maintenance.md).

## Durability is a contract you signed, whether you read it or not

Every embedded engine offers a matrix of journal modes and synchronization
levels, and shipping a configuration means signing that contract: what
survives a process kill, what survives a power cut, how readers and writers
block each other, and — least remembered — **which files on disk are now part
of the database**. Write-ahead journaling, the usual choice for interactive
apps because readers stop blocking the writer, moves recent commits into
sidecar files next to the main store. From that moment, "the database" is a
*set* of files whose consistency is joint: a backup, a file-sync tool, or a
support-bundle exporter that copies the main file alone captures a store
missing its most recent commits — a corruption you manufactured out of a
healthy database, discovered only at restore time, which is the one moment
you cannot afford discovery.

The contract must be chosen once, written down with its reasons, asserted at
boot (engines silently fall back when a mode cannot be honored on a given
filesystem), and honored by every consumer of the files — backup scope,
export, sync, "reveal in file manager" affordances. The mode matrix, the
sidecar inventory, checkpoint interaction, and the crash-consistency
expectations worth testing are
[journal-and-durability-modes](techniques/journal-and-durability-modes.md).

## The pool is the front door, and an unwatched front door hides every queue

An in-process engine tempts with "connections are cheap, just open one" —
and then the application grows threads, background jobs, and a UI that all
want the store at once, and a pool appears. The pool is now the single choke
point every data operation passes through, which makes it simultaneously the
best instrumentation point in the entire system and the worst place to be
blind. Uninstrumented, pool contention is invisible by construction: callers
experience it as "the query was slow," the query itself measures fast, and
the wait happened in the gap between the two that nobody timed.

The standard: **every acquisition is timed and attributed.** Who asked, how
long they waited, against what timeout policy — cheap to record, and the
only data that can distinguish "the engine is slow" from "the pool is
sized wrong" from "one caller is hoarding." Sizing for an embedded engine is
its own doctrine — the engine typically rewards few writers and tolerates
many readers, so the server-derived instinct of "more connections = more
throughput" is exactly backwards — covered with acquisition instrumentation
and leak discipline in
[connection-pooling](techniques/connection-pooling.md).

## Boot order is part of the schema

Engines are extended in-process: loadable modules, registered functions,
custom collations, virtual table implementations. Every one of these is a
**per-connection or per-process capability that must exist before the first
statement that depends on it** — and the pool multiplies the hazard, because
a pool manufactures connections on demand, later, on whatever thread hits it
first. Registration that happens "at startup, around the same time as the
pool" is a race that usually wins in development (one connection, warm
timing) and loses in the field. The failure is a boot failure or, worse, a
mid-session failure on the pool's second connection — either way an ordering
bug wearing a database error's costume.

The standard: extension registration is sequenced *strictly before* pool
creation, through one registration door, with an explicit policy for load
failure — refuse to boot, or degrade with the capability marked absent, but
never limp into a session where some connections have the capability and
some do not. The ordering proof, feature-gating, and failure policy are
[extension-lifecycle](techniques/extension-lifecycle.md).

## Storage grows forever unless something owns pruning

A server database has a capacity dashboard and a human who reads it. An
embedded store has neither — it sits in a hidden application-data directory,
growing monotonically, on disks that are smaller and fuller than developers
assume. Every table that records events, executions, logs, messages, or
metrics is an unbounded accumulator unless code says otherwise, and
[creation-names-reaper](../_laws.md#creation-names-reaper) applies to tables
exactly as it applies to temp files: **a table whose rows are born without a
named reaper is a slow-motion incident.**

Ownership means two artifacts. First, **accounting**: a per-table usage
report — rows, bytes, share of total — cheap enough to run on demand,
because "the database is 2 GB" is not actionable and "one table is 1.7 GB of
it" is. Second, **pruning with the safety rails of a destructive operation
run unattended on the only copy of the user's data**: dry-run by default
(report what *would* be deleted; deleting requires the explicit flag), age
floors (never touch rows younger than a stated horizon), and terminal-state
allowlists (only rows in completed/failed/expired states are ever
candidates — in-flight work is never prunable regardless of age). Reclaiming
file space afterwards is a separate, heavier operation that belongs in a
quiet window. All of it is
[storage-accounting-and-pruning](techniques/storage-accounting-and-pruning.md).

## The engine is instrumented from inside or it is folklore

There is no external monitoring agent watching an embedded store; either the
application measures its own database behavior or every performance
conversation about it is folklore. The economical standard is per-operation
latency records in bounded rings, keyed by the closed vocabulary of tables or
operation families, with derived percentiles and slow-operation counts
surfaced on demand — the database specialization of
[ring-buffer-metrics](../perf-instrumentation/techniques/ring-buffer-metrics.md),
inheriting its whole discipline: bounded memory by construction, raw records
with statistics derived at read time, and an instrument whose own cost is
budgeted and asserted. What is database-specific — what to key by, which
thresholds mean "slow" for a local store, and how the instrument feeds the
quiet-window gauge and the pruning report — is
[db-self-instrumentation](techniques/db-self-instrumentation.md).

## The second database is the forgotten one

Applications that embed one database eventually embed two: a vector sidecar,
a cache store, a plugin's private file, an analytics buffer. Every discipline
above was adopted for the first store because incidents taught it — and the
second store arrives quietly, through a library default or a feature branch,
with none of it: no snapshot before its schema changes, no journal-mode
decision, no backup scope entry, no usage accounting, no pruning, no
instrumentation. The asymmetry is not carelessness; it is that the first
database's discipline lives in code *specific to the first database* rather
than in a checklist applied to "any store this application opens." The
observable signature: the disciplines that do reach the second store are
exactly the ones that were factored into shared machinery — a common
connection-configuration batch, a common pool builder — while the ones
written inline against the first store's filename (its snapshot ritual, its
migration runner) never travel. Discipline packaged as a shared function
propagates by default; discipline written as first-store code has to be
remembered, and is not.

The standard is an **inventory obligation**: the application maintains one
authoritative list of every persistent store it opens
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
applied to stores), and every entry answers the same questions — who
migrates it, who backs it up (including its sidecars), who prunes it, who
measures it, what happens if it is deleted. A store that cannot answer is
not "lightweight"; it is the next incident, filed under a feature name
instead of a database name. This repository's own ledger records exactly
this gap against its second store (see `deviations:` above) — the finding
that motivated elevating the rule from advice to standard.

## The techniques

- [connection-pooling](techniques/connection-pooling.md) — sizing for an
  in-process engine, reader/writer asymmetry, instrumented acquisition,
  timeout policy, leak discipline.
- [quiet-window-maintenance](techniques/quiet-window-maintenance.md) —
  activity gauges over timers, deferral and chunking, yielding to the user,
  recording every pass.
- [journal-and-durability-modes](techniques/journal-and-durability-modes.md) —
  the mode matrix as a signed contract, sidecar files in every copy path,
  boot-time assertion, crash-consistency testing.
- [extension-lifecycle](techniques/extension-lifecycle.md) — registration
  strictly before pool creation, one registration door, feature gating,
  load-failure policy.
- [storage-accounting-and-pruning](techniques/storage-accounting-and-pruning.md) —
  per-table usage reports, dry-run-by-default pruning, age floors,
  terminal-state allowlists, space reclamation as a separate act.
- [db-self-instrumentation](techniques/db-self-instrumentation.md) —
  per-table latency rings, slow-operation counting, thresholds for a local
  store, the instrument's own budget.
