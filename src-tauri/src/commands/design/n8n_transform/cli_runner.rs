use std::sync::Arc;

use serde_json::json;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::db::repos::resources::n8n_sessions;
use crate::db::models::UpdateN8nSessionInput;
use crate::engine::parser::parse_stream_line;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::AppState;

use super::job_state::{self, *};
use super::prompts::{build_n8n_transform_prompt, build_n8n_unified_prompt, wrap_prompt_with_sections};
use super::streaming;
use super::types::N8nPersonaOutput;

use crate::commands::design::analysis::extract_display_text;

// ── Tauri commands ──────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_n8n_transform_background(
    app: tauri::AppHandle,
    transform_id: String,
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
    connectors_json: Option<String>,
    credentials_json: Option<String>,
    user_answers_json: Option<String>,
    session_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    if workflow_json.trim().is_empty() {
        return Err(AppError::Validation("Workflow JSON cannot be empty".into()));
    }

    // Reject extremely large payloads early (>10MB combined)
    let total_size = workflow_json.len() + parser_result_json.len()
        + adjustment_request.as_ref().map_or(0, |s| s.len())
        + previous_draft_json.as_ref().map_or(0, |s| s.len());
    if total_size > 10 * 1024 * 1024 {
        return Err(AppError::Validation("Payload too large (>10MB). Use a smaller workflow.".into()));
    }

    let cancel_token = CancellationToken::new();

    // Check for pre-emptive cancellation (race condition guard)
    {
        let mgr = job_state::manager();
        let jobs = mgr.lock()?;
        if let Some(existing) = jobs.get(&transform_id) {
            if existing.status == "running" {
                return Err(AppError::Validation("Transform is already running".into()));
            }
            if let Some(token) = &existing.cancel_token {
                if token.is_cancelled() {
                    return Err(AppError::Internal("Transform cancelled by user".into()));
                }
            }
        }
        drop(jobs);
        mgr.insert_running(transform_id.clone(), cancel_token.clone(), N8nTransformExtra::default())?;
    }

    if cancel_token.is_cancelled() {
        return Err(AppError::Internal("Transform cancelled by user".into()));
    }

    set_n8n_transform_status(&app, &transform_id, "running", None);

    // Persist 'transforming' status to DB session so startup recovery can detect it
    if let Some(ref sid) = session_id {
        let state = app.state::<Arc<AppState>>();
        let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
            status: Some("transforming".into()),
            step: Some("transform".into()),
            ..Default::default()
        });
    }

    // Determine if this is an adjustment re-run or initial transform
    let is_adjustment = adjustment_request.as_ref().is_some_and(|a| !a.trim().is_empty())
        || previous_draft_json.as_ref().is_some_and(|d| !d.trim().is_empty());

    let app_handle = app.clone();
    let transform_id_for_task = transform_id.clone();
    let token_for_task = cancel_token.clone();
    let session_id_for_task = session_id.clone();
    tokio::spawn(async move {
        if is_adjustment {
            // ── Adjustment re-run: single-prompt path (no interactive questions) ──
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Transform cancelled by user".into()))
                }
                res = run_n8n_transform_job(
                    &app_handle,
                    &transform_id_for_task,
                    &workflow_name,
                    &workflow_json,
                    &parser_result_json,
                    adjustment_request.as_deref(),
                    previous_draft_json.as_deref(),
                    connectors_json.as_deref(),
                    credentials_json.as_deref(),
                    user_answers_json.as_deref(),
                ) => res
            };

            handle_transform_result(
                result.map(|d| (d, false)),
                &app_handle,
                &transform_id_for_task,
                &workflow_name,
                session_id_for_task.as_deref(),
            );
        } else {
            // ── Initial transform: unified prompt (may produce questions or persona) ──
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Transform cancelled by user".into()))
                }
                res = run_unified_transform_turn1(
                    &app_handle,
                    &transform_id_for_task,
                    &workflow_name,
                    &workflow_json,
                    &parser_result_json,
                    connectors_json.as_deref(),
                    credentials_json.as_deref(),
                ) => res
            };

            // result: Ok((draft_option, produced_questions))
            match result {
                Ok((Some(draft), _)) => {
                    // Model skipped questions and produced persona directly
                    handle_transform_result(
                        Ok((draft, false)),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
                Ok((None, true)) => {
                    // Questions were produced and stored — status is awaiting_answers
                    // Nothing else to do; frontend will poll and pick up the questions
                }
                Ok((None, false)) => {
                    // No questions and no persona — unusual, treat as failure
                    handle_transform_result(
                        Err(AppError::Internal("No output from unified transform".into())),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
                Err(err) => {
                    handle_transform_result(
                        Err(err),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
            }
        }
    });

    Ok(json!({ "transform_id": transform_id }))
}

/// Turn 2: resume the Claude session with user answers.
#[tauri::command]
pub async fn continue_n8n_transform(
    app: tauri::AppHandle,
    transform_id: String,
    user_answers_json: String,
    session_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let claude_session_id = get_n8n_transform_claude_session(&transform_id)
        .ok_or_else(|| AppError::NotFound("No Claude session found for this transform".into()))?;

    // Update job state
    set_n8n_transform_status(&app, &transform_id, "running", None);

    let cancel_token = CancellationToken::new();
    job_state::manager().set_cancel_token(&transform_id, cancel_token.clone())?;

    let app_handle = app.clone();
    let transform_id_for_task = transform_id.clone();
    let token_for_task = cancel_token;
    let session_id_for_task = session_id;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Transform cancelled by user".into()))
            }
            res = run_continue_transform(
                &app_handle,
                &transform_id_for_task,
                &claude_session_id,
                &user_answers_json,
            ) => res
        };

        // Re-use handle_transform_result for standard success/failure handling
        handle_transform_result(
            result.map(|d| (d, false)),
            &app_handle,
            &transform_id_for_task,
            "n8n workflow", // workflow_name not available here, use generic
            session_id_for_task.as_deref(),
        );
    });

    Ok(json!({ "transform_id": transform_id }))
}

