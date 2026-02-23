use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::repos::resources::connectors as connector_repo;
use crate::engine::credential_design;
use crate::engine::healthcheck::{resolve_template, validate_healthcheck_url};
use crate::engine::parser::parse_stream_line;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::AppState;

use super::shared::build_credential_task_cli_args;

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_credential_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    instruction: String,
) -> Result<serde_json::Value, AppError> {
    let connectors = connector_repo::get_all(&state.db)?;

    let design_prompt = credential_design::build_credential_design_prompt(
        &instruction,
        &connectors,
    );

    let cli_args = build_credential_task_cli_args();

    let design_id = uuid::Uuid::new_v4().to_string();
    let active_id = state.active_credential_design_id.clone();
    let active_child_pid = state.active_credential_design_child_pid.clone();

    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(design_id.clone());
    }

    let design_id_clone = design_id.clone();

    tokio::spawn(async move {
        run_credential_task(CredentialTaskParams {
            app,
            task_id: design_id_clone,
            prompt_text: design_prompt,
            cli_args,
            active_id,
            active_child_pid: Some(active_child_pid),
            messages: DESIGN_MESSAGES,
            extractor: credential_design::extract_credential_design_result,
        })
        .await;
    });

    Ok(json!({ "design_id": design_id }))
}

#[tauri::command]
pub fn cancel_credential_design(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;

    // Kill the CLI child process to stop API credit consumption immediately.
    let pid = state.active_credential_design_child_pid.lock().unwrap().take();
    if let Some(pid) = pid {
        tracing::info!(pid = pid, "Killing credential design CLI child process");
        crate::engine::kill_process(pid);
    }

    Ok(())
}

#[tauri::command]
pub async fn test_credential_design_healthcheck(
    _state: State<'_, Arc<AppState>>,
    instruction: String,
    connector: serde_json::Value,
    field_values: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let values_map: HashMap<String, String> = serde_json::from_value(field_values)
        .map_err(|e| AppError::Validation(format!("Invalid field values: {}", e)))?;

    let field_keys: Vec<String> = values_map.keys().cloned().collect();
    let prompt_text = credential_design::build_credential_healthcheck_prompt(
        &instruction,
        &connector,
        &field_keys,
    );

    let cli_args = build_credential_task_cli_args();
    let output_text = run_claude_prompt(prompt_text, &cli_args, 300, "Claude produced no output for healthcheck generation")
        .await
        .map_err(AppError::Internal)?;

    let config = credential_design::extract_healthcheck_config_result(&output_text)
        .ok_or_else(|| AppError::Internal("Failed to extract healthcheck config from Claude output".into()))?;

    if config
        .get("skip")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let reason = config
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("No reliable test endpoint available");
        return Ok(json!({
            "success": false,
            "message": format!("Claude skipped automatic healthcheck: {}", reason),
            "healthcheck_config": config,
        }));
    }

    let endpoint = config
        .get("endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("Claude did not provide a valid healthcheck endpoint".into()))?;

    let method = config
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let expected_status = config
        .get("expected_status")
        .and_then(|v| v.as_u64())
        .map(|v| v as u16);

    let resolved_endpoint = resolve_template(endpoint, &values_map);

    // Validate the resolved URL to prevent SSRF via AI-generated endpoints
    validate_healthcheck_url(&resolved_endpoint)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {}", e)))?;

    let mut request = match method.as_str() {
        "POST" => client.post(&resolved_endpoint),
        "PUT" => client.put(&resolved_endpoint),
        "PATCH" => client.patch(&resolved_endpoint),
        _ => client.get(&resolved_endpoint),
    };

    if let Some(headers_obj) = config.get("headers").and_then(|v| v.as_object()) {
        for (key, val) in headers_obj {
            if let Some(raw) = val.as_str() {
                let resolved = resolve_template(raw, &values_map);
                request = request.header(key, resolved);
            }
        }
    }

    let response = request.send().await;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let success = expected_status.map(|exp| exp == status).unwrap_or(resp.status().is_success());
            let message = if success {
                format!("Claude healthcheck passed (HTTP {})", status)
            } else if let Some(exp) = expected_status {
                format!("Claude healthcheck failed (HTTP {}, expected {})", status, exp)
            } else {
                format!("Claude healthcheck failed (HTTP {})", status)
            };

            Ok(json!({
                "success": success,
                "message": message,
                "healthcheck_config": config,
            }))
        }
        Err(e) => Ok(json!({
            "success": false,
            "message": format!("Claude healthcheck request failed: {}", e),
            "healthcheck_config": config,
        })),
    }
}

