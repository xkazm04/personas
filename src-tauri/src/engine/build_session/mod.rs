//! BuildSessionManager: multi-turn build session lifecycle engine.
//!
//! Wraps the existing `CliProcessDriver` with per-session state tracking,
//! tokio::mpsc channels for user input, and checkpoint-based SQLite
//! persistence. Each build session runs as a long-lived tokio task that
//! pauses on questions and resumes when the user answers via the mpsc
//! channel.
//!
//! See `README.md` for the full module map. Briefly:
//!   - `gates`          — Rule 16/17 enforcement state machine.
//!   - `session_prompt` — the v3-framework system prompt the LLM is given.
//!   - `templates`      — keyword similarity matcher for the prompt's
//!                        "Reference Templates" section.
//!   - `runner`         — `run_session` async loop body (the spine).
//!   - `parser`         — stream-json → typed `BuildEvent` parser + legacy
//!                        mirror helpers.
//!   - `tool_tests`     — LLM-driven pre-promote test runner.
//!   - `events`         — Tauri-channel + DB-update glue.

mod events;
mod fix_pass;
mod gates;
mod oneshot;
mod parser;
pub mod reference;
mod runner;
mod session_prompt;
mod templates;
mod tool_tests;

pub use tool_tests::run_tool_tests;

use session_prompt::build_session_prompt;
use templates::build_template_context;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::db::models::{BuildPhase, BuildSession, UpdateBuildSession, UserAnswer};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

use super::prompt;

// =============================================================================
// SessionHandle -- in-memory handle for an active build session
// =============================================================================

pub(super) struct SessionHandle {
    input_tx: mpsc::Sender<UserAnswer>,
    cancel_flag: Arc<AtomicBool>,
    generation: u64,
    #[allow(dead_code)]
    session_id: String,
}

// =============================================================================
// HandleDropGuard -- ensures session handles are removed on task exit/panic
// =============================================================================

struct HandleDropGuard {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    session_id: String,
    generation: u64,
}

impl Drop for HandleDropGuard {
    fn drop(&mut self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let should_remove = sessions
            .get(&self.session_id)
            .is_some_and(|handle| handle.generation == self.generation);
        if should_remove {
            sessions.remove(&self.session_id);
            tracing::info!(
                session_id = %self.session_id,
                generation = self.generation,
                "HandleDropGuard: removed stale session handle"
            );
        }
    }
}

// =============================================================================

pub struct BuildSessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    next_generation: AtomicU64,
}

