use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::db::models::{
    BuildEvent, BuildPhase, PersistedBuildSession, UserAnswer, UpdateBuildSession,
    CreateToolDefinitionInput, CreateTriggerInput, CreateEventSubscriptionInput, UpdatePersonaInput,
};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::repos::communication::events as event_repo;
use crate::engine::build_session as build_session_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

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

    match session.phase {
        BuildPhase::DraftReady | BuildPhase::TestComplete => {}
        _ => {
            return Err(AppError::Validation(format!(
                "Cannot test session in phase '{}'. Must be draft_ready or test_complete.",
                session.phase.as_str()
            )));
        }
    }

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

    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let agent_ir: serde_json::Value = session
        .agent_ir
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or_else(|| AppError::Validation("Build session has no agent_ir".to_string()))?;

    let mut tools_created = 0u32;
    let mut triggers_created = 0u32;
    let mut subscriptions_created = 0u32;
    let mut entity_errors: Vec<serde_json::Value> = Vec::new();
    let mut connectors_needing_setup: Vec<String> = Vec::new();

    let ir_name = agent_ir.get("name").and_then(|v| v.as_str());
    let ir_description = agent_ir.get("description").and_then(|v| v.as_str());
    let ir_system_prompt = agent_ir.get("system_prompt").and_then(|v| v.as_str());
    let ir_structured_prompt = agent_ir.get("structured_prompt");
    let ir_icon = agent_ir.get("icon").and_then(|v| v.as_str());
    let ir_color = agent_ir.get("color").and_then(|v| v.as_str());

    // ================================================================
    // Step 1: Build structured DesignUseCase[] from agent_ir
    // ================================================================
    let ir_use_cases = agent_ir.get("use_cases").and_then(|v| v.as_array());
    let ir_triggers = agent_ir.get("triggers").and_then(|v| v.as_array());
    let ir_events = agent_ir.get("events").and_then(|v| v.as_array());
    let ir_messages = agent_ir.get("messages");

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

            // Link event subscriptions
            let event_subs: Vec<serde_json::Value> = ir_events
                .map(|events| events.iter()
                    .filter(|e| e.get("direction").and_then(|v| v.as_str()) == Some("subscribe"))
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
    // Step 2: Create tools with schema inference
    // ================================================================
    let mut tool_names: Vec<String> = Vec::new();

    if let Some(tools) = agent_ir.get("tools").and_then(|v| v.as_array()) {
        for tool_json in tools {
            let name = tool_json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if name.is_empty() { continue; }
            tool_names.push(name.clone());

            // Schema inference: check LLM-provided → parameters → permissive fallback
            let input_schema = tool_json.get("input_schema")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .or_else(|| tool_json.get("parameters").map(|p| {
                    serde_json::json!({"type": "object", "properties": p}).to_string()
                }))
                .or_else(|| Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()));

            let output_schema = tool_json.get("output_schema")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .or_else(|| Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()));

            let input = CreateToolDefinitionInput {
                name: name.clone(),
                category: tool_json.get("category").and_then(|v| v.as_str()).unwrap_or("api").to_string(),
                description: tool_json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                script_path: String::new(),
                input_schema,
                output_schema,
                requires_credential_type: tool_json.get("requires_credential_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                implementation_guide: tool_json.get("implementation_guide").and_then(|v| v.as_str()).map(|s| s.to_string()),
                is_builtin: Some(false),
            };

            match tool_repo::create_definition(&state.db, input) {
                Ok(def) => {
                    if let Err(e) = tool_repo::assign_tool(&state.db, &persona_id, &def.id, None) {
                        entity_errors.push(serde_json::json!({"entity_type": "tool_assignment", "entity_name": name, "error": e.to_string()}));
                    } else {
                        tools_created += 1;
                    }
                }
                Err(e) => {
                    entity_errors.push(serde_json::json!({"entity_type": "tool", "entity_name": name, "error": e.to_string()}));
                }
            }
        }
    }

    // ================================================================
    // Step 3: Create triggers linked to use cases
    // ================================================================
    if let Some(triggers) = ir_triggers {
        for (idx, trigger_json) in triggers.iter().enumerate() {
            let trigger_type = trigger_json.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("manual").to_string();
            let config = trigger_json.get("config").map(|v| serde_json::to_string(v).unwrap_or_default());

            // Link trigger to use case by index
            let use_case_id = use_case_ids.get(idx).cloned();

            let input = CreateTriggerInput {
                persona_id: persona_id.clone(),
                trigger_type: trigger_type.clone(),
                config,
                enabled: Some(true),
                use_case_id,
            };

            match trigger_repo::create(&state.db, input) {
                Ok(_) => triggers_created += 1,
                Err(e) => {
                    let desc = trigger_json.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    entity_errors.push(serde_json::json!({"entity_type": "trigger", "entity_name": format!("{} - {}", trigger_type, desc), "error": e.to_string()}));
                }
            }
        }
    }

    // ================================================================
    // Step 4: Create event subscriptions from events dimension
    // ================================================================
    if let Some(events) = ir_events {
        for event_json in events {
            let event_type = event_json.get("event_type")
                .and_then(|v| v.as_str())
                .unwrap_or("").to_string();
            if event_type.is_empty() { continue; }

            // Only create subscriptions for "subscribe" direction events
            let direction = event_json.get("direction").and_then(|v| v.as_str()).unwrap_or("subscribe");
            if direction != "subscribe" { continue; }

            let input = CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: event_type.clone(),
                source_filter: event_json.get("source_filter").and_then(|v| v.as_str()).map(|s| s.to_string()),
                enabled: Some(true),
                use_case_id: None,
            };

            match event_repo::create_subscription(&state.db, input) {
                Ok(_) => subscriptions_created += 1,
                Err(e) => {
                    entity_errors.push(serde_json::json!({"entity_type": "event_subscription", "entity_name": event_type, "error": e.to_string()}));
                }
            }
        }
    }

    // ================================================================
    // Step 5: Notification channels
    // ================================================================
    let notification_channels = ir_messages
        .or_else(|| agent_ir.get("notification_channels"))
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    // ================================================================
    // Step 6: Build AgentIR-compatible last_design_result
    // ================================================================
    let design_result = serde_json::json!({
        "suggested_tools": tool_names,
        "suggested_connectors": agent_ir.get("required_connectors").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "suggested_triggers": agent_ir.get("triggers").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "structured_prompt": agent_ir.get("structured_prompt").cloned(),
        "full_prompt_markdown": agent_ir.get("system_prompt").and_then(|v| v.as_str()),
        "suggested_event_subscriptions": agent_ir.get("events").cloned(),
        "suggested_notification_channels": ir_messages.cloned(),
    });

    // ================================================================
    // Step 7: Build DesignContextData-format design_context
    // ================================================================
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

    // ================================================================
    // Update persona with all enriched data
    // ================================================================
    let persona_update = UpdatePersonaInput {
        name: ir_name.map(|s| s.to_string()),
        description: ir_description.map(|s| Some(s.to_string())),
        system_prompt: ir_system_prompt.map(|s| s.to_string()),
        structured_prompt: ir_structured_prompt.map(|v| Some(serde_json::to_string(v).unwrap_or_default())),
        icon: ir_icon.map(|s| Some(s.to_string())),
        color: ir_color.map(|s| Some(s.to_string())),
        enabled: Some(true),
        notification_channels,
        design_context: Some(Some(serde_json::to_string(&design_context).unwrap_or_default())),
        last_design_result: Some(Some(serde_json::to_string(&design_result).unwrap_or_default())),
        ..Default::default()
    };

    if let Err(e) = persona_repo::update(&state.db, &persona_id, persona_update) {
        entity_errors.push(serde_json::json!({"entity_type": "persona", "entity_name": ir_name.unwrap_or("persona"), "error": e.to_string()}));
    }

    // ================================================================
    // Identify connectors needing credential setup
    // ================================================================
    if let Some(connectors) = agent_ir.get("required_connectors").and_then(|v| v.as_array()) {
        for conn in connectors {
            if !conn.get("has_credential").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Some(name) = conn.get("name").and_then(|v| v.as_str()) {
                    connectors_needing_setup.push(name.to_string());
                }
            }
        }
    }

    // ================================================================
    // Transition to Promoted
    // ================================================================
    build_session_repo::update(
        &state.db,
        &session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Promoted.as_str().to_string()),
            ..Default::default()
        },
    )?;

    Ok(serde_json::json!({
        "persona": { "id": persona_id },
        "triggers_created": triggers_created,
        "tools_created": tools_created,
        "subscriptions_created": subscriptions_created,
        "connectors_needing_setup": connectors_needing_setup,
        "entity_errors": entity_errors,
    }))
}
