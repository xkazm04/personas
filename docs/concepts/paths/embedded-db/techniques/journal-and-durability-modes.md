---
layer: technique
subject: embedded-db
technique: journal-and-durability-modes
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Journal and durability modes

An embedded engine's journal mode and synchronization level together form a
contract with three clauses: what survives a crash, how readers and writers
interfere, and which files on disk constitute the database. The engine's
default answers all three — which means an application that never chose has
still signed, just without reading. The technique is to choose explicitly,
write the choice down with its reasons, assert it at boot, and propagate the
file-set clause to every code path that touches the database's files.

## The two journaling families

Embedded engines converge on two shapes:

- **Rollback journaling**: before changing a page, the old page is copied to
  a sidecar; commit deletes the sidecar. Writers exclude readers during
  commit. The store is "one file, plus a transient sidecar that means a
  transaction is in flight or crashed."
- **Write-ahead journaling**: changes are appended to a journal sidecar; the
  main file is updated later by a **checkpoint** that folds journal frames
  back in. Readers see a consistent snapshot while a writer appends — the
  property interactive applications choose it for, because the UI keeps
  reading while background work writes.

Write-ahead journaling is the usual right answer for a user-facing app, but
its costs are structural, not incidental: the journal sidecar (and its
index companion, typically memory-mapped) is now a **permanent resident**,
not a transient; recent commits live *only* in the sidecar until a
checkpoint runs; long-lived read snapshots pin the journal and block
checkpoints from truncating it, so the sidecar's growth is bounded only by
the discipline of readers (a leaked long-held read connection — see
[connection-pooling](connection-pooling.md) — becomes unbounded disk
growth); and checkpointing is a real maintenance obligation that belongs in
a quiet window ([quiet-window-maintenance](quiet-window-maintenance.md)),
with aggressiveness levels that trade completeness against how long they
block writers.

## Sync level: the honesty knob

Orthogonal to journaling is how often the engine forces the OS to flush to
stable storage. The full-paranoia setting survives power loss at a
per-commit latency cost; the common middle setting, paired with write-ahead
journaling, survives application and OS crashes but may lose the last few
commits on power cut — while never corrupting the store; the fast setting
trades corruption-on-power-cut for speed and has no place under user data.
The middle setting is a defensible choice for a desktop application *if
made on purpose*: "a power cut may cost the last moments of work" is a
product decision someone should have consciously made, not an engine
default nobody can defend in the postmortem.

## The file-set clause: every copy path knows the sidecars

The least-read clause causes the worst incident. Under write-ahead
journaling, a "copy" of the database that takes only the main file captures
a store **missing every commit still in the journal** — and depending on
checkpoint timing that can be hours of the user's most recent work. The
copy looks valid, opens cleanly, and is silently stale or subtly torn; the
discovery happens at restore time, when the original is already gone.

Every path that treats the database as a file must honor the set:

- **Backups** copy main file plus journal sidecars as one consistent unit,
  or — better — use the engine's own backup facility, which produces a
  single-file consistent snapshot regardless of journal state.
- **Export / support bundles / sync tools** — same rule; a user-visible
  "copy my data" affordance that grabs one file is a data-loss feature.
- **Delete / reset** paths remove the whole set; a reset that deletes the
  main file and leaves sidecars invites the engine to marry stale journal
  frames to a fresh store.

This is [gate-sees-target](../../_laws.md#gate-sees-target) in storage
form: the backup gate must see the actual durability target — the file
*set* — not the proxy that is the main file's name. The snapshot machinery
that guards schema changes (owned by
[migrations](../../migrations/migrations.md); its snapshot contract already
mandates sidecar inclusion) is one instance of this clause, not a separate
rule.

## Assert the contract at boot

Journal mode and sync level are runtime-queryable in every serious engine,
and engines **silently fall back** when a mode cannot be honored — network
filesystems and containerized or sandboxed paths are the classic triggers
for write-ahead journaling quietly not engaging. An application that sets
the mode once at first run and never re-checks is trusting a setting that
the environment can revoke without notice, and every property above
(reader/writer concurrency, sidecar semantics, backup scope) silently
changes with it. The standard: on every boot, after opening, query the
effective mode and sync level and compare against the contract; a mismatch
is at minimum a loud diagnostic, and for modes the application's
concurrency design depends on, a refusal to proceed.

## Test the contract, don't cite it

Crash-consistency claims are testable locally: kill the process
mid-transaction in a harness and assert the store recovers to the last
commit; simulate the missing-sidecar backup and assert the restore is
*detected* as inconsistent rather than silently accepted. One such test per
claimed guarantee converts the durability contract from documentation into
a regression gate — and it is precisely the test nobody writes because the
engine is "known reliable." The engine is; the application's use of it is
what the test checks.
