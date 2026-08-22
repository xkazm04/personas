//! Shared machinery for the incremental migration chain: the step
//! primitive, the schema probes every step guards itself with, and the
//! large one-off table rebuilds that individual steps delegate to.
//!
//! Moved verbatim out of the former `migrations/incremental.rs`. No
//! behaviour changed; only `super::helpers` / `super::fk_hygiene` paths
//! were re-anchored to `crate::migrations::...` because the module moved a
//! level deeper.

use rusqlite::{Connection, OptionalExtension};

use personas_core::error::AppError;

pub(super) struct IncrementalMigration {
    pub(super) id: &'static str,
    pub(super) description: &'static str,
    pub(super) already_applied: fn(&Connection) -> Result<bool, AppError>,
    pub(super) apply: fn(&Connection) -> Result<(), AppError>,
}

pub(super) fn run_step(conn: &Connection, migration: IncrementalMigration) -> Result<(), AppError> {
    if (migration.already_applied)(conn)? {
        return Ok(());
    }

    (migration.apply)(conn)?;
    tracing::info!(
        migration_id = migration.id,
        "Applied incremental migration: {}",
        migration.description,
    );
    Ok(())
}

/// Wrap a DDL batch in BEGIN IMMEDIATE / COMMIT so multi-statement scripts
/// (CREATE TABLE + CREATE INDEX + INSERT FROM legacy) succeed or roll back
/// as a unit. SQLite's default auto-commit applies per statement, which
/// leaves partial schema state on power-loss or panic mid-batch.
///
/// Idempotency stays the layer above (has_column/has_table guards). This
/// only fixes atomicity within a single migration step.
pub(super) fn ddl_step(conn: &Connection, sql: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1",
        table.replace('\'', "''"),
    ))?;
    let count = stmt.query_row([column], |row| row.get::<_, i64>(0))?;
    Ok(count > 0)
}

pub(super) fn has_table(conn: &Connection, table: &str) -> Result<bool, AppError> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

/// Report — rather than discard — a `DROP COLUMN group_id` that SQLite refused.
///
/// The call sites are already `has_column`-guarded, so "no such column" cannot
/// happen and every error reaching here is real. On `persona_memories` and
/// `dev_projects` the column is dead weight (no Rust field reads or writes it),
/// so a failure is not worth aborting a launch over — but it must not be
/// invisible either, which is what `let _ = ddl_step(…)` made it.
pub(super) fn report_failed_group_id_drop(table: &str, result: Result<(), AppError>) {
    if let Err(e) = result {
        tracing::error!(
            table = %table,
            error = %e,
            "retire_persona_groups: DROP COLUMN group_id failed — the dead column stays \
             (an index, trigger or view most likely still names it)",
        );
    }
}

pub(super) fn has_index(conn: &Connection, index: &str) -> Result<bool, AppError> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        [index],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

/// Rebuild `persona_executions` to widen the status CHECK constraint with
/// `'incomplete'`. The `ExecutionState` enum has a valid `Incomplete`
/// terminal state (`Running -> Incomplete`) but the original table CHECK
/// omitted it, so any execution that ended `Incomplete` failed to persist
/// with `CHECK constraint failed: status IN (...)` and was force-written
/// as `failed` with a misleading error. SQLite cannot `ALTER` a CHECK
/// constraint, so the table is rebuilt.
///
/// Follows SQLite's documented safe-rebuild procedure:
///   - foreign_keys OFF — six tables `CASCADE`-reference `persona_executions`;
///     a plain `DROP TABLE` with FK enforcement on would empty those child
///     tables via the implicit delete.
///   - recreate the table from its OWN stored DDL with only the CHECK
///     widened, so the column set/order is byte-identical and `SELECT *`
///     copies cleanly regardless of how many `ALTER ... ADD COLUMN`
///     migrations ran before this point.
///   - replay the index + trigger DDL captured from `sqlite_master`.
///   - rebuild the `executions_fts` external-content index (the bulk
///     `INSERT ... SELECT` does not fire the FTS sync triggers).
pub(super) fn rebuild_executions_table_with_incomplete_status(
    conn: &Connection,
) -> Result<(), AppError> {
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let create_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_executions'",
        [],
        |r| r.get(0),
    )?;

    // Index + trigger DDL to replay after the rename. Auto-indexes (PK)
    // have a NULL `sql` and are skipped — they are recreated implicitly.
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE tbl_name='persona_executions'
               AND type IN ('index','trigger')
               AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    // `'cancelled'` occurs exactly once in the executions DDL — the status
    // CHECK list. Insert `'incomplete'` immediately before it.
    let widened = create_sql.replacen("'cancelled'", "'incomplete', 'cancelled'", 1);
    if widened == create_sql {
        // CHECK clause not in the expected shape — bail rather than build a
        // table that silently keeps the old constraint.
        return Err(AppError::Database(rusqlite::Error::InvalidQuery));
    }
    // Re-point the CREATE at the staging name. `persona_executions` appears
    // once (the table name); the FK clauses reference `personas` and
    // `persona_triggers`, neither of which contains this token.
    let staged = widened.replacen("persona_executions", "persona_executions_new", 1);

    let fts_present = has_table(conn, "executions_fts")?;

    let mut batch = String::new();
    batch.push_str("DROP TABLE IF EXISTS persona_executions_new;\n");
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str("INSERT INTO persona_executions_new SELECT * FROM persona_executions;\n");
    batch.push_str("DROP TABLE persona_executions;\n");
    batch.push_str("ALTER TABLE persona_executions_new RENAME TO persona_executions;\n");
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }
    if fts_present {
        batch.push_str("INSERT INTO executions_fts(executions_fts) VALUES('rebuild');\n");
    }

    ddl_step(conn, &batch)?;
    Ok(())
}

