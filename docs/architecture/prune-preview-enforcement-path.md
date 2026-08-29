# Storage prune: preview through the enforcement path

**Status:** implemented 2026-08-30 · **Register:** deferred-fixes #31 ·
**Registry:** `software-engineering/entity-lifecycle/blast-radius-computation`
(2026-08-29 amendment: *"sharing the predicate is still not sharing the
effect"*).

## Current state

`src-tauri/src/commands/infrastructure/system/storage.rs` is the repo's
best-engineered preview and still understates by **3.29×** (measured
2026-08-17: "Remove 2,188 finished runs" actually touched 2,188 + 5,015
cascade rows in 4 tables + 4,376 FTS rows + 944 nulled):

- `prune_storage` (:108) builds one `where_clause` string that feeds both the
  `COUNT` (:122) and the `DELETE` (:131) — the preview shares the *predicate*,
  but a count on `persona_executions` cannot see the `ON DELETE CASCADE`
  children (`schema.rs:222,303`, `e03_p2p_and_telemetry.rs:194,215`,
  `e05_twin_and_memory_review.rs:336`), the FTS delete trigger
  (`schema.rs:151`), or the `SET NULL` columns (`schema.rs:1091`,
  `c02_dev_goals_and_kpis.rs:133`).
- The command's dry-run mode (**dry-run by default**, fabro F5 contract) has
  **zero callers**: `StorageUsageSection.tsx:38` calls
  `pruneStorage(undefined, false)` directly, and the preview shown before the
  confirm is `storage_usage`'s bare prunable count (:75-86) — a different
  query, not the delete's path at all.
- Both count probes swallow errors into `0` via `.unwrap_or(0)` — on a safety
  surface, a failed probe rendering as "nothing to remove" (the
  failure-not-empty-success violation wave 1 fixed elsewhere).

## Target shape

Per the amended technique, the only preview that cannot drift where declared
cascades exist is one produced **through the enforcement path**: run the
destruction in a counting mode — execute the real `DELETE` inside a
transaction with foreign keys ON, tally casualties per table by diffing row
counts, then **ROLL BACK** for the preview and **COMMIT** for the act. One
function body; the mode decides only the final verb, so preview and act cannot
diverge by construction.

- `prune_storage(dry_run = true)` becomes that counting mode; `dry_run =
  false` is the identical body committed. `PruneResult` grows a per-table
  casualty accounting (`casualties: Vec<TableImpact>`, `totalRows`) — the same
  struct is the **receipt** when committed (the user consented to a stated
  impact; the receipt reports whether that is what happened).
- Casualty tally: snapshot `COUNT(*)` for every enumerable table (including
  the `executions_fts` index; excluding FTS shadow internals whose row counts
  are storage blocks, not user rows), execute, re-count, keep the shrunken
  tables. Count probes **propagate errors** instead of `unwrap_or(0)`.
- `StorageUsageSection.tsx` wires the zero-caller dry-run into the confirm
  flow: opening the confirm calls `pruneStorage(undefined, true)` and the
  dialog names the cascade — total rows and the largest casualty tables — per
  the technique's "casualties are named by type and counted". The act then
  reports the receipt through the same copy.

## Out of scope

- Counting the `SET NULL` survivors (they are survivors, not casualties; the
  copy says "cascade included" without claiming to enumerate nulled columns).
- The other four preview doors in register #31 (persona delete, memories
  delete-all, skills install, credentials export).
- A preview state token binding preview to act (`apply_bundle_import` has the
  repo's only one; generalizing it is its own item).

## Acceptance checks

- Unit tests witness: dry-run deletes nothing (counts unchanged after the
  call) yet reports the same casualty set a real run then removes; the real
  run's receipt matches the dry-run's prediction on an unchanged DB; cascade
  children (`execution_deliverables`-class rows) appear in the casualty list —
  the exact 3.29× class the shared-predicate count missed.
- `cargo check -p app` clean; scoped `cargo test -p app storage` if the test
  binary runs on this machine (known issue: it may not start — report
  honestly).
- Census ratchet does not rise; i18n locales stay complete (new confirm copy
  translated in all 14).
