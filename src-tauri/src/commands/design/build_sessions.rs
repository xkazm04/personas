use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::db::models::{
    BuildEvent, BuildPhase, PersistedBuildSession, UserAnswer, UpdateBuildSession,
    CreateToolDefinitionInput, ConnectorDefinition,
};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::repos::resources::connectors as connector_repo;
use crate::engine::build_session as build_session_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Match a tool name against known connector names to infer its credential type.
fn infer_credential_type(tool_name: &str, connectors: &[ConnectorDefinition]) -> Option<String> {
    let lower = tool_name.to_lowercase();
    connectors.iter().find_map(|c| {
        let cn = c.name.to_lowercase();
        if lower.contains(&cn) || cn.contains(&lower) {
            Some(c.name.clone())
        } else {
            None
        }
    })
}

/// Start a new build session for a persona. Returns the session ID.
/// Events are streamed back via the Channel parameter.
/// Optional workflow_json + parser_result_json enable workflow import mode.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_build_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Channel<BuildEvent>,
    persona_id: String,
    intent: String,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
    language: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    state.build_session_manager.start_session(
        session_id.clone(),
        persona_id,
        intent,
        channel,
        state.db.clone(),
        state.process_registry.clone(),
        workflow_json,
        parser_result_json,
        app,
        language,
    )?;

    Ok(session_id)
}

/// Create a build session record from a pre-built design result (template adoption).
/// Does NOT spawn CLI — just inserts the session with agent_ir so test_build_draft works.
#[tauri::command]
pub async fn create_adoption_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    intent: String,
    agent_ir_json: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.get()?;
    conn.execute(
        "INSERT INTO build_sessions (id, persona_id, phase, resolved_cells, intent, agent_ir, created_at, updated_at)
         VALUES (?1, ?2, 'draft_ready', '{}', ?3, ?4, ?5, ?5)",
        rusqlite::params![session_id, persona_id, intent, agent_ir_json, now],
    )?;

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        "create_adoption_session: created session for template adoption testing"
    );

    Ok(session_id)
}

/// Send a user answer to a pending question in a build session.
#[tauri::command]
pub async fn answer_build_question(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    cell_key: String,
    answer: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    let user_answer = UserAnswer { cell_key, answer };
    state
        .build_session_manager
        .send_answer(&session_id, user_answer)
}

/// Cancel an active build session.
#[tauri::command]
pub async fn cancel_build_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    state.build_session_manager.cancel_session(
        &session_id,
        &state.db,
        &state.process_registry,
    )
}

/// Get the active (non-terminal) build session for a persona, if any.
/// Returns a frontend-friendly representation with parsed JSON fields.
#[tauri::command]
pub async fn get_active_build_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_active_for_persona(&state.db, &persona_id)?;
    Ok(session.as_ref().map(PersistedBuildSession::from_session))
}

/// List non-terminal build sessions, optionally filtered by persona_id.
#[tauri::command]
pub async fn list_build_sessions(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<Vec<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let sessions =
        build_session_repo::list_non_terminal(&state.db, persona_id.as_deref())?;
    Ok(sessions
        .iter()
        .map(PersistedBuildSession::from_session)
        .collect())
}

/// Test a build draft by executing each tool against its real API.
///
/// Loads the build session, extracts tools from agent_ir, and runs each tool
/// via `invoke_tool_direct()` with resolved credentials. Returns a per-tool
/// test report with HTTP status codes, latency, and error classification.
#[tauri::command]
pub async fn test_build_draft(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    // Load and validate session
    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    session
        .phase
        .validate_transition(BuildPhase::Testing)
        .map_err(AppError::Validation)?;

    // Parse agent_ir into typed struct
    let agent_ir: crate::db::models::AgentIr = session
        .parse_agent_ir()
        .ok_or_else(|| AppError::Validation("Build session has no agent_ir".to_string()))?;

    // Transition to testing phase
    build_session_repo::update(
        &state.db,
        &session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Testing.as_str().to_string()),
            ..Default::default()
        },
    )?;

    // Run real API tests — on failure, revert to draft_ready so the user can retry
    let result = build_session_engine::run_tool_tests(
        &state.db,
        &app,
        &session_id,
        &persona_id,
        &agent_ir,
    )
    .await;

    match result {
        Ok(report) => {
            // Transition to test_complete
            build_session_repo::update(
                &state.db,
                &session_id,
                &UpdateBuildSession {
                    phase: Some(BuildPhase::TestComplete.as_str().to_string()),
                    ..Default::default()
                },
            )?;
            Ok(report)
        }
        Err(e) => {
            // Revert to draft_ready so the session isn't stuck in testing
            let _ = build_session_repo::update(
                &state.db,
                &session_id,
                &UpdateBuildSession {
                    phase: Some(BuildPhase::DraftReady.as_str().to_string()),
                    error_message: Some(Some(e.to_string())),
                    ..Default::default()
                },
            );
            Err(e)
        }
    }
}

