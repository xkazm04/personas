> Context: tauri:db (misc)
> Total: 7
> Critical: 0  High: 1  Medium: 4  Low: 2

## 1. persona_triggers chain-migration rebuild drops the table with FK enforcement ON — nulls every execution's trigger_id
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/db/migrations/incremental.rs:309-337 (the `needs_chain_migration` block)
- **Scenario**: On any legacy DB whose stored `persona_triggers` DDL lacks `'chain'`, `run_incremental` rebuilds the table via `ddl_step(...)` → `CREATE persona_triggers_new; INSERT SELECT; DROP TABLE persona_triggers; RENAME`. `ddl_step` opens a plain `unchecked_transaction` with the connection's default `PRAGMA foreign_keys = ON` (set by `SqlitePragmaCustomizer::on_acquire`, mod.rs:138). `persona_executions.trigger_id` is `REFERENCES persona_triggers(id) ON DELETE SET NULL` (schema.rs:106). SQLite's `DROP TABLE` performs an implicit DELETE of all rows first, which *does* fire foreign-key actions — so every execution's `trigger_id` is silently SET NULL, even though the trigger rows themselves are preserved in `_new`.
- **Root cause**: Unlike `rebuild_executions_table_with_incomplete_status` (incremental.rs:86-87), which explicitly wraps the rebuild in `FkDisabledGuard` for exactly this reason and documents the hazard, the trigger rebuild (and the sibling n8n rebuild at :252-290) has no `FkDisabledGuard`. The known hazard was not applied to this rebuild path.
- **Impact**: data loss of execution→trigger linkage on the one-time chain migration; audit/history views lose which trigger produced each execution.
- **Fix sketch**: Wrap the trigger rebuild body in `let _g = crate::db::FkDisabledGuard::new(conn)?;` created in autocommit *before* `ddl_step`, mirroring the executions rebuild. (n8n has no inbound FK so it is only latent, but guard it too for consistency.)

