use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::repos::core::groups as group_repo;
use crate::db::repos::execution::tool_usage as usage_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
};
use crate::db::settings_keys;
use crate::db::DbPool;

use super::logger::ExecutionLogger;
use super::parser;
use super::prompt;
use super::provider::{self, PromptDelivery};
use super::types::*;

/// Run a persona execution: spawn Claude CLI, stream output, capture results.
#[allow(clippy::too_many_arguments)]
pub async fn run_execution(
    app: AppHandle,
    pool: DbPool,
    execution_id: String,
    persona: Persona,
    tools: Vec<PersonaToolDefinition>,
    input_data: Option<serde_json::Value>,
    log_dir: PathBuf,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled: Arc<AtomicBool>,
    continuation: Option<Continuation>,
) -> ExecutionResult {
    let start_time = std::time::Instant::now();

    // Set up logger
    let mut logger = match ExecutionLogger::new(&log_dir, &execution_id) {
        Ok(l) => l,
        Err(e) => {
            return ExecutionResult {
                success: false,
                error: Some(format!("Failed to create log file: {}", e)),
                duration_ms: 0,
                ..default_result()
            };
        }
    };

    let log_file_path = logger.path().to_string_lossy().to_string();

    // Resolve workspace (group) defaults — persona-level > group-level > global
    let workspace = persona
        .group_id
        .as_deref()
        .and_then(|gid| group_repo::get_by_id(&pool, gid).ok());

    let mut persona = persona;
    if let Some(ref ws) = workspace {
        // Fall back to workspace model profile when persona has none
        if persona.model_profile.is_none() && ws.default_model_profile.is_some() {
            persona.model_profile = ws.default_model_profile.clone();
        }
        // Fall back to workspace budget when persona has none
        if persona.max_budget_usd.is_none() && ws.default_max_budget_usd.is_some() {
            persona.max_budget_usd = ws.default_max_budget_usd;
        }
        // Fall back to workspace max turns when persona has none
        if persona.max_turns.is_none() && ws.default_max_turns.is_some() {
            persona.max_turns = ws.default_max_turns;
        }
    }

    // Parse model profile
    let mut model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());

    // Resolve global provider settings (Ollama, LiteLLM) from app settings DB
    if let Some(ref mut profile) = model_profile {
        resolve_global_provider_settings(&pool, profile);
    }

    // Workspace shared instructions — appended to the prompt later
    let workspace_instructions = workspace
        .as_ref()
        .and_then(|ws| ws.shared_instructions.clone())
        .filter(|s| !s.trim().is_empty());

    // Apply Continuation: SessionResume uses --resume CLI args,
    // PromptHint injects a hint into the input data for the prompt.
    let mut input_data = input_data;
    let is_session_resume = matches!(continuation, Some(Continuation::SessionResume(_)));

    if let Some(Continuation::PromptHint(ref hint)) = continuation {
        let mut obj = input_data
            .as_ref()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        obj.insert("_resume_hint".to_string(), serde_json::Value::String(hint.clone()));
        input_data = Some(serde_json::Value::Object(obj));
    }

    // Resolve CLI provider based on global engine setting
    let engine_kind = provider::load_engine_kind(&pool);
    let cli_provider = provider::resolve_provider(engine_kind);

    // Build CLI args — use resume args when we have a session ID
    let mut cli_args = if let Some(Continuation::SessionResume(ref session_id)) = continuation {
        let mut args = cli_provider.build_resume_args(session_id);
        // Apply provider env even for resume sessions
        if let Some(profile) = model_profile.as_ref() {
            cli_provider.apply_provider_env(&mut args, profile);
        }
        args
    } else {
        cli_provider.build_execution_args(Some(&persona), model_profile.as_ref())
    };

    // Inject decrypted service credentials as env vars (with OAuth token refresh)
    let (cred_env, cred_hints) = resolve_credential_env_vars(&pool, &tools, &persona.id, &persona.name).await;
    let cred_env_clone = cred_env.clone();
    for (key, val) in cred_env {
        cli_args.env_overrides.push((key, val));
    }

    // Assemble prompt (with credential env var hints)
    let hint_refs: Vec<&str> = cred_hints.iter().map(|s| s.as_str()).collect();
    let prompt_text = if is_session_resume {
        // For session resume, send a lighter prompt — the session already has context
        prompt::assemble_resume_prompt(
            input_data.as_ref(),
            if hint_refs.is_empty() { None } else { Some(&hint_refs) },
        )
    } else {
        prompt::assemble_prompt(
            &persona,
            &tools,
            input_data.as_ref(),
            if hint_refs.is_empty() {
                None
            } else {
                Some(&hint_refs)
            },
            workspace_instructions.as_deref(),
        )
    };

    // For non-Stdin providers, rebuild args with the prompt embedded
    match cli_provider.prompt_delivery() {
        PromptDelivery::PositionalArg | PromptDelivery::Flag(_) => {
            cli_args = if let Some(Continuation::SessionResume(ref session_id)) = continuation {
                let mut args = cli_provider.build_resume_args_with_prompt(session_id, &prompt_text);
                if let Some(profile) = model_profile.as_ref() {
                    cli_provider.apply_provider_env(&mut args, profile);
                }
                for (key, val) in &cred_env_clone {
                    args.env_overrides.push((key.clone(), val.clone()));
                }
                args
            } else {
                let mut args = cli_provider.build_execution_args_with_prompt(
                    Some(&persona),
                    model_profile.as_ref(),
                    &prompt_text,
                );
                for (key, val) in &cred_env_clone {
                    args.env_overrides.push((key.clone(), val.clone()));
                }
                args
            };
        }
        PromptDelivery::Stdin => {} // args already correct
    }

    logger.log("=== Persona Execution Started ===");
    logger.log(&format!("Persona: {}", persona.name));
    logger.log(&format!("Execution ID: {}", execution_id));
    logger.log(&format!(
        "Tools: {}",
        tools
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    logger.log(&format!("Prompt length: {} characters", prompt_text.len()));

    // Create a stable per-persona working directory (persists across executions).
    // This allows Claude Code's memory system to work correctly and lets agents
    // maintain workspace files between runs. Falls back to per-execution temp dir.
    let exec_dir = {
        let stable_dir = std::env::temp_dir()
            .join("personas-workspace")
            .join(&persona.id);
        if std::fs::create_dir_all(&stable_dir).is_ok() {
            stable_dir
        } else {
            std::env::temp_dir().join(format!("personas-exec-{}", &execution_id))
        }
    };
    if let Err(e) = std::fs::create_dir_all(&exec_dir) {
        logger.log(&format!("Failed to create exec dir: {}", e));
        return ExecutionResult {
            success: false,
            error: Some(format!("Failed to create execution directory: {}", e)),
            log_file_path: Some(log_file_path),
            duration_ms: start_time.elapsed().as_millis() as u64,
            ..default_result()
        };
    }

    // Spawn Claude CLI process
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // On Windows, use CREATE_NO_WINDOW flag to prevent console window popup
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    // Set up environment
    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "{} not found. Please install it or select a different engine in Settings.",
                    cli_provider.engine_name()
                )
            } else {
                format!("Failed to spawn {}: {}", cli_provider.engine_name(), e)
            };

            logger.log(&format!("[ERROR] {}", error_msg));
            logger.close();

            // Emit error to frontend
            let _ = app.emit(
                "execution-output",
                ExecutionOutputEvent {
                    execution_id: execution_id.clone(),
                    line: format!("[ERROR] {}", error_msg),
                },
            );
            let _ = app.emit(
                "execution-status",
                ExecutionStatusEvent {
                    execution_id: execution_id.clone(),
                    status: ExecutionState::Failed,
                    error: Some(error_msg.clone()),
                    duration_ms: Some(duration_ms),
                    cost_usd: None,
                },
            );

            // Stable workspace dirs are not cleaned up (persist across runs)

            return ExecutionResult {
                success: false,
                error: Some(error_msg),
                log_file_path: Some(log_file_path),
                duration_ms,
                ..default_result()
            };
        }
    };

    // Register child PID so cancel_execution can kill it
    if let Some(pid) = child.id() {
        child_pids.lock().await.insert(execution_id.clone(), pid);
    }

    // Check if cancellation was requested during spawn. If the user cancelled
    // between task start and PID registration, the cancel_execution call couldn't
    // kill the process (PID wasn't registered yet). Catch it here to avoid
    // wasting API credits on an execution the user already cancelled.
    if cancelled.load(Ordering::Acquire) {
        logger.log("[CANCELLED] Execution cancelled during startup, killing process");
        let _ = child.kill().await;
        let _ = child.wait().await;
        child_pids.lock().await.remove(&execution_id);
        // Stable workspace dirs are not cleaned up (persist across runs)
        logger.close();

        let duration_ms = start_time.elapsed().as_millis() as u64;
        let _ = app.emit(
            "execution-output",
            ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: "[CANCELLED] Execution cancelled before startup completed".into(),
            },
        );

        return ExecutionResult {
            success: false,
            error: Some("Cancelled during startup".into()),
            log_file_path: Some(log_file_path),
            duration_ms,
            ..default_result()
        };
    }

    // Deliver prompt based on provider strategy
    match cli_provider.prompt_delivery() {
        PromptDelivery::Stdin => {
            // Claude: write prompt to stdin, then close
            if let Some(mut stdin) = child.stdin.take() {
                let prompt_bytes = prompt_text.into_bytes();
                let _ = stdin.write_all(&prompt_bytes).await;
                let _ = stdin.shutdown().await;
            }
        }
        PromptDelivery::PositionalArg | PromptDelivery::Flag(_) => {
            // Codex/Gemini: prompt already embedded in args, just close stdin
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.shutdown().await;
            }
        }
    }

    // Read stdout line by line
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr);

    let mut metrics = ExecutionMetrics::default();
    let mut assistant_text = String::new();
    let mut tool_use_lines: Vec<StreamLineType> = Vec::new();
    let mut tool_steps: Vec<ToolCallStep> = Vec::new();
    let mut step_counter: u32 = 0;

    // Read stderr in background (capped at 100KB to prevent OOM)
    let stderr_handle = tokio::spawn(async move {
        const MAX_STDERR_BYTES: usize = 100 * 1024;
        let mut buf = vec![0u8; MAX_STDERR_BYTES];
        let mut total = 0;
        loop {
            match tokio::io::AsyncReadExt::read(&mut stderr_reader, &mut buf[total..]).await {
                Ok(0) => break,
                Ok(n) => {
                    total += n;
                    if total >= MAX_STDERR_BYTES {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let mut s = String::from_utf8_lossy(&buf[..total]).into_owned();
        if total >= MAX_STDERR_BYTES {
            s.push_str("\n... [stderr truncated at 100KB]");
        }
        s
    });

    // Set up timeout
    let timeout_ms = if persona.timeout_ms > 0 {
        persona.timeout_ms as u64
    } else {
        600_000
    }; // default 10 min
    let timeout_duration = std::time::Duration::from_millis(timeout_ms);

    // Clone values needed in the closure
    let exec_id_for_stream = execution_id.clone();
    let persona_id_for_stream = persona.id.clone();
    let project_id_for_stream = persona.project_id.clone();
    let pool_for_stream = pool.clone();
    let persona_name_for_stream = persona.name.clone();
    let notif_channels_for_stream = persona.notification_channels.clone();

    // Process stdout lines with timeout
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            logger.log(&format!("[STDOUT] {}", line.trim()));

            // Parse stream line using the active provider
            let (line_type, display) = cli_provider.parse_stream_line(&line);

            // Emit user-facing output to frontend
            if let Some(ref display_text) = display {
                let _ = app.emit(
                    "execution-output",
                    ExecutionOutputEvent {
                        execution_id: exec_id_for_stream.clone(),
                        line: display_text.clone(),
                    },
                );
            }

            // Update metrics from result lines
            parser::update_metrics_from_result(&mut metrics, &line_type);

            // Track tool usage and build tool steps for inspector
            if let StreamLineType::AssistantToolUse {
                ref tool_name,
                ref input_preview,
            } = line_type
            {
                tool_use_lines.push(line_type.clone());
                step_counter += 1;
                tool_steps.push(ToolCallStep {
                    step_index: step_counter,
                    tool_name: tool_name.clone(),
                    input_preview: input_preview.clone(),
                    output_preview: String::new(),
                    started_at_ms: start_time.elapsed().as_millis() as u64,
                    ended_at_ms: None,
                    duration_ms: None,
                });
            }

            // Fill last tool step with result output
            if let StreamLineType::ToolResult {
                ref content_preview,
            } = line_type
            {
                if let Some(last) = tool_steps.last_mut() {
                    if last.ended_at_ms.is_none() {
                        let now = start_time.elapsed().as_millis() as u64;
                        last.output_preview = if content_preview.len() > 500 {
                            format!("{}...", &content_preview[..500])
                        } else {
                            content_preview.clone()
                        };
                        last.ended_at_ms = Some(now);
                        last.duration_ms = Some(now.saturating_sub(last.started_at_ms));
                    }
                }
            }

            // For assistant text, check for protocol messages
            if let StreamLineType::AssistantText { ref text } = line_type {
                for text_line in text.split('\n') {
                    assistant_text.push_str(text_line);
                    assistant_text.push('\n');

                    // Mid-stream protocol message detection
                    if let Some(protocol_msg) = parser::extract_protocol_message(text_line) {
                        let mut dispatch_ctx = super::dispatch::DispatchContext {
                            app: &app,
                            pool: &pool_for_stream,
                            execution_id: &exec_id_for_stream,
                            persona_id: &persona_id_for_stream,
                            project_id: &project_id_for_stream,
                            persona_name: &persona_name_for_stream,
                            notification_channels: notif_channels_for_stream.as_deref(),
                            logger: &mut logger,
                        };
                        super::dispatch::dispatch(&mut dispatch_ctx, &protocol_msg);
                    }
                }
            }
        }
    })
    .await;

    // Get stderr
    let stderr_text = stderr_handle.await.unwrap_or_default();
    if !stderr_text.is_empty() {
        logger.log(&format!("[STDERR] {}", stderr_text.trim()));
        let _ = app.emit(
            "execution-output",
            ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[ERROR] {}", stderr_text.trim()),
            },
        );
    }

    // Wait for process to exit
    let exit_status = child.wait().await;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    // Unregister child PID (process has exited)
    child_pids.lock().await.remove(&execution_id);

    // Check timeout
    let timed_out = stream_result.is_err();
    if timed_out {
        logger.log("[TIMEOUT] Execution timed out, killing process");
        let _ = child.kill().await;
        let _ = app.emit(
            "execution-output",
            ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[TIMEOUT] Execution timed out after {}s", timeout_ms / 1000),
            },
        );
    }

    let exit_code = exit_status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);

    logger.log(&format!("Process exited with code: {}", exit_code));
    logger.log(&format!("Duration: {}ms", duration_ms));
    logger.log("=== Persona Execution Finished ===");

    // Post-mortem: extract execution flows only.
    // Manual reviews and agent memories are already processed mid-stream
    // via extract_protocol_message, so skip them here to avoid duplicates.
    let execution_flows = parser::extract_execution_flows(&assistant_text);

    // Record tool usage
    let tool_counts = parser::count_tool_usage(&tool_use_lines);
    for (tool_name, count) in &tool_counts {
        let _ = usage_repo::record(&pool, &execution_id, &persona.id, tool_name, *count as i32);
    }

    // Serialize tool steps for inspector
    let tool_steps_json = if tool_steps.is_empty() {
        None
    } else {
        serde_json::to_string(&tool_steps).ok()
    };

    logger.close();

    // Stable per-persona workspace dirs are NOT cleaned up (they persist
    // across executions for Claude Code memory and workspace files).
    // Only per-execution fallback dirs are cleaned up.

    // Build result
    let success = !timed_out && exit_code == 0;
    let error = if timed_out {
        Some(format!("Execution timed out after {}s", timeout_ms / 1000))
    } else if exit_code != 0 {
        if parser::is_session_limit_error(&stderr_text) {
            Some("Session limit reached".into())
        } else {
            Some(format!(
                "Execution failed (exit code {}): {}",
                exit_code,
                stderr_text.trim()
            ))
        }
    } else {
        None
    };

    // Check outcome assessment: CLI exited 0 but task may not have been accomplished
    let mut final_status = if success { ExecutionState::Completed } else { ExecutionState::Failed };
    if success {
        if let Some((accomplished, ref _summary)) =
            parser::parse_outcome_assessment(&assistant_text)
        {
            if !accomplished {
                final_status = ExecutionState::Incomplete;
                logger.log("[OUTCOME] Task not accomplished — marking as incomplete");
            }
        } else {
            // No outcome_assessment found — use heuristic: if the output contains
            // error indicators without clear success indicators, mark as incomplete.
            let lower_text = assistant_text.to_lowercase();
            let has_error_indicators = lower_text.contains("error:")
                || lower_text.contains("failed to")
                || lower_text.contains("unable to")
                || lower_text.contains("could not");
            let has_success_indicators = lower_text.contains("successfully")
                || lower_text.contains("completed")
                || lower_text.contains("done");
            if has_error_indicators && !has_success_indicators {
                final_status = ExecutionState::Incomplete;
                logger.log("[OUTCOME] No assessment found, error indicators detected — marking as incomplete");
            }
        }
    }

    let session_limit_reached = error
        .as_ref()
        .map(|e| e.contains("Session limit"))
        .unwrap_or(false);

    // Emit final status
    let _ = app.emit(
        "execution-status",
        ExecutionStatusEvent {
            execution_id: execution_id.clone(),
            status: final_status,
            error: error.clone(),
            duration_ms: Some(duration_ms),
            cost_usd: Some(metrics.cost_usd),
        },
    );

    ExecutionResult {
        success,
        output: None,
        error,
        session_limit_reached,
        log_file_path: Some(log_file_path),
        claude_session_id: metrics.session_id.clone(),
        duration_ms,
        execution_flows,
        model_used: metrics.model_used.clone(),
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cost_usd: metrics.cost_usd,
        tool_steps: tool_steps_json,
    }
}

