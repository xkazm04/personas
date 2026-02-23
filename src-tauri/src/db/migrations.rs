use rusqlite::Connection;

use crate::error::AppError;

/// Run the consolidated schema migration.
/// All 11 Vibeman migrations (090–112) are merged into a single idempotent schema.
pub fn run(conn: &Connection) -> Result<(), AppError> {
    tracing::debug!("Running database migrations");

    conn.execute_batch(SCHEMA)?;

    tracing::info!("Database migrations complete");
    Ok(())
}

const SCHEMA: &str = r#"

-- ============================================================================
-- Persona Groups (must precede personas due to FK)
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT DEFAULT '#6B7280',
    sort_order  INTEGER DEFAULT 0,
    collapsed   INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_groups_sort ON persona_groups(sort_order);

-- ============================================================================
-- Personas
-- ============================================================================

CREATE TABLE IF NOT EXISTS personas (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL DEFAULT 'default',
    name                    TEXT NOT NULL,
    description             TEXT,
    system_prompt           TEXT NOT NULL,
    structured_prompt       TEXT,
    icon                    TEXT,
    color                   TEXT,
    enabled                 INTEGER NOT NULL DEFAULT 1,
    max_concurrent          INTEGER NOT NULL DEFAULT 1,
    timeout_ms              INTEGER NOT NULL DEFAULT 300000,
    notification_channels   TEXT,
    last_design_result      TEXT,
    model_profile           TEXT,
    max_budget_usd          REAL,
    max_turns               INTEGER,
    design_context          TEXT,
    group_id                TEXT REFERENCES persona_groups(id) ON DELETE SET NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personas_enabled   ON personas(enabled);
CREATE INDEX IF NOT EXISTS idx_personas_group_id  ON personas(group_id);

-- ============================================================================
-- Tool Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_tool_definitions (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL UNIQUE,
    category                TEXT NOT NULL,
    description             TEXT NOT NULL,
    script_path             TEXT NOT NULL,
    input_schema            TEXT,
    output_schema           TEXT,
    requires_credential_type TEXT,
    implementation_guide    TEXT,
    is_builtin              INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptd_category ON persona_tool_definitions(category);

-- ============================================================================
-- Persona ↔ Tool Assignments
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_tools (
    id          TEXT PRIMARY KEY,
    persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES persona_tool_definitions(id) ON DELETE CASCADE,
    tool_config TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(persona_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_pt_persona ON persona_tools(persona_id);
CREATE INDEX IF NOT EXISTS idx_pt_tool    ON persona_tools(tool_id);

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_triggers (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    trigger_type      TEXT NOT NULL CHECK(trigger_type IN ('manual', 'schedule', 'polling', 'webhook', 'chain')),
    config            TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_triggered_at TEXT,
    next_trigger_at   TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptr_persona      ON persona_triggers(persona_id);
CREATE INDEX IF NOT EXISTS idx_ptr_next_trigger ON persona_triggers(next_trigger_at);
CREATE INDEX IF NOT EXISTS idx_ptr_enabled      ON persona_triggers(enabled);

-- ============================================================================
-- Executions
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_executions (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    trigger_id        TEXT REFERENCES persona_triggers(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    input_data        TEXT,
    output_data       TEXT,
    claude_session_id TEXT,
    log_file_path     TEXT,
    execution_flows   TEXT,
    model_used        TEXT,
    input_tokens      INTEGER DEFAULT 0,
    output_tokens     INTEGER DEFAULT 0,
    cost_usd          REAL DEFAULT 0,
    error_message     TEXT,
    duration_ms       INTEGER,
    started_at        TEXT,
    completed_at      TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pe_persona ON persona_executions(persona_id);
CREATE INDEX IF NOT EXISTS idx_pe_status  ON persona_executions(status);
CREATE INDEX IF NOT EXISTS idx_pe_created ON persona_executions(created_at DESC);

-- ============================================================================
-- Credentials
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_credentials (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    service_type    TEXT NOT NULL,
    encrypted_data  TEXT NOT NULL,
    iv              TEXT NOT NULL,
    metadata        TEXT,
    last_used_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_service ON persona_credentials(service_type);

-- ============================================================================
-- Credential Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_events (
    id                TEXT PRIMARY KEY,
    credential_id     TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    event_template_id TEXT NOT NULL,
    name              TEXT NOT NULL,
    config            TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_polled_at    TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ce_credential ON credential_events(credential_id);
CREATE INDEX IF NOT EXISTS idx_ce_enabled    ON credential_events(enabled);

-- ============================================================================
-- Manual Reviews
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_manual_reviews (
    id                TEXT PRIMARY KEY,
    execution_id      TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,
    severity          TEXT NOT NULL DEFAULT 'info',
    context_data      TEXT,
    suggested_actions TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    reviewer_notes    TEXT,
    resolved_at       TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pmr_persona ON persona_manual_reviews(persona_id);
CREATE INDEX IF NOT EXISTS idx_pmr_status  ON persona_manual_reviews(status);
CREATE INDEX IF NOT EXISTS idx_pmr_created ON persona_manual_reviews(created_at DESC);

-- ============================================================================
-- Messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_messages (
    id           TEXT PRIMARY KEY,
    persona_id   TEXT NOT NULL,
    execution_id TEXT,
    title        TEXT,
    content      TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    priority     TEXT NOT NULL DEFAULT 'normal',
    is_read      INTEGER NOT NULL DEFAULT 0,
    metadata     TEXT,
    created_at   TEXT NOT NULL,
    read_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pmsg_persona ON persona_messages(persona_id);
CREATE INDEX IF NOT EXISTS idx_pmsg_is_read ON persona_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_pmsg_created ON persona_messages(created_at DESC);

-- ============================================================================
-- Message Deliveries
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_message_deliveries (
    id            TEXT PRIMARY KEY,
    message_id    TEXT NOT NULL,
    channel_type  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    external_id   TEXT,
    delivered_at  TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pmd_message ON persona_message_deliveries(message_id);

-- ============================================================================
-- Tool Usage Analytics
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_tool_usage (
    id               TEXT PRIMARY KEY,
    execution_id     TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
    persona_id       TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    tool_name        TEXT NOT NULL,
    invocation_count INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptu_execution ON persona_tool_usage(execution_id);
CREATE INDEX IF NOT EXISTS idx_ptu_persona   ON persona_tool_usage(persona_id);
CREATE INDEX IF NOT EXISTS idx_ptu_tool      ON persona_tool_usage(tool_name);
CREATE INDEX IF NOT EXISTS idx_ptu_created   ON persona_tool_usage(created_at);

-- ============================================================================
-- Event Bus
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_events (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL DEFAULT 'default',
    event_type         TEXT NOT NULL,
    source_type        TEXT NOT NULL,
    source_id          TEXT,
    target_persona_id  TEXT,
    payload            TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    error_message      TEXT,
    processed_at       TEXT,
    created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pev_status  ON persona_events(status);
CREATE INDEX IF NOT EXISTS idx_pev_project ON persona_events(project_id);
CREATE INDEX IF NOT EXISTS idx_pev_type    ON persona_events(event_type);
CREATE INDEX IF NOT EXISTS idx_pev_target  ON persona_events(target_persona_id);
CREATE INDEX IF NOT EXISTS idx_pev_created ON persona_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pev_status_created ON persona_events(status, created_at);

-- ============================================================================
-- Event Subscriptions
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_event_subscriptions (
    id            TEXT PRIMARY KEY,
    persona_id    TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    source_filter TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pes_persona    ON persona_event_subscriptions(persona_id);
CREATE INDEX IF NOT EXISTS idx_pes_event_type ON persona_event_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS idx_pes_enabled    ON persona_event_subscriptions(enabled);

-- ============================================================================
-- Design Reviews
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_design_reviews (
    id                      TEXT PRIMARY KEY,
    test_case_id            TEXT NOT NULL,
    test_case_name          TEXT NOT NULL,
    instruction             TEXT NOT NULL,
    status                  TEXT NOT NULL,
    structural_score        INTEGER,
    semantic_score          INTEGER,
    connectors_used         TEXT,
    trigger_types           TEXT,
    design_result           TEXT,
    structural_evaluation   TEXT,
    semantic_evaluation     TEXT,
    test_run_id             TEXT NOT NULL,
    had_references          INTEGER DEFAULT 0,
    suggested_adjustment    TEXT,
    adjustment_generation   INTEGER DEFAULT 0,
    use_case_flows          TEXT,
    reviewed_at             TEXT NOT NULL,
    created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdr_test_case ON persona_design_reviews(test_case_id);
CREATE INDEX IF NOT EXISTS idx_pdr_status    ON persona_design_reviews(status);
CREATE INDEX IF NOT EXISTS idx_pdr_reviewed  ON persona_design_reviews(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_pdr_run       ON persona_design_reviews(test_run_id);

-- ============================================================================
-- Design Patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_design_patterns (
    id                 TEXT PRIMARY KEY,
    pattern_type       TEXT NOT NULL,
    pattern_text       TEXT NOT NULL,
    trigger_condition  TEXT NOT NULL,
    confidence         INTEGER NOT NULL DEFAULT 0,
    source_review_ids  TEXT NOT NULL DEFAULT '[]',
    usage_count        INTEGER NOT NULL DEFAULT 0,
    last_validated_at  TEXT,
    is_active          INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_patterns_active    ON persona_design_patterns(is_active);
CREATE INDEX IF NOT EXISTS idx_design_patterns_type      ON persona_design_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_design_patterns_condition ON persona_design_patterns(trigger_condition);

-- ============================================================================
-- Metrics Snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_metrics_snapshots (
    id                      TEXT PRIMARY KEY,
    persona_id              TEXT NOT NULL,
    snapshot_date           TEXT NOT NULL,
    total_executions        INTEGER NOT NULL DEFAULT 0,
    successful_executions   INTEGER NOT NULL DEFAULT 0,
    failed_executions       INTEGER NOT NULL DEFAULT 0,
    total_cost_usd          REAL NOT NULL DEFAULT 0,
    total_input_tokens      INTEGER NOT NULL DEFAULT 0,
    total_output_tokens     INTEGER NOT NULL DEFAULT 0,
    avg_duration_ms         REAL NOT NULL DEFAULT 0,
    tools_used              TEXT,
    events_emitted          INTEGER NOT NULL DEFAULT 0,
    events_consumed         INTEGER NOT NULL DEFAULT 0,
    messages_sent           INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pms_persona ON persona_metrics_snapshots(persona_id);
CREATE INDEX IF NOT EXISTS idx_pms_date    ON persona_metrics_snapshots(snapshot_date);

-- ============================================================================
-- Prompt Versions
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_prompt_versions (
    id                TEXT PRIMARY KEY,
    persona_id        TEXT NOT NULL,
    version_number    INTEGER NOT NULL,
    structured_prompt TEXT,
    system_prompt     TEXT,
    change_summary    TEXT,
    tag               TEXT NOT NULL DEFAULT 'experimental',
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ppv_persona ON persona_prompt_versions(persona_id);
CREATE INDEX IF NOT EXISTS idx_ppv_version ON persona_prompt_versions(persona_id, version_number DESC);

-- ============================================================================
-- Teams
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_teams (
    id          TEXT PRIMARY KEY,
    project_id  TEXT,
    name        TEXT NOT NULL,
    description TEXT,
    canvas_data TEXT,
    team_config TEXT,
    icon        TEXT,
    color       TEXT NOT NULL DEFAULT '#6B7280',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_team_members (
    id          TEXT PRIMARY KEY,
    team_id     TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
    persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'worker'
                CHECK(role IN ('orchestrator', 'worker', 'reviewer', 'router')),
    position_x  REAL NOT NULL DEFAULT 0,
    position_y  REAL NOT NULL DEFAULT 0,
    config      TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptm_team    ON persona_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_ptm_persona ON persona_team_members(persona_id);

CREATE TABLE IF NOT EXISTS persona_team_connections (
    id               TEXT PRIMARY KEY,
    team_id          TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
    source_member_id TEXT NOT NULL REFERENCES persona_team_members(id) ON DELETE CASCADE,
    target_member_id TEXT NOT NULL REFERENCES persona_team_members(id) ON DELETE CASCADE,
    connection_type  TEXT NOT NULL DEFAULT 'sequential'
                     CHECK(connection_type IN ('sequential', 'conditional', 'parallel', 'feedback')),
    condition        TEXT,
    label            TEXT,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptc_team ON persona_team_connections(team_id);

-- ============================================================================
-- Connector Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS connector_definitions (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    label              TEXT NOT NULL,
    icon_url           TEXT,
    color              TEXT NOT NULL DEFAULT '#6B7280',
    category           TEXT NOT NULL DEFAULT 'general',
    fields             TEXT NOT NULL DEFAULT '[]',
    healthcheck_config TEXT,
    services           TEXT NOT NULL DEFAULT '[]',
    events             TEXT NOT NULL DEFAULT '[]',
    metadata           TEXT,
    is_builtin         INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cd_category ON connector_definitions(category);

-- ============================================================================
-- Persona Memories
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_memories (
    id                  TEXT PRIMARY KEY,
    persona_id          TEXT NOT NULL,
    title               TEXT NOT NULL,
    content             TEXT NOT NULL,
    category            TEXT DEFAULT 'fact',
    source_execution_id TEXT,
    importance          INTEGER DEFAULT 3,
    tags                TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_memories_persona    ON persona_memories(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_memories_category   ON persona_memories(category);
CREATE INDEX IF NOT EXISTS idx_persona_memories_importance ON persona_memories(importance DESC);

-- ============================================================================
-- Healing Issues
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_healing_issues (
    id          TEXT PRIMARY KEY,
    persona_id  TEXT NOT NULL,
    execution_id TEXT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'low',
    category    TEXT NOT NULL DEFAULT 'config',
    suggested_fix TEXT,
    auto_fixed  INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_phi_persona ON persona_healing_issues(persona_id);
CREATE INDEX IF NOT EXISTS idx_phi_status  ON persona_healing_issues(status);

-- ============================================================================
-- Budget Alert Rules (Phase: Production Polish)
-- ============================================================================

CREATE TABLE IF NOT EXISTS budget_alert_rules (
    id             TEXT PRIMARY KEY,
    persona_id     TEXT REFERENCES personas(id) ON DELETE CASCADE,
    rule_type      TEXT NOT NULL DEFAULT 'per_execution',
    threshold_usd  REAL NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bar_persona ON budget_alert_rules(persona_id);

-- ============================================================================
-- Pipeline Runs (Phase: Production Polish)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              TEXT PRIMARY KEY,
    team_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    node_statuses   TEXT NOT NULL DEFAULT '[]',
    input_data      TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pr_team   ON pipeline_runs(team_id);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pipeline_runs(status);

-- ============================================================================
-- Application Settings (key-value store for global config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Test Runs (Multi-LLM Sandbox Testing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_test_runs (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'generating',
    models_tested   TEXT NOT NULL DEFAULT '[]',
    scenarios_count INTEGER NOT NULL DEFAULT 0,
    summary         TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL,
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_test_runs_persona ON persona_test_runs(persona_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_created ON persona_test_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS persona_test_results (
    id                    TEXT PRIMARY KEY,
    test_run_id           TEXT NOT NULL REFERENCES persona_test_runs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_test_results_run ON persona_test_results(test_run_id);

-- ============================================================================
-- N8n Transform Sessions (persisted import wizard state)
-- ============================================================================

CREATE TABLE IF NOT EXISTS n8n_transform_sessions (
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
CREATE INDEX IF NOT EXISTS idx_nts_status  ON n8n_transform_sessions(status);
CREATE INDEX IF NOT EXISTS idx_nts_created ON n8n_transform_sessions(created_at DESC);

-- ============================================================================
-- Credential Audit Log (append-only, never updated or deleted)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_audit_log (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL,
    credential_name TEXT NOT NULL,
    operation       TEXT NOT NULL,
    persona_id      TEXT,
    persona_name    TEXT,
    detail          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cal_credential ON credential_audit_log(credential_id);
CREATE INDEX IF NOT EXISTS idx_cal_persona    ON credential_audit_log(persona_id);
CREATE INDEX IF NOT EXISTS idx_cal_operation  ON credential_audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_cal_created    ON credential_audit_log(created_at DESC);

-- ============================================================================
-- Credential Rotation Policies
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_rotation_policies (
    id                TEXT PRIMARY KEY,
    credential_id     TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    enabled           INTEGER NOT NULL DEFAULT 1,
    rotation_interval_days INTEGER NOT NULL DEFAULT 90,
    policy_type       TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK(policy_type IN ('scheduled','on_suspicious','on_member_departure','manual')),
    last_rotated_at   TEXT,
    next_rotation_at  TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(credential_id, policy_type)
);
CREATE INDEX IF NOT EXISTS idx_crp_credential ON credential_rotation_policies(credential_id);
CREATE INDEX IF NOT EXISTS idx_crp_next       ON credential_rotation_policies(next_rotation_at);
CREATE INDEX IF NOT EXISTS idx_crp_enabled    ON credential_rotation_policies(enabled);

-- ============================================================================
-- Credential Rotation History (append-only timeline)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_rotation_history (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    rotation_type   TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK(rotation_type IN ('scheduled','manual','token_refresh','suspicious','anomaly')),
    status          TEXT NOT NULL DEFAULT 'success'
                    CHECK(status IN ('success','failed','skipped')),
    detail          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crh_credential ON credential_rotation_history(credential_id);
CREATE INDEX IF NOT EXISTS idx_crh_created    ON credential_rotation_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crh_status     ON credential_rotation_history(status);

-- ============================================================================
-- Healing Knowledge Base (fleet-wide failure pattern learning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS healing_knowledge (
    id                      TEXT PRIMARY KEY,
    service_type            TEXT NOT NULL,
    pattern_key             TEXT NOT NULL,
    description             TEXT NOT NULL,
    recommended_delay_secs  INTEGER,
    occurrence_count        INTEGER NOT NULL DEFAULT 1,
    last_seen_at            TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(service_type, pattern_key)
);
CREATE INDEX IF NOT EXISTS idx_hk_service ON healing_knowledge(service_type);
CREATE INDEX IF NOT EXISTS idx_hk_pattern ON healing_knowledge(pattern_key);

"#;

/// Incremental migrations for columns added after the initial schema.
/// Uses "ADD COLUMN ... IF NOT EXISTS" equivalent via PRAGMA table_info check.
pub fn run_incremental(conn: &Connection) -> Result<(), AppError> {
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
            CREATE INDEX IF NOT EXISTS idx_nts_created ON n8n_transform_sessions(created_at DESC);"
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
    // Detect by reading the stored CREATE TABLE SQL from sqlite_master —
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
                trigger_type      TEXT NOT NULL CHECK(trigger_type IN ('manual', 'schedule', 'polling', 'webhook', 'chain')),
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

    Ok(())
}
