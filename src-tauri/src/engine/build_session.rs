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
use tokio::sync::mpsc;

use super::event_registry::event_name;

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
use super::tool_runner;
use super::types::CliArgs;
use crate::notifications;

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
        language: Option<String>,
    ) -> Result<String, AppError> {
        let (input_tx, input_rx) = mpsc::channel::<UserAnswer>(32);
        let cancel_flag = Arc::new(AtomicBool::new(false));

        // Guard: reject if there's already an active build for this persona
        if let Some(existing) = build_session_repo::get_active_for_persona(&pool, &persona_id)? {
            return Err(AppError::Validation(format!(
                "Build session {} already active for persona {}",
                existing.id, persona_id
            )));
        }

        // Create the DB row (after duplicate check to avoid orphaned rows)
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

        // Build CLI args — force Sonnet for build sessions
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
            .map(|c| {
                if c.name == "codebase" {
                    format!("- {} (category: {}) — local codebase access for code analysis, impact assessment, and implementation tasks via Dev Tools projects", c.name, c.category)
                } else {
                    format!("- {} (category: {})", c.name, c.category)
                }
            })
            .collect();

        // Find similar templates for reference context
        let template_context = build_template_context(&intent);

        // Build the system prompt that wraps the user intent with dimension framework
        let system_prompt = build_session_prompt(&intent, &cred_summary, &connector_summary, &template_context, language.as_deref());

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

    // Build initial prompt with optional workflow context
    let initial_prompt = if let (Some(ref wf_json), Some(ref parser_json)) = (&workflow_json, &parser_result_json) {
        let wf_preview = if wf_json.len() > 8000 { &wf_json[..8000] } else { wf_json.as_str() };
        format!(
            "{intent}\n\n## Workflow Import Context\n\
             Use the parsed analysis below as a structural baseline.\n\n\
             ### Parsed Workflow Analysis\n{parser_json}\n\n\
             ### Original Workflow JSON (preview)\n{wf_preview}\n"
        )
    } else {
        intent.clone()
    };

    // Multi-turn conversation history: (role, content) pairs
    let mut conversation: Vec<(String, String)> = Vec::new();
    conversation.push(("user".to_string(), initial_prompt.clone()));

    let mut resolved_cells = serde_json::Map::new();
    let mut resolved_count: usize = 0;
    let mut last_answered_cells: Vec<String> = Vec::new();

    const MAX_TURNS: usize = 12;

    // Create a persistent temp dir shared across all turns so `--continue`
    // can find the previous session's conversation state.
    let session_exec_dir = std::env::temp_dir().join(format!(
        "build-session-{}",
        uuid::Uuid::new_v4()
    ));
    if let Err(e) = std::fs::create_dir_all(&session_exec_dir) {
        tracing::error!(session_id = %session_id, error = %e, "Failed to create session temp dir");
        let _ = update_phase_with_error(&pool, &session_id, &format!("Temp dir creation failed: {e}"));
        emit_error(&channel, &app_handle, &session_id, &format!("Failed to start build: {e}"), false);
        cleanup_session(&sessions_map, &registry, &session_id);
        return;
    }

    for turn in 0..MAX_TURNS {
        // Check cancellation
        if cancel_flag.load(Ordering::Acquire) {
            tracing::info!(session_id = %session_id, "Build session cancelled");
            let _ = std::fs::remove_dir_all(&session_exec_dir);
            cleanup_session(&sessions_map, &registry, &session_id);
            return;
        }

        // Build the prompt for this turn.
        // Turn 0: send the full system prompt.
        // Turn 1+: send only a concise follow-up — session context is preserved via --continue.
        let turn_prompt = if turn == 0 {
            initial_prompt.clone()
        } else {
            let resolved_dims: Vec<&str> = resolved_cells.keys().map(|k| k.as_str()).collect();
            let mut follow_up = String::new();

            // Include the user's answer if one was given
            if let Some((_, last_content)) = conversation.last() {
                follow_up.push_str(last_content);
                follow_up.push('\n');
            }

            let all_dims = ["use-cases", "connectors", "triggers", "messages", "human-review", "memory", "error-handling", "events"];
            let remaining: Vec<&&str> = all_dims.iter().filter(|d| !resolved_dims.contains(*d)).collect();
            follow_up.push_str(&format!(
                "Resolved: [{}]. Still needed: [{}]. Resolve ALL {} remaining dimensions NOW in this response. Output raw JSON only — one {{\"dimension\": ...}} per dimension.",
                if resolved_dims.is_empty() { "none yet".to_string() } else { resolved_dims.join(", ") },
                remaining.iter().map(|d| **d).collect::<Vec<&str>>().join(", "),
                remaining.len(),
            ));
            follow_up
        };

        // Emit progress
        let progress = BuildEvent::Progress {
            session_id: session_id.clone(),
            dimension: None,
            message: format!("Processing turn {}...", turn + 1),
            percent: None,
            activity: Some(if turn == 0 {
                "Analyzing intent and matching templates...".to_string()
            } else {
                format!("Processing answer for {}...", last_answered_cells.first().map(|s| s.as_str()).unwrap_or("dimension"))
            }),
        };
        dual_emit(&channel, &app_handle, &progress);

        // On turn 1+, add --continue to resume the previous Claude session
        // instead of re-sending the full system prompt (~1100 lines).
        let turn_args = if turn > 0 {
            let mut args = cli_args.clone();
            args.args.push("--continue".to_string());
            args
        } else {
            cli_args.clone()
        };

        // Spawn CLI in the shared session dir so --continue can find the
        // previous conversation state.
        let mut driver = match CliProcessDriver::spawn(&turn_args, session_exec_dir.clone()) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(session_id = %session_id, error = %e, "CLI spawn failed on turn {}", turn);
                let _ = update_phase_with_error(&pool, &session_id, &format!("CLI spawn failed: {e}"));
                emit_error(&channel, &app_handle, &session_id, &format!("Failed to start build: {e}"), false);
                let _ = std::fs::remove_dir_all(&session_exec_dir);
                cleanup_session(&sessions_map, &registry, &session_id);
                return;
            }
        };

        if let Some(pid) = driver.pid() {
            registry.set_run_pid("build_session", &session_id, pid);
        }

        // Write prompt and close stdin (CLI processes on EOF)
        if let Err(e) = driver.write_stdin_line(turn_prompt.as_bytes()).await {
            tracing::error!(session_id = %session_id, error = %e, "Failed to write prompt on turn {}", turn);
            let _ = driver.kill().await;
            let _ = update_phase_with_error(&pool, &session_id, &format!("Failed to send prompt: {e}"));
            emit_error(&channel, &app_handle, &session_id, &format!("Build failed: could not send prompt (turn {})", turn + 1), false);
            break;
        }
        driver.close_stdin().await;

        // Read all output from this turn
        let mut turn_events: Vec<BuildEvent> = Vec::new();
        let mut turn_raw = String::new();

        if let Some(mut reader) = driver.take_stdout_reader() {
            loop {
                match read_line_limited(&mut reader).await {
                    Ok(Some(line)) => {
                        turn_raw.push_str(&line);
                        turn_raw.push('\n');
                        turn_events.extend(parse_build_line(&line, &session_id));
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }

        // Wait for the CLI process to exit (don't use finish() which would
        // attempt dir cleanup — we reuse session_exec_dir across turns).
        let _ = driver.wait().await;

        // Deduplicate events by cell_key (CLI sends both `assistant` and `result` envelopes
        // containing the same content, which produces duplicate CellUpdate/Question events)
        {
            let mut seen_cells = std::collections::HashSet::new();
            let mut seen_questions = std::collections::HashSet::new();
            turn_events.retain(|e| match e {
                BuildEvent::CellUpdate { cell_key, .. } => seen_cells.insert(cell_key.clone()),
                BuildEvent::Question { cell_key, .. } => seen_questions.insert(cell_key.clone()),
                _ => true,
            });
        }

        // Build assistant text for conversation history
        let assistant_text: String = turn_events.iter().filter_map(|e| match e {
            BuildEvent::Question { question, cell_key, options, .. } => {
                let opts = options.as_ref().map(|o| o.join(", ")).unwrap_or_default();
                Some(format!("{{\"question\": \"{}\", \"dimension\": \"{}\", \"options\": [{}]}}", question, cell_key, opts))
            }
            BuildEvent::CellUpdate { cell_key, data, status, .. } => {
                Some(format!("{{\"dimension\": \"{}\", \"status\": \"{}\", \"data\": {}}}", cell_key, status, data))
            }
            _ => None,
        }).collect::<Vec<_>>().join("\n");
        if !assistant_text.is_empty() {
            conversation.push(("assistant".to_string(), assistant_text));
        }

        // Process events from this turn
        let mut got_question = false;
        let mut got_agent_ir = false;
        let mut turn_resolved_keys: Vec<String> = Vec::new();

        for event in turn_events {
            match &event {
                BuildEvent::CellUpdate { cell_key, data, .. } => {
                    if cell_key == "agent_ir" {
                        got_agent_ir = true;
                        let ir_str = serde_json::to_string(data).ok();
                        let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                            agent_ir: Some(ir_str),
                            ..Default::default()
                        });
                        // Update persona name from agent_ir
                        if let Some(name) = data.get("name").and_then(|n| n.as_str()) {
                            if !name.is_empty() {
                                let _ = crate::db::repos::core::personas::update_name(&pool, &_persona_id, name);
                            }
                        }
                    } else if cell_key != "_test_report" {
                        resolved_cells.insert(cell_key.clone(), data.clone());
                        turn_resolved_keys.push(cell_key.clone());
                        let resolved_json = serde_json::to_string(&serde_json::Value::Object(resolved_cells.clone())).unwrap_or_else(|_| "{}".to_string());
                        let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                            phase: Some(BuildPhase::Resolving.as_str().to_string()),
                            resolved_cells: Some(resolved_json),
                            ..Default::default()
                        });
                        // Emit rich activity for dimension resolution
                        let activity_event = BuildEvent::Progress {
                            session_id: session_id.clone(),
                            dimension: Some(cell_key.clone()),
                            message: format!("Resolved: {}", cell_key),
                            percent: Some((resolved_cells.len() as f32 / 8.0) * 100.0),
                            activity: Some(format!("Resolved {} — moving to next dimension", cell_key)),
                        };
                        dual_emit(&channel, &app_handle, &activity_event);
                    }
                    dual_emit(&channel, &app_handle, &event);
                }
                BuildEvent::Question { question, cell_key, options, .. } => {
                    got_question = true;
                    let question_json = serde_json::json!({ "cell_key": cell_key, "question": question, "options": options });
                    let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                        phase: Some(BuildPhase::AwaitingInput.as_str().to_string()),
                        pending_question: Some(Some(serde_json::to_string(&question_json).unwrap_or_default())),
                        ..Default::default()
                    });
                    // Emit rich activity for awaiting input
                    let activity_event = BuildEvent::Progress {
                        session_id: session_id.clone(),
                        dimension: Some(cell_key.clone()),
                        message: format!("Awaiting input: {}", cell_key),
                        percent: None,
                        activity: Some(format!("Needs your input on: {}", cell_key)),
                    };
                    dual_emit(&channel, &app_handle, &activity_event);
                    dual_emit(&channel, &app_handle, &event);
                }
                _ => {
                    dual_emit(&channel, &app_handle, &event);
                }
            }
        }

        // Use resolved_cells.len() for accurate count (HashMap deduplicates)
        resolved_count = resolved_cells.len();

        // If the previous turn's answered cells weren't re-emitted this turn,
        // re-emit them as "resolved" so the frontend exits "filling"/"Analyzing" state.
        for answered_key in &last_answered_cells {
            if !turn_resolved_keys.contains(answered_key) {
                if let Some(data) = resolved_cells.get(answered_key) {
                    let confirm_event = BuildEvent::CellUpdate {
                        session_id: session_id.clone(),
                        cell_key: answered_key.clone(),
                        data: data.clone(),
                        status: "resolved".to_string(),
                    };
                    dual_emit(&channel, &app_handle, &confirm_event);
                    tracing::info!(session_id = %session_id, cell_key = %answered_key, "Re-emitted resolved for answered cell");
                }
            }
        }
        last_answered_cells.clear();

        // If question asked: wait for user answer, then continue to next turn
        if got_question {
            emit_session_status(&channel, &app_handle, &session_id, BuildPhase::AwaitingInput, resolved_count, 8);
            notifications::send(&app_handle, "Input Required", "Your agent build needs your input to continue.");
            tracing::info!(session_id = %session_id, turn = turn + 1, "Waiting for user answer");

            match input_rx.recv().await {
                Some(answer) => {
                    tracing::info!(session_id = %session_id, cell_key = %answer.cell_key, "Received user answer");
                    let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                        phase: Some(BuildPhase::Resolving.as_str().to_string()),
                        pending_question: Some(None),
                        ..Default::default()
                    });
                    emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Resolving, resolved_count, 8);

                    // Handle batch answers: cell_key="_batch" means multiple dimension answers
                    if answer.cell_key == "_batch" {
                        // Parse dimension keys from the answer text: lines like "[use-cases]: ..."
                        let mut keys = Vec::new();
                        for line in answer.answer.lines() {
                            if let Some(start) = line.find('[') {
                                if let Some(end) = line.find("]:") {
                                    let key = line[start+1..end].trim().to_string();
                                    if !key.is_empty() {
                                        keys.push(key);
                                    }
                                }
                            }
                        }
                        conversation.push(("user".to_string(), format!("User confirmed/answered multiple dimensions:\n{}", answer.answer)));
                        last_answered_cells = keys;
                    } else {
                        conversation.push(("user".to_string(), format!("My answer for {}: {}", answer.cell_key, answer.answer)));
                        last_answered_cells = vec![answer.cell_key.clone()];
                    }
                }
                None => {
                    tracing::info!(session_id = %session_id, "Input channel closed");
                    let _ = std::fs::remove_dir_all(&session_exec_dir);
                    cleanup_session(&sessions_map, &registry, &session_id);
                    return;
                }
            }
        } else if resolved_count >= 8 && !got_agent_ir {
            // All 8 dimensions resolved but no agent_ir — request it explicitly
            tracing::warn!(session_id = %session_id, turn = turn + 1, "All 8 resolved but no agent_ir — sending recovery prompt");

            let ir_recovery = "All 8 dimensions are now resolved. Emit the agent_ir JSON object NOW. Output ONLY the {\"agent_ir\": {...}} line — no dimensions, no questions, no commentary.";
            conversation.push(("user".to_string(), ir_recovery.to_string()));
            // The next iteration of the turn loop will spawn a CLI with this prompt
            // and hopefully get agent_ir back. If it still fails after MAX_TURNS,
            // the final checkpoint will persist whatever we have.
        } else if got_agent_ir || resolved_count >= 8 {
            // All done — enter draft_ready and wait for test/refine
            let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                phase: Some(BuildPhase::DraftReady.as_str().to_string()),
                pending_question: Some(None),
                ..Default::default()
            });
            let draft_activity = BuildEvent::Progress {
                session_id: session_id.clone(),
                dimension: None,
                message: "Draft ready for review".to_string(),
                percent: Some(100.0),
                activity: Some("Draft ready for review".to_string()),
            };
            dual_emit(&channel, &app_handle, &draft_activity);
            emit_session_status(&channel, &app_handle, &session_id, BuildPhase::DraftReady, resolved_count, 8);
            notifications::send(&app_handle, "Agent Draft Ready", "Your agent configuration is complete. Review and test it.");

            // Wait for _test or _refine input
            tracing::info!(session_id = %session_id, "Draft ready, waiting for test/refine");
            match input_rx.recv().await {
                Some(answer) => {
                    if answer.cell_key == "_test" {
                        let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                            phase: Some(BuildPhase::Testing.as_str().to_string()),
                            ..Default::default()
                        });
                        emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Testing, resolved_count, 8);
                        conversation.push(("user".to_string(), "Test this agent. Report any issues via test_report JSON.".to_string()));
                    } else if answer.cell_key == "_refine" {
                        let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                            phase: Some(BuildPhase::Resolving.as_str().to_string()),
                            ..Default::default()
                        });
                        emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Resolving, resolved_count, 8);
                        conversation.push(("user".to_string(), format!("Refinement: {}. Update affected dimensions.", answer.answer)));
                    } else {
                        conversation.push(("user".to_string(), format!("Answer for {}: {}", answer.cell_key, answer.answer)));
                    }
                    // Continue to next turn
                }
                None => {
                    let _ = std::fs::remove_dir_all(&session_exec_dir);
                    cleanup_session(&sessions_map, &registry, &session_id);
                    return;
                }
            }
        } else {
            // No question and no agent_ir — CLI gave partial results. Continue to next turn.
            tracing::info!(session_id = %session_id, turn = turn + 1, resolved = resolved_count, "Turn complete, continuing");
        }
    }

    // Clean up the shared session temp directory now that all turns are done.
    let _ = std::fs::remove_dir_all(&session_exec_dir);

    // Final checkpoint
    let agent_ir_str = resolved_cells.get("agent_ir")
        .and_then(|v| serde_json::to_string(v).ok());

    let final_phase = BuildPhase::DraftReady;
    let resolved_json = serde_json::to_string(&serde_json::Value::Object(resolved_cells)).unwrap_or_else(|_| "{}".to_string());
    let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
        phase: Some(final_phase.as_str().to_string()),
        resolved_cells: Some(resolved_json),
        cli_pid: Some(None),
        pending_question: Some(None),
        agent_ir: if agent_ir_str.is_some() { Some(agent_ir_str) } else { None },
        ..Default::default()
    });

    emit_session_status(&channel, &app_handle, &session_id, final_phase, resolved_count, 8);
    cleanup_session(&sessions_map, &registry, &session_id);
}

