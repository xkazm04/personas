---
subject: software-engineering/embedded-db
project: personas
raised_by: intake intake-hermes-0902 (peer comparison)
source: librarian/sources/2026-09-02-hermes-agent.md
stage: data layer — `src-tauri/db/src/lib.rs` (the pool customizer, `ensure_executions_fts`, and the write path through `PoolExt`), with the boot half in `src-tauri/db/src/backup.rs`
size: 4 files / ~350 lines / M
status: proposed
---

## Why the scope implies it

`.ai/manifest.yaml:97` — "local-first storage". Local-first means there is no
server-side replica: `personas.db` on the operator's machine is the only copy of
78 personas, 351 triggers, 6,535 memories and 2,188 executions
(the figures the 2026-08-17 purge moved into a backup, per
`docs/concepts/golden-path-doctrine.md`). The scope line that grants the
capability is the same line that makes its absence expensive.

Personas has exactly the two data classes this policy keys on, and treats them
identically today. **Canonical**: `persona_executions`, `persona_memories`,
`persona_episodes` — irreplaceable. **Derived**: `executions_fts` (an
external-content FTS5 table over `persona_executions`,
`src-tauri/db/src/migrations/schema.rs:140`), `kb_chunks_fts`
(`src-tauri/db/src/lib.rs:795`), and the vec0 vector tables — all rebuildable
from the rows they index. Personas already knows the distinction well enough to
have found the trap inside it: `executions_fts_drift` reads `%_docsize` rather
than `COUNT(*)`, because an external-content table answers a full scan from the
content table and "could never differ", so the original guard had never fired
and any execution the sync triggers missed stayed permanently unsearchable
(`src-tauri/db/src/lib.rs:433-438`). That is a sharper piece of thinking than
the peer has anywhere in this area.

What is missing is the response. Verified absence: there is no
`PRAGMA integrity_check`, no `SQLITE_CORRUPT` branch, and no quarantine anywhere
in `src-tauri/db/src/lib.rs`. The whole recovery story is
`src-tauri/db/src/backup.rs:1` — a pre-migration copy on every boot of an
existing database, rotated at `MAX_BACKUPS = 3` (`:28`). Three slots is enough
for a bad migration, which is what the module was written for
(`backup.rs:1-10`). It is *not* enough for slow structural damage: a handle that
keeps writing to a damaged file for the length of one session, then boots three
more times, has rotated every good copy out of existence before anyone noticed.
The peer's contribution is precisely the missing rule, and it is a rule rather
than a mechanism: **the corruption class decides the response**, and the class
is knowable from the error at the moment it is raised.

## What the first context contains

**The module.** `src-tauri/db/src/damage.rs` — a small policy module the pool
and the FTS path call into, plus the two call-site changes that use it.