// ── Internal helpers ────────────────────────────────────────────

/// Build on_line and on_section callbacks for sectioned CLI streaming.
/// Both callbacks emit to n8n transform lines; on_section also stores the section.
fn build_section_callbacks(
    app: &tauri::AppHandle,
    transform_id: &str,
) -> (
    impl Fn(&str) + Send + Sync,
    impl Fn(&streaming::StreamingSection) + Send + Sync,
) {
    let app1 = app.clone();
    let id1 = transform_id.to_string();
    let on_line = move |line: &str| {
        emit_n8n_transform_line(&app1, &id1, line.to_string());
    };

    let app2 = app.clone();
    let id2 = transform_id.to_string();
    let on_section = move |section: &streaming::StreamingSection| {
        if let Ok(serialized) = serde_json::to_value(section) {
            job_state::store_n8n_transform_section(&id2, serialized);
        }
        emit_n8n_transform_line(
            &app2,
            &id2,
            format!(
                "[Section] {} — {}",
                section.label,
                if section.validation.valid { "valid" } else { "errors detected" }
            ),
        );
    };

    (on_line, on_section)
}

/// Handle the result from either adjustment or unified transform.
/// Second element in the Ok tuple is unused (reserved).
fn handle_transform_result(
    result: Result<(N8nPersonaOutput, bool), AppError>,
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    session_id: Option<&str>,
) {
    match result {
        Ok((draft, _)) => {
            set_n8n_transform_draft(transform_id, &draft);
            set_n8n_transform_status(app, transform_id, "completed", None);
            crate::notifications::notify_n8n_transform_completed(app, workflow_name, true);
            if let Some(sid) = session_id {
                let state = app.state::<Arc<AppState>>();
                let draft_str = serde_json::to_string(&draft).unwrap_or_default();
                let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
                    status: Some("editing".into()),
                    step: Some("edit".into()),
                    draft_json: Some(Some(draft_str)),
                    error: Some(None),
                    ..Default::default()
                });
            }
        }
        Err(err) => {
            let msg = err.to_string();
            tracing::error!(transform_id = %transform_id, error = %msg, "n8n transform failed");
            set_n8n_transform_status(app, transform_id, "failed", Some(msg.clone()));
            crate::notifications::notify_n8n_transform_completed(app, workflow_name, false);
            if let Some(sid) = session_id {
                let state = app.state::<Arc<AppState>>();
                let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
                    status: Some("failed".into()),
                    error: Some(Some(msg)),
                    ..Default::default()
                });
            }
        }
    }
}

