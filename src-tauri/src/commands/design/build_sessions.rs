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
use crate::db::repos::resources::connectors as connector_repo;
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
    promote_build_draft_inner(&state, session_id, persona_id).await
}

/// Inner promote logic — callable from both Tauri command and test automation.
pub async fn promote_build_draft_inner(
    state: &Arc<AppState>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
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
    // Step 2: Create tools with schema inference
    // ================================================================
    let mut tool_names: Vec<String> = Vec::new();

    if let Some(tools) = agent_ir.get("tools").or_else(|| agent_ir.get("suggested_tools")).and_then(|v| v.as_array()) {
        for tool_json in tools {
            // Handle both string tool names ("web_search") and object definitions ({name, ...})
            let name = if let Some(s) = tool_json.as_str() {
                s.to_string()
            } else {
                tool_json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string()
            };
            if name.is_empty() { continue; }

            // Normalize PascalCase/CamelCase to snake_case: "WebSearch" → "web_search"
            let normalized: String = name.chars().enumerate().fold(String::new(), |mut acc, (i, c)| {
                if c.is_uppercase() && i > 0 { acc.push('_'); }
                acc.push(c.to_ascii_lowercase());
                acc
            });

            tool_names.push(name.clone());

            // Try to find an existing tool definition by name (case-insensitive, try both forms)
            let existing_def = tool_repo::get_definition_by_name(&state.db, &normalized)
                .ok().flatten()
                .or_else(|| tool_repo::get_definition_by_name(&state.db, &name).ok().flatten());

            if let Some(def) = existing_def {
                // Existing (builtin or custom) tool found — just assign it
                if let Err(e) = tool_repo::assign_tool(&state.db, &persona_id, &def.id, None) {
                    entity_errors.push(serde_json::json!({"entity_type": "tool_assignment", "entity_name": name, "error": e.to_string()}));
                } else {
                    tools_created += 1;
                }
                continue;
            }

            // No existing definition — create a new one
            let (category, description, input_schema, output_schema, req_cred, impl_guide) = if tool_json.is_object() {
                // Full object tool with schema info
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
                // String-only tool — create minimal definition, infer credential type from name
                let inferred_cred = {
                    let lower = normalized.to_lowercase();
                    let connectors = connector_repo::get_all(&state.db).unwrap_or_default();
                    connectors.iter().find_map(|c| {
                        let cn = c.name.to_lowercase();
                        if lower.contains(&cn) || cn.contains(&lower) {
                            Some(c.name.clone())
                        } else {
                            None
                        }
                    })
                };
                (
                    "api".to_string(),
                    format!("Auto-created from build: {}", name),
                    Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()),
                    Some(r#"{"type":"object","properties":{},"additionalProperties":true}"#.to_string()),
                    inferred_cred, None,
                )
            };

            // Infer requires_credential_type from tool name if not set by the LLM.
            // Match against known connector names so credential resolution works at runtime.
            let effective_req_cred = req_cred.or_else(|| {
                let lower = normalized.to_lowercase();
                let connectors = connector_repo::get_all(&state.db).unwrap_or_default();
                connectors.iter().find_map(|c| {
                    let cn = c.name.to_lowercase();
                    if lower.contains(&cn) || cn.contains(&lower) {
                        Some(c.name.clone())
                    } else {
                        None
                    }
                })
            });

            let input = CreateToolDefinitionInput {
                name: normalized.clone(),
                category,
                description,
                script_path: String::new(),
                input_schema,
                output_schema,
                requires_credential_type: effective_req_cred,
                implementation_guide: impl_guide,
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
                    // UNIQUE constraint — tool name may already exist; try to find and assign
                    if let Ok(Some(existing)) = tool_repo::get_definition_by_name(&state.db, &normalized) {
                        if let Err(ae) = tool_repo::assign_tool(&state.db, &persona_id, &existing.id, None) {
                            entity_errors.push(serde_json::json!({"entity_type": "tool_assignment", "entity_name": name, "error": ae.to_string()}));
                        } else {
                            tools_created += 1;
                        }
                    } else {
                        entity_errors.push(serde_json::json!({"entity_type": "tool", "entity_name": name, "error": e.to_string()}));
                    }
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
    // notification_channels must be a JSON array of {type, config} objects.
    // ir_messages is the raw "messages" dimension (an object like {"channels":[...], "items":[...]}),
    // NOT a valid notification_channels array.  Extract the inner "channels" sub-array
    // if present, otherwise try agent_ir.notification_channels directly.
    let notification_channels = {
        let from_messages = ir_messages
            .and_then(|v| v.get("channels"))
            .filter(|v| v.is_array());
        let from_ir = agent_ir.get("notification_channels")
            .filter(|v| v.is_array());
        from_messages
            .or(from_ir)
            .map(|v| serde_json::to_string(v).unwrap_or_default())
    };

    // ================================================================
    // Step 6: Build AgentIR-compatible last_design_result
    // ================================================================
    // Build connectors list from tools + service_flow (templates may not have suggested_connectors)
    let connectors = agent_ir.get("required_connectors")
        .or_else(|| agent_ir.get("suggested_connectors"))
        .cloned()
        .unwrap_or_else(|| {
            // Derive from service_flow if available
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

    match persona_repo::update(&state.db, &persona_id, persona_update) {
        Ok(updated) => {
            tracing::info!(
                persona_id = %persona_id,
                name = %updated.name,
                prompt_is_default = updated.system_prompt == "You are a helpful AI assistant.",
                has_structured_prompt = updated.structured_prompt.is_some(),
                "promote_build_draft: persona update succeeded"
            );
        }
        Err(e) => {
            tracing::error!(
                persona_id = %persona_id,
                error = %e,
                "promote_build_draft: persona update FAILED"
            );
            entity_errors.push(serde_json::json!({"entity_type": "persona", "entity_name": ir_name.unwrap_or("persona"), "error": e.to_string()}));
        }
    }

    // ================================================================
    // Auto-create full persona version snapshot on promote
    // ================================================================
    {
        use crate::db::repos::execution::metrics::{self as metrics_repo, VersionSnapshotFields};
        let sp_str = ir_structured_prompt.and_then(|v| serde_json::to_string(v).ok());
        let design_ctx_str = serde_json::to_string(&design_context).ok();
        let design_result_str = serde_json::to_string(&design_result).ok();
        let _ = metrics_repo::create_prompt_version_with_snapshot(
            &state.db,
            &persona_id,
            sp_str,
            ir_system_prompt.map(|s| s.to_string()),
            Some("Promoted from PersonaMatrix build".to_string()),
            VersionSnapshotFields {
                design_context: design_ctx_str,
                last_design_result: design_result_str,
                resolved_cells: Some(session.resolved_cells.clone()),
                icon: ir_icon.map(|s| s.to_string()),
                color: ir_color.map(|s| s.to_string()),
            },
        );
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
