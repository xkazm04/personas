use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::db::models::{
    CreateManualReviewInput, CreateMessageInput, CreatePersonaEventInput, CreatePersonaMemoryInput,
    Persona, PersonaToolDefinition,
};
use crate::db::repos::communication::{
    events as event_repo, manual_reviews as review_repo, messages as msg_repo,
};
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::execution::tool_usage as usage_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
};
use crate::db::DbPool;

use super::logger::ExecutionLogger;
use super::parser;
use super::prompt;
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

    // Parse model profile
    let mut model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());

    // Resolve global Ollama API key when provider is "ollama" and no per-persona auth token
    if let Some(ref mut profile) = model_profile {
        if profile.provider.as_deref() == Some("ollama") {
            let needs_global_key = profile.auth_token.as_ref().map_or(true, |t| t.is_empty());
            if needs_global_key {
                if let Ok(Some(global_key)) =
                    crate::db::repos::core::settings::get(&pool, "ollama_api_key")
                {
                    if !global_key.is_empty() {
                        profile.auth_token = Some(global_key);
                    }
                }
            }
        }
    }

    // Resolve global LiteLLM settings when provider is "litellm" and no per-persona values
    if let Some(ref mut profile) = model_profile {
        if profile.provider.as_deref() == Some("litellm") {
            let needs_global_url = profile.base_url.as_ref().map_or(true, |u| u.is_empty());
            if needs_global_url {
                if let Ok(Some(global_url)) =
                    crate::db::repos::core::settings::get(&pool, "litellm_base_url")
                {
                    if !global_url.is_empty() {
                        profile.base_url = Some(global_url);
                    }
                }
            }

            let needs_global_key = profile.auth_token.as_ref().map_or(true, |t| t.is_empty());
            if needs_global_key {
                if let Ok(Some(global_key)) =
                    crate::db::repos::core::settings::get(&pool, "litellm_master_key")
                {
                    if !global_key.is_empty() {
                        profile.auth_token = Some(global_key);
                    }
                }
            }
        }
    }

    // Build CLI args
    let mut cli_args = prompt::build_cli_args(&persona, &model_profile);

    // Inject decrypted service credentials as env vars
    let (cred_env, cred_hints) = resolve_credential_env_vars(&pool, &tools, &persona.id, &persona.name);
    for (key, val) in cred_env {
        cli_args.env_overrides.push((key, val));
    }

    // Assemble prompt (with credential env var hints)
    let hint_refs: Vec<&str> = cred_hints.iter().map(|s| s.as_str()).collect();
    let prompt_text = prompt::assemble_prompt(
        &persona,
        &tools,
        input_data.as_ref(),
        if hint_refs.is_empty() {
            None
        } else {
            Some(&hint_refs)
        },
    );

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

    // Create temp directory for isolated execution
    let exec_dir = std::env::temp_dir().join(format!("personas-exec-{}", &execution_id));
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
                "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code"
                    .to_string()
            } else {
                format!("Failed to spawn Claude CLI: {}", e)
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
                    status: "failed".into(),
                    error: Some(error_msg.clone()),
                    duration_ms: Some(duration_ms),
                    cost_usd: None,
                },
            );

            // Clean up temp dir
            let _ = std::fs::remove_dir_all(&exec_dir);

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

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        let _ = stdin.write_all(&prompt_bytes).await;
        let _ = stdin.shutdown().await;
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

    // Read stderr in background
    let stderr_handle = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut buf).await;
        buf
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

            // Parse stream line
            let (line_type, display) = parser::parse_stream_line(&line);

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
                        handle_protocol_message(
                            &app,
                            &pool_for_stream,
                            &protocol_msg,
                            &exec_id_for_stream,
                            &persona_id_for_stream,
                            &project_id_for_stream,
                            &persona_name_for_stream,
                            notif_channels_for_stream.as_deref(),
                            &mut logger,
                        );
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

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&exec_dir);

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

    let session_limit_reached = error
        .as_ref()
        .map(|e| e.contains("Session limit"))
        .unwrap_or(false);

    // Emit final status
    let _ = app.emit(
        "execution-status",
        ExecutionStatusEvent {
            execution_id: execution_id.clone(),
            status: if success { "completed" } else { "failed" }.into(),
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

/// Handle a protocol message by writing to the appropriate DB table.
#[allow(clippy::too_many_arguments)]
fn handle_protocol_message(
    app: &AppHandle,
    pool: &DbPool,
    msg: &ProtocolMessage,
    execution_id: &str,
    persona_id: &str,
    project_id: &str,
    persona_name: &str,
    notification_channels: Option<&str>,
    logger: &mut ExecutionLogger,
) {
    match msg {
        ProtocolMessage::UserMessage {
            title,
            content,
            content_type,
            priority,
        } => {
            match msg_repo::create(
                pool,
                CreateMessageInput {
                    persona_id: persona_id.to_string(),
                    execution_id: Some(execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    content_type: content_type.clone(),
                    priority: priority.clone(),
                    metadata: None,
                },
            ) {
                Ok(m) => {
                    logger.log(&format!(
                        "[MESSAGE] Created: {} ({})",
                        m.title.as_deref().unwrap_or("untitled"),
                        m.id
                    ));
                    crate::notifications::notify_new_message(
                        app,
                        persona_name,
                        m.title.as_deref().unwrap_or("New message"),
                        notification_channels,
                    );
                }
                Err(e) => logger.log(&format!("[MESSAGE] Failed to create: {}", e)),
            }
        }
        ProtocolMessage::PersonaAction {
            target,
            action,
            input,
        } => {
            match event_repo::publish(
                pool,
                CreatePersonaEventInput {
                    event_type: "persona_action".to_string(),
                    source_type: "persona".to_string(),
                    source_id: Some(persona_id.to_string()),
                    target_persona_id: None, // Resolved by event bus in Phase 6
                    project_id: Some(project_id.to_string()),
                    payload: Some(
                        serde_json::json!({
                            "target": target,
                            "action": action,
                            "input": input,
                        })
                        .to_string(),
                    ),
                },
            ) {
                Ok(_) => logger.log(&format!(
                    "[EVENT] Published persona_action targeting '{}'",
                    target
                )),
                Err(e) => logger.log(&format!("[EVENT] Failed to publish persona_action: {}", e)),
            }
        }
        ProtocolMessage::EmitEvent { event_type, data } => {
            match event_repo::publish(
                pool,
                CreatePersonaEventInput {
                    event_type: event_type.clone(),
                    source_type: "persona".to_string(),
                    source_id: Some(persona_id.to_string()),
                    target_persona_id: None,
                    project_id: Some(project_id.to_string()),
                    payload: data.as_ref().map(|d| d.to_string()),
                },
            ) {
                Ok(_) => logger.log(&format!("[EVENT] Published custom event: {}", event_type)),
                Err(e) => logger.log(&format!("[EVENT] Failed to publish: {}", e)),
            }
        }
        ProtocolMessage::AgentMemory {
            title,
            content,
            category,
            importance,
            tags,
        } => {
            match mem_repo::create(
                pool,
                CreatePersonaMemoryInput {
                    persona_id: persona_id.to_string(),
                    source_execution_id: Some(execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    category: category.clone(),
                    importance: *importance,
                    tags: tags.as_ref().map(|t| serde_json::json!(t).to_string()),
                },
            ) {
                Ok(m) => logger.log(&format!("[MEMORY] Stored: {} ({})", title, m.id)),
                Err(e) => logger.log(&format!("[MEMORY] Failed to store: {}", e)),
            }
        }
        ProtocolMessage::ManualReview {
            title,
            description,
            severity,
            context_data,
            suggested_actions,
        } => {
            match review_repo::create(
                pool,
                CreateManualReviewInput {
                    execution_id: execution_id.to_string(),
                    persona_id: persona_id.to_string(),
                    title: title.clone(),
                    description: description.clone(),
                    severity: severity.clone(),
                    context_data: context_data.clone(),
                    suggested_actions: suggested_actions
                        .as_ref()
                        .map(|a| serde_json::json!(a).to_string()),
                },
            ) {
                Ok(r) => {
                    logger.log(&format!(
                        "[REVIEW] Created manual review: {} ({})",
                        title, r.id
                    ));
                    crate::notifications::notify_manual_review(
                        app,
                        persona_name,
                        title,
                        notification_channels,
                    );
                }
                Err(e) => logger.log(&format!("[REVIEW] Failed to create: {}", e)),
            }
        }
        ProtocolMessage::ExecutionFlow { .. } => {
            // Execution flows are handled at the top level, not here
            logger.log("[FLOW] Execution flow captured (will be stored on completion)");
        }
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
/// For each tool, finds connectors whose `services` JSON array contains the tool name,
/// then loads and decrypts credentials for those connectors. Each credential field is
/// mapped to an env var: `{CONNECTOR_NAME_UPPER}_{FIELD_KEY_UPPER}`.
fn resolve_credential_env_vars(
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
        for connector in &connectors {
            // Parse the connector's services JSON to check if this tool is listed
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

            // Load credentials for this connector
            let creds = match cred_repo::get_by_service_type(pool, &connector.name) {
                Ok(c) => c,
                Err(_) => continue,
            };

            if let Some(cred) = creds.first() {
                // Decrypt credential data
                let plaintext = if super::crypto::is_plaintext(&cred.iv) {
                    cred.encrypted_data.clone()
                } else {
                    match super::crypto::decrypt_from_db(&cred.encrypted_data, &cred.iv) {
                        Ok(pt) => pt,
                        Err(e) => {
                            tracing::error!("Failed to decrypt credential '{}': {}", cred.name, e);
                            continue;
                        }
                    }
                };

                // Parse JSON fields and map to env vars
                let fields: HashMap<String, String> =
                    serde_json::from_str(&plaintext).unwrap_or_default();
                let prefix = connector.name.to_uppercase().replace('-', "_");

                for (field_key, field_val) in &fields {
                    let env_key =
                        format!("{}_{}", prefix, field_key.to_uppercase().replace('-', "_"));
                    env_vars.push((env_key.clone(), field_val.clone()));
                    hints.push(format!(
                        "`{}` (from {} credential '{}')",
                        env_key, connector.label, cred.name
                    ));
                }

                // Mark credential as used and log the access
                let _ = cred_repo::mark_used(pool, &cred.id);
                let _ = audit_log::insert(
                    pool,
                    &cred.id,
                    &cred.name,
                    "decrypt",
                    Some(persona_id),
                    Some(persona_name),
                    Some(&format!("injected via connector '{}'", connector.label)),
                );
            }
        }
    }

    (env_vars, hints)
}
