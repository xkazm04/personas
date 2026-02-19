use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::repos::{connectors as connector_repo, personas as persona_repo, tools as tool_repo};
use crate::engine::design;
use crate::engine::prompt;
use crate::error::AppError;
use crate::AppState;

// ── Event payloads ──────────────────────────────────────────────

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
}

// ── Commands ────────────────────────────────────────────────────

/// Shared setup for design commands: generates a design ID, sets it as active,
/// and spawns `run_design_analysis`.
fn spawn_design_run(
    state: &AppState,
    app: tauri::AppHandle,
    persona_id: &str,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    tool_names: Vec<String>,
    connector_names: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    let design_id = uuid::Uuid::new_v4().to_string();
    let pool = state.db.clone();
    let persona_id_owned = persona_id.to_string();
    let design_id_clone = design_id.clone();
    let active_design_id = state.active_design_id.clone();

    {
        let mut guard = state.active_design_id.lock().unwrap();
        *guard = Some(design_id.clone());
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
            active_design_id,
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
) -> Result<serde_json::Value, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    let design_prompt = design::build_design_prompt(
        &persona,
        &tools,
        &connectors,
        &instruction,
        persona.design_context.as_deref(),
        persona.last_design_result.as_deref(),
    );

    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let cli_args = prompt::build_cli_args(&persona, &model_profile);
    let tool_names = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names = connectors.iter().map(|c| c.name.clone()).collect();

    spawn_design_run(&state, app, &persona_id, design_prompt, cli_args, tool_names, connector_names)
}

#[tauri::command]
pub async fn refine_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    feedback: String,
) -> Result<serde_json::Value, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    let last_result = persona.last_design_result.clone().ok_or_else(|| {
        AppError::Validation("No existing design to refine".into())
    })?;

    let refinement_prompt = design::build_refinement_prompt(
        &last_result,
        &feedback,
        persona.design_context.as_deref(),
    );

    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let cli_args = prompt::build_cli_args(&persona, &model_profile);
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;
    let tool_names = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names = connectors.iter().map(|c| c.name.clone()).collect();

    spawn_design_run(&state, app, &persona_id, refinement_prompt, cli_args, tool_names, connector_names)
}

#[tauri::command]
pub fn test_design_feasibility(
    state: State<'_, Arc<AppState>>,
    design_result: String,
) -> Result<serde_json::Value, AppError> {
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
) -> Result<(), AppError> {
    let mut guard = state.active_design_id.lock().unwrap();
    *guard = None;
    Ok(())
}

// ── Design analysis runner ──────────────────────────────────────

struct DesignRunParams {
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    persona_id: String,
    design_id: String,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    tool_names: Vec<String>,
    connector_names: Vec<String>,
    active_design_id: Arc<Mutex<Option<String>>>,
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
        active_design_id,
    } = params;
    // Emit analyzing status
    let _ = app.emit(
        "design-status",
        DesignStatusEvent {
            design_id: design_id.clone(),
            status: "analyzing".into(),
            result: None,
            error: None,
        },
    );

    // Spawn Claude CLI process (same pattern as runner.rs)
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .to_string()
            } else {
                format!("Failed to spawn Claude CLI: {}", e)
            };
            let _ = app.emit(
                "design-status",
                DesignStatusEvent {
                    design_id,
                    status: "failed".into(),
                    result: None,
                    error: Some(error_msg),
                },
            );
            return;
        }
    };

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        let _ = stdin.write_all(&prompt_bytes).await;
        let _ = stdin.shutdown().await;
    }

    // Read stdout line by line, emit design-output events
    let stdout = child.stdout.take().expect("stdout was piped");
    let mut reader = BufReader::new(stdout).lines();
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
                    "design-output",
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

    // Wait for process
    let _ = child.wait().await;

    if stream_result.is_err() {
        let _ = child.kill().await;
        let _ = app.emit(
            "design-status",
            DesignStatusEvent {
                design_id,
                status: "failed".into(),
                result: None,
                error: Some("Design analysis timed out after 10 minutes".into()),
            },
        );
        return;
    }

    // Check if this analysis was cancelled before persisting
    let is_cancelled = {
        let guard = active_design_id.lock().unwrap();
        guard.as_deref() != Some(&design_id)
    };

    if is_cancelled {
        tracing::info!(design_id = %design_id, "Design analysis cancelled, skipping DB write");
        return;
    }

    // Extract design result from output
    match design::extract_design_result(&full_output) {
        Some(mut result) => {
            // Attach feasibility check
            let feasibility = design::check_feasibility(
                &result.to_string(),
                &tool_names,
                &connector_names,
            );
            if let Some(obj) = result.as_object_mut() {
                obj.insert(
                    "feasibility".into(),
                    json!({
                        "confirmed_capabilities": feasibility.confirmed_capabilities,
                        "issues": feasibility.issues,
                        "overall_feasibility": feasibility.overall,
                    }),
                );
            }

            // Save to DB, handling errors
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
                let _ = app.emit(
                    "design-status",
                    DesignStatusEvent {
                        design_id,
                        status: "failed".into(),
                        result: Some(result),
                        error: Some(format!("Design completed but failed to save: {e}")),
                    },
                );
                return;
            }

            // Clear active design ID on successful completion
            {
                let mut guard = active_design_id.lock().unwrap();
                if guard.as_deref() == Some(&design_id) {
                    *guard = None;
                }
            }

            let _ = app.emit(
                "design-status",
                DesignStatusEvent {
                    design_id,
                    status: "completed".into(),
                    result: Some(result),
                    error: None,
                },
            );
        }
        None => {
            // Clear active design ID on failure too
            {
                let mut guard = active_design_id.lock().unwrap();
                if guard.as_deref() == Some(&design_id) {
                    *guard = None;
                }
            }

            let _ = app.emit(
                "design-status",
                DesignStatusEvent {
                    design_id,
                    status: "failed".into(),
                    result: None,
                    error: Some("Failed to extract design result from Claude output".into()),
                },
            );
        }
    }
}

/// Extract display-friendly text from a Claude stream-json line.
pub(crate) fn extract_display_text(line: &str) -> Option<String> {
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
        // System init
        if val.get("type").and_then(|t| t.as_str()) == Some("system") {
            return Some("[System] Design analysis started...".into());
        }
        None
    } else {
        // Plain text line
        Some(line.to_string())
    }
}
