# tauri:db (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 5 | Missing: 0

## 1. Entire migration chain re-executes on every app launch — no version stamp
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: startup-cost
- **File**: src-tauri/src/db/migrations/mod.rs:33 (chain: initial.rs:9, incremental.rs:145, fk_hygiene.rs:16)
- **Scenario**: Every launch of the desktop app replays the full migration chain: ~200 `pragma_table_info`/`sqlite_master` probes, ~40 `ALTER TABLE ... ADD COLUMN` statements that are *expected to error* on already-migrated DBs (initial.rs:14-32, 83-90, etc.), plus several statements that are unconditional **writes** each boot: `install_persona_memory_invariants` DROP+CREATE triggers (helpers.rs:408 — sqlite_master/journal write every boot), the `lab_user_ratings` dedup `DELETE ... GROUP BY` full-table scan (initial.rs:71-79, runs even after the unique index exists), the `persona_prompt_versions` production-demotion `UPDATE` with a window-function subquery (initial.rs:290-302), 6 `dev_ideas` remap UPDATEs (helpers.rs:351), and 5 credential-key rename UPDATEs (helpers.rs:300).
- **Root cause**: There is no `PRAGMA user_version` (or migrations table) stamp; idempotency is achieved by re-probing every step individually, so cost grows linearly with every migration ever shipped — incremental.rs alone is 5,895 lines of steps.
- **Impact**: Tens-to-hundreds of ms of startup latency plus guaranteed disk writes on every boot of a local-first app, growing with each release. On a large DB the every-boot table scans (lab_user_ratings dedup, prompt-version demotion) are the dominant cost.
- **Fix sketch**: Stamp `PRAGMA user_version = N` after a successful chain run and early-return from `migrations::run`/`run_incremental` when the stored version matches the current constant. Bump N whenever a new step is appended. The existing per-step guards stay as the safety net for the one boot that actually migrates. At minimum, guard the always-run write statements (`install_persona_memory_invariants`, lab_user_ratings dedup, prompt-version demotion) behind `has_index`/trigger-exists checks.

## 2. `classify_field_type` is triplicated — divergence changes what gets stored as a secret
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/migrations/helpers.rs:434 (copies: src-tauri/src/db/repos/resources/credentials.rs:1413, src-tauri/src/commands/core/data_portability.rs:2749 as `classify_credential_field_type`)
- **Scenario**: A developer extends the classifier in one copy (e.g. adds `"bearer"` → secret in credentials.rs) — the migration path (helpers.rs) and the import path (data_portability.rs) keep the old rules, so the same field key is classified `secret` on one write path and `text` on another.
- **Root cause**: Three byte-identical private copies of the same heuristic; data_portability.rs even documents it as "Mirrors the private `classify_field_type` in cred_repo". The camelCase→snake_case rename map is likewise duplicated between `helpers::normalize_credential_field_keys` (helpers.rs:292) and `credentials.rs::normalize_field_key` (credentials.rs:1401).
- **Impact**: This isn't cosmetic: credentials.rs:107 uses `classify_field_type(key) == "secret"` to decide whether a field value is encrypted or stored plaintext. Drift between copies silently changes the encryption decision depending on which code path wrote the row.
- **Fix sketch**: Promote one `pub(crate) fn classify_field_type` (and the rename map) into a shared module, e.g. `db::credential_fields` or `engine::crypto` adjacent, and delete the two mirrors. The `NON_SENSITIVE_KEYS` allowlist in helpers.rs:40 should move with it since credentials.rs references the same concept.

## 3. ~50 hand-rolled `pragma_table_info` probes duplicate the `has_column` helper in the same file
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/migrations/incremental.rs:230 (pattern repeats ~50×, e.g. 246, 293, 364, 378, 396, 414, 430, 447, 462, 479, 496, 511 ...)
- **Scenario**: Adding or reviewing a migration means wading through two competing idioms: the `IncrementalMigration`/`run_step` abstraction with `has_column`/`has_table` (used ~80×) versus a 7-line inline `conn.prepare("SELECT COUNT(*) FROM pragma_table_info('X') WHERE name = 'y'")...unwrap_or(false)` block copy-pasted ~50 more times.
- **Root cause**: Later migrations were appended by copy-pasting the nearest neighbor instead of calling the existing `has_column(conn, table, col)` (incremental.rs:40).
- **Impact**: ~350 lines of pure boilerplate in an already 5,895-line file. Worse, the inline copies end in `.unwrap_or(false)` — a real DB error is swallowed and treated as "column missing", causing the migration to re-apply (and possibly fail differently) instead of surfacing the error, whereas `has_column` correctly propagates `Err`.
- **Fix sketch**: Mechanical sweep: replace every inline probe with `has_column(...)?` / `has_table(...)?`, deleting the `.map(|c| c > 0).unwrap_or(false)` error-swallowing. Optionally fold each into `run_step` so every migration gets the standard applied-log line for free.

## 4. incremental.rs has regrown past the size the module split was meant to fix
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/db/migrations/incremental.rs:145
- **Scenario**: mod.rs's header comment explains the split existed because "the monolithic migrations.rs (4,187 LOC) was a merge-conflict magnet". `run_incremental` is now a single 5,895-line function-body module — larger than the file the split retired — and every new feature appends to the same function, recreating the conflict magnet.
- **Root cause**: All post-initial migrations land in one linear `run_incremental` body; there is no per-domain grouping (lab, research, scraper, credentials, A2A gateway, etc. are interleaved).
- **Impact**: Maintenance hazard only (no runtime cost beyond finding #1): parallel branches adding migrations conflict at the tail; reviewing a migration requires navigating a 5.7k-line function.
- **Fix sketch**: Split `run_incremental` into per-domain `pub(super)` submodules (`incremental/lab.rs`, `incremental/credentials.rs`, `incremental/research.rs`, ...) each exposing a `run(conn)`, with `run_incremental` reduced to an ordered call list — the same medicine mod.rs already applied once. Keep ordering explicit since some steps depend on earlier ones.

## 5. `clear_legacy_credential_blobs` re-prepares a statement per field key per credential
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/db/migrations/helpers.rs:221
- **Scenario**: For each candidate credential, the completeness check loops over every key in the blob and calls `conn.prepare(...)` + `query_row` per key — an N×M prepare/query pattern (statement compiled fresh each iteration).
- **Root cause**: The `COUNT(*)` probe is prepared inside the inner loop instead of once outside, and the per-key check could be a single set-difference query.
- **Impact**: Bounded: candidates shrink to zero once blobs are cleared, so steady-state cost is one empty SELECT per boot. Only the first post-upgrade boot with many credentials pays.
- **Fix sketch**: Hoist `let mut stmt = conn.prepare(...)` above both loops and reuse it; or replace the loop with one query per credential: `SELECT COUNT(DISTINCT field_key) FROM credential_fields WHERE credential_id = ?1 AND field_key IN (...)` compared against `expected.len()`.