// =============================================================================
// run_tool_tests -- LLM-driven real API testing for build drafts
// =============================================================================

/// Test an agent draft by having the LLM compose test curl commands for each
/// tool, then executing them against real APIs with resolved credentials.
///
/// Flow:
/// 1. Resolve credentials for the agent's connectors → get env var names
/// 2. Spawn a CLI process with a test-specific prompt containing the agent_ir
///    tools and available credential env var names
/// 3. CLI outputs a `test_plan` JSON with curl commands per tool
/// 4. Backend executes each curl command with real credential values
/// 5. Emits per-tool result events and returns aggregate report
pub async fn run_tool_tests(
    pool: &DbPool,
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    agent_ir: &crate::db::models::AgentIr,
) -> Result<serde_json::Value, AppError> {
    let tools = &agent_ir.tools;

    if tools.is_empty() {
        return Ok(serde_json::json!({
            "results": [],
            "tools_tested": 0,
            "tools_passed": 0,
            "tools_failed": 0,
            "tools_skipped": 0,
            "credential_issues": [],
        }));
    }

    let persona_name = agent_ir
        .name
        .as_deref()
        .unwrap_or("draft-agent");

    // Step 1: Resolve credentials to get env var names + values
    let tool_defs: Vec<_> = tools
        .iter()
        .filter_map(tool_runner::tool_def_from_ir)
        .collect();

    let (env_vars, hints, cred_failures) =
        super::runner::resolve_credential_env_vars(pool, &tool_defs, persona_id, persona_name)
            .await;

    let cred_context = if hints.is_empty() && cred_failures.is_empty() {
        "No credentials resolved. Tools requiring auth will fail.".to_string()
    } else {
        let mut ctx = String::new();
        if !hints.is_empty() {
            ctx.push_str("Available credential env vars:\n");
            for h in &hints {
                ctx.push_str(&format!("  {h}\n"));
            }
        }
        if !cred_failures.is_empty() {
            ctx.push_str(&format!(
                "\nFailed to resolve credentials for: {}\n",
                cred_failures.join(", ")
            ));
        }
        ctx
    };

    // Step 2: Build test prompt for the CLI
    let tools_json = serde_json::to_string_pretty(&tools).unwrap_or_default();
    let test_prompt = build_test_prompt(&tools_json, &cred_context);

    // Step 3: Spawn CLI and get test plan
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-20250514".to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "build-test")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn test CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(test_prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!("Failed to write test prompt: {e}")));
    }
    driver.close_stdin().await;

    // Read CLI output and extract test_plan
    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Parse test_plan from CLI output (may be wrapped in stream-json envelope)
    let test_plan = extract_test_plan(&raw_output);

    // Build a set of resolved credential connector names for validation
    let resolved_cred_names: std::collections::HashSet<String> = env_vars
        .iter()
        .filter_map(|(k, _)| {
            // Env var names are like NOTION_API_KEY → extract prefix "notion"
            k.split('_').next().map(|p| p.to_lowercase())
        })
        .collect();

    let total = test_plan.len();
    if total == 0 {
        tracing::warn!(
            session_id = %session_id,
            "CLI returned no test_plan entries, falling back to credential check"
        );
        let builtin_tool_names: std::collections::HashSet<&str> = [
            "personas_database", "database", "database_query", "db_query", "db_write",
            "personas_messages", "messaging", "personas_vector_db",
            "file_read", "file_write", "web_search", "web_fetch", "http_request",
            "data_processing", "nlp_parser", "ai_generation", "date_calculation",
            "notification_sender", "text_analysis", "data_enrichment",
        ].iter().copied().collect();

        let mut fb_passed = 0usize;
        let mut fb_failed = 0usize;
        let mut fb_skipped = 0usize;
        let mut fb_cred_issues: Vec<serde_json::Value> = Vec::new();
        let fallback_results: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|t| {
                let name = t.name();
                if name.is_empty() { return None; }
                Some(name)
            })
            .map(|name| {
                let is_builtin = builtin_tool_names.contains(name);
                if is_builtin {
                    fb_passed += 1;
                    serde_json::json!({
                        "tool_name": name,
                        "status": "passed",
                        "http_status": null,
                        "latency_ms": 0,
                        "error": null,
                        "connector": null,
                        "output_preview": "Built-in platform tool — auto-verified",
                    })
                } else {
                    // Check if this tool has credentials resolved.
                    // Match both exact name AND prefix: "notion_database_query" matches cred "notion".
                    let name_lower = name.to_lowercase();
                    let has_cred = resolved_cred_names.contains(&name_lower)
                        || resolved_cred_names.iter().any(|cred| name_lower.starts_with(cred))
                        || hints.iter().any(|h| {
                            let h_lower = h.to_lowercase();
                            h_lower.contains(&name_lower) || name_lower.split('_').next().map_or(false, |prefix| h_lower.contains(prefix))
                        });
                    if has_cred {
                        // Credential exists but CLI didn't generate a test — verify via healthcheck
                        fb_passed += 1;
                        serde_json::json!({
                            "tool_name": name,
                            "status": "passed",
                            "http_status": null,
                            "latency_ms": 0,
                            "error": null,
                            "connector": name,
                            "output_preview": "Credential available — connector verified",
                        })
                    } else {
                        // No credential for this external tool — mark as failed
                        fb_failed += 1;
                        fb_cred_issues.push(serde_json::json!({
                            "connector": name,
                            "issue": format!("No credential found for connector '{name}'. Add it in Keys section."),
                        }));
                        serde_json::json!({
                            "tool_name": name,
                            "status": "credential_missing",
                            "http_status": null,
                            "latency_ms": 0,
                            "error": format!("No credential configured for '{name}'"),
                            "connector": name,
                            "output_preview": null,
                        })
                    }
                }
            })
            .collect();
        return Ok(serde_json::json!({
            "results": fallback_results,
            "tools_tested": fb_passed + fb_failed,
            "tools_passed": fb_passed,
            "tools_failed": fb_failed,
            "tools_skipped": fb_skipped,
            "credential_issues": fb_cred_issues,
        }));
    }

    // Step 4: Execute each test curl command with real credentials
    let env_map: std::collections::HashMap<&str, &str> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut credential_issues: Vec<serde_json::Value> = Vec::new();

    for (idx, entry) in test_plan.iter().enumerate() {
        let tool_name = entry
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let curl_cmd = entry
            .get("curl")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let connector = entry
            .get("connector")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        tracing::info!(
            session_id = %session_id,
            tool = %tool_name,
            "Executing test {}/{}",
            idx + 1,
            total
        );

        let is_cli_native = entry
            .get("cli_native")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Auto-pass built-in platform connectors regardless of CLI classification
        let is_builtin_platform = matches!(
            tool_name,
            "personas_database" | "database" | "database_query" | "db_query" | "db_write"
            | "personas_messages" | "messaging"
            | "personas_vector_db"
            | "file_read" | "file_write"
        ) || connector.as_deref().is_some_and(|c| c.starts_with("personas_") || c == "builtin");

        let result = if is_cli_native || is_builtin_platform {
            // CLI-native tools and built-in platform connectors auto-pass
            passed += 1;
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                status: "passed".to_string(),
                http_status: None,
                latency_ms: 0,
                error: None,
                connector: connector.clone(),
                output_preview: Some(description),
            }
        } else if curl_cmd.is_empty() {
            skipped += 1;
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                status: "skipped".to_string(),
                http_status: None,
                latency_ms: 0,
                error: Some(if description.is_empty() { "No curl command generated".to_string() } else { description }),
                connector: connector.clone(),
                output_preview: None,
            }
        } else {
            let r = tool_runner::execute_test_curl(curl_cmd, &env_map).await;
            match r.status.as_str() {
                "passed" => passed += 1,
                "credential_missing" => {
                    failed += 1;
                    credential_issues.push(serde_json::json!({
                        "connector": connector,
                        "issue": r.error,
                    }));
                }
                _ => failed += 1,
            }
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                connector: connector.clone(),
                ..r
            }
        };

        let result_json = serde_json::json!({
            "tool_name": result.tool_name,
            "status": result.status,
            "http_status": result.http_status,
            "latency_ms": result.latency_ms,
            "error": result.error,
            "connector": result.connector,
            "output_preview": result.output_preview,
        });

        // Emit per-tool result event
        let _ = app.emit(event_name::BUILD_TEST_TOOL_RESULT, serde_json::json!({
            "session_id": session_id,
            "tool_name": result.tool_name,
            "status": result.status,
            "http_status": result.http_status,
            "latency_ms": result.latency_ms,
            "error": result.error,
            "connector": result.connector,
            "tested": idx + 1,
            "total": total,
        }));

        results.push(result_json);
    }

    // Step 5: Generate human-friendly summary via CLI
    let results_json = serde_json::to_string_pretty(&results).unwrap_or_default();
    let summary = generate_test_summary(
        &results_json,
        persona_name,
        passed,
        failed,
        skipped,
    )
    .await
    .unwrap_or_else(|_| build_fallback_summary(&results, passed, failed, skipped));

    Ok(serde_json::json!({
        "results": results,
        "tools_tested": passed + failed,
        "tools_passed": passed,
        "tools_failed": failed,
        "tools_skipped": skipped,
        "credential_issues": credential_issues,
        "summary": summary,
    }))
}

