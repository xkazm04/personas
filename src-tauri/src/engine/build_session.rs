//! BuildSessionManager: multi-turn build session lifecycle engine.
//!
//! Wraps the existing `CliProcessDriver` with per-session state tracking,
//! tokio::mpsc channels for user input, and checkpoint-based SQLite persistence.
//! Each build session runs as a long-lived tokio task that pauses on questions
//! and resumes when the user answers via the mpsc channel.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::db::models::{
    BuildEvent, BuildPhase, BuildSession, UpdateBuildSession, UserAnswer,
};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

use super::cli_process::{read_line_limited, CliProcessDriver};
use super::prompt;
use super::types::CliArgs;

// =============================================================================
// SessionHandle -- in-memory handle for an active build session
// =============================================================================

struct SessionHandle {
    input_tx: mpsc::Sender<UserAnswer>,
    cancel_flag: Arc<AtomicBool>,
    #[allow(dead_code)]
    session_id: String,
}

// =============================================================================
// BuildSessionManager -- the public API
// =============================================================================

pub struct BuildSessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
}

impl BuildSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a new build session. Creates the DB row, spawns a tokio task,
    /// and returns the session ID immediately.
    #[allow(clippy::too_many_arguments)]
    pub fn start_session(
        &self,
        session_id: String,
        persona_id: String,
        intent: String,
        channel: Channel<BuildEvent>,
        pool: DbPool,
        registry: Arc<ActiveProcessRegistry>,
        workflow_json: Option<String>,
        parser_result_json: Option<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<String, AppError> {
        let (input_tx, input_rx) = mpsc::channel::<UserAnswer>(32);
        let cancel_flag = Arc::new(AtomicBool::new(false));

        // Create the DB row
        let now = chrono::Utc::now().to_rfc3339();
        let session = BuildSession {
            id: session_id.clone(),
            persona_id: persona_id.clone(),
            phase: BuildPhase::Initializing,
            resolved_cells: "{}".to_string(),
            pending_question: None,
            agent_ir: None,
            intent: intent.clone(),
            error_message: None,
            cli_pid: None,
            workflow_json: workflow_json.clone(),
            parser_result_json: parser_result_json.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        build_session_repo::create(&pool, &session)?;

        // Insert the session handle
        let handle = SessionHandle {
            input_tx,
            cancel_flag: cancel_flag.clone(),
            session_id: session_id.clone(),
        };
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            sessions.insert(session_id.clone(), handle);
        }

        // Build CLI args — force Sonnet for speed in build sessions
        let mut cli_args = prompt::build_cli_args(None, None);
        cli_args.args.push("--model".to_string());
        cli_args.args.push("claude-sonnet-4-20250514".to_string());

        // Query available credentials and connectors for context-aware prompt
        let credentials = credential_repo::get_all(&pool).unwrap_or_default();
        let connectors = connector_repo::get_all(&pool).unwrap_or_default();

        let cred_summary: Vec<String> = credentials
            .iter()
            .map(|c| format!("- {} (type: {})", c.name, c.service_type))
            .collect();
        let connector_summary: Vec<String> = connectors
            .iter()
            .map(|c| format!("- {} (category: {})", c.name, c.category))
            .collect();

        // Build the system prompt that wraps the user intent with dimension framework
        let system_prompt = build_session_prompt(&intent, &cred_summary, &connector_summary);

        // Spawn the session task
        let sessions_map = self.sessions.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            run_session(
                sid,
                persona_id,
                system_prompt, // Use the full system prompt, not raw intent
                channel,
                input_rx,
                pool,
                cli_args,
                registry,
                cancel_flag,
                sessions_map,
                workflow_json,
                parser_result_json,
                app_handle,
            )
            .await;
        });

        Ok(session_id)
    }

    /// Send a user answer to an active session, resuming the build task.
    pub fn send_answer(&self, session_id: &str, answer: UserAnswer) -> Result<(), AppError> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let handle = sessions.get(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Build session {session_id}"))
        })?;

        handle
            .input_tx
            .try_send(answer)
            .map_err(|e| AppError::Internal(format!("Failed to send answer: {e}")))?;
        Ok(())
    }

    /// Cancel an active session: set the cancel flag, kill the CLI process,
    /// remove the handle, and update DB phase to Cancelled.
    pub fn cancel_session(
        &self,
        session_id: &str,
        pool: &DbPool,
        registry: &ActiveProcessRegistry,
    ) -> Result<(), AppError> {
        // Set cancel flag and remove handle
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(handle) = sessions.remove(session_id) {
                handle.cancel_flag.store(true, Ordering::Release);
            }
        }

        // Cancel in the process registry
        registry.cancel_run("build_session", session_id);
        if let Some(pid) = registry.take_run_pid("build_session", session_id) {
            super::kill_process(pid);
        }

        // Update DB phase
        build_session_repo::update(
            pool,
            session_id,
            &UpdateBuildSession {
                phase: Some(BuildPhase::Cancelled.as_str().to_string()),
                ..Default::default()
            },
        )?;

        Ok(())
    }

    /// List active (in-memory) session IDs.
    pub fn get_session_ids(&self) -> Vec<String> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.keys().cloned().collect()
    }
}

