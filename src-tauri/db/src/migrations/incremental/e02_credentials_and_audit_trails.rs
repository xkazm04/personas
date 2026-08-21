//! Credential field migration and the append-only audit trails: credential,
//! settings, persona-change and tool-execution logs, encrypted event payloads,
//! Playwright procedures, the execution knowledge graph, recipe columns and
//! versions, the provider audit log, and template/trust/saved-view additions.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    crate::migrations::helpers::migrate_blob_credentials_to_fields(conn)?;

    // After splitting fields, drop the legacy `encrypted_data` / `iv` blobs on
    // any row that has been migrated. Field rows are the authoritative source
    // of truth; the blob columns must be empty to avoid the dual-source-of-
    // truth bug documented on `PersonaCredential`. Then loudly log any
    // violation that survives.
    crate::migrations::helpers::clear_legacy_credential_blobs(conn)?;
    crate::migrations::helpers::assert_credential_blob_invariant(conn)?;

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
        ddl_step(
            conn,
            "ALTER TABLE persona_events ADD COLUMN payload_iv TEXT;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE recipe_definitions ADD COLUMN credential_id TEXT;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE recipe_definitions ADD COLUMN use_case_id TEXT;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN headless INTEGER NOT NULL DEFAULT 0;",
        )?;
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
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN source_review_id TEXT;",
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

    Ok(())
}