/// Count foreign keys on `table` whose parent table does not exist.
///
/// SQLite resolves FK targets lazily: `REFERENCES nonexistent(id)` succeeds at
/// `CREATE TABLE` and only raises `no such table: main.nonexistent` on the first
/// `INSERT` under `foreign_keys = ON`. `PRAGMA foreign_key_check` is blind to it
/// on an EMPTY child table — which a table whose every insert fails always is —
/// so this is the probe that actually sees the defect.
pub(super) fn dangling_fk_count(conn: &Connection, table: &str) -> Result<i64, AppError> {
    let count = conn
        .prepare(&format!(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('{}') fk
              WHERE fk.\"table\" NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')",
            table.replace('\'', "''"),
        ))?
        .query_row([], |r| r.get(0))?;
    Ok(count)
}

/// Repoint `mcp_gateway_members`' two foreign keys at the real credentials
/// table. They shipped as `REFERENCES credentials(id)`; the table is
/// `persona_credentials`, so every `add_member` INSERT raised `no such table:
/// main.credentials` and the whole gateway-membership feature has never once
/// worked. SQLite cannot alter a foreign key in place, so the table is rebuilt.
///
/// Follows the `rebuild_executions_table_with_incomplete_status` shape:
///   - `foreign_keys` OFF in AUTOCOMMIT, before the transaction opens — the
///     pragma is a documented no-op while a transaction is active.
///   - recreate from the table's OWN stored DDL with only the FK target
///     rewritten, so the column set/order is byte-identical to whatever the
///     live table has and `SELECT *` copies cleanly regardless of any later
///     `ALTER … ADD COLUMN`.
///   - replay the index/trigger DDL `DROP TABLE` takes with it.
///   - assert the row count survives, INSIDE the transaction, so a short copy
///     rolls back instead of committing data loss. (The table is empty on every
///     install today — because nothing could ever insert into it — but a
///     rebuild that assumes emptiness is a rebuild that eats rows the day the
///     assumption stops holding.)
pub(super) fn repoint_mcp_gateway_members_fk(conn: &Connection) -> Result<(), AppError> {
    let create_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='mcp_gateway_members'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let Some(create_sql) = create_sql else {
        return Ok(());
    };

    let fixed = create_sql.replace(
        "REFERENCES credentials(id)",
        "REFERENCES persona_credentials(id)",
    );
    if fixed == create_sql {
        // The stored DDL is not the shape this migration knows how to rewrite
        // (a hand-edited database, or a future shape). Log rather than abort:
        // the residue is EXACTLY the state every install is in today, so
        // continuing is not a regression, while a boot abort would strand the
        // user with an app that will not start and no in-product restore path.
        tracing::error!(
            table = "mcp_gateway_members",
            "repoint_mcp_gateway_members_fk: stored DDL has an unexpected shape; the \
             dangling foreign key stays and gateway membership remains broken",
        );
        return Ok(());
    }

    // `mcp_gateway_members` first appears as the table name in
    // `CREATE TABLE IF NOT EXISTS mcp_gateway_members`; no column name contains
    // the token, so the first replacement is the one we want.
    let staged = fixed.replacen("mcp_gateway_members", "mcp_gateway_members_new", 1);

    // Index/trigger DDL to replay after the rename. Auto-indexes (PK / UNIQUE)
    // carry a NULL `sql` and are recreated implicitly from the new shape.
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
              WHERE tbl_name='mcp_gateway_members'
                AND type IN ('index','trigger')
                AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let mut batch = String::new();
    batch.push_str("DROP TABLE IF EXISTS mcp_gateway_members_new;\n");
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str("INSERT INTO mcp_gateway_members_new SELECT * FROM mcp_gateway_members;\n");
    batch.push_str("DROP TABLE mcp_gateway_members;\n");
    batch.push_str("ALTER TABLE mcp_gateway_members_new RENAME TO mcp_gateway_members;\n");
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }

    let tx = conn.unchecked_transaction()?;
    let before: i64 = tx.query_row("SELECT COUNT(*) FROM mcp_gateway_members", [], |r| r.get(0))?;
    tx.execute_batch(&batch)?;
    let after: i64 = tx.query_row("SELECT COUNT(*) FROM mcp_gateway_members", [], |r| r.get(0))?;
    if after != before {
        // `tx` drops un-committed here, rolling the whole rebuild back.
        tracing::error!(
            before,
            after,
            "repoint_mcp_gateway_members_fk: row count changed during rebuild; rolling back",
        );
        return Err(AppError::Database(rusqlite::Error::InvalidQuery));
    }
    tx.commit()?;
    Ok(())
}

