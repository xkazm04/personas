use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::AsyncBufReadExt;

use crate::db::repos::core::design_conversations as conv_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{connectors as connector_repo, tools as tool_repo};
use crate::engine;
use crate::engine::compiler::{self, CompilationInput, ParseOutcome};
use crate::engine::design;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::ActiveProcessRegistry;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// -- Event payloads ----------------------------------------------

#[derive(Clone, Serialize)]
struct DesignOutputEvent {
    design_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct DesignStatusEvent {
    design_id: String,
    status: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
    question: Option<serde_json::Value>,
}

// -- Commands ----------------------------------------------------

/// Shared setup for design commands: generates a design ID, sets it as active,
/// and spawns `run_design_analysis`.
#[allow(clippy::too_many_arguments)]
fn spawn_design_run(
    state: &AppState,
    app: tauri::AppHandle,
    persona_id: &str,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    tool_names: Vec<String>,
    connector_names: Vec<String>,
    client_design_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let design_id = client_design_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let pool = state.db.clone();
    let persona_id_owned = persona_id.to_string();
    let design_id_clone = design_id.clone();
    let registry = state.process_registry.clone();

    // Atomically begin the new run: cancels the previous run's token, takes the
    // old PID, and returns a fresh cancellation token for this run.  This fixes
    // the race where a completed-but-not-yet-persisted run sees its registry ID
    // overwritten by a newer run and silently discards a valid result.
    let (old_pid, cancelled) = registry.begin_run("design", design_id.clone());
    if let Some(pid) = old_pid {
        tracing::info!(pid = pid, "Killing previous design analysis before starting new one");
        engine::kill_process(pid);
    }

    tokio::spawn(async move {
        run_design_analysis(DesignRunParams {
            app,
            pool,
            persona_id: persona_id_owned,
            design_id: design_id_clone,
            prompt_text,
            cli_args,
            tool_names,
            connector_names,
            registry,
            cancelled,
        })
        .await;
    });

    Ok(json!({ "design_id": design_id }))
}

#[tauri::command]
pub async fn start_design_analysis(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    instruction: String,
    design_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    // Stage 1: Prompt Assembly via PersonaCompiler
    let design_files = persona.design_files_for_prompt();
    let compilation_input = CompilationInput {
        persona: &persona,
        tools: &tools,
        connectors: &connectors,
        instruction: &instruction,
        design_context: design_files.as_deref(),
        existing_result: persona.last_design_result.as_deref(),
        conversation_history: None,
    };
    let design_prompt = compiler::assemble_prompt(&compilation_input);

    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let cli_args = prompt::build_cli_args(Some(&persona), model_profile.as_ref());
    let tool_names = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names = connectors.iter().map(|c| c.name.clone()).collect();

    spawn_design_run(&state, app, &persona_id, design_prompt, cli_args, tool_names, connector_names, design_id)
}

#[tauri::command]
pub async fn refine_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    feedback: String,
    current_result: Option<String>,
    design_id: Option<String>,
    conversation_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // persona.last_design_result is the canonical source of truth (written on
    // every successful analysis in run_design_analysis).  The caller may supply
    // a preview override via `current_result` for the rare case where the
    // frontend preview state is newer than the DB (e.g. store hasn't refreshed).
    let last_result = current_result
        .or_else(|| persona.last_design_result.clone())
        .ok_or_else(|| AppError::Validation("No existing design to refine".into()))?;

    // Load conversation history if a conversation_id is provided
    let conversation_history = conversation_id.as_deref().and_then(|cid| {
        conv_repo::get_by_id(&state.db, cid)
            .ok()
            .map(|c| c.messages)
    });

    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    // Stage 1: Prompt Assembly via PersonaCompiler (recompilation with constraints)
    let design_files = persona.design_files_for_prompt();
    let compilation_input = CompilationInput {
        persona: &persona,
        tools: &tools,
        connectors: &connectors,
        instruction: &feedback,
        design_context: design_files.as_deref(),
        existing_result: Some(&last_result),
        conversation_history: conversation_history.as_deref(),
    };
    let refinement_prompt = compiler::assemble_prompt(&compilation_input);

    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let cli_args = prompt::build_cli_args(Some(&persona), model_profile.as_ref());
    let tool_names = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names = connectors.iter().map(|c| c.name.clone()).collect();

