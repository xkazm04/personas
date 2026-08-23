//! P2P discovery and manifests, adoption auditing, lab result rationale and
//! progress columns, full persona versioning, and the plugin-era tables
//! (doc signatures, dev pipelines, context health, OCR) plus the tiered
//! memory lifecycle columns.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
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
        ddl_step(
            conn,
            "ALTER TABLE chat_session_context ADD COLUMN claude_session_id TEXT;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE persona_memories ADD COLUMN last_accessed_at TEXT;",
        )?;
        // Composite index for the tiered injection query
        ddl_step(
            conn,
            "CREATE INDEX IF NOT EXISTS idx_pm_tier_injection
             ON persona_memories(persona_id, tier, importance DESC);",
        )?;
        // Backfill: promote high-importance memories (≥8) that already exist to core
        ddl_step(
            conn,
            "UPDATE persona_memories SET tier = 'core' WHERE importance >= 8;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE automation_runs ADD COLUMN warnings TEXT;",
        )?;
    }

    // Migrate legacy string-matched interrupted sessions to first-class 'interrupted' status.

    Ok(())
}
