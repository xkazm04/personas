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
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::db::models::{
    BuildEvent, BuildPhase, BuildSession, UpdateBuildSession, UserAnswer,
};
use crate::db::repos::core::build_sessions as build_session_repo;
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

        // Build CLI args
        let cli_args = prompt::build_cli_args(None, None);

        // Spawn the session task
        let sessions_map = self.sessions.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            run_session(
                sid,
                persona_id,
                intent,
                channel,
                input_rx,
                pool,
                cli_args,
                registry,
                cancel_flag,
                sessions_map,
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
) {
    // Register run in ActiveProcessRegistry
    let _reg_flag = registry.register_run("build_session", &session_id);

    // Update phase to Analyzing
    let _ = update_phase(&pool, &session_id, BuildPhase::Analyzing);
    emit_session_status(&channel, &session_id, BuildPhase::Analyzing, 0, 0);

    // Spawn CLI process
    let mut driver = match CliProcessDriver::spawn_temp(&cli_args, "build-session") {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(session_id = %session_id, error = %e, "Failed to spawn CLI for build session");
            let _ = update_phase_with_error(&pool, &session_id, &format!("CLI spawn failed: {e}"));
            emit_error(&channel, &session_id, &format!("Failed to start build: {e}"), false);
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

    // Write intent to stdin (keep stdin open for subsequent Q&A writes)
    if let Err(e) = driver.write_stdin_line(intent.as_bytes()).await {
        tracing::error!(session_id = %session_id, error = %e, "Failed to write intent to CLI stdin");
        let _ = update_phase_with_error(&pool, &session_id, &format!("Failed to send intent: {e}"));
        emit_error(&channel, &session_id, &format!("Failed to send intent to build process: {e}"), false);
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
            emit_error(&channel, &session_id, "Build process produced no output", false);
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

                // Try to parse as JSON and route to appropriate event
                if let Some(event) = parse_build_line(&line, &session_id) {
                    match &event {
                        BuildEvent::CellUpdate { cell_key, data, .. } => {
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
                        BuildEvent::Question { question, cell_key, options, .. } => {
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

                            // Emit the event to frontend
                            let _ = channel.send(event);

                            // Wait for user answer via mpsc
                            match input_rx.recv().await {
                                Some(answer) => {
                                    tracing::info!(
                                        session_id = %session_id,
                                        cell_key = %answer.cell_key,
                                        "Received user answer for build session"
                                    );
                                    // Update phase back to Resolving, clear pending question
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
                                            "Failed to write answer to CLI stdin, attempting follow-up invocation"
                                        );
                                        // If stdin write fails (pipe broken), the CLI process likely exited.
                                        // This will be caught by the next read_line_limited returning None/Err.
                                    }
                                }
                                None => {
                                    // Channel closed -- session was cancelled
                                    tracing::info!(
                                        session_id = %session_id,
                                        "Input channel closed, ending build session"
                                    );
                                    let _ = driver.kill().await;
                                    cleanup_session(&sessions_map, &registry, &session_id);
                                    return;
                                }
                            }
                            continue; // Don't emit the question event again
                        }
                        BuildEvent::Progress { .. } => {
                            // Extract total_count from progress if available
                        }
                        BuildEvent::SessionStatus { total_count: tc, .. } => {
                            total_count = *tc;
                        }
                        _ => {}
                    }

                    let _ = channel.send(event);
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
        emit_error(&channel, &session_id, &error_msg, true);
    }

    let _ = build_session_repo::update(&pool, &session_id, &final_update);

    // Emit final status
    emit_session_status(
        &channel,
        &session_id,
        final_phase,
        resolved_count,
        total_count,
    );

    // Cleanup
    cleanup_session(&sessions_map, &registry, &session_id);
}

// =============================================================================
// Helpers
// =============================================================================

/// Parse a single line of CLI output into a typed BuildEvent.
fn parse_build_line(line: &str, session_id: &str) -> Option<BuildEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try parsing as JSON
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON lines are emitted as progress events
            return Some(BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: trimmed.to_string(),
                percent: None,
            });
        }
    };

    let obj = json.as_object()?;

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
            .unwrap_or(json.clone());
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

    // Default: treat as progress
    let message = obj
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or(trimmed)
        .to_string();
    let percent = obj
        .get("percent")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32);
    Some(BuildEvent::Progress {
        session_id: session_id.to_string(),
        dimension: obj.get("dimension").and_then(|v| v.as_str()).map(|s| s.to_string()),
        message,
        percent,
    })
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

/// Emit a SessionStatus event via the Channel.
fn emit_session_status(
    channel: &Channel<BuildEvent>,
    session_id: &str,
    phase: BuildPhase,
    resolved_count: usize,
    total_count: usize,
) {
    let _ = channel.send(BuildEvent::SessionStatus {
        session_id: session_id.to_string(),
        phase: phase.as_str().to_string(),
        resolved_count,
        total_count,
    });
}

/// Emit an Error event via the Channel.
fn emit_error(
    channel: &Channel<BuildEvent>,
    session_id: &str,
    message: &str,
    retryable: bool,
) {
    let _ = channel.send(BuildEvent::Error {
        session_id: session_id.to_string(),
        cell_key: None,
        message: message.to_string(),
        retryable,
    });
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