    spawn_design_run(&state, app, &persona_id, refinement_prompt, cli_args, tool_names, connector_names, design_id)
}

#[tauri::command]
pub fn test_design_feasibility(
    state: State<'_, Arc<AppState>>,
    design_result: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    let tool_names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names: Vec<String> = connectors.iter().map(|c| c.name.clone()).collect();

    let result = design::check_feasibility(&design_result, &tool_names, &connector_names);
    Ok(serde_json::to_value(result).unwrap_or_default())
}

#[tauri::command]
pub fn cancel_design_analysis(
    state: State<'_, Arc<AppState>>,
    design_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    if let Some(id) = design_id {
        state.process_registry.cancel_run("design", &id);
        if let Some(pid) = state.process_registry.take_run_pid("design", &id) {
            tracing::info!(pid = pid, design_id = %id, "Killing design analysis CLI child process (scoped)");
            engine::kill_process(pid);
        }
    } else if let Some(pid) = state.process_registry.cancel("design") {
        tracing::info!(pid = pid, "Killing design analysis CLI child process");
        engine::kill_process(pid);
    }

    Ok(())
}

/// Compile a plain-language intent into a complete persona configuration.
///
/// Uses the same streaming infrastructure as `start_design_analysis` but with an
/// extended prompt that also generates use cases, model recommendation, and test scenarios.
#[tauri::command]
pub async fn compile_from_intent(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    intent: String,
    design_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    // Build the intent compilation prompt (extended output schema)
    let intent_prompt = engine::intent_compiler::build_intent_prompt(
        &persona, &tools, &connectors, &intent,
    );

    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let cli_args = prompt::build_cli_args(Some(&persona), model_profile.as_ref());
    let tool_names = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names = connectors.iter().map(|c| c.name.clone()).collect();

    spawn_design_run(
        &state, app, &persona_id, intent_prompt, cli_args,
        tool_names, connector_names, design_id,
    )
}

fn emit_design_status(
    app: &tauri::AppHandle,
    design_id: &str,
    status: &str,
    result: Option<serde_json::Value>,
    error: Option<String>,
    question: Option<serde_json::Value>,
) {
    let _ = app.emit(
        event_name::DESIGN_STATUS,
        DesignStatusEvent {
            design_id: design_id.to_string(),
            status: status.into(),
            result,
            error,
            question,
        },
    );
}

// -- Design analysis runner --------------------------------------

struct DesignRunParams {
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    persona_id: String,
    design_id: String,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    tool_names: Vec<String>,
    connector_names: Vec<String>,
    registry: Arc<ActiveProcessRegistry>,
    /// Per-run cancellation token — set to `true` when this run is superseded
    /// by a newer run or explicitly cancelled by the user.
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

async fn run_design_analysis(params: DesignRunParams) {
    let DesignRunParams {
        app,
        pool,
        persona_id,
        design_id,
        prompt_text,
        cli_args,
        tool_names,
        connector_names,
        registry,
        cancelled,
    } = params;
    // Emit analyzing status
    engine::process_activity::emit_process_activity(&app, "design", "started", Some(&design_id), None);
    emit_design_status(&app, &design_id, "analyzing", None, None, None);

    // Spawn Claude CLI process via shared CliProcessDriver
    let mut driver = match engine::cli_process::CliProcessDriver::spawn_cwd(&cli_args) {
        Ok(d) => d,
        Err(e) => {
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .to_string()
            } else {
                format!("Failed to spawn Claude CLI: {e}")
            };
            engine::process_activity::emit_process_activity(&app, "design", "failed", Some(&design_id), None);
            emit_design_status(&app, &design_id, "failed", None, Some(error_msg), None);
            return;
        }
    };

    // Register child PID so cancel can kill it
    if let Some(pid) = driver.pid() {
        registry.set_pid("design", pid);
    }

    // Write prompt to stdin and close
    driver.write_stdin(prompt_text.as_bytes()).await;

    // Read stdout line by line, emit design-output events
    let mut reader = match driver.take_stdout_reader().map(|r| r.lines()) {
        Some(r) => r,
        None => {
            emit_design_status(&app, &design_id, "failed", None, Some("Failed to capture stdout from CLI process".to_string()), None);
            return;
        }
    };
    let mut full_output = String::new();

