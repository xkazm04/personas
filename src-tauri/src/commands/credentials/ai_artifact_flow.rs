//! Generic AI-generates-structured-artifact flow.
//!
//! Both credential design and the credential negotiator follow an identical
//! lifecycle:
//!
//!   idle → running → completed | error
//!
//! They both:
//! - spawn Claude CLI via `spawn_claude_and_collect`
//! - stream progress lines to the frontend via Tauri events
//! - extract a JSON artifact from the LLM output via a pluggable extractor
//!
//! The only difference is the prompt, the shape of the extracted artifact, and
//! the Tauri event names. This module captures the invariant parts of the
//! pattern as `AiArtifactMessages`, `AiArtifactParams`, and
//! `run_ai_artifact_task`, so that adding future AI-generates-X flows (e.g.
//! AI-generated healthcheck rules, trigger configs) is a matter of
//! instantiation rather than reimplementation.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::engine::parser::parse_stream_line;
use crate::engine::types::StreamLineType;

// ── Message configuration ────────────────────────────────────────

/// Progress and status message labels that differ between artifact flows.
///
/// Each concrete flow (credential design, negotiator, future flows) provides
/// its own `AiArtifactMessages` constant to customise event names, progress
/// strings, and timeouts.
pub struct AiArtifactMessages {
    /// Tauri status event name (e.g. `"credential-design-status"`).
    pub status_event: &'static str,
    /// Tauri progress/output event name (e.g. `"credential-design-output"`).
    pub progress_event: &'static str,
    /// JSON key used for the task ID in event payloads (e.g. `"design_id"`).
    pub id_field: &'static str,
    /// Initial status value emitted at start (e.g. `"analyzing"`).
    pub initial_status: &'static str,
    /// Progress line after SystemInit (e.g. `"Analyzing service requirements…"`).
    pub init_progress: &'static str,
    /// Progress line on first AssistantText (e.g. `"Designing connector structure…"`).
    pub streaming_progress: &'static str,
    /// Prefix for the Result progress line (e.g. `"Analysis complete"`).
    pub complete_prefix: &'static str,
    /// Progress line on successful extraction (e.g. `"Connector designed successfully"`).
    pub success_progress: &'static str,
    /// User-facing error when extraction fails.
    pub extraction_failed_error: &'static str,
    /// tracing log label for the task (e.g. `"credential_design"`).
    pub log_label: &'static str,
    /// Timeout in seconds for `spawn_claude_and_collect`.
    pub timeout_secs: u64,
}

// ── Task parameters ──────────────────────────────────────────────

/// Everything needed to run a single AI artifact generation task.
pub struct AiArtifactParams {
    pub app: tauri::AppHandle,
    pub task_id: String,
    pub prompt_text: String,
    pub cli_args: crate::engine::types::CliArgs,
    /// Shared mutex for the currently-active task ID. Used for cancellation
    /// detection: if the stored value no longer matches `task_id`, the task
    /// was cancelled.
    pub active_id: Arc<Mutex<Option<String>>>,
    /// Optional shared mutex for the child process PID. When provided, the
    /// PID is stored so cancel handlers can kill the process immediately.
    pub active_child_pid: Option<Arc<Mutex<Option<u32>>>>,
    pub messages: AiArtifactMessages,
    /// Pluggable extractor: given the full LLM text output, return the parsed
    /// JSON artifact or `None` on failure.
    pub extractor: fn(&str) -> Option<serde_json::Value>,
}

// ── Emit helpers ─────────────────────────────────────────────────

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

// ── Generic task runner ──────────────────────────────────────────

/// Run a complete AI artifact generation task.
///
/// This is the shared lifecycle that both credential design and negotiation
/// (and any future AI-artifact flows) use:
///
/// 1. Emit initial status + "Connecting to Claude…"
/// 2. Spawn Claude CLI, stream lines, emit progress
/// 3. Check cancellation
/// 4. Extract result via `params.extractor`
/// 5. Emit final status (completed/failed)
pub async fn run_ai_artifact_task(params: AiArtifactParams) {
    let AiArtifactParams {
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
        tracing::info!(task_id = %task_id, label = messages.log_label, "AI artifact task cancelled");
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

// ── Claude CLI spawn helper ──────────────────────────────────────

/// Result from spawning Claude CLI and collecting output.
pub struct ClaudeSpawnResult {
    pub text_output: String,
    pub stderr_output: String,
}

/// Try to extract the response text from a stream-json "result" line.
fn extract_result_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type").and_then(|t| t.as_str()) != Some("result") {
        return None;
    }
    value.get("result").and_then(|r| r.as_str()).map(|s| s.to_string())
}

/// Spawn Claude CLI, pipe prompt to stdin, collect text output from stdout.
///
/// `on_line` is called for each parsed stream-json line, allowing callers to
/// emit progress events or handle line-type-specific logic. Text accumulation
/// (AssistantText, Result, Unknown) is handled internally.
///
/// If `child_pid_out` is provided, the child process PID is stored there so
/// callers can kill the process from a cancel handler.
pub async fn spawn_claude_and_collect(
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

/// Convenience: spawn Claude, collect text, return the text or an error.
///
/// This is a simpler variant that doesn't stream progress events — useful for
/// one-shot prompts like healthcheck generation or step-help.
pub async fn run_claude_prompt(
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