/// Drop the legacy `tool_calls_expected/actual` JSON columns from the 5 lab
/// result tables and `persona_test_results` now that `lab_tool_calls` is the
/// canonical source. Idempotent: each `ALTER TABLE ... DROP COLUMN` is wrapped
/// in `let _ =` so the duplicate-no-such-column error on re-run is the
/// success path. SQLite 3.35+ supports DROP COLUMN natively (rusqlite 0.38
/// bundles a newer version), so no table-recreate-and-rename is needed.
///
/// Tables that don't exist yet on a fresh DB are no-ops: the ALTER will fail
/// silently and the swallowed error is the only signal — but the table will
/// be created with the new (column-less) shape by initial.rs / incremental
/// migrations, so the end state is correct either way.
///
/// ADR: 2026-05-02-lab-tool-calls-child-table.
pub(super) fn drop_legacy_tool_calls_columns(conn: &Connection) {
    let drops: &[&str] = &[
        "ALTER TABLE lab_arena_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE lab_arena_results DROP COLUMN tool_calls_actual",
        "ALTER TABLE lab_ab_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE lab_ab_results DROP COLUMN tool_calls_actual",
        "ALTER TABLE lab_matrix_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE lab_matrix_results DROP COLUMN tool_calls_actual",
        "ALTER TABLE lab_consensus_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE lab_consensus_results DROP COLUMN tool_calls_actual",
        "ALTER TABLE lab_eval_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE lab_eval_results DROP COLUMN tool_calls_actual",
        "ALTER TABLE persona_test_results DROP COLUMN tool_calls_expected",
        "ALTER TABLE persona_test_results DROP COLUMN tool_calls_actual",
    ];
    for sql in drops {
        let _ = ddl_step(conn, sql);
    }
}

/// Backfill `lab_tool_calls` from the legacy JSON-array columns on the 5 lab
/// result tables + `persona_test_results`. Idempotent in two layers: a fast
/// state-check skips the walk entirely once `lab_tool_calls` is non-empty, and
/// per-row `INSERT OR IGNORE` against `UNIQUE(result_id, variant, sequence)`
/// makes the inner loop safe to re-run if the state-check is bypassed (e.g. a
/// DB whose JSON columns gained new rows after the first migration pass — that
/// path lands once dual-write ships in step 3).
///
/// JSON parse failures on individual rows are logged and skipped rather than
/// aborting the whole migration; bad JSON in legacy data should not block a
/// fresh deploy.
pub(super) fn backfill_lab_tool_calls(conn: &Connection) -> Result<(), AppError> {
    let already_backfilled: i64 = conn
        .prepare("SELECT COUNT(*) FROM lab_tool_calls")?
        .query_row([], |row| row.get(0))?;
    if already_backfilled > 0 {
        return Ok(());
    }

    // (parent_table, result_kind discriminator)
    let sources: &[(&str, &str)] = &[
        ("lab_arena_results", "arena"),
        ("lab_ab_results", "ab"),
        ("lab_matrix_results", "matrix"),
        ("lab_consensus_results", "consensus"),
        ("lab_eval_results", "eval"),
        ("persona_test_results", "test_run"),
    ];

    let mut total_inserted: usize = 0;
    for (table, kind) in sources {
        // Skip tables that don't exist yet on this DB (eval ships via
        // incremental migration; consensus too).
        let table_exists: i64 = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1")?
            .query_row([table], |row| row.get(0))?;
        if table_exists == 0 {
            continue;
        }

        // Skip tables whose legacy columns were already dropped on a
        // prior run. This happens when the first backfill found zero
        // legacy rows (so `lab_tool_calls` stayed empty), then the
        // drop_legacy_tool_calls_columns step removed the columns. On
        // every subsequent startup the empty-`lab_tool_calls` guard
        // above doesn't fire, and the SELECT below would otherwise
        // panic with "no such column: tool_calls_expected".
        let column_exists: i64 = conn
            .prepare(&format!(
                "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name='tool_calls_expected'"
            ))?
            .query_row([], |row| row.get(0))?;
        if column_exists == 0 {
            continue;
        }

        let sql = format!(
            "SELECT id, tool_calls_expected, tool_calls_actual FROM {}",
            table
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;

        for row in rows {
            let (result_id, expected, actual) = row?;
            for (variant, json_opt) in [("expected", expected), ("actual", actual)] {
                let Some(json_str) = json_opt else { continue };
                let tools: Vec<String> = match serde_json::from_str(&json_str) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(
                            table = %table,
                            result_id = %result_id,
                            variant = %variant,
                            error = %e,
                            "Skipping unparsable tool_calls JSON during lab_tool_calls backfill"
                        );
                        continue;
                    }
                };
                for (sequence, tool_name) in tools.iter().enumerate() {
                    let id = uuid::Uuid::new_v4().to_string();
                    let inserted = conn.execute(
                        "INSERT OR IGNORE INTO lab_tool_calls
                            (id, result_kind, result_id, sequence, tool_name, variant)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![id, kind, result_id, sequence as i64, tool_name, variant],
                    )?;
                    total_inserted += inserted;
                }
            }
        }
    }

    if total_inserted > 0 {
        tracing::info!(
            inserted = total_inserted,
            "Backfilled lab_tool_calls from legacy JSON-array columns"
        );
    }
    Ok(())
}