/// Turn 1 of unified transform: sends unified prompt to Sonnet.
/// Returns Ok((Some(draft), false)) if persona generated directly,
/// Ok((None, true)) if questions were produced and stored,
/// Ok((None, false)) if neither (error case).
async fn run_unified_transform_turn1(
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
) -> Result<(Option<N8nPersonaOutput>, bool), AppError> {
    tracing::info!(transform_id = %transform_id, "Starting unified transform Turn 1");

    let prompt_text = build_n8n_unified_prompt(
        workflow_name,
        workflow_json,
        parser_result_json,
        connectors_json,
        credentials_json,
    );

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Analyzing workflow and preparing transformation...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let (output_text, captured_session_id) =
        run_claude_prompt_text(prompt_text, &cli_args, Some((app, transform_id)))
            .await
            .map_err(AppError::Internal)?;

    // Store session ID for possible Turn 2
    if let Some(ref sid) = captured_session_id {
        set_n8n_transform_claude_session(transform_id, sid.clone());
    }

    // Check if output contains questions
    if let Some(questions) = extract_questions_output(&output_text) {
        tracing::info!(transform_id = %transform_id, "Turn 1 produced questions");
        set_n8n_transform_questions(transform_id, questions.clone());
        set_n8n_transform_status(app, transform_id, "awaiting_answers", None);
        emit_n8n_transform_line(
            app,
            transform_id,
            "[Milestone] Questions generated. Awaiting user answers...",
        );
        return Ok((None, true));
    }

    // No questions — try to parse persona output directly
    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, workflow_name)?;

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review.",
    );

    Ok((Some(draft), false))
}

/// Execute Turn 2 of the unified transform: resume Claude session with user answers.
/// Uses section-by-section streaming with monolithic fallback.
async fn run_continue_transform(
    app: &tauri::AppHandle,
    transform_id: &str,
    claude_session_id: &str,
    user_answers_json: &str,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(transform_id = %transform_id, "Starting unified transform Turn 2 (sectioned resume)");

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Resuming session with your answers. Streaming sections...",
    );

    let base_prompt = format!(
        r#"Here are the user's answers to your questions:

{}

Now proceed to PHASE 2. Generate the full persona JSON based on the workflow analysis and the user's answers above.
Remember: return ONLY valid JSON with the persona object, no markdown fences."#,
        user_answers_json
    );
    let prompt_text = wrap_prompt_with_sections(&base_prompt);

    let mut cli_args = prompt::build_resume_cli_args(claude_session_id);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    clear_n8n_transform_sections(transform_id);

    let accum = streaming::SectionAccumulator::new(vec![]);
    let (on_line, on_section) = build_section_callbacks(app, transform_id);

    let (output_text, _, returned_accum) = run_claude_prompt_text_inner(
        prompt_text,
        &cli_args,
        Some(&on_line),
        Some(&on_section),
        Some(accum),
        420,
    )
    .await
    .map_err(AppError::Internal)?;

    // Try section assembly first, fall back to monolithic parsing
    if let Some(accumulator) = returned_accum {
        if accumulator.has_sections() {
            if let Some(draft) = accumulator.assemble("n8n workflow") {
                emit_n8n_transform_line(
                    app,
                    transform_id,
                    "[Milestone] All sections validated. Draft ready for review.",
                );
                return Ok(draft);
            }
        }
    }

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Extracting persona JSON draft...",
    );
    let draft = parse_persona_output(&output_text, "n8n workflow")?;
    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review.",
    );
    Ok(draft)
}