/// Promote a tested build draft to production.
///
/// Creates ALL records the Editor tabs expect from agent_ir:
/// - PersonaToolDefinition with input/output schemas
/// - PersonaTrigger linked to use cases
/// - PersonaEventSubscription from events dimension
/// - DesignContextData-format design_context with structured DesignUseCase entries
/// - AgentIR-compatible last_design_result for Design tab preview
/// - Notification channels on persona
#[tauri::command]
pub async fn promote_build_draft(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    promote_build_draft_inner(&state, session_id, persona_id).await
}

// ============================================================================
// Promote helper types
// ============================================================================

/// Pre-computed tool action: either reuse an existing definition or create a new one.
struct ToolAction {
    name: String,
    existing_def_id: Option<String>,
    create_input: Option<CreateToolDefinitionInput>,
}

/// Structured use cases extracted from agent IR, ready for design_context.
struct UseCaseData {
    structured: Vec<serde_json::Value>,
    ids: Vec<String>,
}

/// All data assembled before the transaction begins.
struct PromotePreparation {
    use_cases: UseCaseData,
    tool_actions: Vec<ToolAction>,
    tool_names: Vec<String>,
    design_context_str: String,
    design_result_str: String,
    notification_channels: Option<String>,
    connectors_needing_setup: Vec<String>,
}

/// Mutable counters tracked during the transaction.
struct PromoteCounters {
    tools_created: u32,
    triggers_created: u32,
    subscriptions_created: u32,
    created_trigger_ids: Vec<String>,
}

// ============================================================================
// Step 1: Build structured DesignUseCase[] from agent_ir
// ============================================================================

fn build_structured_use_cases(
    ir: &crate::db::models::AgentIr,
) -> UseCaseData {
    if ir.use_cases.is_empty() {
        return UseCaseData { structured: Vec::new(), ids: Vec::new() };
    }

    let mut structured = Vec::new();
    let mut ids = Vec::new();

    for (idx, uc) in ir.use_cases.iter().enumerate() {
        let uc_id = format!("uc-{}", uuid::Uuid::new_v4());

        let title = uc.title().to_string();
        let description = uc.description().to_string();
        let category = uc.category().to_string();
        let execution_mode = uc.execution_mode().to_string();

        let suggested_trigger = ir.triggers
            .get(idx)
            .map(|t| serde_json::json!({
                "type": t.trigger_type.as_deref().unwrap_or("manual"),
                "cron": t.config.as_ref().and_then(|c| c.get("cron")).and_then(|v| v.as_str()),
                "description": t.description.as_deref().unwrap_or(""),
            }));

        // Extract per-use-case event subscriptions via typed accessor.
        let event_subs: Vec<serde_json::Value> = uc
            .event_subscriptions()
            .iter()
            .filter_map(|e| {
                let event_type = e.event_type.as_deref().unwrap_or("");
                if event_type.is_empty() { return None; }
                Some(serde_json::json!({
                    "event_type": event_type,
                    "source_filter": e.source_filter.as_deref(),
                    "enabled": true,
                }))
            })
            .collect();

        structured.push(serde_json::json!({
            "id": uc_id,
            "title": title,
            "description": description,
            "category": category,
            "execution_mode": execution_mode,
            "suggested_trigger": suggested_trigger,
            "event_subscriptions": event_subs,
        }));
        ids.push(uc_id);
    }

    UseCaseData { structured, ids }
}

// ============================================================================
// Step 2: Prepare tool actions (resolve existing vs new definitions)
// ============================================================================