/// Bring legacy `research_*` table schemas up to the column set expected by
/// `db/repos/research_lab.rs`. SQLite has no `ADD COLUMN IF NOT EXISTS`, so we
/// skip per-column PRAGMA checks and rely on the duplicate-column error being
/// the success path. Tables that don't exist yet are created by initial.rs;
/// these ALTERs are no-ops on a fresh DB.
pub(super) fn research_lab_align_columns(conn: &Connection) {
    let stmts = [
        // research_projects
        "ALTER TABLE research_projects ADD COLUMN description TEXT",
        "ALTER TABLE research_projects ADD COLUMN domain TEXT",
        "ALTER TABLE research_projects ADD COLUMN status TEXT NOT NULL DEFAULT 'scoping'",
        "ALTER TABLE research_projects ADD COLUMN thesis TEXT",
        "ALTER TABLE research_projects ADD COLUMN scope_constraints TEXT",
        "ALTER TABLE research_projects ADD COLUMN team_id TEXT",
        "ALTER TABLE research_projects ADD COLUMN obsidian_vault_path TEXT",
        "ALTER TABLE research_projects ADD COLUMN created_at TEXT",
        "ALTER TABLE research_projects ADD COLUMN updated_at TEXT",
        // research_sources
        "ALTER TABLE research_sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'web'",
        "ALTER TABLE research_sources ADD COLUMN authors TEXT",
        "ALTER TABLE research_sources ADD COLUMN year INTEGER",
        "ALTER TABLE research_sources ADD COLUMN abstract_text TEXT",
        "ALTER TABLE research_sources ADD COLUMN doi TEXT",
        "ALTER TABLE research_sources ADD COLUMN url TEXT",
        "ALTER TABLE research_sources ADD COLUMN pdf_path TEXT",
        "ALTER TABLE research_sources ADD COLUMN citation_count INTEGER",
        "ALTER TABLE research_sources ADD COLUMN metadata TEXT",
        "ALTER TABLE research_sources ADD COLUMN relevance_score REAL",
        "ALTER TABLE research_sources ADD COLUMN knowledge_base_id TEXT",
        "ALTER TABLE research_sources ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE research_sources ADD COLUMN ingested_at TEXT",
        "ALTER TABLE research_sources ADD COLUMN created_at TEXT",
        "ALTER TABLE research_sources ADD COLUMN updated_at TEXT",
        // research_hypotheses
        "ALTER TABLE research_hypotheses ADD COLUMN rationale TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN status TEXT NOT NULL DEFAULT 'proposed'",
        "ALTER TABLE research_hypotheses ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5",
        "ALTER TABLE research_hypotheses ADD COLUMN parent_hypothesis_id TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN generated_by TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN supporting_evidence TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN counter_evidence TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN linked_experiments TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN created_at TEXT",
        "ALTER TABLE research_hypotheses ADD COLUMN updated_at TEXT",
        // research_experiments
        "ALTER TABLE research_experiments ADD COLUMN hypothesis_id TEXT",
        "ALTER TABLE research_experiments ADD COLUMN methodology TEXT",
        "ALTER TABLE research_experiments ADD COLUMN input_schema TEXT",
        "ALTER TABLE research_experiments ADD COLUMN success_criteria TEXT",
        "ALTER TABLE research_experiments ADD COLUMN status TEXT NOT NULL DEFAULT 'designed'",
        "ALTER TABLE research_experiments ADD COLUMN pipeline_id TEXT",
        "ALTER TABLE research_experiments ADD COLUMN created_at TEXT",
        "ALTER TABLE research_experiments ADD COLUMN updated_at TEXT",
        // research_experiment_runs
        "ALTER TABLE research_experiment_runs ADD COLUMN run_number INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE research_experiment_runs ADD COLUMN inputs TEXT",
        "ALTER TABLE research_experiment_runs ADD COLUMN outputs TEXT",
        "ALTER TABLE research_experiment_runs ADD COLUMN metrics TEXT",
        "ALTER TABLE research_experiment_runs ADD COLUMN passed INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE research_experiment_runs ADD COLUMN execution_id TEXT",
        "ALTER TABLE research_experiment_runs ADD COLUMN duration_ms INTEGER",
        "ALTER TABLE research_experiment_runs ADD COLUMN cost_usd REAL",
        "ALTER TABLE research_experiment_runs ADD COLUMN created_at TEXT",
        // research_findings
        "ALTER TABLE research_findings ADD COLUMN description TEXT",
        "ALTER TABLE research_findings ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5",
        "ALTER TABLE research_findings ADD COLUMN category TEXT",
        "ALTER TABLE research_findings ADD COLUMN source_experiment_ids TEXT",
        "ALTER TABLE research_findings ADD COLUMN source_ids TEXT",
        "ALTER TABLE research_findings ADD COLUMN hypothesis_ids TEXT",
        "ALTER TABLE research_findings ADD COLUMN generated_by TEXT",
        "ALTER TABLE research_findings ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'",
        "ALTER TABLE research_findings ADD COLUMN created_at TEXT",
        "ALTER TABLE research_findings ADD COLUMN updated_at TEXT",
        // research_reports
        "ALTER TABLE research_reports ADD COLUMN report_type TEXT",
        "ALTER TABLE research_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'outline'",
        "ALTER TABLE research_reports ADD COLUMN template TEXT",
        "ALTER TABLE research_reports ADD COLUMN format TEXT",
        "ALTER TABLE research_reports ADD COLUMN review_id TEXT",
        "ALTER TABLE research_reports ADD COLUMN created_at TEXT",
        "ALTER TABLE research_reports ADD COLUMN updated_at TEXT",
    ];
    for sql in stmts {
        let _ = ddl_step(conn, sql);
    }

    // Backfill any NULL timestamps left by an ADD COLUMN on a legacy DB.
    // (SQLite forbids non-constant DEFAULTs on ADD COLUMN, so the ALTER
    // statements above intentionally omit the `DEFAULT (datetime('now'))`
    // clause — without this backfill, existing rows would carry NULL and the
    // repo's `row.get::<_, String>` would fail on read.) Targets `IS NULL` so
    // rows already populated by the table-level default are untouched.
    let backfills = [
        "UPDATE research_projects SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
        "UPDATE research_sources SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
        "UPDATE research_hypotheses SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
        "UPDATE research_experiments SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
        "UPDATE research_experiment_runs SET created_at = COALESCE(created_at, datetime('now')) WHERE created_at IS NULL",
        "UPDATE research_findings SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
        "UPDATE research_reports SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL OR updated_at IS NULL",
    ];
    for sql in backfills {
        let _ = ddl_step(conn, sql);
    }

    // Team channel (C1 — multi-author orchestration channel). The authoritative
    // store for messages from all four author kinds (user / athena / director /
    // persona). Design B's directives previously lived in `team_memories`
    // (category='directive'); they are dual-read by `list_team_channel` during
    // the transition, while new posts land here. See
    // docs/architecture/team-channel-orchestration.md.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_channel_messages (
            id            TEXT PRIMARY KEY,
            team_id       TEXT NOT NULL,
            author_kind   TEXT NOT NULL,
            author_id     TEXT,
            body          TEXT NOT NULL,
            addressed_to  TEXT,
            reply_to      TEXT,
            assignment_id TEXT,
            consumer      TEXT NOT NULL DEFAULT 'inject',
            deliveries    TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_team_channel_messages_team
            ON team_channel_messages(team_id, created_at);",
    );
    // Deliberation turns are read newest-first per deliberation on the
    // moderator/persona-turn hot path (list_for_deliberation).
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_team_channel_messages_deliberation
            ON team_channel_messages(deliberation_id, created_at);",
    );

    // Obsidian Brain — Revitalize run history. One row per finished pass
    // (completed or failed) so the panel can show "last runs: when, which
    // vault, what the cleaning achieved" after the in-memory job store's
    // 30-minute TTL evicts the live job. Counts come from the model's
    // REVITALIZE_SUMMARY line; notes/tokens before/after are measured scans.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS obsidian_revitalize_runs (
            id                TEXT PRIMARY KEY,
            vault_name        TEXT NOT NULL,
            vault_path        TEXT NOT NULL,
            status            TEXT NOT NULL,
            error             TEXT,
            files_deleted     INTEGER NOT NULL DEFAULT 0,
            files_merged      INTEGER NOT NULL DEFAULT 0,
            files_updated     INTEGER NOT NULL DEFAULT 0,
            files_reviewed    INTEGER NOT NULL DEFAULT 0,
            notes_before      INTEGER NOT NULL DEFAULT 0,
            notes_after       INTEGER NOT NULL DEFAULT 0,
            est_tokens_before INTEGER NOT NULL DEFAULT 0,
            est_tokens_after  INTEGER NOT NULL DEFAULT 0,
            duration_secs     INTEGER NOT NULL DEFAULT 0,
            started_at        TEXT NOT NULL,
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_obsidian_revitalize_runs_created
            ON obsidian_revitalize_runs(created_at DESC);",
    );

    // Durable usage-limit retries. When a run fails on a provider usage-limit
    // WINDOW (e.g. Claude's rolling ~5h cap), healing schedules a retry at the
    // parsed reset time. In-memory tokio sleeps don't survive an app restart
    // over a multi-hour horizon, so the schedule is persisted here and drained
    // by the event-bus tick (ExecutionEngine::drain_due_scheduled_retries).
    // One pending retry per failed execution; rows are deleted on dispatch.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS scheduled_retries (
            execution_id  TEXT PRIMARY KEY,
            persona_id    TEXT NOT NULL,
            retry_at      TEXT NOT NULL,
            reason        TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_scheduled_retries_due
            ON scheduled_retries(retry_at);",
    );

    // Cloud-sync watermark expression indexes. The incremental sync predicate
    // is `datetime({cursor_col}) > datetime(?)` (rows.rs::fetch) — datetime()
    // on the COLUMN tolerates the mixed timestamp formats different writers
    // use (to_rfc3339 vs datetime('now')), but is non-sargable against a plain
    // column index, so every sync pass full-scanned every synced table even
    // when nothing changed. An expression index on datetime(col) matches the
    // predicate's expression tree exactly, turning each pass into an index
    // seek while preserving the format-normalizing semantics.
    for (table, col) in [
        ("personas", "updated_at"),
        ("persona_executions", "created_at"),
        ("persona_events", "created_at"),
        ("persona_manual_reviews", "updated_at"),
        ("persona_messages", "created_at"),
        ("persona_metrics_snapshots", "created_at"),
        ("persona_tool_usage", "created_at"),
        ("persona_memories", "updated_at"),
        ("execution_knowledge", "updated_at"),
        ("persona_healing_issues", "created_at"),
        ("persona_triggers", "updated_at"),
        ("persona_tombstones", "deleted_at"),
    ] {
        let _ = ddl_step(
            conn,
            &format!(
                "CREATE INDEX IF NOT EXISTS idx_{table}_sync_watermark
                    ON {table}(datetime({col}));"
            ),
        );
    }

    // -- Project Memory Ledger (docs/plans/skill-memory-unification.md P0) ----
    // Graph-shaped project working memory: nodes anchored to dev_contexts,
    // typed edges. Canonical store for skill/terminal memory; the Obsidian
    // vault (P3) is only a projection of these tables.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_nodes (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            context_id    TEXT,
            kind          TEXT NOT NULL DEFAULT 'fact',
            title         TEXT NOT NULL,
            body          TEXT,
            source        TEXT NOT NULL DEFAULT 'app',
            status        TEXT NOT NULL DEFAULT 'active',
            content_hash  TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_memory_nodes_project
            ON memory_nodes(project_id, status, updated_at);",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_memory_nodes_context
            ON memory_nodes(project_id, context_id);",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_memory_nodes_hash
            ON memory_nodes(project_id, content_hash);",
    );
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_edges (
            from_id     TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
            to_id       TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
            rel         TEXT NOT NULL DEFAULT 'relates',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (from_id, to_id, rel)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_id);",
    );

    // -- Per-environment connector bindings ----------------------------------
    // `dev_projects` carries four SINGULAR credential pointers
    // (monitoring_/pr_/llm_tracking_/support_credential_id). That shape can't
    // express what the passport's env-split dimensions actually need: a
    // different database behind local vs test vs production, a different
    // monitoring backend per environment, and (Monitoring dimension) a
    // different connector per capability — errors vs LLM vs logs+tracing vs
    // metrics.
    //
    // A table instead of more columns, deliberately: the axis is
    // (dimension × environment) and both sides grow. Widening dev_projects
    // would have meant a new column per pair — and every widening rewrites the
    // DevProject ts-rs binding, which is exactly the churn this avoids.
    //
    // `dimension` is the passport row key ('persistence' | 'monitoring' | …)
    // optionally suffixed with a capability ('monitoring.logs'); `env` is the
    // EnvKey ('local' | 'test' | 'production'). One connector per pair.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_project_env_connectors (
            project_id     TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            dimension      TEXT NOT NULL,
            env            TEXT NOT NULL,
            credential_id  TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, dimension, env)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_dev_project_env_connectors_project
            ON dev_project_env_connectors(project_id);",
    );

    // -- Pattern × context traceability --------------------------------------
    // (docs/concepts/pattern-context-trace.md) The adoption matrix is
    // project-grain and overstates reality: one `adopted` cell renders as if
    // the whole project follows the practice. This table is the same matrix
    // one level down — a cell per (practice × context) — so the graph can show
    // the true adherence ratio. `adopted`/`violating` require cited evidence
    // (the verify lane is the only writer); mechanical seeding may only say
    // `unverified` or `na`. `context_name` is denormalized on purpose: full
    // rescans DELETE and recreate contexts under fresh ids, and the name is
    // the reconcile key that lets cells rejoin the new map (same ritual as
    // ContextLinkSnapshot).
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_practice_context_state (
            practice_id  TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            context_id   TEXT NOT NULL REFERENCES dev_contexts(id) ON DELETE CASCADE,
            context_name TEXT NOT NULL,
            state        TEXT NOT NULL CHECK(state IN ('na','unverified','adopted','violating')),
            evidence     TEXT,
            verified_at  TEXT,
            updated_at   TEXT NOT NULL,
            PRIMARY KEY (practice_id, context_id)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wpcs_project
            ON workspace_practice_context_state(project_id, practice_id);",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wpcs_practice
            ON workspace_practice_context_state(practice_id, state);",
    );

    // -- Pattern fabric F0: typed pattern edges ------------------------------
    // (docs/concepts/pattern-fabric.md S2) Connections between patterns as
    // first-class rows, with a CLOSED relation vocabulary — the same lesson
    // as topic/ftype: an open rel column fragments in one harvest.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_pattern_edges (
            from_id    TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            to_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            rel        TEXT NOT NULL CHECK (rel IN
                ('governs','composes_with','prerequisite','conflicts_with','supersedes','extends')),
            note       TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (from_id, to_id, rel)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wpe_to ON workspace_pattern_edges(to_id);",
    );
    // Backfill `governs` from the pre-existing governing_id column (principle
    // -> mechanism). Gated on the table being EMPTY, not on a marker row: the
    // backfill must run exactly once, and re-running it after a curator has
    // deleted an edge would resurrect it. governing_id itself stays live as
    // the roll-up doctrine's fast path; the edge is its graph-visible mirror.
    let _ = ddl_step(
        conn,
        "INSERT OR IGNORE INTO workspace_pattern_edges
             (from_id, to_id, rel, note, created_at)
         SELECT k.governing_id, k.id, 'governs', NULL, datetime('now')
         FROM workspace_knowledge k
         WHERE k.governing_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM workspace_knowledge g WHERE g.id = k.governing_id)
           AND NOT EXISTS (SELECT 1 FROM workspace_pattern_edges LIMIT 1);",
    );

    // -- Pattern fabric F1: playbooks (the situation layer) ------------------
    // (docs/concepts/pattern-fabric.md S3) A playbook is a curated,
    // human-gated bundle of patterns keyed by a development SITUATION
    // ("add a database table"), phased before/during/verify. It is the CLI's
    // front door into the library — 20-40 per workspace, never a tree level.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_playbooks (
            id           TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
            slug         TEXT NOT NULL,
            title        TEXT NOT NULL,
            triggers     TEXT NOT NULL,
            summary      TEXT NOT NULL,
            status       TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE (workspace_id, slug)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_playbook_patterns (
            playbook_id  TEXT NOT NULL REFERENCES workspace_playbooks(id) ON DELETE CASCADE,
            practice_id  TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            phase        TEXT NOT NULL CHECK (phase IN ('before','during','verify')),
            ordinal      INTEGER NOT NULL DEFAULT 0,
            note         TEXT,
            PRIMARY KEY (playbook_id, practice_id)
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wpp_practice
            ON workspace_playbook_patterns(practice_id);",
    );

    // -- Pattern fabric: consult telemetry -----------------------------------
    // Every `/patterns/consult` call from a CLI session, with what it matched.
    // The library's blind spot is not which playbooks exist — it is which
    // SITUATIONS sessions actually arrive with and find nothing for. An empty
    // `matched_slugs` array is the whole point of the table: it is the curation
    // backlog, written by real usage instead of guessed at in the rail. Kept as
    // an append-only log rather than a counter so an unmatched intent survives
    // verbatim; aggregation happens at read time.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_consult_log (
            id            TEXT PRIMARY KEY,
            workspace_id  TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
            project_id    TEXT,
            intent        TEXT NOT NULL,
            matched_slugs TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_workspace_consult_log_ws
            ON workspace_consult_log(workspace_id, created_at);",
    );
}

