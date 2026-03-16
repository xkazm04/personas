use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::db::models::{
    BuildEvent, BuildPhase, PersistedBuildSession, UserAnswer, UpdateBuildSession,
    CreateToolDefinitionInput, CreateTriggerInput, UpdatePersonaInput,
};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::build_session as build_session_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Start a new build session for a persona. Returns the session ID.
/// Events are streamed back via the Channel parameter.
/// Optional workflow_json + parser_result_json enable workflow import mode.
#[tauri::command]
pub async fn start_build_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Channel<BuildEvent>,
    persona_id: String,
    intent: String,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
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
/// Reads the agent_ir from the build session, updates the persona with enriched
/// prompt data, creates tool definitions and assigns them, creates triggers,
/// and transitions the session to the Promoted phase.
#[tauri::command]
pub async fn promote_build_draft(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    // Load session
    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    // Parse agent_ir
    let agent_ir: serde_json::Value = session
        .agent_ir
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or_else(|| AppError::Validation("Build session has no agent_ir".to_string()))?;

    let mut tools_created = 0u32;
    let mut triggers_created = 0u32;
    let mut entity_errors: Vec<serde_json::Value> = Vec::new();
    let mut connectors_needing_setup: Vec<String> = Vec::new();

    // -- Update persona with enriched data --
    let ir_name = agent_ir.get("name").and_then(|v| v.as_str());
    let ir_description = agent_ir.get("description").and_then(|v| v.as_str());
    let ir_system_prompt = agent_ir.get("system_prompt").and_then(|v| v.as_str());
    let ir_structured_prompt = agent_ir.get("structured_prompt");
    let ir_icon = agent_ir.get("icon").and_then(|v| v.as_str());
    let ir_color = agent_ir.get("color").and_then(|v| v.as_str());

    let design_context = serde_json::json!({
        "summary": agent_ir.get("design_context").and_then(|d| d.get("summary")).and_then(|v| v.as_str()).unwrap_or(""),
        "use_cases": agent_ir.get("use_cases").cloned().unwrap_or(serde_json::Value::Array(vec![])),
    });

    // Build the update input for the persona
    let persona_update = UpdatePersonaInput {
        name: ir_name.map(|s| s.to_string()),
        description: ir_description.map(|s| Some(s.to_string())),
        system_prompt: ir_system_prompt.map(|s| s.to_string()),
        structured_prompt: ir_structured_prompt.map(|v| Some(serde_json::to_string(v).unwrap_or_default())),
        icon: ir_icon.map(|s| Some(s.to_string())),
        color: ir_color.map(|s| Some(s.to_string())),
        enabled: Some(true),
        design_context: Some(Some(serde_json::to_string(&design_context).unwrap_or_default())),
        last_design_result: Some(session.agent_ir.clone()),
        ..Default::default()
    };

    if let Err(e) = persona_repo::update(&state.db, &persona_id, persona_update) {
        entity_errors.push(serde_json::json!({
            "entity_type": "persona",
            "entity_name": ir_name.unwrap_or("persona"),
            "error": e.to_string(),
        }));
    }

    // -- Create tools from agent_ir.tools[] --
    if let Some(tools) = agent_ir.get("tools").and_then(|v| v.as_array()) {
        for tool_json in tools {
            let name = tool_json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if name.is_empty() { continue; }

            let input = CreateToolDefinitionInput {
                name: name.clone(),
                category: tool_json.get("category").and_then(|v| v.as_str()).unwrap_or("api").to_string(),
                description: tool_json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                script_path: String::new(),
                input_schema: None,
                output_schema: None,
                requires_credential_type: tool_json.get("requires_credential_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                implementation_guide: tool_json.get("implementation_guide").and_then(|v| v.as_str()).map(|s| s.to_string()),
                is_builtin: Some(false),
            };

            match tool_repo::create_definition(&state.db, input) {
                Ok(def) => {
                    // Assign tool to persona
                    if let Err(e) = tool_repo::assign_tool(&state.db, &persona_id, &def.id, None) {
                        entity_errors.push(serde_json::json!({
                            "entity_type": "tool_assignment",
                            "entity_name": name,
                            "error": e.to_string(),
                        }));
                    } else {
                        tools_created += 1;
                    }
                }
                Err(e) => {
                    entity_errors.push(serde_json::json!({
                        "entity_type": "tool",
                        "entity_name": name,
                        "error": e.to_string(),
                    }));
                }
            }
        }
    }

    // -- Create triggers from agent_ir.triggers[] --
    if let Some(triggers) = agent_ir.get("triggers").and_then(|v| v.as_array()) {
        for trigger_json in triggers {
            let trigger_type = trigger_json.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("manual").to_string();
            let config = trigger_json.get("config").map(|v| serde_json::to_string(v).unwrap_or_default());
            let description = trigger_json.get("description").and_then(|v| v.as_str()).unwrap_or("");

            let input = CreateTriggerInput {
                persona_id: persona_id.clone(),
                trigger_type: trigger_type.clone(),
                config,
                enabled: Some(true),
                use_case_id: None,
            };

            match trigger_repo::create(&state.db, input) {
                Ok(_) => triggers_created += 1,
                Err(e) => {
                    entity_errors.push(serde_json::json!({
                        "entity_type": "trigger",
                        "entity_name": format!("{} - {}", trigger_type, description),
                        "error": e.to_string(),
                    }));
                }
            }
        }
    }

    // -- Identify connectors needing credential setup --
    if let Some(connectors) = agent_ir.get("required_connectors").and_then(|v| v.as_array()) {
        for conn in connectors {
            let has_cred = conn.get("has_credential").and_then(|v| v.as_bool()).unwrap_or(false);
            if !has_cred {
                if let Some(name) = conn.get("name").and_then(|v| v.as_str()) {
                    connectors_needing_setup.push(name.to_string());
                }
            }
        }
    }

    // -- Transition to Promoted --
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
        "connectors_needing_setup": connectors_needing_setup,
        "entity_errors": entity_errors,
    }))
}