fn prepare_tool_actions(
    ir: &crate::db::models::AgentIr,
    db: &crate::db::DbPool,
    all_connectors: &[ConnectorDefinition],
) -> (Vec<ToolAction>, Vec<String>) {
    use crate::db::models::agent_ir::AgentIrTool;

    let mut tool_actions = Vec::new();
    let mut tool_names = Vec::new();
    let default_schema = r#"{"type":"object","properties":{},"additionalProperties":true}"#;

    for tool in &ir.tools {
        let name = tool.name().to_string();
        if name.is_empty() { continue; }

        let normalized: String = name.chars().enumerate().fold(String::new(), |mut acc, (i, c)| {
            if c.is_uppercase() && i > 0 { acc.push('_'); }
            acc.push(c.to_ascii_lowercase());
            acc
        });

        tool_names.push(name.clone());

        // Try to find an existing tool definition by name
        let existing_def = tool_repo::get_definition_by_name(db, &normalized)
            .ok().flatten()
            .or_else(|| tool_repo::get_definition_by_name(db, &name).ok().flatten());

        if let Some(def) = existing_def {
            tool_actions.push(ToolAction { name, existing_def_id: Some(def.id), create_input: None });
            continue;
        }

        let (category, description, input_schema, output_schema, req_cred, impl_guide) = match tool {
            AgentIrTool::Structured(d) => {
                let is = d.input_schema.as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| d.parameters.as_ref().map(|p| {
                        serde_json::json!({"type": "object", "properties": p}).to_string()
                    }))
                    .or_else(|| Some(default_schema.to_string()));
                let os = d.output_schema.as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| Some(default_schema.to_string()));
                (
                    d.category.as_deref().unwrap_or("api").to_string(),
                    d.description.as_deref().unwrap_or("").to_string(),
                    is, os,
                    d.requires_credential_type.clone(),
                    d.implementation_guide.clone(),
                )
            }
            AgentIrTool::Simple(_) => {
                let inferred_cred = infer_credential_type(&normalized, all_connectors);
                (
                    "api".to_string(),
                    format!("Auto-created from build: {}", name),
                    Some(default_schema.to_string()),
                    Some(default_schema.to_string()),
                    inferred_cred, None,
                )
            }
        };

        let effective_req_cred = req_cred.or_else(|| infer_credential_type(&normalized, all_connectors));

        tool_actions.push(ToolAction {
            name,
            existing_def_id: None,
            create_input: Some(CreateToolDefinitionInput {
                name: normalized,
                category,
                description,
                script_path: String::new(),
                input_schema,
                output_schema,
                requires_credential_type: effective_req_cred,
                implementation_guide: impl_guide,
                is_builtin: Some(false),
            }),
        });
    }

    (tool_actions, tool_names)
}

// ============================================================================
// Step 3: Validate triggers before the transaction
// ============================================================================

fn validate_triggers(ir: &crate::db::models::AgentIr) -> Result<(), AppError> {
    for t in &ir.triggers {
        let trigger_type = t.trigger_type.as_deref().unwrap_or("manual");
        let config_str = t.config.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
        trigger_repo::validate_trigger_type(trigger_type)?;
        trigger_repo::validate_config(trigger_type, config_str.as_deref())?;
    }
    Ok(())
}

// ============================================================================
// Step 4: Build design_context and design_result JSON
// ============================================================================

fn build_design_json(
    ir: &crate::db::models::AgentIr,
    structured_use_cases: &[serde_json::Value],
    tool_names: &[String],
) -> (String, String) {
    let ir_triggers: Option<&Vec<crate::db::models::agent_ir::AgentIrTrigger>> = if ir.triggers.is_empty() { None } else { Some(&ir.triggers) };
    let ir_events: Option<&Vec<crate::db::models::agent_ir::AgentIrEvent>> = if ir.events.is_empty() { None } else { Some(&ir.events) };
    let ir_use_cases_json: Vec<serde_json::Value> = ir.use_cases.iter()
        .filter_map(|uc| serde_json::to_value(uc).ok())
        .collect();

    let connectors = ir.effective_connectors_json();
    let summary = ir.design_summary();

    let design_context = serde_json::json!({
        "useCases": structured_use_cases,
        "summary": summary,
        "builderMeta": {
            "creationMethod": "matrix"
        }
    });

    let design_result = serde_json::json!({
        "suggested_tools": tool_names,
        "suggested_connectors": connectors,
        "suggested_triggers": ir_triggers.map(|t| serde_json::to_value(t).unwrap_or_default()),
        "structured_prompt": ir.structured_prompt.clone(),
        "full_prompt_markdown": ir.system_prompt.as_deref(),
        "suggested_event_subscriptions": ir_events.map(|e| serde_json::to_value(e).unwrap_or_default()),
        "suggested_notification_channels": ir.messages.clone(),
        "use_case_flows": ir_use_cases_json,
        "service_flow": serde_json::to_value(&ir.service_flow).unwrap_or_default(),
    });

    (
        serde_json::to_string(&design_context).unwrap_or_default(),
        serde_json::to_string(&design_result).unwrap_or_default(),
    )
}

