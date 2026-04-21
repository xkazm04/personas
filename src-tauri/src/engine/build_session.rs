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
// HandleDropGuard -- ensures session handles are removed on task exit/panic
// =============================================================================

struct HandleDropGuard {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    session_id: String,
}

impl Drop for HandleDropGuard {
    fn drop(&mut self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.remove(&self.session_id).is_some() {
            tracing::info!(session_id = %self.session_id, "HandleDropGuard: removed stale session handle");
        }
    }
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

        // Multi-draft builds: a persona can have multiple concurrent active
        // sessions (e.g. user iterates on the same draft in parallel tabs).
        // Sessions are uniquely keyed by session_id in the BuildSessionManager
        // map and in the buildSessions DB table, so there's no collision risk.
        // The frontend matrixBuildSlice routes events to the correct session
        // via event.session_id.

        // Create the DB row
        let now = chrono::Utc::now().to_rfc3339();
        let session = BuildSession {
            id: session_id.clone(),
            persona_id: persona_id.clone(),
            phase: BuildPhase::Initializing,
            resolved_cells: "{}".to_string(),
            pending_question: None,
            agent_ir: None,
            adoption_answers: None,
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
                } else if c.name == "obsidian_memory" {
                    format!("- {} (category: {}) — graph-aware Obsidian vault access: search notes, walk backlinks, list MOCs/orphans, append to today's daily journal, write structured meeting notes. Prefer this connector for 'search my notes', 'what links to X', 'log this to my journal', and 'capture meeting' intents.", c.name, c.category)
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
        let guard_map = self.sessions.clone();
        let guard_sid = session_id.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            let _handle_guard = HandleDropGuard {
                sessions: guard_map,
                session_id: guard_sid,
            };
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

    // Note: process activity for agent builds is tracked frontend-side via 'agent_build' domain
    // (see UnifiedMatrixEntry/MatrixAdoptionView). No backend emission needed here.

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
            // v3 capability-framework follow-up: --continue preserves the full
            // prior conversation, so the LLM already knows its progress. We
            // just echo the user's answer and nudge it to continue.
            let resolved_dims: Vec<&str> = resolved_cells.keys().map(|k| k.as_str()).collect();
            let mut follow_up = String::new();

            if let Some((_, last_content)) = conversation.last() {
                follow_up.push_str(last_content);
                follow_up.push('\n');
            }

            follow_up.push_str(&format!(
                "Progress: resolved [{}]. Continue emitting v3 events per the protocol: \
                 behavior_core → capability_enumeration → capability_resolution + \
                 persona_resolution → agent_ir. Resolve every remaining capability field \
                 and every remaining persona-wide field NOW. Output raw JSON only — one \
                 event per line.",
                if resolved_dims.is_empty() {
                    "none yet".to_string()
                } else {
                    resolved_dims.join(", ")
                },
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
                            percent: Some((resolved_cells.len() as f32 / 9.0) * 100.0),
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
            emit_session_status(&channel, &app_handle, &session_id, BuildPhase::AwaitingInput, resolved_count, 9);
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
                    emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Resolving, resolved_count, 9);

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
            emit_session_status(&channel, &app_handle, &session_id, BuildPhase::DraftReady, resolved_count, 9);
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
                        emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Testing, resolved_count, 9);
                        conversation.push(("user".to_string(), "Test this agent. Report any issues via test_report JSON.".to_string()));
                    } else if answer.cell_key == "_refine" {
                        let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
                            phase: Some(BuildPhase::Resolving.as_str().to_string()),
                            ..Default::default()
                        });
                        emit_session_status(&channel, &app_handle, &session_id, BuildPhase::Resolving, resolved_count, 9);
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

    let final_phase = if resolved_count == 0 && agent_ir_str.is_none() {
        BuildPhase::Failed
    } else {
        BuildPhase::DraftReady
    };
    let resolved_json = serde_json::to_string(&serde_json::Value::Object(resolved_cells)).unwrap_or_else(|_| "{}".to_string());
    let _ = build_session_repo::update(&pool, &session_id, &UpdateBuildSession {
        phase: Some(final_phase.as_str().to_string()),
        resolved_cells: Some(resolved_json),
        cli_pid: Some(None),
        pending_question: Some(None),
        agent_ir: if agent_ir_str.is_some() { Some(agent_ir_str) } else { None },
        ..Default::default()
    });

    emit_session_status(&channel, &app_handle, &session_id, final_phase, resolved_count, 9);
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

    let (env_vars, hints, cred_failures, _injected_connectors) =
        super::runner::resolve_credential_env_vars(pool, &tool_defs, persona_id, persona_name)
            .await;

    // Query ALL credential service types from vault so the LLM can match intelligently
    let all_vault_types = crate::db::repos::resources::credentials::get_distinct_service_types(pool)
        .unwrap_or_default();

    let cred_context = {
        let mut ctx = String::new();
        if !hints.is_empty() {
            ctx.push_str("Resolved credential env vars:\n");
            for h in &hints {
                ctx.push_str(&format!("  {h}\n"));
            }
        }
        if !cred_failures.is_empty() {
            ctx.push_str(&format!(
                "\nFailed to auto-resolve credentials for: {}\n",
                cred_failures.join(", ")
            ));
        }
        if !all_vault_types.is_empty() {
            let mut sorted: Vec<_> = all_vault_types.iter().cloned().collect();
            sorted.sort();
            ctx.push_str("\nAll credential service types available in vault:\n");
            for t in &sorted {
                // Derive the env var prefix the system would use
                let prefix = t.to_uppercase().replace('-', "_");
                ctx.push_str(&format!("  {t} (env prefix: {prefix}_)\n"));
            }
            ctx.push_str("\nIMPORTANT: If a tool needs a credential that wasn't auto-resolved above, check if any vault service type matches semantically (e.g. 'github' matches a GitHub PAT, 'alpha_vantage' matches an Alpha Vantage API key). Use the env prefix format ${PREFIX_API_KEY} or ${PREFIX_TOKEN} for the matching vault entry.\n");
        }
        if ctx.is_empty() {
            ctx = "No credentials found in vault. Tools requiring auth will fail.".to_string();
        }
        ctx
    };

    // Step 2: Build test prompt for the CLI
    let tools_json = serde_json::to_string_pretty(&tools).unwrap_or_default();
    // The connector list is what actually needs credentials — generic tools
    // like `http_request` are conduits. Pass both so the CLI can generate
    // one test entry per connector regardless of how many tools the persona
    // declares.
    let connectors_json = serde_json::to_string_pretty(&agent_ir.required_connectors)
        .unwrap_or_else(|_| "[]".to_string());
    let test_prompt = build_test_prompt(&tools_json, &connectors_json, &cred_context);

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

    // Built-in platform connectors that never need user credentials
    let platform_connectors: std::collections::HashSet<&str> = [
        "personas_database", "personas_messages", "personas_vector_db",
        "messaging", "database", "builtin",
    ].iter().copied().collect();

    // Build connector resolution list for the report so the frontend can show
    // which connectors were matched to user credentials.
    // Check three sources: resolved env vars, credential hints, AND vault service types.
    let vault_types_lower: std::collections::HashSet<String> = all_vault_types
        .iter()
        .map(|t| t.to_lowercase())
        .collect();
    let connectors_resolved: Vec<serde_json::Value> = {
        let names: Vec<String> = agent_ir.required_connectors.iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .collect();
        names.iter()
            .filter(|name| !platform_connectors.contains(name.to_lowercase().as_str()))
            .map(|name| {
                let name_lower = name.to_lowercase();
                let matched = resolved_cred_names.contains(&name_lower)
                    || resolved_cred_names.iter().any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
                    || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                    // Also match against vault service types (covers connectors not matched
                    // by tool name, e.g. alpha_vantage credential for http_request tool)
                    || vault_types_lower.contains(&name_lower)
                    || vault_types_lower.iter().any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
                serde_json::json!({
                    "name": name,
                    "has_credential": matched,
                })
            }).collect()
    };

    let total = test_plan.len();
    if total == 0 {
        tracing::warn!(
            session_id = %session_id,
            "CLI returned no test_plan entries, falling back to credential check"
        );
        // Fallback strategy:
        //   • Generic infrastructure tools (http_request, web_search, file_read,
        //     …) never need credentials themselves — their credentials live on
        //     the connectors they target. Iterating tools here would produce
        //     meaningless "http_request needs credentials" messages that don't
        //     tell the user which external service is missing.
        //   • The right level of granularity is `agent_ir.required_connectors`
        //     — one result entry per connector, each carrying the connector
        //     name so the UI can surface "Alpha Vantage needs credentials"
        //     instead of "http_request needs credentials".
        let builtin_tool_names: std::collections::HashSet<&str> = [
            "personas_database", "database", "database_query", "db_query", "db_write",
            "personas_messages", "messaging", "personas_vector_db",
            "file_read", "file_write", "web_search", "web_fetch",
            "http_request", "data_processing", "nlp_parser", "ai_generation",
            "date_calculation", "notification_sender", "text_analysis", "data_enrichment",
        ].iter().copied().collect();

        let mut fb_passed = 0usize;
        let mut fb_failed = 0usize;
        let mut fb_cred_issues: Vec<serde_json::Value> = Vec::new();
        let mut fallback_results: Vec<serde_json::Value> = Vec::new();

        // Infrastructure tools auto-pass — they don't have their own
        // credentials; they're conduits to whichever connector is bound.
        for t in tools.iter() {
            let name = t.name();
            if name.is_empty() { continue; }
            if builtin_tool_names.contains(name) {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": name,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": null,
                    "output_preview": "Built-in platform tool — auto-verified",
                }));
            }
        }

        // Emit one result per connector. This is what makes the UI's
        // credential_missing messages specific — the connector name is the
        // credential subject, not the generic tool name.
        let connector_names: Vec<String> = agent_ir.required_connectors.iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .collect();
        for cname in &connector_names {
            let name_lower = cname.to_lowercase();
            if platform_connectors.contains(name_lower.as_str()) {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": cname,
                    "output_preview": "Built-in platform connector — auto-verified",
                }));
                continue;
            }
            let has_cred = resolved_cred_names.contains(&name_lower)
                || resolved_cred_names.iter().any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
                || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                || vault_types_lower.contains(&name_lower)
                || vault_types_lower.iter().any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
            if has_cred {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": cname,
                    "output_preview": "Credential available — connector verified",
                }));
            } else {
                fb_failed += 1;
                fb_cred_issues.push(serde_json::json!({
                    "connector": cname,
                    "issue": format!("No credential found for connector '{cname}'. Add it in Keys section."),
                }));
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "credential_missing",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": format!("No credential configured for '{cname}'"),
                    "connector": cname,
                    "output_preview": null,
                }));
            }
        }

        return Ok(serde_json::json!({
            "results": fallback_results,
            "tools_tested": fb_passed + fb_failed,
            "tools_passed": fb_passed,
            "tools_failed": fb_failed,
            "tools_skipped": 0usize,
            "credential_issues": fb_cred_issues,
            "connectors_resolved": connectors_resolved,
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
        "connectors_resolved": connectors_resolved,
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
        // Prefer the connector name (e.g. "alpha_vantage") over the tool
        // name (e.g. "http_request") so the user sees which external
        // service is failing, not the generic tool that drove the call.
        let connector = r.get("connector").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let tool = r.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
        let subject = connector.unwrap_or(tool);
        let friendly = subject.replace('_', " ");

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
fn build_test_prompt(tools_json: &str, connectors_json: &str, cred_context: &str) -> String {
    format!(
r#"You are a tool-testing agent. Compose one `test_plan` entry PER CONNECTOR the persona relies on — plus one entry per non-connector tool that might need verification.

## Connectors the persona uses
These are the external services the persona binds to. EVERY connector needs its own test_plan entry so the user sees per-service status.
{connectors_json}

## Tools the persona uses
Generic tools (http_request, web_search, file_read, …) are conduits — they don't own credentials. Do NOT emit a separate "http_request needs credentials" entry; the connectors above are the credential subjects.
{tools_json}

## Credentials
{cred_context}

## Strategy

### 1. Per-connector API test (MUST emit one per external connector)
For each connector in the list above whose category is an external service (not a platform builtin), compose a minimal safe curl. Set `tool_name` to the connector name (same as `connector`), or to the persona tool that drives the call when that's clearer. ALWAYS set `connector` to the connector's `name` so the UI can surface "Alpha Vantage" instead of "http_request".

### 2. CLI-native tools (Claude built-ins, no external API)
`web_search`, `web_fetch`, text summarization, reasoning, etc. are powered by Claude CLI. Mark these with `"cli_native": true` and `"curl": ""`.

### 3. Built-in platform connectors (always available)
`personas_database` / `database` / `personas_messages` / `messaging` / `personas_vector_db` / `file_read` / `file_write` — auto-verified. Mark `"cli_native": true`.

### 4. Non-testable (write-only or no endpoint)
Tools that only mutate state — emit an entry with empty curl and a description explaining the skip.

## Rules for API tests
1. Use GET endpoints or read-only operations only — NO writes, deletes, or mutations.
2. Minimal params (limit=1, maxResults=1, per_page=1).
3. Use $ENV_VAR placeholders for credential values; match the env prefix of the credential from the list above.
4. Always include `-s` (silent) and `-w '\n%{{http_code}}'` to capture HTTP status.

## Output Format
Output EXACTLY one JSON object — a test_plan array. No markdown, no commentary, raw JSON only:
{{"test_plan": [
  {{"tool_name": "alpha_vantage", "connector": "alpha_vantage", "curl": "curl -s 'https://www.alphavantage.co/query?function=MARKET_STATUS&apikey=$ALPHA_VANTAGE_API_KEY' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Alpha Vantage API key via MARKET_STATUS"}},
  {{"tool_name": "gmail", "connector": "gmail", "curl": "curl -s -H 'Authorization: Bearer $GMAIL_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=1' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Gmail API access"}},
  {{"tool_name": "web_search", "connector": null, "curl": "", "cli_native": true, "description": "Uses Claude CLI built-in web search — auto-verified"}},
  {{"tool_name": "messaging", "connector": "personas_messages", "curl": "", "cli_native": true, "description": "Built-in platform connector — auto-verified"}}
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
/// Prefers the `result` event (final complete output) over `assistant` events
/// (streaming fragments) to avoid duplication.
fn extract_llm_text_from_output(raw: &str) -> String {
    let mut result_text: Option<String> = None;
    let mut assistant_text: Option<String> = None;
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
                        assistant_text = Some(text.to_string());
                    }
                }
                "result" => {
                    if let Some(text) = obj.get("result").and_then(|v| v.as_str()) {
                        result_text = Some(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    // Prefer result (complete output) over assistant (may be partial/duplicate)
    result_text.or(assistant_text).unwrap_or_default()
}

// =============================================================================
// build_session_prompt -- wraps user intent with the v3 capability framework
//
// Three phases: Phase A (mission + identity + voice + principles + constraints),
// Phase B (capability enumeration), Phase C (per-capability resolution) +
// persona-wide resolution (tools, connectors, defaults, operating_instructions,
// tool_guidance, core_memories). Emits v3 events only — the run_session parser
// mirrors them to legacy cell_update for the old 3×3 matrix UI.
//
// See docs/concepts/persona-capabilities/C4-build-from-scratch-v3-handoff.md
// for the design contract this prompt targets.
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

## The Capability Framework

A persona is NOT a flat bag of 8 dimensions. A persona is **a single behavior core (mission + identity + voice + principles) that drives a set of distinct capabilities** — each capability being a runnable unit the user could turn on or off independently.

You will resolve this in THREE PHASES, in order:

### Phase A — Behavior Core (the shared mission)

Before resolving any capability, nail down the ONE thing that unites everything this persona does. Emit a single `behavior_core` event:

```
{{"behavior_core": {{
    "mission": "Be the user's most trusted email-attention gatekeeper — nothing surfaces unless it's earned its way in.",
    "identity": {{"role": "You are a senior email triage concierge.", "description": "You guard the user's attention by filtering, ranking, and delivering only what matters."}},
    "voice": {{"style": "Direct, lightly wry, never alarmist. Terse unless asked for detail.", "output_format": "Markdown digest with a ranked list and a short 'why' beside each item."}},
    "principles": ["Nothing surfaces unless it's earned its way in.", "Rank by the user's stated priorities, not by sender seniority.", "Transparency over polish — say what was filtered and why."],
    "constraints": ["Never auto-reply.", "Never modify the inbox.", "Never surface more than 10 items in one digest."],
    "decision_principles": ["When uncertain, prefer understatement.", "Ties break toward the oldest unhandled item."],
    "verbosity_default": "normal"
}}}}
```

**CRITICAL — Mission is NOT a task description.** Task verbs like *fetch, send, check, query, scan, monitor, poll* describe capabilities, not missions. Mission verbs are *be, make, ensure, serve, guard, protect*. If your draft mission reads "fetches unread emails", that's a capability, not a mission. The mission is the UNCHANGING PURPOSE that persists across every capability. Examples:

- ✅ "Be the user's most trusted email-attention gatekeeper — nothing surfaces unless it's earned its way in."
- ✅ "Make weekly publishing sustainable for solo creators by eliminating the 90% of production that isn't filming."
- ✅ "Make sure nobody's onboarding ever slips through the cracks — every deadline visible, every stakeholder aware."
- ❌ "Check my Gmail each morning and send me a summary." (task-shaped)
- ❌ "Monitor stock prices and alert on signals." (task-shaped)

Mission MUST be one sentence (≤ 2 clauses, ≤ 300 chars). Identity.role is one sentence starting with "You are". Principles are cross-cutting rules (2-5 entries, each ≤ 180 chars). Constraints are hard limits — breaking them is a bug (2-5 entries).

**If the intent is vague**, emit a `clarifying_question` on the mission before anything else:

```
{{"clarifying_question": {{"scope": "mission", "question": "What kind of email companion do you want?", "options": ["A: Daily briefing — surface overnight signal once per day", "B: Real-time monitor — alert the moment something urgent arrives", "C: Interactive assistant — answer questions about my inbox on demand"]}}}}
```

### Phase B — Capability Enumeration

A capability is a distinct thing the user would say "turn X off" about. Emit exactly one `capability_enumeration` event listing the capabilities:

```
{{"capability_enumeration": {{"capabilities": [
    {{"id": "uc_morning_digest", "title": "Morning Digest", "capability_summary": "Once-daily ranked summary of overnight email.", "user_facing_goal": "Start my day knowing what's critical in the inbox."}},
    {{"id": "uc_weekly_review", "title": "Weekly Review", "capability_summary": "Sunday-evening pattern roll-up over the past 7 days.", "user_facing_goal": "See whether my attention allocation matched what mattered."}}
]}}}}
```

**Granularity rules** (apply strictly):
- Error-recovery flows are NOT capabilities — they are internal mechanisms inside a capability.
- Attention escalation is NOT a capability — it is an event emitted by a capability.
- Setup/initialization is NOT a capability — inline it in `operating_instructions`.
- Multiple schedules (hourly + daily + weekly) → MULTIPLE capabilities (one per schedule), not one capability with a list of triggers.
- Two things that share trigger AND output → ONE capability with a `sample_input` parameter.
- Two things that differ only in trigger → TWO capabilities.

`id` must start with `uc_` and be snake_case. `title` is 1-40 chars. `capability_summary` is 20-180 chars.

If capability granularity is ambiguous, emit a `clarifying_question` with scope=capability offering "single vs split" options.

### Phase C — Per-Capability Resolution

For each capability enumerated in Phase B, resolve its envelope field by field. Each resolution is ONE event:

```
{{"capability_resolution": {{"id": "uc_morning_digest", "field": "suggested_trigger", "value": {{"trigger_type": "schedule", "config": {{"cron": "0 7 * * *", "timezone": "America/New_York"}}, "description": "Every morning at 7am local time"}}, "status": "resolved"}}}}
```

Resolve these fields per capability, in this order:

1. **suggested_trigger** — ONE trigger object `{{trigger_type, config, description}}` or `null` for manual-only. `trigger_type` ∈ {{schedule, polling, webhook, manual, event}}.
2. **connectors** — array of connector NAMES (strings) that reference the persona-wide connector registry (Phase-C-persona below). Example: `["gmail", "personas_database"]`.
3. **notification_channels** — array of `{{channel, target, format}}` objects for this capability's outputs. Empty array means inherit from `persona.notification_channels_default`.
4. **review_policy** — `{{"mode": "never"|"on_low_confidence"|"always", "context": "short free-text rationale"}}`.
5. **memory_policy** — `{{"enabled": true|false, "context": "what this capability needs to remember across runs"}}`. Memory tracks USER DECISIONS, not informational findings.
6. **event_subscriptions** — array of `{{event_type, direction, description}}` objects. `direction` ∈ {{emit, listen}}. `event_type` MUST use three-level dot syntax `<agent>.<task>.<event_type>` (e.g. `email.digest.published`, `stock.signal.strong_buy`).
7. **input_schema** — array of `{{name, type, required, description}}` describing the payload the capability expects at runtime.
8. **sample_input** — one canonical example payload matching `input_schema`.
9. **tool_hints** — array of tool NAMES this capability uses (subset of the persona-wide tool pool).
10. **use_case_flow** — `{{nodes: [...], edges: [...]}}` simple flow diagram. Nodes have `{{id, label, kind}}` (kind ∈ trigger|action|decision|output). Edges have `{{from, to, label?}}`.
11. **error_handling** — per-capability override string, or empty to inherit `persona.error_handling`.

A capability is complete when all 11 fields have been resolved OR explicitly skipped. If a field genuinely does not apply (e.g. `event_subscriptions` for a standalone capability), emit `{{..., "value": [], "status": "resolved"}}`.

If a field is ambiguous, emit:
```
{{"clarifying_question": {{"scope": "field", "capability_id": "uc_morning_digest", "field": "review_policy", "question": "Should the digest be delivered automatically or wait for approval?", "options": ["Auto-deliver — save my time", "Always wait for approval — I want control"]}}}}
```

### Phase C (persona-wide, parallel with capabilities)

Alongside per-capability resolution, emit `persona_resolution` events for the shared concerns:

```
{{"persona_resolution": {{"field": "tools", "value": [{{"name": "gmail_search", "description": "Search Gmail inbox", "category": "connector"}}, ...], "status": "resolved"}}}}
{{"persona_resolution": {{"field": "connectors", "value": [{{"name": "gmail", "service_type": "google", "purpose": "reading emails", "has_credential": true}}], "status": "resolved"}}}}
{{"persona_resolution": {{"field": "notification_channels_default", "value": [{{"channel": "built-in", "target": "status", "format": "updates"}}], "status": "resolved"}}}}
{{"persona_resolution": {{"field": "operating_instructions", "value": "Cross-capability how-to prose. Setup steps, shared conventions, things the agent does the same way in every capability.", "status": "resolved"}}}}
{{"persona_resolution": {{"field": "tool_guidance", "value": "Per-tool hints: gmail_search — use q:unread filter first; ...", "status": "resolved"}}}}
{{"persona_resolution": {{"field": "error_handling", "value": "Persona-wide fallback posture. Individual capabilities may override.", "status": "resolved"}}}}
{{"persona_resolution": {{"field": "core_memories", "value": [{{"title": "...", "content": "..."}}], "status": "resolved"}}}}
```

**Connector registry rules** (persona.connectors):
- NEVER include these (built-in, no credentials): web_search, web_fetch, web_browse, file_read, file_write, data_processing, text_analysis, ai_generation.
- ALWAYS use `personas_database` (built-in SQLite via execute_sql) when the persona needs database storage. Never suggest Supabase, Firebase, PlanetScale, or any external DB.
- For codebase analysis intents (review, impact, implementation), add the `codebase` connector (service_type: "codebase").
- For personal-knowledge intents (journaling, meeting capture, second-brain), add the `obsidian_memory` connector IF it's present in Available Connectors below.
- Each connector entry: `{{name, service_type, purpose, has_credential}}`. Set `has_credential` based on Available Credentials.

### Final — agent_ir

Once behavior_core + all capability envelopes + all persona_resolution fields are resolved, emit the final agent_ir in v3 shape:

```
{{"agent_ir": {{
  "name": "Concise Title Case name (2-4 words)",
  "description": "One-line persona description",
  "icon": "email",
  "color": "#8b5cf6",
  "persona": {{
    "mission": "...", "identity": {{...}}, "voice": {{...}},
    "principles": [...], "constraints": [...], "decision_principles": [...],
    "verbosity_default": "normal",
    "operating_instructions": "...", "tool_guidance": "...", "error_handling": "...",
    "tools": [...], "connectors": [...],
    "notification_channels_default": [...], "core_memories": [...]
  }},
  "use_cases": [
    {{
      "id": "uc_...", "title": "...", "description": "...",
      "capability_summary": "...", "enabled_by_default": true,
      "suggested_trigger": {{...}}, "connectors": ["gmail"],
      "notification_channels": [...], "review_policy": {{...}},
      "memory_policy": {{...}}, "event_subscriptions": [...],
      "input_schema": [...], "sample_input": {{...}},
      "tool_hints": [...], "use_case_flow": {{...}},
      "error_handling": ""
    }}
  ]
}}}}
```

Also derive and include a `structured_prompt` with decomposed sections (this is used by the runtime prompt assembler):

Inside agent_ir (top-level, not inside `persona`):
```
"structured_prompt": {{
  "identity": "<one paragraph — the persona.identity.role + description + voice.style>",
  "instructions": "<multi-paragraph — the persona.operating_instructions + per-capability guidance + protocol messages>",
  "toolGuidance": "<from persona.tool_guidance>",
  "examples": "<from capabilities' sample_input + expected output>",
  "errorHandling": "<from persona.error_handling>"
}}
```

The app's promote pipeline normalizes v3 → flat legacy shape automatically, so keep the v3 nesting — don't hoist triggers/events/connectors back to the top level yourself.

## Available Credentials
{cred_section}

## Available Connectors
{connector_section}

## Output Format

RAW JSON only — one object per line, no markdown, no code fences, no commentary.

Allowed event types in order of appearance:
1. `{{"behavior_core": {{...}}}}` — Phase A (exactly one)
2. `{{"capability_enumeration": {{"capabilities": [...]}}}}` — Phase B (exactly one, unless user adds capabilities via the UI later)
3. `{{"capability_resolution": {{"id": "uc_...", "field": "...", "value": ..., "status": "resolved"|"pending"}}}}` — Phase C, one per field per capability
4. `{{"persona_resolution": {{"field": "...", "value": ..., "status": "resolved"}}}}` — persona-wide, one per field
5. `{{"clarifying_question": {{"scope": "mission"|"capability"|"field", "capability_id": "uc_...", "field": "...", "question": "...", "options": [...]}}}}` — at any point; stop and wait for user answer via --continue
6. `{{"agent_ir": {{...}}}}` — the final v3-shaped IR (exactly one, at end)

## Protocol Message Integration

The agent runs on a platform with built-in communication protocols. When composing `structured_prompt.instructions` (inside agent_ir), you MUST include explicit guidance for the agent to use these JSON protocol messages during execution:

1. **user_message** — Agent sends its main output/report. The title MUST be descriptive and identify the capability at first sight (e.g. "Weekly Tech News - Jan 15-21, 2026", NOT "Execution output"). Content is the final deliverable only — no thinking process. For stats, use ```chart blocks (label: value per line). Map from per-capability `notification_channels`. Example: `{{"user_message": {{"title": "Weekly Tech Digest - Jan 15-21", "content": "## Headlines\n...", "content_type": "success", "priority": "normal"}}}}`
2. **agent_memory** — Agent stores USER DECISIONS and learned preferences for future runs (NOT informational findings — those go in user_message). Map from per-capability `memory_policy`. Example: `{{"agent_memory": {{"title": "Review Decision: [item]", "content": "User accepted/rejected — reason and future implication", "category": "decision"}}}}`
3. **manual_review** — Agent flags items needing human approval. Map from per-capability `review_policy`. ONLY emit when the agent genuinely encounters something requiring a human decision (ambiguous data, high-risk actions, policy violations). Do NOT emit for routine completions — those belong in user_message. Example: `{{"manual_review": {{"title": "Needs Review", "description": "why", "severity": "medium"}}}}`
4. **emit_event** — Agent emits events for inter-agent coordination. Map from per-capability `event_subscriptions` (direction: emit). Event names MUST use the three-level dot syntax `<agent>.<task>.<event_type>`. Examples: `email.digest.published`, `stock.signal.strong_buy`, `invoice.scan.completed`. Example: `{{"emit_event": {{"type": "email.digest.published", "data": {{"status": "success", "items_processed": 5}}}}}}`
5. **knowledge_annotation** — Agent records tool/API insights. Example: `{{"knowledge_annotation": {{"scope": "tool:web_search", "note": "insight"}}}}`
6. **execution_flow** — Agent declares its execution steps. Example: `{{"execution_flow": {{"flows": [{{"step": 1, "action": "research", "status": "completed"}}]}}}}`

`structured_prompt.instructions` MUST reference at least user_message, agent_memory, and emit_event with specific guidance for WHEN the agent uses each — with the exact JSON format inline.

## Rules

1. Output RAW JSON only — no markdown, no code fences, no prose.
2. Event order: behavior_core FIRST, then capability_enumeration, then capability_resolution + persona_resolution (interleaved), finally agent_ir.
3. **Mission is not a task.** If your mission contains verbs like fetch/send/check/query/scan/monitor/poll — rewrite it. Mission verbs: be/make/ensure/serve/guard/protect.
4. Every `capability_resolution` MUST reference an `id` from the prior `capability_enumeration`. Don't invent new capabilities inside resolutions.
5. `event_subscriptions.event_type` MUST use three-level dot syntax `<agent>.<task>.<event_type>` — never generic names like `task_completed`.
6. {rule5}
7. `agent_ir.system_prompt` MUST be a comprehensive, self-contained instruction set. Include MANDATORY fallback: "CRITICAL: If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST generate realistic sample data and continue the FULL workflow — creating tables, emitting all protocol messages (user_message, agent_memory, manual_review, emit_event), and completing every step. NEVER stop or report 'blocked'. The workflow must complete end-to-end with sample data."
8. `structured_prompt` MUST have detailed, actionable content in each section (identity, instructions, toolGuidance, examples, errorHandling) — never empty or placeholder. `instructions` MUST require the agent to emit user_message (final report), agent_memory (decisions), manual_review (items needing approval), and emit_event (completion) — with exact JSON formats inline.
9. `agent_ir.icon` MUST be EXACTLY ONE lowercase catalog id (no prefix, no PascalCase, no Lucide names): assistant, code, data, security, monitor, email, document, support, automation, research, finance, marketing, devops, content, sales, hr, legal, notification, calendar, search. Pick the id matching the persona's dominant purpose or primary connector (gmail/outlook→email, github/gitlab→code, notion→document, postgres/airtable→data, slack/discord→assistant, stripe→finance, hubspot/salesforce→sales, sentry→monitor, jira/linear→devops). `agent_ir.color` MUST be a hex string like `#8b5cf6`. NEVER Lucide names, emoji, or free text.
10. **Design directions (adversarial questioning on mission):** When the intent is broad or ambiguous (describes a goal but not HOW), do NOT jump to behavior_core. Emit a `clarifying_question` with scope="mission" offering 2-3 competing design directions. Examples: "A: Scheduled digest — collect data daily and send a summary", "B: Real-time monitor — watch for thresholds and alert immediately", "C: Interactive advisor — respond on demand". Let the user pick before Phase A resolves. When intent is already specific (exact tools, trigger types, named workflows), skip and resolve directly.
11. **TDD guidance for code-oriented personas:** When the intent or connectors indicate software work (code execution, file write, git, shell, or connectors like GitHub/GitLab/Jira/Linear), append to `structured_prompt.instructions`: "Follow a test-driven development cycle: (1) write a failing test for the expected behavior, (2) implement the minimal logic that makes it pass, (3) refactor for clarity. Commit after each green cycle." For non-code personas, omit entirely.
12. **Database rule** — when the persona needs database storage, use `personas_database` (built-in SQLite, no credential). NEVER Supabase/Firebase/PlanetScale.
13. **Built-in capabilities are not connectors** — never list web_search/web_fetch/web_browse/file_read/file_write/data_processing/text_analysis/ai_generation in `persona.connectors`. Mention them in `persona.tools` or in capability `tool_hints`.
14. Mission, principles, constraints, operating_instructions, identity/voice prose MUST be in the persona's output language (see LANGUAGE RULE at top of prompt). Capability ids stay in English (`uc_morning_digest`); capability titles/summaries go in the output language.

{template_context}

Analyze the intent now. Begin with Phase A (behavior_core or a mission clarifying_question)."###
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
                events.extend(parse_json_object(obj, &val, session_id));
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

/// Parse a single JSON object into one or more `BuildEvent`s.
///
/// v3 events (behavior_core, capability_enumeration, capability_resolution,
/// persona_resolution, clarifying_question with a `scope`) each emit TWO
/// events: the typed v3 variant AND a legacy `CellUpdate` / `Question` mirror
/// so the existing 3×3 matrix UI keeps rendering during migration.
/// See §3.8 of C4-build-from-scratch-v3-handoff.md.
fn parse_json_object(
    obj: &serde_json::Map<String, serde_json::Value>,
    full_val: &serde_json::Value,
    session_id: &str,
) -> Vec<BuildEvent> {
    // -----------------------------------------------------------------
    // v3 event: behavior_core
    // -----------------------------------------------------------------
    if let Some(core) = obj.get("behavior_core") {
        let mut out = vec![BuildEvent::BehaviorCoreUpdate {
            session_id: session_id.to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: surface the core under a dedicated cell key so the
        // old matrix UI can show it as a synthetic 9th cell if desired.
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "behavior_core".to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_enumeration
    // -----------------------------------------------------------------
    if let Some(enu) = obj.get("capability_enumeration") {
        let mut out = vec![BuildEvent::CapabilityEnumerationUpdate {
            session_id: session_id.to_string(),
            data: enu.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: hoist the capability list under the use-cases key so
        // the old dimensional cell renders something useful. Map each
        // capability's title to `items[]` and full list to `use_cases[]`.
        let legacy_data = capabilities_to_legacy_use_cases(enu);
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "use-cases".to_string(),
            data: legacy_data,
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("capability_resolution") {
        if let Some(res_obj) = res.as_object() {
            let capability_id = res_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::CapabilityResolutionUpdate {
                session_id: session_id.to_string(),
                capability_id: capability_id.clone(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
            }];
            // Legacy mirror: map field → legacy dimension key and surface as CellUpdate.
            if let Some(legacy_key) = map_capability_field_to_legacy_dimension(&field) {
                let legacy_data = wrap_value_in_legacy_dimension_shape(&field, &value, &capability_id);
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // v3 event: persona_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("persona_resolution") {
        if let Some(res_obj) = res.as_object() {
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::PersonaResolutionUpdate {
                session_id: session_id.to_string(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
            }];
            if let Some(legacy_key) = map_persona_field_to_legacy_dimension(&field) {
                let legacy_data = wrap_value_in_legacy_dimension_shape(&field, &value, "");
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // Question detection — handles BOTH legacy `{question, dimension}` and
    // v3 `{clarifying_question: {scope, ...}}` / bare `{question, scope, ...}`.
    // -----------------------------------------------------------------
    if let Some(cq) = obj.get("clarifying_question") {
        if let Some(cq_obj) = cq.as_object() {
            return build_clarifying_question_events(cq_obj, session_id);
        }
    }
    if obj.contains_key("question") {
        // A v3-style question is `{question, scope, ...}`; a legacy question is
        // `{question, dimension, options}`. Detect scope to route correctly.
        if obj.contains_key("scope") {
            return build_clarifying_question_events(obj, session_id);
        }

        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let question = match obj.get("question").and_then(|v| v.as_str()) {
            Some(q) => q.to_string(),
            None => return vec![],
        };
        let options = obj.get("options").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
        });
        return vec![BuildEvent::Question {
            session_id: session_id.to_string(),
            cell_key,
            question,
            options,
        }];
    }

    // Agent IR detection
    if obj.contains_key("agent_ir") {
        let ir_data = obj.get("agent_ir").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "agent_ir".to_string(),
            data: ir_data,
            status: "resolved".to_string(),
        }];
    }

    // Test report detection
    if obj.contains_key("test_report") {
        let report = obj.get("test_report").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "_test_report".to_string(),
            data: report,
            status: "resolved".to_string(),
        }];
    }

    // Dimension/cell update detection (legacy v2 dimensional output)
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
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key,
            data,
            status,
        }];
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
        return vec![BuildEvent::Error {
            session_id: session_id.to_string(),
            cell_key: obj.get("cell_key").and_then(|v| v.as_str()).map(|s| s.to_string()),
            message,
            retryable,
        }];
    }

    vec![]
}

/// Emit the typed v3 `ClarifyingQuestionV3` plus a legacy `Question` mirror
/// so the old dimension-scoped question panel keeps rendering.
fn build_clarifying_question_events(
    obj: &serde_json::Map<String, serde_json::Value>,
    session_id: &str,
) -> Vec<BuildEvent> {
    let scope = obj
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("mission")
        .to_string();
    let capability_id = obj
        .get("capability_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let field = obj
        .get("field")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let question = match obj.get("question").and_then(|v| v.as_str()) {
        Some(q) => q.to_string(),
        None => return vec![],
    };
    let options = obj.get("options").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
    });

    let mut events = vec![BuildEvent::ClarifyingQuestionV3 {
        session_id: session_id.to_string(),
        scope: scope.clone(),
        capability_id: capability_id.clone(),
        field: field.clone(),
        question: question.clone(),
        options: options.clone(),
    }];

    // Legacy Question mirror — the old UI keys by `cell_key`. Pick the most
    // sensible legacy dimension for each scope so the old question panel
    // can surface it somewhere instead of dropping it.
    let cell_key = match scope.as_str() {
        "mission" => "behavior_core".to_string(),
        "capability" => "use-cases".to_string(),
        "field" => field
            .as_deref()
            .and_then(map_capability_field_to_legacy_dimension)
            .unwrap_or("use-cases")
            .to_string(),
        _ => "use-cases".to_string(),
    };
    events.push(BuildEvent::Question {
        session_id: session_id.to_string(),
        cell_key,
        question,
        options,
    });

    events
}

/// Map a v3 capability field name to the legacy v2 dimension key the 3×3
/// matrix UI understands, for the legacy CellUpdate mirror. Returns `None`
/// for fields that have no legacy equivalent (e.g. `input_schema`,
/// `use_case_flow`) — those events surface only via v3 typed state.
fn map_capability_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "suggested_trigger" => Some("triggers"),
        "connectors" => Some("connectors"),
        "notification_channels" => Some("messages"),
        "review_policy" => Some("human-review"),
        "memory_policy" => Some("memory"),
        "event_subscriptions" => Some("events"),
        "error_handling" => Some("error-handling"),
        _ => None,
    }
}

/// Map a v3 persona-wide field name to the legacy dimension key. Persona-wide
/// overlaps (connectors, error_handling, etc.) share the legacy key with
/// capability-scoped fields — the 3×3 UI rendered them as a single cell anyway.
fn map_persona_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "connectors" => Some("connectors"),
        "notification_channels_default" => Some("messages"),
        "error_handling" => Some("error-handling"),
        "core_memories" => Some("memory"),
        _ => None,
    }
}

/// Wrap a v3 field value in the shape the legacy dimension cell expects.
/// The old UI consumes `{items, <dimension-key>[]}` shapes so each dimension
/// can render a summary + structured list. We reconstruct that on the fly
/// from v3 values.
fn wrap_value_in_legacy_dimension_shape(
    field: &str,
    value: &serde_json::Value,
    capability_id: &str,
) -> serde_json::Value {
    use serde_json::json;
    let suffix = if capability_id.is_empty() {
        String::new()
    } else {
        format!(" [{}]", capability_id)
    };

    match field {
        // Per-capability suggested_trigger — value is a single trigger object
        "suggested_trigger" => {
            let mut trig = value.clone();
            if let Some(obj) = trig.as_object_mut() {
                if !capability_id.is_empty() {
                    obj.insert(
                        "use_case_id".to_string(),
                        json!(capability_id),
                    );
                }
            }
            let desc = trig
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            json!({
                "items": [format!("{}{}", desc, suffix)],
                "triggers": [trig]
            })
        }

        // Persona-wide or per-capability connector list
        "connectors" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            // If entries are strings (capability references), skip legacy mirror;
            // otherwise assume they are full connector objects (persona registry).
            if arr.iter().all(|v| v.is_string()) {
                json!({
                    "items": arr.iter().filter_map(|v| v.as_str().map(|s| format!("{}{}", s, suffix))).collect::<Vec<_>>(),
                })
            } else {
                let items: Vec<String> = arr
                    .iter()
                    .map(|c| {
                        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let svc = c.get("service_type").and_then(|v| v.as_str()).unwrap_or("");
                        let purp = c.get("purpose").and_then(|v| v.as_str()).unwrap_or("");
                        format!("{} ({}) — {}", name, svc, purp)
                    })
                    .collect();
                json!({
                    "items": items,
                    "connectors": arr,
                    "alternatives": {}
                })
            }
        }

        "notification_channels" | "notification_channels_default" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|c| {
                    let ch = c.get("channel").and_then(|v| v.as_str()).unwrap_or("");
                    let tgt = c.get("target").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}: {}{}", ch, tgt, suffix)
                })
                .collect();
            json!({ "items": items, "channels": arr })
        }

        "review_policy" => {
            let mode = value.get("mode").and_then(|v| v.as_str()).unwrap_or("never");
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("{}: {}{}", mode, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "memory_policy" => {
            let enabled = value.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("enabled={}: {}{}", enabled, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "event_subscriptions" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let mut subs_with_ucid = arr.clone();
            // Tag each subscription with its originating capability for
            // downstream tooling (persona_event_subscriptions.use_case_id).
            if !capability_id.is_empty() {
                for s in subs_with_ucid.iter_mut() {
                    if let Some(o) = s.as_object_mut() {
                        o.insert("use_case_id".to_string(), json!(capability_id));
                    }
                }
            }
            let items: Vec<String> = arr
                .iter()
                .map(|e| {
                    let typ = e.get("event_type").and_then(|v| v.as_str()).unwrap_or("");
                    let dir = e.get("direction").and_then(|v| v.as_str()).unwrap_or("subscribe");
                    format!("{}: {}{}", dir, typ, suffix)
                })
                .collect();
            json!({ "items": items, "subscriptions": subs_with_ucid })
        }

        "error_handling" => {
            let text = value.as_str().unwrap_or("").to_string();
            json!({ "items": [format!("{}{}", text, suffix)] })
        }

        "core_memories" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|m| {
                    let t = m.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}{}", t, suffix)
                })
                .collect();
            json!({ "items": items, "memories": arr })
        }

        _ => json!({ "items": [], "value": value.clone() }),
    }
}

/// Convert a v3 capability_enumeration value into the legacy use-cases cell shape.
fn capabilities_to_legacy_use_cases(enu: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let caps = enu
        .get("capabilities")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<String> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c.get("capability_summary").and_then(|v| v.as_str()).unwrap_or("");
            if sum.is_empty() {
                title.to_string()
            } else {
                format!("{title}: {sum}")
            }
        })
        .collect();
    let legacy_use_cases: Vec<serde_json::Value> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c.get("capability_summary").and_then(|v| v.as_str()).unwrap_or("");
            let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "id": id,
                "title": title,
                "description": sum,
                "category": "other",
                "execution_mode": "e2e"
            })
        })
        .collect();
    json!({
        "items": items,
        "use_cases": legacy_use_cases
    })
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