/// Widen `dev_kpi_measurements.source` with `'ai-compose'`.
///
/// SQLite cannot alter a CHECK in place, so the table is rebuilt. Unlike the
/// `dev_kpi_measurements_env_sim` rebuild above — which hand-wrote the column
/// list because it was also ADDING a column — this one recreates the table from
/// its OWN stored DDL (the `rebuild_executions_table_with_incomplete_status`
/// discipline). That matters here: a hand-written column list silently DROPS
/// any column a later migration added, and this step runs at the end of the
/// chain where the shape is no longer knowable from this file alone.
pub(super) fn widen_kpi_measurement_source_with_ai_compose(
    conn: &Connection,
) -> Result<(), AppError> {
    // `dev_kpis` is the parent of this table's only FK, and nothing references
    // it back — but a `DROP TABLE` with foreign_keys=ON still runs an implicit
    // delete, so the swap follows the same guarded procedure as every other
    // rebuild in this file.
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let create_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_kpi_measurements'",
        [],
        |r| r.get(0),
    )?;

    // `'simulation'` is the last entry of the source CHECK list and appears
    // exactly once in the DDL. If it doesn't, the table is not the shape this
    // step was written against — bail rather than build a table that silently
    // keeps the old constraint (or, worse, mangles a different clause).
    if create_sql.matches("'simulation'").count() != 1 {
        return Err(AppError::Validation(
            "dev_kpi_measurements source CHECK is not in the expected shape — refusing to rebuild"
                .into(),
        ));
    }
    let widened = create_sql.replacen("'simulation'", "'simulation','ai-compose'", 1);
    // Re-point the CREATE at a staging name. The token `dev_kpi_measurements`
    // occurs once (the table name); the FK clause references `dev_kpis`, which
    // does not contain it. A prior rename leaves the name quoted, which stays
    // valid SQL after the substitution.
    let staged = widened.replacen(
        "dev_kpi_measurements",
        "dev_kpi_measurements_ai_compose_new",
        1,
    );

    // Index/trigger DDL to replay after the rename — dropping the table drops
    // them with it. Auto-indexes have a NULL `sql` and are recreated implicitly.
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE tbl_name='dev_kpi_measurements'
               AND type IN ('index','trigger')
               AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let mut batch = String::new();
    batch.push_str("DROP TABLE IF EXISTS dev_kpi_measurements_ai_compose_new;\n");
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str(
        "INSERT INTO dev_kpi_measurements_ai_compose_new SELECT * FROM dev_kpi_measurements;\n",
    );
    batch.push_str("DROP TABLE dev_kpi_measurements;\n");
    batch.push_str(
        "ALTER TABLE dev_kpi_measurements_ai_compose_new RENAME TO dev_kpi_measurements;\n",
    );
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }
    ddl_step(conn, &batch)
}