## 2. Credential blobs with non-string field values are skipped forever and never cleared
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/migrations/helpers.rs:80-90 and 213-216
- **Scenario**: Both `migrate_blob_credentials_to_fields` and `clear_legacy_credential_blobs` deserialize the decrypted blob as `HashMap<String, String>`. If a legacy blob encodes any non-string JSON value — a numeric `port` (5432), a boolean `oauth_client_mode`, or a nested object — `serde_json::from_str::<HashMap<String,String>>` returns Err. The credential is logged at `warn!` and `continue`d: no field rows are created, and its blob is never emptied. On every subsequent startup it re-fails identically, so the credential is permanently stuck in blob form.
- **Root cause**: The migration assumes every credential field serialized as a JSON string; the codebase's own `NON_SENSITIVE_KEYS` list includes `port`, which is conventionally numeric, contradicting that assumption.
- **Impact**: dual-source-of-truth persists indefinitely for those credentials; the "blob is gone" invariant the ADR promises is never reached for them (and `assert_credential_blob_invariant` won't flag them because they have no `credential_fields` rows).
- **Fix sketch**: Deserialize into `HashMap<String, serde_json::Value>` and stringify each value (numbers/bools → their string form), or fall back to `to_string()` on non-string values instead of aborting the whole credential.

## 3. FK-hygiene rebuild adds a UNIQUE index without de-duplicating existing rows — can abort startup
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/db/migrations/fk_hygiene.rs:335 (and the `recreate_with_fk` copy path :129-131)
- **Scenario**: `migrate_persona_healing_issues` recreates the table and then runs `CREATE UNIQUE INDEX ... idx_phi_persona_execution ON persona_healing_issues(persona_id, execution_id) WHERE execution_id IS NOT NULL`. The `cleanup_orphans_sql` only deletes rows whose `persona_id` is missing from `personas`; it does not de-duplicate `(persona_id, execution_id)` pairs. The original table never had this unique constraint, so a legacy DB can hold duplicate healing issues for the same `(persona, execution)`. The `CREATE UNIQUE INDEX` then fails, the transaction rolls back, and `run` propagates the Err — aborting startup.
- **Root cause**: A uniqueness invariant is introduced during the rebuild but pre-existing violating data is not reconciled first (contrast initial.rs:290-306, which de-dupes prompt versions before creating its unique index).
- **Impact**: hard startup failure for users with legacy duplicate healing-issue rows.
- **Fix sketch**: Before the index creation, add a cleanup statement keeping one row per `(persona_id, execution_id)` (e.g. `DELETE ... WHERE rowid NOT IN (SELECT MAX(rowid) ... GROUP BY persona_id, execution_id)` with the `execution_id IS NOT NULL` predicate).

## 4. incremental.rs is a 5,739-line module
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: oversized-module
- **File**: src-tauri/src/db/migrations/incremental.rs:1-5739
- **Scenario**: `run_incremental` is a single ~3,600-line function of sequential `run_step`/`ddl_step` blocks plus several ad-hoc `if !has_column` inline migrations, followed by helper migrations (`ensure_composite_fires_table`, `backfill_lab_tool_calls`, `research_lab_align_columns`, `drop_legacy_tool_calls_columns`). The file exceeds the 256KB read limit. Verified oversized by `wc -l`.
- **Root cause**: Every incremental migration since the schema consolidation was appended in place with no sub-moduling.
- **Impact**: maintainability — hard to review, easy to append a migration in the wrong order (see the FK-guard omission in finding #1), and tooling can't load the whole file.
- **Fix sketch**: Split into per-era or per-domain submodules (e.g. `incremental/executions.rs`, `incremental/lab.rs`, `incremental/research.rs`) each exposing a `fn steps() -> Vec<IncrementalMigration>`, and have `run_incremental` iterate a concatenated list. The existing `IncrementalMigration` struct already supports this.

## 5. executions_fts virtual table + 3 sync triggers DDL duplicated verbatim between schema.rs and incremental.rs
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/db/migrations/schema.rs:134-154 and src-tauri/src/db/migrations/incremental.rs:155-175
- **Scenario**: The `CREATE VIRTUAL TABLE executions_fts USING fts5(...)` plus the `executions_fts_ai/ad/au` trigger bodies appear identically in the base SCHEMA and in the `executions_fts` incremental step. A third near-identical copy of the trigger column list exists in the rebuild (`INSERT INTO executions_fts(executions_fts) VALUES('rebuild')` path relies on the triggers matching). Verified by reading both blocks.
- **Root cause**: The FTS DDL was copied into the incremental migration for legacy DBs rather than referenced from one constant.
- **Impact**: maintainability — a change to the FTS columns (e.g. adding a searchable field) must be edited in two places or the two code paths silently diverge.
- **Fix sketch**: Hoist the FTS DDL into a single `pub(super) const EXECUTIONS_FTS_DDL: &str` and reference it from both SCHEMA assembly and the incremental step.

## 6. Three independent copies of the create-insert-drop-rename table-rebuild pattern
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: fk_hygiene.rs:56-154 (`recreate_with_fk`), incremental.rs:86-141 (`rebuild_executions_table_with_incomplete_status`), incremental.rs:252-290 (n8n rebuild) and :323-337 (triggers rebuild)
- **Scenario**: Four sites hand-roll the same SQLite "safe rebuild" (staging table, copy, drop, rename, replay indexes). Only `recreate_with_fk` and the executions rebuild disable FKs; the n8n/trigger inline rebuilds do not — which is precisely how finding #1 slipped in.
- **Root cause**: No shared rebuild helper; each migration reimplemented the sequence.
- **Impact**: maintainability + latent correctness (the FK-guard step is easy to forget, as it was).
- **Fix sketch**: Extract a `rebuild_table(conn, table, new_ddl, columns_csv, aux_sqls, disable_fks: true)` helper and route all four callers through it so the FK-off step is structural, not per-call discipline.

## 7. Dead marker comment left after migration relocation
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/db/migrations/initial.rs:267
- **Scenario**: `// thread_id migration moved to pre-schema block (top of run())` is a leftover breadcrumb; the actual ALTER now lives at initial.rs:14. The comment marks an empty location and adds no value.
- **Root cause**: Relocation of the `thread_id` ALTER to the pre-schema block left the old marker behind.
- **Impact**: maintainability — minor noise; a reader may hunt for code that isn't there.
- **Fix sketch**: Delete the line.