// =============================================================================
// run_session -- the long-lived tokio task body
// =============================================================================

#[allow(clippy::too_many_arguments)]
async fn run_session(
    session_id: String,
    _persona_id: String,
    intent: String,
    channel: Channel<BuildEvent>,
    mut input_rx: mpsc::Receiver<UserAnswer>,
    pool: DbPool,
    cli_args: CliArgs,
    registry: Arc<ActiveProcessRegistry>,
    cancel_flag: Arc<AtomicBool>,
    sessions_map: Arc<Mutex<HashMap<String, SessionHandle>>>,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
    app_handle: tauri::AppHandle,
) {
    // Register run in ActiveProcessRegistry
    let _reg_flag = registry.register_run("build_session", &session_id);

    // Update phase to Analyzing
    let _ = update_phase(&pool, &session_id, BuildPhase::Analyzing);
    emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Analyzing, 0, 0);

    // Spawn CLI process
    let mut driver = match CliProcessDriver::spawn_temp(&cli_args, "build-session") {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(session_id = %session_id, error = %e, "Failed to spawn CLI for build session");
            let _ = update_phase_with_error(&pool, &session_id, &format!("CLI spawn failed: {e}"));
            emit_error(&channel, &app_handle, &session_id, &format!("Failed to start build: {e}"), false);
            cleanup_session(&sessions_map, &registry, &session_id);
            return;
        }
    };

    // Register PID
    if let Some(pid) = driver.pid() {
        registry.set_run_pid("build_session", &session_id, pid);
        let _ = build_session_repo::update(
            &pool,
            &session_id,
            &UpdateBuildSession {
                cli_pid: Some(Some(pid)),
                ..Default::default()
            },
        );
    }

    // Build the full prompt: intent + optional workflow context
    let full_prompt = if let (Some(ref wf_json), Some(ref parser_json)) = (&workflow_json, &parser_result_json) {
        // Workflow import mode: enrich intent with parsed workflow data
        let wf_preview = if wf_json.len() > 8000 { &wf_json[..8000] } else { wf_json.as_str() };
        format!(
            "{intent}\n\n\
             ## Workflow Import Context\n\
             This agent is being created from an imported workflow. Use the parsed analysis below \
             as a structural baseline — auto-resolve dimensions that are clearly defined in the workflow, \
             but still ask questions for connectors (check credentials), human-review, and memory strategy.\n\n\
             ### Parsed Workflow Analysis (AgentIR)\n\
             {parser_json}\n\n\
             ### Original Workflow JSON (preview)\n\
             {wf_preview}\n"
        )
    } else {
        intent.clone()
    };

    // Write prompt to stdin (keep stdin open for subsequent Q&A writes)
    if let Err(e) = driver.write_stdin_line(full_prompt.as_bytes()).await {
        tracing::error!(session_id = %session_id, error = %e, "Failed to write intent to CLI stdin");
        let _ = update_phase_with_error(&pool, &session_id, &format!("Failed to send intent: {e}"));
        emit_error(&channel, &app_handle, &session_id, &format!("Failed to send intent to build process: {e}"), false);
        let _ = driver.kill().await;
        cleanup_session(&sessions_map, &registry, &session_id);
        return;
    }

    // Stream stdout line by line
    let mut reader = match driver.take_stdout_reader() {
        Some(r) => r,
        None => {
            tracing::error!(session_id = %session_id, "No stdout from CLI process");
            let _ = update_phase_with_error(&pool, &session_id, "No output from CLI process");
            emit_error(&channel, &app_handle, &session_id, "Build process produced no output", false);
            let _ = driver.kill().await;
            cleanup_session(&sessions_map, &registry, &session_id);
            return;
        }
    };

    let mut resolved_cells = serde_json::Map::new();
    let mut resolved_count: usize = 0;
    let mut total_count: usize = 0;
    let mut last_output = String::new();

    loop {
        // Check cancellation
        if cancel_flag.load(Ordering::Acquire) {
            tracing::info!(session_id = %session_id, "Build session cancelled");
            let _ = driver.kill().await;
            cleanup_session(&sessions_map, &registry, &session_id);
            return;
        }

        match read_line_limited(&mut reader).await {
            Ok(Some(line)) => {
                last_output.push_str(&line);
                last_output.push('\n');

                // Parse line into events (handles CLI envelope unwrapping)
                let events = parse_build_line(&line, &session_id);

                // Process events: first handle all CellUpdates, then Question (which blocks)
                let mut pending_question_event: Option<BuildEvent> = None;

                for event in events {
                    match &event {
                        BuildEvent::CellUpdate { cell_key, data, .. } => {
                            if cell_key == "agent_ir" {
                                // Store agent_ir in DB
                                let ir_str = serde_json::to_string(data).ok();
                                let _ = build_session_repo::update(
                                    &pool,
                                    &session_id,
                                    &UpdateBuildSession {
                                        agent_ir: Some(ir_str),
                                        ..Default::default()
                                    },
                                );
                            } else if cell_key == "_test_report" {
                                // Test report handling
                                let passed = data.get("status")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s == "ready")
                                    .unwrap_or(false);
                                let summary = data.get("summary")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Test completed")
                                    .to_string();
                                let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                                    phase: Some(BuildPhase::TestComplete.as_str().to_string()),
                                    ..Default::default()
                                });
                                emit_session_status(&channel, &app_handle, &session_id, BuildPhase::TestComplete, resolved_count, 8);
                                let progress_event = BuildEvent::Progress {
                                    session_id: session_id.clone(),
                                    dimension: None,
                                    message: summary,
                                    percent: None,
                                };
                                dual_emit(&channel, &app_handle, &progress_event);
                            } else {
                                resolved_cells.insert(cell_key.clone(), data.clone());
                                resolved_count += 1;

                                // Checkpoint after each resolved cell
                                let resolved_json = serde_json::to_string(
                                    &serde_json::Value::Object(resolved_cells.clone()),
                                )
                                .unwrap_or_else(|_| "{}".to_string());
                                let _ = build_session_repo::update(
                                    &pool,
                                    &session_id,
                                    &UpdateBuildSession {
                                        phase: Some(BuildPhase::Resolving.as_str().to_string()),
                                        resolved_cells: Some(resolved_json),
                                        ..Default::default()
                                    },
                                );
                            }
                            dual_emit(&channel, &app_handle, &event);
                        }
                        BuildEvent::Question { .. } => {
                            // Defer question handling until after all CellUpdates are processed
                            pending_question_event = Some(event);
                        }
                        BuildEvent::SessionStatus { total_count: tc, .. } => {
                            total_count = *tc;
                            dual_emit(&channel, &app_handle, &event);
                        }
                        _ => {
                            dual_emit(&channel, &app_handle, &event);
                        }
                    }
                }

                // Handle pending question (blocks on mpsc recv)
                if let Some(q_event) = pending_question_event {
                    if let BuildEvent::Question { ref question, ref cell_key, ref options, .. } = q_event {
                        // Checkpoint question state
                        let question_json = serde_json::json!({
                            "cell_key": cell_key,
                            "question": question,
                            "options": options,
                        });
                        let _ = build_session_repo::update(
                            &pool,
                            &session_id,
                            &UpdateBuildSession {
                                phase: Some(BuildPhase::AwaitingInput.as_str().to_string()),
                                pending_question: Some(Some(
                                    serde_json::to_string(&question_json).unwrap_or_default(),
                                )),
                                ..Default::default()
                            },
                        );

                        // Emit the question to frontend
                        dual_emit(&channel, &app_handle, &q_event);

                        // Wait for user answer via mpsc
                        match input_rx.recv().await {
                            Some(answer) => {
                                tracing::info!(
                                    session_id = %session_id,
                                    cell_key = %answer.cell_key,
                                    "Received user answer for build session"
                                );
                                let _ = build_session_repo::update(
                                    &pool,
                                    &session_id,
                                    &UpdateBuildSession {
                                        phase: Some(BuildPhase::Resolving.as_str().to_string()),
                                        pending_question: Some(None),
                                        ..Default::default()
                                    },
                                );
                                emit_session_status(
                                    &channel,
                                    &app_handle,
                                    &session_id,
                                    BuildPhase::Resolving,
                                    resolved_count,
                                    total_count,
                                );

                                // Forward the answer to the CLI subprocess stdin
                                let answer_json = serde_json::json!({
                                    "cell_key": answer.cell_key,
                                    "answer": answer.answer,
                                });
                                let answer_text = answer_json.to_string();
                                if let Err(e) = driver.write_stdin_line(answer_text.as_bytes()).await {
                                    tracing::warn!(
                                        session_id = %session_id,
                                        error = %e,
                                        "Failed to write answer to CLI stdin"
                                    );
                                }
                            }
                            None => {
                                tracing::info!(
                                    session_id = %session_id,
                                    "Input channel closed, ending build session"
                                );
                                let _ = driver.kill().await;
                                cleanup_session(&sessions_map, &registry, &session_id);
                                return;
                            }
                        }
                    }
                }
            }
            Ok(None) => {
                // EOF -- CLI process finished
                break;
            }
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "Error reading CLI output");
                break;
            }
        }
    }

    // Close stdin to signal no more input
    if let Some(mut stdin) = driver.child.stdin.take() {
        let _ = stdin.shutdown().await;
    }

    // Wait for process exit
    let exit_status = driver.finish().await;

    let final_phase = match &exit_status {
        Ok(status) if status.success() => BuildPhase::DraftReady,
        _ => BuildPhase::Failed,
    };

    // Try to parse the accumulated output as agent IR
    let agent_ir = parse_agent_ir(&last_output);

    // Final checkpoint
    let resolved_json =
        serde_json::to_string(&serde_json::Value::Object(resolved_cells)).unwrap_or_else(|_| "{}".to_string());
    let mut final_update = UpdateBuildSession {
        phase: Some(final_phase.as_str().to_string()),
        resolved_cells: Some(resolved_json),
        cli_pid: Some(None), // Clear PID
        pending_question: Some(None),
        ..Default::default()
    };

    if let Some(ir) = &agent_ir {
        final_update.agent_ir = Some(Some(ir.clone()));
    }

    if final_phase == BuildPhase::Failed {
        let error_msg = match &exit_status {
            Ok(status) => format!("CLI exited with status: {status}"),
            Err(e) => format!("CLI process error: {e}"),
        };
        final_update.error_message = Some(Some(error_msg.clone()));
        emit_error(&channel, &app_handle, &session_id, &error_msg, true);
    }

    let _ = build_session_repo::update(&pool, &session_id, &final_update);

    // Emit final status
    emit_session_status(
        &channel,
        &app_handle,
        &session_id,
        final_phase,
        resolved_count,
        total_count,
    );

    // Cleanup
    cleanup_session(&sessions_map, &registry, &session_id);
}

