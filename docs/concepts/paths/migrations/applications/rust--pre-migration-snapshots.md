---
layer: application
subject: migrations
technique: pre-migration-snapshots
stack: rust
---

# Pre-migration snapshots of the primary database

The snapshot gate lives in `src-tauri/db/src/backup.rs` and is called from
`init_db` at `src-tauri/db/src/lib.rs:296` — before the connection pool
opens the file, which is the load-bearing ordering: at that moment the
process holds no handle, so a plain file copy is consistent
(`backup.rs:44-47` documents exactly this reasoning).

## What the standard's clauses look like here

- **Sidecars copied with the main file** (`backup.rs:33-37`, `:121-137`).
  `SIDECAR_EXTENSIONS = ["db-wal", "db-shm"]`; the module doc knows *why*:
  the write-ahead journal holds any not-yet-checkpointed transactions from
  the previous session. A failed sidecar copy degrades honestly — the main
  copy alone is "a valid database as of its last checkpoint" and the
  warning says the tail may be absent (`:127-136`).
- **Fresh installs skipped** (`:49-52`) — no user data to protect, and no
  `backups/` litter. Zero pending protection produces zero snapshots.
- **Rotation named at creation** (`:144`, `rotate_backups` at `:153-198`):
  keep the newest `MAX_BACKUPS = 3` sets, delete main file *plus* sidecars
  together (`:182-184`) — the reaper deletes whole sets, exactly the
  standard's torn-restore clause.
- **Naming carries ordering, defensively**: `personas-<UTC stamp>-<nn>.db`
  with the counter chosen as max+1, not first-free-slot (`:64-104`) — a
  reused low slot would make the newest backup sort oldest and be rotated
  out by its own rotation pass. UTC avoids DST-fold ordering glitches.
  Lexicographic order == chronological order is what rotation sorts by.
- **Tests exercise creation and rotation** (`src-tauri/db/src/lib.rs:2231`
  ff.): five same-second backups, sidecar siblings asserted per set,
  survivor count pinned.

## The priced deviations

The module doc (`backup.rs:12-23`) is a model of *documenting* a trade the
standard would spell differently:

1. **Every-boot snapshots, not pending-gated.** "There is no schema-version
   counter in this codebase … so there is no cheap 'will this boot actually
   change the schema?' signal. We back up on EVERY boot of an existing
   database instead." This is the ledger-less consequence the technique
   names: the rotation window ages in boots, not migration boundaries.
   With `MAX_BACKUPS = 3`, three restarts after a bad migration rotate away
   the last pre-migration copy — the restart-storm sizing concern applies
   here literally (a crash-restart storm is even called out at `:66` as the
   reason for the same-second counter).
2. **Best-effort, never blocks boot** (`:21-23`, every failure path returns
   `None` with a `tracing::warn!`): "A failed backup must never be worse
   than the risk it protects against." Defensible under the technique's
   failed-copy policy *because* the design cannot know what is pending —
   but the skipped-snapshot fact is only a log warning; it is not carried
   into any later migration-failure report, so "chain failed AND there was
   no snapshot" would be discovered, not known.
3. **No verification-open of the copy.** The one hard clause present is
   negative-space: a failed main-file copy deletes the truncated partial
   rather than leaving it "masquerading as a backup" (`:113-115`). But no
   path opens the finished copy read-only or integrity-checks it; the gate
   never looks at recoverability itself.
4. **The restore path is prose, not code.** The module doc (`:8-10`) says a
   botched boot "can always be recovered by copying the newest backup back
   over personas.db" — correct mechanics, but there is no in-product or
   test-exercised restore; it will be executed for the first time by a
   support case. The snapshot name carries a timestamp but no schema
   version (nothing to carry — no version exists), so "which release can
   open this backup" is answerable only from the timestamp.

## The second database has no gate at all

The standard's hardest lesson here is an absence: the knowledge-base /
companion store (`personas_data.db`, schemas in
`src-tauri/db/src/lib.rs` around `:665` / `:794`) migrates via hand-appended
ALTERs with **no snapshot, no runner, no guards** — one product, two
stores, one of them outside every protection this technique describes. A
transplant reader should check their own system for exactly this: the
snapshot contract tends to cover the store everyone thinks of as "the
database" and miss its younger siblings.
