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
    trigger_type      TEXT NOT NULL CHECK(trigger_type IN ('manual', 'schedule', 'polling', 'webhook', 'chain', 'event_listener')),
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
-- Credential Fields (field-level storage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_fields (
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
CREATE INDEX IF NOT EXISTS idx_cf_key        ON credential_fields(field_key);

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
    payload_iv         TEXT,
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

-- ============================================================================
-- Lab: Arena Runs & Results (Multi-model comparison)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lab_arena_runs (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'generating',
    models_tested   TEXT NOT NULL DEFAULT '[]',
    scenarios_count INTEGER NOT NULL DEFAULT 0,
    use_case_filter TEXT,
    summary         TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL,
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_arena_runs_persona ON lab_arena_runs(persona_id);
CREATE INDEX IF NOT EXISTS idx_lab_arena_runs_created ON lab_arena_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS lab_arena_results (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES lab_arena_runs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_lab_arena_results_run ON lab_arena_results(run_id);

-- ============================================================================
-- Lab: A/B Runs & Results (Prompt version comparison)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lab_ab_runs (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'generating',
    version_a_id    TEXT NOT NULL,
    version_b_id    TEXT NOT NULL,
    version_a_num   INTEGER NOT NULL,
    version_b_num   INTEGER NOT NULL,
    models_tested   TEXT NOT NULL DEFAULT '[]',
    scenarios_count INTEGER NOT NULL DEFAULT 0,
    use_case_filter TEXT,
    test_input      TEXT,
    summary         TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL,
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_ab_runs_persona ON lab_ab_runs(persona_id);
CREATE INDEX IF NOT EXISTS idx_lab_ab_runs_created ON lab_ab_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS lab_ab_results (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES lab_ab_runs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_lab_ab_results_run ON lab_ab_results(run_id);

-- ============================================================================
-- Lab: Matrix Runs & Results (Draft generation + comparison)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lab_matrix_runs (
    id                   TEXT PRIMARY KEY,
    persona_id           TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'drafting',
    user_instruction     TEXT NOT NULL,
    draft_prompt_json    TEXT,
    draft_change_summary TEXT,
    models_tested        TEXT NOT NULL DEFAULT '[]',
    scenarios_count      INTEGER NOT NULL DEFAULT 0,
    use_case_filter      TEXT,
    summary              TEXT,
    error                TEXT,
    draft_accepted       INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    completed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_matrix_runs_persona ON lab_matrix_runs(persona_id);
CREATE INDEX IF NOT EXISTS idx_lab_matrix_runs_created ON lab_matrix_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS lab_matrix_results (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES lab_matrix_runs(id) ON DELETE CASCADE,
    variant               TEXT NOT NULL CHECK(variant IN ('current', 'draft')),
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
CREATE INDEX IF NOT EXISTS idx_lab_matrix_results_run ON lab_matrix_results(run_id);

-- ============================================================================
-- Import Transactions (atomic persona import audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS import_transactions (
    id              TEXT PRIMARY KEY,
    session_id      TEXT,
    persona_id      TEXT,
    status          TEXT NOT NULL DEFAULT 'staged'
                    CHECK(status IN ('staged','committed','rolled_back')),
    entity_results  TEXT,
    error_summary   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_import_tx_session ON import_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_import_tx_status  ON import_transactions(status);
CREATE INDEX IF NOT EXISTS idx_import_tx_created ON import_transactions(created_at DESC);

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

    // Migrate existing persona_test_runs → lab_arena_runs (one-time copy)
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
    migrate_blob_credentials_to_fields(conn)?;

    // ── Unified Reactions: add event_listener trigger type ───────────────
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

    // Copy existing persona_event_subscriptions → event_listener triggers (idempotent).
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

    // ── Credential Audit Log (append-only compliance trail) ─────────────
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

    // ── Encrypted event payloads: add payload_iv column ─────────────────
    let has_payload_iv: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_events') WHERE name = 'payload_iv'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_payload_iv {
        conn.execute_batch("ALTER TABLE persona_events ADD COLUMN payload_iv TEXT;")?;
        tracing::info!("Added payload_iv column to persona_events for encrypted event payloads");
    }

    // ── Execution Knowledge Graph (cross-run learning) ───────────────
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

    Ok(())
}

/// Split existing monolithic encrypted_data blobs into per-field rows.
/// Only processes credentials that don't already have field rows (idempotent).
/// Runs inside the caller's connection — the incremental migration context
/// means this is already within a serialized startup sequence.
fn migrate_blob_credentials_to_fields(conn: &Connection) -> Result<(), AppError> {
    use crate::engine::crypto;
    use std::collections::HashMap;

    // Find credentials that have no field rows yet
    let mut stmt = conn.prepare(
        "SELECT c.id, c.encrypted_data, c.iv FROM persona_credentials c
         WHERE NOT EXISTS (SELECT 1 FROM credential_fields cf WHERE cf.credential_id = c.id)"
    )?;

    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut insert_stmt = conn.prepare(
        "INSERT OR IGNORE INTO credential_fields
         (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)"
    )?;

    let mut total_fields = 0usize;

    // Classify which field keys are typically non-sensitive (queryable)
    const NON_SENSITIVE_KEYS: &[&str] = &[
        "base_url", "url", "host", "hostname", "server",
        "port", "database", "project", "organization", "org",
        "workspace", "team", "region", "scope", "scopes",
        "oauth_client_mode", "token_type",
    ];

    for (cred_id, encrypted_data, iv) in &rows {
        // Decrypt the blob to get the JSON fields
        let plaintext = if crypto::is_plaintext(iv) {
            encrypted_data.clone()
        } else {
            match crypto::decrypt_from_db(encrypted_data, iv) {
                Ok(pt) => pt,
                Err(e) => {
                    tracing::warn!(
                        "Skipping field migration for credential {}: decrypt failed: {}",
                        cred_id, e
                    );
                    continue;
                }
            }
        };

        let fields: HashMap<String, String> = match serde_json::from_str(&plaintext) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(
                    "Skipping field migration for credential {}: invalid JSON: {}",
                    cred_id, e
                );
                continue;
            }
        };

        for (key, value) in &fields {
            let field_id = uuid::Uuid::new_v4().to_string();
            let is_sensitive = !NON_SENSITIVE_KEYS.contains(&key.to_lowercase().as_str());

            let (enc_val, field_iv) = if is_sensitive && !value.is_empty() {
                match crypto::encrypt_for_db(value) {
                    Ok((ct, nonce)) => (ct, nonce),
                    Err(e) => {
                        tracing::warn!(
                            "Failed to encrypt field '{}' for credential {}: {}",
                            key, cred_id, e
                        );
                        continue;
                    }
                }
            } else {
                // Non-sensitive: store as plaintext for queryability
                (value.clone(), String::new())
            };

            let field_type = classify_field_type(key);

            insert_stmt.execute(rusqlite::params![
                field_id,
                cred_id,
                key,
                enc_val,
                field_iv,
                field_type,
                is_sensitive as i32,
                now,
            ])?;
            total_fields += 1;
        }
    }

    if total_fields > 0 {
        tracing::info!(
            "Migrated {} credentials ({} total fields) from blob to field-level storage",
            rows.len(),
            total_fields
        );
    }

    Ok(())
}

/// Classify a credential field key into a type hint.
fn classify_field_type(key: &str) -> &'static str {
    let lower = key.to_lowercase();
    if lower.contains("url") || lower.contains("endpoint") || lower == "host" || lower == "server" {
        "url"
    } else if lower.contains("token") || lower.contains("key") || lower.contains("secret") || lower.contains("password") {
        "secret"
    } else if lower == "port" {
        "number"
    } else if lower.contains("email") || lower.contains("username") || lower.contains("user") {
        "identity"
    } else {
        "text"
    }
}