// =============================================================================
// build_session_prompt -- wraps user intent with 8-dimension framework
// =============================================================================

fn build_session_prompt(
    intent: &str,
    credentials: &[String],
    connectors: &[String],
) -> String {
    let cred_section = if credentials.is_empty() {
        "No credentials configured. Ask the user which services they need and note that credentials must be added in the Vault.".to_string()
    } else {
        format!("Available credentials:\n{}", credentials.join("\n"))
    };

    let connector_section = if connectors.is_empty() {
        "No connectors configured. The app has a built-in messaging system available by default.".to_string()
    } else {
        format!(
            "Available connectors:\n{}\n\nThe app also has a built-in messaging system available by default.",
            connectors.join("\n")
        )
    };

    format!(
r#"You are building an AI agent in the Personas app. The user described what they want:

"{intent}"

## How Personas Works
Personas is a desktop app where users build AI agents by configuring 8 dimensions in a visual grid. Analyze the intent carefully, ask meaningful questions, and produce a production-quality agent configuration.

## The 8 Dimensions
- **use-cases** — What tasks/workflows the agent handles. Break down into 3-6 distinct use cases.
- **connectors** — External services/APIs it needs (Gmail, GitHub, Slack, databases). MUST check credentials.
- **triggers** — When it runs: schedule (cron), webhook, polling, manual, or event-based.
- **messages** — How it delivers results using notifications and status updates.
- **human-review** — Whether it needs human approval before acting on external consequences.
- **memory** — What the agent remembers between runs (business facts, preferences, learned patterns).
- **error-handling** — What happens on failure: retry, timeout, fallback, escalation.
- **events** — Events it subscribes to or emits for inter-agent coordination.

## Available Credentials (from user's Vault)
{cred_section}

## Available Connectors (configured in app)
{connector_section}

## Output Format — STRICT JSON only, one object per line, NO markdown

### Per-dimension resolution (when resolving a dimension):
{{"dimension": "triggers", "status": "resolved", "data": {{"items": ["Schedule: every 6 hours", "Manual trigger for on-demand runs"]}}}}

### Ask a question (include 2-4 options):
{{"question": "Your question here?", "dimension": "connectors", "options": ["Option A", "Option B", "Option C"]}}

Output MULTIPLE resolved events + one question in a single response to be efficient.

### When ALL 8 are resolved, emit the full agent definition:
{{"agent_ir": {{"name": "Agent Name", "description": "What this agent does", "system_prompt": "Complete system prompt", "structured_prompt": {{"identity": "...", "instructions": "...", "toolGuidance": "...", "examples": "...", "errorHandling": "..."}}, "icon": "Sparkles", "color": "#8b5cf6", "tools": [{{"name": "tool_name", "category": "email", "description": "What it does", "requires_credential_type": "google", "implementation_guide": "API endpoint, auth, curl example"}}], "triggers": [{{"trigger_type": "schedule", "config": {{}}, "description": "Every 6 hours"}}], "required_connectors": [{{"name": "google", "n8n_credential_type": "", "has_credential": false}}], "design_context": {{"summary": "Overview", "use_cases": []}}, "use_cases": ["Use case 1"], "connectors": ["Service 1"], "triggers_summary": ["Schedule"], "human_review": {{"required": true}}, "messages": {{"channels": ["built-in"]}}, "memory": {{"strategy": "progressive"}}, "error_handling": {{"retry": true}}, "events": []}}}}

## CRITICAL: Mandatory Question Rules
You MUST ask at least one question for EACH of these dimensions (do NOT auto-resolve them):
1. **connectors** — ALWAYS ask. Check Available Credentials. Warn about missing ones.
2. **human-review** — ALWAYS ask about approval gates for actions with external consequences.
3. **memory** — ALWAYS ask about what the agent should learn and remember across runs.

## CRITICAL: Connectors Dimension Rules
The connectors dimension CANNOT be auto-resolved. CHECK the Available Credentials list. If a required service is NOT listed, warn the user. If it IS available, confirm it.

## Refinement Support
If the conversation contains a refinement request, update affected dimensions and re-output the agent_ir.

## Test Support
If asked to test, analyze the configuration and report:
{{"test_report": {{"status": "ready"|"blocked", "issues": [], "can_proceed": true|false, "summary": "Assessment"}}}}

## General Rules
1. Ask meaningful questions — each should elicit a choice that changes agent behavior
2. data.items = short descriptive bullets of what was decided
3. Output RAW JSON only — no markdown, no code fences, no explanatory text
4. Dimension keys EXACT: use-cases, connectors, triggers, messages, human-review, memory, error-handling, events
5. Include implementation_guide for EVERY tool with API endpoint, auth pattern, curl example

Analyze the intent now:"#
    )
}