// ── Shared credential task runner ────────────────────────────────

/// Try to extract the response text from a stream-json "result" line.
/// The result event has a `result` field containing the full response text.
pub(crate) fn extract_result_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type").and_then(|t| t.as_str()) != Some("result") {
        return None;
    }
    if let Some(text) = value.get("result").and_then(|r| r.as_str()) {
        return Some(text.to_string());
    }
    None
}

/// Progress message labels that differ between credential design and negotiation.
pub(crate) struct CredentialTaskMessages {
    /// Status event name (e.g. "credential-design-status")
    pub status_event: &'static str,
    /// Progress/output event name (e.g. "credential-design-output")
    pub progress_event: &'static str,
    /// ID field name in event payloads (e.g. "design_id", "negotiation_id")
    pub id_field: &'static str,
    /// Initial status value (e.g. "analyzing", "planning")
    pub initial_status: &'static str,
    /// Progress after SystemInit (e.g. "Analyzing service requirements...")
    pub init_progress: &'static str,
    /// Progress on first AssistantText (e.g. "Designing connector structure...")
    pub streaming_progress: &'static str,
    /// Prefix for the Result line (e.g. "Analysis complete", "Plan ready")
    pub complete_prefix: &'static str,
    /// Progress on successful extraction (e.g. "Connector designed successfully")
    pub success_progress: &'static str,
    /// User-facing error when extraction fails
    pub extraction_failed_error: &'static str,
    /// Log label for the task (e.g. "credential_design", "negotiation")
    pub log_label: &'static str,
    /// Timeout in seconds for spawn_claude_and_collect
    pub timeout_secs: u64,
}

/// Parameters for a credential task run.
pub(crate) struct CredentialTaskParams {
    pub app: tauri::AppHandle,
    pub task_id: String,
    pub prompt_text: String,
    pub cli_args: crate::engine::types::CliArgs,
    pub active_id: Arc<Mutex<Option<String>>>,
    pub active_child_pid: Option<Arc<Mutex<Option<u32>>>>,
    pub messages: CredentialTaskMessages,
    pub extractor: fn(&str) -> Option<serde_json::Value>,
}

/// Emit a progress line on the configured progress event channel.
fn emit_task_progress(app: &tauri::AppHandle, event: &str, id_field: &str, task_id: &str, line: &str) {
    let _ = app.emit(event, json!({ id_field: task_id, "line": line }));
}

/// Emit a status update on the configured status event channel.
fn emit_task_status(
    app: &tauri::AppHandle,
    event: &str,
    id_field: &str,
    task_id: &str,
    status: &str,
    result: Option<serde_json::Value>,
    error: Option<String>,
) {
    let _ = app.emit(event, json!({
        id_field: task_id,
        "status": status,
        "result": result,
        "error": error,
    }));
}