/// Apply a global settings value to a profile field when the field is empty.
fn apply_global_setting(pool: &DbPool, field: &mut Option<String>, settings_key: &str) {
    let needs_global = field.as_ref().map_or(true, |v| v.is_empty());
    if needs_global {
        if let Ok(Some(value)) = crate::db::repos::core::settings::get(pool, settings_key) {
            if !value.is_empty() {
                *field = Some(value);
            }
        }
    }
}

/// Resolve global provider settings (API keys, base URLs) from the app settings DB
/// when the per-persona model profile doesn't specify them.
fn resolve_global_provider_settings(pool: &DbPool, profile: &mut ModelProfile) {
    match profile.provider.as_deref() {
        Some(providers::OLLAMA) => {
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::OLLAMA_API_KEY);
        }
        Some(providers::LITELLM) => {
            apply_global_setting(pool, &mut profile.base_url, settings_keys::LITELLM_BASE_URL);
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::LITELLM_MASTER_KEY);
        }
        _ => {}
    }
}

fn default_result() -> ExecutionResult {
    ExecutionResult {
        success: false,
        output: None,
        error: None,
        session_limit_reached: false,
        log_file_path: None,
        claude_session_id: None,
        duration_ms: 0,
        execution_flows: None,
        model_used: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        tool_steps: None,
    }
}