// =============================================================================
// Helpers
// =============================================================================

/// Parse a single line of CLI output into zero or more BuildEvents.
///
/// The Claude CLI with `--output-format stream-json --verbose` wraps output in
/// envelopes like `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`.
/// We unwrap the envelope to extract the LLM's actual text, then parse that text
/// for structured question/dimension/error JSON objects. A single response can
/// contain multiple resolved dimensions + one question.
fn parse_build_line(line: &str, session_id: &str) -> Vec<BuildEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Try parsing as JSON
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON lines emitted as progress
            return vec![BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: trimmed.to_string(),
                percent: None,
            }];
        }
    };

    let obj = match json.as_object() {
        Some(o) => o,
        None => return vec![],
    };

    // Check for CLI streaming envelope
    let envelope_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match envelope_type {
        "system" | "rate_limit_event" => return vec![], // Skip system messages
        "assistant" => {
            // Unwrap: message.content[].text
            let text = obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                        .and_then(|item| item.get("text").and_then(|t| t.as_str()))
                });
            if let Some(text) = text {
                return parse_llm_text_content(text, session_id);
            }
            return vec![];
        }
        "result" => {
            // Unwrap: result field (string)
            if let Some(result_text) = obj.get("result").and_then(|v| v.as_str()) {
                return parse_llm_text_content(result_text, session_id);
            }
            return vec![];
        }
        _ => {} // Fall through to direct JSON parsing (backward compat)
    }

    // Not an envelope — try direct parsing (backward compat for non-envelope output)
    parse_json_object(obj, &json, session_id)
        .map(|e| vec![e])
        .unwrap_or_default()
}