impl BuildSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(1),
        }
    }

    /// Start a new build session. Creates the DB row, spawns a tokio task,
    /// and returns the session ID immediately.
    ///
    /// `mode` selects the gate-resolution strategy:
    ///   - `None` or `Some("interactive")` — legacy ask-the-user flow.
    ///   - `Some("one_shot")` — autonomous: LLM resolves every gate, retries
    ///     test failures up to 3×, auto-promotes on success. The
    ///     BuildWatcher job (companion/jobs) posts the terminal result to
    ///     `companion_session_id` if set.
    #[allow(clippy::too_many_arguments)]
    pub fn start_session(
        &self,
        session_id: String,
        persona_id: String,
        intent: String,
        channel: Channel<Value>,
        pool: DbPool,
        registry: Arc<ActiveProcessRegistry>,
        workflow_json: Option<String>,
        parser_result_json: Option<String>,
        app_handle: tauri::AppHandle,
        language: Option<String>,
        mode: Option<String>,
        companion_session_id: Option<String>,
    ) -> Result<String, AppError> {
        let (input_tx, input_rx) = mpsc::channel::<UserAnswer>(32);
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let generation = self.next_generation.fetch_add(1, Ordering::AcqRel);

        // Multi-draft builds: a persona can have multiple concurrent active
        // sessions (e.g. user iterates on the same draft in parallel tabs).
        // Sessions are uniquely keyed by session_id in the BuildSessionManager
        // map and in the buildSessions DB table, so there's no collision risk.
        // The frontend matrixBuildSlice routes events to the correct session
        // via event.session_id.

        // Normalize mode: None / unknown → "interactive". Reject anything
        // other than the two known values so callers can't smuggle bogus
        // strings into the DB.
        let normalized_mode = match mode.as_deref() {
            Some("one_shot") => Some("one_shot".to_string()),
            Some("interactive") | None => Some("interactive".to_string()),
            Some(other) => {
                return Err(AppError::Validation(format!(
                    "Unknown build mode: '{}' (expected 'interactive' or 'one_shot')",
                    other
                )));
            }
        };
        let is_one_shot = normalized_mode.as_deref() == Some("one_shot");

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
            mode: normalized_mode,
            companion_session_id: companion_session_id.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        build_session_repo::create(&pool, &session)?;

        // Insert the session handle
        let handle = SessionHandle {
            input_tx,
            cancel_flag: cancel_flag.clone(),
            generation,
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
                // Parse connector metadata to surface `emits[]` — the set of
                // three-level-dot event_types this connector publishes. The
                // build LLM needs this so it can emit matching
                // event_subscriptions (direction=listen). Without it, the
                // LLM invents plausible-but-unsubscribable names like
                // `translation.document.completed` and falls back to
                // polling triggers.
                let emits_hint: String = c
                    .metadata
                    .as_deref()
                    .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                    .and_then(|v| v.get("emits").cloned())
                    .and_then(|v| v.as_array().cloned())
                    .map(|arr| {
                        let items: Vec<String> = arr
                            .iter()
                            .filter_map(|e| {
                                let et = e.get("event_type").and_then(|v| v.as_str())?;
                                let desc = e.get("description").and_then(|v| v.as_str()).unwrap_or("");
                                Some(if desc.is_empty() {
                                    format!("{}", et)
                                } else {
                                    format!("{} — {}", et, desc)
                                })
                            })
                            .collect();
                        if items.is_empty() {
                            String::new()
                        } else {
                            format!(" [emits: {}]", items.join("; "))
                        }
                    })
                    .unwrap_or_default();

                if c.name == "codebase" {
                    format!("- {} (category: {}){} — local codebase access for code analysis, impact assessment, and implementation tasks via Dev Tools projects", c.name, c.category, emits_hint)
                } else if c.name == "obsidian_memory" {
                    format!("- {} (category: {}){} — graph-aware Obsidian vault access: search notes, walk backlinks, list MOCs/orphans, append to today's daily journal, write structured meeting notes. Prefer this connector for 'search my notes', 'what links to X', 'log this to my journal', and 'capture meeting' intents.", c.name, c.category, emits_hint)
                } else {
                    format!("- {} (category: {}){}", c.name, c.category, emits_hint)
                }
            })
            .collect();

        // Find similar templates for reference context
        let template_context = build_template_context(&intent);

        // Build the system prompt that wraps the user intent with dimension framework
        let system_prompt = build_session_prompt(
            &intent,
            &cred_summary,
            &connector_summary,
            &template_context,
            language.as_deref(),
            is_one_shot,
        );

        // Spawn the session task
        let sessions_map = self.sessions.clone();
        let guard_map = self.sessions.clone();
        let guard_sid = session_id.clone();
        let sid = session_id.clone();
        let raw_user_intent = intent.clone();
        tokio::spawn(async move {
            let _handle_guard = HandleDropGuard {
                sessions: guard_map,
                session_id: guard_sid,
                generation,
            };
            runner::run_session(
                sid,
                persona_id,
                system_prompt, // Use the full system prompt, not raw intent
                raw_user_intent,
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
                is_one_shot,
                generation,
            )
            .await;
        });

        Ok(session_id)
    }

    /// Send a user answer to an active session, resuming the build task.
    pub fn send_answer(&self, session_id: &str, answer: UserAnswer) -> Result<(), AppError> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

        handle
            .input_tx
            .try_send(answer)
            .map_err(|e| AppError::Internal(format!("Failed to send answer: {e}")))?;
        Ok(())
    }

    /// Cancel an active session: set the cancel flag, kill the CLI process,
    /// remove the handle, and update DB phase to Cancelled.
    ///
    /// Safe to call concurrently for distinct session IDs — the sessions
    /// map and process registry are mutex-protected, and the DB update is
    /// pool-backed. Frontend boot fans out cancels in parallel via
    /// `Promise.allSettled`; the tracing span lets us audit that fan-out.
    pub fn cancel_session(
        &self,
        session_id: &str,
        pool: &DbPool,
        registry: &ActiveProcessRegistry,
    ) -> Result<(), AppError> {
        let span = tracing::info_span!("build_session.cancel", session_id = %session_id);
        let _enter = span.enter();

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