/// Resolve credentials for a persona's tools and return env var mappings + prompt hints.
///
/// Resolution strategy (per tool):
/// 1. **Primary**: Find connectors whose `services` JSON array lists this tool by name.
/// 2. **Fallback**: If no connector services match, use `tool.requires_credential_type`
///    to match against connector names or credential `service_type` values.
///
/// Each credential field is mapped to an env var: `{CONNECTOR_NAME_UPPER}_{FIELD_KEY_UPPER}`.
/// For OAuth credentials with a refresh_token, automatically refreshes the access_token.
async fn resolve_credential_env_vars(
    pool: &DbPool,
    tools: &[PersonaToolDefinition],
    persona_id: &str,
    persona_name: &str,
) -> (Vec<(String, String)>, Vec<String>) {
    let mut env_vars: Vec<(String, String)> = Vec::new();
    let mut hints: Vec<String> = Vec::new();
    let mut seen_connectors: std::collections::HashSet<String> = std::collections::HashSet::new();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to load connectors for credential injection: {}", e);
            return (env_vars, hints);
        }
    };

    for tool in tools {
        // ── Primary: match tool name in connector services ──
        let mut matched_connector = false;
        for connector in &connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });

            if !tool_listed || !seen_connectors.insert(connector.name.clone()) {
                continue;
            }

            if inject_connector_credentials(
                pool,
                connector,
                &mut env_vars,
                &mut hints,
                persona_id,
                persona_name,
            ).await {
                matched_connector = true;
            }
        }

        // ── Fallback: match via requires_credential_type ──
        if !matched_connector {
            if let Some(ref cred_type) = tool.requires_credential_type {
                // Try matching connector by name (e.g. "google" → connector named "google")
                // or by name prefix/substring for common patterns
                for connector in &connectors {
                    if !seen_connectors.insert(connector.name.clone()) {
                        continue;
                    }

                    let connector_matches = connector.name == *cred_type
                        || connector.name.starts_with(cred_type)
                        || cred_type.starts_with(&connector.name);

                    if !connector_matches {
                        continue;
                    }

                    if inject_connector_credentials(
                        pool,
                        connector,
                        &mut env_vars,
                        &mut hints,
                        persona_id,
                        persona_name,
                    ).await {
                        matched_connector = true;
                        break;
                    }
                }

                // Last resort: query credentials directly by service_type
                if !matched_connector {
                    if let Ok(creds) = cred_repo::get_by_service_type(pool, cred_type) {
                        if let Some(cred) = creds.first() {
                            inject_credential(
                                pool,
                                cred,
                                cred_type,
                                cred_type,
                                &mut env_vars,
                                &mut hints,
                                persona_id,
                                persona_name,
                            ).await;
                        }
                    }
                }
            }
        }
    }

    (env_vars, hints)
}