- **Classification.** One function that turns a `rusqlite::Error` into a closed
  three-way verdict: `Derived` (the failing statement names an `*_fts*` object,
  or the error arrives from the FTS sink), `Canonical` (bare `SQLITE_CORRUPT` /
  `SQLITE_NOTADB` — "database disk image is malformed", "file is not a
  database" — with no derived provenance), or `Unrelated`. The classification is
  the whole design; everything else follows from it.
- **Derived damage detaches, and canonical writes continue.** Record a durable
  `fts_stale` marker in `settings`, drop the sync triggers in the same
  transaction, retry the canonical write without the index sinks, and serve
  search from the existing escaped-`LIKE` path (`memories.rs:41`'s
  `escape_like` is the model). The invariant to hold: **a live write or search
  never triggers a rebuild.** Today `ensure_executions_fts` rebuilds at boot
  (`src-tauri/db/src/lib.rs:444`), which is the right moment and stays; this
  only forbids the live path from doing it.
- **Canonical damage quarantines the handle.** Stop writing through it, surface
  a typed `AppError` that the UI renders as a data-integrity incident, and — the
  counter-intuitive half — **do not checkpoint the WAL on close**. A `-wal`
  sidecar that is left intact is forensic evidence and often the recoverable
  half of the file; checkpointing it into a damaged main file is how a
  damaged-but-readable database becomes one that will not open at all.
- **The backup policy learns about it.** `backup.rs` must not rotate a good copy
  out while the store is quarantined. One flag read at boot: if the previous
  session ended quarantined, take the backup and **do not** rotate.
- **A hermetic test.** Damage a copy deliberately (write bytes into a page of a
  temp database built by `init_test_db()`), assert the derived path keeps writing
  and the canonical path stops. This is the assertion the whole module exists for
  and it must be reproducible, not observed once in the field.

**The boundary — what it must NOT absorb.**

- **Migration safety.** `src-tauri/db/src/backup.rs` owns "a bad migration must
  not brick the install", and `src-tauri/db/src/migrations/` owns the idempotent
  replay. This context adds one flag to the backup module and changes nothing
  else about either.
- **The FTS drift check.** `executions_fts_drift` (`lib.rs:444`) answers "is the
  index out of step?" — a *correctness* question about a healthy file. Damage is
  a different question with a different trigger. The two must stay separate
  functions; folding them produces a check that rebuilds on every launch or
  never.
- **Cross-store orphan reconciliation.**
  `src-tauri/db/src/repos/core/memory_reaper.rs` owns rows whose dependents live
  in another file. A corrupt file is not an orphaned row.
- **Encryption and the vault.** `src-tauri/core/src/crypto.rs` and
  `vault-key-handling`'s key-identity problem are adjacent and separate; a
  damaged page is not a rotation problem.
- **The second database.** `personas_data.db` gets the same policy eventually,
  but the first context is `personas.db` only — one store, one classification,
  one test, then the pattern spreads. (`second-database.md` already records that
  the second store "has no snapshot and no restore", which is a different gap
  and should not be conflated with this one.)
- **Automatic repair.** Nothing here runs `.recover`, rebuilds a B-tree, or
  restores a backup on the user's behalf. Stopping the writes *is* the
  protection; the restore stays a deliberate, surfaced act.

## The measurable

The honest problem with this direction is that its payoff number is a
non-event, so the measurables have to be built from things that can be observed
without waiting for a corruption.

1. **Fault-injection survival, as a test.** On a deliberately damaged copy:
   canonical writes that succeed after derived damage (target: 100%), and
   canonical writes attempted after structural damage (target: 0, with a typed
   error). This is the number the direction is actually for, and it is available
   the day the test is written.
2. **Backup horizon under damage.** Simulate: quarantine at boot N, then boot
   three more times. Today, the last good copy is gone by boot N+3. After: it
   survives. Measured as "number of boots before the oldest pre-damage backup is
   rotated out" — today 3, target unbounded while quarantined.
3. **Live-path rebuild count.** Instrument `FTS5('rebuild')` call sites.
   Baseline today should already be 1 (boot only, `lib.rs:444`); the invariant is
   that it stays 1 and never rises. A census rule over `src-tauri/db/**` for
   `rebuild` outside the boot function holds it at pre-push
   (`lefthook.yml:99`).

## What would make this wrong

- **If SQLite's error surface does not separate the classes cleanly.** The whole
  design rests on being able to tell a corrupt FTS shadow table from a corrupt
  canonical B-tree at the moment the error is raised. `rusqlite` may not carry
  enough provenance to do that without string-matching the message, and a
  policy that branches on an error *string* is a policy that changes silently
  with a SQLite version bump. If the classification cannot be made robust, the
  correct fallback is the conservative one — treat every `SQLITE_CORRUPT` as
  canonical, quarantine, and lose the graceful-degradation half — and that is a
  much smaller change that does not need this proposal.
- **If quarantine is worse than limping.** For a desktop app, a store that
  refuses to write is an app that appears broken. If the operator's realistic
  response to a quarantine banner is "delete the file and start over", then
  stopping the writes protected nothing and cost a session. The falsifier is a
  restore path good enough that quarantine is a recoverable state rather than a
  dead end — and if that restore path is not built, this should not ship.
- **If skipping the WAL checkpoint on close causes ordinary harm.** Not
  checkpointing is only free in the damaged case. If the implementation ends up
  skipping the checkpoint more broadly, it will interact with the periodic
  `PRAGMA wal_checkpoint(TRUNCATE)` at `lib.rs:272` and grow `-wal` files on
  healthy installs. The skip must be reachable *only* from the quarantine path.
- **If the base rate is genuinely zero.** No corruption incident is recorded
  anywhere in this repo's corpus. If the operator's answer is "this has never
  happened and my backups are elsewhere", then item 2 above is the only part
  worth doing — one flag in `backup.rs` so a damaged store cannot eat its own
  history — and the classification module is speculative infrastructure that
  should be closed with that reason written down.