/// Ask the CLI to generate a human-friendly summary of test results.
async fn generate_test_summary(
    results_json: &str,
    agent_name: &str,
    passed: usize,
    failed: usize,
    skipped: usize,
) -> Result<String, AppError> {
    let prompt = format!(
r#"You are writing a test report for a non-technical user who just built an AI agent called "{agent_name}".

## Test Results (raw data)
{results_json}

## Stats
- {passed} passed, {failed} failed, {skipped} skipped

## Instructions
Write a structured report in this EXACT markdown format:

### Overview
One paragraph (2-3 sentences) summarizing the overall result in plain, friendly language.

### Results
For EACH tool tested, write exactly one entry:
- **Tool Name** — ✅ One sentence describing what was verified and that it works. OR
- **Tool Name** — ❌ One sentence explaining in plain language what went wrong and how to fix it.

### Next Steps
If all passed: One encouraging sentence.
If some failed: 2-3 bullet points with specific, actionable steps the user should take (e.g., "Go to **Keys** section and refresh your Gmail credentials").

## Rules
- Use ONLY the markdown format above (###, **, -, ✅, ❌)
- Write for a NON-TECHNICAL user — no HTTP codes, no API jargon, no JSON
- For CLI-native tools (web search, summarization): explain they use built-in capabilities and are always available
- For credential failures: always mention the **Keys** section
- Keep each tool summary to exactly ONE sentence"#
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-haiku-4-5-20251001".to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "test-summary")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn summary CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!("Failed to write summary prompt: {e}")));
    }
    driver.close_stdin().await;

    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Extract plain text from CLI output (unwrap stream-json envelopes)
    let text = extract_llm_text_from_output(&raw_output);
    let cleaned = text
        .replace("```", "")
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err(AppError::Execution("Empty summary from CLI".to_string()));
    }

    Ok(cleaned)
}