/// Decrypt and inject all fields from a connector's first credential as env vars.
/// Returns true if credentials were found and injected.
async fn inject_connector_credentials(
    pool: &DbPool,
    connector: &crate::db::models::ConnectorDefinition,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) -> bool {
    let creds = match cred_repo::get_by_service_type(pool, &connector.name) {
        Ok(c) => c,
        Err(_) => return false,
    };

    if let Some(cred) = creds.first() {
        inject_credential(
            pool,
            cred,
            &connector.name,
            &connector.label,
            env_vars,
            hints,
            persona_id,
            persona_name,
        ).await;
        true
    } else {
        false
    }
}

/// Attempt to refresh an OAuth access_token using a stored refresh_token.
/// `override_client` can supply (client_id, client_secret) when the credential
/// itself doesn't store them (e.g. `app_managed` mode).
/// Returns the new access_token on success, or None on failure.
async fn try_refresh_oauth_token(
    fields: &HashMap<String, String>,
    connector_name: &str,
    override_client: Option<(&str, &str)>,
) -> Option<String> {
    let refresh_token = fields.get("refresh_token").filter(|v| !v.is_empty())?;

    // Resolve client credentials: prefer fields, then override, then fail
    let (cid, csec) = if let (Some(id), Some(secret)) = (
        fields.get("client_id").filter(|v| !v.is_empty()),
        fields.get("client_secret").filter(|v| !v.is_empty()),
    ) {
        (id.clone(), secret.clone())
    } else if let Some((id, secret)) = override_client {
        (id.to_string(), secret.to_string())
    } else {
        tracing::debug!("No client credentials available for OAuth refresh of '{}'", connector_name);
        return None;
    };
    let client_id = &cid;
    let client_secret = &csec;

    // Determine the token endpoint based on connector type
    let token_url = match connector_name {
        n if n.starts_with("google") || n == "gmail" || n == "google_calendar" || n == "google_drive" => {
            "https://oauth2.googleapis.com/token"
        }
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "slack" => "https://slack.com/api/oauth.v2.access",
        "github" => "https://github.com/login/oauth/access_token",
        _ => return None, // Unknown provider — skip refresh
    };

    tracing::info!("Refreshing OAuth access token for connector '{}'", connector_name);

    let response = reqwest::Client::new()
        .post(token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::warn!("OAuth token refresh failed for '{}' ({}): {}", connector_name, status, body);
        return None;
    }

    let value: serde_json::Value = response.json().await.ok()?;
    let new_token = value.get("access_token")?.as_str()?.to_string();

    tracing::info!("Successfully refreshed OAuth access token for '{}'", connector_name);
    Some(new_token)
}

