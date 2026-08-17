use rusqlite::{Connection, OptionalExtension};

use personas_core::error::AppError;

struct IncrementalMigration {
    id: &'static str,
    description: &'static str,
    already_applied: fn(&Connection) -> Result<bool, AppError>,
    apply: fn(&Connection) -> Result<(), AppError>,
}

fn run_step(conn: &Connection, migration: IncrementalMigration) -> Result<(), AppError> {
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
fn ddl_step(conn: &Connection, sql: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql)?;
    tx.commit()?;
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1",
        table.replace('\'', "''"),
    ))?;
    let count = stmt.query_row([column], |row| row.get::<_, i64>(0))?;
    Ok(count > 0)
}

fn has_table(conn: &Connection, table: &str) -> Result<bool, AppError> {
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
fn report_failed_group_id_drop(table: &str, result: Result<(), AppError>) {
    if let Err(e) = result {
        tracing::error!(
            table = %table,
            error = %e,
            "retire_persona_groups: DROP COLUMN group_id failed — the dead column stays \
             (an index, trigger or view most likely still names it)",
        );
    }
}

fn has_index(conn: &Connection, index: &str) -> Result<bool, AppError> {
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
fn rebuild_executions_table_with_incomplete_status(conn: &Connection) -> Result<(), AppError> {
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
fn dangling_fk_count(conn: &Connection, table: &str) -> Result<i64, AppError> {
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
fn repoint_mcp_gateway_members_fk(conn: &Connection) -> Result<(), AppError> {
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

/// Incremental migrations for columns added after the initial schema.
/// Uses "ADD COLUMN ... IF NOT EXISTS" equivalent via PRAGMA table_info check.
pub(super) fn run_incremental(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "executions_fts",
            description: "Add FTS5 index for execution search",
            already_applied: |conn| has_table(conn, "executions_fts"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE VIRTUAL TABLE IF NOT EXISTS executions_fts USING fts5(
                        input_data,
                        output_data,
                        error_message,
                        content='persona_executions',
                        content_rowid='rowid'
                    );
                    CREATE TRIGGER IF NOT EXISTS executions_fts_ai AFTER INSERT ON persona_executions BEGIN
                        INSERT INTO executions_fts(rowid, input_data, output_data, error_message)
                        VALUES (new.rowid, new.input_data, new.output_data, new.error_message);
                    END;
                    CREATE TRIGGER IF NOT EXISTS executions_fts_ad AFTER DELETE ON persona_executions BEGIN
                        INSERT INTO executions_fts(executions_fts, rowid, input_data, output_data, error_message)
                        VALUES ('delete', old.rowid, old.input_data, old.output_data, old.error_message);
                    END;
                    CREATE TRIGGER IF NOT EXISTS executions_fts_au AFTER UPDATE OF input_data, output_data, error_message ON persona_executions BEGIN
                        INSERT INTO executions_fts(executions_fts, rowid, input_data, output_data, error_message)
                        VALUES ('delete', old.rowid, old.input_data, old.output_data, old.error_message);
                        INSERT INTO executions_fts(rowid, input_data, output_data, error_message)
                        VALUES (new.rowid, new.input_data, new.output_data, new.error_message);
                    END;",
                )?;
                Ok(())
            },
        },
    )?;

    // Add tool_steps column to persona_executions (Feature 3: Execution Inspector)
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.tool_steps",
            description: "Add tool_steps column to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "tool_steps"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN tool_steps TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Add typed circuit-breaker flag to healing issues
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_healing_issues.is_circuit_breaker",
            description: "Add typed circuit-breaker flag to healing issues",
            already_applied: |conn| {
                has_column(conn, "persona_healing_issues", "is_circuit_breaker")
            },
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE persona_healing_issues ADD COLUMN is_circuit_breaker INTEGER NOT NULL DEFAULT 0;")?;
                Ok(())
            },
        },
    )?;

    // Add use_case_flows column to persona_design_reviews
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_design_reviews.use_case_flows",
            description: "Add use_case_flows column to persona_design_reviews",
            already_applied: |conn| has_column(conn, "persona_design_reviews", "use_case_flows"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "ALTER TABLE persona_design_reviews ADD COLUMN use_case_flows TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Add retry lineage columns to persona_executions (Healing: autonomous retry)
    let has_retry_of: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'retry_of_execution_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_retry_of {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_executions ADD COLUMN retry_of_execution_id TEXT;
             ALTER TABLE persona_executions ADD COLUMN retry_count INTEGER DEFAULT 0;",
        )?;
        tracing::info!("Added retry lineage columns to persona_executions");
    }

    // Add transform_id and questions_json to n8n_transform_sessions (robustness fix)
    let has_transform_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('n8n_transform_sessions') WHERE name = 'transform_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_transform_id {
        // Recreate table to add new columns AND update CHECK constraint for 'awaiting_answers'.
        // SQLite doesn't support ALTER CHECK, so we recreate. ddl_step's transaction
        // wrapper handles the multi-statement atomicity; the DROP IF EXISTS at the top
        // is a belt-and-braces guard against any staging table that survived a prior
        // crash before per-step transactions landed.
        ddl_step(conn,
            "DROP TABLE IF EXISTS n8n_transform_sessions_new;
            CREATE TABLE n8n_transform_sessions_new (
                id                TEXT PRIMARY KEY,
                workflow_name     TEXT NOT NULL,
                status            TEXT NOT NULL DEFAULT 'draft'
                                  CHECK(status IN ('draft','analyzing','transforming','awaiting_answers','editing','confirmed','failed')),
                raw_workflow_json TEXT NOT NULL,
                parser_result     TEXT,
                draft_json        TEXT,
                user_answers      TEXT,
                step              TEXT NOT NULL DEFAULT 'upload',
                error             TEXT,
                persona_id        TEXT,
                transform_id      TEXT,
                questions_json    TEXT,
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO n8n_transform_sessions_new
                (id, workflow_name, status, raw_workflow_json, parser_result, draft_json,
                 user_answers, step, error, persona_id, created_at, updated_at)
            SELECT id, workflow_name, status, raw_workflow_json, parser_result, draft_json,
                   user_answers, step, error, persona_id, created_at, updated_at
            FROM n8n_transform_sessions;
            DROP TABLE n8n_transform_sessions;
            ALTER TABLE n8n_transform_sessions_new RENAME TO n8n_transform_sessions;
            CREATE INDEX IF NOT EXISTS idx_nts_status  ON n8n_transform_sessions(status);
            CREATE INDEX IF NOT EXISTS idx_nts_created ON n8n_transform_sessions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_nts_status_updated ON n8n_transform_sessions(status, updated_at DESC);"
        )?;
        tracing::info!("Migrated n8n_transform_sessions: added transform_id, questions_json, awaiting_answers status");
    }

    // Add tag column to persona_prompt_versions (Prompt Lab: version tagging)
    let has_ppv_tag: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_prompt_versions') WHERE name = 'tag'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ppv_tag {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_prompt_versions ADD COLUMN tag TEXT NOT NULL DEFAULT 'experimental';"
        )?;
        tracing::info!("Added tag column to persona_prompt_versions");
    }

    // Recreate persona_triggers with 'chain' trigger type support if needed.
    // SQLite doesn't support ALTER CHECK, so we recreate the table.
    // Detect by reading the stored CREATE TABLE SQL from sqlite_master --
    // the old INSERT-based probe always failed due to FK enforcement with
    // foreign_keys=ON, causing the table to be rebuilt on every startup.
    let trigger_table_sql: String = conn
        .prepare(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='persona_triggers'",
        )?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    let needs_chain_migration = !trigger_table_sql.contains("'chain'");

    if needs_chain_migration {
        // Disable FK enforcement for the table swap. With foreign_keys=ON the
        // `DROP TABLE persona_triggers` below fires ON DELETE SET NULL on
        // persona_executions.trigger_id (schema.rs) — nulling every execution's
        // trigger link on legacy DBs. Same discipline as
        // rebuild_executions_table_with_incomplete_status. Guard re-enables FK
        // on scope exit.
        let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;
        ddl_step(
                    conn,
                            "DROP TABLE IF EXISTS persona_triggers_new;
            CREATE TABLE persona_triggers_new (
                id                TEXT PRIMARY KEY,
                persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                trigger_type      TEXT NOT NULL CHECK(trigger_type IN ('manual', 'schedule', 'polling', 'webhook', 'chain', 'event_listener')),
                config            TEXT,
                enabled           INTEGER NOT NULL DEFAULT 1,
                last_triggered_at TEXT,
                next_trigger_at   TEXT,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            );
            -- Explicit column list (not SELECT *): a positional copy across two
            -- independently-authored shapes shifts values into the wrong columns
            -- if a legacy DB's column order/count drifted. Same discipline as
            -- fk_hygiene::recreate_with_fk. (use_case_id is added by a later
            -- migration, so it is intentionally not part of this older shape.)
            INSERT INTO persona_triggers_new
                (id, persona_id, trigger_type, config, enabled, last_triggered_at, next_trigger_at, created_at, updated_at)
                SELECT id, persona_id, trigger_type, config, enabled, last_triggered_at, next_trigger_at, created_at, updated_at
                FROM persona_triggers;
            DROP TABLE persona_triggers;
            ALTER TABLE persona_triggers_new RENAME TO persona_triggers;
            CREATE INDEX IF NOT EXISTS idx_ptr_persona      ON persona_triggers(persona_id);
            CREATE INDEX IF NOT EXISTS idx_ptr_next_trigger ON persona_triggers(next_trigger_at);
            CREATE INDEX IF NOT EXISTS idx_ptr_enabled      ON persona_triggers(enabled);"
        )?;
        tracing::info!("Migrated persona_triggers to support 'chain' trigger type");
    }

    // Add implementation_guide column to persona_tool_definitions
    let has_impl_guide: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_tool_definitions') WHERE name = 'implementation_guide'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_impl_guide {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_tool_definitions ADD COLUMN implementation_guide TEXT;",
        )?;
        tracing::info!("Added implementation_guide column to persona_tool_definitions");
    }

    // Add use_case_id column to persona_executions
    let has_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_executions ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pe_use_case ON persona_executions(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_executions");
    }

    // Phase C3 — Add is_simulation column to persona_executions so runs made
    // via `simulate_use_case` can be filtered out of real activity feeds and
    // skip outbound notification dispatch.
    // See docs/concepts/persona-capabilities/04-data-model.md.
    let has_is_simulation: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'is_simulation'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_is_simulation {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_executions ADD COLUMN is_simulation INTEGER NOT NULL DEFAULT 0;
             CREATE INDEX IF NOT EXISTS idx_pe_simulation ON persona_executions(persona_id, is_simulation);"
        )?;
        tracing::info!("Added is_simulation column to persona_executions");
    }

    // Phase C5 — use_case_id attribution for messages, manual reviews, and memories.
    // Lets the activity feed, review queues, and learned-memory injection scope
    // by capability. Inherited from the originating execution at dispatch time.
    // See docs/concepts/persona-capabilities/04-data-model.md and 09-implementation-plan.md §C5.
    let has_msg_use_case_id: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_messages') WHERE name = 'use_case_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_msg_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_messages ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pmsg_use_case ON persona_messages(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_messages");
    }

    let has_review_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_manual_reviews') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_review_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_manual_reviews ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pmr_use_case ON persona_manual_reviews(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_manual_reviews");
    }

    // Phase 1 (resume loop): link a review back to the team step it gates, so an
    // approval can resume the blocked assignment. Populated at create time via
    // the execution_id → team_assignment_steps join; NULL for standalone runs.
    let has_review_assignment_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_manual_reviews') WHERE name = 'assignment_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_review_assignment_id {
        ddl_step(
            conn,
            "ALTER TABLE persona_manual_reviews ADD COLUMN assignment_id TEXT;
             ALTER TABLE persona_manual_reviews ADD COLUMN step_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pmr_assignment ON persona_manual_reviews(assignment_id);",
        )?;
        tracing::info!("Added assignment_id + step_id columns to persona_manual_reviews");
    }

    let has_memory_use_case_id: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_memories') WHERE name = 'use_case_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_memory_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_memories ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pm_use_case ON persona_memories(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_memories");
    }

    // Add use_case_id to persona_triggers
    let has_trigger_use_case_id: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'use_case_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_triggers ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pt_use_case ON persona_triggers(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_triggers");
    }

    // Add use_case_id to persona_event_subscriptions
    let has_sub_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_event_subscriptions') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sub_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_event_subscriptions ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pes_use_case ON persona_event_subscriptions(use_case_id);"
        )?;
        tracing::info!("Added use_case_id column to persona_event_subscriptions");
    }

    // Add use_case_id to persona_events
    let has_event_use_case_id: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_events') WHERE name = 'use_case_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_event_use_case_id {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_events ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pevt_use_case ON persona_events(use_case_id);",
        )?;
        tracing::info!("Added use_case_id column to persona_events");
    }

    // Migrate existing persona_test_runs -> lab_arena_runs (one-time copy)
    let arena_count: i64 = conn
        .prepare("SELECT COUNT(*) FROM lab_arena_runs")?
        .query_row([], |row| row.get(0))
        .unwrap_or(0);
    let old_test_count: i64 = conn
        .prepare("SELECT COUNT(*) FROM persona_test_runs")?
        .query_row([], |row| row.get(0))
        .unwrap_or(0);
    if arena_count == 0 && old_test_count > 0 {
        ddl_step(
                    conn,
                            "INSERT OR IGNORE INTO lab_arena_runs (id, persona_id, status, models_tested, scenarios_count, summary, error, created_at, completed_at)
             SELECT id, persona_id, status, models_tested, scenarios_count, summary, error, created_at, completed_at
             FROM persona_test_runs;

             -- tool_calls_expected/actual omitted: the lab_tool_calls ADR
             -- drops those columns from both source and dest tables. Tool
             -- calls for any persona_test_results rows that still have JSON
             -- data are picked up separately by backfill_lab_tool_calls.
             INSERT OR IGNORE INTO lab_arena_results (id, run_id, scenario_name, model_id, provider, status, output_preview, tool_accuracy_score, output_quality_score, protocol_compliance, input_tokens, output_tokens, cost_usd, duration_ms, error_message, created_at)
             SELECT id, test_run_id, scenario_name, model_id, provider, status, output_preview, tool_accuracy_score, output_quality_score, protocol_compliance, input_tokens, output_tokens, cost_usd, duration_ms, error_message, created_at
             FROM persona_test_results;"
        )?;
        tracing::info!("Migrated {} test runs to lab_arena_runs", old_test_count);
    }

    // Add design_conversations table (persistent multi-turn design sessions)
    let has_design_conversations: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='design_conversations'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_design_conversations {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS design_conversations (
                id          TEXT PRIMARY KEY,
                persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'active'
                            CHECK(status IN ('active','completed','abandoned')),
                messages    TEXT NOT NULL DEFAULT '[]',
                last_result TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_dc_persona ON design_conversations(persona_id);
            CREATE INDEX IF NOT EXISTS idx_dc_status  ON design_conversations(status);
            CREATE INDEX IF NOT EXISTS idx_dc_updated ON design_conversations(updated_at DESC);",
        )?;
        tracing::info!("Created design_conversations table");
    }

    // Add lab_eval_runs / lab_eval_results tables (N prompt versions × M models evaluation matrix)
    let has_eval_runs: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lab_eval_runs'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_eval_runs {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS lab_eval_runs (
                id              TEXT PRIMARY KEY,
                persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                status          TEXT NOT NULL DEFAULT 'generating',
                version_ids     TEXT NOT NULL DEFAULT '[]',
                version_numbers TEXT NOT NULL DEFAULT '[]',
                models_tested   TEXT NOT NULL DEFAULT '[]',
                scenarios_count INTEGER NOT NULL DEFAULT 0,
                use_case_filter TEXT,
                test_input      TEXT,
                summary         TEXT,
                error           TEXT,
                created_at      TEXT NOT NULL,
                completed_at    TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_lab_eval_runs_persona ON lab_eval_runs(persona_id);
            CREATE INDEX IF NOT EXISTS idx_lab_eval_runs_created ON lab_eval_runs(created_at DESC);

            CREATE TABLE IF NOT EXISTS lab_eval_results (
                id                    TEXT PRIMARY KEY,
                run_id                TEXT NOT NULL REFERENCES lab_eval_runs(id) ON DELETE CASCADE,
                version_id            TEXT NOT NULL,
                version_number        INTEGER NOT NULL,
                scenario_name         TEXT NOT NULL,
                model_id              TEXT NOT NULL,
                provider              TEXT NOT NULL DEFAULT 'anthropic',
                status                TEXT NOT NULL DEFAULT 'pending',
                output_preview        TEXT,
                -- tool_calls_expected/actual retired in lab_tool_calls ADR.
                tool_accuracy_score   INTEGER,
                output_quality_score  INTEGER,
                protocol_compliance   INTEGER,
                input_tokens          INTEGER NOT NULL DEFAULT 0,
                output_tokens         INTEGER NOT NULL DEFAULT 0,
                cost_usd              REAL NOT NULL DEFAULT 0.0,
                duration_ms           INTEGER NOT NULL DEFAULT 0,
                error_message         TEXT,
                created_at            TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lab_eval_results_run ON lab_eval_results(run_id);",
        )?;
        tracing::info!("Created lab_eval_runs and lab_eval_results tables");
    }

    // Add test_suites table (reusable test scenario collections)
    let has_test_suites: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_suites'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_test_suites {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS test_suites (
                id              TEXT PRIMARY KEY,
                persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                name            TEXT NOT NULL,
                description     TEXT,
                scenarios       TEXT NOT NULL DEFAULT '[]',
                scenario_count  INTEGER NOT NULL DEFAULT 0,
                source_run_id   TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_test_suites_persona ON test_suites(persona_id);
            CREATE INDEX IF NOT EXISTS idx_test_suites_created ON test_suites(created_at DESC);",
        )?;
        tracing::info!("Created test_suites table");
    }

    // Promote persona_groups to workspace containers: add shared resource fields.
    // Skipped entirely on fresh post-Phase-5 DBs that never create the table
    // (Groups→Teams retire). Existing DBs still have it here — it's dropped
    // later by `retire_persona_groups`.
    let groups_table_exists: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_groups'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    let has_group_description: bool = !groups_table_exists
        || conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('persona_groups') WHERE name = 'description'",
            )?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
    if groups_table_exists && !has_group_description {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_groups ADD COLUMN description TEXT;
             ALTER TABLE persona_groups ADD COLUMN default_model_profile TEXT;
             ALTER TABLE persona_groups ADD COLUMN default_max_budget_usd REAL;
             ALTER TABLE persona_groups ADD COLUMN default_max_turns INTEGER;
             ALTER TABLE persona_groups ADD COLUMN shared_instructions TEXT;",
        )?;
        tracing::info!("Added workspace fields to persona_groups");
    }

    // Add execution_traces table (Structured Execution Traces with Span Tree)
    let has_execution_traces: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='execution_traces'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_execution_traces {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS execution_traces (
                id              TEXT PRIMARY KEY,
                execution_id    TEXT NOT NULL,
                trace_id        TEXT NOT NULL,
                persona_id      TEXT NOT NULL,
                chain_trace_id  TEXT,
                spans           TEXT NOT NULL DEFAULT '[]',
                total_duration_ms INTEGER,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_et_execution ON execution_traces(execution_id);
            CREATE INDEX IF NOT EXISTS idx_et_persona   ON execution_traces(persona_id);
            CREATE INDEX IF NOT EXISTS idx_et_chain     ON execution_traces(chain_trace_id);
            CREATE INDEX IF NOT EXISTS idx_et_created   ON execution_traces(created_at DESC);",
        )?;
        tracing::info!("Created execution_traces table");
    }

    // Add adoption_count and last_adopted_at columns to persona_design_reviews
    let has_adoption_count: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_design_reviews') WHERE name = 'adoption_count'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_adoption_count {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_design_reviews ADD COLUMN adoption_count INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE persona_design_reviews ADD COLUMN last_adopted_at TEXT;"
        )?;
        tracing::info!(
            "Added adoption_count and last_adopted_at columns to persona_design_reviews"
        );
    }

    // Add unique index on test_case_name to prevent duplicate templates.
    // First clean up existing duplicates (keep newest per name), then create unique index.
    let has_unique_name_idx: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_unique_name_idx {
        ddl_step(
                    conn,
                            "DELETE FROM persona_design_reviews
             WHERE id NOT IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (PARTITION BY test_case_name ORDER BY created_at DESC) AS rn
                 FROM persona_design_reviews
               ) WHERE rn = 1
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pdr_unique_name ON persona_design_reviews(test_case_name);"
        )?;
        tracing::info!(
            "Cleaned up duplicate design reviews and added unique index on test_case_name"
        );
    }

    // Add unique index on (persona_id, event_type, COALESCE(source_filter, ''))
    // to prevent duplicate subscriptions that cause duplicate persona fires.
    let has_pes_unique_idx: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pes_unique_sub'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_pes_unique_idx {
        // Clean up existing duplicates first (keep newest per combo)
        ddl_step(
                    conn,
                            "DELETE FROM persona_event_subscriptions
             WHERE id NOT IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (
                          PARTITION BY persona_id, event_type, COALESCE(source_filter, '')
                          ORDER BY created_at DESC
                        ) AS rn
                 FROM persona_event_subscriptions
               ) WHERE rn = 1
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pes_unique_sub
               ON persona_event_subscriptions(persona_id, event_type, COALESCE(source_filter, ''));"
        )?;
        tracing::info!("Cleaned up duplicate event subscriptions and added unique index");
    }

    // Add unique constraint on team connections to prevent duplicate edges and self-loops
    let has_ptc_unique_idx: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_ptc_unique_edge'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ptc_unique_idx {
        ddl_step(
                    conn,
                            "DELETE FROM persona_team_connections
             WHERE id NOT IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (
                          PARTITION BY team_id, source_member_id, target_member_id
                          ORDER BY created_at ASC
                        ) AS rn
                 FROM persona_team_connections
               ) WHERE rn = 1
             );
             DELETE FROM persona_team_connections
               WHERE source_member_id = target_member_id;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_ptc_unique_edge
               ON persona_team_connections(team_id, source_member_id, target_member_id);",
        )?;
        tracing::info!("Cleaned up duplicate/self-loop team connections and added unique index");
    }

    // Replace unique index on (test_case_name) with (test_case_name, test_run_id)
    // so that different review runs can each have their own results for the same template.
    let has_old_name_only_idx: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_old_name_only_idx {
        ddl_step(
                    conn,
                            "DROP INDEX IF EXISTS idx_pdr_unique_name;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pdr_unique_name_run
               ON persona_design_reviews(test_case_name, test_run_id);",
        )?;
        tracing::info!(
            "Replaced unique index on test_case_name with (test_case_name, test_run_id)"
        );
    }

    // Ensure the composite index exists even for fresh installs that never had the old one
    let has_composite_idx: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name_run'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_composite_idx {
        ddl_step(
                    conn,
                            "CREATE UNIQUE INDEX IF NOT EXISTS idx_pdr_unique_name_run
               ON persona_design_reviews(test_case_name, test_run_id);",
        )?;
    }

    // Add category column to persona_design_reviews (Template category filtering)
    let has_category: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_design_reviews') WHERE name = 'category'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_category {
        ddl_step(conn, "ALTER TABLE persona_design_reviews ADD COLUMN category TEXT;")?;
        tracing::info!("Added category column to persona_design_reviews");
    }

    // Create credential_fields table for field-level credential storage.
    // For existing databases, the table is added here; for new databases
    // it's created by the base SCHEMA above.
    let has_credential_fields: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credential_fields'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_credential_fields {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS credential_fields (
                id                TEXT PRIMARY KEY,
                credential_id     TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
                field_key         TEXT NOT NULL,
                encrypted_value   TEXT NOT NULL DEFAULT '',
                iv                TEXT NOT NULL DEFAULT '',
                field_type        TEXT NOT NULL DEFAULT 'text',
                is_sensitive      INTEGER NOT NULL DEFAULT 1,
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(credential_id, field_key)
            );
            CREATE INDEX IF NOT EXISTS idx_cf_credential ON credential_fields(credential_id);
            CREATE INDEX IF NOT EXISTS idx_cf_key        ON credential_fields(field_key);"
        )?;
        tracing::info!("Created credential_fields table");
    }

    // Migrate existing blob credentials to field-level rows.
    // This is idempotent: only credentials that have no field rows yet are split.
    super::helpers::migrate_blob_credentials_to_fields(conn)?;

    // After splitting fields, drop the legacy `encrypted_data` / `iv` blobs on
    // any row that has been migrated. Field rows are the authoritative source
    // of truth; the blob columns must be empty to avoid the dual-source-of-
    // truth bug documented on `PersonaCredential`. Then loudly log any
    // violation that survives.
    super::helpers::clear_legacy_credential_blobs(conn)?;
    super::helpers::assert_credential_blob_invariant(conn)?;

    // -- Unified Reactions: add event_listener trigger type ---------------
    // Recreate persona_triggers with event_listener in the CHECK constraint,
    // then copy all persona_event_subscriptions as event_listener triggers.
    let trigger_sql: String = conn
        .prepare("SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='persona_triggers'")?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    if !trigger_sql.contains("'event_listener'") {
        ddl_step(
                    conn,
                            "DROP TABLE IF EXISTS persona_triggers_new;
            CREATE TABLE persona_triggers_new (
                id                TEXT PRIMARY KEY,
                persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                trigger_type      TEXT NOT NULL CHECK(trigger_type IN ('manual', 'schedule', 'polling', 'webhook', 'chain', 'event_listener')),
                config            TEXT,
                enabled           INTEGER NOT NULL DEFAULT 1,
                last_triggered_at TEXT,
                next_trigger_at   TEXT,
                use_case_id       TEXT,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            );
            INSERT INTO persona_triggers_new
              SELECT id, persona_id, trigger_type, config, enabled,
                     last_triggered_at, next_trigger_at, use_case_id,
                     created_at, updated_at
              FROM persona_triggers;
            DROP TABLE persona_triggers;
            ALTER TABLE persona_triggers_new RENAME TO persona_triggers;
            CREATE INDEX IF NOT EXISTS idx_ptr_persona      ON persona_triggers(persona_id);
            CREATE INDEX IF NOT EXISTS idx_ptr_next_trigger ON persona_triggers(next_trigger_at);
            CREATE INDEX IF NOT EXISTS idx_ptr_enabled      ON persona_triggers(enabled);
            CREATE INDEX IF NOT EXISTS idx_pt_use_case      ON persona_triggers(use_case_id);"
        )?;
        tracing::info!("Migrated persona_triggers to support 'event_listener' trigger type");
    }

    // Copy existing persona_event_subscriptions -> event_listener triggers (idempotent).
    // Only copies subscriptions that don't already have a matching event_listener trigger.
    let sub_count: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_event_subscriptions s
             WHERE NOT EXISTS (
               SELECT 1 FROM persona_triggers t
               WHERE t.trigger_type = 'event_listener'
                 AND t.persona_id = s.persona_id
                 AND json_extract(t.config, '$.listen_event_type') = s.event_type
                 AND COALESCE(json_extract(t.config, '$.source_filter'), '') = COALESCE(s.source_filter, '')
             )"
        )?
        .query_row([], |row| row.get(0))
        .unwrap_or(0);

    if sub_count > 0 {
        ddl_step(
                    conn,
                            "INSERT INTO persona_triggers (id, persona_id, trigger_type, config, enabled, use_case_id, created_at, updated_at)
             SELECT
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
               s.persona_id,
               'event_listener',
               json_object('listen_event_type', s.event_type, 'source_filter', s.source_filter),
               s.enabled,
               s.use_case_id,
               s.created_at,
               s.updated_at
             FROM persona_event_subscriptions s
             WHERE NOT EXISTS (
               SELECT 1 FROM persona_triggers t
               WHERE t.trigger_type = 'event_listener'
                 AND t.persona_id = s.persona_id
                 AND json_extract(t.config, '$.listen_event_type') = s.event_type
                 AND COALESCE(json_extract(t.config, '$.source_filter'), '') = COALESCE(s.source_filter, '')
             );"
        )?;
        tracing::info!(
            "Copied {} event subscriptions to event_listener triggers",
            sub_count
        );
    }

    // -- Credential Audit Log (append-only compliance trail) -------------
    let has_credential_audit_log: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credential_audit_log'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_credential_audit_log {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS credential_audit_log (
                id              TEXT PRIMARY KEY,
                credential_id   TEXT NOT NULL,
                credential_name TEXT NOT NULL,
                operation       TEXT NOT NULL,
                persona_id      TEXT,
                persona_name    TEXT,
                detail          TEXT,
                created_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cal_credential ON credential_audit_log(credential_id);
            CREATE INDEX IF NOT EXISTS idx_cal_operation  ON credential_audit_log(operation);
            CREATE INDEX IF NOT EXISTS idx_cal_created    ON credential_audit_log(created_at DESC);"
        )?;
        tracing::info!("Created credential_audit_log table");
    }

    // -- Settings Audit Log (append-only mutation trail per settings sub-module)
    let has_settings_audit_log: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings_audit_log'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_settings_audit_log {
        ddl_step(
            conn,
            "CREATE TABLE IF NOT EXISTS settings_audit_log (
                id            TEXT PRIMARY KEY,
                category      TEXT NOT NULL,
                setting_key   TEXT NOT NULL,
                action        TEXT NOT NULL,
                before_value  TEXT,
                after_value   TEXT,
                actor         TEXT,
                created_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sal_category ON settings_audit_log(category);
            CREATE INDEX IF NOT EXISTS idx_sal_created  ON settings_audit_log(created_at DESC);",
        )?;
        tracing::info!("Created settings_audit_log table");
    }

    // -- Persona Change Log (append-only field-level edit trail) ---------
    // "Who changed my agent's model / budget / prompt and when." One row per
    // changed field per update_persona call. Secret-bearing fields
    // (model_profile, notification_channels) are logged with values redacted
    // to "(changed)". Bounded per-persona retention is enforced in the repo.
    let has_persona_change_log: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_change_log'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_persona_change_log {
        ddl_step(
            conn,
            "CREATE TABLE IF NOT EXISTS persona_change_log (
                id           TEXT PRIMARY KEY,
                persona_id   TEXT NOT NULL,
                field        TEXT NOT NULL,
                before_value TEXT,
                after_value  TEXT,
                source       TEXT,
                created_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pcl_persona ON persona_change_log(persona_id, created_at DESC);",
        )?;
        tracing::info!("Created persona_change_log table");
    }

    // -- Tool Execution Audit Log (append-only) --------------------------
    let has_tool_audit_log: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tool_execution_audit_log'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_tool_audit_log {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS tool_execution_audit_log (
                id              TEXT PRIMARY KEY,
                tool_id         TEXT NOT NULL,
                tool_name       TEXT NOT NULL,
                tool_type       TEXT NOT NULL,
                persona_id      TEXT,
                persona_name    TEXT,
                credential_id   TEXT,
                result_status   TEXT NOT NULL,
                duration_ms     INTEGER,
                error_message   TEXT,
                error_kind      TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_teal_tool    ON tool_execution_audit_log(tool_id);
            CREATE INDEX IF NOT EXISTS idx_teal_persona ON tool_execution_audit_log(persona_id);
            CREATE INDEX IF NOT EXISTS idx_teal_status  ON tool_execution_audit_log(result_status);
            CREATE INDEX IF NOT EXISTS idx_teal_created ON tool_execution_audit_log(created_at DESC);"
        )?;
        tracing::info!("Created tool_execution_audit_log table");
    }

    // -- tool_execution_audit_log: add typed error_kind column ------------
    // Idempotent add-column guard for DBs created before the tool-result
    // contract landed. Guarded on both table presence (fresh installs above
    // already include the column) and column absence so it never double-applies.
    let has_tool_audit_table: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tool_execution_audit_log'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if has_tool_audit_table {
        let has_error_kind: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('tool_execution_audit_log') WHERE name = 'error_kind'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_error_kind {
            ddl_step(
                conn,
                "ALTER TABLE tool_execution_audit_log ADD COLUMN error_kind TEXT;",
            )?;
            tracing::info!("Added error_kind column to tool_execution_audit_log");
        }
    }

    // -- Encrypted event payloads: add payload_iv column -----------------
    let has_payload_iv: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_events') WHERE name = 'payload_iv'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_payload_iv {
        ddl_step(conn, "ALTER TABLE persona_events ADD COLUMN payload_iv TEXT;")?;
        tracing::info!("Added payload_iv column to persona_events for encrypted event payloads");
    }

    // -- Persona sensitivity flag for hover-preview masking -------------
    let has_sensitive_flag: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'sensitive'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_sensitive_flag {
        ddl_step(
                    conn,
                            "ALTER TABLE personas ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0;",
        )?;
        tracing::info!("Added sensitive column to personas");
    }

    // -- Playwright Procedures (saved browser automation for credential setup) --
    let has_playwright_procedures: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='playwright_procedures'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_playwright_procedures {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS playwright_procedures (
                id              TEXT PRIMARY KEY,
                connector_name  TEXT NOT NULL,
                procedure_json  TEXT NOT NULL,
                field_keys      TEXT NOT NULL DEFAULT '[]',
                is_active       INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pp_connector ON playwright_procedures(connector_name);
            CREATE INDEX IF NOT EXISTS idx_pp_active    ON playwright_procedures(connector_name, is_active);"
        )?;
        tracing::info!("Created playwright_procedures table");
    }

    // -- Execution Knowledge Graph (cross-run learning) ---------------
    let has_execution_knowledge: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='execution_knowledge'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_execution_knowledge {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS execution_knowledge (
                id                  TEXT PRIMARY KEY,
                persona_id          TEXT NOT NULL,
                use_case_id         TEXT,
                knowledge_type      TEXT NOT NULL
                                    CHECK(knowledge_type IN ('tool_sequence','failure_pattern','cost_quality','data_flow','model_performance')),
                pattern_key         TEXT NOT NULL,
                pattern_data        TEXT NOT NULL DEFAULT '{}',
                success_count       INTEGER NOT NULL DEFAULT 0,
                failure_count       INTEGER NOT NULL DEFAULT 0,
                avg_cost_usd        REAL NOT NULL DEFAULT 0.0,
                avg_duration_ms     REAL NOT NULL DEFAULT 0.0,
                confidence          REAL NOT NULL DEFAULT 0.0,
                last_execution_id   TEXT,
                created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(persona_id, knowledge_type, pattern_key)
            );
            CREATE INDEX IF NOT EXISTS idx_ek_persona    ON execution_knowledge(persona_id);
            CREATE INDEX IF NOT EXISTS idx_ek_type       ON execution_knowledge(knowledge_type);
            CREATE INDEX IF NOT EXISTS idx_ek_confidence ON execution_knowledge(confidence DESC);
            CREATE INDEX IF NOT EXISTS idx_ek_use_case   ON execution_knowledge(use_case_id);"
        )?;
        tracing::info!("Created execution_knowledge table");
    }

    // -- Recipe Definitions: add credential_id column ----------------------
    let has_recipe_credential_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('recipe_definitions') WHERE name='credential_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_recipe_credential_id {
        ddl_step(conn, "ALTER TABLE recipe_definitions ADD COLUMN credential_id TEXT;")?;
        tracing::info!("Added credential_id column to recipe_definitions");
    }
    // Index created separately -- safe for both new and existing DBs
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_recipe_def_credential ON recipe_definitions(credential_id);"
    )?;

    // -- Recipe Definitions: add use_case_id column -----------------------
    let has_recipe_use_case_id: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('recipe_definitions') WHERE name='use_case_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_recipe_use_case_id {
        ddl_step(conn, "ALTER TABLE recipe_definitions ADD COLUMN use_case_id TEXT;")?;
        tracing::info!("Added use_case_id column to recipe_definitions");
    }
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_recipe_def_use_case ON recipe_definitions(use_case_id);",
    )?;

    // -- Recipe Versions table ------------------------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS recipe_versions (
            id              TEXT PRIMARY KEY,
            recipe_id       TEXT NOT NULL REFERENCES recipe_definitions(id) ON DELETE CASCADE,
            version_number  INTEGER NOT NULL,
            prompt_template TEXT NOT NULL,
            input_schema    TEXT,
            sample_inputs   TEXT,
            description     TEXT,
            changes_summary TEXT,
            created_at      TEXT NOT NULL,
            UNIQUE(recipe_id, version_number)
        );
        CREATE INDEX IF NOT EXISTS idx_rv_recipe ON recipe_versions(recipe_id);
        CREATE INDEX IF NOT EXISTS idx_rv_version ON recipe_versions(recipe_id, version_number DESC);"
    )?;

    // -- Provider Audit Log (BYOM compliance trail) -----------------
    let has_provider_audit_log: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='provider_audit_log'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_provider_audit_log {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS provider_audit_log (
                id                  TEXT PRIMARY KEY,
                execution_id        TEXT NOT NULL,
                persona_id          TEXT NOT NULL,
                persona_name        TEXT NOT NULL,
                engine_kind         TEXT NOT NULL,
                model_used          TEXT,
                was_failover        INTEGER NOT NULL DEFAULT 0,
                routing_rule_name   TEXT,
                compliance_rule_name TEXT,
                cost_usd            REAL,
                duration_ms         INTEGER,
                status              TEXT NOT NULL DEFAULT 'completed',
                created_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pal_execution ON provider_audit_log(execution_id);
            CREATE INDEX IF NOT EXISTS idx_pal_persona   ON provider_audit_log(persona_id);
            CREATE INDEX IF NOT EXISTS idx_pal_engine    ON provider_audit_log(engine_kind);
            CREATE INDEX IF NOT EXISTS idx_pal_created   ON provider_audit_log(created_at DESC);",
        )?;
        tracing::info!("Created provider_audit_log table (BYOM)");
    }

    // -- Missing indexes for common query patterns --------------------
    // These cover the most frequent WHERE + ORDER BY combinations found
    // across repository modules. All use IF NOT EXISTS so they are safe
    // to run on existing databases that already have them.
    ddl_step(
                    conn,
                        "-- personas: list queries order by created_at and filter by project_id
         CREATE INDEX IF NOT EXISTS idx_personas_project    ON personas(project_id);
         CREATE INDEX IF NOT EXISTS idx_personas_created    ON personas(created_at DESC);

         -- persona_executions: the most queried table; composite covers
         -- WHERE persona_id = ? ORDER BY created_at DESC (listing, stats, cost)
         CREATE INDEX IF NOT EXISTS idx_pe_persona_created  ON persona_executions(persona_id, created_at DESC);
         -- WHERE persona_id = ? AND status IN (...) (concurrent count, failed listing)
         CREATE INDEX IF NOT EXISTS idx_pe_persona_status   ON persona_executions(persona_id, status);
         -- WHERE status IN (...) AND created_at >= ... (dashboard: get_execution_dashboard, duration percentiles)
         CREATE INDEX IF NOT EXISTS idx_pe_status_created   ON persona_executions(status, created_at DESC);
         -- WHERE retry_of_execution_id = ? (retry lineage lookup)
         CREATE INDEX IF NOT EXISTS idx_pe_retry_of         ON persona_executions(retry_of_execution_id);

         -- persona_manual_reviews: WHERE execution_id = ?
         CREATE INDEX IF NOT EXISTS idx_pmr_execution       ON persona_manual_reviews(execution_id);

         -- persona_memories: WHERE source_execution_id = ?
         CREATE INDEX IF NOT EXISTS idx_pm_source_exec      ON persona_memories(source_execution_id);
         -- WHERE persona_id = ? ORDER BY created_at DESC (list with pagination)
         CREATE INDEX IF NOT EXISTS idx_pm_persona_created  ON persona_memories(persona_id, created_at DESC);

         -- persona_healing_issues: WHERE persona_id = ? AND status = ?
         CREATE INDEX IF NOT EXISTS idx_phi_persona_status  ON persona_healing_issues(persona_id, status);
         -- ORDER BY created_at DESC (listing)
         CREATE INDEX IF NOT EXISTS idx_phi_created         ON persona_healing_issues(created_at DESC);

         -- execution_knowledge: WHERE persona_id = ? AND knowledge_type = ?
         CREATE INDEX IF NOT EXISTS idx_ek_persona_type     ON execution_knowledge(persona_id, knowledge_type);

         -- persona_credentials: ORDER BY created_at DESC (listing)
         CREATE INDEX IF NOT EXISTS idx_pc_created          ON persona_credentials(created_at DESC);

         -- persona_automations: WHERE persona_id = ? ORDER BY created_at
         CREATE INDEX IF NOT EXISTS idx_automations_created ON persona_automations(persona_id, created_at);

         -- persona_events: WHERE project_id = ? ORDER BY created_at DESC
         CREATE INDEX IF NOT EXISTS idx_pev_project_created ON persona_events(project_id, created_at DESC);

         -- persona_metrics_snapshots: composite for date-range queries per persona
         CREATE INDEX IF NOT EXISTS idx_pms_persona_date    ON persona_metrics_snapshots(persona_id, snapshot_date);"
    )?;

    // -- Headless flag for background cron agents -------------------------
    let has_headless: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'headless'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_headless {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN headless INTEGER NOT NULL DEFAULT 0;")?;
        tracing::info!("Added headless column to personas for background cron agents");
    }

    // -- Knowledge Annotations: scope, annotation, and verification columns --
    let has_ek_scope: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('execution_knowledge') WHERE name = 'scope_type'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ek_scope {
        ddl_step(
                    conn,
                            "ALTER TABLE execution_knowledge ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'persona';
             ALTER TABLE execution_knowledge ADD COLUMN scope_id TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN annotation_text TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN annotation_source TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;",
        )?;
        ddl_step(
                    conn,
                            "CREATE INDEX IF NOT EXISTS idx_ek_scope ON execution_knowledge(scope_type, scope_id);
             CREATE INDEX IF NOT EXISTS idx_ek_annotation ON execution_knowledge(annotation_source);"
        )?;
        tracing::info!("Added knowledge annotation columns (scope_type, scope_id, annotation_text, annotation_source, is_verified)");
    }

    // Update CHECK constraint to allow new knowledge_type values
    // SQLite doesn't support ALTER CHECK, so we add new types via a permissive approach:
    // The original CHECK is on the table creation. For new rows we validate in application code.
    // New types: 'agent_annotation', 'user_annotation'

    // -- Template Feedback table -----------------------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS template_feedback (
            id              TEXT PRIMARY KEY,
            review_id       TEXT NOT NULL,
            persona_id      TEXT NOT NULL,
            execution_id    TEXT,
            rating          TEXT NOT NULL CHECK(rating IN ('positive','negative','neutral')),
            labels          TEXT NOT NULL DEFAULT '[]',
            comment         TEXT,
            source          TEXT NOT NULL DEFAULT 'system',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (review_id) REFERENCES persona_design_reviews(id)
        );
        CREATE INDEX IF NOT EXISTS idx_tf_review   ON template_feedback(review_id);
        CREATE INDEX IF NOT EXISTS idx_tf_persona  ON template_feedback(persona_id);
        CREATE INDEX IF NOT EXISTS idx_tf_rating   ON template_feedback(rating);",
    )?;

    // -- Credential recipes: shared discovery cache across Design / Negotiator / AutoCred --
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS credential_recipes (
            id                  TEXT PRIMARY KEY,
            connector_name      TEXT NOT NULL UNIQUE,
            connector_label     TEXT NOT NULL,
            category            TEXT NOT NULL DEFAULT '',
            color               TEXT NOT NULL DEFAULT '#888888',
            oauth_type          TEXT,
            fields_json         TEXT NOT NULL DEFAULT '[]',
            healthcheck_json    TEXT,
            setup_instructions  TEXT,
            summary             TEXT,
            docs_url            TEXT,
            source              TEXT NOT NULL DEFAULT 'design',
            usage_count         INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cred_recipes_name ON credential_recipes(connector_name);",
    )?;

    // -- Personas: source_review_id for template lineage tracking --------
    let has_source_review: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'source_review_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_source_review {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN source_review_id TEXT;")?;
        tracing::info!("Added source_review_id to personas for template lineage tracking");
    }

    // -- Personas: trust_level and trust_origin columns ------------------
    let has_trust_level: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'trust_level'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_trust_level {
        ddl_step(
                    conn,
                            "ALTER TABLE personas ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'verified';
             ALTER TABLE personas ADD COLUMN trust_origin TEXT NOT NULL DEFAULT 'builtin';
             ALTER TABLE personas ADD COLUMN trust_verified_at TEXT;",
        )?;
        tracing::info!("Added trust_level, trust_origin, trust_verified_at to personas");
    }

    // -- Saved Views for Analytics ------------------
    let has_saved_views: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='saved_views'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_saved_views {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS saved_views (
                id                  TEXT PRIMARY KEY,
                name                TEXT NOT NULL,
                persona_id          TEXT,
                day_range           INTEGER NOT NULL DEFAULT 30,
                custom_start_date   TEXT,
                custom_end_date     TEXT,
                compare_enabled     INTEGER NOT NULL DEFAULT 0,
                is_smart            INTEGER NOT NULL DEFAULT 0,
                created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_saved_views_created ON saved_views(created_at DESC);",
        )?;
        tracing::info!("Created saved_views table");
    }

    // -- execution_traces: evicted_span_count column ----------------------
    let has_et_evicted: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('execution_traces') WHERE name = 'evicted_span_count'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_et_evicted {
        ddl_step(
                    conn,
                            "ALTER TABLE execution_traces ADD COLUMN evicted_span_count INTEGER NOT NULL DEFAULT 0;"
        )?;
        tracing::info!("Added evicted_span_count column to execution_traces");
    }

    // -- P2P Phase 2: Discovered Peers table (mDNS LAN discovery) ------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS discovered_peers (
            peer_id         TEXT PRIMARY KEY,
            display_name    TEXT NOT NULL,
            addresses       TEXT NOT NULL,
            last_seen_at    TEXT NOT NULL,
            first_seen_at   TEXT NOT NULL,
            is_connected    INTEGER NOT NULL DEFAULT 0,
            metadata        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dp_connected ON discovered_peers(is_connected);
        CREATE INDEX IF NOT EXISTS idx_dp_last_seen ON discovered_peers(last_seen_at DESC);",
    )?;

    // -- P2P Phase 2: Peer Manifests table (synced exposure manifests) -
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS peer_manifests (
            id              TEXT PRIMARY KEY,
            peer_id         TEXT NOT NULL,
            resource_type   TEXT NOT NULL,
            resource_id     TEXT NOT NULL,
            display_name    TEXT NOT NULL,
            access_level    TEXT NOT NULL,
            tags            TEXT NOT NULL DEFAULT '[]',
            synced_at       TEXT NOT NULL,
            UNIQUE(peer_id, resource_type, resource_id)
        );
        CREATE INDEX IF NOT EXISTS idx_pm2_peer ON peer_manifests(peer_id);
        CREATE INDEX IF NOT EXISTS idx_pm2_synced ON peer_manifests(synced_at DESC);",
    )?;

    // -- P2P Phase 3: trust_status column on discovered_peers -------------
    let has_trust_status: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('discovered_peers') WHERE name = 'trust_status'")?
        .query_row([], |r| r.get::<_, i32>(0))
        .unwrap_or(0)
        > 0;
    if !has_trust_status {
        ddl_step(
                    conn,
                            "ALTER TABLE discovered_peers ADD COLUMN trust_status TEXT NOT NULL DEFAULT 'unknown';",
        )?;
        tracing::info!("Added trust_status column to discovered_peers");
    }

    // -- Adoption audit log table -------------------------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS adoption_log (
            id                TEXT PRIMARY KEY,
            template_name     TEXT NOT NULL,
            source_review_id  TEXT,
            persona_id        TEXT,
            adopted_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_adoption_log_template ON adoption_log(template_name);
        CREATE INDEX IF NOT EXISTS idx_adoption_log_adopted  ON adoption_log(adopted_at DESC);",
    )?;

    // Composite indexes for lab result queries:
    // Results tables: (run_id, scenario_name, model_id) for ORDER BY scenario_name, model_id
    // Runs tables: (persona_id, created_at DESC) for ORDER BY created_at DESC
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_lab_arena_results_composite ON lab_arena_results(run_id, scenario_name, model_id);
         CREATE INDEX IF NOT EXISTS idx_lab_ab_results_composite ON lab_ab_results(run_id, scenario_name, model_id);
         CREATE INDEX IF NOT EXISTS idx_lab_matrix_results_composite ON lab_matrix_results(run_id, variant, scenario_name, model_id);
         CREATE INDEX IF NOT EXISTS idx_lab_eval_results_composite ON lab_eval_results(run_id, scenario_name, model_id, version_number);
         CREATE INDEX IF NOT EXISTS idx_lab_arena_runs_persona_created ON lab_arena_runs(persona_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_lab_ab_runs_persona_created ON lab_ab_runs(persona_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_lab_matrix_runs_persona_created ON lab_matrix_runs(persona_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_lab_eval_runs_persona_created ON lab_eval_runs(persona_id, created_at DESC);"
    )?;

    // Add rationale and suggestions columns to all lab result tables (LLM-based evaluation)
    let has_arena_rationale: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('lab_arena_results') WHERE name = 'rationale'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_arena_rationale {
        ddl_step(
                    conn,
                            "ALTER TABLE lab_arena_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_arena_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_ab_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_ab_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_matrix_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_matrix_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_eval_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_eval_results ADD COLUMN suggestions TEXT;",
        )?;
        tracing::info!("Added rationale and suggestions columns to all lab result tables");
    }

    // Add workflow import context columns to build_sessions (Phase 2: matrix import)
    let has_workflow_json: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('build_sessions') WHERE name = 'workflow_json'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_workflow_json {
        ddl_step(
                    conn,
                            "ALTER TABLE build_sessions ADD COLUMN workflow_json TEXT;
             ALTER TABLE build_sessions ADD COLUMN parser_result_json TEXT;",
        )?;
        tracing::info!("Added workflow_json and parser_result_json columns to build_sessions");
    }

    // -- Frontend crash telemetry table (persists React ErrorBoundary crashes to SQLite) --
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS frontend_crashes (
            id              TEXT PRIMARY KEY,
            component       TEXT NOT NULL,
            message         TEXT NOT NULL,
            stack           TEXT,
            component_stack TEXT,
            app_version     TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fc_created ON frontend_crashes(created_at DESC);",
    )?;

    // -- OAuth token lifetime metrics (tracks predicted vs actual token expiry) --
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS oauth_token_metrics (
            id                      TEXT PRIMARY KEY,
            credential_id           TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
            service_type            TEXT NOT NULL,
            predicted_lifetime_secs INTEGER,
            actual_lifetime_secs    INTEGER,
            drift_secs              INTEGER,
            used_fallback           INTEGER NOT NULL DEFAULT 0,
            success                 INTEGER NOT NULL DEFAULT 1,
            error_message           TEXT,
            created_at              TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_otm_credential ON oauth_token_metrics(credential_id);
        CREATE INDEX IF NOT EXISTS idx_otm_created    ON oauth_token_metrics(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_otm_service    ON oauth_token_metrics(service_type);"
    )?;

    // -- Output Assertions (declarative output validation) ---------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS output_assertions (
            id              TEXT PRIMARY KEY,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            description     TEXT,
            assertion_type  TEXT NOT NULL,
            config          TEXT NOT NULL DEFAULT '{}',
            severity        TEXT NOT NULL DEFAULT 'warning',
            enabled         INTEGER NOT NULL DEFAULT 1,
            on_failure      TEXT NOT NULL DEFAULT 'log',
            pass_count      INTEGER NOT NULL DEFAULT 0,
            fail_count      INTEGER NOT NULL DEFAULT 0,
            last_evaluated_at TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_oa_persona ON output_assertions(persona_id);
        CREATE INDEX IF NOT EXISTS idx_oa_enabled ON output_assertions(enabled);

        CREATE TABLE IF NOT EXISTS assertion_results (
            id              TEXT PRIMARY KEY,
            assertion_id    TEXT NOT NULL REFERENCES output_assertions(id) ON DELETE CASCADE,
            execution_id    TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            passed          INTEGER NOT NULL,
            explanation     TEXT NOT NULL DEFAULT '',
            matched_value   TEXT,
            evaluation_ms   INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ar_assertion  ON assertion_results(assertion_id);
        CREATE INDEX IF NOT EXISTS idx_ar_execution  ON assertion_results(execution_id);
        CREATE INDEX IF NOT EXISTS idx_ar_persona    ON assertion_results(persona_id);
        CREATE INDEX IF NOT EXISTS idx_ar_created    ON assertion_results(created_at DESC);",
    )?;

    // -- Policy Events (audit trail for generation-policy enforcement) --------
    // Each silent drop / auto-resolve in engine/dispatch.rs writes a row here
    // so users can verify review/memory/event policies fired as declared.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS policy_events (
            id              TEXT PRIMARY KEY,
            execution_id    TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            use_case_id     TEXT,
            policy_kind     TEXT NOT NULL,
            action          TEXT NOT NULL,
            payload_title   TEXT,
            reason          TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Index names are GLOBAL in SQLite, not per-table. `idx_pe_persona` and
        -- `idx_pe_created` already belong to persona_executions (schema.rs:130
        -- and :132), which runs first — so `IF NOT EXISTS` matched the existing
        -- NAME and these two statements were silent no-ops. policy_events had no
        -- index on either column; EXPLAIN QUERY PLAN against the live database
        -- confirmed `SCAN policy_events`. Renamed 2026-08-14.
        --
        -- `has_index(conn, name)` (line 76) cannot detect this class: it matches
        -- on name alone, so it reports an index as present when the name belongs
        -- to a different table. Hardening it to `has_index_on(conn, table, name)`
        -- is an owed follow-up recorded in docs/concepts/golden-paths/index-design.md.
        CREATE INDEX IF NOT EXISTS idx_pe_execution         ON policy_events(execution_id);
        CREATE INDEX IF NOT EXISTS idx_policy_events_persona ON policy_events(persona_id);
        CREATE INDEX IF NOT EXISTS idx_policy_events_created ON policy_events(created_at DESC);",
    )?;

    // -- saved_views: view_type + view_config columns ------
    let has_view_type: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('saved_views') WHERE name = 'view_type'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_view_type {
        ddl_step(
                    conn,
                            "ALTER TABLE saved_views ADD COLUMN view_type TEXT NOT NULL DEFAULT 'analytics';
             ALTER TABLE saved_views ADD COLUMN view_config TEXT;",
        )?;
        tracing::info!("Added view_type, view_config columns to saved_views");
    }

    // Add llm_summary column to all lab run tables (LLM-generated prose summary)
    let has_llm_summary: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('lab_arena_runs') WHERE name = 'llm_summary'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_llm_summary {
        ddl_step(
                    conn,
                            "ALTER TABLE lab_arena_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_ab_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_matrix_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_eval_runs ADD COLUMN llm_summary TEXT;",
        )?;
        tracing::info!("Added llm_summary column to all lab run tables");
    }

    // Add progress_json column to all lab run tables (persisted progress for hydration)
    let has_progress_json: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('lab_arena_runs') WHERE name = 'progress_json'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_progress_json {
        ddl_step(
                    conn,
                            "ALTER TABLE lab_arena_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_ab_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_matrix_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_eval_runs ADD COLUMN progress_json TEXT;",
        )?;
        tracing::info!("Added progress_json column to all lab run tables");
    }

    // -- Full persona versioning (M2) --------------------------------
    // Create persona_versions table (replaces prompt-only versioning)
    let has_persona_versions: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_versions'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_persona_versions {
        ddl_step(
                    conn,
                            "CREATE TABLE persona_versions (
                id TEXT PRIMARY KEY,
                persona_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                system_prompt TEXT NOT NULL,
                structured_prompt TEXT,
                model_profile TEXT,
                max_budget_usd REAL,
                max_turns INTEGER,
                timeout_ms INTEGER NOT NULL DEFAULT 300000,
                design_context TEXT,
                change_summary TEXT,
                tag TEXT NOT NULL DEFAULT 'experimental',
                parent_version_id TEXT,
                created_at TEXT,
                FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_pv_persona ON persona_versions(persona_id);
            CREATE INDEX idx_pv_version ON persona_versions(persona_id, version_number DESC);

            CREATE TABLE persona_version_tools (
                id TEXT PRIMARY KEY,
                version_id TEXT NOT NULL,
                tool_id TEXT NOT NULL,
                tool_config TEXT,
                FOREIGN KEY (version_id) REFERENCES persona_versions(id) ON DELETE CASCADE,
                UNIQUE(version_id, tool_id)
            );
            CREATE INDEX idx_pvt_version ON persona_version_tools(version_id);",
        )?;
        tracing::info!("Created persona_versions and persona_version_tools tables");

        // Migrate existing persona_prompt_versions data
        let has_ppv: bool = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_prompt_versions'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if has_ppv {
            ddl_step(
                    conn,
                                "INSERT OR IGNORE INTO persona_versions (id, persona_id, version_number, name, system_prompt, structured_prompt, change_summary, tag, created_at)
                 SELECT ppv.id, ppv.persona_id, ppv.version_number,
                        COALESCE(p.name, 'Unknown'),
                        COALESCE(ppv.system_prompt, p.system_prompt, ''),
                        ppv.structured_prompt, ppv.change_summary, ppv.tag, ppv.created_at
                 FROM persona_prompt_versions ppv
                 LEFT JOIN personas p ON p.id = ppv.persona_id;"
            )?;
            tracing::info!("Migrated persona_prompt_versions to persona_versions");
        }
    }

    // -- Document Signatures table (Doc-Signing plugin) ------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS document_signatures (
            id                      TEXT PRIMARY KEY,
            file_name               TEXT NOT NULL,
            file_path               TEXT,
            file_hash               TEXT NOT NULL,
            signature_b64           TEXT NOT NULL,
            signer_peer_id          TEXT NOT NULL,
            signer_public_key_b64   TEXT NOT NULL,
            signer_display_name     TEXT NOT NULL,
            metadata                TEXT,
            signed_at               TEXT NOT NULL,
            created_at              TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_doc_sig_peer ON document_signatures(signer_peer_id);
        CREATE INDEX IF NOT EXISTS idx_doc_sig_hash ON document_signatures(file_hash);",
    )?;

    // -- Dev Pipelines (Idea-to-Execution Pipeline) -------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS dev_pipelines (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL,
            idea_id         TEXT NOT NULL,
            task_id         TEXT,
            stage           TEXT NOT NULL DEFAULT 'triaged',
            auto_execute    INTEGER NOT NULL DEFAULT 0,
            verify_after    INTEGER NOT NULL DEFAULT 0,
            verification_scan_id TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pipeline_project ON dev_pipelines(project_id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON dev_pipelines(stage);
        CREATE INDEX IF NOT EXISTS idx_pipeline_idea ON dev_pipelines(idea_id);",
    )?;

    // -- Context Health Snapshots (Codebase Health Scanner) ------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS context_health_snapshots (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL,
            group_id        TEXT,
            group_name      TEXT NOT NULL,
            overall_score   INTEGER NOT NULL DEFAULT 0,
            security_score  INTEGER,
            quality_score   INTEGER,
            coverage_score  INTEGER,
            debt_score      INTEGER,
            issues_found    INTEGER NOT NULL DEFAULT 0,
            issues_json     TEXT,
            recommendations TEXT,
            scanned_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_snap_project ON context_health_snapshots(project_id);
        CREATE INDEX IF NOT EXISTS idx_health_snap_date ON context_health_snapshots(scanned_at);",
    )?;

    // -- Cross-Project Relations (Codebases connector) -----------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS cross_project_relations (
            id                  TEXT PRIMARY KEY,
            source_project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            target_project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            relation_type       TEXT NOT NULL DEFAULT 'shared_dependency',
            details             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(source_project_id, target_project_id, relation_type)
        );
        CREATE INDEX IF NOT EXISTS idx_cross_rel_source ON cross_project_relations(source_project_id);
        CREATE INDEX IF NOT EXISTS idx_cross_rel_target ON cross_project_relations(target_project_id);"
    )?;

    // -- OCR Documents table (OCR plugin) ------------------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS ocr_documents (
            id              TEXT PRIMARY KEY,
            file_name       TEXT NOT NULL,
            file_path       TEXT,
            provider        TEXT NOT NULL,
            model           TEXT,
            extracted_text  TEXT NOT NULL DEFAULT '',
            structured_data TEXT,
            prompt          TEXT,
            duration_ms     INTEGER NOT NULL DEFAULT 0,
            token_count     INTEGER,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ocr_provider ON ocr_documents(provider);
        CREATE INDEX IF NOT EXISTS idx_ocr_created ON ocr_documents(created_at);",
    )?;

    // Add claude_session_id column to chat_session_context for --resume support
    let has_chat_ctx_claude_sid: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('chat_session_context') WHERE name = 'claude_session_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_chat_ctx_claude_sid {
        ddl_step(conn, "ALTER TABLE chat_session_context ADD COLUMN claude_session_id TEXT;")?;
        tracing::info!("Added claude_session_id column to chat_session_context");
    }

    // Add idempotency_key column to persona_executions (dedup timeout-retries)
    let has_idempotency_key: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'idempotency_key'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_idempotency_key {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_executions ADD COLUMN idempotency_key TEXT;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_idempotency ON persona_executions(idempotency_key) WHERE idempotency_key IS NOT NULL;"
        )?;
        tracing::info!("Added idempotency_key column to persona_executions");
    }

    // -- Index source_type on persona_events for filtered search ----------
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_pev_source_type ON persona_events(source_type);",
    )?;

    // Add free parameters column to personas (adjustable without rebuild)
    let has_parameters: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'parameters'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_parameters {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN parameters TEXT;")?;
        tracing::info!("Added parameters column to personas");
    }

    // -- Add status TEXT column to persona_triggers ----------------------------
    // Replaces the lossy `enabled INTEGER` → TriggerStatus bridge with a column
    // that stores all four states (active, paused, errored, disabled).
    let has_trigger_status: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'status'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_status {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_triggers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
        )?;
        // Backfill: enabled=1 → 'active', enabled=0 → 'disabled'
        ddl_step(
                    conn,
                            "UPDATE persona_triggers SET status = CASE WHEN enabled = 1 THEN 'active' ELSE 'disabled' END;"
        )?;
        ddl_step(
                    conn,
                            "CREATE INDEX IF NOT EXISTS idx_ptr_status ON persona_triggers(status);",
        )?;
        tracing::info!("Added status column to persona_triggers and backfilled from enabled");
    }

    // -- Tiered memory lifecycle columns --------------------------------------
    // Adds tier (core/active/archive), access tracking, and last_accessed_at
    // to support smart memory injection with decay and promotion logic.
    let has_memory_tier: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_memories') WHERE name = 'tier'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_memory_tier {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'active';",
        )?;
        ddl_step(
                    conn,
                            "ALTER TABLE persona_memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;",
        )?;
        ddl_step(conn, "ALTER TABLE persona_memories ADD COLUMN last_accessed_at TEXT;")?;
        // Composite index for the tiered injection query
        ddl_step(
                    conn,
                            "CREATE INDEX IF NOT EXISTS idx_pm_tier_injection
             ON persona_memories(persona_id, tier, importance DESC);",
        )?;
        // Backfill: promote high-importance memories (≥8) that already exist to core
        ddl_step(conn, "UPDATE persona_memories SET tier = 'core' WHERE importance >= 8;")?;
        tracing::info!("Added tier, access_count, last_accessed_at columns to persona_memories");
    }

    // Add warnings column to automation_runs for surfacing auth fallbacks & method defaults.
    //
    // Guarded, not `let _ =`. Discarding the Result absorbed the "duplicate
    // column name" this step expects on re-run — but it absorbed EVERY other
    // error with it, so a genuinely failed write was indistinguishable from a
    // no-op. `has_column` makes the duplicate impossible, which means anything
    // that still errors here is real and propagates. (`automation_runs` comes
    // from the base SCHEMA, so the table is always present at this point.)
    if !has_column(conn, "automation_runs", "warnings")? {
        ddl_step(conn, "ALTER TABLE automation_runs ADD COLUMN warnings TEXT;")?;
    }

    // Migrate legacy string-matched interrupted sessions to first-class 'interrupted' status.
    let migrated = conn
        .execute(
            "UPDATE n8n_transform_sessions
         SET status = 'interrupted', error = NULL
         WHERE status = 'failed' AND error LIKE '%App closed during transform%'",
            [],
        )
        .unwrap_or(0);
    if migrated > 0 {
        tracing::info!(
            "Migrated {migrated} interrupted n8n sessions from failed+string to interrupted status"
        );
    }

    // Cloud webhook relay watermark table
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS cloud_webhook_watermarks (
            trigger_id      TEXT PRIMARY KEY,
            last_seen_ts    TEXT NOT NULL,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Widen chat_messages role CHECK to include 'system' and 'tool' ----------
    // Detect support by PARSING the stored DDL (mirroring the persona_triggers /
    // persona_executions migrations in this file), NEVER by a live INSERT probe.
    // chat_messages has `persona_id NOT NULL REFERENCES personas(id)` and the
    // pool runs with `PRAGMA foreign_keys = ON`, so a probe row with a fake
    // persona ALWAYS fails on the FK -- never on the role CHECK -- which made the
    // old INSERT-probe a permanent false-positive that rebuilt the whole table
    // (an O(n) copy of all chat history) on every single launch.
    let chat_messages_sql: String = conn
        .prepare("SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='chat_messages'")?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    // Only rebuild when the table genuinely exists but its stored CHECK lacks
    // the widened role set. A fresh DB already carries
    // CHECK(role IN ('user','assistant','system','tool')) -> no-op. An absent
    // table (empty DDL) must NOT trigger a rebuild of a non-existent table.
    let needs_role_migration = !chat_messages_sql.is_empty()
        && !(chat_messages_sql.contains("'system'") && chat_messages_sql.contains("'tool'"));

    if needs_role_migration {
        ddl_step(
                    conn,
                            "DROP TABLE IF EXISTS chat_messages_new;
            CREATE TABLE chat_messages_new (
                id              TEXT PRIMARY KEY,
                persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                session_id      TEXT NOT NULL,
                role            TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
                content         TEXT NOT NULL,
                execution_id    TEXT,
                metadata        TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO chat_messages_new SELECT * FROM chat_messages;
            DROP TABLE chat_messages;
            ALTER TABLE chat_messages_new RENAME TO chat_messages;
            CREATE INDEX IF NOT EXISTS idx_chat_persona   ON chat_messages(persona_id);
            CREATE INDEX IF NOT EXISTS idx_chat_session   ON chat_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_chat_created   ON chat_messages(created_at);",
        )?;
        tracing::info!("Widened chat_messages role CHECK to include system and tool");
    }

    // Circuit breaker persistence table (survive restarts, 15-min TTL)
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS circuit_breaker_state (
            provider              TEXT PRIMARY KEY,
            consecutive_failures  INTEGER NOT NULL DEFAULT 0,
            is_open               INTEGER NOT NULL DEFAULT 0,
            opened_at             TEXT,
            updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Add trigger_version column for race-safe CAS on mark_triggered ----------
    // Replaces value-based CAS (WHERE next_trigger_at IS ?old) with a monotonic
    // version counter.  Two concurrent ticks reading the same version will race on
    // the UPDATE, but only the first to increment wins; the second touches 0 rows.
    let has_trigger_version: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'trigger_version'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_version {
        ddl_step(
                    conn,
                            "ALTER TABLE persona_triggers ADD COLUMN trigger_version INTEGER NOT NULL DEFAULT 0;",
        )?;
        tracing::info!("Added trigger_version column to persona_triggers for CAS safety");
    }

    // -- Add unattended_mode column for the destructive-action gate (UAT P5) ------
    // Controls what happens when this trigger fires UNATTENDED (schedule/event):
    //   'auto'     — fire normally (default; preserves all existing behavior)
    //   'dry_run'  — fire, but the launched run is_simulation (outbound suppressed)
    //   'approval' — hold the launch for human approval before it runs
    let has_unattended_mode: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'unattended_mode'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_unattended_mode {
        ddl_step(
            conn,
            "ALTER TABLE persona_triggers ADD COLUMN unattended_mode TEXT NOT NULL DEFAULT 'auto';",
        )?;
        tracing::info!("Added unattended_mode column to persona_triggers (UAT P5 destructive-action gate)");
    }

    // -- Pending trigger fires (the 'approval' unattended-mode hold, UAT P5) ------
    // When a scheduler-fired trigger is in `approval` mode, its fire is HELD here
    // instead of publishing the event; a human approves/rejects, and on approval
    // the captured event is published (the normal flow then creates the run).
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS pending_trigger_fires (
            id              TEXT PRIMARY KEY,
            trigger_id      TEXT NOT NULL REFERENCES persona_triggers(id) ON DELETE CASCADE,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            event_type      TEXT NOT NULL,
            payload         TEXT,
            use_case_id     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'approved', 'rejected')),
            created_at      TEXT NOT NULL,
            resolved_at     TEXT
        );",
    )?;
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_ptf_status ON pending_trigger_fires(status);",
    )?;

    // -- Composite indexes for memory & chat hot-path queries --------------------
    // These are idempotent (IF NOT EXISTS) and cover the top query patterns that
    // degrade to full table scans as data grows.
    ddl_step(
                    conn,
                        // chat_messages: get_session_messages + list_sessions
        // WHERE persona_id = ? AND session_id = ? ORDER BY created_at DESC
        "CREATE INDEX IF NOT EXISTS idx_chat_persona_session_created
         ON chat_messages(persona_id, session_id, created_at DESC);

         -- persona_memories: get_by_persona
         -- WHERE persona_id = ? ORDER BY importance DESC, created_at DESC
         CREATE INDEX IF NOT EXISTS idx_pm_persona_importance_created
         ON persona_memories(persona_id, importance DESC, created_at DESC);

         -- persona_memories: run_lifecycle
         -- WHERE persona_id = ? AND tier = 'working' AND access_count ...
         CREATE INDEX IF NOT EXISTS idx_pm_persona_tier_access
         ON persona_memories(persona_id, tier, access_count, created_at);

         -- persona_memories: get_all filtered by persona_id + category
         CREATE INDEX IF NOT EXISTS idx_pm_persona_category
         ON persona_memories(persona_id, category);

         -- chat_session_context: get_latest_session
         -- WHERE persona_id = ? ORDER BY updated_at DESC LIMIT 1
         CREATE INDEX IF NOT EXISTS idx_chat_ctx_persona_updated
         ON chat_session_context(persona_id, updated_at DESC);",
    )?;
    tracing::info!("Ensured composite indexes for memory & chat hot-path queries");

    // -- Composite indexes for automation_runs hot-path queries -------------------
    // The single-column idx_automation_runs_automation cannot satisfy ORDER BY
    // started_at DESC without a filesort; a composite index eliminates that.
    // The (status, started_at) index lets reap_stale_runs avoid a full table scan.
    ddl_step(
                    conn,
                        // get_runs_by_automation: WHERE automation_id = ? ORDER BY started_at DESC
        "CREATE INDEX IF NOT EXISTS idx_automation_runs_auto_started
         ON automation_runs(automation_id, started_at DESC);

         -- reap_stale_runs: WHERE status = 'running' AND julianday(started_at) ...
         CREATE INDEX IF NOT EXISTS idx_automation_runs_status_started
         ON automation_runs(status, started_at);",
    )?;
    tracing::info!("Ensured composite indexes for automation_runs hot-path queries");

    // -- Composite indexes for team_memories and pipeline_runs hot-path queries ----
    // team_memories: get_by_team, get_for_injection, evict_excess all filter by
    // team_id and sort by importance DESC, created_at DESC/ASC. A composite index
    // lets SQLite satisfy the WHERE + ORDER BY without a filesort.
    // pipeline_runs: has_running_pipeline filters (team_id, status); list_pipeline_runs
    // filters team_id and sorts by started_at DESC.
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_tm_team_importance_created
         ON team_memories(team_id, importance DESC, created_at DESC);

         CREATE INDEX IF NOT EXISTS idx_pr_team_status
         ON pipeline_runs(team_id, status);

         CREATE INDEX IF NOT EXISTS idx_pr_team_started
         ON pipeline_runs(team_id, started_at DESC);",
    )?;
    tracing::info!(
        "Ensured composite indexes for team_memories and pipeline_runs hot-path queries"
    );

    // team_memories: get_all, get_total_count filter (team_id, run_id); evict_excess
    // filters (team_id, run_id IS NOT NULL). A composite index lets SQLite satisfy
    // these without scanning the full table and then post-filtering by run_id.
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_tm_team_run
         ON team_memories(team_id, run_id);",
    )?;
    tracing::info!("Ensured composite index idx_tm_team_run on team_memories");

    // Add composite index for trigger_id + created_at on persona_executions
    // Covers get_by_trigger_id query: WHERE trigger_id = ? ORDER BY created_at DESC
    ddl_step(
                    conn,
                        "CREATE INDEX IF NOT EXISTS idx_pe_trigger_created
         ON persona_executions(trigger_id, created_at DESC);",
    )?;
    tracing::info!("Ensured composite index idx_pe_trigger_created on persona_executions");

    // Phase 17: template_category column on personas for tier-3 illustration resolution.
    // Populated by template adoption flows via `infer_template_category`. Null for
    // manually-created personas and pre-existing rows — resolver falls through to hash tier.
    let has_template_category: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'template_category'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_template_category {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN template_category TEXT;")?;
        tracing::info!("Added template_category column to personas");
    }

    // mutation_strategy column on evolution_policies — selects between the
    // existing mechanical mutator (shuffle/drop/duplicate prompt segments,
    // permute tools, jiggle timeout) and an LLM-critique-and-rewrite mutator
    // that uses recent low-fitness traces as the gradient signal. NULL means
    // "mechanical" (the legacy default), so existing rows stay on the proven
    // path until a user opts into the new strategy.
    let has_mutation_strategy: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('evolution_policies') WHERE name = 'mutation_strategy'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_mutation_strategy {
        ddl_step(conn, "ALTER TABLE evolution_policies ADD COLUMN mutation_strategy TEXT;")?;
        tracing::info!("Added mutation_strategy column to evolution_policies");
    }

    // last_heartbeat_at column on persona_executions — written by the runner
    // every 30s alongside the EXECUTION_HEARTBEAT event so a supervisor scan
    // can detect long-silent runs. Today, stuck CLI subprocesses are caught
    // only by hard timeout_ms kill; this column lets a passive watchdog emit
    // a stale-execution signal earlier without changing the canonical status
    // lifecycle.
    let has_last_heartbeat_at: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'last_heartbeat_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_last_heartbeat_at {
        ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN last_heartbeat_at TEXT;")?;
        tracing::info!("Added last_heartbeat_at column to persona_executions");
    }

    // -- audit_incidents: cross-source promoted incidents ------------------
    // See `src/features/overview/sub_incidents/DESIGN.md` for the rollout
    // plan and the per-source promotion rules. Stores rows promoted from
    // 7 existing audit-shaped tables under a single triage lifecycle
    // (open → acknowledged → resolved | dismissed). The dedup_key is
    // `{source_table}:{source_id}` and is UNIQUE so concurrent inserts are
    // idempotent under SQLite WAL.
    let has_audit_incidents: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='audit_incidents'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_audit_incidents {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS audit_incidents (
                id              TEXT PRIMARY KEY,
                source_table    TEXT NOT NULL,
                source_id       TEXT NOT NULL,
                dedup_key       TEXT NOT NULL UNIQUE,
                persona_id      TEXT,
                persona_name    TEXT,
                execution_id    TEXT,
                severity        TEXT NOT NULL,
                kind            TEXT NOT NULL,
                title           TEXT NOT NULL,
                detail          TEXT,
                status          TEXT NOT NULL DEFAULT 'open',
                acknowledged_at TEXT,
                acknowledged_by TEXT,
                resolved_at     TEXT,
                resolution_note TEXT,
                continued_at    TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_ai_status   ON audit_incidents(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_ai_persona  ON audit_incidents(persona_id, status);
            CREATE INDEX IF NOT EXISTS idx_ai_severity ON audit_incidents(severity, status);
            CREATE INDEX IF NOT EXISTS idx_ai_source   ON audit_incidents(source_table, source_id);"
        )?;
        tracing::info!("Created audit_incidents table (cross-source incidents inbox)");
    }

    // -- mode + companion_session_id columns on build_sessions ---------------
    // `mode` selects between 'interactive' (the legacy ask-the-user gate flow)
    // and 'one_shot' (autonomous build: LLM resolves every gate, retries up to
    // 3× on test failure, auto-promotes on success). Default NULL is treated
    // as 'interactive' at read time so existing rows stay on the proven path.
    //
    // `companion_session_id` links a build_session back to the Companion chat
    // session that originated it (when applicable) so the BuildWatcher job
    // can post a result message into that session's episode log on terminal
    // phase. NULL when the session was started from the regular UI.
    if !has_column(conn, "build_sessions", "mode")? {
        ddl_step(conn, "ALTER TABLE build_sessions ADD COLUMN mode TEXT;")?;
        tracing::info!("Added mode column to build_sessions");
    }
    if !has_column(conn, "build_sessions", "companion_session_id")? {
        ddl_step(conn, "ALTER TABLE build_sessions ADD COLUMN companion_session_id TEXT;")?;
        tracing::info!("Added companion_session_id column to build_sessions");
    }

    // 2026-05-09 — Stage B Phase 1a: Recipe provenance for template-derived
    // recipes. Allows linking a recipe back to the (template, use_case_id) it
    // was derived from, so re-imports stay idempotent (Stage B Phase 1b's
    // derive_recipes_from_template can detect existing rows and update vs
    // create) and downstream UX can surface "newer version available" badges
    // when a template author bumps a recipe.
    //
    // All four columns are nullable: existing recipes (none of which are
    // template-derived today) keep NULL provenance and behave unchanged.
    // The unique index is partial — only enforced when source_template_id is
    // NOT NULL — so user-authored recipes with NULL provenance don't collide.
    if !has_column(conn, "recipe_definitions", "source_template_id")? {
        ddl_step(
                    conn,
                            "ALTER TABLE recipe_definitions ADD COLUMN source_template_id TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_use_case_id TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_use_case_name TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_version TEXT;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_definitions_source
               ON recipe_definitions(source_template_id, source_use_case_id)
               WHERE source_template_id IS NOT NULL;",
        )?;
        tracing::info!(
            "Added provenance columns (source_template_id, source_use_case_id, source_use_case_name, source_version) + unique index to recipe_definitions"
        );
    }

    // 2026-05-09 — Stage D Phase 4: telemetry for the Glyph composer's recipe
    // suggestion chip. Append-only events log impression/accept/dismiss with
    // the match score for later eligibility analysis (Phase 5 mode-2 gate).
    // No FK to recipe_definitions — recipe deletes shouldn't cascade-delete
    // this audit trail. Index keyed on created_at DESC because every read is
    // a "last N events" query.
    if !has_table(conn, "recipe_suggestion_events")? {
        ddl_step(
                    conn,
                            "CREATE TABLE recipe_suggestion_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('impression','accept','dismiss')),
                score REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_recipe_suggestion_events_created_at
               ON recipe_suggestion_events(created_at DESC);",
        )?;
        tracing::info!("Created recipe_suggestion_events table + idx_recipe_suggestion_events_created_at");
    }

    // Memory curation review proposals — concept borrowed from Anthropic
    // Managed Agents' dream pipeline (immutable input, separate output
    // store, review-and-discard). Personas's `review_memories_with_cli`
    // can write a proposal here instead of mutating directly; the user
    // explicitly applies or discards the proposal in a second step.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal",
            description: "Create persona_memory_review_proposal table for review-and-discard memory curation",
            already_applied: |conn| has_table(conn, "persona_memory_review_proposal"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS persona_memory_review_proposal (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT,
                        threshold       INTEGER NOT NULL,
                        instructions    TEXT,
                        proposal_json   TEXT NOT NULL,
                        summary         TEXT,
                        reviewed_count  INTEGER NOT NULL DEFAULT 0,
                        proposed_changes INTEGER NOT NULL DEFAULT 0,
                        status          TEXT NOT NULL DEFAULT 'pending_review',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        decided_at      TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_memory_review_proposal_status
                        ON persona_memory_review_proposal(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_persona_memory_review_proposal_persona
                        ON persona_memory_review_proposal(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // NOTE: this step MUST live in run_incremental AFTER the table-creating
    // step above — the file's tail belongs to `ensure_composite_fires_table`,
    // which initial::run calls BEFORE run_incremental (an ALTER placed there
    // fails on fresh databases with "no such table").
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal.team_id",
            description: "Team-scoped reflection proposals: NULL for persona proposals; set when a reflection pass consolidated memories across a team's members",
            already_applied: |conn| has_column(conn, "persona_memory_review_proposal", "team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memory_review_proposal ADD COLUMN team_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // User-persona background-job table — projects the dream-job shape
    // (queued → running → completed | failed | canceled) onto the
    // user-personas side, mirroring `companion_background_job` for the
    // companion side. Worker lives in `engine::persona_jobs`. v1 ships
    // one kind: `memory_curation_run`.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_background_job",
            description: "Create persona_background_job table for async memory curation runs",
            already_applied: |conn| has_table(conn, "persona_background_job"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS persona_background_job (
                        id                TEXT PRIMARY KEY,
                        kind              TEXT NOT NULL,
                        status            TEXT NOT NULL DEFAULT 'queued',
                        params_json       TEXT NOT NULL DEFAULT '{}',
                        persona_id        TEXT,
                        result_text       TEXT,
                        error_text        TEXT,
                        cancel_requested  INTEGER NOT NULL DEFAULT 0,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                        started_at        TEXT,
                        completed_at      TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_background_job_status
                        ON persona_background_job(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_persona_background_job_persona
                        ON persona_background_job(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona curation schedule — F-CRON. Drives nightly memory
    // curation runs via `engine::curation_scheduler::tick`. One row
    // per persona at most. cron_expr is a 5-field cron expression
    // validated against `engine::cron::parse_cron` at the IPC
    // boundary. NULL `last_curation_at` = never run yet (scheduler
    // uses created_at as the reference point on first fire).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_curation_schedule",
            description: "Create persona_curation_schedule table for scheduled memory curation",
            already_applied: |conn| has_table(conn, "persona_curation_schedule"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS persona_curation_schedule (
                        persona_id        TEXT PRIMARY KEY
                                          REFERENCES personas(id) ON DELETE CASCADE,
                        cron_expr         TEXT NOT NULL,
                        last_curation_at  TEXT,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Smee relay origin allowlist. JSON-encoded array of `owner/repo` strings.
    // When populated, the SSE relay drops events whose body.repository.full_name
    // is not in the list. NULL = back-compat (accept any repo, log warning).
    run_step(
        conn,
        IncrementalMigration {
            id: "smee_relays_allowed_repos",
            description: "Add allowed_repos column to smee_relays for origin authentication",
            already_applied: |conn| has_column(conn, "smee_relays", "allowed_repos"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE smee_relays ADD COLUMN allowed_repos TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Per-execution business outcome tracking. The existing `status` column
    // ('completed', 'failed', …) only captures whether the CLI subprocess
    // ran cleanly; many "completed" runs in fact produce no business value
    // ("no input provided", "no connector wired", "readiness report only").
    // `business_outcome` is the LLM's self-assessment of whether the run
    // actually delivered the persona's promised job. Emitted by the persona
    // via `<business_outcome>{value_delivered|no_input_available|
    // precondition_failed|partial}</business_outcome>` and parsed by the
    // runner. Default `unknown` for back-compat with rows that pre-date this
    // column.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_business_outcome",
            description: "Add business_outcome column to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "business_outcome"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "ALTER TABLE persona_executions ADD COLUMN business_outcome TEXT NOT NULL DEFAULT 'unknown';
                     CREATE INDEX IF NOT EXISTS idx_pe_persona_outcome
                         ON persona_executions(persona_id, business_outcome);",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona setup status. The adoption pre-flight (C1) writes
    // `needs_credentials` when the persona declares connectors that have no
    // vault credential bound; the persona-detail view surfaces this via a
    // "Setup required" badge and the scheduler refuses to auto-execute until
    // the user resolves it. Default `ready` for back-compat.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_setup_status",
            description: "Add setup_status column to personas",
            already_applied: |conn| has_column(conn, "personas", "setup_status"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "ALTER TABLE personas ADD COLUMN setup_status TEXT NOT NULL DEFAULT 'ready';
                     CREATE INDEX IF NOT EXISTS idx_personas_setup_status
                         ON personas(setup_status);",
                )?;
                Ok(())
            },
        },
    )?;

    // Execution annotations: free-form tags, a note, and a star per execution.
    // One row per (execution_id, author) so a single human user (the default
    // 'user' author) overwrites their own annotation on re-save instead of
    // accumulating duplicates. Mirrors LangSmith trace annotations.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_execution_annotations",
            description: "Add persona_execution_annotations table",
            already_applied: |conn| has_table(conn, "persona_execution_annotations"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS persona_execution_annotations (
                        id           TEXT PRIMARY KEY,
                        execution_id TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
                        persona_id   TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        author       TEXT NOT NULL DEFAULT 'user',
                        tags         TEXT,
                        note         TEXT,
                        starred      INTEGER NOT NULL DEFAULT 0,
                        created_at   TEXT NOT NULL,
                        updated_at   TEXT NOT NULL,
                        UNIQUE(execution_id, author)
                    );
                    CREATE INDEX IF NOT EXISTS idx_pea_execution ON persona_execution_annotations(execution_id);
                    CREATE INDEX IF NOT EXISTS idx_pea_persona   ON persona_execution_annotations(persona_id);
                    CREATE INDEX IF NOT EXISTS idx_pea_starred   ON persona_execution_annotations(persona_id, starred);",
                )?;
                Ok(())
            },
        },
    )?;

    // Outbound webhook notification subscriptions. Routes persona_events to
    // Slack/Discord/Teams/generic JSON webhooks via Mustache-style templates.
    // See `src-tauri/src/notifications/` for the dispatcher worker.
    run_step(
        conn,
        IncrementalMigration {
            id: "notification_subscriptions",
            description: "Create notification_subscriptions table for outbound webhook routing",
            already_applied: |conn| has_table(conn, "notification_subscriptions"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS notification_subscriptions (
                        id                   TEXT PRIMARY KEY,
                        label                TEXT NOT NULL,
                        provider             TEXT NOT NULL,
                        webhook_url          TEXT,
                        credential_id        TEXT REFERENCES persona_credentials(id) ON DELETE SET NULL,
                        event_types          TEXT NOT NULL,
                        template_body        TEXT,
                        enabled              INTEGER NOT NULL DEFAULT 1,
                        last_delivery_at     TEXT,
                        last_delivery_status TEXT,
                        last_error           TEXT,
                        created_at           TEXT NOT NULL,
                        updated_at           TEXT NOT NULL
                    );
                     CREATE INDEX IF NOT EXISTS idx_notif_subs_enabled
                         ON notification_subscriptions(enabled);
                     CREATE TABLE IF NOT EXISTS notification_dispatch_watermark (
                        id              INTEGER PRIMARY KEY CHECK (id = 1),
                        last_event_at   TEXT NOT NULL,
                        updated_at      TEXT NOT NULL
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin reflections — operator-audit journals. Each row is a prose summary
    // ("what's the relationship with Alice been about?") generated by Claude
    // from the twin's profile + recent communications. Stage 1 ships the
    // table + manual "Reflect" UI; future stages add scheduled reflections
    // and per-contact scoping. See docs/features/twin.md (Cycle 15).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_reflections",
            description: "Create twin_reflections table for operator-audit journals",
            already_applied: |conn| has_table(conn, "twin_reflections"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS twin_reflections (
                        id          TEXT PRIMARY KEY,
                        twin_id     TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        prompt_seed TEXT NOT NULL,
                        content     TEXT NOT NULL,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_reflections_twin
                         ON twin_reflections(twin_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin contacts — durable per-twin record of every handle the twin has
    // interacted with on any channel. Auto-populated from twin_communications
    // (handles seen via list_contacts_with_activity) + manually editable
    // alias/notes. Stage 1 of the per-contact memory work; Stage 2 will add
    // proactive nudges scoped per (twin_id, contact_handle).
    // See docs/features/twin.md (Cycle 14).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_contacts",
            description: "Create twin_contacts table for per-contact aliases and notes",
            already_applied: |conn| has_table(conn, "twin_contacts"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS twin_contacts (
                        id          TEXT PRIMARY KEY,
                        twin_id     TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        handle      TEXT NOT NULL,
                        alias       TEXT,
                        notes       TEXT,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(twin_id, handle)
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_contacts_twin
                         ON twin_contacts(twin_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- disabled_dims_json on build_sessions + personas ---------------
    // 2026-05-18 — sigil-driven adoption (Phase 4): when the user toggles
    // a petal "off" in the SigilEditModal, that capability's bound
    // questions become inert. The runner skips emitting them; the
    // runtime executor won't surface the dim in any UI summary. Two
    // storage paths because the lifecycle differs:
    //   - build_sessions.disabled_dims_json: in-flight adoption state.
    //     Cleared when the session ends (along with the rest of the
    //     row). The runner reads this to decide whether to emit a
    //     question (`use_case_id` + `dimension` must NOT match any
    //     entry in the disabled map).
    //   - personas.disabled_dims_json: durable per-persona override.
    //     Survives past adoption — a user editing a view-mode persona
    //     can disable a dim on a capability, and that choice persists
    //     to future re-builds + runtime.
    // Shape: JSON object `{ [use_case_id: string]: GlyphDimension[] }`.
    // NULL is treated as "no disabled dims".
    if !has_column(conn, "build_sessions", "disabled_dims_json")? {
        ddl_step(conn, "ALTER TABLE build_sessions ADD COLUMN disabled_dims_json TEXT;")?;
        tracing::info!("Added disabled_dims_json column to build_sessions");
    }
    if !has_column(conn, "personas", "disabled_dims_json")? {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN disabled_dims_json TEXT;")?;
        tracing::info!("Added disabled_dims_json column to personas");
    }

    // Twin pending memories — back-cite the source communication when the
    // memory was queued via `record_interaction`. NULL for legacy rows and
    // for memories created by URL ingest / wiki audit (where no single
    // communication produced them). See docs/features/twin.md (Cycle 13).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_pending_memories_source_communication_id",
            description: "Add source_communication_id column to twin_pending_memories for provenance",
            already_applied: |conn| has_column(conn, "twin_pending_memories", "source_communication_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "ALTER TABLE twin_pending_memories ADD COLUMN source_communication_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin distilled facts — curated, deduplicated facts about the twin or
    // its contacts, with provenance citing source twin_communications rows.
    // Foundation table for the future consolidation + recall pipeline ported
    // from companion::brain. See docs/features/twin.md (Cycle 12).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_distilled_facts",
            description: "Create twin_distilled_facts table for curated, cited facts",
            already_applied: |conn| has_table(conn, "twin_distilled_facts"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS twin_distilled_facts (
                        id              TEXT PRIMARY KEY,
                        twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        contact_handle  TEXT,
                        content         TEXT NOT NULL,
                        importance      INTEGER NOT NULL DEFAULT 3,
                        sources_json    TEXT NOT NULL DEFAULT '[]',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        last_seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_twin
                         ON twin_distilled_facts(twin_id);
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_contact
                         ON twin_distilled_facts(twin_id, contact_handle);
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_importance
                         ON twin_distilled_facts(twin_id, importance DESC, last_seen_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Discord inbound polling — cursor state per (persona, channel) and a log
    // of messages we've fanned out to execute_persona so we can dedupe across
    // restarts and post replies once the run finishes. See
    // `engine/discord_poller.rs` for the loop that consumes these tables.
    run_step(
        conn,
        IncrementalMigration {
            id: "discord_inbound_polling",
            description: "Create discord_poll_state and discord_inbound_messages",
            already_applied: |conn| has_table(conn, "discord_poll_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS discord_poll_state (
                        persona_id      TEXT NOT NULL,
                        channel_id      TEXT NOT NULL,
                        last_message_id TEXT NOT NULL DEFAULT '',
                        last_polled_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, channel_id)
                    );
                     CREATE TABLE IF NOT EXISTS discord_inbound_messages (
                        message_id          TEXT PRIMARY KEY,
                        persona_id          TEXT NOT NULL,
                        channel_id          TEXT NOT NULL,
                        credential_id       TEXT NOT NULL,
                        author_id           TEXT NOT NULL DEFAULT '',
                        execution_id        TEXT,
                        replied_message_id  TEXT,
                        received_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        replied_at          TEXT,
                        error               TEXT
                    );
                     CREATE INDEX IF NOT EXISTS idx_discord_inbound_pending
                         ON discord_inbound_messages(persona_id, channel_id, replied_message_id);
                     CREATE INDEX IF NOT EXISTS idx_discord_inbound_received
                         ON discord_inbound_messages(received_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Slack inbound polling — mirror of the Discord tables above. Cursor
    // state per (persona, channel) keyed by the latest message `ts`, plus a
    // log of messages we've fanned out to execute_persona so we can dedupe
    // across restarts and post threaded replies once the run finishes. See
    // `engine/slack_poller.rs` for the loop that consumes these tables.
    run_step(
        conn,
        IncrementalMigration {
            id: "slack_inbound_polling",
            description: "Create slack_poll_state and slack_inbound_messages",
            already_applied: |conn| has_table(conn, "slack_poll_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS slack_poll_state (
                        persona_id      TEXT NOT NULL,
                        channel_id      TEXT NOT NULL,
                        last_ts         TEXT NOT NULL DEFAULT '',
                        last_polled_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, channel_id)
                    );
                     CREATE TABLE IF NOT EXISTS slack_inbound_messages (
                        message_ts          TEXT NOT NULL,
                        channel_id          TEXT NOT NULL,
                        persona_id          TEXT NOT NULL,
                        credential_id       TEXT NOT NULL,
                        author_id           TEXT NOT NULL DEFAULT '',
                        thread_ts           TEXT NOT NULL DEFAULT '',
                        execution_id        TEXT,
                        replied_message_ts  TEXT,
                        received_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        replied_at          TEXT,
                        error               TEXT,
                        PRIMARY KEY (channel_id, message_ts)
                    );
                     CREATE INDEX IF NOT EXISTS idx_slack_inbound_pending
                         ON slack_inbound_messages(persona_id, channel_id, replied_message_ts);
                     CREATE INDEX IF NOT EXISTS idx_slack_inbound_received
                         ON slack_inbound_messages(received_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Widen persona_executions.status CHECK to include 'incomplete' — a
    // valid ExecutionState terminal variant the original constraint
    // omitted. Must run last: the rebuild copies the table via its own
    // stored DDL, so every prior `ADD COLUMN` migration must already be
    // applied for the new table to carry the full column set.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_incomplete_status",
            description: "Add 'incomplete' to persona_executions.status CHECK constraint",
            already_applied: |conn| {
                let sql: String = conn
                    .query_row(
                        "SELECT COALESCE(sql, '') FROM sqlite_master
                         WHERE type='table' AND name='persona_executions'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or_default();
                // Empty == table not created yet (fresh DB): base schema
                // already carries the widened CHECK, so treat as applied.
                Ok(sql.is_empty() || sql.contains("'incomplete'"))
            },
            apply: rebuild_executions_table_with_incomplete_status,
        },
    )?;

    // Structured setup detail (adoption-honesty redesign). The flat
    // `setup_status` string stays as the coarse execute-gate; this nullable
    // JSON column carries the rich `PersonaSetup` — typed blockers + wired
    // triggers + a human-readable readiness preview — that the UI routes on.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_setup_detail",
            description: "Add setup_detail JSON column to personas",
            already_applied: |conn| has_column(conn, "personas", "setup_detail"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN setup_detail TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Group-scoped shared memory (PersonaGroup productionization, 2026-05-22).
    // Mirrors the use_case_id pattern from Phase C5: nullable column, no FK
    // by design — see MEMORY CONTRACT (5) in db/models/memory.rs. Stage 1
    // ships the schema; Stage 2 will OR-in group_id matches in the injection
    // hot path so memories authored in group context are shared with every
    // group member's prompt.
    // REMOVED 2026-08-15: `persona_memories_group_id`.
    //
    // It added `persona_memories.group_id`, which `retire_persona_groups`
    // (~370 lines below) drops. That step's guard is `|_conn| Ok(false)`, so it
    // runs on EVERY launch — and because this step ran first and put the column
    // back, the pair undid and redid each other forever. Replayed against a copy
    // of the live 331 MB database: 186.1 ms then 181.2 ms per boot, of which
    // 108 ms is SQLite rewriting all 6,535 rows / 37 MB of `persona_memories`,
    // because DROP COLUMN rewrites every row. The residue after two boots is
    // byte-identical to the start.
    //
    // Nothing could have caught it: the idempotency test asserts the fixed
    // point (correctly — the schema IS stable), there is no migrations ledger,
    // and the `tracing::info!` receipt goes to a sink installed after the
    // migrations run.

    // Dev-tools project ↔ PersonaTeam binding (2026-05-22). Lets developers
    // bind a dev_projects row to a PersonaTeam (pipeline) so the project
    // surface in ProjectManagerPage shows the bound pipeline inline. No FK
    // by design — the same orphan-tolerance rationale as use_case_id.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects_team_id",
            description: "Add team_id column to dev_projects for pipeline binding",
            already_applied: |conn| has_column(conn, "dev_projects", "team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN team_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_dev_projects_team_id ON dev_projects(team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Dev-tools project ↔ PersonaGroup binding (2026-05-22). Complementary
    // to team_id: team_id is the execution-time pipeline, group_id is the
    // design-time workspace folder. Both can be set independently. Same
    // orphan-tolerance policy.
    // REMOVED 2026-08-15: `dev_projects_group_id`. Same pair as the note above —
    // it re-added a column `retire_persona_groups` drops on every launch.

    // Groups → Teams consolidation (ADR 2026-05-23-groups-into-teams),
    // Phase 1 — additive only. A PersonaTeam gains a "workspace" facet
    // (shared instructions + new-persona defaults, ported from
    // PersonaGroup), and a persona gains a single nullable home_team_id
    // = the team whose workspace settings + injected memory apply at
    // runtime (resolves the 1:N group vs N:M team cardinality). Injected
    // memory re-anchors via persona_memories.home_team_id. Nothing is
    // migrated or dropped here — the group_id columns stay intact.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams_workspace_fields",
            description: "Add workspace settings (shared_instructions + defaults) to persona_teams",
            already_applied: |conn| has_column(conn, "persona_teams", "shared_instructions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_teams ADD COLUMN shared_instructions TEXT;
                     ALTER TABLE persona_teams ADD COLUMN default_model_profile TEXT;
                     ALTER TABLE persona_teams ADD COLUMN default_max_budget_usd REAL;
                     ALTER TABLE persona_teams ADD COLUMN default_max_turns INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "personas_home_team_id",
            // Guarded on the INDEX, not the column: base schema's CREATE TABLE
            // already defines `home_team_id` for fresh DBs (so a column-guard
            // would skip here and the index would never be created), while
            // legacy DBs lack the column entirely. The base-schema CREATE INDEX
            // line was removed because it ran *before* this ALTER and failed on
            // legacy DBs that pre-date the column; this migration is now the
            // sole creator of the index (and adds the column when missing), so
            // both fresh and legacy DBs converge to column + index.
            description: "Add home_team_id to personas + its index (workspace anchor for the Groups→Teams merge)",
            already_applied: |conn| has_index(conn, "idx_personas_home_team_id"),
            apply: |conn| {
                if !has_column(conn, "personas", "home_team_id")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE personas ADD COLUMN home_team_id TEXT REFERENCES persona_teams(id) ON DELETE SET NULL;",
                    )?;
                }
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_personas_home_team_id ON personas(home_team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories_home_team_id",
            description: "Add home_team_id to persona_memories (injected-memory scope re-anchor)",
            already_applied: |conn| has_column(conn, "persona_memories", "home_team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN home_team_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_persona_memories_home_team_id ON persona_memories(home_team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Cross-device persona continuity, Stage 1 (ADR
    // 2026-05-24-cross-device-persona-continuity). Additive only: a sync-state
    // ledger mirroring `obsidian_sync_state`, content-hash / origin-device
    // columns on personas, and an explicit tombstone table so hard-deletes can
    // propagate across devices instead of resurrecting on the next pull.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_sync_columns",
            description: "Add content_hash + last_modified_device to personas (cross-device sync)",
            already_applied: |conn| has_column(conn, "personas", "content_hash"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN content_hash TEXT;
                     ALTER TABLE personas ADD COLUMN last_modified_device TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_sync_state",
            description: "Per-(persona, remote-device) sync ledger for cross-device continuity",
            already_applied: |conn| has_table(conn, "persona_sync_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_sync_state (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT NOT NULL,
                        remote_device   TEXT NOT NULL,
                        base_hash       TEXT NOT NULL,
                        sync_direction  TEXT,
                        synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(persona_id, remote_device)
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_sync_state_persona
                        ON persona_sync_state(persona_id);
                    CREATE INDEX IF NOT EXISTS idx_persona_sync_state_device
                        ON persona_sync_state(remote_device);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_tombstones",
            description: "Tombstones for deleted personas so deletes propagate across devices",
            already_applied: |conn| has_table(conn, "persona_tombstones"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_tombstones (
                        persona_id   TEXT PRIMARY KEY,
                        deleted_at   TEXT NOT NULL,
                        device_id    TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_tombstones_deleted_at
                        ON persona_tombstones(deleted_at);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Cross-device persona continuity, Stage 2 (same ADR): the
    // device-ownership data model. `local_identity.device_group_id` is the shared
    // anchor that marks a set of peers as "the same user's devices"; the
    // `owned_devices` registry is what a pairing flow (this stage's commands, or
    // the fleet `/friend` QR-pairing UI) writes into. Backend model only — no
    // pairing handshake here.
    run_step(
        conn,
        IncrementalMigration {
            id: "local_identity_device_group_id",
            description: "Add device_group_id to local_identity (cross-device ownership anchor)",
            already_applied: |conn| has_column(conn, "local_identity", "device_group_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE local_identity ADD COLUMN device_group_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "owned_devices",
            description: "Registry of a user's own paired devices for workspace sync",
            already_applied: |conn| has_table(conn, "owned_devices"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS owned_devices (
                        peer_id          TEXT PRIMARY KEY,
                        device_group_id  TEXT NOT NULL,
                        display_name     TEXT NOT NULL,
                        added_at         TEXT NOT NULL,
                        last_synced_at   TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_owned_devices_group
                        ON owned_devices(device_group_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Groups → Teams consolidation, Phase 3 — DATA MIGRATION (guarded,
    // reversible). Each PersonaGroup becomes a connection-less "workspace
    // team" carrying its settings; members get home_team_id + a membership
    // row; injected memories + dev_projects re-point onto the new team.
    //
    // MUST run here at the end of `run_incremental` (phase 2), NOT in
    // `ensure_composite_fires_table` (phase 1) where it originally lived: it
    // reads `persona_groups.shared_instructions` / `persona_teams.shared_instructions`
    // / `personas.home_team_id` / `persona_memories.home_team_id`, all of which
    // are added by earlier `run_incremental` steps. Relocated 2026-05-24 to fix a
    // fresh-DB startup abort ("no such column: g.shared_instructions").
    //
    // Reversibility: the source columns (personas.group_id,
    // persona_memories.group_id, persona_groups table, dev_projects.group_id)
    // are KEPT INTACT — this migration only POPULATES the new home_team_id /
    // membership / team rows. The destructive drop of group_id + persona_groups
    // is a separate, later phase. Every statement is idempotent (guarded by
    // `NOT EXISTS` / `home_team_id IS NULL`), so a re-run is a no-op.
    //
    // Workspace-team id is deterministic: 'wsteam-' || group.id, so the
    // mapping is stable across re-runs without a side table.
    run_step(
        conn,
        IncrementalMigration {
            id: "groups_to_teams_data_migration",
            description: "Migrate PersonaGroups into workspace PersonaTeams (home_team_id + membership + memory re-anchor)",
            // No clean boolean marker (zero groups = legitimate no-op), so
            // rely on run_step's id-tracking to run once; the SQL is
            // idempotent regardless.
            already_applied: |_conn| Ok(false),
            apply: |conn| {
                // Fresh DBs (post-Phase-5 schema) never create `persona_groups`
                // or `personas.group_id`, so this whole data migration is a
                // no-op there — guard on the table's existence to avoid a
                // "no such table" panic. Existing DBs still have both at this
                // point in the sequence (the drop migration runs LAST).
                let groups_table_exists: i64 = conn
                    .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_groups'")?
                    .query_row([], |row| row.get(0))?;
                if groups_table_exists == 0 {
                    return Ok(());
                }
                ddl_step(
                    conn,
                    "
                    -- 1. group → workspace team (carry settings; disabled so it
                    --    doesn't appear as a runnable pipeline until the user
                    --    opts in — workspace teams have no connections).
                    INSERT INTO persona_teams
                        (id, name, color, enabled, shared_instructions,
                         default_model_profile, default_max_budget_usd,
                         default_max_turns, created_at, updated_at)
                    SELECT 'wsteam-' || g.id, g.name, g.color, 1,
                           g.shared_instructions, g.default_model_profile,
                           g.default_max_budget_usd, g.default_max_turns,
                           g.created_at, g.updated_at
                    FROM persona_groups g
                    WHERE NOT EXISTS (
                        SELECT 1 FROM persona_teams t WHERE t.id = 'wsteam-' || g.id
                    );

                    -- 2. personas: set home_team_id from their group.
                    UPDATE personas
                    SET home_team_id = 'wsteam-' || group_id
                    WHERE group_id IS NOT NULL AND home_team_id IS NULL;

                    -- 3. membership row per grouped persona (idempotent).
                    INSERT INTO persona_team_members
                        (id, team_id, persona_id, role, position_x, position_y, created_at)
                    SELECT lower(hex(randomblob(16))), 'wsteam-' || p.group_id,
                           p.id, 'worker', 0, 0, datetime('now')
                    FROM personas p
                    WHERE p.group_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM persona_team_members m
                        WHERE m.team_id = 'wsteam-' || p.group_id AND m.persona_id = p.id
                    );

                    -- 4. injected memories re-anchor onto the workspace team.
                    UPDATE persona_memories
                    SET home_team_id = 'wsteam-' || group_id
                    WHERE group_id IS NOT NULL AND home_team_id IS NULL;
                    ",
                )?;
                // 5. dev_projects: re-point the group binding to the team
                //    binding, but only when dev_projects actually has both
                //    columns (group_id was added late; team_id earlier).
                if has_column(conn, "dev_projects", "group_id")?
                    && has_column(conn, "dev_projects", "team_id")?
                {
                    ddl_step(
                        conn,
                        "UPDATE dev_projects
                         SET team_id = 'wsteam-' || group_id
                         WHERE group_id IS NOT NULL AND team_id IS NULL;",
                    )?;
                }
                Ok(())
            },
        },
    )?;

    // Groups→Teams Phase 5 — retire the PersonaGroup primitive. Runs AFTER
    // `groups_to_teams_data_migration` has re-anchored every group onto a
    // workspace team (home_team_id + membership + memory). Destructive +
    // irreversible: drops the `persona_groups` table and the orphan-tolerant
    // `group_id` columns on `persona_memories` and `dev_projects`.
    //
    // `personas.group_id` is deliberately NOT dropped: it carries an inline
    // `REFERENCES persona_groups(id)` FK, and SQLite's `ALTER TABLE DROP
    // COLUMN` refuses a FK-constrained column without a full rebuild of the
    // central `personas` table — too risky on a live DB for a column that is
    // now dead (no Rust struct field, no read, no write) and forced to NULL
    // below. It is invisible to all code; the concept is fully retired.
    // ADR: 2026-05-23-groups-into-teams (Phase 5).
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_persona_groups",
            description: "Drop persona_groups table + persona_memories/dev_projects group_id columns (Groups→Teams Phase 5)",
            // Was `|_conn| Ok(false)` — always-run. Combined with the two
            // additive steps above (now deleted) that made this a permanent
            // drop/re-add cycle costing ~186 ms and two full table rewrites per
            // launch, forever.
            //
            // The always-run guard was not unreasonable on its own: the drops
            // below are individually guarded and tolerate failure, so re-running
            // was harmless in isolation. The defect was a relationship between
            // steps 370 lines apart, which no per-step instrument can see.
            //
            // This is a POSTCONDITION guard: it asserts the state the step
            // exists to reach, rather than claiming a step id was recorded
            // (there is no ledger to record it in). Fresh installs never create
            // these objects, so it short-circuits there too.
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_groups")?
                    && !has_column(conn, "persona_memories", "group_id")?
                    && !has_column(conn, "dev_projects", "group_id")?)
            },
            apply: |conn| {
                // Drop dependent indexes first — SQLite DROP COLUMN refuses an
                // indexed column. IF EXISTS keeps this safe on fresh DBs.
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_personas_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_pm_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_dev_projects_group_id;");

                // No-FK columns: safe native DROP COLUMN. has_column guard makes
                // it a no-op on fresh DBs and on re-run — so "no such column"
                // is already impossible and the discarded Result could only ever
                // have been hiding a real failure. SQLite refuses DROP COLUMN
                // while any index/trigger/view still names the column; on these
                // two tables the consequence is a leftover dead column, which is
                // not worth aborting a launch over. So: report, don't swallow,
                // don't brick.
                if has_column(conn, "persona_memories", "group_id")? {
                    report_failed_group_id_drop(
                        "persona_memories",
                        ddl_step(conn, "ALTER TABLE persona_memories DROP COLUMN group_id;"),
                    );
                }
                if has_column(conn, "dev_projects", "group_id")? {
                    report_failed_group_id_drop(
                        "dev_projects",
                        ddl_step(conn, "ALTER TABLE dev_projects DROP COLUMN group_id;"),
                    );
                }

                // Drop the personas.group_id FK column outright. NULLing it is
                // NOT enough: with `PRAGMA foreign_keys = ON`, every INSERT into
                // personas resolves the FK's parent table, so leaving the FK in
                // place while dropping `persona_groups` breaks ALL persona
                // creation with "no such table: persona_groups". DROP COLUMN
                // removes the dangling FK (mirrors persona_memories/dev_projects
                // above; the index was already dropped). Guarded + idempotent.
                if has_column(conn, "personas", "group_id")? {
                    ddl_step(conn, "UPDATE personas SET group_id = NULL;")?;
                    if let Err(e) = ddl_step(conn, "ALTER TABLE personas DROP COLUMN group_id;") {
                        // Do NOT fall through to the DROP TABLE below. SQLite
                        // refuses DROP COLUMN while any index/trigger/view still
                        // names the column, and with the FK column left in place
                        // dropping `persona_groups` makes EVERY `INSERT INTO
                        // personas` fail with "no such table: persona_groups" —
                        // precisely the breakage the comment above describes.
                        // Discarding this Result made that outcome both silent
                        // and reachable. Keep both objects, log loudly, retry on
                        // the next launch (this step re-runs every boot).
                        tracing::error!(
                            error = %e,
                            "retire_persona_groups: could not drop personas.group_id — keeping \
                             persona_groups so persona creation keeps working; will retry on \
                             the next launch",
                        );
                        return Ok(());
                    }
                }
                let _ = ddl_step(conn, "DROP TABLE IF EXISTS persona_groups;");
                Ok(())
            },
        },
    )?;

    // Multi-driver orchestration (ADR 2026-05-26): per-row claim/lease columns
    // so MCP/REST-submitted executions and build-session promotions are run by
    // exactly ONE instance. The leader (or any instance) CAS-claims a queued
    // row by stamping `claimed_by_instance` + a `claim_expires_at` TTL; the TTL
    // lets a crashed claimant's row be re-claimed (mirrors the `trigger_version`
    // CAS already used by the scheduler). Additive + idempotent. The local-UI
    // path does NOT claim — in-process execution stays snappy; only queued work
    // a driver hands off to the leader is claim-gated. Both ALTERs run inside
    // one `ddl_step` transaction, so the single-column `already_applied` guard
    // is safe (both columns land or neither does).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.claimed_by_instance",
            description: "Add per-instance claim/lease columns to persona_executions",
            already_applied: |conn| {
                has_column(conn, "persona_executions", "claimed_by_instance")
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN claimed_by_instance TEXT;\n\
                     ALTER TABLE persona_executions ADD COLUMN claim_expires_at TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "build_sessions.claimed_by_instance",
            description: "Add per-instance claim/lease columns to build_sessions",
            already_applied: |conn| has_column(conn, "build_sessions", "claimed_by_instance"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE build_sessions ADD COLUMN claimed_by_instance TEXT;\n\
                     ALTER TABLE build_sessions ADD COLUMN claim_expires_at TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona star: marks a persona as "in the Director's coaching scope".
    // Promotes the previously localStorage-only favorite to a durable column so
    // the Director batch (`get_starred`) can read it.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.starred",
            description: "Add starred flag to personas (Director coaching scope)",
            already_applied: |conn| has_column(conn, "personas", "starred"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;

    // Director verdict score + rendered review markdown, written onto the
    // execution the Director reviewed. `director_score` (0-5) backs the Verdict
    // column in the activity list; `director_review_md` backs the Director tab.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.director_score",
            description: "Add director_score + director_review_md to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "director_score"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN director_score INTEGER;\n\
                     ALTER TABLE persona_executions ADD COLUMN director_review_md TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Version attribution for Arena results (Lab "Versions & Ratings" redesign).
    // Arena historically measured the persona's *current* prompt with no version
    // link; the consolidated table aggregates ratings per (version, model), so a
    // version-scoped Arena run now snapshots which version it measured. Nullable —
    // pre-redesign arena rows stay NULL and are excluded from the ratings rollup.
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_arena.version_attribution",
            description: "Add version_id/version_number to lab_arena_runs + lab_arena_results",
            already_applied: |conn| has_column(conn, "lab_arena_runs", "version_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE lab_arena_runs ADD COLUMN version_id TEXT;\n\
                     ALTER TABLE lab_arena_runs ADD COLUMN version_number INTEGER;\n\
                     ALTER TABLE lab_arena_results ADD COLUMN version_id TEXT;\n\
                     ALTER TABLE lab_arena_results ADD COLUMN version_number INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    // Allow the 'oauth_keepalive' policy_type. The OAuth keepalive auto-provision
    // (engine::rotation::auto_provision_oauth_rotation_policies) inserts policies
    // with policy_type='oauth_keepalive' and the rotation tick + dedup logic key
    // off that value — but the original CHECK constraint never listed it, so every
    // OAuth credential without a policy failed the insert with "CHECK constraint
    // failed" at every startup and keepalive rotation was never provisioned.
    // SQLite can't ALTER a CHECK in place, so rebuild the table with the value
    // added (mirrors the n8n_transform_sessions rebuild above). UNIQUE(credential_id,
    // policy_type) is preserved so a keepalive policy can coexist with a user's
    // 'scheduled' policy on the same credential. Nothing references this table, so
    // the drop/rename has no foreign-key fallout.
    run_step(
        conn,
        IncrementalMigration {
            id: "credential_rotation_policies.oauth_keepalive_policy_type",
            description: "Add 'oauth_keepalive' to credential_rotation_policies.policy_type CHECK",
            already_applied: |conn| {
                // Skip when the table is absent (fresh DB → schema.rs creates it with
                // the value already) or its stored CHECK already lists the value.
                // Counts only a present table whose SQL still lacks 'oauth_keepalive'.
                let stale: i64 = conn
                    .prepare(
                        "SELECT COUNT(*) FROM sqlite_master \
                         WHERE type='table' AND name='credential_rotation_policies' \
                         AND sql NOT LIKE '%oauth_keepalive%'",
                    )?
                    .query_row([], |row| row.get(0))?;
                Ok(stale == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "DROP TABLE IF EXISTS credential_rotation_policies_new;
                     CREATE TABLE credential_rotation_policies_new (
                         id                TEXT PRIMARY KEY,
                         credential_id     TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
                         enabled           INTEGER NOT NULL DEFAULT 1,
                         rotation_interval_days INTEGER NOT NULL DEFAULT 90,
                         policy_type       TEXT NOT NULL DEFAULT 'scheduled'
                                           CHECK(policy_type IN ('scheduled','on_suspicious','on_member_departure','manual','oauth_keepalive')),
                         last_rotated_at   TEXT,
                         next_rotation_at  TEXT,
                         created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                         updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
                         UNIQUE(credential_id, policy_type)
                     );
                     INSERT INTO credential_rotation_policies_new
                         (id, credential_id, enabled, rotation_interval_days, policy_type,
                          last_rotated_at, next_rotation_at, created_at, updated_at)
                     SELECT id, credential_id, enabled, rotation_interval_days, policy_type,
                            last_rotated_at, next_rotation_at, created_at, updated_at
                     FROM credential_rotation_policies;
                     DROP TABLE credential_rotation_policies;
                     ALTER TABLE credential_rotation_policies_new RENAME TO credential_rotation_policies;
                     CREATE INDEX IF NOT EXISTS idx_crp_credential ON credential_rotation_policies(credential_id);
                     CREATE INDEX IF NOT EXISTS idx_crp_next       ON credential_rotation_policies(next_rotation_at);
                     CREATE INDEX IF NOT EXISTS idx_crp_enabled    ON credential_rotation_policies(enabled);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Design D: Team Channel Deliberation Engine (D1 schema) ──────────────
    // Autonomous deliberation plane — see docs/plans/team-deliberation-engine.md.
    // D1 lands schema + bindings only; nothing is wired into the engine yet, and
    // the four added columns sit inert until their consuming phase (D3/D5).

    // A deliberation: a bounded, moderated team conversation. Length is bounded
    // by PROGRESS (the agenda + consecutive_stall_rounds), NOT a turn count.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations",
            description: "Create team_deliberations (Design D deliberation plane)",
            already_applied: |conn| has_table(conn, "team_deliberations"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS team_deliberations (
                        id            TEXT PRIMARY KEY,
                        team_id       TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
                        topic         TEXT NOT NULL,
                        goal          TEXT,
                        status        TEXT NOT NULL DEFAULT 'open',
                        round         INTEGER NOT NULL DEFAULT 0,
                        consecutive_stall_rounds INTEGER NOT NULL DEFAULT 0,
                        cost_budget_usd  REAL,
                        cost_spent_usd   REAL NOT NULL DEFAULT 0,
                        idle_deadline    TEXT,
                        resolution    TEXT,
                        spawned_assignment_id TEXT,
                        created_by    TEXT NOT NULL DEFAULT 'user',
                        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_delib_team_status
                        ON team_deliberations(team_id, status, updated_at DESC);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                        ON team_deliberations(team_id)
                        WHERE status IN ('open','converging','escalated','paused');",
                )?;
                Ok(())
            },
        },
    )?;

    // The agenda backbone — the termination contract (the deliberation ends when
    // the agenda is empty), replacing the turn budget.
    run_step(
        conn,
        IncrementalMigration {
            id: "deliberation_agenda",
            description: "Create deliberation_agenda (Design D agenda backbone)",
            already_applied: |conn| has_table(conn, "deliberation_agenda"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS deliberation_agenda (
                        id              TEXT PRIMARY KEY,
                        deliberation_id TEXT NOT NULL REFERENCES team_deliberations(id) ON DELETE CASCADE,
                        item            TEXT NOT NULL,
                        status          TEXT NOT NULL DEFAULT 'open',
                        resolution      TEXT,
                        opened_by       TEXT,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        resolved_at     TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_agenda_delib_status
                        ON deliberation_agenda(deliberation_id, status);",
                )?;
                Ok(())
            },
        },
    )?;

    // Link channel turns to their deliberation (turns ride the existing channel
    // read-model + UI). Injection is BY deliberation_id, not the `consumer` field.
    // Plain column (no inline FK) — matches the established ALTER-ADD style here.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.deliberation_id",
            description: "Add deliberation_id to team_channel_messages (Design D)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "deliberation_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN deliberation_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Display name of an EXTERNAL author (the team <-> Slack bridge, WP2).
    // Internal authors resolve their name from `author_id` (a persona id) or
    // from `author_kind` itself, so this stays NULL for every row the app
    // writes; a Slack participant has neither, and the read-model surfaces this
    // column as `TeamChannelItem.label` (which for channel rows was previously
    // a redundant copy of `author_kind`). Plain column, ALTER-ADD style,
    // matching `deliberation_id` above.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.author_label",
            description: "Add author_label to team_channel_messages (Slack bridge inbound)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "author_label"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN author_label TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Persona deliberation identity (typed PersonaCore JSON) — authored at the
    // template level (D5), read by the moderator (D2/D3). Inert until then.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.core_profile",
            description: "Add core_profile to personas (Design D PersonaCore)",
            already_applied: |conn| has_column(conn, "personas", "core_profile"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE personas ADD COLUMN core_profile TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Team shared motivation (typed TeamNorthStar JSON) — the "#1 in category"
    // imprint every member shares. Authored at the team-preset level (D5).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams.north_star",
            description: "Add north_star to persona_teams (Design D TeamNorthStar)",
            already_applied: |conn| has_column(conn, "persona_teams", "north_star"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE persona_teams ADD COLUMN north_star TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Per-persona conversation-scoped memory: lets a persona recall "what I
    // argued in this deliberation". Nullable scope; reuses persona_memories.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories.deliberation_id",
            description: "Add deliberation_id scope to persona_memories (Design D)",
            already_applied: |conn| has_column(conn, "persona_memories", "deliberation_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN deliberation_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Gated mid-deliberation capability action (the conversation↔action loop).
    // `pending_action` holds the awaiting-approval capability request (JSON); the
    // new 'awaiting_action' status parks the deliberation until the user approves
    // or skips. Rebuild the one-active-per-team index to cover the new status.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.pending_action",
            description: "Add pending_action + awaiting_action status (Design D gated actions)",
            already_applied: |conn| has_column(conn, "team_deliberations", "pending_action"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN pending_action TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE status IN ('open','converging','escalated','paused','awaiting_action');",
                )?;
                Ok(())
            },
        },
    )?;

    // Parallel deliberation tracks (sub-sessions). A deliberation can be split
    // into child "tracks" (parent_id set), each owning a slice of the agenda and
    // an optional roster subset (roster_ids). The parent parks at 'tracking'
    // until its tracks resolve, then a merge synthesizes one combined proposal.
    // The one-active-per-team index must count only TOP-LEVEL deliberations, or
    // a parent + its tracks would collide — so it gains `parent_id IS NULL`.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.tracks",
            description: "Add parent_id + roster_ids for parallel deliberation tracks",
            already_applied: |conn| has_column(conn, "team_deliberations", "parent_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN parent_id TEXT;
                     ALTER TABLE team_deliberations ADD COLUMN roster_ids TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE parent_id IS NULL
                           AND status IN ('open','converging','escalated','paused','awaiting_action','tracking');
                     CREATE INDEX IF NOT EXISTS idx_delib_parent ON team_deliberations(parent_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Async gated actions: an approved capability runs in the background; the
    // deliberation parks at 'action_running' holding its persona_executions id,
    // and a reaper posts the output back + resumes when it finishes (so the flow
    // recovers even when the capability outlives any single request).
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.action_execution",
            description: "Add action_execution_id + action_running status (async gated actions)",
            already_applied: |conn| has_column(conn, "team_deliberations", "action_execution_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN action_execution_id TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE parent_id IS NULL
                           AND status IN ('open','converging','escalated','paused','awaiting_action','tracking','action_running');",
                )?;
                Ok(())
            },
        },
    )?;

    // Atomic capability claim: one row per (group_root, use_case_id) so only the
    // FIRST concurrent approval across parallel tracks spawns a capability — the
    // PRIMARY KEY makes the de-dup race-free (the turn/approval-time scans can't).
    run_step(
        conn,
        IncrementalMigration {
            id: "deliberation_capability_claims",
            description: "Atomic per-group capability claim (race-free de-dup)",
            already_applied: |conn| has_table(conn, "deliberation_capability_claims"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS deliberation_capability_claims (
                        group_root      TEXT NOT NULL,
                        use_case_id     TEXT NOT NULL,
                        deliberation_id TEXT NOT NULL,
                        claimed_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (group_root, use_case_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Build telemetry (build-orchestration Phase 0). Additive observability so
    // the build-bench harness can measure per-phase wall-clock + CLI cost/tokens
    // for as-is vs multi-agent builds. See docs/architecture/build-orchestration-plan.md.
    run_step(
        conn,
        IncrementalMigration {
            id: "build_sessions_telemetry",
            description: "Add phase_timings_json + cost/token/turn columns to build_sessions",
            already_applied: |conn| has_column(conn, "build_sessions", "phase_timings_json"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE build_sessions ADD COLUMN phase_timings_json TEXT;
                     ALTER TABLE build_sessions ADD COLUMN total_cost_usd REAL;
                     ALTER TABLE build_sessions ADD COLUMN input_tokens INTEGER;
                     ALTER TABLE build_sessions ADD COLUMN output_tokens INTEGER;
                     ALTER TABLE build_sessions ADD COLUMN num_turns INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    // Persisted daily SLA rollups (per persona × local day). Lets the SLA
    // dashboard serve its trend + aggregates from a bounded rollup table
    // instead of re-scanning the full `persona_executions` history on every
    // load, and lets the trend survive execution retention. Backfills from
    // existing history using the server's local-day definition (the same one
    // the runtime rollup writer in `cleanup_tick` uses). MUST stay INSIDE
    // `run_incremental` (fresh DBs run this after the base schema exists) — the
    // tail below belongs to `ensure_composite_fires_table`, which `initial::run`
    // calls BEFORE `run_incremental`, so a step appended there would fail on a
    // fresh DB.
    run_step(
        conn,
        IncrementalMigration {
            id: "sla_daily_rollups",
            description: "Persisted daily SLA rollups (per persona × local day) + backfill",
            already_applied: |conn| has_table(conn, "sla_daily"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS sla_daily (
                        persona_id      TEXT NOT NULL,
                        day             TEXT NOT NULL,
                        total           INTEGER NOT NULL DEFAULT 0,
                        successful      INTEGER NOT NULL DEFAULT 0,
                        failed          INTEGER NOT NULL DEFAULT 0,
                        cancelled       INTEGER NOT NULL DEFAULT 0,
                        timed_count     INTEGER NOT NULL DEFAULT 0,
                        duration_sum_ms REAL NOT NULL DEFAULT 0,
                        cost_sum_usd    REAL NOT NULL DEFAULT 0,
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, day)
                    );
                    CREATE INDEX IF NOT EXISTS idx_sla_daily_day ON sla_daily(day);",
                )?;
                // Backfill from existing execution history. Reuses the exact
                // rollup writer the runtime path uses, so backfilled and
                // live-written rows share one definition.
                let offset_min =
                    crate::repos::communication::sla::server_offset_minutes();
                crate::repos::communication::sla::upsert_sla_daily_conn(conn, offset_min)?;
                Ok(())
            },
        },
    )?;

    // Durable SLA breach-episode state (one row per persona). Powers the
    // reliability-breach bus events emitted on the execution-completion path:
    // the row is what dedupes a breach to ONE enter-event (and one recovery)
    // even across restarts — without it, every failing run after the first
    // would re-emit. Zero-config: thresholds are code constants in
    // `repos::communication::sla`, there is no `sla_targets` table by design.
    // MUST stay INSIDE `run_incremental` for the same reason as `sla_daily`
    // above (fresh DBs run this after the base schema; the tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE `run_incremental`).
    run_step(
        conn,
        IncrementalMigration {
            id: "sla_breach_episodes",
            description: "Durable per-persona SLA breach-episode dedup state",
            already_applied: |conn| has_table(conn, "sla_breach_episodes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS sla_breach_episodes (
                        persona_id           TEXT PRIMARY KEY,
                        is_open              INTEGER NOT NULL DEFAULT 0,
                        reason               TEXT,
                        consecutive_failures INTEGER NOT NULL DEFAULT 0,
                        success_rate         REAL NOT NULL DEFAULT 0,
                        decided              INTEGER NOT NULL DEFAULT 0,
                        opened_at            TEXT,
                        recovered_at         TEXT,
                        updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_sla_breach_episodes_open
                        ON sla_breach_episodes(is_open);",
                )?;
                Ok(())
            },
        },
    )?;

    // Durable per-trigger schedule side-state: the count of scheduled slots
    // that were DISCARDED while the app was offline (the startup overdue sweep
    // fires ONE catch-up and drops the rest under the default backfill cap of
    // 1), so a daily-job user gets a visible "missed N while offline" record
    // instead of silent loss. One row per schedule trigger; cleared after the
    // user backfills or dismisses. MUST stay INSIDE `run_incremental` (fresh
    // DBs run this after the base schema; the tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE `run_incremental`).
    run_step(
        conn,
        IncrementalMigration {
            id: "schedule_missed_runs",
            description: "Per-trigger discarded-while-offline slot count for schedule visibility",
            already_applied: |conn| has_table(conn, "schedule_missed_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS schedule_missed_runs (
                        trigger_id      TEXT PRIMARY KEY,
                        missed_count    INTEGER NOT NULL DEFAULT 0,
                        first_missed_at TEXT,
                        last_missed_at  TEXT,
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Direction 3 (lost fires get a home): machine-readable reason a schedule is
    // Paused/Unscheduled (e.g. `invalid_timezone`), stored on the same per-trigger
    // side-state row so the schedule row can explain WHY next_trigger_at is NULL
    // instead of just showing "Paused/Unscheduled". Guarded ALTER — reuses the
    // Direction 1 table so a trigger can carry both a missed count and a reason.
    run_step(
        conn,
        IncrementalMigration {
            id: "schedule_missed_runs.status_reason",
            description: "Machine-readable schedule pause reason (e.g. invalid_timezone)",
            already_applied: |conn| has_column(conn, "schedule_missed_runs", "status_reason"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE schedule_missed_runs ADD COLUMN status_reason TEXT;
                     ALTER TABLE schedule_missed_runs ADD COLUMN status_reason_detail TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Retire the orphaned DB skills system ("System A": skills / skill_components
    // / persona_skills). It was unreachable at both ends — no execution path read
    // `persona_skills`, no seeder wrote rows, and its frontend API had zero
    // importers (retired 2026-07-17). Fresh DBs no longer create the tables (the
    // CREATE was removed from initial.rs); this step cleans up LEGACY databases
    // that still carry them.
    //
    // GUARDED DROP — never delete user data. Each table is dropped ONLY IF it is
    // empty (`SELECT COUNT(*) = 0`). A non-empty table is left in place with a
    // `tracing::warn` so a user who somehow populated it keeps their rows and is
    // told why the table survived. Child tables are dropped before `skills` to
    // respect the FK references. Because `already_applied` is schema-shape-based
    // (no migration ledger), a non-empty table simply means this step re-checks
    // (and re-warns) on each boot until the rows are gone — cheap and informative.
    // NOTE: this step MUST live in `run_incremental` (not `ensure_composite_fires_table`)
    // — `init_test_db` and the boot path replay both, but only `run_incremental` is
    // the canonical home for schema teardown of this kind.
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_db_skills_system",
            description: "Drop the orphaned DB skills system (skills/skill_components/persona_skills) IF empty; leave non-empty tables in place with a warning",
            already_applied: |conn| {
                Ok(!has_table(conn, "skills")?
                    && !has_table(conn, "skill_components")?
                    && !has_table(conn, "persona_skills")?)
            },
            apply: |conn| {
                // Drop children first (both reference skills(id)).
                for table in ["persona_skills", "skill_components", "skills"] {
                    if !has_table(conn, table)? {
                        continue;
                    }
                    let count: i64 = conn.query_row(
                        &format!("SELECT COUNT(*) FROM {table}"),
                        [],
                        |r| r.get(0),
                    )?;
                    if count == 0 {
                        ddl_step(conn, &format!("DROP TABLE IF EXISTS {table};"))?;
                    } else {
                        tracing::warn!(
                            table,
                            row_count = count,
                            "Retired DB skills system: leaving non-empty table in place to avoid deleting user data; drop it manually if the rows are no longer needed"
                        );
                    }
                }
                Ok(())
            },
        },
    )?;

    // Skill usage telemetry (Brainiac-adoption P1 — docs/plans/brainiac-adoption-
    // skills-memory-docs.md). Registry = filesystem-reconciled identity + hash
    // history for `.claude/skills` (global + per-project); events = APPEND-ONLY
    // invocation log mined from Claude Code transcripts (repos expose
    // insert+select only — the Brainiac grant discipline); scan_state = per-file
    // byte watermark so mining stays incremental. Names deliberately avoid the
    // retired System-A `skills` tables above. MUST stay INSIDE `run_incremental`
    // (the tail belongs to `ensure_composite_fires_table`).
    run_step(
        conn,
        IncrementalMigration {
            id: "skill_usage_telemetry",
            description: "Skill registry + append-only usage events + transcript scan watermarks",
            already_applied: |conn| has_table(conn, "skill_usage_events"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS skill_registry (
                        id              TEXT PRIMARY KEY,
                        name            TEXT NOT NULL,
                        scope           TEXT NOT NULL CHECK (scope IN ('global','project')),
                        project_id      TEXT,
                        content_hash    TEXT,
                        description     TEXT,
                        origin          TEXT NOT NULL DEFAULT 'authored',
                        first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        last_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
                        missing_since   TEXT
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_registry_ident
                        ON skill_registry(name, scope, COALESCE(project_id,''));
                    CREATE TABLE IF NOT EXISTS skill_revisions (
                        skill_id     TEXT NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
                        rev          INTEGER NOT NULL,
                        content_hash TEXT,
                        changed_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (skill_id, rev)
                    );
                    CREATE TABLE IF NOT EXISTS skill_usage_events (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        skill_name  TEXT NOT NULL,
                        project_id  TEXT,
                        session_id  TEXT,
                        event       TEXT NOT NULL CHECK (event IN ('invoke','fetch')),
                        source      TEXT NOT NULL CHECK (source IN ('transcript','dev_runner')),
                        occurred_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_sue_name
                        ON skill_usage_events(skill_name, project_id, occurred_at DESC);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_sue_dedup
                        ON skill_usage_events(session_id, skill_name, occurred_at);
                    CREATE TABLE IF NOT EXISTS skill_scan_state (
                        file_path   TEXT PRIMARY KEY,
                        byte_offset INTEGER NOT NULL DEFAULT 0,
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Doc-rot telemetry (Brainiac-adoption P2). doc_status = the local
    // `dirty_at` (git-derived: coupled sources newer than the doc);
    // doc_read_events = APPEND-ONLY reads mined from transcripts, stamped
    // `was_dirty` at insert so "rot being consumed" survives the doc later
    // getting fixed (Brainiac 0025's harm-ranking signal). Resetting
    // skill_scan_state is deliberate: the shared transcript miner now also
    // extracts doc reads, and already-consumed bytes must be re-mined once to
    // backfill them (skill events dedup via their unique index, so the replay
    // is idempotent). MUST stay INSIDE `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "doc_rot_telemetry",
            description: "Git-derived doc dirty tracking + append-only doc read events (+ one-time miner watermark reset)",
            already_applied: |conn| has_table(conn, "doc_read_events"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS doc_status (
                        project_id         TEXT NOT NULL,
                        doc_path           TEXT NOT NULL,
                        coupled_scope      TEXT,
                        last_doc_commit    TEXT,
                        last_source_commit TEXT,
                        dirty_since        TEXT,
                        changed_sources    TEXT,
                        scanned_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (project_id, doc_path)
                    );
                    CREATE INDEX IF NOT EXISTS idx_doc_status_dirty
                        ON doc_status(project_id, dirty_since) WHERE dirty_since IS NOT NULL;
                    CREATE TABLE IF NOT EXISTS doc_read_events (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        project_id TEXT NOT NULL,
                        doc_path   TEXT NOT NULL,
                        session_id TEXT,
                        was_dirty  INTEGER NOT NULL DEFAULT 0,
                        read_at    TEXT NOT NULL
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_dedup
                        ON doc_read_events(session_id, project_id, doc_path, read_at);
                    CREATE INDEX IF NOT EXISTS idx_dre_doc
                        ON doc_read_events(project_id, doc_path, read_at DESC);
                    DELETE FROM skill_scan_state;",
                )?;
                Ok(())
            },
        },
    )?;

    // Skill semantic versioning (docs/skill-standard.md). The declared
    // `version:` frontmatter ("major.minor") joins the hash-based identity:
    // registry rows carry the current declared version, revision rows the
    // version at each hash change. NULL = the skill predates the standard
    // (unversioned; consumers treat it as an implicit 1.0). Existing revision
    // rows stay NULL — history is not fabricated. MUST stay INSIDE
    // `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "skill_semantic_version",
            description: "Declared major.minor skill version on registry + revision rows",
            already_applied: |conn| {
                // Missing table (test binaries drop some tables) counts as
                // applied — ALTER on a missing table would hard-fail.
                Ok(!has_table(conn, "skill_registry")?
                    || has_column(conn, "skill_registry", "version")?)
            },
            apply: |conn| {
                if has_table(conn, "skill_registry")? {
                    ddl_step(conn, "ALTER TABLE skill_registry ADD COLUMN version TEXT;")?;
                }
                if has_table(conn, "skill_revisions")? {
                    ddl_step(conn, "ALTER TABLE skill_revisions ADD COLUMN version TEXT;")?;
                }
                Ok(())
            },
        },
    )?;

    // Doc-rot content signal. The git rule (coupled sources newer than the
    // doc) cannot express "this doc names a file that no longer exists" — and
    // that case used to be INVISIBLE: a doc whose references had all been
    // renamed away coupled to nothing, went unscoped, and unscoped never went
    // dirty. `broken_refs` is the JSON list of referenced repo paths that are
    // gone while their parent directory still stands. Additive; a legacy row
    // reads NULL and degrades to "no content evidence", never to a false pass.
    run_step(
        conn,
        IncrementalMigration {
            id: "doc_rot_broken_refs",
            description: "doc_status.broken_refs — referenced repo paths that no longer exist",
            already_applied: |conn| has_column(conn, "doc_status", "broken_refs"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE doc_status ADD COLUMN broken_refs TEXT")?;
                Ok(())
            },
        },
    )?;

    // Memory claims + knowledge health (Brainiac-adoption P3). memory_claims =
    // the open-until-resolved dispute loop (Brainiac memory_feedback): a
    // negative claim (`wrong`/`outdated`) stays OPEN until a human answers
    // reverified/deprecated/dismissed; `helpful` asserts nothing to fix and is
    // never "open". persona_memories.open_claim_count is the denormalized
    // open-NEGATIVE counter the decay scorer reads (MEMORY CONTRACT-adjacent:
    // only the claims repo writes it). knowledge_health_snapshots = per-scope
    // currency/consistency/governance rollups for trend lines (Brainiac 0014).
    // NOTE deliberate deviations from the adoption plan, recorded there too:
    // no `valid_to` column (category half-life decay + the working-tier 30-day
    // expiry + ACTIVE_CAP already implement TTL/neglect in continuous form)
    // and no `superseded_by` (derived_from + archive cover lineage until a
    // real supersession writer exists). MUST stay INSIDE `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "memory_claims_health",
            description: "Memory dispute claims (open-until-resolved) + open-claim counter + knowledge health snapshots",
            already_applied: |conn| has_table(conn, "memory_claims"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS memory_claims (
                        id              TEXT PRIMARY KEY,
                        memory_id       TEXT NOT NULL REFERENCES persona_memories(id) ON DELETE CASCADE,
                        verdict         TEXT NOT NULL CHECK (verdict IN ('helpful','wrong','outdated')),
                        note            TEXT,
                        source          TEXT NOT NULL DEFAULT 'user',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        resolution      TEXT CHECK (resolution IN ('reverified','deprecated','dismissed')),
                        resolution_note TEXT,
                        resolved_at     TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_memory_claims_memory
                        ON memory_claims(memory_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_memory_claims_open
                        ON memory_claims(memory_id)
                        WHERE resolution IS NULL AND verdict != 'helpful';
                    ALTER TABLE persona_memories ADD COLUMN open_claim_count INTEGER NOT NULL DEFAULT 0;
                    CREATE TABLE IF NOT EXISTS knowledge_health_snapshots (
                        id          TEXT PRIMARY KEY,
                        scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('persona','team','project')),
                        scope_id    TEXT NOT NULL,
                        captured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        score       INTEGER NOT NULL,
                        currency    INTEGER,
                        consistency INTEGER,
                        governance  INTEGER,
                        stale_count INTEGER,
                        total_count INTEGER,
                        open_claims INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_khs_scope
                        ON knowledge_health_snapshots(scope_kind, scope_id, captured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Triage/Run-Desk keyset indexes. Both surfaces order by
    // `created_at DESC` under a status (and, for tasks, a project) filter;
    // without these the paged reads degrade to a full scan + sort of
    // `dev_ideas` / `dev_tasks` on every page. MUST stay INSIDE
    // `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_triage_page_indexes",
            description: "Keyset indexes for the unified Backlog (dev_ideas) and Run Desk (dev_tasks) paged reads",
            already_applied: |conn| has_index(conn, "idx_dev_ideas_triage"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_ideas_triage
                        ON dev_ideas(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_tasks_page
                        ON dev_tasks(project_id, status, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // `pending` was never part of the dev_tasks vocabulary
    // (queued|running|completed|failed|cancelled) but a legacy writer used it,
    // and every status-driven surface rendered those rows as nothing — they
    // were invisible AND unrunnable. Idempotent by construction: after the
    // first pass the UPDATE matches zero rows, so it can run on every boot.
    ddl_step(
        conn,
        "UPDATE dev_tasks SET status = 'queued' WHERE status = 'pending';",
    )?;

    // Durable auto-run ledger. The scheduler's state lived only in the
    // in-memory `AUTO_RUN_JOBS` map, so a restart mid-wave lost the run
    // entirely — the banner vanished and nothing recorded why the wave
    // stopped. This table is the restart-surviving record; the in-memory map
    // stays the live view.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_auto_runs (
            id                 TEXT PRIMARY KEY,
            project_id         TEXT,
            status             TEXT,
            snapshot_size      INTEGER,
            completed          INTEGER,
            failed             INTEGER,
            skipped            INTEGER,
            iterations         INTEGER,
            termination_reason TEXT,
            started_at         TEXT,
            finished_at        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dev_auto_runs_project
            ON dev_auto_runs(project_id, started_at DESC);",
    )?;

    // -- Dev Tools: per-context deterministic structural fingerprint ------------
    // The scan-efficiency keystone. Every scan (context map, skills coverage,
    // engineering-pattern compliance) used to re-read files to answer ONE
    // question and then throw the reading away: a probe over this repo read
    // 13,622 files to answer 6 questions, because the only narrowing metadata
    // was `dev_contexts.category` (4 values) — all 236 `description` fields are
    // the literal placeholder "Pending LLM description".
    //
    // This table caches CHEAP DETERMINISTIC FACTS (no LLM, no network) per
    // context, keyed by `content_hash` — a hash over the context's file LIST
    // and each file's sha256, so any membership OR content change invalidates
    // it. Future questions become SQL instead of file reads.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_context_fingerprints",
            description: "Per-context deterministic structural fingerprint cache (imports/primitives/shape counters/surface flags)",
            already_applied: |conn| has_table(conn, "dev_context_fingerprints"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_context_fingerprints (
                        project_id                  TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        context_id                  TEXT NOT NULL,
                        -- Hash over the file list AND every file's sha256.
                        content_hash                TEXT NOT NULL,
                        file_count                  INTEGER NOT NULL DEFAULT 0,
                        -- Mapped paths that no longer exist on disk. 13% of the
                        -- live map is dangling; per-context staleness must be
                        -- VISIBLE rather than silently skipped.
                        missing_file_count          INTEGER NOT NULL DEFAULT 0,
                        -- JSON arrays.
                        imports                     TEXT,
                        primitives                  TEXT,
                        -- Shape counters.
                        promise_all_count           INTEGER NOT NULL DEFAULT 0,
                        join_all_count              INTEGER NOT NULL DEFAULT 0,
                        await_count                 INTEGER NOT NULL DEFAULT 0,
                        sql_write_count             INTEGER NOT NULL DEFAULT 0,
                        spawn_count                 INTEGER NOT NULL DEFAULT 0,
                        use_effect_count            INTEGER NOT NULL DEFAULT 0,
                        set_state_after_await_count INTEGER NOT NULL DEFAULT 0,
                        -- Surface flags (0/1).
                        exports_components          INTEGER NOT NULL DEFAULT 0,
                        exports_hooks               INTEGER NOT NULL DEFAULT 0,
                        exports_commands            INTEGER NOT NULL DEFAULT 0,
                        exports_repo_fns            INTEGER NOT NULL DEFAULT 0,
                        computed_at                 TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (project_id, context_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_context_fingerprints_hash
                        ON dev_context_fingerprints(project_id, content_hash);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Reversible Agent: durable change journal -----------------------------
    // The persistence target of the second CDC consumer (db/journal.rs): one
    // row per captured INSERT/UPDATE/DELETE on an allowlisted table, with
    // the OLD row values serialized as JSON for UPDATE/DELETE (before-image;
    // encrypted columns stay ciphertext — the hook copies values as stored)
    // and the owning execution stamped by the attribution context.
    //
    // `row_pk` is the TEXT `id` of the touched row (every allowlisted table
    // has one); undo addresses rows by pk, never by reusable rowid. `id` is
    // a plain INTEGER PRIMARY KEY: monotonic enough for replay ordering and
    // "later foreign write" conflict detection (only the oldest rows are
    // ever pruned). `undo_status` NULL = live, 'undone' = reversed,
    // 'conflict' = parked because a later foreign write touched the row.
    //
    // Journal writes are themselves EXCLUDED from CDC + journal capture
    // (cdc::table_to_event returns None; journal::is_journaled_table guards
    // explicitly), so this table cannot recurse.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "change_journal",
            description: "Reversible Agent: durable, execution-attributed change journal with before-images",
            already_applied: |conn| has_table(conn, "change_journal"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS change_journal (
                        id            INTEGER PRIMARY KEY,
                        execution_id  TEXT,
                        tbl           TEXT NOT NULL,
                        row_pk        TEXT,
                        row_id        INTEGER NOT NULL,
                        action        TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
                        before_image  TEXT,
                        undo_status   TEXT CHECK (undo_status IN ('undone', 'conflict')),
                        undone_at     TEXT,
                        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_change_journal_execution
                        ON change_journal(execution_id, id);
                    CREATE INDEX IF NOT EXISTS idx_change_journal_key
                        ON change_journal(tbl, row_pk, id);
                    CREATE INDEX IF NOT EXISTS idx_change_journal_created
                        ON change_journal(created_at);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_tasks: updated_at (the staleness signal tasks never had) ----------
    // `dev_tasks` carried created_at / started_at / completed_at and nothing
    // else, so a task stuck `running` for six hours was indistinguishable from
    // one running six minutes except by re-deriving from started_at, and a
    // `queued` row that had been silently re-touched had no signal at all.
    // The attention queue (repos/dev_tools.rs::attention_queue) reads this as a
    // heartbeat: the task executor calls update_task on every progress
    // milestone, so a running task whose updated_at has gone quiet is genuinely
    // stuck rather than merely long.
    //
    // Added nullable + backfilled rather than NOT NULL DEFAULT: SQLite refuses
    // a non-constant default (`datetime('now')`) in ALTER TABLE ADD COLUMN.
    // The backfill uses the same COALESCE the readers do, so an existing row
    // gets its most recent real stamp instead of NULL or a fake "now" that
    // would make every historical task look freshly touched.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_tasks_updated_at",
            description: "dev_tasks.updated_at (+ backfill from completed_at/started_at/created_at)",
            already_applied: |conn| has_column(conn, "dev_tasks", "updated_at"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_tasks ADD COLUMN updated_at TEXT;
                     UPDATE dev_tasks
                        SET updated_at = COALESCE(completed_at, started_at, created_at)
                      WHERE updated_at IS NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- owned_devices: device-link pairing columns --------------------------
    // The `owned_devices` registry above predates the pairing ceremony; it only
    // recorded that a peer *is* one of ours. The signed pairing handshake adds
    // three facts worth persisting:
    //   • `is_home`     — which device is the user's primary ("home") machine.
    //                     At most one row is true; the repo enforces that.
    //   • `paired_at`   — when the fingerprint confirmation happened, distinct
    //                     from `added_at` (a row can be registered manually,
    //                     without a pairing ceremony, and then stay unpaired).
    //   • `public_key`  — the peer's Ed25519 public key (base64) as proven at
    //                     handshake time, so a later reconnect can be checked
    //                     against the key we actually paired with rather than
    //                     re-trusting whatever key the peer presents.
    // `display_name` is intentionally NOT added here: the original
    // `owned_devices` DDL already declares it `TEXT NOT NULL`.
    //
    // Guarded per-column (not per-table) because a DB that ran an earlier
    // partial of this step must be able to finish it. `has_column` on a table
    // that does not exist returns false, so the `has_table` check in `apply`
    // keeps an ALTER from firing against a missing table on an exotic DB.
    run_step(
        conn,
        IncrementalMigration {
            id: "owned_devices_pairing_columns",
            description: "Add is_home / paired_at / public_key to owned_devices (device-link pairing)",
            already_applied: |conn| {
                Ok(has_column(conn, "owned_devices", "is_home")?
                    && has_column(conn, "owned_devices", "paired_at")?
                    && has_column(conn, "owned_devices", "public_key")?)
            },
            apply: |conn| {
                if !has_table(conn, "owned_devices")? {
                    return Ok(());
                }
                if !has_column(conn, "owned_devices", "is_home")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE owned_devices
                            ADD COLUMN is_home BOOLEAN NOT NULL DEFAULT 0;",
                    )?;
                }
                if !has_column(conn, "owned_devices", "paired_at")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE owned_devices ADD COLUMN paired_at TEXT;",
                    )?;
                }
                if !has_column(conn, "owned_devices", "public_key")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE owned_devices ADD COLUMN public_key TEXT;",
                    )?;
                }
                // At most one home device. A partial unique index is the
                // cheapest way to make the invariant a schema fact rather than
                // repo-only etiquette.
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_devices_single_home
                        ON owned_devices(is_home) WHERE is_home = 1;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- remote_jobs / remote_job_notes: cross-device instruction dispatch ----
    // One paired device sends the other a natural-language instruction; the
    // receiving device runs it and streams back an ack, progress notes and a
    // final summary. Both roles read and write the SAME table, told apart by
    // `direction` ('outbound' = I asked, 'inbound' = I was asked), so a device
    // that does both keeps one chronological history instead of two.
    //
    // `last_seq` is the resume anchor and means slightly different things per
    // side — highest note EMITTED on the inbound (running) side, highest note
    // RECEIVED on the outbound side — but in both cases it is "everything up to
    // here is durable", which is exactly what a reconnect needs to replay from.
    //
    // The notes live in their own table rather than a JSON column because the
    // replay reads them with `seq > ?`, and the composite primary key
    // (job_id, seq) is what makes redelivery idempotent: a replayed note that
    // already landed hits the PK and is ignored, so exactly-once falls out of
    // the schema instead of out of careful application code.
    //
    // Not `p2p`-gated: the tables are plain data, and a lite build must still
    // migrate cleanly so a user who switches builds does not lose the history.
    run_step(
        conn,
        IncrementalMigration {
            id: "remote_jobs_tables",
            description: "remote_jobs + remote_job_notes (cross-device instruction dispatch)",
            already_applied: |conn| {
                Ok(has_table(conn, "remote_jobs")? && has_table(conn, "remote_job_notes")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS remote_jobs (
                        id                 TEXT PRIMARY KEY,
                        direction          TEXT NOT NULL
                                             CHECK(direction IN ('outbound','inbound')),
                        peer_id            TEXT NOT NULL,
                        peer_display_name  TEXT NOT NULL DEFAULT '',
                        kind               TEXT NOT NULL DEFAULT 'instruction',
                        instruction        TEXT NOT NULL,
                        status             TEXT NOT NULL,
                        summary            TEXT,
                        refusal_reason     TEXT,
                        last_seq           INTEGER NOT NULL DEFAULT 0,
                        created_at         TEXT NOT NULL,
                        updated_at         TEXT NOT NULL,
                        completed_at       TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_remote_jobs_peer
                        ON remote_jobs(peer_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_remote_jobs_direction_status
                        ON remote_jobs(direction, status);
                    CREATE TABLE IF NOT EXISTS remote_job_notes (
                        job_id      TEXT NOT NULL
                                      REFERENCES remote_jobs(id) ON DELETE CASCADE,
                        seq         INTEGER NOT NULL,
                        text        TEXT NOT NULL,
                        created_at  TEXT NOT NULL,
                        PRIMARY KEY (job_id, seq)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Recipe outcome attribution ------------------------------------------
    // With 299 seeded recipes the product could not answer "which of these do
    // people actually run, and do they succeed?" An adopted capability carries
    // `source_recipe_id` in `personas.design_context.useCases[]`, but that
    // provenance was never joined to a run: nothing on the execution path
    // recorded which recipe produced an output, `dev_llm_spend` has only a
    // coarse `source:"recipe"` tag written by the dead playground path, and
    // `recipe_suggestion_events` measures composer chip impressions rather
    // than outcomes.
    //
    // Denormalized onto the execution row rather than resolved by a live join,
    // because `design_context` is mutable: detaching a capability deletes the
    // use case, which would silently rewrite the history of every run it ever
    // produced. A run's provenance is a fact about the past and must not move.
    //
    // Both columns are NULL when no recipe is behind the run. Historical rows
    // stay NULL — they genuinely lack the information and there is no honest
    // backfill for them.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_recipe_provenance",
            description: "Add source_recipe_id/source_recipe_version to persona_executions",
            already_applied: |conn| {
                // Guarded on the table as well as the column: several tables
                // exist only in the app binary, and an ALTER against a missing
                // table would abort the whole migration run.
                Ok(!has_table(conn, "persona_executions")?
                    || has_column(conn, "persona_executions", "source_recipe_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN source_recipe_id TEXT;\n\
                     ALTER TABLE persona_executions ADD COLUMN source_recipe_version TEXT;\n\
                     CREATE INDEX IF NOT EXISTS idx_pe_source_recipe\n\
                         ON persona_executions(source_recipe_id, status)\n\
                         WHERE source_recipe_id IS NOT NULL;",
                )?;
                Ok(())
            },
        },
    )?;
    // The AI-compose measurement door writes `source = 'ai-compose'` — a value
    // the source CHECK never allowed. Both writers (`kpi_compose::
    // apply_composed_measure` and the Factory measurement-setup modal) were
    // therefore rejected by SQLite, and the background one swallowed the error
    // with `let _ =`: an AI-composed reading has never reached the series.
    // Widen the CHECK so it can.
    //
    // MUST live here and not in `ensure_composite_fires_table` (which owns the
    // file's tail): that phase runs BEFORE this one and is where the table is
    // created, so a rebuild placed there would race its own CREATE.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements.source_ai_compose",
            description: "allow source='ai-compose' on KPI measurements (table rebuild)",
            already_applied: |conn| {
                if !has_table(conn, "dev_kpi_measurements")? {
                    return Ok(true);
                }
                if !has_column(conn, "dev_kpi_measurements", "source")? {
                    return Ok(true);
                }
                let sql: String = conn.query_row(
                    "SELECT COALESCE(sql, '') FROM sqlite_master
                     WHERE type='table' AND name='dev_kpi_measurements'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(sql.contains("'ai-compose'"))
            },
            apply: widen_kpi_measurement_source_with_ai_compose,
        },
    )?;
    // `dev_goals.status` was a free TEXT column. Its canonical states existed
    // only in TypeScript, and correctness depended on every writer remembering
    // to call `normalizeGoalStatus` — which has already failed once (v1 wrote
    // 'in-progress' and matched 'in_progress', silently mis-laning every
    // in-progress goal), and which Rust never called at all. Constrain it at
    // the DB boundary, the way the module's own neighbours already are:
    // `dev_kpi_measurements.source`, `.env` and `dev_kpis.status` all carry
    // CHECKs.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goals.status_check",
            description: "constrain dev_goals.status to the canonical set (table rebuild)",
            already_applied: |conn| {
                if !has_table(conn, "dev_goals")? {
                    return Ok(true);
                }
                if !has_column(conn, "dev_goals", "status")? {
                    return Ok(true);
                }
                let sql: String = conn.query_row(
                    "SELECT COALESCE(sql, '') FROM sqlite_master
                     WHERE type='table' AND name='dev_goals'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(sql.contains("CHECK(status IN"))
            },
            apply: constrain_goal_status_to_canonical_set,
        },
    )?;

    // MUST stay in `run_incremental` (phase 2). `mcp_gateway_members` is created
    // in `ensure_composite_fires_table`, which `initial::run` calls in phase 1 —
    // i.e. BEFORE this function, despite sitting BELOW it in this file. A
    // rebuild placed in that tail would run before the table it rebuilds exists
    // and silently no-op. That inversion is what produced the bug being fixed
    // here in the first place.
    run_step(
        conn,
        IncrementalMigration {
            id: "mcp_gateway_members.credentials_fk",
            description: "Repoint mcp_gateway_members foreign keys from the phantom \
                          `credentials` table to `persona_credentials`",
            already_applied: |conn| {
                // Nothing to repair if the table is absent (it is created in
                // phase 1, so this is only reachable on an unusual database).
                if !has_table(conn, "mcp_gateway_members")? {
                    return Ok(true);
                }
                Ok(dangling_fk_count(conn, "mcp_gateway_members")? == 0)
            },
            apply: repoint_mcp_gateway_members_fk,
        },
    )?;

    Ok(())
}

/// Ensure the composite_trigger_fires table exists for persisting suppression state.
pub fn ensure_composite_fires_table(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS composite_trigger_fires (
            trigger_id  TEXT PRIMARY KEY,
            fired_at    TEXT NOT NULL
        );",
    )?;
    // -- Artist plugin tables -------------------------------------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS artist_assets (
            id              TEXT PRIMARY KEY,
            file_name       TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            asset_type      TEXT NOT NULL CHECK(asset_type IN ('2d','3d')),
            mime_type       TEXT,
            file_size       INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            thumbnail_path  TEXT,
            tags            TEXT,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_artist_assets_type ON artist_assets(asset_type);
        CREATE INDEX IF NOT EXISTS idx_artist_assets_created ON artist_assets(created_at);

        -- Deduplicate before creating unique index (keep earliest row per file_path)
        DELETE FROM artist_assets WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM artist_assets GROUP BY file_path
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_assets_path ON artist_assets(file_path);

        CREATE TABLE IF NOT EXISTS artist_tags (
            id              TEXT PRIMARY KEY,
            asset_id        TEXT NOT NULL REFERENCES artist_assets(id) ON DELETE CASCADE,
            tag             TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_artist_tags_asset ON artist_tags(asset_id);
        CREATE INDEX IF NOT EXISTS idx_artist_tags_tag ON artist_tags(tag);",
    )?;

    // ── Obsidian Brain: Sync State & Log ─────────────────────────────
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS obsidian_sync_state (
            id              TEXT PRIMARY KEY,
            entity_type     TEXT NOT NULL,
            entity_id       TEXT NOT NULL,
            vault_file_path TEXT NOT NULL,
            content_hash    TEXT NOT NULL,
            sync_direction  TEXT NOT NULL,
            synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(entity_type, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_obsidian_sync_entity ON obsidian_sync_state(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS obsidian_sync_log (
            id              TEXT PRIMARY KEY,
            sync_type       TEXT NOT NULL,
            entity_type     TEXT NOT NULL,
            entity_id       TEXT,
            vault_file_path TEXT,
            action          TEXT NOT NULL,
            details         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_obsidian_sync_log_created ON obsidian_sync_log(created_at DESC);"
    )?;

    // Companion (Athena) tables live in the user database, not the system
    // database. See `db::COMPANION_SCHEMA` and `db::init_user_db`.

    // -- MCP gateway membership ------------------------------------------------
    // Bundles multiple MCP-speaking credentials under one "gateway" credential so
    // that attaching the gateway to a persona inherits every member's tools. Added
    // 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern (finding #1
    // from /research run on the same date, see .planning/handoffs/2026-04-08-
    // mcp-gateway-arcade.md for the full phase plan).
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS mcp_gateway_members (
            id                      TEXT PRIMARY KEY,
            gateway_credential_id   TEXT NOT NULL,
            member_credential_id    TEXT NOT NULL,
            display_name            TEXT NOT NULL,
            enabled                 INTEGER NOT NULL DEFAULT 1,
            sort_order              INTEGER NOT NULL DEFAULT 0,
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            -- The credentials table is `persona_credentials`. `credentials`
            -- does not exist and never has; SQLite resolves FK targets lazily,
            -- so this CREATE succeeded and every INSERT raised `no such table:
            -- main.credentials` under `foreign_keys = ON` instead. Existing
            -- installs are repaired by `repoint_mcp_gateway_members_fk` at the
            -- end of `run_incremental` (phase 2).
            FOREIGN KEY (gateway_credential_id) REFERENCES persona_credentials(id) ON DELETE CASCADE,
            FOREIGN KEY (member_credential_id) REFERENCES persona_credentials(id) ON DELETE CASCADE,
            UNIQUE (gateway_credential_id, member_credential_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_gw ON mcp_gateway_members(gateway_credential_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_member ON mcp_gateway_members(member_credential_id);"
    )?;

    // -- JIT OAuth scaffolding on executions: REMOVED 2026-08-13 ---------------
    // Three `ALTER TABLE executions ADD COLUMN pending_auth_{url,started_at,
    // credential_id}` statements lived here, swallowed by `let _ = ddl_step(…)`.
    // There is no `executions` table (it is `persona_executions`), so all three
    // failed on every boot of every install since 2026-04-08 and the columns
    // have never existed anywhere.
    //
    // Deleted rather than corrected to `persona_executions`, decided from what
    // the code reads: `pending_auth_url` / `pending_auth_started_at` /
    // `pending_auth_credential_id` have ZERO readers and ZERO writers anywhere
    // in the tree — no Rust, no TypeScript, no SQL. The feature that actually
    // shipped, `PendingAuthModal.tsx`, takes its `credential_id` / `tool_name` /
    // `authorize_url` from the `AppError::AuthorizationRequired` error envelope
    // (`extractPendingAuthDetails`), which needs no persistence at all, and the
    // `AwaitingAuth` execution state the columns were scaffolding for was never
    // added to the `ExecutionState` lifecycle. Correcting the table name would
    // have added three permanently-NULL columns to the hottest table in the app.
    // If the runner pause/resume integration is ever built (see
    // `.planning/handoffs/2026-04-08-mcp-gateway-arcade.md` Phase B), it adds
    // its own guarded `run_step` against `persona_executions` at that time.

    // -- Lab: Consensus (stochastic multi-run agreement) ----------------------
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS lab_consensus_runs (
            id              TEXT PRIMARY KEY,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            status          TEXT NOT NULL DEFAULT 'generating',
            num_samples     INTEGER NOT NULL DEFAULT 5,
            model_id        TEXT NOT NULL DEFAULT '',
            scenarios_count INTEGER NOT NULL DEFAULT 0,
            use_case_filter TEXT,
            agreement_rate  REAL,
            summary         TEXT,
            llm_summary     TEXT,
            progress_json   TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lab_consensus_runs_persona ON lab_consensus_runs(persona_id);

        CREATE TABLE IF NOT EXISTS lab_consensus_results (
            id                   TEXT PRIMARY KEY,
            run_id               TEXT NOT NULL REFERENCES lab_consensus_runs(id) ON DELETE CASCADE,
            sample_index         INTEGER NOT NULL DEFAULT 0,
            scenario_name        TEXT NOT NULL,
            model_id             TEXT NOT NULL,
            provider             TEXT NOT NULL DEFAULT '',
            status               TEXT NOT NULL DEFAULT 'pending',
            output_preview       TEXT,
            -- tool_calls_expected/actual retired in lab_tool_calls ADR.
            tool_accuracy_score  INTEGER,
            output_quality_score INTEGER,
            protocol_compliance  INTEGER,
            input_tokens         INTEGER NOT NULL DEFAULT 0,
            output_tokens        INTEGER NOT NULL DEFAULT 0,
            cost_usd             REAL NOT NULL DEFAULT 0.0,
            duration_ms          INTEGER NOT NULL DEFAULT 0,
            rationale            TEXT,
            suggestions          TEXT,
            error_message        TEXT,
            created_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lab_consensus_results_run ON lab_consensus_results(run_id);",
    )?;

    // -- dev_tasks: depth column (quick / campaign / deep_build) ---------------
    ddl_step(conn, "ALTER TABLE dev_tasks ADD COLUMN depth TEXT NOT NULL DEFAULT 'quick';")
        .ok(); // ok() — column may already exist

    // -- dev_tasks: retry lineage (parent_task_id + attempt) ------------------
    // A retry used to be an unrelated task with a `[Retry] ` title prefix, so
    // nothing linked attempt N to attempt N-1 and the prefix accumulated into
    // the executor's prompt. Lineage is now structural. Same `.ok()` idiom as
    // `depth` above: both are also mirrored in the fresh schema, so on a new
    // database these ALTERs are expected to be duplicate-column no-ops.
    ddl_step(conn, "ALTER TABLE dev_tasks ADD COLUMN parent_task_id TEXT;").ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_tasks ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;",
    )
    .ok();

    // -- dev_projects: monitoring connector fields ----------------------------
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN monitoring_credential_id TEXT;")
        .ok();
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN monitoring_project_slug TEXT;")
        .ok();

    // -- dev_projects: LLM-observability connector slot -----------------------
    // A dedicated credential pointer for LLM tracking (Langfuse / Helicone /
    // LangSmith / …), kept distinct from `monitoring_credential_id` (app
    // monitoring). Nullable; set via dev_tools_update_project. Added 2026-06-23.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN llm_tracking_credential_id TEXT;")
        .ok();

    // -- dev_projects: customer-support connector slot + data-analysis links --
    // `support_credential_id`: credential pointer for the incoming customer-
    // support channel (Discord / Gmail / Outlook …) — drives the passport's
    // Support dimension. `data_links`: JSON array of related dev_project ids
    // whose codebase post-processes this project's data (user-declared for
    // now; a future scan may propose them) — drives the passport's
    // Data-analysis dimension. Both nullable; set via dev_tools_update_project.
    // Added 2026-07-23.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN support_credential_id TEXT;")
        .ok();
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN data_links TEXT;").ok();

    // -- dev_projects: static_scan_config -------------------------------------
    // JSON envelope { tool: "fallow"|"knip"|..., command: [..argv..] } that
    // configures which static-analysis CLI the static_scan runner spawns for
    // this project. Sibling to the LLM-driven idea_scanner — see
    // commands/infrastructure/static_scan.rs.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN static_scan_config TEXT;")
        .ok();

    // -- dev_projects: auto-PR-on-success gate + GitHub credential pointer ---
    // When `auto_pr_on_success = 1` and a task ran inside a worktree, the
    // task_executor's success branch pushes the worktree branch and opens a
    // PR via `engine/platforms/github.rs::GitHubClient::create_pull_request`.
    // The credential is resolved from `pr_credential_id`. Both columns are
    // nullable / default-off so existing projects are unaffected.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN auto_pr_on_success INTEGER NOT NULL DEFAULT 0;")
        .ok();
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN pr_credential_id TEXT;")
        .ok();

    // -- dev_projects: living test environment (URL + branch the team delivers into)
    // Both nullable / no default so existing projects are unaffected. Set later
    // via dev_tools_update_project once the team has a running test env to point at.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN test_env_url TEXT;")
        .ok();
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN test_env_branch TEXT;")
        .ok();

    // -- dev_projects: primary/default branch (the source-control pipeline stage's
    // baseline, e.g. `main`/`master`). Nullable / no default; set via
    // dev_tools_update_project. Existing projects unaffected.
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN main_branch TEXT;")
        .ok();

    // -- dev_projects: standards & branching policy (Pipeline Stage 3). Opaque
    // JSON envelope { precommit, branching } set via dev_tools_set_standards_config;
    // the connected team's personas must respect it. Nullable / no default.
    // -- dev_ideas: strategist triage rank (1 = do next). Written by the
    // backlog-triage job (Product Strategist); backlog_to_goal promotes ranked
    // ideas first. Nullable — unranked ideas fall back to impact/effort order.
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN priority INTEGER;").ok();

    // -- dev_ideas: the FINDINGS SPINE (docs/plans/dev-findings-loop.md §3 2A).
    // An idea is no longer only a scanner proposal — every sensor (golden-standard
    // scan, passport gap, LLM cost, Sentry spike, off-track KPI) emits into this
    // table so the existing triage → task → PR → scoreboard machinery becomes
    // multi-sensor. All four columns are additive and nullable; a NULL `origin`
    // IS a classic Idea-Scanner idea, so every existing row and call site keeps
    // working untouched.
    //   origin      — 'standards_finding' | 'passport_gap' | 'llm_cost'
    //                 | 'sentry_spike' | 'kpi_offtrack' (validated in Rust).
    //   use_case_id — the emitting signal's use case. Orphan-tolerant, no FK
    //                 (same rationale as dev_projects.team_id).
    //   evidence    — JSON blob: the raw numbers that justified emission. Phase 3's
    //                 verification probe re-measures against these, so they must
    //                 stay comparable.
    //   dedup_key   — stable per underlying signal ('sentry:<shortId>',
    //                 'standards:<rule_key>', …). Idempotent emission: a sweep
    //                 never re-raises a finding that already exists in ANY status,
    //                 including `rejected` — a human "no" is durable.
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN origin TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN use_case_id TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN evidence TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN dedup_key TEXT;").ok();
    // (The non-unique idx_dev_ideas_dedup this step used to create was replaced
    // by the partial UNIQUE index below — see the dedup-TOCTOU block.)

    // -- dev_ideas: VERIFICATION (docs/plans/dev-findings-loop.md §7, Phase 3A).
    // Nothing in the app checked whether shipped work moved the number that raised
    // the finding — "merged" was silently treated as "fixed". These close that:
    //   verify_state     — 'pending' | 'cleared' | 'moved' | 'unchanged' | 'regressed'.
    //                      NULL/pending = not yet judged. `unchanged` and `regressed`
    //                      are first-class outcomes, surfaced as loudly as `cleared`.
    //   verify_checked_at— when the last verdict was taken.
    //   verify_evidence  — the RE-MEASURED reading (same shape as `evidence`), so a
    //                      verdict can be audited: before vs after, side by side.
    // The probe is the sweep itself: emitters only fire when a signal is OVER
    // threshold, so a fresh emit that no longer carries the finding's dedup_key means
    // the signal is gone (= cleared).
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN verify_state TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN verify_checked_at TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN verify_evidence TEXT;").ok();

    // -- GAP-W2 (double-advance TOCTOU): at most ONE active assignment per
    // goal, enforced at the DB level. advance_goal's guard reads, then spends
    // seconds in LLM decomposition, then creates — two near-simultaneous
    // initiations (manual + autonomous tick, or two ticks) both passed the
    // stale guard and double-implemented the same goal. The partial unique
    // index makes the second create fail instead.
    ddl_step(
        conn,
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_assignment_per_goal
         ON team_assignments(goal_id)
         WHERE goal_id IS NOT NULL AND status IN ('queued','running','awaiting_review');",
    )
    .ok();

    // -- dedup_key TOCTOU (same class as GAP-W2 above): create_idea_deduped /
    // create_finding used a COUNT-then-INSERT guard with no transaction — two
    // concurrent sweeps both passed and both inserted. DB-enforce it, the way
    // audit_incidents.dedup_key already is. Hand-written ideas carry NULL
    // dedup_key (SQLite treats NULLs as distinct), so the partial index is
    // safe. First null-out any later duplicates a past race already produced
    // (keep the oldest row), or the index creation would fail.
    conn.execute(
        "UPDATE dev_ideas SET dedup_key = NULL
          WHERE dedup_key IS NOT NULL
            AND rowid NOT IN (
              SELECT MIN(rowid) FROM dev_ideas
               WHERE dedup_key IS NOT NULL
               GROUP BY project_id, dedup_key)",
        [],
    )
    .ok();
    ddl_step(
        conn,
        "DROP INDEX IF EXISTS idx_dev_ideas_dedup;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_ideas_dedup_unique
             ON dev_ideas(project_id, dedup_key)
             WHERE dedup_key IS NOT NULL;",
    )
    .ok();

    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN standards_config TEXT;")
        .ok();

    // -- dev_standards: per-rule compliance findings from the golden-standard
    // LLM scan (Pipeline Stage 3b). One row per rule the scan checks.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_standards (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            scan_id       TEXT,
            rule_key      TEXT NOT NULL,
            category      TEXT NOT NULL,
            title         TEXT NOT NULL,
            status        TEXT NOT NULL,
            severity      TEXT NOT NULL DEFAULT 'info',
            evidence      TEXT,
            recommendation TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
         CREATE INDEX IF NOT EXISTS idx_dev_standards_project ON dev_standards(project_id);",
    )
    .ok();

    // -- audit_incidents: auto-continuation guard (P2.3b).
    // Nullable timestamp stamped when the incident-continuation reactive loop
    // re-runs the blocked work. NULL = not yet continued. The consumer claims a
    // resolved persona_blocker incident atomically via
    // `UPDATE ... SET continued_at = ? WHERE id = ? AND continued_at IS NULL`,
    // so a tick can never double-fire a re-run. Idempotent ALTER (re-run safe).
    ddl_step(conn, "ALTER TABLE audit_incidents ADD COLUMN continued_at TEXT;")
        .ok();

    // ── Composition Workflows (persisted DAG definitions) ───────────────
    // Migrates workflows from frontend localStorage to backend SQLite.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS composition_workflows (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            nodes_json       TEXT NOT NULL DEFAULT '[]',
            edges_json       TEXT NOT NULL DEFAULT '[]',
            input_schema_json TEXT,
            enabled          INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_composition_workflows_enabled ON composition_workflows(enabled);
        CREATE INDEX IF NOT EXISTS idx_composition_workflows_updated ON composition_workflows(updated_at);"
    )?;

    // -- Twin plugin: digital twin profiles (P0) -----------------------------
    // First slice of the Twin plugin. Multi-twin from day one (the user can
    // have a Founder Twin and a Personal Twin); exactly one is_active row is
    // resolved by the `builtin-twin` connector when a persona invokes a twin
    // tool. Tone, voice, channels, and memory tables land in P1-P4. The slug
    // is unique because it doubles as the Obsidian vault subfolder name.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_profiles (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            slug            TEXT NOT NULL UNIQUE,
            bio             TEXT,
            role            TEXT,
            languages       TEXT,
            pronouns        TEXT,
            obsidian_subpath TEXT NOT NULL,
            is_active       INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_twin_profiles_active ON twin_profiles(is_active);",
    )?;

    // -- Twin plugin: per-channel tone profiles (P1) -------------------------
    // Each twin can speak differently on each channel. The `generic` row is
    // the default fallback. UNIQUE(twin_id, channel) enforces at most one
    // tone per (twin, channel) pair.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_tones (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT NOT NULL DEFAULT 'generic',
            voice_directives TEXT NOT NULL DEFAULT '',
            examples_json   TEXT,
            constraints_json TEXT,
            length_hint     TEXT,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(twin_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_twin_tones_twin ON twin_tones(twin_id);",
    )?;

    // -- Twin plugin: knowledge_base_id on profiles (P2) ---------------------
    // `has_column` rather than a discarded Result: the guard removes the
    // "duplicate column" re-run error this used to absorb, so a real failure is
    // no longer indistinguishable from a successful no-op. `twin_profiles` is
    // created a few steps above in this same function, so it always exists here.
    if !has_column(conn, "twin_profiles", "knowledge_base_id")? {
        ddl_step(conn, "ALTER TABLE twin_profiles ADD COLUMN knowledge_base_id TEXT;")?;
    }

    // -- Twin plugin: persistent training directives (D5 — self-sharpening) --
    // Free-text "training style guide" per twin. The Training Studio seeds its
    // Directions box from this and can save edits back; every question/answer
    // generation prepends it so the studio learns the user's taste instead of
    // restating it each session.
    if !has_column(conn, "twin_profiles", "training_directives")? {
        ddl_step(
            conn,
            "ALTER TABLE twin_profiles ADD COLUMN training_directives TEXT;",
        )?;
    }

    // -- Twin plugin: pending memories inbox (P2) ----------------------------
    // Human-approval gate for memories. record_interaction writes here; the
    // user approves/rejects in the Knowledge tab. Approved memories get
    // ingested into the twin's knowledge base.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_pending_memories (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT,
            content         TEXT NOT NULL,
            title           TEXT,
            importance      INTEGER NOT NULL DEFAULT 3,
            status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
            reviewer_notes  TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_twin_pending_twin ON twin_pending_memories(twin_id);
        CREATE INDEX IF NOT EXISTS idx_twin_pending_status ON twin_pending_memories(status);"
    )?;

    // -- Twin plugin: communication log (P2) ---------------------------------
    // Interaction log — what the twin said and received across channels.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_communications (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT NOT NULL,
            direction       TEXT NOT NULL DEFAULT 'out' CHECK(direction IN ('in','out')),
            contact_handle  TEXT,
            content         TEXT NOT NULL,
            summary         TEXT,
            key_facts_json  TEXT,
            occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_twin_comms_twin ON twin_communications(twin_id);
        CREATE INDEX IF NOT EXISTS idx_twin_comms_occurred ON twin_communications(occurred_at DESC);"
    )?;

    // -- Twin plugin: voice profiles (P3) ------------------------------------
    // One voice config per twin. Stores the provider, voice_id, and synthesis
    // parameters. UNIQUE(twin_id) enforces one voice per twin.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_voice_profiles (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL UNIQUE REFERENCES twin_profiles(id) ON DELETE CASCADE,
            provider        TEXT NOT NULL DEFAULT 'elevenlabs',
            credential_id   TEXT,
            voice_id        TEXT NOT NULL,
            model_id        TEXT,
            stability       REAL NOT NULL DEFAULT 0.5,
            similarity_boost REAL NOT NULL DEFAULT 0.75,
            style           REAL NOT NULL DEFAULT 0.0,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Twin plugin: channel bindings (P4) ----------------------------------
    // Maps a twin to its deployment channels. Each row = one channel where
    // the twin speaks, via a credential (e.g. Discord bot token) and
    // optionally a persona that operates there.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_channels (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel_type    TEXT NOT NULL,
            credential_id   TEXT NOT NULL,
            persona_id      TEXT,
            label           TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(twin_id, channel_type, credential_id)
        );
        CREATE INDEX IF NOT EXISTS idx_twin_channels_twin ON twin_channels(twin_id);",
    )?;

    // -- eval_method column on all lab result tables ----------------------------
    // Tracks whether scores came from full LLM evaluation, heuristic fallback, or timeout.
    for table in &[
        "lab_arena_results",
        "lab_ab_results",
        "lab_matrix_results",
        "lab_eval_results",
    ] {
        let _ = ddl_step(conn, &format!("ALTER TABLE {table} ADD COLUMN eval_method TEXT;"));
    }

    // -- adoption_answers column on build_sessions --------------------------------
    // Stores questionnaire answers so they flow into test + promote pipelines.
    let has_adoption_answers: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('build_sessions') WHERE name = 'adoption_answers'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_adoption_answers {
        ddl_step(conn, "ALTER TABLE build_sessions ADD COLUMN adoption_answers TEXT;")?;
        tracing::info!("Added adoption_answers column to build_sessions");
    }

    // -- traceparent column on persona_executions (CLI 2.1.110 TRACEPARENT) ------
    // W3C traceparent generated per execution and injected into the spawned CLI's
    // env so personas' own span tree can be correlated with the CLI's internal
    // API/tool call spans by downstream observability pipelines.
    let has_traceparent: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'traceparent'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_traceparent {
        ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN traceparent TEXT;")?;
        tracing::info!("Added traceparent column to persona_executions");
    }

    // -- last_test_report column on personas (A-grade Phase 2) -------------------
    // Stores the JSON test report from `test_build_draft`'s last run so the
    // UI's TestReportModal can render real per-tool / per-connector results
    // *after* promote, and so the rapid-validation suite's
    // `acceptance.tool_tests` gate has something to read. Pre-Phase-2 the
    // report was returned inline by `triggerBuildTest` and never persisted —
    // navigating away dropped it. See
    // `docs/concepts/persona-capabilities/13-rapid-validation-personas.md`
    // §"Phase 2 (test-pass visibility)".
    let has_last_test_report: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'last_test_report'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_last_test_report {
        ddl_step(conn, "ALTER TABLE personas ADD COLUMN last_test_report TEXT;")?;
        tracing::info!("Added last_test_report column to personas");
    }

    // -- Phase 5 v1: CLI session-resume awareness opt-in -----------------------
    // Per-persona gate for reading the user's active Claude CLI transcript and
    // injecting recent turns as a prompt prefix (alongside Phase 3 c ambient
    // context). Defaults to 0 (OFF) — must be paired with the global
    // cli_session toggle on AmbientContextFusion to actually fire.
    // See docs/features/companion/athena-cli-session-awareness.md.
    let has_cli_awareness: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'cli_awareness_enabled'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_cli_awareness {
        ddl_step(
                    conn,
                            "ALTER TABLE personas ADD COLUMN cli_awareness_enabled INTEGER NOT NULL DEFAULT 0;",
        )?;
        tracing::info!("Added cli_awareness_enabled column to personas (Phase 5 v1)");
    }

    // -- Per-persona Langfuse export gate ---------------------------------------
    // Default 1 (ON): existing personas continue exporting traces if the user
    // has the Langfuse plugin enabled and a connection configured. The toggle
    // on the persona settings tab lets users opt INDIVIDUAL personas out of
    // export — useful for personas handling sensitive content the user doesn't
    // want shipped, even when the plugin's global redact_content is off.
    let has_langfuse_export: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'langfuse_export_enabled'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_langfuse_export {
        conn.execute_batch(
            "ALTER TABLE personas ADD COLUMN langfuse_export_enabled INTEGER NOT NULL DEFAULT 1;",
        )?;
        tracing::info!("Added langfuse_export_enabled column to personas");
    }

    // -- Drop retired desktop-bridge catalog entries -----------------------------
    // `desktop_terminal` and `desktop_vscode` were removed from the credential
    // catalog; existing installs may still have the seeded rows. Remove them so
    // they stop appearing in the picker. Only builtin rows are touched — any
    // user credentials referencing them via the canonical tables remain intact.
    conn.execute(
        "DELETE FROM connector_definitions WHERE name IN ('desktop_terminal','desktop_vscode') AND is_builtin = 1",
        [],
    )?;

    // -- Resource scoping: scoped_resources blob on persona_credentials ----------
    // Post-auth picker stores user-selected sub-resources (GitHub repos, Supabase
    // projects, Google Drive folders, etc.) as a JSON blob alongside the credential.
    // Plaintext (not field-level encrypted) because identifiers are not secrets;
    // the auth fields that grant access live in credential_fields and stay
    // encrypted. Default NULL = broad scope (feature is opt-in; existing rows are
    // unaffected).
    let has_scoped_resources: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_credentials') WHERE name = 'scoped_resources'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_scoped_resources {
        ddl_step(conn, "ALTER TABLE persona_credentials ADD COLUMN scoped_resources TEXT;")?;
        tracing::info!("Added scoped_resources column to persona_credentials");
    }

    // -- Connector resources spec: resources column on connector_definitions -----
    // JSON array describing how to list user-pickable sub-resources (repos,
    // projects, etc.). Seeded from scripts/connectors/builtin/*.json `resources[]`.
    // See src-tauri/src/db/models/connector.rs for the typed shape.
    let has_connector_resources: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('connector_definitions') WHERE name = 'resources'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_connector_resources {
        ddl_step(conn, "ALTER TABLE connector_definitions ADD COLUMN resources TEXT;")?;
        tracing::info!("Added resources column to connector_definitions");
    }

    // -- Lab: per-result event stream (typed sequence captured during lab runs) --
    // Each lab scenario produces a stream of typed events (assistant text, tool
    // use with args, tool result, system_init, result). The lab result table
    // stores only aggregate scores + tool name list; events sit in a sidecar
    // table so the ScenarioDetailPanel can render the actual conversation when
    // a row scored low. result_kind disambiguates which lab table the
    // result_id points at (eval/ab/arena/matrix/consensus). Forward-only —
    // older results have no events. Truncated payloads at the boundary so a
    // single chatty scenario can't blow up the DB.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS lab_result_events (
            id                  TEXT PRIMARY KEY,
            result_id           TEXT NOT NULL,
            result_kind         TEXT NOT NULL,
            event_index         INTEGER NOT NULL,
            event_type          TEXT NOT NULL,
            tool_name           TEXT,
            tool_args_preview   TEXT,
            tool_result_preview TEXT,
            text_preview        TEXT,
            ts_ms_relative      INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lab_result_events_lookup
            ON lab_result_events(result_kind, result_id, event_index);",
    )?;

    // -- Dev Tools: per-file content-hash cache for incremental rescan ----------
    // Populated by `commands/infrastructure/context_generation.rs` after a
    // successful scan. On the next scan, `commands/infrastructure/incremental_scan.rs`
    // diffs the live file tree against this table and feeds the LLM only the
    // {added, modified, deleted} delta — unchanged regions short-circuit. PK is
    // (project_id, file_path) because file_path is unique per project but the
    // same relative path may exist in multiple projects.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS dev_context_file_hashes (
            project_id          TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            file_path           TEXT NOT NULL,
            sha256              TEXT NOT NULL,
            size_bytes          INTEGER NOT NULL DEFAULT 0,
            last_extracted_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, file_path)
        );
        CREATE INDEX IF NOT EXISTS idx_dev_context_file_hashes_project
            ON dev_context_file_hashes(project_id);",
    )?;

    // -- System-operation automations -------------------------------------------
    // A trigger (schedule cron OR event listener) bound to a built-in system
    // operation (NOT a persona execution). First op: `context_scan` (re-derive a
    // dev-tools project's context map). Committed by the Chain Studio when a
    // route runs `schedule|event → System event`, and by the Context Map "Plan
    // update" button. The background event-bus tick runs due schedule rows and
    // matches event rows; see `engine/system_ops.rs`.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS system_op_automations (
            id                  TEXT PRIMARY KEY,
            op_kind             TEXT NOT NULL,
            params_json         TEXT NOT NULL DEFAULT '{}',
            trigger_kind        TEXT NOT NULL,
            cron                TEXT,
            timezone            TEXT,
            listen_event_type   TEXT,
            source_filter       TEXT,
            enabled             INTEGER NOT NULL DEFAULT 1,
            next_run_at         TEXT,
            last_run_at         TEXT,
            last_status         TEXT,
            last_detail         TEXT,
            label               TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_system_op_automations_due
            ON system_op_automations(trigger_kind, enabled, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_system_op_automations_event
            ON system_op_automations(trigger_kind, enabled, listen_event_type);",
    )?;

    // `unattended_mode` (`auto` | `approval`): the safety gate for system-op
    // automations that act on production signal (the signal-dispatch ops).
    // `approval` holds the run (`last_status = "held"`) instead of dispatching;
    // the human dispatches from Triage. Default `auto` preserves the behavior
    // existing rows already had.
    if !has_column(conn, "system_op_automations", "unattended_mode")? {
        ddl_step(
            conn,
            "ALTER TABLE system_op_automations ADD COLUMN unattended_mode TEXT NOT NULL DEFAULT 'auto';",
        )?;
    }

    // -- Research Lab plugin: defensive column ALTERs ---------------------------
    // The research_* tables are created with CREATE TABLE IF NOT EXISTS in
    // initial.rs. If a legacy DB has any of these tables with a drifted column
    // set (e.g. created before obsidian_vault_path was added), the SELECT
    // statements in db/repos/research_lab.rs will fail with
    // "no such column: <name>" and the UI surfaces "Database error: ..." on
    // every fetch/create. The block below idempotently brings legacy schemas
    // up to the current expected shape. Each ALTER is wrapped in `let _ =`
    // because SQLite errors on duplicate column names — that error is the
    // success path on already-migrated DBs.
    research_lab_align_columns(conn);

    // Reconcile the two clashing `dev_ideas.category` vocabularies into the
    // single canonical `IdeaCategory` enum. Idempotent — every reboot is a
    // no-op once the rows have been migrated. See `IdeaCategory` doc.
    super::helpers::reconcile_idea_category_vocabulary(conn)?;

    // Re-install the persona_memories.importance trigger so the
    // 1..=5 bound is enforced at the DB layer regardless of whether a
    // future code path bypasses `validate_importance`. See MEMORY CONTRACT (4)
    // on `db::models::PersonaMemory`.
    super::helpers::install_persona_memory_invariants(conn)?;

    // -- Lab: lab_tool_calls child table (1:N replaces JSON-array columns) -----
    // Replaces tool_calls_expected/actual JSON columns scattered across 5 lab
    // result tables + persona_test_runs. Lets future analytics query by
    // tool_name (e.g. "tool-call accuracy aggregated by tool"). Backfill,
    // dual-write, and column drop happen in subsequent steps of the same ADR.
    //
    // No FK on result_id yet: the parent tables share no common parent type and
    // the FK-hygiene ADR (2026-05-02-fk-hygiene-cascade) will retrofit FKs
    // table-by-table once it ships.
    //
    // ADR: 2026-05-02-lab-tool-calls-child-table.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS lab_tool_calls (
            id           TEXT PRIMARY KEY,
            result_kind  TEXT NOT NULL CHECK(result_kind IN ('arena','ab','matrix','consensus','eval','test_run')),
            result_id    TEXT NOT NULL,
            sequence     INTEGER NOT NULL,
            tool_name    TEXT NOT NULL,
            variant      TEXT NOT NULL CHECK(variant IN ('expected','actual')),
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(result_id, variant, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_lab_tool_calls_result ON lab_tool_calls(result_kind, result_id);
        CREATE INDEX IF NOT EXISTS idx_lab_tool_calls_tool ON lab_tool_calls(tool_name);"
    )?;
    backfill_lab_tool_calls(conn)?;
    drop_legacy_tool_calls_columns(conn);

    // FK hygiene: retrofit ON DELETE CASCADE / SET NULL onto child tables
    // that were originally created without REFERENCES clauses. Each table
    // is rebuilt independently and idempotently.
    // ADR: 2026-05-02-fk-hygiene-cascade.
    super::fk_hygiene::run(conn)?;

    // -- Team assignments (Phase A orchestration) --------------------------------
    // Goal-driven workflows on top of PersonaTeams. An assignment is a top-level
    // goal; steps form a DAG (depends_on JSON array of step ids). The
    // team_assignment_orchestrator engine module walks the DAG, kicks off
    // persona executions, and surfaces failures through the existing
    // notification center for human review. Capabilities resolve to existing
    // DesignUseCase[] on persona.design_context — no capability_tags column.
    //
    // Phase A: manual matching only (user picks persona at composer time).
    // Phase B will add embedding + llm_eval strategies.
    // Phase C will populate companion_op_id from Athena dispatcher.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignments (
            id                  TEXT PRIMARY KEY,
            team_id             TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            goal                TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'queued'
                                CHECK(status IN ('queued','running','awaiting_review','done','failed','aborted')),
            match_strategy      TEXT NOT NULL DEFAULT 'manual'
                                CHECK(match_strategy IN ('manual','embedding','llm_eval')),
            max_parallel_steps  INTEGER NOT NULL DEFAULT 3,
            source              TEXT NOT NULL DEFAULT 'team_ui'
                                CHECK(source IN ('team_ui','athena','api')),
            companion_op_id     TEXT,
            goal_id             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            started_at          TEXT,
            completed_at        TEXT,
            error_message       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignments_team
            ON team_assignments(team_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_team_assignments_status
            ON team_assignments(status) WHERE status IN ('queued','running','awaiting_review');",
    )?;

    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_steps (
            id                    TEXT PRIMARY KEY,
            assignment_id         TEXT NOT NULL REFERENCES team_assignments(id) ON DELETE CASCADE,
            step_order            INTEGER NOT NULL,
            title                 TEXT NOT NULL,
            description           TEXT,
            status                TEXT NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','matching','running','awaiting_review','done','skipped','failed')),
            assigned_persona_id   TEXT REFERENCES personas(id) ON DELETE SET NULL,
            assigned_use_case_id  TEXT,
            match_confidence      REAL,
            match_rationale       TEXT,
            execution_id          TEXT REFERENCES persona_executions(id) ON DELETE SET NULL,
            depends_on            TEXT,
            output_summary        TEXT,
            retry_count           INTEGER NOT NULL DEFAULT 0,
            error_message         TEXT,
            started_at            TEXT,
            completed_at          TEXT,
            UNIQUE(assignment_id, step_order)
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_steps_assignment
            ON team_assignment_steps(assignment_id, step_order);
        CREATE INDEX IF NOT EXISTS idx_team_assignment_steps_status
            ON team_assignment_steps(assignment_id, status);",
    )?;

    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_events (
            id              TEXT PRIMARY KEY,
            assignment_id   TEXT NOT NULL REFERENCES team_assignments(id) ON DELETE CASCADE,
            step_id         TEXT REFERENCES team_assignment_steps(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL,
            payload         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_events_assignment
            ON team_assignment_events(assignment_id, created_at);",
    )?;

    // -- Goals hub: link team assignments to a dev goal --------------------------
    // A linked assignment advances a `dev_goals` row: its step checklist + states
    // surface on the goal, and terminal/step transitions write `dev_goal_signals`.
    // Soft link (plain TEXT, no FK) to match the codebase's ALTER style and keep
    // fresh-install (CREATE block above) and migrated schemas identical.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_assignments.goal_id",
            description: "Link team assignments to a dev goal (goals hub)",
            already_applied: |conn| has_column(conn, "team_assignments", "goal_id"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE team_assignments ADD COLUMN goal_id TEXT;")?;
                Ok(())
            },
        },
    )?;

    // -- Goals hub: lightweight ad-hoc checklist items on a dev goal -------------
    // Composed alongside sub-goals + linked-assignment steps into the goal's
    // unified checklist. Heavier breakdown stays in dev_goals (parent_goal_id).
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goal_items",
            description: "Lightweight checklist items on a dev goal (goals hub)",
            already_applied: |conn| has_table(conn, "dev_goal_items"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_goal_items (
                        id          TEXT PRIMARY KEY,
                        goal_id     TEXT NOT NULL REFERENCES dev_goals(id) ON DELETE CASCADE,
                        title       TEXT NOT NULL,
                        done        INTEGER NOT NULL DEFAULT 0,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_goal_items_goal
                        ON dev_goal_items(goal_id, order_index);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Team assignment templates (Phase C4) ------------------------------------
    // A saved, reusable assignment shape: title + goal + match strategy +
    // parallelism + the full step list (stored as a JSON array of
    // CreateTeamAssignmentStepInput). Instantiating a template clones it into
    // a fresh team_assignments row. Scoped per team (FK CASCADE) so a deleted
    // team takes its templates with it. No FK from instantiated assignments
    // back to the template — a template is a stamp, not a parent.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_templates (
            id                  TEXT PRIMARY KEY,
            team_id             TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            goal                TEXT NOT NULL,
            match_strategy      TEXT NOT NULL DEFAULT 'manual'
                                CHECK(match_strategy IN ('manual','embedding','llm_eval')),
            max_parallel_steps  INTEGER NOT NULL DEFAULT 3,
            steps_json          TEXT NOT NULL DEFAULT '[]',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_templates_team
            ON team_assignment_templates(team_id, updated_at DESC);",
    )?;

    // -- KPI layer (docs/plans/kpi-driven-orchestration.md P0) -------------------
    // KPIs are the outcome layer above goals: per-project (or per context group)
    // success definitions with a stored measurement procedure, a target
    // ("volume"), and a time series. Goals derived from off-track KPIs carry
    // dev_goals.kpi_id (soft link, ALTER style).
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis",
            description: "KPI definitions (outcome layer above goals)",
            already_applied: |conn| has_table(conn, "dev_kpis"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpis (
                        id               TEXT PRIMARY KEY,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        context_group_id TEXT REFERENCES dev_context_groups(id) ON DELETE SET NULL,
                        name             TEXT NOT NULL,
                        description      TEXT,
                        category         TEXT NOT NULL DEFAULT 'technical'
                                         CHECK(category IN ('technical','traffic','value','quality')),
                        measure_kind     TEXT NOT NULL DEFAULT 'manual'
                                         CHECK(measure_kind IN ('codebase','connector','manual','derived')),
                        measure_config   TEXT NOT NULL DEFAULT '{}',
                        unit             TEXT NOT NULL DEFAULT '',
                        direction        TEXT NOT NULL DEFAULT 'up' CHECK(direction IN ('up','down')),
                        baseline_value   REAL,
                        target_value     REAL,
                        target_date      TEXT,
                        current_value    REAL,
                        last_measured_at TEXT,
                        cadence          TEXT NOT NULL DEFAULT 'manual'
                                         CHECK(cadence IN ('manual','daily','weekly')),
                        status           TEXT NOT NULL DEFAULT 'proposed'
                                         CHECK(status IN ('proposed','active','paused','archived')),
                        created_by       TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','scan')),
                        rationale        TEXT,
                        needed_connector TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpis_project ON dev_kpis(project_id, status);
                    CREATE INDEX IF NOT EXISTS idx_dev_kpis_group ON dev_kpis(context_group_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements",
            description: "KPI measurement time series",
            already_applied: |conn| has_table(conn, "dev_kpi_measurements"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpi_measurements (
                        id          TEXT PRIMARY KEY,
                        kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        value       REAL NOT NULL,
                        measured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        source      TEXT NOT NULL DEFAULT 'manual'
                                    CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
                        env         TEXT NOT NULL DEFAULT 'production'
                                    CHECK(env IN ('local','test','production')),
                        evidence    TEXT,
                        note        TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_measurements_kpi
                        ON dev_kpi_measurements(kpi_id, measured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // KPI simulation (docs/plans/kpi-simulation-skill.md P0): measurements gain
    // an ENVIRONMENT axis (local / test / production — same vocabulary as the
    // passport env split) and a 'simulation' source. SQLite can't widen a CHECK
    // in place, so legacy tables are rebuilt (copy → drop → rename); fresh DBs
    // get the new shape from the CREATE above and skip this via the guard.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements_env_sim",
            description: "env axis + simulation source on KPI measurements (table rebuild)",
            already_applied: |conn| {
                let sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_kpi_measurements'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(sql.contains("'simulation'")
                    && has_column(conn, "dev_kpi_measurements", "env")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE dev_kpi_measurements_env_sim_new (
                        id          TEXT PRIMARY KEY,
                        kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        value       REAL NOT NULL,
                        measured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        source      TEXT NOT NULL DEFAULT 'manual'
                                    CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
                        env         TEXT NOT NULL DEFAULT 'production'
                                    CHECK(env IN ('local','test','production')),
                        evidence    TEXT,
                        note        TEXT
                    );
                    INSERT INTO dev_kpi_measurements_env_sim_new
                        (id, kpi_id, value, measured_at, source, evidence, note)
                        SELECT id, kpi_id, value, measured_at, source, evidence, note
                        FROM dev_kpi_measurements;
                    DROP TABLE dev_kpi_measurements;
                    ALTER TABLE dev_kpi_measurements_env_sim_new RENAME TO dev_kpi_measurements;
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_measurements_kpi
                        ON dev_kpi_measurements(kpi_id, measured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.metric_type",
            description: "Type-bound connector KPIs (P6): semantic metric type",
            already_applied: |conn| has_column(conn, "dev_kpis", "metric_type"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN metric_type TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.tier",
            description: "KPI tier (north_star/primary/supporting) for derivation precedence",
            already_applied: |conn| has_column(conn, "dev_kpis", "tier"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN tier TEXT NOT NULL DEFAULT 'supporting';",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.context_id",
            description: "Context-level KPIs: scope a KPI to a single dev_context (NULL = project/group-level)",
            already_applied: |conn| has_column(conn, "dev_kpis", "context_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN context_id TEXT REFERENCES dev_contexts(id) ON DELETE SET NULL;",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_kpis_context ON dev_kpis(context_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.factory_calibration",
            description: "Factory KPI console: persisted warn/crit thresholds, manual rating, pros/cons assessment",
            already_applied: |conn| has_column(conn, "dev_kpis", "warn_at"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN warn_at REAL;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN crit_at REAL;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN manual_rating INTEGER;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN assessment_pros TEXT;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN assessment_cons TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.skip_memory",
            description: "KPI derivation skip: remember an off-track KPI judged not team-actionable (cooldown + honest 'over to you' UI)",
            already_applied: |conn| has_column(conn, "dev_kpis", "last_skip_at"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN last_skip_at TEXT;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN last_skip_rationale TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_bindings",
            description: "Swappable connector bindings for type-bound KPIs (P6)",
            already_applied: |conn| has_table(conn, "dev_kpi_bindings"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpi_bindings (
                        id            TEXT PRIMARY KEY,
                        kpi_id        TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        credential_id TEXT NOT NULL,
                        service_type  TEXT NOT NULL,
                        procedure     TEXT NOT NULL,
                        composed_by   TEXT NOT NULL DEFAULT 'llm'
                                      CHECK(composed_by IN ('recipe','llm')),
                        status        TEXT NOT NULL DEFAULT 'active'
                                      CHECK(status IN ('active','archived','degraded')),
                        verified_at   TEXT,
                        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_bindings_kpi
                        ON dev_kpi_bindings(kpi_id, status);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_run_checkpoints",
            description: "F5: git checkpoint stage->SHA index for dev-tools runs",
            already_applied: |conn| has_table(conn, "dev_run_checkpoints"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_run_checkpoints (
                        id          TEXT PRIMARY KEY,
                        run_id      TEXT NOT NULL,
                        stage       TEXT NOT NULL,
                        sha         TEXT NOT NULL,
                        status      TEXT NOT NULL,
                        created_at  TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_run_checkpoints_run
                        ON dev_run_checkpoints(run_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "athena_wake_log",
            description: "Athena autonomy wake/impact ledger (wake-window design)",
            already_applied: |conn| has_table(conn, "athena_wake_log"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS athena_wake_log (
                        id              TEXT PRIMARY KEY,
                        surface         TEXT NOT NULL,
                        trigger_reason  TEXT NOT NULL,
                        signals_pending INTEGER NOT NULL DEFAULT 0,
                        oldest_age_min  INTEGER NOT NULL DEFAULT 0,
                        cli_calls       INTEGER NOT NULL DEFAULT 0,
                        actions_taken   INTEGER NOT NULL DEFAULT 0,
                        duration_ms     INTEGER NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_athena_wake_log_surface
                        ON athena_wake_log(surface, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.thinking_level",
            description: "Resolved CLI effort level per execution (cost observability)",
            already_applied: |conn| has_column(conn, "persona_executions", "thinking_level"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN thinking_level TEXT",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goals.kpi_id",
            description: "Link a derived goal to the KPI it serves",
            already_applied: |conn| has_column(conn, "dev_goals", "kpi_id"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_goals ADD COLUMN kpi_id TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Goal-UAT browser-test gate: a dev_goal_item carrying verify_kind +
    // verify_config is a verification gate (not a manual to-do) — only a
    // passing browser test ticks it, and an open one keeps the goal under
    // 100% (the gate). verify_config is JSON `{scenario, url?}`.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goal_items.verify_kind",
            description: "Browser-test UAT gate item on a dev goal",
            already_applied: |conn| has_column(conn, "dev_goal_items", "verify_kind"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_goal_items ADD COLUMN verify_kind TEXT;")?;
                ddl_step(conn, "ALTER TABLE dev_goal_items ADD COLUMN verify_config TEXT;")?;
                Ok(())
            },
        },
    )?;

    // -- persona_executions: prompt-cache token visibility (P1). Capture how
    // many input tokens were served from cache vs. written, so prompt-cache
    // effectiveness is measurable. Both NOT NULL DEFAULT 0 — existing rows read
    // as 0/0 (no cache data), never null. Written at finalize via
    // executions::set_cache_tokens; surfaced on the execution detail.
    ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;").ok();
    ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;").ok();

    // -- run_budgets (P2): persisted aggregate cost per multi-spawn run for
    // historical / cost-trend dashboards. Mirrors the in-memory RunBudgetLedger
    // (engine/run_budget.rs); written at each consumer's finalize. Keyed by the
    // run identity (evolution cycle id / lab run id / pipeline run id).
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS run_budgets (
            run_id       TEXT PRIMARY KEY,
            kind         TEXT NOT NULL,
            ceiling_usd  REAL NOT NULL DEFAULT 0,
            spent_usd    REAL NOT NULL DEFAULT 0,
            spawn_count  INTEGER NOT NULL DEFAULT 0,
            exceeded     INTEGER NOT NULL DEFAULT 0,
            enforce      INTEGER NOT NULL DEFAULT 0,
            finished     INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .ok();
    ddl_step(conn, "CREATE INDEX IF NOT EXISTS idx_run_budgets_kind ON run_budgets(kind, updated_at);").ok();

    // NOTE: the Groups→Teams Phase-3 DATA MIGRATION that used to live here was
    // relocated to the end of `run_incremental` (2026-05-24). It reads columns
    // (`persona_groups.shared_instructions`, `persona_teams.shared_instructions`,
    // `personas.home_team_id`, `persona_memories.home_team_id`) that are only
    // added by `run_incremental` — but `ensure_composite_fires_table` runs in the
    // earlier `initial::run` phase, so on a fresh DB those columns did not yet
    // exist and the migration aborted startup with "no such column:
    // g.shared_instructions". Moving it to phase 2 satisfies every dependency.

    // -- Context categorization parity with Vibeman: a technical `category` and
    // a human `business_feature` on contexts, plus a business `domain` on groups.
    // Standardizes the context map (comparable across projects) and enables
    // domain-scoped scanning / KPI targeting. Nullable TEXT — existing rows read
    // as null until the next context scan re-populates them.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.category",
            description: "Add technical category to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "category"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_contexts ADD COLUMN category TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.business_feature",
            description: "Add business_feature to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "business_feature"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_contexts ADD COLUMN business_feature TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_context_groups.domain",
            description: "Add business domain to dev_context_groups",
            already_applied: |conn| has_column(conn, "dev_context_groups", "domain"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_context_groups ADD COLUMN domain TEXT;")?;
                Ok(())
            },
        },
    )?;
    // Canonical pin: a human-curated context that a full rescan must preserve
    // rather than DELETE-and-recreate. Adopts ktx's "canonical pins" idea (prior
    // human tie-breaks are protected across re-ingest) to fix the documented
    // near-miss where a full rescan silently destroyed a hand-curated map.
    // Boolean stored as INTEGER; existing rows default to unpinned.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.pinned",
            description: "Add canonical-pin flag to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "pinned"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_contexts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            // tiger finding #1: the headless LLM tier (scanners, lab/eval,
            // design-artifact spawns) recorded no model/tokens/cost — the
            // `result` line streamed past and was discarded. This is the
            // dedicated spend ledger (separate from companion_turn, which stays
            // companion-scoped). Append-only history: soft refs (no FK) so a
            // row survives deletion of its persona/project. Free-text
            // source/trigger_kind, mirroring companion_turn's origin.
            id: "dev_llm_spend",
            description: "Headless LLM spend ledger — model/tokens/cost per background call",
            already_applied: |conn| has_table(conn, "dev_llm_spend"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_llm_spend (
                        id                    TEXT PRIMARY KEY,
                        source                TEXT NOT NULL,
                        trigger_kind          TEXT NOT NULL,
                        model                 TEXT,
                        input_tokens          INTEGER,
                        output_tokens         INTEGER,
                        cache_read_tokens     INTEGER,
                        cache_creation_tokens INTEGER,
                        cost_usd              REAL,
                        duration_ms           INTEGER,
                        num_turns             INTEGER,
                        is_error              INTEGER NOT NULL DEFAULT 0,
                        persona_id            TEXT,
                        project_id            TEXT,
                        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_created
                        ON dev_llm_spend(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_source
                        ON dev_llm_spend(source, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_trigger
                        ON dev_llm_spend(trigger_kind, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            // Phase 5a — durable fleet-decision ledger. Athena's per-session
            // orchestration verdicts (auto-fired action vs deferred consult) were
            // in-memory only (the screen-hash map in fleet_bridge), lost on
            // restart. This persists each decision so (a) she can skip re-asking a
            // screen she already decided — keyed on the STABLE claude_session_id +
            // screen_hash, since the registry id is regenerated each launch — and
            // (b) the user can see WHY she stopped/acted on a session. Append-only;
            // soft refs (no FK); free-text action/outcome/confidence/defer_reason.
            id: "fleet_decisions",
            description: "Durable Athena fleet-orchestration decision ledger",
            already_applied: |conn| has_table(conn, "fleet_decisions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS fleet_decisions (
                        id                 TEXT PRIMARY KEY,
                        session_id         TEXT NOT NULL,
                        claude_session_id  TEXT,
                        screen_hash        TEXT NOT NULL,
                        action             TEXT NOT NULL,
                        outcome            TEXT NOT NULL,
                        confidence         TEXT,
                        decision_class     TEXT,
                        defer_reason       TEXT,
                        rationale          TEXT,
                        created_at         TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_created
                        ON fleet_decisions(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_session
                        ON fleet_decisions(session_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_dedupe
                        ON fleet_decisions(claude_session_id, screen_hash);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            // Fleet registry durability — the fleet's session registry was
            // in-memory only (`registry::FleetRegistry::sessions`), so every
            // app restart / update / crash lost the WHOLE fleet (three
            // total-loss restarts on 2026-07-24; recovering eight stranded
            // conversations took a hand-written json + a resume script).
            // Everything needed to resurrect a row is already known, so this
            // table mirrors the registry: rows are upserted from the existing
            // emit points and rehydrated as dozing tombstones on boot.
            //
            // Only rows with a BOUND `claude_session_id` are ever written —
            // they are the only ones `claude --resume` can bring back, and it
            // keeps never-attached spawns out of the rehydration set.
            // `run_id` / `run_label` are the run-harvest lane's grouping key
            // (a batch tag stamped at spawn); nullable = "ad hoc".
            id: "fleet_sessions",
            description: "Durable fleet session registry (survives app restarts)",
            already_applied: |conn| has_table(conn, "fleet_sessions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS fleet_sessions (
                        id                 TEXT PRIMARY KEY,
                        claude_session_id  TEXT NOT NULL,
                        cwd                TEXT NOT NULL,
                        project_label      TEXT NOT NULL,
                        name               TEXT,
                        title              TEXT,
                        args_json          TEXT NOT NULL DEFAULT '[]',
                        mode               TEXT NOT NULL DEFAULT 'interactive',
                        state              TEXT NOT NULL,
                        state_reason       TEXT,
                        run_id             TEXT,
                        run_label          TEXT,
                        created_at_ms      INTEGER NOT NULL,
                        last_activity_ms   INTEGER NOT NULL,
                        updated_at_ms      INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_state
                        ON fleet_sessions(state, updated_at_ms DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_claude
                        ON fleet_sessions(claude_session_id);
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_run
                        ON fleet_sessions(run_id, created_at_ms);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- External API keys: capability-token columns (Direction 5, P1) --------
    // Upgrade path for EXISTING DBs whose `external_api_keys` predates the
    // capability-token columns. Fresh DBs are already born with these columns
    // (see initial.rs), so this is a pure upgrade step. Adds hard expiry,
    // browser-origin binding, and a human label so the key-creation UI and
    // (later) the pairing ceremony can mint time-boxed, origin-bound,
    // least-privilege keys. All nullable, so existing keys and the process
    // "system" key are unaffected: NULL expires_at = non-expiring, NULL
    // bound_origin = no origin restriction.
    //
    // Guarded on `has_table` first: some code paths reach run_incremental with
    // `external_api_keys` not yet present, and an unguarded ALTER would abort
    // the whole chain. `already_applied` (has_column) then makes the ALTER
    // itself idempotent. See docs/architecture/cloud-integration-bridge.md.
    run_step(
        conn,
        IncrementalMigration {
            id: "external_api_keys.capability_columns",
            description: "external_api_keys: expires_at + bound_origin + label",
            already_applied: |conn| {
                // No-op if the table is absent (nothing to alter yet) or the
                // first column already exists.
                Ok(!has_table(conn, "external_api_keys")?
                    || has_column(conn, "external_api_keys", "expires_at")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE external_api_keys ADD COLUMN expires_at TEXT;
                     ALTER TABLE external_api_keys ADD COLUMN bound_origin TEXT;
                     ALTER TABLE external_api_keys ADD COLUMN label TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Split the scraper config's overloaded `name` into a short title + a
    // separate use-case description (Phase 1b-2 follow-up).
    run_step(
        conn,
        IncrementalMigration {
            id: "scraper_configs.description",
            description: "scraper_configs: add description column",
            already_applied: |conn| {
                Ok(!has_table(conn, "scraper_configs")?
                    || has_column(conn, "scraper_configs", "description")?)
            },
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE scraper_configs ADD COLUMN description TEXT;")?;
                Ok(())
            },
        },
    )?;

    // ---------------------------------------------------------------------
    // Use-case slice layer (docs/plans/use-case-slice-layer.md)
    //
    // A use case is a *slice through* contexts, not a subdivision of one: the
    // behavioral unit ("checkout conversion") that a KPI can actually own,
    // where a context is a code-ownership partition that outcomes cut across.
    // `slug` is the telemetry join key — it matches the use-case name the LLM
    // Overview already folds observability pinpoints by.
    // ---------------------------------------------------------------------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_use_cases",
            description: "Use-case slice layer: behavioral units spanning contexts, the narrowest KPI scope",
            already_applied: |conn| has_table(conn, "dev_use_cases"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_use_cases (
                        id                 TEXT PRIMARY KEY,
                        project_id         TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        name               TEXT NOT NULL,
                        slug               TEXT NOT NULL,
                        description        TEXT,
                        kind               TEXT NOT NULL DEFAULT 'capability'
                                           CHECK(kind IN ('user_flow','capability','integration','ops')),
                        primary_context_id TEXT REFERENCES dev_contexts(id) ON DELETE SET NULL,
                        status             TEXT NOT NULL DEFAULT 'active'
                                           CHECK(status IN ('proposed','active','archived')),
                        created_by         TEXT NOT NULL DEFAULT 'user'
                                           CHECK(created_by IN ('user','scan','backfill')),
                        pinned             INTEGER NOT NULL DEFAULT 0,
                        rationale          TEXT,
                        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(project_id, slug)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_use_cases_project
                     ON dev_use_cases(project_id, status);",
                )?;
                // The slice. Cascades on either side; the scan's
                // snapshot/reconcile pass rebuilds it by context NAME after a
                // full rescan recreates context rows under fresh ids.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_use_case_contexts (
                        use_case_id TEXT NOT NULL REFERENCES dev_use_cases(id) ON DELETE CASCADE,
                        context_id  TEXT NOT NULL REFERENCES dev_contexts(id) ON DELETE CASCADE,
                        PRIMARY KEY (use_case_id, context_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_use_case_contexts_context
                     ON dev_use_case_contexts(context_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.use_case_id",
            description: "Use-case-scoped KPIs: the narrowest KPI scope (narrower than a single context)",
            already_applied: |conn| has_column(conn, "dev_kpis", "use_case_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN use_case_id TEXT REFERENCES dev_use_cases(id) ON DELETE SET NULL;",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_kpis_use_case ON dev_kpis(use_case_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories.derived_from",
            description: "Reflection provenance: JSON array of source memory ids a synthesized insight was derived from (no FK by design — sources are archived, and may later be deleted, without erasing the insight's lineage)",
            already_applied: |conn| has_column(conn, "persona_memories", "derived_from"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN derived_from TEXT;",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "chain_stop_reasons.create",
            description: "Chain stop reasons: structured record of why a chain relay did NOT continue at each non-continuation path (handoff suppression, cycle, depth/budget limit, predicate miss, quarantine) — queryable per chain_trace_id for the Chain tab's end-of-chain explanation",
            already_applied: |conn| has_table(conn, "chain_stop_reasons"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS chain_stop_reasons (
                        id                TEXT PRIMARY KEY,
                        chain_trace_id    TEXT NOT NULL,
                        link_execution_id TEXT NOT NULL,
                        trigger_id        TEXT,
                        target_persona_id TEXT,
                        reason_token      TEXT NOT NULL,
                        detail            TEXT,
                        chain_depth       INTEGER NOT NULL DEFAULT 0,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_csr_chain ON chain_stop_reasons(chain_trace_id);
                    CREATE INDEX IF NOT EXISTS idx_csr_link  ON chain_stop_reasons(link_execution_id);
                    CREATE INDEX IF NOT EXISTS idx_csr_created ON chain_stop_reasons(created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // First-class persona lifecycle (Draft → Active → Archived). Replaces the
    // frontend draft heuristic (`!last_design_result && prompt == default`) with
    // a durable column. Default `active` so every existing real persona keeps
    // routing to the editor. The one-time backfill infers `draft` from the SAME
    // heuristic the frontend used — a persona that never finished a build (no
    // design result / design context) AND still carries the placeholder/empty
    // system_prompt. A completed build always populated `last_design_result`, so
    // a real persona whose prompt merely LOOKS like the placeholder is NOT
    // yanked into draft. Archiving lands only via the runtime archive command.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.lifecycle",
            description: "First-class persona lifecycle column (draft|active|archived) + draft backfill",
            already_applied: |conn| has_column(conn, "personas", "lifecycle"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
                     CREATE INDEX IF NOT EXISTS idx_personas_lifecycle ON personas(lifecycle);",
                )?;
                // Backfill drafts. Mirrors PersonaOverviewPage's isDraft():
                //   !last_design_result && (system_prompt == placeholder || blank)
                // Also treat a NULL/blank design_context as part of "never built"
                // for defense in depth (a finished build writes design_context).
                //
                // ORDERING FIX (2026-07-14): this migration lives in
                // `ensure_composite_fires_table`, which `migrations::run()`
                // executes BEFORE `run_incremental()` adds the trust columns.
                // On a FRESH database `trust_origin` therefore does not exist
                // yet and the previous unconditional reference to it errored
                // ("no such column: trust_origin") — bricking init on every
                // fresh install (and init_test_db). Guard the system-persona
                // exclusion on column existence: a fresh DB has zero persona
                // rows at this point (seeds run after migrations), so the
                // clause is vacuously unnecessary there; on legacy DBs the
                // column exists and the exclusion applies as designed.
                let trust_clause = if has_column(conn, "personas", "trust_origin")? {
                    "AND COALESCE(trust_origin, 'builtin') != 'system'"
                } else {
                    ""
                };
                ddl_step(
                    conn,
                    &format!(
                        "UPDATE personas SET lifecycle = 'draft'
                         WHERE (last_design_result IS NULL OR TRIM(last_design_result) = '')
                           AND (design_context IS NULL OR TRIM(design_context) = '')
                           AND (system_prompt = 'You are a helpful AI assistant.'
                                OR TRIM(COALESCE(system_prompt, '')) = '')
                           {trust_clause};"
                    ),
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_healing_issues.source",
            description: "Provenance of a healing issue: NULL/'engine' for the self-healing pipeline (legacy default), 'director' for issues routed from a Director coaching verdict. Lets the health UI badge the origin and lets the Director dedup its own open issues without a schema-less title hack.",
            already_applied: |conn| has_column(conn, "persona_healing_issues", "source"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_healing_issues ADD COLUMN source TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "deployment_history.target",
            description: "Deploy target for a history row: 'gitlab' (legacy default — Duo agent / AGENTS.md) or 'cloud' (Personas Cloud managed endpoint). Lets the unified deployment audit trail carry cloud deploys alongside GitLab, and is the substrate the deferred cloud-version-rollback builds on.",
            already_applied: |conn| has_column(conn, "deployment_history", "target"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE deployment_history ADD COLUMN target TEXT NOT NULL DEFAULT 'gitlab';",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_center_tables",
            description: "Workspace Knowledge Center (docs/plans/workspace-knowledge-center.md): dev_workspaces promotes the sub_workspaces localStorage prototype to SQLite; workspace_knowledge is the governed cross-project practice store (observed→proposed→adopted ladder, provenance, applicability, rejection kept for miner dedup); workspace_practice_adoption tracks per-project adoption state (the scaling surface).",
            already_applied: |conn| has_table(conn, "dev_workspaces"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_workspaces (
                        id          TEXT PRIMARY KEY,
                        name        TEXT NOT NULL,
                        color       TEXT,
                        description TEXT,
                        created_at  TEXT NOT NULL,
                        updated_at  TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS workspace_knowledge (
                        id                TEXT PRIMARY KEY,
                        workspace_id      TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
                        kind              TEXT NOT NULL CHECK(kind IN ('pattern','pitfall','decision','howto','fact')),
                        title             TEXT NOT NULL,
                        statement         TEXT NOT NULL,
                        detail_md         TEXT,
                        topic             TEXT,
                        abstraction       TEXT,
                        ftype             TEXT,
                        durability        TEXT,
                        governing_id      TEXT,
                        evidence_count    INTEGER,
                        applicability     TEXT,
                        status            TEXT NOT NULL DEFAULT 'observed'
                                          CHECK(status IN ('observed','proposed','adopted','deprecated','rejected')),
                        origin_project_id TEXT,
                        provenance        TEXT,
                        confidence        REAL,
                        dedup_key         TEXT,
                        superseded_by     TEXT,
                        valid_from        TEXT,
                        valid_to          TEXT,
                        decided_at        TEXT,
                        created_at        TEXT NOT NULL,
                        updated_at        TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_ws_status
                        ON workspace_knowledge(workspace_id, status);
                    CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_dedup
                        ON workspace_knowledge(workspace_id, dedup_key);
                    CREATE TABLE IF NOT EXISTS workspace_practice_adoption (
                        practice_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        state            TEXT NOT NULL CHECK(state IN ('na','proposed','to_process','dispatched','adopted','diverged')),
                        fleet_key        TEXT,
                        note             TEXT,
                        last_verified_at TEXT,
                        updated_at       TEXT NOT NULL,
                        PRIMARY KEY (practice_id, project_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.workspace_id",
            description: "Single-workspace-per-project binding (nullable). Replaces the retired dev_projects.group_id design-time folder; NULL = unassigned. No cascade — deleting a workspace nulls the column via the delete repo fn, never touching projects.",
            already_applied: |conn| has_column(conn, "dev_projects", "workspace_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN workspace_id TEXT REFERENCES dev_workspaces(id);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.topic",
            description: "Free-form slash-path taxonomy node for a practice (e.g. 'ui/motion/reveals'), authored by harvest agents. The library derives its arbitrary-depth topic tree from this column; nullable = uncategorized. Added as a separate ALTER so DBs that created workspace_knowledge before this column pick it up.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "topic"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN topic TEXT;")?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.categorization_axes",
            description: "Categorization axes orthogonal to the topic tree, for ranking + filtering the library (docs/plans/workspace-knowledge-center.md, divergence-scan synthesis): `abstraction` (macro|meso|micro — the altitude of the practice), `ftype` (finding-type taxonomy: architecture|module-boundary|data-flow|extensibility|api-design|state-mgmt|error-strategy|concurrency-reliability|perf-strategy|testing-strategy|micro-technique), `durability` (durable|situational|mechanical — whether it's worth being knowledge vs a lint rule), `governing_id` (roll a micro-instance up under a macro doctrine), `evidence_count` (prevalence). All nullable; validation lives in Rust, not a DB CHECK.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "abstraction"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN abstraction TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN ftype TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN durability TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN governing_id TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN evidence_count INTEGER;")?;
                Ok(())
            },
        },
    )?;

    // -- dev_memories: the development loop's project-scoped memory ----------
    // docs/plans/backlog-memory-loop.md Phase 2. Decisions used to land only in
    // `team_memories` (team-keyed), so teamless projects learned nothing and the
    // task executor — which knows a project, not a team — had nothing to read.
    // This is the loop's canonical store; team memory stays the cross-persona
    // ledger and both are written in parallel.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_memories (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT 'learned',
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            importance  INTEGER NOT NULL DEFAULT 5,
            source_kind TEXT NOT NULL DEFAULT 'task_outcome',
            source_id   TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_dev_mem_project  ON dev_memories(project_id);
        CREATE INDEX IF NOT EXISTS idx_dev_mem_recent   ON dev_memories(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dev_mem_category ON dev_memories(project_id, category);
        -- One memory per source event: re-recording the same decision or the
        -- same task's outcome updates nothing and inserts nothing.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_mem_source
            ON dev_memories(project_id, source_kind, source_id)
            WHERE source_id IS NOT NULL;",
    )?;

    // -- workspace_practice_adoption: the `to_process` execution queue -------
    // Adopting a practice used to seed every applicable member repo at
    // `proposed` regardless of what the practice ASKS FOR, so an adopted
    // pitfall ("stop doing X") looked identical to an adopted fact and nothing
    // downstream could tell which cells owed work. Actionable kinds now seed
    // `to_process` (see repos::dev_workspaces::initial_adoption_state) — the
    // queue a future executor drains. SQLite cannot widen a CHECK in place, so
    // the table is rebuilt.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_practice_adoption.to_process",
            description: "Widen workspace_practice_adoption.state CHECK with 'to_process' — the per-repo execution queue seeded when an ACTIONABLE practice (pitfall/pattern) is adopted, distinct from 'proposed' (reference material, distributed not executed).",
            already_applied: |conn| {
                let sql: Option<String> = conn
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspace_practice_adoption'",
                        [],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(AppError::Database)?;
                // A missing table is "applied": the CREATE above already ships
                // the widened CHECK on fresh databases.
                Ok(sql.map(|s| s.contains("to_process")).unwrap_or(true))
            },
            apply: |conn| {
                // FKs off for the drop/rename: the guard must live OUTSIDE the
                // ddl_step transaction — `PRAGMA foreign_keys` is a no-op once
                // a transaction is open.
                let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;
                ddl_step(
                    conn,
                    "DROP TABLE IF EXISTS workspace_practice_adoption_new;
                    CREATE TABLE workspace_practice_adoption_new (
                        practice_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        state            TEXT NOT NULL CHECK(state IN ('na','proposed','to_process','dispatched','adopted','diverged')),
                        fleet_key        TEXT,
                        note             TEXT,
                        last_verified_at TEXT,
                        updated_at       TEXT NOT NULL,
                        PRIMARY KEY (practice_id, project_id)
                    );
                    INSERT INTO workspace_practice_adoption_new
                        SELECT practice_id, project_id, state, fleet_key, note, last_verified_at, updated_at
                        FROM workspace_practice_adoption;
                    DROP TABLE workspace_practice_adoption;
                    ALTER TABLE workspace_practice_adoption_new RENAME TO workspace_practice_adoption;",
                )?;
                Ok(())
            },
        },
    )?;

    // ---------------------------------------------------------------------
    // Ship layer: milestones (Factory L2 → Ship tab)
    //
    // A milestone is a CONVERGENCE CUT over the primitives the scans already
    // generate: use cases join with a bucket (core/later/never), goals bind
    // as measurable objectives, and contexts are never members — they derive
    // from the bound use cases' slices at read time. Progress is likewise
    // derived (use-case states + KPI coverage + context health), so the
    // schema stores decisions, never percentages.
    // ---------------------------------------------------------------------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestones",
            description: "Ship layer: milestones as convergence cuts (roadmap spine + scope membership); progress derives, only decisions are stored",
            already_applied: |conn| has_table(conn, "dev_milestones"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_milestones (
                        id           TEXT PRIMARY KEY,
                        project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        name         TEXT NOT NULL,
                        goal         TEXT,
                        status       TEXT NOT NULL DEFAULT 'planned'
                                     CHECK(status IN ('planned','active','shipped')),
                        order_index  INTEGER NOT NULL DEFAULT 0,
                        target_date  TEXT,
                        cut_at       TEXT,
                        shipped_at   TEXT,
                        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_milestones_project
                     ON dev_milestones(project_id, status, order_index);",
                )?;
                // Scope membership. One row per (milestone, item); an item
                // belongs to at most one bucket per milestone. `item_kind`
                // 'use_case' rows reference dev_use_cases (the work), 'goal'
                // rows reference dev_goals (the objectives). No FK on item_id
                // because it is polymorphic — orphans are swept at read time,
                // mirroring how context rescans rebuild slices by name.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_milestone_items (
                        milestone_id    TEXT NOT NULL REFERENCES dev_milestones(id) ON DELETE CASCADE,
                        item_kind       TEXT NOT NULL CHECK(item_kind IN ('use_case','goal')),
                        item_id         TEXT NOT NULL,
                        bucket          TEXT NOT NULL DEFAULT 'core'
                                        CHECK(bucket IN ('core','later','never')),
                        added_after_cut INTEGER NOT NULL DEFAULT 0,
                        order_index     INTEGER NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (milestone_id, item_kind, item_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_milestone_items_item
                     ON dev_milestone_items(item_kind, item_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_milestones.cut_at backfill -------------------------------------
    // `cut_at` is the scope-creep baseline: items joined after it carry
    // `added_after_cut`. It used to be stamped ONLY on a status transition to
    // 'active' in `update_milestone`, but a milestone created directly active
    // — the seeded "Onboard to Personas" one every project gets — never makes
    // that transition, so its `cut_at` stayed NULL forever and the creep
    // signal never fired on the one milestone most projects will ever have.
    // `create_milestone` now stamps it in the INSERT; this repairs the rows
    // already on disk. Runs immediately after the block that creates the
    // table (has_table guard for the case where that block was skipped), and
    // is naturally idempotent — after one pass no active row has a NULL cut.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestones.backfill_cut_at",
            description: "Backfill cut_at = created_at for milestones already 'active' with no cut stamp, so the scope-creep baseline exists on milestones that were created directly active.",
            already_applied: |conn| {
                if !has_table(conn, "dev_milestones")? {
                    return Ok(true);
                }
                let pending: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM dev_milestones WHERE status = 'active' AND cut_at IS NULL",
                    [],
                    |row| row.get(0),
                )?;
                Ok(pending == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_milestones SET cut_at = created_at
                     WHERE status = 'active' AND cut_at IS NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_milestone_items.description + rating ---------------------------
    // A scope member carried only its bucket, so the WHY of a decision lived
    // nowhere: why this use case is core, why that goal was pushed to later.
    // `description` is that note. `rating` is the operator's own read on the
    // item (1..5), and is NULL by design — "unrated" must stay distinguishable
    // from "rated 1", which is why there is no DEFAULT here. The CHECK rides
    // along on the ADD COLUMN: SQLite evaluates it per row, and NULL is not
    // FALSE, so every pre-existing row passes on a populated database.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestone_items.description_rating",
            description: "Give a milestone scope member a free-text rationale and an operator rating (1..5, NULL = unrated), so a bucket decision carries its reason and its judged value.",
            already_applied: |conn| has_column(conn, "dev_milestone_items", "rating"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_milestone_items ADD COLUMN description TEXT;
                     ALTER TABLE dev_milestone_items ADD COLUMN rating INTEGER
                         CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));",
                )?;
                Ok(())
            },
        },
    )?;

    // -- workspace_harvest_coverage: which territory has been read ----------
    // The harvest engine used to send one agent at a whole repository with an
    // item cap and no map, so it read the root configs and stopped — and had
    // no way to know that on the next run either. This table is the memory:
    // one row per (member repo, scope), NULL `last_harvested_at` meaning "never
    // read". Rows are rebuilt from the derived scope list on every prepare,
    // preserving harvest history for scopes that survive a re-scan.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_harvest_coverage (
            project_id        TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            scope_id          TEXT NOT NULL,
            scope_label       TEXT NOT NULL,
            kind              TEXT NOT NULL DEFAULT 'group',
            file_count        INTEGER NOT NULL DEFAULT 0,
            last_harvested_at TEXT,
            last_run_dir      TEXT,
            items_found       INTEGER NOT NULL DEFAULT 0,
            run_count         INTEGER NOT NULL DEFAULT 0,
            updated_at        TEXT NOT NULL,
            PRIMARY KEY (project_id, scope_id)
        );
        CREATE INDEX IF NOT EXISTS idx_harvest_coverage_project
            ON workspace_harvest_coverage(project_id, last_harvested_at);",
    )?;

    // -- coverage DEPTH, not just visits ------------------------------------
    // The first coverage ledger recorded WHETHER a territory had been visited.
    // The 2026-07-27 twelve-territory scan showed that is not enough: every
    // agent volunteered a real read-depth ("~11% of 404 files", "26% of 508",
    // "~7% of the command layer") plus the specific pockets it never opened —
    // and all of it was discarded, leaving a territory read at 11% and one read
    // exhaustively indistinguishable. That is the same "visited == covered"
    // error the scoping work exists to remove, one level up.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_harvest_coverage.depth",
            description: "Record how much of a scope was actually read (files_read / files_total / estimated_pct) and which pockets were left unread, so coverage reports depth instead of a visit and the next wave can resume into the gaps.",
            already_applied: |conn| has_column(conn, "workspace_harvest_coverage", "estimated_pct"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE workspace_harvest_coverage ADD COLUMN files_read INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN files_total INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN estimated_pct INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN unread_pockets TEXT;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN coverage_note TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- workspace_knowledge.harvest_scope ----------------------------------
    // Which territory produced a practice. Without it the library cannot be
    // filtered or measured by scope, and yield-per-territory — the number that
    // tells you whether a scope is worth re-dispatching — is uncomputable.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.harvest_scope",
            description: "Stamp the harvest scope (territory) that produced each practice, so the library can filter by territory and yield-per-scope is measurable.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "harvest_scope"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE workspace_knowledge ADD COLUMN harvest_scope TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_workspaces.adopt_default_skills --------------------------------
    // Consent flag set at workspace creation: when 1, projects assigned to the
    // workspace get the app's preset scan-* skills installed (system-skill
    // lane). Consent is explicit — the checkbox in the create form — never
    // implied, so the default is 0.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_workspaces.adopt_default_skills",
            description: "Per-workspace consent to populate the preset scan skills into member projects on assignment.",
            already_applied: |conn| has_column(conn, "dev_workspaces", "adopt_default_skills"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_workspaces ADD COLUMN adopt_default_skills INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- companion_tours ----------------------------------------------------
    // MOVED 2026-08-15 to COMPANION_SCHEMA in db/src/lib.rs. This file's
    // migrations run against the MAIN database; every companion_tours query
    // executes on `&UserDbPool`, so the table was being created in one store
    // and read from the other. See the note at its new definition.

    // -- incident_diagnoses: Autonomous NOC v1 root-cause diagnoses ----------
    // One row per audit incident (UNIQUE incident_id). Written by the
    // server-side alert evaluator's auto-diagnosis pass and by the manual
    // "Diagnose" action in the incident detail modal. `approval_id` records
    // the (at most one) pending companion-approval proposal — the
    // remediation-loop cap for v1.
    run_step(
        conn,
        IncrementalMigration {
            id: "incident_diagnoses",
            description: "Create incident_diagnoses (NOC auto-diagnosis attached to audit_incidents)",
            already_applied: |conn| has_table(conn, "incident_diagnoses"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS incident_diagnoses (
                        id                 TEXT PRIMARY KEY,
                        incident_id        TEXT NOT NULL UNIQUE REFERENCES audit_incidents(id) ON DELETE CASCADE,
                        summary            TEXT NOT NULL,
                        evidence           TEXT,
                        proposed_action    TEXT,
                        proposed_rationale TEXT,
                        approval_id        TEXT,
                        confidence         REAL NOT NULL DEFAULT 0,
                        diagnosed_at       TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- credential_consumer_edges: Zero-Plaintext Broker live blast-radius --
    // One row per (credential, external-consumer-key) pair, UPSERTed on every
    // proxied management-API call so the dependency graph reflects observed
    // reality, not just declared bindings. Consumer identity is the
    // `external_api_keys` row that authenticated the call (per-consumer
    // handle or broad key). No FK to external_api_keys: revoked keys stay
    // visible as historical consumers (readers join for live status).
    run_step(
        conn,
        IncrementalMigration {
            id: "credential_consumer_edges",
            description: "Create credential_consumer_edges (broker per-consumer usage edges)",
            already_applied: |conn| has_table(conn, "credential_consumer_edges"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS credential_consumer_edges (
                        id               TEXT PRIMARY KEY,
                        credential_id    TEXT NOT NULL,
                        consumer_key_id  TEXT NOT NULL,
                        consumer_name    TEXT NOT NULL,
                        call_count       INTEGER NOT NULL DEFAULT 0,
                        last_status      INTEGER,
                        first_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
                        last_used_at     TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(credential_id, consumer_key_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_consumer_edges_credential
                        ON credential_consumer_edges(credential_id);",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_consumer_edges_consumer
                        ON credential_consumer_edges(consumer_key_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- autopilot_night_runs: Overnight Portfolio Engine ledger -------------
    // One row per project per night (UNIQUE(project_id, night) is the
    // once-per-night claim). Written by the overnight subscription tick and
    // the manual `dev_tools_run_overnight_now` command; read by the
    // night-runs list command and the morning digest. Soft ref to
    // dev_projects (no FK): a night's audit trail survives project deletion.
    run_step(
        conn,
        IncrementalMigration {
            id: "autopilot_night_runs",
            description: "Create autopilot_night_runs (Overnight Portfolio Engine per-night ledger)",
            already_applied: |conn| has_table(conn, "autopilot_night_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS autopilot_night_runs (
                        id                 TEXT PRIMARY KEY,
                        project_id         TEXT NOT NULL,
                        night              TEXT NOT NULL,
                        mode               TEXT NOT NULL,
                        status             TEXT NOT NULL DEFAULT 'running',
                        scan_added         INTEGER NOT NULL DEFAULT 0,
                        scan_modified      INTEGER NOT NULL DEFAULT 0,
                        scan_deleted       INTEGER NOT NULL DEFAULT 0,
                        triage_applied     INTEGER NOT NULL DEFAULT 0,
                        ideas_accepted     INTEGER NOT NULL DEFAULT 0,
                        ideas_rejected     INTEGER NOT NULL DEFAULT 0,
                        dispatched_count   INTEGER NOT NULL DEFAULT 0,
                        skipped_count      INTEGER NOT NULL DEFAULT 0,
                        blocked_reason     TEXT,
                        degraded           INTEGER NOT NULL DEFAULT 0,
                        projected_cost_usd REAL NOT NULL DEFAULT 0,
                        month_spend_usd    REAL NOT NULL DEFAULT 0,
                        ceiling_usd        REAL,
                        session_ids        TEXT,
                        started_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        finished_at        TEXT,
                        UNIQUE(project_id, night)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_night_runs_project
                        ON autopilot_night_runs(project_id, started_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Self-Evolving Team v1: assignment outcomes + team-scoped trust ------
    // `assignment_outcomes` — one learning record per terminal assignment
    // (UNIQUE(assignment_id) makes the first terminal transition the writer).
    // `team_member_trust` — Brier-updated, floored per-(team, persona) trust
    // the matcher overlays on the persona's global trust_score. Soft refs
    // (no FK) so the learning ledger survives assignment/team deletion audits.
    run_step(
        conn,
        IncrementalMigration {
            id: "assignment_outcomes",
            description: "Create assignment_outcomes + team_member_trust (Self-Evolving Team v1)",
            already_applied: |conn| has_table(conn, "assignment_outcomes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS assignment_outcomes (
                        id                    TEXT PRIMARY KEY,
                        assignment_id         TEXT NOT NULL UNIQUE,
                        team_id               TEXT NOT NULL,
                        status                TEXT NOT NULL,
                        steps_total           INTEGER NOT NULL DEFAULT 0,
                        steps_done            INTEGER NOT NULL DEFAULT 0,
                        steps_failed          INTEGER NOT NULL DEFAULT 0,
                        steps_skipped         INTEGER NOT NULL DEFAULT 0,
                        review_interventions  INTEGER NOT NULL DEFAULT 0,
                        duration_secs         INTEGER,
                        outcome_json          TEXT NOT NULL DEFAULT '{}',
                        retro_deliberation_id TEXT,
                        retro_skipped_reason  TEXT,
                        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_assignment_outcomes_team
                        ON assignment_outcomes(team_id, created_at DESC);
                    CREATE TABLE IF NOT EXISTS team_member_trust (
                        team_id    TEXT NOT NULL,
                        persona_id TEXT NOT NULL,
                        trust      REAL NOT NULL,
                        samples    INTEGER NOT NULL DEFAULT 0,
                        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (team_id, persona_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Darwin Mode v1: measured-fitness provenance marker ------------------
    // `fitness_source` distinguishes an offspring's mid-parent PREDICTION
    // ("inherited") from a fixture-replay EVALUATION ("measured"). Legacy rows
    // stay NULL (all inherited by construction).
    run_step(
        conn,
        IncrementalMigration {
            id: "genome_results_fitness_source",
            description: "Add fitness_source (measured|inherited) to genome_breeding_results",
            already_applied: |conn| has_column(conn, "genome_breeding_results", "fitness_source"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE genome_breeding_results ADD COLUMN fitness_source TEXT;",
                )
            },
        },
    )?;

    // -- Darwin Mode v1: human-gated promotion queue -------------------------
    // An evolution cycle whose challenger beats the incumbent FILES a row here;
    // nothing is applied until a human approves (see
    // db/src/repos/lab/evolution_proposals.rs). Soft refs to evolution_cycles /
    // personas (no FK): the audit trail survives cycle/persona deletion.
    run_step(
        conn,
        IncrementalMigration {
            id: "evolution_promotion_proposals",
            description: "Create evolution_promotion_proposals (Darwin Mode review-gated promotion)",
            already_applied: |conn| has_table(conn, "evolution_promotion_proposals"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS evolution_promotion_proposals (
                        id                 TEXT PRIMARY KEY,
                        cycle_id           TEXT NOT NULL,
                        persona_id         TEXT NOT NULL,
                        status             TEXT NOT NULL DEFAULT 'pending',
                        winner_genome_json TEXT NOT NULL,
                        new_prompt         TEXT NOT NULL,
                        incumbent_score    REAL NOT NULL,
                        winner_score       REAL NOT NULL,
                        improvement        REAL NOT NULL,
                        threshold          REAL NOT NULL,
                        fitness_source     TEXT NOT NULL DEFAULT 'measured',
                        evidence_json      TEXT,
                        base_updated_at    TEXT NOT NULL,
                        decision_note      TEXT,
                        created_at         TEXT NOT NULL,
                        decided_at         TEXT
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_evo_proposals_persona
                        ON evolution_promotion_proposals(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Self-Wiring Fabric v1: mined automation suggestions -----------------
    // Written by `engine::pattern_miner` (event→manual-run co-occurrence),
    // rendered as ghost cables in the Studio patchbay. UNIQUE(event_type,
    // persona_id) makes the miner's upsert idempotent; `committed_trigger_id`
    // is the mined-route tag that excludes an accepted suggestion's own
    // trigger traffic from future evidence.
    run_step(
        conn,
        IncrementalMigration {
            id: "automation_suggestions",
            description: "Create automation_suggestions (Self-Wiring Fabric mined ghost cables)",
            already_applied: |conn| has_table(conn, "automation_suggestions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS automation_suggestions (
                        id                   TEXT PRIMARY KEY,
                        event_type           TEXT NOT NULL,
                        persona_id           TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        status               TEXT NOT NULL DEFAULT 'proposed'
                                             CHECK(status IN ('proposed','accepted','rejected')),
                        occurrence_count     INTEGER NOT NULL DEFAULT 0,
                        manual_run_count     INTEGER NOT NULL DEFAULT 0,
                        support              REAL NOT NULL DEFAULT 0,
                        window_seconds       INTEGER NOT NULL,
                        lookback_days        INTEGER NOT NULL,
                        evidence_json        TEXT NOT NULL DEFAULT '[]',
                        committed_trigger_id TEXT,
                        first_seen_at        TEXT,
                        last_seen_at         TEXT,
                        decided_at           TEXT,
                        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(event_type, persona_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_autosuggest_status
                        ON automation_suggestions(status, updated_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- lab_ab_experiments: Director's Lab experiment registry --------------
    // One row per commissioned verdict→hypothesis experiment (batch-3
    // Director's Lab v1). Provenance-first: review_id soft-refs the approved
    // Director verdict (persona_manual_reviews, no FK — the audit trail
    // survives review pruning), hypothesis_json is the typed hypothesis
    // block, provenance_json snapshots the verdict evidence. status:
    // awaiting_variant | variant_ready | declined_budget | running |
    // concluded (running/concluded reserved for the deferred canary loop).
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_ab_experiments",
            description: "Create lab_ab_experiments (Director's Lab verdict→experiment registry)",
            already_applied: |conn| has_table(conn, "lab_ab_experiments"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS lab_ab_experiments (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT NOT NULL,
                        review_id       TEXT,
                        hypothesis_json TEXT NOT NULL,
                        provenance_json TEXT,
                        status          TEXT NOT NULL DEFAULT 'awaiting_variant'
                                        CHECK(status IN ('awaiting_variant','variant_ready',
                                                         'declined_budget','running','concluded')),
                        status_detail   TEXT,
                        variant_prompt  TEXT,
                        variant_source  TEXT,
                        spend_usd       REAL NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_lab_ab_experiments_persona
                        ON lab_ab_experiments(persona_id, created_at DESC);",
                )?;
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_ab_experiments_review
                        ON lab_ab_experiments(review_id) WHERE review_id IS NOT NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- policy_proposals: Self-Tuning Fabric review-each ledger -------------
    // One row per proposed policy change (routing-rule diff / budget ceiling)
    // with its typed payload+claim and the evidence-snapshot slice it was
    // derived from. Written by policy_tuning_generate; transitioned by the
    // apply/decline commands. Declined rows are kept as feedback — the
    // generator will not re-propose an answered question.
    run_step(
        conn,
        IncrementalMigration {
            id: "policy_proposals",
            description: "Create policy_proposals (Self-Tuning Fabric proposal ledger)",
            already_applied: |conn| has_table(conn, "policy_proposals"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS policy_proposals (
                        id                   TEXT PRIMARY KEY,
                        kind                 TEXT NOT NULL
                            CHECK(kind IN ('routing_rule', 'budget_ceiling', 'healing_strategy')),
                        category             TEXT,
                        payload_json         TEXT NOT NULL,
                        evidence_snapshot_id TEXT NOT NULL,
                        evidence_json        TEXT NOT NULL,
                        status               TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'applied', 'declined')),
                        decline_reason       TEXT,
                        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        decided_at           TEXT
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_policy_proposals_status
                        ON policy_proposals(status, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;


    // -- Pattern fabric v2: the three-layer model ----------------------------
    // (docs/concepts/pattern-fabric.md v2) Principle → Manifestation →
    // Evidence. `layer` classifies a knowledge row's place in that hierarchy:
    //   'principle'     — universal, language-free direction; the only layer
    //                     the topic tree and the graph canvas carry.
    //   'manifestation' — a principle applied to one stack/seam (Tauri IPC,
    //                     browser fetch, tokio reads); parent = governing_id.
    //   NULL            — not yet reclassified (the pre-v2 corpus). NULL is
    //                     deliberate: guessing a layer at migration time would
    //                     fake the review the restructuring panels exist to
    //                     do, so legacy rows stay honestly unclassified until
    //                     a panel (or a human) rules on them.
    if !has_column(conn, "workspace_knowledge", "layer").unwrap_or(true) {
        let _ = ddl_step(
            conn,
            "ALTER TABLE workspace_knowledge ADD COLUMN layer TEXT
                 CHECK (layer IN ('principle','manifestation'));",
        );
    }
    // Evidence as first-class rows, not markdown fused into detail_md. This
    // is what lets MULTIPLE projects stack references under one manifestation
    // (cross-language improvement flow), lets the verify lane REFRESH proof
    // (verified_at) instead of only scoring adherence, and makes evidence
    // aging visible instead of fossilized prose. `project_id` has no FK on
    // purpose — deleting a project leaves provenance readable, same posture
    // as workspace_knowledge.origin_project_id.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_knowledge_evidence (
            id           TEXT PRIMARY KEY,
            knowledge_id TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            project_id   TEXT,
            refs         TEXT NOT NULL DEFAULT '[]',
            quote        TEXT,
            source       TEXT NOT NULL CHECK (source IN ('harvest','verify','manual')),
            recorded_at  TEXT NOT NULL,
            verified_at  TEXT
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wke_knowledge
            ON workspace_knowledge_evidence(knowledge_id);",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wke_project
            ON workspace_knowledge_evidence(project_id);",
    );

    // `team_assignment_steps.execution_id` is the only one of seven children of
    // `persona_executions` whose FK column has no index, and it carries
    // ON DELETE SET NULL — so every delete of an execution row makes SQLite scan
    // the whole child table to find referents.
    //
    // Measured by ablation on a copy of the live database: the FK cascade was
    // 97% of a 31.8 s delete (FTS was 5%). Adding this index took the same
    // delete from 26,016 ms to 1,066 ms — 24x.
    //
    // This matters beyond general slowness: execution retention has never
    // actually deleted a row (see retention-and-pruning.md), so the day that is
    // fixed, the hourly cleanup tick suddenly deletes ~1,776 rows. Without this
    // index that is a ~26 s app-wide write stall on a local SQLite file. The
    // index must therefore land BEFORE any retention change, not with it.
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_tas_execution
            ON team_assignment_steps(execution_id);",
    );
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
fn drop_legacy_tool_calls_columns(conn: &Connection) {
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
fn backfill_lab_tool_calls(conn: &Connection) -> Result<(), AppError> {
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
fn research_lab_align_columns(conn: &Connection) {
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
fn widen_kpi_measurement_source_with_ai_compose(conn: &Connection) -> Result<(), AppError> {
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
fn normalize_goal_statuses_in_place(conn: &Connection) -> Result<Vec<(String, String)>, AppError> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, status FROM dev_goals")?;
        let mapped = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?
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
fn constrain_goal_status_to_canonical_set(conn: &Connection) -> Result<(), AppError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Rows written before `create_milestone` learned to stamp `cut_at` are
    /// active with no cut — the scope-creep baseline is missing. The backfill
    /// step must repair them on the next boot, and must not touch 'planned'
    /// rows (uncut by definition) or an already-stamped `cut_at`.
    #[test]
    fn backfill_cut_at_repairs_uncut_active_milestones() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1', 'P', '/tmp/p1');
             INSERT INTO dev_milestones (id, project_id, name, status, created_at, updated_at)
                VALUES ('m-active', 'p1', 'Onboard', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO dev_milestones (id, project_id, name, status, created_at, updated_at)
                VALUES ('m-planned', 'p1', 'Later', 'planned', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO dev_milestones (id, project_id, name, status, cut_at, created_at, updated_at)
                VALUES ('m-cut', 'p1', 'Cut', 'active', '2026-02-02T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .unwrap();

        // The backfill lives in the `ensure_composite_fires_table` phase that
        // `migrations::run` invokes, so replay the whole boot chain.
        crate::migrations::run(&conn).unwrap();
        run_incremental(&conn).unwrap();

        let cut_at = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT cut_at FROM dev_milestones WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(cut_at("m-active").as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(cut_at("m-planned"), None, "planned milestones stay uncut");
        assert_eq!(
            cut_at("m-cut").as_deref(),
            Some("2026-02-02T00:00:00Z"),
            "an existing cut stamp must not be rewritten"
        );
    }

    /// The description/rating ALTER lands on a table the operator already has
    /// live rows in, and the boot chain replays on EVERY launch. Both columns
    /// must appear, existing rows must survive with NULLs (unrated, which is
    /// not rated-1), and replaying must neither fail nor rewrite the data.
    #[test]
    fn milestone_item_description_rating_alter_is_safe_on_a_populated_db() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p9', 'P', '/tmp/p9');
             INSERT INTO dev_milestones (id, project_id, name, status, cut_at, created_at, updated_at)
                VALUES ('m9', 'p9', 'v1', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, bucket, added_after_cut, order_index, created_at)
                VALUES ('m9', 'use_case', 'uc-old', 'core', 1, 0, '2026-01-01T00:00:00Z');",
        )
        .unwrap();

        assert!(has_column(&conn, "dev_milestone_items", "description").unwrap());
        assert!(has_column(&conn, "dev_milestone_items", "rating").unwrap());

        // Annotate the pre-existing row, then replay the whole boot chain
        // twice — the guard must skip the ALTER rather than error, and must
        // not touch the data.
        conn.execute(
            "UPDATE dev_milestone_items SET description = 'kept', rating = 4
             WHERE milestone_id = 'm9' AND item_id = 'uc-old'",
            [],
        )
        .unwrap();
        crate::migrations::run(&conn).unwrap();
        run_incremental(&conn).unwrap();
        crate::migrations::run(&conn).unwrap();
        run_incremental(&conn).unwrap();

        let (desc, rating, creep): (Option<String>, Option<i64>, i64) = conn
            .query_row(
                "SELECT description, rating, added_after_cut FROM dev_milestone_items
                 WHERE milestone_id = 'm9' AND item_id = 'uc-old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(desc.as_deref(), Some("kept"));
        assert_eq!(rating, Some(4));
        assert_eq!(creep, 1, "the replay must not disturb the creep flag");

        // The CHECK rode along on the ADD COLUMN.
        assert!(
            conn.execute(
                "UPDATE dev_milestone_items SET rating = 0 WHERE milestone_id = 'm9'",
                [],
            )
            .is_err(),
            "rating 0 must be refused by the column CHECK"
        );
    }

    /// The boot path (`db::init_db`, db/mod.rs) replays BOTH migration phases
    /// — `migrations::run` + `run_incremental` — on EVERY app launch against
    /// whatever database already exists on disk. A single non-idempotent step
    /// (unguarded `ALTER TABLE ADD COLUMN`, a `CREATE TABLE` without
    /// `IF NOT EXISTS`, a rebuild that re-fires) therefore bricks every
    /// existing install on its next launch, not just upgrades.
    ///
    /// `init_test_db` runs the exact same chain once (fresh install); this
    /// test then replays the chain twice more, simulating the second and
    /// third launches on the same database file.
    #[test]
    fn migration_chain_is_idempotent_on_rerun() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        // Second launch on the existing DB — the upgrade-on-boot path.
        crate::migrations::run(&conn)
            .expect("2nd run of initial migrations failed — every existing install would brick on next launch");
        run_incremental(&conn)
            .expect("2nd run of incremental migrations failed — every existing install would brick on next launch");

        // Third launch — catches guards that only survive exactly one replay
        // (e.g. a step whose first replay mutates the state its own
        // `already_applied` check reads).
        crate::migrations::run(&conn).expect("3rd run of initial migrations failed");
        run_incremental(&conn).expect("3rd run of incremental migrations failed");

        // The replays must leave a structurally sound database behind.
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok", "integrity_check failed after migration replay");

        let fk_violations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_check()",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fk_violations, 0, "foreign_key_check found violations after migration replay");

        // The persona_executions rebuild guard must not re-widen the status
        // CHECK on replay: exactly one 'incomplete' in the stored DDL. Two
        // would mean the `already_applied` guard failed and the table was
        // rebuilt again (dropping/re-copying user execution history on boot).
        let ddl: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_executions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            ddl.matches("'incomplete'").count(),
            1,
            "persona_executions CHECK was re-widened on replay — rebuild migration is not idempotent"
        );
    }

    /// A guarded `ALTER TABLE … ADD COLUMN` that genuinely cannot succeed must
    /// SURFACE. Six sites in this file used `let _ = ddl_step(…)` to absorb the
    /// "duplicate column name" they expect on re-run — and absorbed every other
    /// error with it, so a migration that never wrote anything reported success.
    ///
    /// Simulates a database where the statement cannot possibly work (its table
    /// is gone). Under the discarded Result this returned `Ok(())`.
    #[test]
    fn a_genuinely_failed_guarded_alter_is_no_longer_swallowed() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        // `cloud_webhook_watermarks` is created by the very next step after the
        // guarded ALTER and by nothing else in the tree, so its absence pins
        // WHERE the chain stopped. Without that marker the assertion is empty:
        // with the Result discarded the chain sails past the ALTER and only
        // trips ~200 lines later on `CREATE INDEX … ON automation_runs`, which
        // raises the same "no such table" from a completely different cause.
        conn.execute_batch(
            "DROP TABLE automation_runs;
             DROP TABLE cloud_webhook_watermarks;",
        )
        .unwrap();

        let err = run_incremental(&conn)
            .expect_err("an ALTER that cannot succeed must surface, not be swallowed");
        assert!(
            err.to_string().contains("automation_runs"),
            "the surfaced error must name the failing table, got: {err}",
        );
        assert!(
            !has_table(&conn, "cloud_webhook_watermarks").unwrap(),
            "the chain ran PAST the failed ALTER — the error was still being swallowed",
        );
    }

    /// `retire_persona_groups` drops `personas.group_id` and then drops the
    /// `persona_groups` table it references. SQLite refuses `DROP COLUMN` while
    /// any index/trigger/view still names the column — and the discarded Result
    /// meant the migration marched on to `DROP TABLE persona_groups` anyway,
    /// leaving `personas` with a REFERENCES clause pointing at nothing. With
    /// `foreign_keys = ON` (every pooled connection) that makes EVERY
    /// `INSERT INTO personas` fail with `no such table: persona_groups`.
    ///
    /// Rebuilds that exact legacy shape, including a COMPOSITE index the
    /// migration's hand-written `DROP INDEX` list has never heard of.
    #[test]
    fn a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            // The ORIGINAL pre-workspace shape: the chain's own earlier step
            // ("Added workspace fields to persona_groups") adds description +
            // the four default_* columns that `groups_to_teams_data_migration`
            // then reads, so seeding them here would collide with it.
            "CREATE TABLE persona_groups (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                color      TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             ALTER TABLE persona_memories ADD COLUMN group_id TEXT;
             ALTER TABLE personas ADD COLUMN group_id TEXT REFERENCES persona_groups(id);
             CREATE INDEX idx_personas_group_and_name ON personas(group_id, name);",
        )
        .unwrap();

        // A blocked DROP COLUMN is not worth bricking a launch over…
        run_incremental(&conn)
            .expect("a blocked DROP COLUMN must not abort the whole migration chain");

        // …but the parent table must not be dropped out from under the FK.
        assert!(
            has_table(&conn, "persona_groups").unwrap(),
            "persona_groups was dropped while personas.group_id still references it",
        );
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at) \
             VALUES ('p1', 'n', 'sp', datetime('now'), datetime('now'))",
            [],
        )
        .expect("persona creation must still work after the migration");
    }

    /// Pins that a fresh database actually receives the artifacts of the
    /// NEWEST migrations at the tail of `run_incremental`. If a late step is
    /// accidentally short-circuited (e.g. an early `return`, a mis-keyed
    /// `already_applied` guard that reads true on a fresh DB, or a reordering
    /// that moves it behind a failing step), fresh installs silently miss
    /// tables/columns and every repo touching them errors at runtime.
    #[test]
    fn fresh_schema_contains_latest_migration_artifacts() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        // Tables created by the newest migrations (tail of run_incremental).
        for table in [
            "dev_goal_items",
            "team_assignment_templates",
            "dev_kpis",
            "dev_kpi_measurements",
            "dev_kpi_bindings",
            "dev_run_checkpoints",
            "athena_wake_log",
            "run_budgets",
            "dev_llm_spend",
            "dev_use_cases",
            "dev_use_case_contexts",
            "dev_milestones",
            "dev_milestone_items",
            "dev_workspaces",
            "workspace_knowledge",
            "workspace_practice_adoption",
            "dev_context_fingerprints",
        ] {
            assert!(
                has_table(&conn, table).unwrap(),
                "table `{table}` missing from a fresh database — its incremental migration did not run"
            );
        }

        // Columns ALTERed in by the newest migrations.
        for (table, column) in [
            ("persona_executions", "thinking_level"),
            ("persona_executions", "cache_read_tokens"),
            ("persona_executions", "cache_creation_tokens"),
            ("dev_goals", "kpi_id"),
            ("dev_goal_items", "verify_kind"),
            ("dev_goal_items", "verify_config"),
            ("dev_kpis", "metric_type"),
            ("dev_kpis", "tier"),
            ("dev_kpis", "context_id"),
            ("dev_kpis", "warn_at"),
            ("dev_kpis", "crit_at"),
            ("dev_kpis", "last_skip_at"),
            ("dev_kpis", "use_case_id"),
            ("team_assignments", "goal_id"),
            ("dev_contexts", "category"),
            ("dev_contexts", "business_feature"),
            ("dev_context_groups", "domain"),
            ("persona_memories", "derived_from"),
            ("persona_memory_review_proposal", "team_id"),
            ("dev_kpi_measurements", "env"),
            ("dev_projects", "workspace_id"),
            ("workspace_knowledge", "topic"),
            ("workspace_knowledge", "abstraction"),
            ("workspace_knowledge", "durability"),
        ] {
            assert!(
                has_column(&conn, table, column).unwrap(),
                "column `{table}.{column}` missing from a fresh database — its incremental migration did not run"
            );
        }

        // Indexes shipped alongside the newest table migrations.
        for index in [
            "idx_dev_llm_spend_source",
            "idx_dev_kpi_bindings_kpi",
            "idx_athena_wake_log_surface",
            "idx_run_budgets_kind",
            "idx_team_assignment_templates_team",
            "idx_dev_kpis_context",
            "idx_dev_kpis_use_case",
            "idx_dev_use_cases_project",
            "idx_workspace_knowledge_ws_status",
            "idx_workspace_knowledge_dedup",
            "idx_dev_context_fingerprints_hash",
        ] {
            assert!(
                has_index(&conn, index).unwrap(),
                "index `{index}` missing from a fresh database — its incremental migration did not run"
            );
        }

        // The status CHECK on persona_executions must carry 'incomplete'
        // (fresh DBs get it from the base schema; legacy DBs from the
        // rebuild migration). Without it, Incomplete executions fail to
        // persist and are force-written as `failed`.
        let ddl: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_executions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            ddl.contains("'incomplete'"),
            "persona_executions status CHECK does not allow 'incomplete'"
        );
    }

    /// `source='ai-compose'` is what the Factory measurement-setup compose run
    /// writes. Until the CHECK was widened SQLite rejected every one of them,
    /// and the background writer swallowed the error — so the assertion that
    /// matters is that the value is now *accepted*, on a fresh install and on a
    /// legacy database that still carries the narrow CHECK.
    #[test]
    fn ai_compose_is_an_accepted_measurement_source() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/ai-compose');
             INSERT INTO dev_kpis (id, project_id, name, category, measure_kind, unit, direction)
                VALUES ('k1','p1','Coverage','technical','codebase','%','up');",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence)
             VALUES ('m1','k1',61.5,'ai-compose','production','{\"cmd\":\"npx vitest run\"}')",
            [],
        )
        .expect("an AI-composed reading must be storable");

        // The widening is additive, never a hole: an invented source is still
        // refused, so the column keeps meaning something.
        assert!(
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source)
                 VALUES ('m2','k1',1.0,'vibes')",
                [],
            )
            .is_err(),
            "the CHECK must still reject a source nothing writes",
        );
    }

    /// The rebuild copies from the table's OWN stored DDL, so a column added by
    /// a later migration must survive it — a hand-written column list would
    /// silently drop the data. Simulates a legacy DB by narrowing the CHECK back
    /// down and adding a column the rebuild code has never heard of.
    #[test]
    fn widening_the_measurement_source_preserves_rows_and_later_columns() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/widen');
             INSERT INTO dev_kpis (id, project_id, name, category, measure_kind, unit, direction)
                VALUES ('k1','p1','Coverage','technical','codebase','%','up');",
        )
        .unwrap();

        // Rewind to the pre-widening shape, plus a "future" column.
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE dev_kpi_measurements;
             CREATE TABLE dev_kpi_measurements (
                id          TEXT PRIMARY KEY,
                kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                value       REAL NOT NULL,
                measured_at TEXT NOT NULL DEFAULT (datetime('now')),
                source      TEXT NOT NULL DEFAULT 'manual'
                            CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
                env         TEXT NOT NULL DEFAULT 'production'
                            CHECK(env IN ('local','test','production')),
                evidence    TEXT,
                note        TEXT
             );
             ALTER TABLE dev_kpi_measurements ADD COLUMN confidence REAL;
             CREATE INDEX idx_dev_kpi_measurements_kpi
                ON dev_kpi_measurements(kpi_id, measured_at DESC);
             INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, evidence, confidence)
                VALUES ('old','k1',40.0,'evaluator','{\"cmd\":\"legacy\"}',0.75);
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source)
                 VALUES ('pre','k1',1.0,'ai-compose')",
                [],
            )
            .is_err());

        run_incremental(&conn).unwrap();

        let (value, evidence, confidence): (f64, Option<String>, Option<f64>) = conn
            .query_row(
                "SELECT value, evidence, confidence FROM dev_kpi_measurements WHERE id = 'old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("the legacy row survived the rebuild");
        assert_eq!(value, 40.0);
        assert_eq!(evidence.as_deref(), Some("{\"cmd\":\"legacy\"}"));
        assert_eq!(
            confidence,
            Some(0.75),
            "a column the rebuild code never knew about must ride along with its data",
        );
        assert!(
            has_index(&conn, "idx_dev_kpi_measurements_kpi").unwrap(),
            "the index is replayed after the rename",
        );
        conn.execute(
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence)
             VALUES ('m1','k1',61.5,'ai-compose','production','{}')",
            [],
        )
        .expect("the widened CHECK now accepts the composed source");

        // Replay must be a no-op, not a second rebuild.
        run_incremental(&conn).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM dev_kpi_measurements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2, "re-running the migration must not duplicate or drop rows");
    }

    // ------------------------------------------------- dev_goals.status ----

    /// Rewind `dev_goals` to the unconstrained TEXT column and seed it with the
    /// given `(id, status)` rows, simulating a database written before the
    /// CHECK existed.
    fn legacy_goals_table(conn: &Connection, rows: &[(&str, &str)]) {
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/goal-status');
             DROP TABLE dev_goals;
             CREATE TABLE dev_goals (
               id             TEXT PRIMARY KEY,
               project_id     TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
               parent_goal_id TEXT REFERENCES dev_goals(id) ON DELETE SET NULL,
               context_id     TEXT,
               order_index    INTEGER NOT NULL DEFAULT 0,
               title          TEXT NOT NULL,
               description    TEXT,
               status         TEXT NOT NULL DEFAULT 'open',
               progress       INTEGER DEFAULT 0,
               target_date    TEXT,
               started_at     TEXT,
               completed_at   TEXT,
               created_at     TEXT NOT NULL DEFAULT (datetime('now')),
               updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
             );
             ALTER TABLE dev_goals ADD COLUMN kpi_id TEXT;
             CREATE INDEX idx_dev_goals_project ON dev_goals(project_id);
             CREATE INDEX idx_dev_goals_status  ON dev_goals(status);
             CREATE INDEX idx_dev_goals_parent  ON dev_goals(parent_goal_id);
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
        for (i, (id, status)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO dev_goals (id, project_id, title, status, kpi_id)
                 VALUES (?1, 'p1', ?2, ?3, ?4)",
                rusqlite::params![id, format!("goal {i}"), status, format!("kpi-{i}")],
            )
            .unwrap();
        }
    }

    fn status_of(conn: &Connection, id: &str) -> String {
        conn.query_row(
            "SELECT status FROM dev_goals WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Every legacy spelling `normalizeGoalStatus` already folds must survive
    /// the migration as its canonical form. A CHECK that rejected them would
    /// brick the launch of any install that has one.
    #[test]
    fn legacy_goal_status_aliases_migrate_to_their_canonical_form() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        legacy_goals_table(
            &conn,
            &[
                ("g-running", "running"),
                ("g-matching", "matching"),
                ("g-underscore", "in_progress"),
                ("g-review", "review"),
                ("g-awaiting-review", "awaiting_review"),
                ("g-completed", "completed"),
                ("g-skipped", "skipped"),
                ("g-queued", "queued"),
                ("g-open", "open"),
                ("g-accept", "awaiting_acceptance"),
            ],
        );

        run_incremental(&conn).unwrap();

        for (id, expected) in [
            ("g-running", "in-progress"),
            ("g-matching", "in-progress"),
            ("g-underscore", "in-progress"),
            ("g-review", "blocked"),
            ("g-awaiting-review", "blocked"),
            ("g-completed", "done"),
            ("g-skipped", "done"),
            ("g-queued", "open"),
            ("g-open", "open"),
            ("g-accept", "awaiting_acceptance"),
        ] {
            assert_eq!(status_of(&conn, id), expected, "{id} migrated wrong");
        }
        // The rebuild preserved the ALTER-added column and the indexes.
        let kpi_id: Option<String> = conn
            .query_row(
                "SELECT kpi_id FROM dev_goals WHERE id = 'g-running'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kpi_id.as_deref(), Some("kpi-0"));
        for idx in ["idx_dev_goals_project", "idx_dev_goals_status", "idx_dev_goals_parent"] {
            assert!(has_index(&conn, idx).unwrap(), "{idx} was not replayed");
        }
    }

    /// The point of the constraint: a writer that bypasses the canonical set is
    /// stopped at the boundary instead of silently mis-laning a goal forever.
    #[test]
    fn a_non_canonical_goal_status_is_rejected_at_the_db_boundary() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/goal-reject')",
            [],
        )
        .unwrap();

        for bad in ["in_progress", "running", "completed", "", "whatever"] {
            let err = conn.execute(
                "INSERT INTO dev_goals (id, project_id, title, status)
                 VALUES ('bad','p1','t',?1)",
                rusqlite::params![bad],
            );
            assert!(err.is_err(), "status {bad:?} must be refused by the CHECK");
        }
        for good in crate::repos::dev_tools::CANONICAL_GOAL_STATUSES {
            conn.execute(
                "INSERT INTO dev_goals (id, project_id, title, status)
                 VALUES (?1,'p1','t',?2)",
                rusqlite::params![format!("ok-{good}"), good],
            )
            .unwrap_or_else(|e| panic!("canonical status {good:?} must be accepted: {e}"));
        }
    }

    /// A status nothing maps is REPORTED — a goal signal carrying the original
    /// value, not a silent rewrite — and the migration still completes, because
    /// it runs on every launch and must never brick one.
    #[test]
    fn an_unmappable_goal_status_is_reported_rather_than_quietly_defaulted() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        legacy_goals_table(&conn, &[("g-weird", "escalated-to-legal"), ("g-fine", "running")]);

        run_incremental(&conn).unwrap();

        assert_eq!(status_of(&conn, "g-weird"), "open");
        let (kind, message): (String, String) = conn
            .query_row(
                "SELECT signal_type, message FROM dev_goal_signals WHERE goal_id = 'g-weird'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("the unmappable value must leave a trace on the goal itself");
        assert_eq!(kind, "status_unmappable");
        assert!(
            message.contains("escalated-to-legal"),
            "the report must carry the ORIGINAL value, or it buried the bug: {message}",
        );
        // A mappable neighbour is untouched by the anomaly path.
        assert_eq!(status_of(&conn, "g-fine"), "in-progress");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM dev_goal_signals", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1,
            "only the unmappable row is reported",
        );
    }

    /// Re-running is a no-op: the guard reads the stored DDL, so a second and
    /// third launch neither rebuild the table nor re-report anything.
    #[test]
    fn re_running_the_goal_status_migration_changes_nothing() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        legacy_goals_table(&conn, &[("g-weird", "escalated-to-legal"), ("g-run", "running")]);

        run_incremental(&conn).unwrap();
        let ddl_after_first: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_goals'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        run_incremental(&conn).unwrap();
        run_incremental(&conn).unwrap();

        let ddl_after_third: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_goals'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ddl_after_first, ddl_after_third, "the replay rebuilt the table again");
        assert_eq!(
            ddl_after_third.matches("CHECK(status IN").count(),
            1,
            "a replay must not stack a second CHECK onto the column",
        );
        assert_eq!(status_of(&conn, "g-run"), "in-progress");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM dev_goal_signals", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1,
            "the anomaly is reported once, not once per launch",
        );
    }

    /// The retired DB skills system ("System A") must be absent from a fresh
    /// database: the CREATE was removed from initial.rs, so a fresh install
    /// never creates `skills` / `skill_components` / `persona_skills`.
    #[test]
    fn fresh_database_has_no_db_skills_tables() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        for table in ["skills", "skill_components", "persona_skills"] {
            assert!(
                !has_table(&conn, table).unwrap(),
                "retired DB skills table `{table}` was created on a fresh install"
            );
        }
    }

    /// The guarded-drop retirement migration removes the three legacy tables
    /// when they are EMPTY, but preserves any table that still holds rows
    /// (never delete user data). Simulates a legacy database by recreating the
    /// old schema, then replays `run_incremental`.
    #[test]
    fn retire_db_skills_drops_empty_but_preserves_nonempty() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        // Recreate the legacy System-A schema on top of the fresh DB.
        conn.execute_batch(
            "CREATE TABLE skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT, category TEXT, is_builtin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(name, version));
             CREATE TABLE skill_components (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
                component_type TEXT NOT NULL, component_data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')));
             CREATE TABLE persona_skills (
                id TEXT PRIMARY KEY, persona_id TEXT NOT NULL,
                skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
                enabled INTEGER NOT NULL DEFAULT 1, config TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(persona_id, skill_id));",
        )
        .unwrap();

        // Case 1: all empty → all dropped on replay.
        run_incremental(&conn).unwrap();
        for table in ["skills", "skill_components", "persona_skills"] {
            assert!(
                !has_table(&conn, table).unwrap(),
                "empty legacy table `{table}` was not dropped by the retirement migration"
            );
        }

        // Case 2: a non-empty `skills` table must be preserved.
        conn.execute_batch(
            "CREATE TABLE skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT, category TEXT, is_builtin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(name, version));",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (id, name) VALUES ('s1', 'user skill')",
            [],
        )
        .unwrap();
        run_incremental(&conn).unwrap();
        assert!(
            has_table(&conn, "skills").unwrap(),
            "non-empty legacy `skills` table was deleted — user data lost"
        );
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM skills", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "user skill row was lost");
    }

    // -- Dangling foreign-key targets ----------------------------------------

    /// The static gate proposed in `docs/concepts/golden-paths/schema-change.md`
    /// ("The missing gate", difference set C), as a runtime assertion over the
    /// database the real chain actually builds.
    ///
    /// SQLite resolves foreign-key targets LAZILY: `REFERENCES nonexistent(id)`
    /// succeeds at `CREATE TABLE` and only raises `no such table:
    /// main.nonexistent` on the first `INSERT` under `foreign_keys = ON`. And
    /// `PRAGMA foreign_key_check` is structurally blind to it on an EMPTY child
    /// table — which a table whose every insert fails always is — so
    /// `migration_chain_is_idempotent_on_rerun`'s FK assertion passes straight
    /// over the defect. This query is what sees it.
    ///
    /// `mcp_gateway_members` -> `credentials` shipped 2026-04-08 and made the
    /// whole gateway-membership feature dead on arrival on every install.
    #[test]
    fn no_foreign_key_points_at_a_missing_table() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT m.name, fk.\"table\"
                   FROM sqlite_master m
                   JOIN pragma_foreign_key_list(m.name) fk
                  WHERE m.type = 'table'
                    AND fk.\"table\" NOT IN (
                          SELECT name FROM sqlite_master WHERE type = 'table')",
            )
            .unwrap();
        let dangling: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        // Assert the instrument before the result: a database with no tables
        // would produce an empty list and a false pass.
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            table_count > 200,
            "only {table_count} tables in the fresh schema — the chain did not run, \
             so this test proves nothing"
        );
        let fk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master m
                   JOIN pragma_foreign_key_list(m.name) fk
                  WHERE m.type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            fk_count > 50,
            "only {fk_count} foreign keys found — the pragma join is broken, not the schema"
        );

        assert!(
            dangling.is_empty(),
            "foreign keys point at tables that do not exist (child -> phantom parent): {dangling:?}. \
             Every INSERT into those children fails at runtime under foreign_keys = ON."
        );
    }

    /// The behavioural half: the gateway-membership feature must actually work.
    /// `add_member`'s INSERT is the statement that has been raising
    /// `no such table: main.credentials` since 2026-04-08.
    #[test]
    fn mcp_gateway_members_accepts_an_insert_under_foreign_keys_on() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        let fk_on: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk_on, 1, "test connection has FK enforcement off — proves nothing");

        conn.execute_batch(
            "INSERT INTO persona_credentials
                (id, name, service_type, encrypted_data, iv, created_at, updated_at)
             VALUES ('gw', 'Gateway', 'mcp_gateway', 'x', 'y', '2026-01-01', '2026-01-01'),
                    ('mem', 'Member', 'mcp', 'x', 'y', '2026-01-01', '2026-01-01');",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO mcp_gateway_members
                (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
             VALUES ('m1', 'gw', 'mem', 'Member', 1, 0)",
            [],
        )
        .expect("adding a gateway member must succeed");

        // The FK must also be live, not merely non-dangling.
        let orphan = conn.execute(
            "INSERT INTO mcp_gateway_members
                (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
             VALUES ('m2', 'gw', 'does-not-exist', 'Ghost', 1, 0)",
            [],
        );
        assert!(
            orphan.is_err(),
            "a member row referencing a missing credential was accepted — the FK is not enforced"
        );

        // ON DELETE CASCADE must reach through the repointed parent.
        conn.execute("DELETE FROM persona_credentials WHERE id = 'gw'", [])
            .unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM mcp_gateway_members", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "deleting the gateway credential did not cascade");
    }

    /// The upgrade path: a database that already carries the broken shape must
    /// be repaired on its next boot, and must keep any rows it somehow holds.
    /// Rows are inserted with FK enforcement off, because with it on the broken
    /// table cannot be written to at all — which is the whole bug.
    #[test]
    fn legacy_mcp_gateway_members_fk_is_repaired_without_losing_rows() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        // Rebuild the table in its as-shipped (broken) shape.
        {
            let _guard = crate::FkDisabledGuard::new(&conn).unwrap();
            conn.execute_batch(
                "DROP TABLE mcp_gateway_members;
                 CREATE TABLE IF NOT EXISTS mcp_gateway_members (
                     id                      TEXT PRIMARY KEY,
                     gateway_credential_id   TEXT NOT NULL,
                     member_credential_id    TEXT NOT NULL,
                     display_name            TEXT NOT NULL,
                     enabled                 INTEGER NOT NULL DEFAULT 1,
                     sort_order              INTEGER NOT NULL DEFAULT 0,
                     created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                     FOREIGN KEY (gateway_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
                     FOREIGN KEY (member_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
                     UNIQUE (gateway_credential_id, member_credential_id)
                 );
                 CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_gw ON mcp_gateway_members(gateway_credential_id);
                 CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_member ON mcp_gateway_members(member_credential_id);
                 INSERT INTO persona_credentials
                     (id, name, service_type, encrypted_data, iv, created_at, updated_at)
                 VALUES ('gw', 'Gateway', 'mcp_gateway', 'x', 'y', '2026-01-01', '2026-01-01'),
                        ('mem', 'Member', 'mcp', 'x', 'y', '2026-01-01', '2026-01-01');
                 INSERT INTO mcp_gateway_members
                     (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
                 VALUES ('legacy', 'gw', 'mem', 'Legacy member', 1, 3);",
            )
            .unwrap();
        }
        assert_eq!(
            dangling_fk_count(&conn, "mcp_gateway_members").unwrap(),
            2,
            "fixture did not reproduce the broken shape"
        );

        // Next launch.
        run_incremental(&conn).expect("repair migration must not abort boot");

        assert_eq!(
            dangling_fk_count(&conn, "mcp_gateway_members").unwrap(),
            0,
            "the dangling foreign keys were not repaired"
        );
        let (display, sort): (String, i64) = conn
            .query_row(
                "SELECT display_name, sort_order FROM mcp_gateway_members WHERE id = 'legacy'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("the pre-existing member row was destroyed by the rebuild");
        assert_eq!(display, "Legacy member");
        assert_eq!(sort, 3, "column order was not preserved by the rebuild");

        // Indexes survive the DROP/RENAME.
        assert!(has_index(&conn, "idx_mcp_gateway_members_gw").unwrap());
        assert!(has_index(&conn, "idx_mcp_gateway_members_member").unwrap());

        // And the guard holds: a replay must not rebuild again.
        run_incremental(&conn).expect("replay after repair must be a no-op");
        assert_eq!(dangling_fk_count(&conn, "mcp_gateway_members").unwrap(), 0);
    }

    /// The three `pending_auth_*` columns were deleted, not corrected to
    /// `persona_executions`, because nothing reads or writes them. Pin that:
    /// if the JIT-OAuth runner integration is ever built it must add its own
    /// guarded step rather than resurrecting the swallowed ALTERs.
    #[test]
    fn pending_auth_scaffolding_columns_are_gone() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        for col in [
            "pending_auth_url",
            "pending_auth_started_at",
            "pending_auth_credential_id",
        ] {
            assert!(
                !has_column(&conn, "persona_executions", col).unwrap(),
                "{col} is back on persona_executions with no reader — \
                 add the reader in the same change or drop the column"
            );
        }
        assert!(
            !has_table(&conn, "executions").unwrap(),
            "an `executions` table now exists; the deleted ALTERs targeted it by mistake \
             and the comment explaining the deletion needs revisiting"
        );
    }
}
