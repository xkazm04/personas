pub(super) const SCHEMA: &str = r#"

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
    sensitive               INTEGER NOT NULL DEFAULT 0,
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
-- Persona <-> Tool Assignments
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
-- Review Messages (conversational thread per review)
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_messages (
    id          TEXT PRIMARY KEY,
    review_id   TEXT NOT NULL REFERENCES persona_manual_reviews(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'user',
    content     TEXT NOT NULL,
    metadata    TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rm_review ON review_messages(review_id);
CREATE INDEX IF NOT EXISTS idx_rm_created ON review_messages(review_id, created_at ASC);

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
    read_at      TEXT,
    thread_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pmsg_persona ON persona_messages(persona_id);
CREATE INDEX IF NOT EXISTS idx_pmsg_is_read ON persona_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_pmsg_created ON persona_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pmsg_thread ON persona_messages(thread_id);

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
    id              TEXT PRIMARY KEY,
    project_id      TEXT,
    parent_team_id  TEXT REFERENCES persona_teams(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    canvas_data     TEXT,
    team_config     TEXT,
    icon            TEXT,
    color           TEXT NOT NULL DEFAULT '#6B7280',
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_pm_persona_importance_created ON persona_memories(persona_id, importance DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_persona_category         ON persona_memories(persona_id, category);

-- ============================================================================
-- Healing Issues
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_healing_issues (
    id          TEXT PRIMARY KEY,
    persona_id  TEXT NOT NULL,
    execution_id TEXT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    is_circuit_breaker INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_phi_persona_execution
    ON persona_healing_issues(persona_id, execution_id)
    WHERE execution_id IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS idx_nts_status_updated ON n8n_transform_sessions(status, updated_at DESC);

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
-- Tool Execution Audit Log (append-only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tool_execution_audit_log (
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
CREATE INDEX IF NOT EXISTS idx_teal_tool      ON tool_execution_audit_log(tool_id);
CREATE INDEX IF NOT EXISTS idx_teal_persona   ON tool_execution_audit_log(persona_id);
CREATE INDEX IF NOT EXISTS idx_teal_status    ON tool_execution_audit_log(result_status);
CREATE INDEX IF NOT EXISTS idx_teal_created   ON tool_execution_audit_log(created_at DESC);

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

-- ============================================================================
-- Team Memories (cross-persona shared context for pipelines)
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_memories (
    id          TEXT PRIMARY KEY,
    team_id     TEXT NOT NULL,
    run_id      TEXT,
    member_id   TEXT,
    persona_id  TEXT,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'observation',
    importance  INTEGER NOT NULL DEFAULT 3,
    tags        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tm_team       ON team_memories(team_id);
CREATE INDEX IF NOT EXISTS idx_tm_run        ON team_memories(run_id);
CREATE INDEX IF NOT EXISTS idx_tm_category   ON team_memories(category);
CREATE INDEX IF NOT EXISTS idx_tm_importance ON team_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_tm_team_cat   ON team_memories(team_id, category);

-- ============================================================================
-- Playwright Procedures (saved browser automation scripts per connector)
-- ============================================================================

CREATE TABLE IF NOT EXISTS playwright_procedures (
    id              TEXT PRIMARY KEY,
    connector_name  TEXT NOT NULL,
    procedure_json  TEXT NOT NULL,
    field_keys      TEXT NOT NULL DEFAULT '[]',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_connector ON playwright_procedures(connector_name);
CREATE INDEX IF NOT EXISTS idx_pp_active    ON playwright_procedures(connector_name, is_active);

-- ============================================================================
-- Database Schema Tables (user-defined focus tables per credential)
-- ============================================================================

CREATE TABLE IF NOT EXISTS db_schema_tables (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    table_name      TEXT NOT NULL,
    display_label   TEXT,
    column_hints    TEXT,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(credential_id, table_name)
);
CREATE INDEX IF NOT EXISTS idx_dst_credential ON db_schema_tables(credential_id);
CREATE INDEX IF NOT EXISTS idx_dst_favorite   ON db_schema_tables(credential_id, is_favorite);

-- ============================================================================
-- Database Saved Queries (favorite queries per credential)
-- ============================================================================

CREATE TABLE IF NOT EXISTS db_saved_queries (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    query_text      TEXT NOT NULL,
    language        TEXT NOT NULL DEFAULT 'sql',
    last_run_at     TEXT,
    last_run_ok     INTEGER,
    last_run_ms     INTEGER,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dsq_credential ON db_saved_queries(credential_id);
CREATE INDEX IF NOT EXISTS idx_dsq_favorite   ON db_saved_queries(credential_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_dsq_language   ON db_saved_queries(language);

-- ============================================================================
-- Recipe Definitions (reusable LLM workflow templates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS recipe_definitions (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL DEFAULT 'default',
    credential_id           TEXT,
    name                    TEXT NOT NULL,
    description             TEXT,
    category                TEXT,
    prompt_template         TEXT NOT NULL DEFAULT '',
    input_schema            TEXT,
    output_contract         TEXT,
    tool_requirements       TEXT,
    credential_requirements TEXT,
    model_preference        TEXT,
    sample_inputs           TEXT,
    tags                    TEXT,
    icon                    TEXT,
    color                   TEXT,
    is_builtin              INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipe_def_project    ON recipe_definitions(project_id);
CREATE INDEX IF NOT EXISTS idx_recipe_def_category   ON recipe_definitions(category);

-- ============================================================================
-- Persona <-> Recipe Links (junction table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_recipe_links (
    id          TEXT PRIMARY KEY,
    persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    recipe_id   TEXT NOT NULL REFERENCES recipe_definitions(id) ON DELETE CASCADE,
    sort_order  INTEGER DEFAULT 0,
    config      TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(persona_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_prl_persona ON persona_recipe_links(persona_id);
CREATE INDEX IF NOT EXISTS idx_prl_recipe  ON persona_recipe_links(recipe_id);

-- ============================================================================
-- Persona Automations (external workflow references)
-- ============================================================================

CREATE TABLE IF NOT EXISTS persona_automations (
    id                      TEXT PRIMARY KEY,
    persona_id              TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    use_case_id             TEXT,
    name                    TEXT NOT NULL,
    description             TEXT DEFAULT '',
    platform                TEXT NOT NULL,
    platform_workflow_id    TEXT,
    platform_url            TEXT,
    webhook_url             TEXT,
    webhook_method          TEXT DEFAULT 'POST',
    platform_credential_id  TEXT REFERENCES persona_credentials(id) ON DELETE SET NULL,
    credential_mapping      TEXT,
    input_schema            TEXT,
    output_schema           TEXT,
    timeout_ms              INTEGER DEFAULT 30000,
    retry_count             INTEGER DEFAULT 1,
    fallback_mode           TEXT DEFAULT 'connector',
    deployment_status       TEXT DEFAULT 'draft',
    last_triggered_at       TEXT,
    last_result_status      TEXT,
    error_message           TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automations_persona ON persona_automations(persona_id);

-- ============================================================================
-- Automation Runs (invocation history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_runs (
    id                  TEXT PRIMARY KEY,
    automation_id       TEXT NOT NULL REFERENCES persona_automations(id) ON DELETE CASCADE,
    execution_id        TEXT REFERENCES persona_executions(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    input_data          TEXT,
    output_data         TEXT,
    platform_run_id     TEXT,
    platform_logs_url   TEXT,
    duration_ms         INTEGER,
    error_message       TEXT,
    started_at          TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_execution  ON automation_runs(execution_id);

-- ============================================================================
-- Dev Tools: Projects
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL UNIQUE,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  tech_stack    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Dev Tools: Goals
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_goals (
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
CREATE INDEX IF NOT EXISTS idx_dev_goals_project ON dev_goals(project_id);
CREATE INDEX IF NOT EXISTS idx_dev_goals_status ON dev_goals(status);
CREATE INDEX IF NOT EXISTS idx_dev_goals_parent ON dev_goals(parent_goal_id);

-- ============================================================================
-- Dev Tools: Goal Dependencies (cross-goal blocking relationships)
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_goal_dependencies (
  id             TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL REFERENCES dev_goals(id) ON DELETE CASCADE,
  depends_on_id  TEXT NOT NULL REFERENCES dev_goals(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'blocks',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_goal_deps_goal ON dev_goal_dependencies(goal_id);
CREATE INDEX IF NOT EXISTS idx_dev_goal_deps_dep ON dev_goal_dependencies(depends_on_id);

-- ============================================================================
-- Dev Tools: Goal Signals
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_goal_signals (
  id            TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL REFERENCES dev_goals(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL,
  source_id     TEXT,
  delta         INTEGER,
  message       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_goal_signals_goal ON dev_goal_signals(goal_id);

-- ============================================================================
-- Dev Tools: Context Groups
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_context_groups (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#6366f1',
  icon          TEXT,
  group_type    TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  health_score  INTEGER,
  last_scan_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_context_groups_project ON dev_context_groups(project_id);

-- ============================================================================
-- Dev Tools: Contexts
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_contexts (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  group_id          TEXT REFERENCES dev_context_groups(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  file_paths        TEXT NOT NULL DEFAULT '[]',
  entry_points      TEXT,
  db_tables         TEXT,
  keywords          TEXT,
  api_surface       TEXT,
  cross_refs        TEXT,
  tech_stack        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_contexts_project ON dev_contexts(project_id);
CREATE INDEX IF NOT EXISTS idx_dev_contexts_group ON dev_contexts(group_id);

-- ============================================================================
-- Dev Tools: Context Group Relationships
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_context_group_relationships (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  source_group_id TEXT NOT NULL REFERENCES dev_context_groups(id) ON DELETE CASCADE,
  target_group_id TEXT NOT NULL REFERENCES dev_context_groups(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Dev Tools: Ideas
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_ideas (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES dev_projects(id) ON DELETE CASCADE,
  context_id    TEXT,
  scan_type     TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'functionality',
  title         TEXT NOT NULL,
  description   TEXT,
  reasoning     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  effort        INTEGER,
  impact        INTEGER,
  risk          INTEGER,
  provider      TEXT,
  model         TEXT,
  rejection_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_ideas_status ON dev_ideas(status);
CREATE INDEX IF NOT EXISTS idx_dev_ideas_project ON dev_ideas(project_id);

-- ============================================================================
-- Dev Tools: Scans
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_scans (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES dev_projects(id) ON DELETE CASCADE,
  scan_type     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  idea_count    INTEGER DEFAULT 0,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  duration_ms   INTEGER,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Dev Tools: Tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES dev_projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  source_idea_id  TEXT REFERENCES dev_ideas(id) ON DELETE SET NULL,
  goal_id         TEXT REFERENCES dev_goals(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  session_id      TEXT,
  progress_pct    INTEGER DEFAULT 0,
  output_lines    INTEGER DEFAULT 0,
  error           TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_status ON dev_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_project ON dev_tasks(project_id);

-- ============================================================================
-- Dev Tools: Competitions (multi-clone parallel task execution)
--
-- A competition spawns N dev_tasks on the same underlying work item, each
-- tagged with a distinct worktree_name (via session_id) so Claude Code runs
-- them in isolated git worktrees. The human reviews candidates and picks a
-- winner; losers are dismissed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_competitions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  task_title          TEXT NOT NULL,
  task_description    TEXT,
  source_idea_id      TEXT,
  source_goal_id      TEXT,
  slot_count          INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running',
  winner_task_id      TEXT,
  winner_insight      TEXT,
  baseline_json       TEXT,
  reviewer_notes      TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_dev_competitions_project ON dev_competitions(project_id);
CREATE INDEX IF NOT EXISTS idx_dev_competitions_status ON dev_competitions(status);

CREATE TABLE IF NOT EXISTS dev_competition_slots (
  id                  TEXT PRIMARY KEY,
  competition_id      TEXT NOT NULL REFERENCES dev_competitions(id) ON DELETE CASCADE,
  task_id             TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE,
  strategy_label      TEXT NOT NULL,
  strategy_prompt     TEXT,
  worktree_name       TEXT NOT NULL,
  branch_name         TEXT,
  slot_index          INTEGER NOT NULL,
  disqualified        INTEGER NOT NULL DEFAULT 0,
  disqualify_reason   TEXT,
  diff_hash           TEXT,
  diff_stats_json     TEXT,
  diff_analyzed_at    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_competition_slots_comp ON dev_competition_slots(competition_id);
CREATE INDEX IF NOT EXISTS idx_dev_competition_slots_task ON dev_competition_slots(task_id);

-- ============================================================================
-- Dev Tools: Triage Rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS dev_triage_rules (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES dev_projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  conditions    TEXT NOT NULL,
  action        TEXT NOT NULL,
  enabled       INTEGER DEFAULT 1,
  times_fired   INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Invisible Apps Phase 1: Identity & P2P Foundation
-- ============================================================================

-- Local cryptographic identity (exactly one row, enforced by CHECK)
CREATE TABLE IF NOT EXISTS local_identity (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    peer_id         TEXT NOT NULL UNIQUE,
    public_key      BLOB NOT NULL,
    display_name    TEXT NOT NULL DEFAULT 'Anonymous',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trusted peers (manual key exchange)
CREATE TABLE IF NOT EXISTS trusted_peers (
    peer_id         TEXT PRIMARY KEY,
    public_key      BLOB NOT NULL,
    display_name    TEXT NOT NULL,
    trust_level     TEXT NOT NULL DEFAULT 'manual'
                    CHECK(trust_level IN ('manual', 'verified', 'revoked')),
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen       TEXT,
    notes           TEXT
);

-- Exposure manifest: resources the user shares on the network
CREATE TABLE IF NOT EXISTS exposed_resources (
    id              TEXT PRIMARY KEY,
    resource_type   TEXT NOT NULL
                    CHECK(resource_type IN ('persona','template','execution_result','knowledge','connector')),
    resource_id     TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    description     TEXT,
    fields_exposed  TEXT NOT NULL DEFAULT '[]',
    access_level    TEXT NOT NULL DEFAULT 'read'
                    CHECK(access_level IN ('read','execute','fork')),
    requires_auth   INTEGER NOT NULL DEFAULT 1,
    tags            TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT,
    UNIQUE(resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_exposed_type ON exposed_resources(resource_type);

-- Provenance: tracks where imported resources came from
CREATE TABLE IF NOT EXISTS resource_provenance (
    resource_type       TEXT NOT NULL,
    resource_id         TEXT NOT NULL,
    source_peer_id      TEXT NOT NULL,
    source_display_name TEXT,
    imported_at         TEXT NOT NULL DEFAULT (datetime('now')),
    bundle_hash         TEXT,
    signature_verified  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (resource_type, resource_id)
);

-- ============================================================================
-- Webhook Request Log (last 100 per endpoint for inspection/replay)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_request_log (
    id              TEXT PRIMARY KEY,
    trigger_id      TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT 'POST',
    headers         TEXT,
    body            TEXT,
    status_code     INTEGER NOT NULL,
    response_body   TEXT,
    event_id        TEXT,
    error_message   TEXT,
    received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wrl_trigger ON webhook_request_log(trigger_id);
CREATE INDEX IF NOT EXISTS idx_wrl_received ON webhook_request_log(received_at);

-- ============================================================================
-- Chat Messages (interactive conversational sessions per persona)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
    content         TEXT NOT NULL,
    execution_id    TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_persona   ON chat_messages(persona_id);
CREATE INDEX IF NOT EXISTS idx_chat_session   ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_created   ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_persona_session_created ON chat_messages(persona_id, session_id, created_at DESC);

-- ============================================================================
-- Chat Session Context (persistent session metadata for cross-restart memory)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_session_context (
    session_id          TEXT PRIMARY KEY,
    persona_id          TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title               TEXT,
    summary             TEXT,
    system_prompt_hash  TEXT,
    working_memory      TEXT,
    chat_mode           TEXT NOT NULL DEFAULT 'ops',
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_ctx_persona   ON chat_session_context(persona_id);
CREATE INDEX IF NOT EXISTS idx_chat_ctx_updated   ON chat_session_context(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_ctx_persona_updated ON chat_session_context(persona_id, updated_at DESC);

-- ============================================================================
-- Build Sessions (multi-turn agent builder sessions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS build_sessions (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    phase           TEXT NOT NULL DEFAULT 'initializing',
    resolved_cells  TEXT NOT NULL DEFAULT '{}',
    pending_question TEXT,
    agent_ir        TEXT,
    adoption_answers TEXT,
    intent          TEXT NOT NULL,
    error_message   TEXT,
    cli_pid         INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_build_sessions_persona ON build_sessions(persona_id);
CREATE INDEX IF NOT EXISTS idx_build_sessions_phase ON build_sessions(phase);

-- ============================================================================
-- Genome Breeding: Runs & Results (Persona Genetic Programming)
-- ============================================================================

CREATE TABLE IF NOT EXISTS genome_breeding_runs (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL DEFAULT 'default',
    status            TEXT NOT NULL DEFAULT 'generating',
    parent_ids        TEXT NOT NULL DEFAULT '[]',
    fitness_objective TEXT NOT NULL DEFAULT '{}',
    mutation_rate     REAL NOT NULL DEFAULT 0.1,
    generations       INTEGER NOT NULL DEFAULT 1,
    offspring_count   INTEGER NOT NULL DEFAULT 0,
    summary           TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL,
    completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_genome_breeding_runs_project ON genome_breeding_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_genome_breeding_runs_created ON genome_breeding_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS genome_breeding_results (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES genome_breeding_runs(id) ON DELETE CASCADE,
    genome_json         TEXT NOT NULL,
    parent_ids          TEXT NOT NULL DEFAULT '[]',
    generation          INTEGER NOT NULL DEFAULT 1,
    fitness_json        TEXT,
    fitness_overall     REAL,
    adopted             INTEGER NOT NULL DEFAULT 0,
    adopted_persona_id  TEXT,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_genome_breeding_results_run ON genome_breeding_results(run_id);
CREATE INDEX IF NOT EXISTS idx_genome_breeding_results_fitness ON genome_breeding_results(fitness_overall DESC);

-- ============================================================================
-- Evolution Policies & Cycles (Auto-evolving personas via lab optimization)
-- ============================================================================

CREATE TABLE IF NOT EXISTS evolution_policies (
    id                      TEXT PRIMARY KEY,
    persona_id              TEXT NOT NULL UNIQUE REFERENCES personas(id) ON DELETE CASCADE,
    enabled                 INTEGER NOT NULL DEFAULT 0,
    fitness_objective       TEXT NOT NULL DEFAULT '{"speed":0.33,"quality":0.34,"cost":0.33}',
    mutation_rate           REAL NOT NULL DEFAULT 0.15,
    variants_per_cycle      INTEGER NOT NULL DEFAULT 4,
    improvement_threshold   REAL NOT NULL DEFAULT 0.05,
    min_executions_between  INTEGER NOT NULL DEFAULT 10,
    last_cycle_at           TEXT,
    total_cycles            INTEGER NOT NULL DEFAULT 0,
    total_promotions        INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evolution_policies_persona ON evolution_policies(persona_id);
CREATE INDEX IF NOT EXISTS idx_evolution_policies_enabled ON evolution_policies(enabled);

CREATE TABLE IF NOT EXISTS evolution_cycles (
    id                TEXT PRIMARY KEY,
    policy_id         TEXT NOT NULL REFERENCES evolution_policies(id) ON DELETE CASCADE,
    persona_id        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'breeding'
                      CHECK(status IN ('breeding','evaluating','promoting','completed','failed')),
    variants_tested   INTEGER NOT NULL DEFAULT 0,
    winner_fitness    REAL,
    incumbent_fitness REAL,
    promoted          INTEGER NOT NULL DEFAULT 0,
    summary           TEXT,
    error             TEXT,
    started_at        TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_evolution_cycles_policy ON evolution_cycles(policy_id);
CREATE INDEX IF NOT EXISTS idx_evolution_cycles_persona ON evolution_cycles(persona_id);
CREATE INDEX IF NOT EXISTS idx_evolution_cycles_started ON evolution_cycles(started_at DESC);

"#;