/// Parse the LLM's actual text content (unwrapped from CLI envelope).
/// Handles multiple JSON objects per response (e.g., 3 resolved dimensions + 1 question).
fn parse_llm_text_content(text: &str, session_id: &str) -> Vec<BuildEvent> {
    let mut events = Vec::new();

    // Strip markdown code fences
    let cleaned = text
        .replace("```json", "")
        .replace("```", "");

    // Try each line as a potential JSON object
    for line in cleaned.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(obj) = val.as_object() {
                if let Some(event) = parse_json_object(obj, &val, session_id) {
                    events.push(event);
                }
            }
        }
    }

    // If no structured events found, emit the text as progress
    if events.is_empty() && !text.trim().is_empty() {
        // Truncate long progress messages
        let msg = if text.len() > 200 { &text[..200] } else { text };
        events.push(BuildEvent::Progress {
            session_id: session_id.to_string(),
            dimension: None,
            message: msg.trim().to_string(),
            percent: None,
        });
    }

    events
}

/// Parse a single JSON object into a BuildEvent.
fn parse_json_object(
    obj: &serde_json::Map<String, serde_json::Value>,
    full_val: &serde_json::Value,
    session_id: &str,
) -> Option<BuildEvent> {
    // Question detection
    if obj.contains_key("question") {
        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let question = obj.get("question")?.as_str()?.to_string();
        let options = obj.get("options").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
        });
        return Some(BuildEvent::Question {
            session_id: session_id.to_string(),
            cell_key,
            question,
            options,
        });
    }

    // Agent IR detection
    if obj.contains_key("agent_ir") {
        let ir_data = obj.get("agent_ir").cloned().unwrap_or_default();
        return Some(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "agent_ir".to_string(),
            data: ir_data,
            status: "resolved".to_string(),
        });
    }

    // Test report detection
    if obj.contains_key("test_report") {
        let report = obj.get("test_report").cloned().unwrap_or_default();
        return Some(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "_test_report".to_string(),
            data: report,
            status: "resolved".to_string(),
        });
    }

    // Dimension/cell update detection
    if obj.contains_key("dimension") || obj.contains_key("cell_key") {
        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let data = obj
            .get("data")
            .or_else(|| obj.get("result"))
            .cloned()
            .unwrap_or(full_val.clone());
        let status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("resolved")
            .to_string();
        return Some(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key,
            data,
            status,
        });
    }

    // Error detection
    if obj.contains_key("error") {
        let message = obj
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string();
        let retryable = obj
            .get("retryable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        return Some(BuildEvent::Error {
            session_id: session_id.to_string(),
            cell_key: obj.get("cell_key").and_then(|v| v.as_str()).map(|s| s.to_string()),
            message,
            retryable,
        });
    }

    None // Not a recognized event type
}