/// Decrypt a single credential and inject its fields as env vars.
/// For OAuth credentials, automatically refreshes expired access tokens.
#[allow(clippy::too_many_arguments)]
async fn inject_credential(
    pool: &DbPool,
    cred: &crate::db::models::PersonaCredential,
    connector_name: &str,
    connector_label: &str,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) {
    let plaintext = if super::crypto::is_plaintext(&cred.iv) {
        cred.encrypted_data.clone()
    } else {
        match super::crypto::decrypt_from_db(&cred.encrypted_data, &cred.iv) {
            Ok(pt) => pt,
            Err(e) => {
                tracing::error!("Failed to decrypt credential '{}': {}", cred.name, e);
                return;
            }
        }
    };

    let mut fields: HashMap<String, String> = serde_json::from_str(&plaintext).unwrap_or_default();
    let prefix = connector_name.to_uppercase().replace('-', "_");

    // Auto-refresh OAuth token if refresh_token is present.
    // For app_managed credentials (no client_id in fields), resolve from platform env.
    if fields.get("refresh_token").map_or(false, |v| !v.is_empty()) {
        let override_client = if fields.get("client_id").map_or(true, |v| v.is_empty()) {
            // Resolve platform-managed client credentials for Google connectors
            let is_google = connector_name.starts_with("google")
                || connector_name == "gmail"
                || connector_name == "google_calendar"
                || connector_name == "google_drive";
            if is_google {
                super::google_oauth::resolve_google_oauth_env_credentials()
                    .ok()
                    .map(|(id, secret)| (id, secret))
            } else {
                None
            }
        } else {
            None
        };
        let override_ref = override_client.as_ref().map(|(id, sec)| (id.as_str(), sec.as_str()));
        if let Some(fresh_token) = try_refresh_oauth_token(&fields, connector_name, override_ref).await {
            fields.insert("access_token".to_string(), fresh_token.clone());
            // Persist the refreshed token back to the credential store
            let updated_json = serde_json::to_string(&fields).unwrap_or_default();
            if !updated_json.is_empty() {
                match super::crypto::encrypt_for_db(&updated_json) {
                    Ok((encrypted, iv)) => {
                        let _ = cred_repo::update(pool, &cred.id, crate::db::models::UpdateCredentialInput {
                            name: None,
                            service_type: None,
                            encrypted_data: Some(encrypted),
                            iv: Some(iv),
                            metadata: None,
                        });
                    }
                    Err(e) => {
                        tracing::warn!("Failed to persist refreshed token for '{}': {}", connector_name, e);
                    }
                }
            }
        }
    }

    // Internal metadata fields that shouldn't be exposed as env vars
    const SKIP_FIELDS: &[&str] = &[
        "oauth_client_mode", "client_id", "client_secret",
        "token_type", "expiry_date", "expires_in",
    ];

    for (field_key, field_val) in &fields {
        if SKIP_FIELDS.contains(&field_key.as_str()) || field_val.is_empty() {
            continue;
        }
        let env_key = format!("{}_{}", prefix, field_key.to_uppercase().replace('-', "_"));
        env_vars.push((env_key.clone(), field_val.clone()));
        hints.push(format!(
            "`{}` (from {} credential '{}')",
            env_key, connector_label, cred.name
        ));
    }

    let _ = cred_repo::mark_used(pool, &cred.id);
    let _ = audit_log::insert(
        pool,
        &cred.id,
        &cred.name,
        "decrypt",
        Some(persona_id),
        Some(persona_name),
        Some(&format!("injected via connector '{}'", connector_label)),
    );
}