// ============================================================================
// Step 5: Encrypt notification channels (pre-transaction)
// ============================================================================

fn prepare_notification_channels(ir: &crate::db::models::AgentIr) -> Result<Option<String>, AppError> {
    let channel_val = ir.notification_channel_array();
    let raw = channel_val.map(|v| serde_json::to_string(v).unwrap_or_default());
    match &raw {
        Some(json) if !json.trim().is_empty() => Ok(Some(persona_repo::encrypt_notification_channels(json)?)),
        other => Ok(other.clone()),
    }
}

// ============================================================================
// Step 6: Identify connectors needing credential setup
// ============================================================================

fn find_connectors_needing_setup(ir: &crate::db::models::AgentIr) -> Vec<String> {
    ir.required_connectors
        .iter()
        .filter(|c| !c.has_credential.unwrap_or(false))
        .filter_map(|c| c.name.as_deref().map(|n| n.to_string()))
        .collect()
}

// ============================================================================
// Transaction: create tool definitions + assign to persona
// ============================================================================

fn create_tools_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    tool_actions: &[ToolAction],
    now: &str,
) -> Result<u32, AppError> {
    let mut tools_created = 0u32;

    for action in tool_actions {
        let def_id = if let Some(ref existing_id) = action.existing_def_id {
            existing_id.clone()
        } else if let Some(ref input) = action.create_input {
            if input.name.trim().is_empty() {
                return Err(AppError::Validation("Tool name cannot be empty".into()));
            }
            let def_id = uuid::Uuid::new_v4().to_string();
            let is_builtin = input.is_builtin.unwrap_or(false) as i32;
            let insert_result = tx.execute(
                "INSERT INTO persona_tool_definitions
                 (id, name, category, description, script_path,
                  input_schema, output_schema, requires_credential_type,
                  implementation_guide, is_builtin,
                  created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                rusqlite::params![
                    def_id, input.name, input.category, input.description,
                    input.script_path, input.input_schema, input.output_schema,
                    input.requires_credential_type, input.implementation_guide,
                    is_builtin, now,
                ],
            );
            match insert_result {
                Ok(_) => def_id,
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    tx.query_row(
                        "SELECT id FROM persona_tool_definitions WHERE LOWER(name) = LOWER(?1)",
                        rusqlite::params![input.name],
                        |row| row.get::<_, String>(0),
                    ).map_err(|e| AppError::Internal(format!(
                        "Tool '{}' exists but could not be looked up: {e}", action.name
                    )))?
                }
                Err(e) => return Err(AppError::Database(e)),
            }
        } else {
            continue;
        };

        // Assign tool to persona (skip if already assigned)
        let existing_assignment: Option<String> = tx.query_row(
            "SELECT id FROM persona_tools WHERE persona_id = ?1 AND tool_id = ?2",
            rusqlite::params![persona_id, def_id],
            |row| row.get(0),
        ).ok();

        if existing_assignment.is_none() {
            let assign_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4)",
                rusqlite::params![assign_id, persona_id, def_id, now],
            ).map_err(AppError::Database)?;
        }
        tools_created += 1;
    }

    Ok(tools_created)
}

// ============================================================================
// Transaction: create triggers linked to use cases
// ============================================================================