/// Try to extract agent IR (the final JSON result) from accumulated output.
fn parse_agent_ir(output: &str) -> Option<String> {
    // Walk backwards through lines looking for the last complete JSON object
    for line in output.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                // Check if it looks like an agent IR (has typical fields)
                if let Some(obj) = val.as_object() {
                    if obj.contains_key("name")
                        || obj.contains_key("system_prompt")
                        || obj.contains_key("use_cases")
                        || obj.contains_key("result")
                    {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Update the session phase in the database.
fn update_phase(pool: &DbPool, session_id: &str, phase: BuildPhase) -> Result<(), AppError> {
    build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(phase.as_str().to_string()),
            ..Default::default()
        },
    )
}

/// Update the session phase to Failed and store the error message.
fn update_phase_with_error(
    pool: &DbPool,
    session_id: &str,
    error: &str,
) -> Result<(), AppError> {
    build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Failed.as_str().to_string()),
            error_message: Some(Some(error.to_string())),
            cli_pid: Some(None),
            ..Default::default()
        },
    )
}

/// Dual-emit a BuildEvent via both Channel (component-scoped) and Tauri events (global).
/// Channel delivers to the attached component; Tauri event reaches the global listener.
fn dual_emit(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    event: &BuildEvent,
) {
    let _ = channel.send(event.clone());
    let _ = app.emit("build-session-event", event);
}

/// Emit a SessionStatus event via Channel + Tauri.
fn emit_session_status(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    session_id: &str,
    phase: BuildPhase,
    resolved_count: usize,
    total_count: usize,
) {
    let event = BuildEvent::SessionStatus {
        session_id: session_id.to_string(),
        phase: phase.as_str().to_string(),
        resolved_count,
        total_count,
    };
    dual_emit(channel, app, &event);
}

/// Emit an Error event via Channel + Tauri.
fn emit_error(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    session_id: &str,
    message: &str,
    retryable: bool,
) {
    let event = BuildEvent::Error {
        session_id: session_id.to_string(),
        cell_key: None,
        message: message.to_string(),
        retryable,
    };
    dual_emit(channel, app, &event);
}

/// Remove the session handle from the in-memory map and unregister from
/// the process registry.
fn cleanup_session(
    sessions_map: &Arc<Mutex<HashMap<String, SessionHandle>>>,
    registry: &ActiveProcessRegistry,
    session_id: &str,
) {
    {
        let mut sessions = sessions_map.lock().unwrap_or_else(|e| e.into_inner());
        sessions.remove(session_id);
    }
    registry.unregister_run("build_session", session_id);
}