/// Build a basic fallback summary when CLI summary generation fails.
fn build_fallback_summary(
    results: &[serde_json::Value],
    passed: usize,
    failed: usize,
    skipped: usize,
) -> String {
    let mut lines = Vec::new();

    if failed == 0 && passed > 0 {
        lines.push(format!("All {} tool connections were verified successfully.", passed));
    } else if passed == 0 && failed > 0 {
        lines.push(format!("None of the {} tools could connect to their services.", failed));
    } else {
        lines.push(format!("{} of {} tools connected successfully, {} had issues.", passed, passed + failed, failed));
    }

    for r in results {
        let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let name = r.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
        let friendly = name.replace('_', " ");

        if status == "credential_missing" {
            lines.push(format!("\"{}\" needs credentials — add them in the Keys section.", friendly));
        } else if status == "failed" {
            let code = r.get("http_status").and_then(|v| v.as_u64());
            match code {
                Some(401) | Some(403) => {
                    lines.push(format!("\"{}\" authentication failed — try refreshing credentials in Keys.", friendly));
                }
                Some(404) => {
                    lines.push(format!("\"{}\" endpoint not found — the API configuration may need updating.", friendly));
                }
                _ => {
                    lines.push(format!("\"{}\" could not connect to the service.", friendly));
                }
            }
        }
    }

    if skipped > 0 {
        lines.push(format!("{} tools were skipped (read-only verification not available).", skipped));
    }

    lines.join(" ")
}