fn create_triggers_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    use_case_ids: &[String],
    now: &str,
) -> Result<(u32, Vec<String>), AppError> {
    let mut triggers_created = 0u32;
    let mut created_trigger_ids = Vec::new();

    for (idx, t) in ir.triggers.iter().enumerate() {
        let trigger_type = t.trigger_type.as_deref().unwrap_or("manual").to_string();
        let config = t.config.as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        let use_case_id = use_case_ids.get(idx).cloned();
        let encrypted_config = config.as_deref().map(trigger_repo::encrypt_config);

        let trigger_id = uuid::Uuid::new_v4().to_string();
        let status = "active";

        tx.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?7)",
            rusqlite::params![
                trigger_id, persona_id, trigger_type, encrypted_config,
                status, use_case_id, now,
            ],
        ).map_err(AppError::Database)?;

        created_trigger_ids.push(trigger_id);
        triggers_created += 1;
    }

    Ok((triggers_created, created_trigger_ids))
}

// ============================================================================
// Transaction: create event subscriptions
// ============================================================================

fn create_event_subscriptions_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    use_cases: &UseCaseData,
    now: &str,
) -> Result<u32, AppError> {
    let mut subscriptions_created = 0u32;

    // Build a reverse lookup: event_type -> use_case_id, from the structured
    // use cases that carry per-use-case event_subscriptions.
    let mut event_to_use_case: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for uc in &use_cases.structured {
        let uc_id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(subs) = uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            for sub in subs {
                if let Some(et) = sub.get("event_type").and_then(|v| v.as_str()) {
                    if !et.is_empty() {
                        event_to_use_case.entry(et.to_string()).or_insert_with(|| uc_id.to_string());
                    }
                }
            }
        }
    }

    for evt in &ir.events {
        let event_type = evt.event_type.as_deref().unwrap_or("").to_string();
        if event_type.is_empty() { continue; }

        let direction = evt.direction.as_deref().unwrap_or("subscribe");
        if direction != "subscribe" { continue; }

        let source_filter: Option<String> = evt.source_filter.clone();
        let use_case_id: Option<&str> = event_to_use_case.get(&event_type).map(|s| s.as_str());

        let sub_id = uuid::Uuid::new_v4().to_string();
        let rows = tx.execute(
            "INSERT OR IGNORE INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
            rusqlite::params![sub_id, persona_id, event_type, source_filter, use_case_id, now],
        ).map_err(AppError::Database)?;

        if rows > 0 {
            subscriptions_created += 1;
        }
    }

    Ok(subscriptions_created)
}

// ============================================================================
// Transaction: update persona row with promoted fields
// ============================================================================

fn update_persona_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    notification_channels: &Option<String>,
    design_context_str: &str,
    design_result_str: &str,
    now: &str,
) -> Result<(), AppError> {
    let structured_prompt_str: Option<String> = ir.structured_prompt
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    tx.execute(
        "UPDATE personas SET
            name = COALESCE(?1, name),
            description = COALESCE(?2, description),
            system_prompt = COALESCE(?3, system_prompt),
            structured_prompt = COALESCE(?4, structured_prompt),
            icon = COALESCE(?5, icon),
            color = COALESCE(?6, color),
            enabled = 1,
            notification_channels = COALESCE(?7, notification_channels),
            design_context = ?8,
            last_design_result = ?9,
            updated_at = ?10
         WHERE id = ?11",
        rusqlite::params![
            ir.name.as_deref(), ir.description.as_deref(), ir.system_prompt.as_deref(),
            structured_prompt_str, ir.icon.as_deref(), ir.color.as_deref(),
            notification_channels,
            design_context_str, design_result_str,
            now, persona_id,
        ],
    ).map_err(AppError::Database)?;

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir.name.is_some(),
        has_structured_prompt = ir.structured_prompt.is_some(),
        "promote_build_draft: persona update succeeded (in transaction)"
    );

    Ok(())
}

// ============================================================================
// Transaction: create version snapshot
// ============================================================================

fn create_version_snapshot_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    design_context_str: &str,
    design_result_str: &str,
    resolved_cells: &str,
    now: &str,
) -> Result<(), AppError> {
    let sp_str: Option<String> = ir.structured_prompt
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let version_id = uuid::Uuid::new_v4().to_string();
    let version_number: i32 = tx.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
        rusqlite::params![persona_id],
        |row| row.get(0),
    ).map_err(AppError::Database)?;

    tx.execute(
        "INSERT INTO persona_prompt_versions
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at,
          design_context, last_design_result, resolved_cells, icon, color)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        rusqlite::params![
            version_id, persona_id, version_number, sp_str,
            ir.system_prompt.as_deref().map(|s| s.to_string()),
            Some("Promoted from PersonaMatrix build".to_string()),
            "experimental", now,
            Some(design_context_str), Some(design_result_str),
            Some(resolved_cells.to_string()),
            ir.icon.as_deref().map(|s| s.to_string()),
            ir.color.as_deref().map(|s| s.to_string()),
        ],
    ).map_err(AppError::Database)?;

    Ok(())
}