#[allow(clippy::too_many_arguments)]
async fn run_n8n_transform_job(
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
    user_answers_json: Option<&str>,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(
        transform_id = %transform_id,
        workflow_name = %workflow_name,
        workflow_json_len = workflow_json.len(),
        parser_result_len = parser_result_json.len(),
        "Starting n8n transform job (sectioned)"
    );

    let base_prompt = build_n8n_transform_prompt(
        workflow_name,
        workflow_json,
        parser_result_json,
        adjustment_request,
        previous_draft_json,
        connectors_json,
        credentials_json,
        user_answers_json,
    );
    let prompt_text = wrap_prompt_with_sections(&base_prompt);

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Preparing section-by-section transformation...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let known_connectors =
        streaming::extract_known_connectors(connectors_json, credentials_json);
    clear_n8n_transform_sections(transform_id);

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude CLI started. Streaming sections...",
    );

    let accum = streaming::SectionAccumulator::new(known_connectors);
    let (on_line, on_section) = build_section_callbacks(app, transform_id);

    let (output_text, _session_id, returned_accum) = run_claude_prompt_text_inner(
        prompt_text,
        &cli_args,
        Some(&on_line),
        Some(&on_section),
        Some(accum),
        420,
    )
    .await
    .map_err(AppError::Internal)?;

    // Try section assembly first, fall back to monolithic parsing
    if let Some(accumulator) = returned_accum {
        if accumulator.has_sections() {
            if let Some(draft) = accumulator.assemble(workflow_name) {
                emit_n8n_transform_line(
                    app,
                    transform_id,
                    "[Milestone] All sections validated. Draft ready for review.",
                );
                return Ok(draft);
            }
            tracing::warn!(
                transform_id = %transform_id,
                "Section assembly failed with {} sections, falling back to monolithic",
                accumulator.sections.len()
            );
        }
    }

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Extracting persona JSON draft...",
    );
    let draft = parse_persona_output(&output_text, workflow_name)?;
    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review.",
    );
    Ok(draft)
}

// ── Shared utilities (pub for template_adopt) ────────────

pub fn should_surface_n8n_output_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Hide section delimiters from the raw line stream (they're shown in the sections UI)
    if trimmed.starts_with("---SECTION:") && trimmed.ends_with("---") {
        return false;
    }

    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        return false;
    }

    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && (trimmed.contains("\"persona\"") || trimmed.contains("\"system_prompt\""))
    {
        return false;
    }

    true
}

/// Convenience wrapper: spawns Claude CLI with emit_ctx-based line emission, no sections.
/// Returns (text_output, captured_claude_session_id).
pub async fn run_claude_prompt_text(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    emit_ctx: Option<(&tauri::AppHandle, &str)>,
) -> Result<(String, Option<String>), String> {
    #[allow(clippy::type_complexity)]
    let on_line: Option<Box<dyn Fn(&str) + Send + Sync>> = emit_ctx.map(|(app, id)| {
        let app = app.clone();
        let id = id.to_string();
        Box::new(move |line: &str| {
            emit_n8n_transform_line(&app, &id, line.to_string());
        }) as Box<dyn Fn(&str) + Send + Sync>
    });
    let (text, session_id, _) =
        run_claude_prompt_text_inner(prompt_text, cli_args, on_line.as_deref(), None, None, 420)
            .await?;
    Ok((text, session_id))
}

