use rusqlite::Connection;

use crate::error::AppError;

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
    let _fk_guard = crate::db::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

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
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_teal_tool    ON tool_execution_audit_log(tool_id);
            CREATE INDEX IF NOT EXISTS idx_teal_persona ON tool_execution_audit_log(persona_id);
            CREATE INDEX IF NOT EXISTS idx_teal_status  ON tool_execution_audit_log(result_status);
            CREATE INDEX IF NOT EXISTS idx_teal_created ON tool_execution_audit_log(created_at DESC);"
        )?;
        tracing::info!("Created tool_execution_audit_log table");
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
        CREATE INDEX IF NOT EXISTS idx_pe_execution ON policy_events(execution_id);
        CREATE INDEX IF NOT EXISTS idx_pe_persona   ON policy_events(persona_id);
        CREATE INDEX IF NOT EXISTS idx_pe_created   ON policy_events(created_at DESC);",
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
    let _ = ddl_step(conn, "ALTER TABLE automation_runs ADD COLUMN warnings TEXT;");

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
    let needs_role_migration: bool = conn
        .execute(
            "INSERT INTO chat_messages (id, persona_id, session_id, role, content, created_at)
             VALUES ('__role_check__', '__probe__', '__probe__', 'system', '', datetime('now'))",
            [],
        )
        .is_err();
    let _ = conn.execute("DELETE FROM chat_messages WHERE id = '__role_check__'", []);

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
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories_group_id",
            description: "Add group_id column to persona_memories for group-scoped sharing",
            already_applied: |conn| has_column(conn, "persona_memories", "group_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN group_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_pm_group_id ON persona_memories(group_id);",
                )?;
                Ok(())
            },
        },
    )?;

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
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects_group_id",
            description: "Add group_id column to dev_projects for workspace binding",
            already_applied: |conn| has_column(conn, "dev_projects", "group_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN group_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_dev_projects_group_id ON dev_projects(group_id);",
                )?;
                Ok(())
            },
        },
    )?;

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
            already_applied: |_conn| Ok(false),
            apply: |conn| {
                // Drop dependent indexes first — SQLite DROP COLUMN refuses an
                // indexed column. IF EXISTS keeps this safe on fresh DBs.
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_personas_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_pm_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_dev_projects_group_id;");

                // No-FK columns: safe native DROP COLUMN. has_column guard makes
                // it a no-op on fresh DBs and on re-run.
                if has_column(conn, "persona_memories", "group_id")? {
                    let _ = ddl_step(conn, "ALTER TABLE persona_memories DROP COLUMN group_id;");
                }
                if has_column(conn, "dev_projects", "group_id")? {
                    let _ = ddl_step(conn, "ALTER TABLE dev_projects DROP COLUMN group_id;");
                }

                // Drop the personas.group_id FK column outright. NULLing it is
                // NOT enough: with `PRAGMA foreign_keys = ON`, every INSERT into
                // personas resolves the FK's parent table, so leaving the FK in
                // place while dropping `persona_groups` breaks ALL persona
                // creation with "no such table: persona_groups". DROP COLUMN
                // removes the dangling FK (mirrors persona_memories/dev_projects
                // above; the index was already dropped). Guarded + idempotent.
                if has_column(conn, "personas", "group_id")? {
                    let _ = ddl_step(conn, "UPDATE personas SET group_id = NULL;");
                    let _ = ddl_step(conn, "ALTER TABLE personas DROP COLUMN group_id;");
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
            FOREIGN KEY (gateway_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
            FOREIGN KEY (member_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
            UNIQUE (gateway_credential_id, member_credential_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_gw ON mcp_gateway_members(gateway_credential_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_member ON mcp_gateway_members(member_credential_id);"
    )?;

    // -- JIT OAuth scaffolding on executions -----------------------------------
    // Scaffolding only -- the runner pause/resume integration is deferred until
    // an integration test harness exists. See `.planning/handoffs/2026-04-08-
    // mcp-gateway-arcade.md` Phase B for the full wiring plan. These columns let
    // us persist a pending-auth URL per execution so the frontend can surface
    // it without needing an in-memory-only registry (which loses state on reload).
    // The AwaitingAuth execution STATE is intentionally NOT added to the
    // ExecutionState lifecycle macro yet -- that's a cross-cutting change that
    // should land with the runner integration, not before it.
    for stmt in &[
        "ALTER TABLE executions ADD COLUMN pending_auth_url TEXT;",
        "ALTER TABLE executions ADD COLUMN pending_auth_started_at TEXT;",
        "ALTER TABLE executions ADD COLUMN pending_auth_credential_id TEXT;",
    ] {
        let _ = ddl_step(conn, stmt); // ignore duplicate column errors on re-run
    }

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
    let _ = ddl_step(conn, "ALTER TABLE twin_profiles ADD COLUMN knowledge_base_id TEXT;"); // ignore "duplicate column" on re-run

    // -- Twin plugin: persistent training directives (D5 — self-sharpening) --
    // Free-text "training style guide" per twin. The Training Studio seeds its
    // Directions box from this and can save edits back; every question/answer
    // generation prepends it so the studio learns the user's taste instead of
    // restating it each session.
    let _ = ddl_step(conn, "ALTER TABLE twin_profiles ADD COLUMN training_directives TEXT;"); // ignore "duplicate column" on re-run

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
                                    CHECK(source IN ('evaluator','manual','scan','health_snapshot')),
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
}