// ============================================================================
// Post-transaction: update trigger schedules (best-effort)
// ============================================================================

fn update_trigger_schedules(
    db: &crate::db::DbPool,
    trigger_ids: &[String],
) {
    for trigger_id in trigger_ids {
        if let Ok(trigger) = trigger_repo::get_by_id(db, trigger_id) {
            if let Some(next_at) = crate::engine::scheduler::compute_next_trigger_at(&trigger, chrono::Utc::now()) {
                let _ = db.get().and_then(|c| {
                    c.execute(
                        "UPDATE persona_triggers SET next_trigger_at = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![next_at, chrono::Utc::now().to_rfc3339(), trigger_id],
                    ).ok();
                    Ok(())
                });
            }
        }
    }
}

// ============================================================================
// Inner promote logic — orchestrator
// ============================================================================

/// Inner promote logic — callable from both Tauri command and test automation.
///
/// All entity creation (tools, triggers, event subscriptions, persona update,
/// version snapshot, session phase transition) is wrapped in a single SQLite
/// transaction so that a failure at any step rolls back the entire promotion,
/// preventing partially-promoted orphan state.
pub async fn promote_build_draft_inner(
    state: &Arc<AppState>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    session
        .phase
        .validate_transition(BuildPhase::Promoted)
        .map_err(AppError::Validation)?;

    let ir: crate::db::models::AgentIr = session
        .parse_agent_ir()
        .ok_or_else(|| AppError::Validation("Build session has no agent_ir".to_string()))?;

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir.name.is_some(),
        has_system_prompt = ir.system_prompt.is_some(),
        system_prompt_len = ir.system_prompt.as_deref().map(|s| s.len()).unwrap_or(0),
        has_structured_prompt = ir.structured_prompt.is_some(),
        "promote_build_draft: extracted IR fields"
    );

    // ================================================================
    // Pre-transaction preparation (read-only + encryption)
    // ================================================================
    let use_cases = build_structured_use_cases(&ir);
    let all_connectors = connector_repo::get_all(&state.db).unwrap_or_default();
    let (tool_actions, tool_names) = prepare_tool_actions(&ir, &state.db, &all_connectors);
    validate_triggers(&ir)?;
    let notification_channels = prepare_notification_channels(&ir)?;
    let (design_context_str, design_result_str) = build_design_json(&ir, &use_cases.structured, &tool_names);
    let connectors_needing_setup = find_connectors_needing_setup(&ir);

    // ================================================================
    // BEGIN TRANSACTION — all writes are atomic from here
    // ================================================================
    let mut conn = state.db.get().map_err(|e| AppError::Internal(format!("Pool error: {e}")))?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();

    let tools_created = create_tools_in_tx(&tx, &persona_id, &tool_actions, &now)?;
    let (triggers_created, created_trigger_ids) = create_triggers_in_tx(&tx, &persona_id, &ir, &use_cases.ids, &now)?;
    let subscriptions_created = create_event_subscriptions_in_tx(&tx, &persona_id, &ir, &use_cases, &now)?;
    update_persona_in_tx(&tx, &persona_id, &ir, &notification_channels, &design_context_str, &design_result_str, &now)?;
    create_version_snapshot_in_tx(&tx, &persona_id, &ir, &design_context_str, &design_result_str, &session.resolved_cells, &now)?;

    // Transition build session to Promoted
    tx.execute(
        "UPDATE build_sessions SET phase = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![BuildPhase::Promoted.as_str(), now, session_id],
    ).map_err(AppError::Database)?;

    // ================================================================
    // COMMIT — all entities are persisted atomically
    // ================================================================
    tx.commit().map_err(AppError::Database)?;

    // Post-transaction: best-effort scheduler updates
    update_trigger_schedules(&state.db, &created_trigger_ids);

    Ok(serde_json::json!({
        "persona": { "id": persona_id },
        "triggers_created": triggers_created,
        "tools_created": tools_created,
        "subscriptions_created": subscriptions_created,
        "connectors_needing_setup": connectors_needing_setup,
    }))
}