/// Fold every `dev_goals.status` onto the canonical set, IN PLACE, and return
/// the `(goal_id, original_value)` of every row nothing could map.
///
/// Mapping uses `repos::dev_tools::canonical_goal_status` — the strict twin of
/// the runtime normalizer, with no catch-all — so the legacy spellings the UI
/// has always folded (running/matching → in-progress, review/awaiting_review →
/// blocked, completed/skipped → done, pending/todo/queued → open) migrate
/// cleanly, and anything else is separable.
///
/// Unmappable rows are REPORTED, not buried: each gets a `dev_goal_signals` row
/// carrying its original value — visible on the goal itself, not only in a log
/// file — plus a `tracing::warn!`. Only then is it stored as `open`, which is
/// what `normalizeGoalStatus` has been RENDERING it as all along; the migration
/// makes storage agree with the display instead of inventing a third answer.
/// Failing the migration is not on the table: it runs on every app launch, so a
/// bail would brick the install over a bad string.
pub(super) fn normalize_goal_statuses_in_place(
    conn: &Connection,
) -> Result<Vec<(String, String)>, AppError> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, status FROM dev_goals")?;
        let mapped =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let signals_table = has_table(conn, "dev_goal_signals")?;
    let mut unmappable = Vec::new();
    for (id, raw) in rows {
        match crate::repos::dev_tools::canonical_goal_status(&raw) {
            // Already canonical — leave the row alone.
            Some(canonical) if canonical == raw => {}
            Some(canonical) => {
                conn.execute(
                    "UPDATE dev_goals SET status = ?1 WHERE id = ?2",
                    rusqlite::params![canonical, id],
                )?;
            }
            None => {
                tracing::warn!(
                    goal_id = %id,
                    original_status = %raw,
                    "dev_goals.status: value is outside the canonical set and matches no known \
                     alias. The UI has been rendering it as `open`; storage now says so too. The \
                     original is preserved on the goal as a `status_unmappable` signal.",
                );
                if signals_table {
                    // Best-effort: the signal is the user-visible half of the
                    // report, but losing it must not cost the migration.
                    let _ = conn.execute(
                        "INSERT INTO dev_goal_signals (id, goal_id, signal_type, message)
                         VALUES (?1, ?2, 'status_unmappable', ?3)",
                        rusqlite::params![
                            uuid::Uuid::new_v4().to_string(),
                            id,
                            format!(
                                "Stored status {raw:?} matched no canonical goal status; migrated to \
                                 \"open\" (which is how it was already being displayed)."
                            ),
                        ],
                    );
                }
                conn.execute(
                    "UPDATE dev_goals SET status = 'open' WHERE id = ?1",
                    rusqlite::params![id],
                )?;
                unmappable.push((id, raw));
            }
        }
    }
    Ok(unmappable)
}