    let timeout_duration = std::time::Duration::from_secs(600); // 10 min
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            // Try to extract display text from stream-json format
            let display_line = extract_display_text(&line);
            if let Some(ref text) = display_line {
                let _ = app.emit(
                    event_name::DESIGN_OUTPUT,
                    DesignOutputEvent {
                        design_id: design_id.clone(),
                        line: text.clone(),
                    },
                );
            }

            full_output.push_str(&line);
            full_output.push('\n');
        }
    })
    .await;

    // On timeout, kill the process BEFORE waiting -- otherwise wait() blocks forever
    if stream_result.is_err() {
        driver.kill().await;
        registry.clear_pid("design");
        emit_design_status(&app, &design_id, "failed", None, Some("Design analysis timed out after 10 minutes".into()), None);
        return;
    }

    // Normal exit -- wait for process and clear the PID
    let _ = driver.wait().await;
    registry.clear_pid("design");

    // Check if this run was explicitly cancelled (by user or by a newer run that
    // killed our process).  Uses the per-run AtomicBool token instead of comparing
    // registry IDs, which avoids the race where a newer run overwrites the ID
    // before this run can check it — silently discarding a valid completed result.
    if cancelled.load(std::sync::atomic::Ordering::Acquire) {
        tracing::info!(design_id = %design_id, "Design analysis cancelled, skipping DB write");
        return;
    }

    // Stage 3: Parse LLM output via PersonaCompiler
    match compiler::parse_output(&full_output) {
        ParseOutcome::Question(question) => {
            tracing::info!(design_id = %design_id, "Design analysis paused -- question emitted");
            emit_design_status(&app, &design_id, "awaiting-input", None, None, Some(question));
        }
        ParseOutcome::Result(mut result) => {
            // Stage 4: Feasibility Check via PersonaCompiler
            compiler::run_feasibility(&mut result, &tool_names, &connector_names);

            // Stage 5: Persist via PersonaCompiler
            let result_json = result.to_string();
            if let Err(e) = persona_repo::update(
                &pool,
                &persona_id,
                crate::db::models::UpdatePersonaInput {
                    last_design_result: Some(Some(result_json)),
                    ..Default::default()
                },
            ) {
                tracing::error!(design_id = %design_id, error = %e, "Failed to save design result to DB");
                emit_design_status(&app, &design_id, "failed", Some(result), Some(format!("Design completed but failed to save: {e}")), None);
                return;
            }

            registry.clear_id_if("design", &design_id);
            engine::process_activity::emit_process_activity(&app, "design", "completed", Some(&design_id), None);
            emit_design_status(&app, &design_id, "completed", Some(result), None, None);
        }
        ParseOutcome::Failed => {
            registry.clear_id_if("design", &design_id);
            engine::process_activity::emit_process_activity(&app, "design", "failed", Some(&design_id), None);
            emit_design_status(&app, &design_id, "failed", None, Some("Failed to extract design result from Claude output".into()), None);
        }
    }
}

/// Extract display-friendly text from a Claude stream-json line.
pub fn extract_display_text(line: &str) -> Option<String> {
    // Try parsing as stream-json
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
        // Assistant text message
        if let Some(content) = val.get("content") {
            if let Some(arr) = content.as_array() {
                for item in arr {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            return Some(text.to_string());
                        }
                    }
                }
            }
        }
        // Result message with text
        if let Some(result) = val.get("result") {
            if let Some(text) = result.as_str() {
                return Some(text.to_string());
            }
        }
        // System event (only surface init once-friendly line)
        if val.get("type").and_then(|t| t.as_str()) == Some("system") {
            if val.get("subtype").and_then(|s| s.as_str()) == Some("init") {
                return Some("[System] Claude stream initialized.".into());
            }
            return None;
        }
        None
    } else {
        // Plain text line
        Some(line.to_string())
    }
}

// -- Preview prompt ---------------------------------------------

/// Return the fully assembled prompt markdown for a persona, exactly as the
/// runtime engine would build it.  Accepts an optional `structured_prompt_json`
/// override so the editor can preview unsaved drafts without persisting first.
#[tauri::command]
pub fn preview_prompt(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    structured_prompt_json: Option<String>,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let mut persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // Apply the draft override when provided
    if let Some(ref sp_json) = structured_prompt_json {
        persona.structured_prompt = Some(sp_json.clone());
    }

    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    Ok(prompt::assemble_prompt(&persona, &tools, None, None, None, #[cfg(feature = "desktop")] None))
}