/// Core Claude CLI process spawning with stdout streaming, timeout, line emission,
/// and optional section-by-section accumulation.
///
/// The `on_line` callback is invoked for each surfaceable output line (after dedup
/// and filtering). The optional `accumulator` enables section-aware streaming:
/// extracted text is fed to the accumulator, and completed sections are passed to
/// `on_section`. Returns the accumulator (if provided) for post-stream assembly.
pub async fn run_claude_prompt_text_inner(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    on_line: Option<&(dyn Fn(&str) + Send + Sync)>,
    on_section: Option<&(dyn Fn(&streaming::StreamingSection) + Send + Sync)>,
    accumulator: Option<streaming::SectionAccumulator>,
    timeout_secs: u64,
) -> Result<(String, Option<String>, Option<streaming::SectionAccumulator>), String> {
    let mut accumulator = accumulator;

    // Use a temp directory as CWD so Claude CLI doesn't pick up project context
    // (.claude/, CLAUDE.md) from the app's working directory.
    let exec_dir = std::env::temp_dir().join("personas-transform");
    let _ = std::fs::create_dir_all(&exec_dir);

    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
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
    let mut last_emitted_line: Option<String> = None;
    let mut captured_session_id: Option<String> = None;

    let timeout_duration = std::time::Duration::from_secs(timeout_secs);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            // Try to capture session_id from stream-json events
            if captured_session_id.is_none() {
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::SystemInit { session_id: Some(sid), .. }
                    | StreamLineType::Result { session_id: Some(sid), .. } => {
                        captured_session_id = Some(sid);
                    }
                    _ => {}
                }
            }

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    text_output.push_str(trimmed);
                    text_output.push('\n');

                    // Feed to section accumulator if present
                    if let Some(ref mut accum) = accumulator {
                        if let Some(section) = accum.feed_line(trimmed) {
                            if let Some(ref emit_section) = on_section {
                                emit_section(&section);
                            }
                        }
                    }

                    if !should_surface_n8n_output_line(trimmed) {
                        continue;
                    }

                    if last_emitted_line.as_deref() == Some(trimmed) {
                        continue;
                    }
                    if let Some(emit) = on_line {
                        emit(trimmed);
                    }
                    last_emitted_line = Some(trimmed.to_string());
                }
            }
        }
    })
    .await;

    if stream_result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(format!("Claude CLI timed out after {} seconds", timeout_secs));
    }

    // Flush any remaining buffered section
    if let Some(ref mut accum) = accumulator {
        if let Some(section) = accum.flush() {
            if let Some(ref emit_section) = on_section {
                emit_section(&section);
            }
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for Claude CLI: {}", e))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !exit_status.success() {
        let msg = stderr_output
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("Claude CLI exited with error: {}", msg));
    }

    if text_output.trim().is_empty() {
        return Err("Claude produced no output".into());
    }

    Ok((text_output, captured_session_id, accumulator))
}

/// Safely truncate a UTF-8 string to at most `max_bytes` bytes, always stopping
/// at a character boundary so the slice is valid UTF-8.
pub fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[allow(clippy::needless_range_loop)]
pub fn extract_first_json_object(input: &str) -> Option<String> {
    extract_first_json_object_matching(input, |_| true)
}

/// Like `extract_first_json_object` but only accepts JSON objects where the
/// `predicate` returns true. This lets callers skip incidental JSON in Claude
/// commentary and find the object that matches an expected schema.
#[allow(clippy::needless_range_loop)]
pub fn extract_first_json_object_matching(
    input: &str,
    predicate: impl Fn(&serde_json::Value) -> bool,
) -> Option<String> {
    let candidates = [
        input.to_string(),
        input
            .replace("```json", "")
            .replace("```", "")
            .trim()
            .to_string(),
    ];

    for candidate in candidates {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
            if predicate(&val) {
                return Some(candidate);
            }
        }

        // Walk through every '{' as a potential JSON object start.
        // Use a balanced-brace counter to find the matching '}' instead of
        // the old greedy find('{')/rfind('}') which could span unrelated
        // braces in surrounding commentary text.
        let bytes = candidate.as_bytes();
        let mut search_from = 0;
        while let Some(rel) = candidate[search_from..].find('{') {
            let start = search_from + rel;
            let mut depth: usize = 0;
            let mut in_string = false;
            let mut escape_next = false;
            let mut end = None;

            for i in start..bytes.len() {
                let b = bytes[i];

                if escape_next {
                    escape_next = false;
                    continue;
                }

                if b == b'\\' && in_string {
                    escape_next = true;
                    continue;
                }

                if b == b'"' {
                    in_string = !in_string;
                    continue;
                }

                if in_string {
                    continue;
                }

                if b == b'{' {
                    depth += 1;
                } else if b == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
            }

            if let Some(e) = end {
                let slice = &candidate[start..=e];
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(slice) {
                    if predicate(&val) {
                        return Some(slice.to_string());
                    }
                }
            }

            // Advance past this '{' and try the next one
            search_from = start + 1;
        }
    }

    None
}

