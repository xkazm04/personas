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

    // Parse agent_ir
    let agent_ir: serde_json::Value = session
        .agent_ir
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
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

    // Run real API tests
    let report = build_session_engine::run_tool_tests(
        &state.db,
        &app,
        &session_id,
        &persona_id,
        &agent_ir,
    )
    .await?;

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

    let agent_ir: serde_json::Value = session
        .agent_ir
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or_else(|| AppError::Validation("Build session has no agent_ir".to_string()))?;

    let mut connectors_needing_setup: Vec<String> = Vec::new();

    let ir_name = agent_ir.get("name").and_then(|v| v.as_str());
    let ir_description = agent_ir.get("description").and_then(|v| v.as_str());
    let ir_system_prompt = agent_ir.get("system_prompt")
        .or_else(|| agent_ir.get("full_prompt_markdown"))
        .and_then(|v| v.as_str());
    let ir_structured_prompt = agent_ir.get("structured_prompt");
    let ir_icon = agent_ir.get("icon").and_then(|v| v.as_str());
    let ir_color = agent_ir.get("color").and_then(|v| v.as_str());

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir_name.is_some(),
        has_system_prompt = ir_system_prompt.is_some(),
        system_prompt_len = ir_system_prompt.map(|s| s.len()).unwrap_or(0),
        has_structured_prompt = ir_structured_prompt.is_some(),
        "promote_build_draft: extracted IR fields"
    );

    // ================================================================
    // Step 1: Build structured DesignUseCase[] from agent_ir
    // ================================================================
    let ir_use_cases = agent_ir.get("use_cases")
        .or_else(|| agent_ir.get("use_case_flows"))
        .and_then(|v| v.as_array());
    let ir_triggers = agent_ir.get("triggers")
        .or_else(|| agent_ir.get("suggested_triggers"))
        .and_then(|v| v.as_array());
    let ir_events = agent_ir.get("events")
        .or_else(|| agent_ir.get("suggested_event_subscriptions"))
        .and_then(|v| v.as_array());
    let ir_messages = agent_ir.get("messages")
        .or_else(|| agent_ir.get("suggested_notification_channels"));

    let mut structured_use_cases: Vec<serde_json::Value> = Vec::new();
    let mut use_case_ids: Vec<String> = Vec::new();

    if let Some(use_cases) = ir_use_cases {
        for (idx, uc) in use_cases.iter().enumerate() {
            let uc_id = format!("uc-{}", uuid::Uuid::new_v4());

            // Use case may be a string or a structured object from enriched prompt
            let (title, description, category, execution_mode) = if let Some(s) = uc.as_str() {
                (s.to_string(), s.to_string(), "general".to_string(), "e2e".to_string())
            } else {
                (
                    uc.get("title").and_then(|v| v.as_str()).unwrap_or("Use Case").to_string(),
                    uc.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    uc.get("category").and_then(|v| v.as_str()).unwrap_or("general").to_string(),
                    uc.get("execution_mode").and_then(|v| v.as_str()).unwrap_or("e2e").to_string(),
                )
            };

            // Link trigger by index if available
            let suggested_trigger = ir_triggers
                .and_then(|triggers| triggers.get(idx))
                .map(|t| serde_json::json!({
                    "type": t.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("manual"),
                    "cron": t.get("config").and_then(|c| c.get("cron")).and_then(|v| v.as_str()),
                    "description": t.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                }));

            // Link event subscriptions — include all events (template payloads
            // don't have direction field; agent_ir events may have direction="subscribe")
            let event_subs: Vec<serde_json::Value> = ir_events
                .map(|events| events.iter()
                    .filter(|e| {
                        let dir = e.get("direction").and_then(|v| v.as_str());
                        dir.is_none() || dir == Some("subscribe")
                    })
                    .map(|e| serde_json::json!({
                        "event_type": e.get("event_type").and_then(|v| v.as_str()).unwrap_or(""),
                        "source_filter": e.get("source_filter").and_then(|v| v.as_str()),
                        "enabled": true,
                    }))
                    .collect())
                .unwrap_or_default();

            structured_use_cases.push(serde_json::json!({
                "id": uc_id,
                "title": title,
                "description": description,
                "category": category,
                "execution_mode": execution_mode,
                "suggested_trigger": suggested_trigger,
                "event_subscriptions": event_subs,
            }));
            use_case_ids.push(uc_id);
        }
    }

    // ================================================================
    // Pre-transaction: Prepare tool data and read-only lookups
    // ================================================================
    let mut tool_names: Vec<String> = Vec::new();
    let all_connectors = connector_repo::get_all(&state.db).unwrap_or_default();

    // Pre-validate triggers before entering the transaction
    if let Some(triggers) = ir_triggers {
        for trigger_json in triggers {
            let trigger_type = trigger_json.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("manual");
            let config_str = trigger_json.get("config").map(|v| serde_json::to_string(v).unwrap_or_default());
            trigger_repo::validate_trigger_type(trigger_type)?;
            trigger_repo::validate_config(trigger_type, config_str.as_deref())?;
        }
    }

    // Pre-compute notification channels (encryption happens here, before the tx)
    let notification_channels = {
        let from_messages = ir_messages
            .and_then(|v| v.get("channels"))
            .filter(|v| v.is_array());
        let from_ir = agent_ir.get("notification_channels")
            .filter(|v| v.is_array());
        let raw = from_messages
            .or(from_ir)
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        match &raw {
            Some(json) if !json.trim().is_empty() => Some(persona_repo::encrypt_notification_channels(json)?),
            other => other.clone(),
        }
    };

    // Build connectors list from tools + service_flow
    let connectors = agent_ir.get("required_connectors")
        .or_else(|| agent_ir.get("suggested_connectors"))
        .cloned()
        .unwrap_or_else(|| {
            let service_flow = agent_ir.get("service_flow").and_then(|v| v.as_array());
            if let Some(services) = service_flow {
                serde_json::Value::Array(services.iter().filter_map(|s| {
                    let name = s.as_str()?;
                    if name == "Local Database" || name == "In-App Messaging" { return None; }
                    Some(serde_json::json!({"name": name.to_lowercase().replace(' ', "_"), "service_type": name.to_lowercase().replace(' ', "_")}))
                }).collect())
            } else {
                serde_json::Value::Array(vec![])
            }
        });

    // Build design_context
    let summary = agent_ir.get("design_context")
        .and_then(|d| d.get("summary"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let design_context = serde_json::json!({
        "useCases": structured_use_cases,
        "summary": summary,
        "builderMeta": {
            "creationMethod": "matrix"
        }
    });

    // Identify connectors needing credential setup (read-only)
    if let Some(connectors) = agent_ir.get("required_connectors").and_then(|v| v.as_array()) {
        for conn_val in connectors {
            if !conn_val.get("has_credential").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Some(name) = conn_val.get("name").and_then(|v| v.as_str()) {
                    connectors_needing_setup.push(name.to_string());
                }
            }
        }
    }

    // Prepare tool definitions to create (resolve existing vs new before the tx)
    struct ToolAction {
        name: String,
        existing_def_id: Option<String>,
        create_input: Option<CreateToolDefinitionInput>,
    }

    let mut tool_actions: Vec<ToolAction> = Vec::new();

    if let Some(tools) = agent_ir.get("tools").or_else(|| agent_ir.get("suggested_tools")).and_then(|v| v.as_array()) {
        for tool_json in tools {
            let name = if let Some(s) = tool_json.as_str() {
                s.to_string()
            } else {
                tool_json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string()
            };
            if name.is_empty() { continue; }

            let normalized: String = name.chars().enumerate().fold(String::new(), |mut acc, (i, c)| {
                if c.is_uppercase() && i > 0 { acc.push('_'); }
                acc.push(c.to_ascii_lowercase());
                acc
            });

            tool_names.push(name.clone());

            // Try to find an existing tool definition by name
            let existing_def = tool_repo::get_definition_by_name(&state.db, &normalized)
                .ok().flatten()
                .or_else(|| tool_repo::get_definition_by_name(&state.db, &name).ok().flatten());

            if let Some(def) = existing_def {
                tool_actions.push(ToolAction { name, existing_def_id: Some(def.id), create_input: None });
                continue;
            }

            let (category, description, input_schema, output_schema, req_cred, impl_guide) = if tool_json.is_object() {
                let is = tool_json.get("input_schema")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| tool_json.get("parameters").map(|p| {
                        serde_json::json!({"type": "object", "properties": p}).to_string()
                    }))
                    .or_else(|| Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()));
                let os = tool_json.get("output_schema")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()));
                (
                    tool_json.get("category").and_then(|v| v.as_str()).unwrap_or("api").to_string(),
                    tool_json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    is, os,
                    tool_json.get("requires_credential_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    tool_json.get("implementation_guide").and_then(|v| v.as_str()).map(|s| s.to_string()),
                )
            } else {
                let inferred_cred = infer_credential_type(&normalized, &all_connectors);
                (
                    "api".to_string(),
                    format!("Auto-created from build: {}", name),
                    Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()),
                    Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()),
                    inferred_cred, None,
                )
            };

            let effective_req_cred = req_cred.or_else(|| infer_credential_type(&normalized, &all_connectors));

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
    }

    // Build design_result (needs tool_names populated)
    let design_result = serde_json::json!({
        "suggested_tools": tool_names,
        "suggested_connectors": connectors,
        "suggested_triggers": ir_triggers.cloned().unwrap_or_default(),
        "structured_prompt": agent_ir.get("structured_prompt").cloned(),
        "full_prompt_markdown": agent_ir.get("system_prompt")
            .or_else(|| agent_ir.get("full_prompt_markdown"))
            .and_then(|v| v.as_str()),
        "suggested_event_subscriptions": ir_events.cloned().unwrap_or_default(),
        "suggested_notification_channels": ir_messages.cloned(),
        "use_case_flows": ir_use_cases.cloned().unwrap_or_default(),
        "service_flow": agent_ir.get("service_flow").cloned(),
    });

    let design_context_str = serde_json::to_string(&design_context).unwrap_or_default();
    let design_result_str = serde_json::to_string(&design_result).unwrap_or_default();

    // ================================================================
    // BEGIN TRANSACTION — all writes are atomic from here
    // ================================================================
    let mut conn = state.db.get().map_err(|e| AppError::Internal(format!("Pool error: {e}")))?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut tools_created = 0u32;
    let mut triggers_created = 0u32;
    let mut subscriptions_created = 0u32;

    // --- Tools: create definitions + assign to persona ---
    for action in &tool_actions {
        let def_id = if let Some(ref existing_id) = action.existing_def_id {
            existing_id.clone()
        } else if let Some(ref input) = action.create_input {
            if input.name.trim().is_empty() {
                return Err(AppError::Validation("Tool name cannot be empty".into()));
            }
            let def_id = uuid::Uuid::new_v4().to_string();
            let is_builtin = input.is_builtin.unwrap_or(false) as i32;
            // Try INSERT; on UNIQUE conflict, look up the existing definition
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
                    // UNIQUE constraint — tool name already exists, find and use it
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

    // --- Triggers: create linked to use cases ---
    // Track created trigger IDs for post-tx scheduler computation
    let mut created_trigger_ids: Vec<String> = Vec::new();

    if let Some(triggers) = ir_triggers {
        for (idx, trigger_json) in triggers.iter().enumerate() {
            let trigger_type = trigger_json.get("trigger_type")
                .and_then(|v| v.as_str()).unwrap_or("manual").to_string();
            let config = trigger_json.get("config")
                .map(|v| serde_json::to_string(v).unwrap_or_default());
            let use_case_id = use_case_ids.get(idx).cloned();

            // Validation was done pre-transaction
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
    }

    // --- Event subscriptions ---
    if let Some(events) = ir_events {
        for event_json in events {
            let event_type = event_json.get("event_type")
                .and_then(|v| v.as_str())
                .unwrap_or("").to_string();
            if event_type.is_empty() { continue; }

            let direction = event_json.get("direction")
                .and_then(|v| v.as_str()).unwrap_or("subscribe");
            if direction != "subscribe" { continue; }

            let source_filter: Option<String> = event_json.get("source_filter")
                .and_then(|v| v.as_str()).map(|s| s.to_string());

            let sub_id = uuid::Uuid::new_v4().to_string();
            let rows = tx.execute(
                "INSERT OR IGNORE INTO persona_event_subscriptions
                 (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, NULL, ?5, ?5)",
                rusqlite::params![sub_id, persona_id, event_type, source_filter, now],
            ).map_err(AppError::Database)?;

            if rows > 0 {
                subscriptions_created += 1;
            }
        }
    }

    // --- Persona update ---
    {
        // Build SET clause for the specific fields promote uses
        let structured_prompt_str: Option<String> = ir_structured_prompt
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
                ir_name, ir_description, ir_system_prompt,
                structured_prompt_str, ir_icon, ir_color,
                notification_channels,
                design_context_str, design_result_str,
                now, persona_id,
            ],
        ).map_err(AppError::Database)?;
    }

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir_name.is_some(),
        has_structured_prompt = ir_structured_prompt.is_some(),
        "promote_build_draft: persona update succeeded (in transaction)"
    );

    // --- Version snapshot ---
    {
        let sp_str: Option<String> = ir_structured_prompt
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
                ir_system_prompt.map(|s| s.to_string()),
                Some("Promoted from PersonaMatrix build".to_string()),
                "experimental", now,
                Some(&design_context_str), Some(&design_result_str),
                Some(session.resolved_cells.clone()),
                ir_icon.map(|s| s.to_string()),
                ir_color.map(|s| s.to_string()),
            ],
        ).map_err(AppError::Database)?;
    }

    // --- Transition build session to Promoted ---
    tx.execute(
        "UPDATE build_sessions SET phase = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![BuildPhase::Promoted.as_str(), now, session_id],
    ).map_err(AppError::Database)?;

    // ================================================================
    // COMMIT — all entities are persisted atomically
    // ================================================================
    tx.commit().map_err(AppError::Database)?;

    // Post-transaction: compute next_trigger_at for schedule/polling triggers.
    // This is a best-effort update that doesn't need to be in the transaction
    // since the trigger row already exists and the scheduler will pick it up
    // on its next tick regardless.
    for trigger_id in &created_trigger_ids {
        if let Ok(trigger) = trigger_repo::get_by_id(&state.db, trigger_id) {
            if let Some(next_at) = crate::engine::scheduler::compute_next_trigger_at(&trigger, chrono::Utc::now()) {
                let _ = state.db.get().and_then(|c| {
                    c.execute(
                        "UPDATE persona_triggers SET next_trigger_at = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![next_at, chrono::Utc::now().to_rfc3339(), trigger_id],
                    ).ok();
                    Ok(())
                });
            }
        }
    }

    Ok(serde_json::json!({
        "persona": { "id": persona_id },
        "triggers_created": triggers_created,
        "tools_created": tools_created,
        "subscriptions_created": subscriptions_created,
        "connectors_needing_setup": connectors_needing_setup,
    }))
}