/// Generic runner for credential design and negotiation tasks.
///
/// Both flows follow the same lifecycle: emit initial status → spawn Claude →
/// stream progress → check cancellation → extract result → emit final status.
pub(crate) async fn run_credential_task(params: CredentialTaskParams) {
    let CredentialTaskParams {
        app,
        task_id,
        prompt_text,
        cli_args,
        active_id,
        active_child_pid,
        messages,
        extractor,
    } = params;

    emit_task_status(&app, messages.status_event, messages.id_field, &task_id, messages.initial_status, None, None);
    emit_task_progress(&app, messages.progress_event, messages.id_field, &task_id, "Connecting to Claude...");

    let pe = messages.progress_event;
    let idf = messages.id_field;
    let tid = task_id.clone();
    let mut emitted_streaming = false;
    let result = spawn_claude_and_collect(
        &cli_args,
        prompt_text,
        messages.timeout_secs,
        |line_type, _raw_line| match line_type {
            StreamLineType::SystemInit { model, .. } => {
                emit_task_progress(&app, pe, idf, &tid, &format!("Connected ({})", model));
                emit_task_progress(&app, pe, idf, &tid, messages.init_progress);
            }
            StreamLineType::AssistantText { .. } => {
                if !emitted_streaming {
                    emitted_streaming = true;
                    emit_task_progress(&app, pe, idf, &tid, messages.streaming_progress);
                }
            }
            StreamLineType::AssistantToolUse { tool_name, .. } => {
                emit_task_progress(&app, pe, idf, &tid, &format!("Researching: {}", tool_name));
            }
            StreamLineType::Result {
                duration_ms,
                total_cost_usd,
                ..
            } => {
                let mut msg = messages.complete_prefix.to_string();
                if let Some(ms) = duration_ms {
                    let secs = *ms as f64 / 1000.0;
                    msg = format!("{} ({:.1}s", messages.complete_prefix, secs);
                    if let Some(cost) = total_cost_usd {
                        msg.push_str(&format!(", ${:.4}", cost));
                    }
                    msg.push(')');
                }
                emit_task_progress(&app, pe, idf, &tid, &msg);
            }
            _ => {}
        },
        active_child_pid.as_ref(),
    )
    .await;

    // Check if cancelled
    let is_cancelled = {
        let guard = active_id.lock().unwrap();
        guard.as_deref() != Some(&task_id)
    };

    if is_cancelled {
        tracing::info!(task_id = %task_id, label = messages.log_label, "Credential task cancelled");
        return;
    }

    match result {
        Err(error_msg) => {
            tracing::error!(task_id = %task_id, label = messages.log_label, error = %error_msg, "Claude CLI failed");
            emit_task_status(&app, messages.status_event, messages.id_field, &task_id, "failed", None, Some(error_msg));
        }
        Ok(spawn_result) => {
            if !spawn_result.stderr_output.trim().is_empty() {
                tracing::warn!(
                    task_id = %task_id,
                    label = messages.log_label,
                    stderr = %spawn_result.stderr_output.trim(),
                    "Claude CLI stderr output"
                );
            }

            match extractor(&spawn_result.text_output) {
                Some(extracted) => {
                    {
                        let mut guard = active_id.lock().unwrap();
                        if guard.as_deref() == Some(&task_id) {
                            *guard = None;
                        }
                    }
                    emit_task_progress(&app, messages.progress_event, messages.id_field, &task_id, messages.success_progress);
                    emit_task_status(&app, messages.status_event, messages.id_field, &task_id, "completed", Some(extracted), None);
                }
                None => {
                    {
                        let mut guard = active_id.lock().unwrap();
                        if guard.as_deref() == Some(&task_id) {
                            *guard = None;
                        }
                    }
                    tracing::warn!(
                        task_id = %task_id,
                        label = messages.log_label,
                        text_output_len = spawn_result.text_output.len(),
                        "Failed to extract result from Claude text output"
                    );
                    emit_task_status(
                        &app,
                        messages.status_event,
                        messages.id_field,
                        &task_id,
                        "failed",
                        None,
                        Some(messages.extraction_failed_error.into()),
                    );
                }
            }
        }
    }
}

// ── Credential design messages ──────────────────────────────────

const DESIGN_MESSAGES: CredentialTaskMessages = CredentialTaskMessages {
    status_event: "credential-design-status",
    progress_event: "credential-design-output",
    id_field: "design_id",
    initial_status: "analyzing",
    init_progress: "Analyzing service requirements...",
    streaming_progress: "Designing connector structure...",
    complete_prefix: "Analysis complete",
    success_progress: "Connector designed successfully",
    extraction_failed_error: "Failed to extract connector design from Claude output. Try describing the service more specifically.",
    log_label: "credential_design",
    timeout_secs: 600,
};