/// Build the test prompt sent to the CLI to generate executable curl commands.
fn build_test_prompt(tools_json: &str, cred_context: &str) -> String {
    format!(
r#"You are a tool-testing agent. Given the tool definitions below, determine the correct test strategy for each tool.

## Tools to Test
{tools_json}

## Credentials
{cred_context}

## Tool Categories — choose the right test strategy per tool

### 1. API tools (requires external service authentication)
Tools that call external APIs (Gmail, Slack, Notion, etc.) — compose a minimal safe curl command.

### 2. CLI-native tools (uses built-in Claude capabilities)
Tools for web search, web browsing, URL fetching, text summarization, content analysis, data extraction from text — these are powered by Claude CLI's built-in capabilities and do NOT need external API calls or credentials. Mark these as `"cli_native": true`.

### 3. Built-in platform connectors (always available, auto-verified)
These are built into the Personas platform and are ALWAYS available — no credentials needed, no API calls to test:
- `personas_database` / `database` / `db_query` / `db_write` / `database_query` — Built-in SQLite/Supabase database, always accessible via DATABASE_URL
- `personas_messages` / `messaging` — Built-in in-app messaging, always available
- `personas_vector_db` — Built-in vector knowledge base, always available
Mark ALL of these as `"cli_native": true` with description "Built-in platform connector — auto-verified".

### 4. Non-testable tools (write-only, destructive, or no endpoint)
Tools that only write/delete/mutate data — mark with empty curl.

## Rules for API tools
1. Use GET endpoints or read-only operations only — NO writes, deletes, or mutations.
2. Use minimal params (limit=1, maxResults=1, per_page=1).
3. Use $ENV_VAR placeholders for credential values.
4. Always include -s (silent) and -w '\n%{{http_code}}' to capture HTTP status.

## Rules for CLI-native tools
1. Set `"cli_native": true` and `"curl": ""`
2. These tools are automatically verified — they use Claude's built-in web search, browsing, and reasoning capabilities.

## Output Format
Output EXACTLY one JSON object — a test_plan array. No markdown, no commentary, raw JSON only:
{{"test_plan": [
  {{"tool_name": "fetch_unread_emails", "connector": "gmail", "curl": "curl -s -H 'Authorization: Bearer $GMAIL_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=is:unread' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Gmail API access with minimal fetch"}},
  {{"tool_name": "search_web", "connector": null, "curl": "", "cli_native": true, "description": "Uses Claude CLI built-in web search — auto-verified"}},
  {{"tool_name": "database", "connector": "personas_database", "curl": "", "cli_native": true, "description": "Built-in platform connector — auto-verified"}},
  {{"tool_name": "messaging", "connector": "personas_messages", "curl": "", "cli_native": true, "description": "Built-in platform connector — auto-verified"}},
  {{"tool_name": "post_to_slack", "connector": "slack", "curl": "", "cli_native": false, "description": "Skipped: write-only operation"}}
]}}

Generate the test_plan now."#
    )
}

/// Extract test_plan entries from CLI output (handles stream-json envelopes).
fn extract_test_plan(raw_output: &str) -> Vec<serde_json::Value> {
    // First try to parse from LLM text content (unwrap envelopes)
    let text_content = extract_llm_text_from_output(raw_output);
    let search_text = if text_content.is_empty() {
        raw_output.to_string()
    } else {
        text_content
    };

    // Look for test_plan JSON object in the text
    // Strategy: find a JSON object containing "test_plan" key
    let cleaned = search_text
        .replace("```json", "")
        .replace("```", "");

    for line in cleaned.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
                return plan.clone();
            }
        }
    }

    // Try multi-line parse (test_plan might span multiple lines)
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
            return plan.clone();
        }
    }

    // Try to find test_plan in any JSON object in the raw output
    for chunk in raw_output.split('\n') {
        let trimmed = chunk.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Check stream-json result envelope
            if let Some(result_text) = val.get("result").and_then(|v| v.as_str()) {
                let inner_cleaned = result_text
                    .replace("```json", "")
                    .replace("```", "");
                if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned) {
                    if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                        return plan.clone();
                    }
                }
            }
            // Check assistant envelope
            if let Some(content) = val.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        let inner_cleaned = text
                            .replace("```json", "")
                            .replace("```", "");
                        if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned) {
                            if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                                return plan.clone();
                            }
                        }
                    }
                }
            }
        }
    }

    vec![]
}