/// Heuristic check: does this JSON value look like a persona definition?
/// Matches objects with a `"persona"` wrapper key, or direct persona objects
/// containing `"system_prompt"` (the only required field in N8nPersonaOutput).
fn looks_like_persona_json(val: &serde_json::Value) -> bool {
    let obj = match val.as_object() {
        Some(o) => o,
        None => return false,
    };
    // Wrapper: { "persona": { ... } }
    if obj.contains_key("persona") {
        return true;
    }
    // Direct persona: must have "system_prompt" (required field)
    if obj.contains_key("system_prompt") {
        return true;
    }
    // Fallback: "name" plus at least one other persona-specific key
    if obj.contains_key("name")
        && (obj.contains_key("description")
            || obj.contains_key("structured_prompt")
            || obj.contains_key("triggers")
            || obj.contains_key("tools")
            || obj.contains_key("design_context")
            || obj.contains_key("required_connectors"))
    {
        return true;
    }
    false
}

/// Extract questions JSON from unified prompt output. Looks for TRANSFORM_QUESTIONS marker.
/// Uses balanced-bracket counting to find the matching ']' for the first '['.
#[allow(clippy::needless_range_loop)]
pub fn extract_questions_output(text: &str) -> Option<serde_json::Value> {
    let marker = "TRANSFORM_QUESTIONS";
    let marker_pos = text.find(marker)?;
    let after_marker = &text[marker_pos + marker.len()..];

    // Find the JSON array start and walk brackets to find the balanced end
    let arr_start = after_marker.find('[')?;
    let bytes = after_marker.as_bytes();
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut arr_end = None;

    for i in arr_start..bytes.len() {
        let b = bytes[i];

        if escape_next {
            escape_next = false;
            continue;
        }
        if b == b'\\' && in_string {
            escape_next = true;
            continue;
        }
        if b == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }

        if b == b'[' {
            depth += 1;
        } else if b == b']' {
            depth -= 1;
            if depth == 0 {
                arr_end = Some(i);
                break;
            }
        }
    }

    let end = arr_end?;
    let slice = &after_marker[arr_start..=end];
    serde_json::from_str::<serde_json::Value>(slice).ok()
}

/// Parse persona output from Claude CLI text. Extracts JSON and deserializes.
/// Uses schema-aware extraction to skip incidental JSON in Claude commentary.
pub fn parse_persona_output(output_text: &str, workflow_name: &str) -> Result<N8nPersonaOutput, AppError> {
    // Try schema-aware extraction first, fall back to any valid JSON object
    let parsed_json = extract_first_json_object_matching(output_text, looks_like_persona_json)
        .or_else(|| extract_first_json_object(output_text))
        .ok_or_else(|| AppError::Internal("Claude did not return valid JSON persona output".into()))?;

    let parsed_value: serde_json::Value = serde_json::from_str(&parsed_json)?;

    let persona_payload = parsed_value
        .get("persona")
        .cloned()
        .unwrap_or(parsed_value);

    let output: N8nPersonaOutput = serde_json::from_value(persona_payload)
        .map_err(|e| AppError::Internal(format!("Failed to parse transformed persona output: {e}")))?;

    Ok(super::types::normalize_n8n_persona_draft(output, workflow_name))
}