// ── Shared Claude CLI helper ────────────────────────────────────

/// Result from spawning Claude CLI and collecting output.
pub(crate) struct ClaudeSpawnResult {
    pub(crate) text_output: String,
    pub(crate) stderr_output: String,
}

/// Spawn Claude CLI, pipe prompt to stdin, collect text output from stdout.
///
/// `on_line` is called for each parsed stream-json line, allowing callers to
/// emit progress events or handle line-type-specific logic. Text accumulation
/// (AssistantText, Result, Unknown) is handled internally.
///
/// If `child_pid_out` is provided, the child process PID is stored there so
/// callers can kill the process from a cancel handler.
pub(crate) async fn spawn_claude_and_collect(
    cli_args: &crate::engine::types::CliArgs,
    prompt_text: String,
    timeout_secs: u64,
    mut on_line: impl FnMut(&StreamLineType, &str),
    child_pid_out: Option<&Arc<Mutex<Option<u32>>>>,
) -> Result<ClaudeSpawnResult, String> {
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
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                .to_string()
        } else {
            format!("Failed to spawn Claude CLI: {}", e)
        }
    })?;

    // Register child PID so cancel handlers can kill the process immediately
    if let Some(pid_ref) = child_pid_out {
        if let Some(pid) = child.id() {
            *pid_ref.lock().unwrap() = Some(pid);
        }
    }

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt_text.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let stderr = child.stderr.take().ok_or_else(|| "Missing stderr pipe".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr);
        let mut stderr_buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut stderr_buf).await;
        stderr_buf
    });

    let stdout = child.stdout.take().ok_or_else(|| "Missing stdout pipe".to_string())?;
    let mut reader = BufReader::new(stdout).lines();
    let mut text_output = String::new();

    let timeout_duration = std::time::Duration::from_secs(timeout_secs);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            let (line_type, _) = parse_stream_line(&line);
            on_line(&line_type, &line);

            match &line_type {
                StreamLineType::AssistantText { text } => {
                    text_output.push_str(text);
                    text_output.push('\n');
                }
                StreamLineType::Result { .. } => {
                    if let Some(result_text) = extract_result_text(&line) {
                        if text_output.trim().is_empty() && !result_text.trim().is_empty() {
                            text_output = result_text;
                        }
                    }
                }
                StreamLineType::Unknown => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        text_output.push_str(trimmed);
                        text_output.push('\n');
                    }
                }
                _ => {}
            }
        }
    })
    .await;

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for Claude CLI: {}", e))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    // Clear the PID now that the process has exited
    if let Some(pid_ref) = child_pid_out {
        *pid_ref.lock().unwrap() = None;
    }

    if stream_result.is_err() {
        let _ = child.kill().await;
        return Err(format!("Claude CLI timed out after {} seconds", timeout_secs));
    }

    if !exit_status.success() {
        let stderr_trimmed = stderr_output.trim();
        if stderr_trimmed.contains("unset the CLAUDECODE environment variable") {
            return Err(
                "Claude CLI refused to run due to a conflicting CLAUDECODE environment variable. \
                 The app now removes this automatically. Please restart the app and try again."
                    .to_string(),
            );
        }
        let msg = stderr_trimmed.lines().last().unwrap_or("unknown error");
        return Err(format!("Claude CLI exited with error: {}", msg));
    }

    Ok(ClaudeSpawnResult {
        text_output,
        stderr_output,
    })
}

pub(crate) async fn run_claude_prompt(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    timeout_secs: u64,
    empty_error: &str,
) -> Result<String, String> {
    let result = spawn_claude_and_collect(cli_args, prompt_text, timeout_secs, |_, _| {}, None).await?;

    if result.text_output.trim().is_empty() {
        return Err(empty_error.into());
    }

    Ok(result.text_output)
}