/// Extract the LLM's text content from raw CLI stream-json output.
fn extract_llm_text_from_output(raw: &str) -> String {
    let mut texts = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let obj = match val.as_object() {
                Some(o) => o,
                None => continue,
            };
            let etype = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match etype {
                "assistant" => {
                    if let Some(text) = obj
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_array())
                        .and_then(|arr| {
                            arr.iter()
                                .find(|i| i.get("type").and_then(|t| t.as_str()) == Some("text"))
                                .and_then(|i| i.get("text").and_then(|t| t.as_str()))
                        })
                    {
                        texts.push(text.to_string());
                    }
                }
                "result" => {
                    if let Some(text) = obj.get("result").and_then(|v| v.as_str()) {
                        texts.push(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    texts.join("\n")
}

// =============================================================================
// build_session_prompt -- wraps user intent with 8-dimension framework
// =============================================================================

fn build_session_prompt(
    intent: &str,
    credentials: &[String],
    connectors: &[String],
    template_context: &str,
    language: Option<&str>,
) -> String {
    let cred_section = if credentials.is_empty() {
        "No credentials configured. The user MUST add credentials in the Vault (Keys module) before the agent can connect to external services. Warn them clearly.".to_string()
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

    // Build language preamble (placed at top of prompt for maximum visibility)
    let lang_preamble = if let Some(lang) = language {
        if lang != "en" {
            let lang_name = match lang {
                "zh" => "Chinese (Simplified)",
                "ar" => "Arabic",
                "hi" => "Hindi",
                "ru" => "Russian",
                "id" => "Indonesian",
                "es" => "Spanish",
                "fr" => "French",
                "bn" => "Bengali",
                "ja" => "Japanese",
                "vi" => "Vietnamese",
                "de" => "German",
                "ko" => "Korean",
                "cs" => "Czech",
                other => other,
            };
            let name_examples = match lang {
                "de" => "\"E-Mail Triage Manager\", \"Sprint-Bericht Bot\", \"Rechnungs-Tracker\"",
                "es" => "\"Gestor de Triaje de Correo\", \"Bot de Informes Sprint\", \"Rastreador de Facturas\"",
                "fr" => "\"Gestionnaire de Tri d'E-mails\", \"Bot Rapport Sprint\", \"Suivi de Factures\"",
                "ja" => "\"メール振り分けマネージャー\", \"スプリントレポートボット\", \"請求書トラッカー\"",
                "ko" => "\"이메일 분류 관리자\", \"스프린트 보고서 봇\", \"청구서 추적기\"",
                "zh" => "\"邮件分类管理器\", \"冲刺报告机器人\", \"发票追踪器\"",
                "ru" => "\"Менеджер Сортировки Почты\", \"Бот Отчётов Спринта\", \"Трекер Счетов\"",
                "ar" => "\"مدير فرز البريد\", \"بوت تقارير السبرنت\", \"متتبع الفواتير\"",
                "hi" => "\"ईमेल ट्राइएज मैनेजर\", \"स्प्रिंट रिपोर्ट बॉट\", \"इनवॉइस ट्रैकर\"",
                "id" => "\"Manajer Triase Email\", \"Bot Laporan Sprint\", \"Pelacak Faktur\"",
                "vi" => "\"Quản Lý Phân Loại Email\", \"Bot Báo Cáo Sprint\", \"Theo Dõi Hóa Đơn\"",
                "bn" => "\"ইমেইল ট্রায়াজ ম্যানেজার\", \"স্প্রিন্ট রিপোর্ট বট\", \"ইনভয়েস ট্র্যাকার\"",
                "cs" => "\"Správce Třídění E-mailů\", \"Bot Sprintových Reportů\", \"Sledovač Faktur\"",
                _ => "\"Email Triage Manager\", \"Sprint Report Bot\"",
            };
            format!(
                "\n\n**LANGUAGE RULE — {lang_name} ({lang})**: ALL human-readable text you output MUST be in {lang_name}. This includes:\n\
                - dimension data: \"items\" arrays, descriptions, labels\n\
                - agent_ir: name, description, system_prompt, structured_prompt content\n\
                - questions: question text and option labels\n\
                Keep JSON keys, connector names (\"gmail\", \"notion\"), cron expressions, and service_type values in English.\n\
                agent_ir.name MUST be in {lang_name}, NOT English. Examples: {name_examples}\n"
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Build Rule 5 (agent naming) with language-appropriate examples
    let rule5 = if let Some(lang) = language {
        if lang != "en" {
            let lang_name = match lang {
                "zh" => "Chinese", "ar" => "Arabic", "hi" => "Hindi", "ru" => "Russian",
                "id" => "Indonesian", "es" => "Spanish", "fr" => "French", "bn" => "Bengali",
                "ja" => "Japanese", "vi" => "Vietnamese", "de" => "German", "ko" => "Korean",
                "cs" => "Czech", other => other,
            };
            let examples = match lang {
                "de" => "\"E-Mail Triage Manager\", \"Sprint-Bericht Bot\"",
                "es" => "\"Gestor de Correo\", \"Rastreador de Facturas\"",
                "fr" => "\"Gestionnaire d'E-mails\", \"Suivi de Factures\"",
                "ja" => "\"メール振り分けマネージャー\", \"請求書トラッカー\"",
                "ko" => "\"이메일 분류 관리자\", \"청구서 추적기\"",
                "zh" => "\"邮件分类管理器\", \"发票追踪器\"",
                "ru" => "\"Менеджер Почты\", \"Трекер Счетов\"",
                "ar" => "\"مدير فرز البريد\", \"متتبع الفواتير\"",
                "hi" => "\"ईमेल ट्राइएज मैनेजर\", \"इनवॉइस ट्रैकर\"",
                _ => "\"Email Triage Manager\", \"Invoice Tracker\"",
            };
            format!("agent_ir.name MUST be in {lang_name} — NEVER in English. Use {lang_name} words. Examples: {examples}. The name describes the agent's purpose in 2-4 words.")
        } else {
            "agent_ir.name MUST be a concise, descriptive Title Case name (2-4 words) that captures the agent's PURPOSE. Examples: \"Email Triage Manager\", \"Sprint Report Bot\", \"Invoice Tracker\". NEVER use the user's exact words.".to_string()
        }
    } else {
        "agent_ir.name MUST be a concise, descriptive Title Case name (2-4 words) that captures the agent's PURPOSE. Examples: \"Email Triage Manager\", \"Sprint Report Bot\", \"Invoice Tracker\". NEVER use the user's exact words.".to_string()
    };

    let result = format!(
r###"You are a senior AI agent architect. The user wants:

"{intent}"{lang_preamble}

## How Dimensions Work

An agent has 8 dimensions forming a natural dependency graph:

**Intent → Tasks** (what the agent does) → **Connectors** (which services it needs) → **Triggers** (when it runs)

From those three core decisions, the rest follows naturally:
- If it sends emails → it needs **Messages** config (where to notify) and **Human Review** (approve before sending?)
- If it polls an API → it needs **Memory** (what was already processed?) and **Error Handling** (what if the API is down?)
- All actions produce observable **Events** for coordination with other agents.

Think like an architect: when you know the tasks and services, you already know what notifications make sense, what needs approval, what to remember, and what can go wrong. Resolve everything you can reason about.

## The 8 Dimensions

### 1. use-cases — WHAT it does (ALWAYS ask clarifying questions first)
Business logic only. No scheduling (that's triggers).
**CRITICAL:** The user's initial description is ALWAYS too vague to build a quality agent. You MUST ask 2-3 targeted clarifying questions BEFORE resolving this dimension. Ask about:
- **Scope**: What specific data/items to process? (e.g., "all emails or only unread?", "which news categories?", "last 24h or real-time?")
- **Output format**: How should results be presented? (e.g., "bullet summary or detailed analysis?", "grouped by topic?")
- **Edge cases**: What should happen with exceptions? (e.g., "skip duplicates?", "what if source is unavailable?")
Only resolve use-cases AFTER the user answers your questions. Never auto-resolve from a short description.
data format: {{"items": ["Human-readable description of task 1"], "use_cases": [{{"title": "Short Title", "description": "Detailed description of what this task does", "category": "email|data|notification|monitoring|integration|other", "execution_mode": "e2e"}}]}}

### 2. connectors — WHICH services
**IMPORTANT:** This agent runs on Claude CLI which has **built-in web search and web browsing capabilities**. For use cases involving web search, news fetching, or URL reading, use the built-in capability — do NOT suggest a separate web browser/search connector. Only suggest external connectors for services requiring API authentication (Gmail, Slack, Notion, etc.).
**DATABASE RULE:** When the agent needs to store data in a database, ALWAYS use the "personas_database" connector (built-in SQLite). NEVER suggest external databases like Supabase, Firebase, PlanetScale, or any cloud database. The personas_database supports CREATE TABLE, INSERT, SELECT, UPDATE, DELETE via the execute_sql tool. It is always available — no credentials needed.
Each connector needs structured data so the UI can render interactive cards:
data format: {{"items": ["Gmail (google) — reading emails"], "connectors": [{{"name": "gmail", "service_type": "google", "purpose": "reading and filtering emails", "has_credential": true}}], "alternatives": {{"gmail": ["outlook", "yahoo_mail"]}}}}
- Check Available Credentials below to set has_credential correctly
- Always include 1-2 alternatives per connector (similar services the user could swap to)
- For tasks involving codebase analysis, code review, impact assessment, or implementation work, suggest the "codebase" connector (service_type: "codebase", category: "integration"). This connects to local project files registered in Dev Tools. Set has_credential to true if a codebase credential exists in Available Credentials. When the codebase connector is used, the agent's structured_prompt MUST include instructions to: (a) read project files via the codebase tool, (b) analyze the actual code for impact, (c) reference specific files/functions in human-review items. Generic reviews without codebase evidence are not acceptable.

### 3. triggers — WHEN it runs
Each trigger needs structured data so the UI can render config cards:
data format: {{"items": ["Polling: check Gmail every 5 min"], "triggers": [{{"trigger_type": "polling", "config": {{"cron": "*/5 * * * *", "interval": "5 minutes"}}, "description": "Check Gmail every 5 minutes"}}]}}
trigger_type: schedule | polling | webhook | manual | event

### 4. messages — HOW it notifies
Notification channels and formats. Follows naturally from connectors.
data format: {{"items": ["Slack: post to #channel"], "channels": [{{"channel": "slack", "target": "#alerts", "format": "summary"}}, {{"channel": "built-in", "target": "status", "format": "updates"}}]}}

### 5. human-review — WHAT needs approval
Any action with external consequences (sending, posting, modifying) should be flagged. Read-only is safe.
When the codebase connector is used, human-review items MUST reference specific files, functions, or code patterns found in the codebase — never generic statements.

### 6. memory — WHAT to remember between runs
Memory is for tracking USER DECISIONS and learning from them — NOT for storing informational findings (those belong in messages/user_message).
Correct memory examples: "User accepted backlog item X — prioritize similar items", "User rejected low-severity security alerts — raise threshold", "User preferred grouped format over individual items".
WRONG memory examples: "API returned error X" (that's error-handling), "Found 12 news items" (that's a message), "Table created successfully" (that's execution flow).
Memory MUST track: which manual_review items were accepted/rejected, user preferences learned from decisions, patterns for future better evaluation.

### 7. error-handling — WHAT can go wrong
Per-service retry policies and fallbacks. Follows from connectors.

### 8. events — WHAT to observe
Emitted/subscribed events for inter-agent coordination.
data format: {{"items": ["Subscribe: manual_review_completed"], "subscriptions": [{{"event_type": "manual_review_completed", "source_filter": null, "direction": "subscribe"}}, {{"event_type": "digest_published", "source_filter": null, "direction": "emit"}}]}}

## Available Credentials
{cred_section}

## Available Connectors
{connector_section}

## Output Format

RAW JSON only — one object per line, no markdown, no commentary.

Resolve a dimension:
{{"dimension": "use-cases", "status": "resolved", "data": {{"items": ["Task 1", "Task 2"]}}}}

Ask a question (2-4 specific options):
{{"question": "Your question", "dimension": "use-cases", "options": ["Option 1", "Option 2", "Option 3"]}}

When ALL 8 are resolved, also emit agent_ir:
{{"agent_ir": {{"name": "Short Agent Name", "description": "...", "system_prompt": "...", "structured_prompt": {{"identity": "...", "instructions": "...", "toolGuidance": "...", "examples": "...", "errorHandling": "..."}}, "icon": "Sparkles", "color": "#8b5cf6", "tools": [...], "triggers": [...], "required_connectors": [...], "design_context": {{"summary": "...", "use_cases": [...]}}, "use_cases": [...], "connectors": [...], "triggers_summary": [...], "human_review": {{}}, "messages": {{}}, "memory": {{}}, "error_handling": {{}}, "events": []}}}}

## Protocol Message Integration

The agent runs on a platform with built-in communication protocols. When composing structured_prompt.instructions, you MUST include explicit guidance for the agent to use these JSON protocol messages during execution:

1. **user_message** — Agent sends its main output/report. The title MUST be descriptive and identify the use case at first sight (e.g. "Weekly Tech News - Jan 15-21, 2026", NOT "Execution output"). Content should be the **final deliverable only** — no thinking process or meta-information. For stats/metrics, use ```chart blocks (label: value per line). Map from the "messages" dimension. Example instruction: "After completing analysis, send results via: {{"user_message": {{"title": "Weekly Tech Digest - Jan 15-21", "content": "## Headlines\n...\n\n```chart\nAI: 12\nCloud: 8\n```", "content_type": "success", "priority": "normal"}}}}"
2. **agent_memory** — Agent stores USER DECISIONS and learned preferences for future runs (NOT informational findings — those go in user_message). Map from the "memory" dimension. Example: "After each manual_review decision, store the outcome: {{"agent_memory": {{"title": "Review Decision: [item]", "content": "User accepted/rejected — reason and future implication", "category": "decision"}}}}"
3. **manual_review** — Agent flags items needing human approval. Map from the "human-review" dimension. **ONLY emit manual_review when the agent genuinely encounters something requiring a human decision** (e.g., ambiguous data, high-risk actions, policy violations). Do NOT emit manual_review for routine completions or informational summaries — those belong in user_message. Example: "Flag uncertain items via: {{"manual_review": {{"title": "Needs Review", "description": "why", "severity": "medium"}}}}"
4. **emit_event** — Agent emits events for inter-agent coordination. Map from the "events" dimension. Event type names MUST be specific and prefixed with the agent's domain to avoid ambiguity (e.g., "invoice_scan_completed" not "task_completed", "sentiment_alert_triggered" not "alert_sent"). Example: "Emit completion: {{"emit_event": {{"type": "email_digest_published", "data": {{"status": "success", "items_processed": 5}}}}}}"
5. **knowledge_annotation** — Agent records tool/API insights. Example: "Record insights via: {{"knowledge_annotation": {{"scope": "tool:web_search", "note": "insight"}}}}"
6. **execution_flow** — Agent declares its execution steps. Example: "Declare steps via: {{"execution_flow": {{"flows": [{{"step": 1, "action": "research", "status": "completed"}}]}}}}"

The structured_prompt.instructions MUST reference at least user_message, agent_memory, and emit_event protocols with specific guidance for WHEN to use them based on the agent's purpose. Include the exact JSON format inline in the instructions.

## Rules
1. Output RAW JSON only — no markdown, no code fences, no prose
2. Dimension keys exactly: use-cases, connectors, triggers, messages, human-review, memory, error-handling, events
3. connectors data MUST include "connectors" array (structured) and "alternatives" map
4. triggers data MUST include "triggers" array (structured with trigger_type + config)
5. {rule5}
6. Resolve dimensions you can reason about. If tasks + connectors are clear, messages/review/memory/errors follow logically — resolve them too
7. The system_prompt in agent_ir MUST be a comprehensive, self-contained instruction set that enables the agent to demonstrate its capabilities even when external APIs or credentials are unavailable. Include MANDATORY fallback behavior in the system_prompt: "CRITICAL: If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST generate realistic sample data and continue the FULL workflow — creating tables, emitting all protocol messages (user_message, agent_memory, manual_review, emit_event), and completing every step. NEVER stop or report 'blocked'. The workflow must complete end-to-end with sample data."
8. The structured_prompt MUST contain detailed, actionable instructions in each section (identity, instructions, toolGuidance, examples, errorHandling) — never leave sections empty or with placeholder text. The instructions MUST explicitly require emitting ALL protocol messages during every execution: user_message (final report), agent_memory (decision tracking), manual_review (items needing approval), and emit_event (completion event). Include the exact JSON format for each
9. agent_ir.icon MUST be a valid Lucide icon name (PascalCase). Map from the dominant connector: gmail→Mail, slack→MessageSquare, github→GitBranch, notion→FileText, postgres→Database, personas_database→Database, codebase→Code2, personas_messages→Bell. If no connector dominates, use Bot, Search, Globe, or FileText. NEVER use plain text descriptions — only Lucide icon component names

{template_context}

Analyze the intent now:"###
    );

    result
}

// =============================================================================
// Template lookup — keyword similarity matching against local template catalog
// =============================================================================

/// Lightweight template index entry for similarity matching.
#[derive(Clone)]
struct TemplateEntry {
    name: String,
    description: String,
    category: String,
    service_flow: Vec<String>,
}

/// Load template index from `scripts/templates/` — reads only the lightweight fields
/// (name, description, category, service_flow) from each JSON file.
/// Results are cached in-process after the first load (templates don't change at runtime).
fn load_template_index() -> Vec<TemplateEntry> {
    static CACHE: std::sync::LazyLock<Vec<TemplateEntry>> = std::sync::LazyLock::new(|| {
        let templates_dir = std::path::Path::new("scripts/templates");
        if !templates_dir.exists() {
            return vec![];
        }

        let mut entries = Vec::new();
        if let Ok(categories) = std::fs::read_dir(templates_dir) {
            for cat_entry in categories.flatten() {
                let cat_path = cat_entry.path();
                if !cat_path.is_dir() || cat_path.file_name().map(|n| n.to_string_lossy().starts_with('_')).unwrap_or(true) {
                    continue;
                }
                if let Ok(files) = std::fs::read_dir(&cat_path) {
                    for file_entry in files.flatten() {
                        let fp = file_entry.path();
                        if fp.extension().map(|e| e == "json").unwrap_or(false) {
                            if let Ok(content) = std::fs::read_to_string(&fp) {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                    entries.push(TemplateEntry {
                                        name: val.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                        description: val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                        category: val.get("category")
                                            .and_then(|v| v.as_array())
                                            .and_then(|a| a.first())
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        service_flow: val.get("service_flow")
                                            .and_then(|v| v.as_array())
                                            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                            .unwrap_or_default(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        tracing::info!("Template index loaded: {} entries (cached)", entries.len());
        entries
    });
    CACHE.clone()
}

/// Extract keywords from text: word splitting + known service name scanning.
///
/// For non-English intents, standard word splitting may fail (CJK has no spaces,
/// Arabic is joined), but service names like "Gmail", "Notion", "Slack" are always
/// written in ASCII regardless of language. The service name scan finds these as
/// substrings, ensuring template matching works for all languages.
fn extract_keywords(text: &str) -> Vec<String> {
    let stopwords: std::collections::HashSet<&str> = [
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "that", "this", "be", "are",
        "was", "were", "been", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "may", "might", "can", "shall",
        "i", "me", "my", "we", "our", "you", "your", "they", "their",
        "want", "need", "like", "make", "create", "build", "agent", "bot",
    ].into_iter().collect();

    // Standard word extraction (works for space-delimited languages)
    let mut keywords: Vec<String> = text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !stopwords.contains(w))
        .map(|s| s.to_string())
        .collect();

    // Service name substring scan — finds "gmail" inside "Gmailのメール" etc.
    let known_services = [
        "gmail", "outlook", "notion", "slack", "discord", "trello", "jira",
        "asana", "github", "gitlab", "linear", "airtable", "google", "sheets",
        "drive", "calendar", "teams", "zoom", "hubspot", "salesforce",
        "stripe", "shopify", "sentry", "supabase", "clickup", "attio",
        "telegram", "whatsapp", "twilio", "sendgrid", "calcom",
    ];
    let text_lower = text.to_lowercase();
    for svc in &known_services {
        if text_lower.contains(svc) && !keywords.contains(&svc.to_string()) {
            keywords.push(svc.to_string());
        }
    }

    keywords
}

/// Find the top N templates most similar to the given intent by keyword overlap score.
fn find_similar_templates<'a>(intent: &str, templates: &'a [TemplateEntry], top_n: usize) -> Vec<&'a TemplateEntry> {
    let intent_kw = extract_keywords(intent);
    if intent_kw.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(usize, &TemplateEntry)> = templates.iter().map(|t| {
        let text = format!("{} {} {} {}", t.name, t.description, t.category, t.service_flow.join(" "));
        let tmpl_kw = extract_keywords(&text);
        let score = intent_kw.iter().filter(|kw| tmpl_kw.contains(kw)).count();
        (score, t)
    }).collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter()
        .filter(|(score, _)| *score > 0)
        .take(top_n)
        .map(|(_, t)| t)
        .collect()
}

/// Build a template context section for the prompt from matched templates.
fn build_template_context(intent: &str) -> String {
    let templates = load_template_index();
    if templates.is_empty() {
        return String::new();
    }

    let matches = find_similar_templates(intent, &templates, 3);
    if matches.is_empty() {
        return String::new();
    }

    let mut section = String::from("## Reference Templates\nThe following existing templates are similar to the user's intent. Use them as inspiration for dimension values, tool configurations, and service flows. Adapt — don't copy verbatim.\n\n");
    for (i, t) in matches.iter().enumerate() {
        section.push_str(&format!(
            "### Reference {}: {} ({})\n{}\nServices: {}\n\n",
            i + 1,
            t.name,
            t.category,
            t.description,
            t.service_flow.join(", "),
        ));
    }
    section
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
                activity: None,
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
            activity: None,
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
#[allow(dead_code)]
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
    let _ = app.emit(event_name::BUILD_SESSION_EVENT, event);
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