/// Constrain `dev_goals.status` to the canonical set.
///
/// SQLite cannot add a CHECK to an existing column in place, so this is the
/// table-rebuild pattern — recreated from the table's OWN stored DDL (the
/// `rebuild_executions_table_with_incomplete_status` discipline) rather than a
/// hand-written column list, because `dev_goals` has already grown columns by
/// ALTER (`parent_goal_id` in initial.rs, `kpi_id` here) and a positional
/// rewrite would drop whatever the next one adds.
pub(super) fn constrain_goal_status_to_canonical_set(conn: &Connection) -> Result<(), AppError> {
    // Every legacy value has to fit the constraint before the copy runs, or the
    // rebuild fails on the first stale row and takes the launch down with it.
    let unmappable = normalize_goal_statuses_in_place(conn)?;
    if !unmappable.is_empty() {
        tracing::error!(
            count = unmappable.len(),
            rows = ?unmappable,
            "dev_goals.status: rows carried a status nothing maps. Each is now `open` and carries \
             a `status_unmappable` goal signal with its original value — a writer somewhere is \
             bypassing the canonical set.",
        );
    }

    // Six tables reference `dev_goals` (including itself, via parent_goal_id),
    // so a `DROP TABLE` with FK enforcement on would fire ON DELETE CASCADE /
    // SET NULL across all of them. Same guard every rebuild in this file uses.
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let create_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_goals'",
        [],
        |r| r.get(0),
    )?;

    // `DEFAULT 'open'` occurs exactly once in the dev_goals DDL — the status
    // column. If it doesn't, the table is not the shape this step was written
    // against; bail rather than splice a CHECK onto the wrong column.
    if create_sql.matches("DEFAULT 'open'").count() != 1 {
        return Err(AppError::Validation(
            "dev_goals.status is not in the expected shape — refusing to rebuild".into(),
        ));
    }
    let check = format!(
        "DEFAULT 'open' CHECK(status IN ({}))",
        crate::repos::dev_tools::CANONICAL_GOAL_STATUSES
            .iter()
            .map(|s| format!("'{s}'"))
            .collect::<Vec<_>>()
            .join(","),
    );
    let constrained = create_sql.replacen("DEFAULT 'open'", &check, 1);
    // Re-point ONLY the table name at the staging name (occurrence 1). The
    // self-FK further down keeps saying `dev_goals`, which is what it must say
    // once the rename lands — with foreign_keys OFF, SQLite does not rewrite
    // REFERENCES clauses during a rename, so the clause has to be written as
    // its final form up front.
    let staged = constrained.replacen("dev_goals", "dev_goals_status_check_new", 1);

    // Index DDL to replay after the rename — dropping the table drops it with
    // them. `dev_goals` carries no triggers today; the query covers both.
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE tbl_name='dev_goals'
               AND type IN ('index','trigger')
               AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let mut batch = String::new();
    batch.push_str("DROP TABLE IF EXISTS dev_goals_status_check_new;\n");
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str("INSERT INTO dev_goals_status_check_new SELECT * FROM dev_goals;\n");
    batch.push_str("DROP TABLE dev_goals;\n");
    batch.push_str("ALTER TABLE dev_goals_status_check_new RENAME TO dev_goals;\n");
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }
    ddl_step(conn, &batch)
}
