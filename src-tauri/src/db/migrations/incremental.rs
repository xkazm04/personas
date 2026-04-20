use rusqlite::Connection;

use crate::error::AppError;

/// Incremental migrations for columns added after the initial schema.
/// Uses "ADD COLUMN ... IF NOT EXISTS" equivalent via PRAGMA table_info check.
pub(super) fn run_incremental(conn: &Connection) -> Result<(), AppError> {
    // Add tool_steps column to persona_executions (Feature 3: Execution Inspector)
    let has_tool_steps: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'tool_steps'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_tool_steps {
        conn.execute_batch("ALTER TABLE persona_executions ADD COLUMN tool_steps TEXT;")?;
        tracing::info!("Added tool_steps column to persona_executions");
    }

    // Add typed circuit-breaker flag to healing issues
    let has_is_circuit_breaker: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_healing_issues') WHERE name = 'is_circuit_breaker'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_is_circuit_breaker {
        conn.execute_batch("ALTER TABLE persona_healing_issues ADD COLUMN is_circuit_breaker INTEGER NOT NULL DEFAULT 0;")?;
        tracing::info!("Added is_circuit_breaker column to persona_healing_issues");
    }

    // Add use_case_flows column to persona_design_reviews
    let has_use_case_flows: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_design_reviews') WHERE name = 'use_case_flows'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_use_case_flows {
        conn.execute_batch("ALTER TABLE persona_design_reviews ADD COLUMN use_case_flows TEXT;")?;
        tracing::info!("Added use_case_flows column to persona_design_reviews");
    }

    // Add retry lineage columns to persona_executions (Healing: autonomous retry)
    let has_retry_of: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'retry_of_execution_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_retry_of {
        conn.execute_batch(
            "ALTER TABLE persona_executions ADD COLUMN retry_of_execution_id TEXT;
             ALTER TABLE persona_executions ADD COLUMN retry_count INTEGER DEFAULT 0;"
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
        // SQLite doesn't support ALTER CHECK, so we recreate.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS n8n_transform_sessions_new (
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
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_prompt_versions') WHERE name = 'tag'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ppv_tag {
        conn.execute_batch(
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
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS persona_triggers_new (
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
            INSERT INTO persona_triggers_new SELECT * FROM persona_triggers;
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
        conn.execute_batch(
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
        conn.execute_batch(
            "ALTER TABLE persona_executions ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pe_use_case ON persona_executions(use_case_id);"
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
        conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_messages') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_msg_use_case_id {
        conn.execute_batch(
            "ALTER TABLE persona_messages ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pmsg_use_case ON persona_messages(use_case_id);"
        )?;
        tracing::info!("Added use_case_id column to persona_messages");
    }

    let has_review_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_manual_reviews') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_review_use_case_id {
        conn.execute_batch(
            "ALTER TABLE persona_manual_reviews ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pmr_use_case ON persona_manual_reviews(use_case_id);"
        )?;
        tracing::info!("Added use_case_id column to persona_manual_reviews");
    }

    let has_memory_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_memories') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_memory_use_case_id {
        conn.execute_batch(
            "ALTER TABLE persona_memories ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pm_use_case ON persona_memories(use_case_id);"
        )?;
        tracing::info!("Added use_case_id column to persona_memories");
    }

    // Add use_case_id to persona_triggers
    let has_trigger_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_use_case_id {
        conn.execute_batch(
            "ALTER TABLE persona_triggers ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pt_use_case ON persona_triggers(use_case_id);"
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
        conn.execute_batch(
            "ALTER TABLE persona_event_subscriptions ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pes_use_case ON persona_event_subscriptions(use_case_id);"
        )?;
        tracing::info!("Added use_case_id column to persona_event_subscriptions");
    }

    // Add use_case_id to persona_events
    let has_event_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_events') WHERE name = 'use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_event_use_case_id {
        conn.execute_batch(
            "ALTER TABLE persona_events ADD COLUMN use_case_id TEXT;
             CREATE INDEX IF NOT EXISTS idx_pevt_use_case ON persona_events(use_case_id);"
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
        conn.execute_batch(
            "INSERT OR IGNORE INTO lab_arena_runs (id, persona_id, status, models_tested, scenarios_count, summary, error, created_at, completed_at)
             SELECT id, persona_id, status, models_tested, scenarios_count, summary, error, created_at, completed_at
             FROM persona_test_runs;

             INSERT OR IGNORE INTO lab_arena_results (id, run_id, scenario_name, model_id, provider, status, output_preview, tool_calls_expected, tool_calls_actual, tool_accuracy_score, output_quality_score, protocol_compliance, input_tokens, output_tokens, cost_usd, duration_ms, error_message, created_at)
             SELECT id, test_run_id, scenario_name, model_id, provider, status, output_preview, tool_calls_expected, tool_calls_actual, tool_accuracy_score, output_quality_score, protocol_compliance, input_tokens, output_tokens, cost_usd, duration_ms, error_message, created_at
             FROM persona_test_results;"
        )?;
        tracing::info!("Migrated {} test runs to lab_arena_runs", old_test_count);
    }

    // Add design_conversations table (persistent multi-turn design sessions)
    let has_design_conversations: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='design_conversations'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_design_conversations {
        conn.execute_batch(
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
            CREATE INDEX IF NOT EXISTS idx_dc_updated ON design_conversations(updated_at DESC);"
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
        conn.execute_batch(
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
                tool_calls_expected   TEXT,
                tool_calls_actual     TEXT,
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
            CREATE INDEX IF NOT EXISTS idx_lab_eval_results_run ON lab_eval_results(run_id);"
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
        conn.execute_batch(
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
            CREATE INDEX IF NOT EXISTS idx_test_suites_created ON test_suites(created_at DESC);"
        )?;
        tracing::info!("Created test_suites table");
    }

    // Promote persona_groups to workspace containers: add shared resource fields
    let has_group_description: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_groups') WHERE name = 'description'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_group_description {
        conn.execute_batch(
            "ALTER TABLE persona_groups ADD COLUMN description TEXT;
             ALTER TABLE persona_groups ADD COLUMN default_model_profile TEXT;
             ALTER TABLE persona_groups ADD COLUMN default_max_budget_usd REAL;
             ALTER TABLE persona_groups ADD COLUMN default_max_turns INTEGER;
             ALTER TABLE persona_groups ADD COLUMN shared_instructions TEXT;"
        )?;
        tracing::info!("Added workspace fields to persona_groups");
    }

    // Add execution_traces table (Structured Execution Traces with Span Tree)
    let has_execution_traces: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='execution_traces'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_execution_traces {
        conn.execute_batch(
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
            CREATE INDEX IF NOT EXISTS idx_et_created   ON execution_traces(created_at DESC);"
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
        conn.execute_batch(
            "ALTER TABLE persona_design_reviews ADD COLUMN adoption_count INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE persona_design_reviews ADD COLUMN last_adopted_at TEXT;"
        )?;
        tracing::info!("Added adoption_count and last_adopted_at columns to persona_design_reviews");
    }

    // Add unique index on test_case_name to prevent duplicate templates.
    // First clean up existing duplicates (keep newest per name), then create unique index.
    let has_unique_name_idx: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_unique_name_idx {
        conn.execute_batch(
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
        tracing::info!("Cleaned up duplicate design reviews and added unique index on test_case_name");
    }

    // Add unique index on (persona_id, event_type, COALESCE(source_filter, ''))
    // to prevent duplicate subscriptions that cause duplicate persona fires.
    let has_pes_unique_idx: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pes_unique_sub'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_pes_unique_idx {
        // Clean up existing duplicates first (keep newest per combo)
        conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_ptc_unique_edge'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ptc_unique_idx {
        conn.execute_batch(
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
               ON persona_team_connections(team_id, source_member_id, target_member_id);"
        )?;
        tracing::info!("Cleaned up duplicate/self-loop team connections and added unique index");
    }

    // Replace unique index on (test_case_name) with (test_case_name, test_run_id)
    // so that different review runs can each have their own results for the same template.
    let has_old_name_only_idx: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_old_name_only_idx {
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_pdr_unique_name;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pdr_unique_name_run
               ON persona_design_reviews(test_case_name, test_run_id);"
        )?;
        tracing::info!("Replaced unique index on test_case_name with (test_case_name, test_run_id)");
    }

    // Ensure the composite index exists even for fresh installs that never had the old one
    let has_composite_idx: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_pdr_unique_name_run'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_composite_idx {
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_pdr_unique_name_run
               ON persona_design_reviews(test_case_name, test_run_id);"
        )?;
    }

    // Add category column to persona_design_reviews (Template category filtering)
    let has_category: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_design_reviews') WHERE name = 'category'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_category {
        conn.execute_batch("ALTER TABLE persona_design_reviews ADD COLUMN category TEXT;")?;
        tracing::info!("Added category column to persona_design_reviews");
    }

    // Create credential_fields table for field-level credential storage.
    // For existing databases, the table is added here; for new databases
    // it's created by the base SCHEMA above.
    let has_credential_fields: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credential_fields'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_credential_fields {
        conn.execute_batch(
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

    // -- Unified Reactions: add event_listener trigger type ---------------
    // Recreate persona_triggers with event_listener in the CHECK constraint,
    // then copy all persona_event_subscriptions as event_listener triggers.
    let trigger_sql: String = conn
        .prepare("SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='persona_triggers'")?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    if !trigger_sql.contains("'event_listener'") {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS persona_triggers_new (
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
        conn.execute_batch(
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
        tracing::info!("Copied {} event subscriptions to event_listener triggers", sub_count);
    }

    // -- Credential Audit Log (append-only compliance trail) -------------
    let has_credential_audit_log: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credential_audit_log'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_credential_audit_log {
        conn.execute_batch(
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

    // -- Tool Execution Audit Log (append-only) --------------------------
    let has_tool_audit_log: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tool_execution_audit_log'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_tool_audit_log {
        conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_events') WHERE name = 'payload_iv'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_payload_iv {
        conn.execute_batch("ALTER TABLE persona_events ADD COLUMN payload_iv TEXT;")?;
        tracing::info!("Added payload_iv column to persona_events for encrypted event payloads");
    }

    // -- Persona sensitivity flag for hover-preview masking -------------
    let has_sensitive_flag: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'sensitive'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_sensitive_flag {
        conn.execute_batch("ALTER TABLE personas ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0;")?;
        tracing::info!("Added sensitive column to personas");
    }

    // -- Playwright Procedures (saved browser automation for credential setup) --
    let has_playwright_procedures: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='playwright_procedures'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_playwright_procedures {
        conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='execution_knowledge'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_execution_knowledge {
        conn.execute_batch(
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
        conn.execute_batch(
            "ALTER TABLE recipe_definitions ADD COLUMN credential_id TEXT;"
        )?;
        tracing::info!("Added credential_id column to recipe_definitions");
    }
    // Index created separately -- safe for both new and existing DBs
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_recipe_def_credential ON recipe_definitions(credential_id);"
    )?;

    // -- Recipe Definitions: add use_case_id column -----------------------
    let has_recipe_use_case_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('recipe_definitions') WHERE name='use_case_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_recipe_use_case_id {
        conn.execute_batch(
            "ALTER TABLE recipe_definitions ADD COLUMN use_case_id TEXT;"
        )?;
        tracing::info!("Added use_case_id column to recipe_definitions");
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_recipe_def_use_case ON recipe_definitions(use_case_id);"
    )?;

    // -- Recipe Versions table ------------------------------------------
    conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='provider_audit_log'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_provider_audit_log {
        conn.execute_batch(
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
            CREATE INDEX IF NOT EXISTS idx_pal_created   ON provider_audit_log(created_at DESC);"
        )?;
        tracing::info!("Created provider_audit_log table (BYOM)");
    }

    // -- Missing indexes for common query patterns --------------------
    // These cover the most frequent WHERE + ORDER BY combinations found
    // across repository modules. All use IF NOT EXISTS so they are safe
    // to run on existing databases that already have them.
    conn.execute_batch(
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
        conn.execute_batch("ALTER TABLE personas ADD COLUMN headless INTEGER NOT NULL DEFAULT 0;")?;
        tracing::info!("Added headless column to personas for background cron agents");
    }

    // -- Knowledge Annotations: scope, annotation, and verification columns --
    let has_ek_scope: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('execution_knowledge') WHERE name = 'scope_type'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_ek_scope {
        conn.execute_batch(
            "ALTER TABLE execution_knowledge ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'persona';
             ALTER TABLE execution_knowledge ADD COLUMN scope_id TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN annotation_text TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN annotation_source TEXT;
             ALTER TABLE execution_knowledge ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;"
        )?;
        conn.execute_batch(
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
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_tf_rating   ON template_feedback(rating);"
    )?;

    // -- Credential recipes: shared discovery cache across Design / Negotiator / AutoCred --
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_cred_recipes_name ON credential_recipes(connector_name);"
    )?;

    // -- Personas: source_review_id for template lineage tracking --------
    let has_source_review: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'source_review_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_source_review {
        conn.execute_batch(
            "ALTER TABLE personas ADD COLUMN source_review_id TEXT;"
        )?;
        tracing::info!("Added source_review_id to personas for template lineage tracking");
    }

    // -- Personas: trust_level and trust_origin columns ------------------
    let has_trust_level: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'trust_level'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_trust_level {
        conn.execute_batch(
            "ALTER TABLE personas ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'verified';
             ALTER TABLE personas ADD COLUMN trust_origin TEXT NOT NULL DEFAULT 'builtin';
             ALTER TABLE personas ADD COLUMN trust_verified_at TEXT;"
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
        conn.execute_batch(
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
            CREATE INDEX IF NOT EXISTS idx_saved_views_created ON saved_views(created_at DESC);"
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
        conn.execute_batch(
            "ALTER TABLE execution_traces ADD COLUMN evicted_span_count INTEGER NOT NULL DEFAULT 0;"
        )?;
        tracing::info!("Added evicted_span_count column to execution_traces");
    }

    // -- P2P Phase 2: Discovered Peers table (mDNS LAN discovery) ------
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_dp_last_seen ON discovered_peers(last_seen_at DESC);"
    )?;

    // -- P2P Phase 2: Peer Manifests table (synced exposure manifests) -
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_pm2_synced ON peer_manifests(synced_at DESC);"
    )?;

    // -- P2P Phase 3: trust_status column on discovered_peers -------------
    let has_trust_status: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('discovered_peers') WHERE name = 'trust_status'")?
        .query_row([], |r| r.get::<_, i32>(0))
        .unwrap_or(0)
        > 0;
    if !has_trust_status {
        conn.execute_batch(
            "ALTER TABLE discovered_peers ADD COLUMN trust_status TEXT NOT NULL DEFAULT 'unknown';"
        )?;
        tracing::info!("Added trust_status column to discovered_peers");
    }

    // -- Adoption audit log table -------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS adoption_log (
            id                TEXT PRIMARY KEY,
            template_name     TEXT NOT NULL,
            source_review_id  TEXT,
            persona_id        TEXT,
            adopted_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_adoption_log_template ON adoption_log(template_name);
        CREATE INDEX IF NOT EXISTS idx_adoption_log_adopted  ON adoption_log(adopted_at DESC);"
    )?;

    // Composite indexes for lab result queries:
    // Results tables: (run_id, scenario_name, model_id) for ORDER BY scenario_name, model_id
    // Runs tables: (persona_id, created_at DESC) for ORDER BY created_at DESC
    conn.execute_batch(
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
        .prepare("SELECT COUNT(*) FROM pragma_table_info('lab_arena_results') WHERE name = 'rationale'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_arena_rationale {
        conn.execute_batch(
            "ALTER TABLE lab_arena_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_arena_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_ab_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_ab_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_matrix_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_matrix_results ADD COLUMN suggestions TEXT;
             ALTER TABLE lab_eval_results ADD COLUMN rationale TEXT;
             ALTER TABLE lab_eval_results ADD COLUMN suggestions TEXT;"
        )?;
        tracing::info!("Added rationale and suggestions columns to all lab result tables");
    }

    // Add workflow import context columns to build_sessions (Phase 2: matrix import)
    let has_workflow_json: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('build_sessions') WHERE name = 'workflow_json'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_workflow_json {
        conn.execute_batch(
            "ALTER TABLE build_sessions ADD COLUMN workflow_json TEXT;
             ALTER TABLE build_sessions ADD COLUMN parser_result_json TEXT;"
        )?;
        tracing::info!("Added workflow_json and parser_result_json columns to build_sessions");
    }

    // -- Frontend crash telemetry table (persists React ErrorBoundary crashes to SQLite) --
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS frontend_crashes (
            id              TEXT PRIMARY KEY,
            component       TEXT NOT NULL,
            message         TEXT NOT NULL,
            stack           TEXT,
            component_stack TEXT,
            app_version     TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fc_created ON frontend_crashes(created_at DESC);"
    )?;

    // -- OAuth token lifetime metrics (tracks predicted vs actual token expiry) --
    conn.execute_batch(
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
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_ar_created    ON assertion_results(created_at DESC);"
    )?;

    // -- saved_views: view_type + view_config columns ------
    let has_view_type: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('saved_views') WHERE name = 'view_type'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_view_type {
        conn.execute_batch(
            "ALTER TABLE saved_views ADD COLUMN view_type TEXT NOT NULL DEFAULT 'analytics';
             ALTER TABLE saved_views ADD COLUMN view_config TEXT;"
        )?;
        tracing::info!("Added view_type, view_config columns to saved_views");
    }

    // Add llm_summary column to all lab run tables (LLM-generated prose summary)
    let has_llm_summary: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('lab_arena_runs') WHERE name = 'llm_summary'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_llm_summary {
        conn.execute_batch(
            "ALTER TABLE lab_arena_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_ab_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_matrix_runs ADD COLUMN llm_summary TEXT;
             ALTER TABLE lab_eval_runs ADD COLUMN llm_summary TEXT;"
        )?;
        tracing::info!("Added llm_summary column to all lab run tables");
    }

    // Add progress_json column to all lab run tables (persisted progress for hydration)
    let has_progress_json: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('lab_arena_runs') WHERE name = 'progress_json'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_progress_json {
        conn.execute_batch(
            "ALTER TABLE lab_arena_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_ab_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_matrix_runs ADD COLUMN progress_json TEXT;
             ALTER TABLE lab_eval_runs ADD COLUMN progress_json TEXT;"
        )?;
        tracing::info!("Added progress_json column to all lab run tables");
    }

    // -- Full persona versioning (M2) --------------------------------
    // Create persona_versions table (replaces prompt-only versioning)
    let has_persona_versions: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_versions'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_persona_versions {
        conn.execute_batch(
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
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
            CREATE INDEX idx_pvt_version ON persona_version_tools(version_id);"
        )?;
        tracing::info!("Created persona_versions and persona_version_tools tables");

        // Migrate existing persona_prompt_versions data
        let has_ppv: bool = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_prompt_versions'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if has_ppv {
            conn.execute_batch(
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
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_doc_sig_hash ON document_signatures(file_hash);"
    )?;

    // -- Dev Pipelines (Idea-to-Execution Pipeline) -------------------------
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_pipeline_idea ON dev_pipelines(idea_id);"
    )?;

    // -- Context Health Snapshots (Codebase Health Scanner) ------------------
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_health_snap_date ON context_health_snapshots(scanned_at);"
    )?;

    // -- Cross-Project Relations (Codebases connector) -----------------------
    conn.execute_batch(
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
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_ocr_created ON ocr_documents(created_at);"
    )?;

    // Add claude_session_id column to chat_session_context for --resume support
    let has_chat_ctx_claude_sid: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('chat_session_context') WHERE name = 'claude_session_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_chat_ctx_claude_sid {
        conn.execute_batch("ALTER TABLE chat_session_context ADD COLUMN claude_session_id TEXT;")?;
        tracing::info!("Added claude_session_id column to chat_session_context");
    }

    // Add idempotency_key column to persona_executions (dedup timeout-retries)
    let has_idempotency_key: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'idempotency_key'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_idempotency_key {
        conn.execute_batch(
            "ALTER TABLE persona_executions ADD COLUMN idempotency_key TEXT;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_idempotency ON persona_executions(idempotency_key) WHERE idempotency_key IS NOT NULL;"
        )?;
        tracing::info!("Added idempotency_key column to persona_executions");
    }

    // -- Index source_type on persona_events for filtered search ----------
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_pev_source_type ON persona_events(source_type);"
    )?;

    // Add free parameters column to personas (adjustable without rebuild)
    let has_parameters: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'parameters'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_parameters {
        conn.execute_batch("ALTER TABLE personas ADD COLUMN parameters TEXT;")?;
        tracing::info!("Added parameters column to personas");
    }

    // -- Add status TEXT column to persona_triggers ----------------------------
    // Replaces the lossy `enabled INTEGER` → TriggerStatus bridge with a column
    // that stores all four states (active, paused, errored, disabled).
    let has_trigger_status: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'status'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_status {
        conn.execute_batch(
            "ALTER TABLE persona_triggers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';"
        )?;
        // Backfill: enabled=1 → 'active', enabled=0 → 'disabled'
        conn.execute_batch(
            "UPDATE persona_triggers SET status = CASE WHEN enabled = 1 THEN 'active' ELSE 'disabled' END;"
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_ptr_status ON persona_triggers(status);"
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
        conn.execute_batch(
            "ALTER TABLE persona_memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'active';"
        )?;
        conn.execute_batch(
            "ALTER TABLE persona_memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;"
        )?;
        conn.execute_batch(
            "ALTER TABLE persona_memories ADD COLUMN last_accessed_at TEXT;"
        )?;
        // Composite index for the tiered injection query
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_pm_tier_injection
             ON persona_memories(persona_id, tier, importance DESC);"
        )?;
        // Backfill: promote high-importance memories (≥8) that already exist to core
        conn.execute_batch(
            "UPDATE persona_memories SET tier = 'core' WHERE importance >= 8;"
        )?;
        tracing::info!("Added tier, access_count, last_accessed_at columns to persona_memories");
    }

    // Add warnings column to automation_runs for surfacing auth fallbacks & method defaults.
    let _ = conn.execute_batch(
        "ALTER TABLE automation_runs ADD COLUMN warnings TEXT;"
    );

    // Migrate legacy string-matched interrupted sessions to first-class 'interrupted' status.
    let migrated = conn.execute(
        "UPDATE n8n_transform_sessions
         SET status = 'interrupted', error = NULL
         WHERE status = 'failed' AND error LIKE '%App closed during transform%'",
        [],
    ).unwrap_or(0);
    if migrated > 0 {
        tracing::info!("Migrated {migrated} interrupted n8n sessions from failed+string to interrupted status");
    }

    // Cloud webhook relay watermark table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_webhook_watermarks (
            trigger_id      TEXT PRIMARY KEY,
            last_seen_ts    TEXT NOT NULL,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );"
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
        conn.execute_batch(
            "CREATE TABLE chat_messages_new (
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
            CREATE INDEX IF NOT EXISTS idx_chat_created   ON chat_messages(created_at);"
        )?;
        tracing::info!("Widened chat_messages role CHECK to include system and tool");
    }

    // Circuit breaker persistence table (survive restarts, 15-min TTL)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS circuit_breaker_state (
            provider              TEXT PRIMARY KEY,
            consecutive_failures  INTEGER NOT NULL DEFAULT 0,
            is_open               INTEGER NOT NULL DEFAULT 0,
            opened_at             TEXT,
            updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );"
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
        conn.execute_batch(
            "ALTER TABLE persona_triggers ADD COLUMN trigger_version INTEGER NOT NULL DEFAULT 0;"
        )?;
        tracing::info!("Added trigger_version column to persona_triggers for CAS safety");
    }

    // -- Composite indexes for memory & chat hot-path queries --------------------
    // These are idempotent (IF NOT EXISTS) and cover the top query patterns that
    // degrade to full table scans as data grows.
    conn.execute_batch(
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
         ON chat_session_context(persona_id, updated_at DESC);"
    )?;
    tracing::info!("Ensured composite indexes for memory & chat hot-path queries");

    // -- Composite indexes for automation_runs hot-path queries -------------------
    // The single-column idx_automation_runs_automation cannot satisfy ORDER BY
    // started_at DESC without a filesort; a composite index eliminates that.
    // The (status, started_at) index lets reap_stale_runs avoid a full table scan.
    conn.execute_batch(
        // get_runs_by_automation: WHERE automation_id = ? ORDER BY started_at DESC
        "CREATE INDEX IF NOT EXISTS idx_automation_runs_auto_started
         ON automation_runs(automation_id, started_at DESC);

         -- reap_stale_runs: WHERE status = 'running' AND julianday(started_at) ...
         CREATE INDEX IF NOT EXISTS idx_automation_runs_status_started
         ON automation_runs(status, started_at);"
    )?;
    tracing::info!("Ensured composite indexes for automation_runs hot-path queries");

    // -- Composite indexes for team_memories and pipeline_runs hot-path queries ----
    // team_memories: get_by_team, get_for_injection, evict_excess all filter by
    // team_id and sort by importance DESC, created_at DESC/ASC. A composite index
    // lets SQLite satisfy the WHERE + ORDER BY without a filesort.
    // pipeline_runs: has_running_pipeline filters (team_id, status); list_pipeline_runs
    // filters team_id and sorts by started_at DESC.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tm_team_importance_created
         ON team_memories(team_id, importance DESC, created_at DESC);

         CREATE INDEX IF NOT EXISTS idx_pr_team_status
         ON pipeline_runs(team_id, status);

         CREATE INDEX IF NOT EXISTS idx_pr_team_started
         ON pipeline_runs(team_id, started_at DESC);"
    )?;
    tracing::info!("Ensured composite indexes for team_memories and pipeline_runs hot-path queries");

    // team_memories: get_all, get_total_count filter (team_id, run_id); evict_excess
    // filters (team_id, run_id IS NOT NULL). A composite index lets SQLite satisfy
    // these without scanning the full table and then post-filtering by run_id.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tm_team_run
         ON team_memories(team_id, run_id);"
    )?;
    tracing::info!("Ensured composite index idx_tm_team_run on team_memories");

    // Add composite index for trigger_id + created_at on persona_executions
    // Covers get_by_trigger_id query: WHERE trigger_id = ? ORDER BY created_at DESC
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_pe_trigger_created
         ON persona_executions(trigger_id, created_at DESC);"
    )?;
    tracing::info!("Ensured composite index idx_pe_trigger_created on persona_executions");

    Ok(())
}

/// Ensure the composite_trigger_fires table exists for persisting suppression state.
pub fn ensure_composite_fires_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS composite_trigger_fires (
            trigger_id  TEXT PRIMARY KEY,
            fired_at    TEXT NOT NULL
        );"
    )?;
    // -- Artist plugin tables -------------------------------------------------
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_artist_tags_tag ON artist_tags(tag);"
    )?;

    // ── Obsidian Brain: Sync State & Log ─────────────────────────────
    conn.execute_batch(
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

    // -- MCP gateway membership ------------------------------------------------
    // Bundles multiple MCP-speaking credentials under one "gateway" credential so
    // that attaching the gateway to a persona inherits every member's tools. Added
    // 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern (finding #1
    // from /research run on the same date, see .planning/handoffs/2026-04-08-
    // mcp-gateway-arcade.md for the full phase plan).
    conn.execute_batch(
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
        let _ = conn.execute_batch(stmt); // ignore duplicate column errors on re-run
    }

    // -- Lab: Consensus (stochastic multi-run agreement) ----------------------
    conn.execute_batch(
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
            tool_calls_expected  TEXT,
            tool_calls_actual    TEXT,
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
        CREATE INDEX IF NOT EXISTS idx_lab_consensus_results_run ON lab_consensus_results(run_id);"
    )?;

    // -- dev_tasks: depth column (quick / campaign / deep_build) ---------------
    conn.execute_batch(
        "ALTER TABLE dev_tasks ADD COLUMN depth TEXT NOT NULL DEFAULT 'quick';"
    ).ok(); // ok() — column may already exist

    // -- dev_projects: monitoring connector fields ----------------------------
    conn.execute_batch(
        "ALTER TABLE dev_projects ADD COLUMN monitoring_credential_id TEXT;"
    ).ok();
    conn.execute_batch(
        "ALTER TABLE dev_projects ADD COLUMN monitoring_project_slug TEXT;"
    ).ok();

    // ── Composition Workflows (persisted DAG definitions) ───────────────
    // Migrates workflows from frontend localStorage to backend SQLite.
    conn.execute_batch(
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
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_twin_profiles_active ON twin_profiles(is_active);"
    )?;

    // -- Twin plugin: per-channel tone profiles (P1) -------------------------
    // Each twin can speak differently on each channel. The `generic` row is
    // the default fallback. UNIQUE(twin_id, channel) enforces at most one
    // tone per (twin, channel) pair.
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_twin_tones_twin ON twin_tones(twin_id);"
    )?;

    // -- Twin plugin: knowledge_base_id on profiles (P2) ---------------------
    let _ = conn.execute_batch(
        "ALTER TABLE twin_profiles ADD COLUMN knowledge_base_id TEXT;"
    ); // ignore "duplicate column" on re-run

    // -- Twin plugin: pending memories inbox (P2) ----------------------------
    // Human-approval gate for memories. record_interaction writes here; the
    // user approves/rejects in the Knowledge tab. Approved memories get
    // ingested into the twin's knowledge base.
    conn.execute_batch(
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
    conn.execute_batch(
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
    conn.execute_batch(
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
        );"
    )?;

    // -- Twin plugin: channel bindings (P4) ----------------------------------
    // Maps a twin to its deployment channels. Each row = one channel where
    // the twin speaks, via a credential (e.g. Discord bot token) and
    // optionally a persona that operates there.
    conn.execute_batch(
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
        CREATE INDEX IF NOT EXISTS idx_twin_channels_twin ON twin_channels(twin_id);"
    )?;

    // -- eval_method column on all lab result tables ----------------------------
    // Tracks whether scores came from full LLM evaluation, heuristic fallback, or timeout.
    for table in &[
        "lab_arena_results",
        "lab_ab_results",
        "lab_matrix_results",
        "lab_eval_results",
    ] {
        let _ = conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN eval_method TEXT;"
        ));
    }

    // -- adoption_answers column on build_sessions --------------------------------
    // Stores questionnaire answers so they flow into test + promote pipelines.
    let has_adoption_answers: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('build_sessions') WHERE name = 'adoption_answers'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_adoption_answers {
        conn.execute_batch("ALTER TABLE build_sessions ADD COLUMN adoption_answers TEXT;")?;
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
        conn.execute_batch("ALTER TABLE persona_executions ADD COLUMN traceparent TEXT;")?;
        tracing::info!("Added traceparent column to persona_executions");
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

    Ok(())
}
