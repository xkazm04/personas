//! `run_session` — the long-lived tokio task body for one build session.
//!
//! Spawns the Claude CLI, pipes the system prompt, drains stream-json events,
//! applies the gate state machine, mirrors v3 events to legacy cell-update
//! for the existing UI, and persists per-event checkpoints into SQLite.
//!
//! This is the spine of the build-session module. When changing how the
//! parser, gates, or events interact, edit this file. When changing what the
//! LLM is asked to do, edit `session_prompt.rs`. When changing gate
//! enforcement, edit `gates.rs`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::db::models::{BuildEvent, BuildPhase, UpdateBuildSession, UserAnswer};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::DbPool;
use crate::notifications;
use crate::ActiveProcessRegistry;

use super::super::cli_process::{read_line_limited, CliProcessDriver};
use super::super::types::CliArgs;
use super::events::{
    cleanup_session, dual_emit, emit_error, emit_session_status, update_phase,
    update_phase_with_error,
};
use super::gates::{
    ensure_capability_in_coverage_with_context, find_first_unopen_gate,
    gate_seed_for_intent_with_context, init_gates_from_enumeration_with_context, is_gated_field,
    legacy_cell_to_v3_field, synthesize_gate_question, CapabilityGates, PendingGate,
};
use super::parser::{
    map_capability_field_to_legacy_dimension, map_persona_field_to_legacy_dimension,
    parse_build_line,
};
use super::SessionHandle;

const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(100);

type ConversationHistory = Vec<(&'static str, Arc<str>)>;

// =============================================================================
// SessionExecDir -- RAII guard for the per-session temp workspace
// =============================================================================
//
// The runner creates `build-session-<uuid>` under `std::env::temp_dir()` so
// the Claude CLI's `--continue` cache survives across turns. Without a
// guard, any panic between creation and the explicit `remove_dir_all` calls
// (malformed LLM event, JSON deserialization mid-turn, cancelled task,
// future dropped before completion) would leave the directory behind.
// Power users running 30-50 builds a day can silently fill %TEMP%/tmp and
// take down unrelated tools with "no space left on device".
//
// `SessionExecDir` removes the directory on Drop, which fires on every exit
// path — including stack unwinding — so leaks are no longer possible. Call
// `disarm()` on the rare path that wants to preserve the workspace (e.g.
// post-mortem debugging); current code never needs to.

struct SessionExecDir {
    path: std::path::PathBuf,
    armed: bool,
}

impl SessionExecDir {
    fn new(path: std::path::PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn path(&self) -> &std::path::Path {
        &self.path
    }

    #[allow(dead_code)]
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for SessionExecDir {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        match std::fs::remove_dir_all(&self.path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!(
                    path = %self.path.display(),
                    error = %e,
                    "SessionExecDir: failed to remove temp dir on drop"
                );
            }
        }
    }
}

async fn wait_for_cancel_flag(cancel_flag: Arc<AtomicBool>) {
    while !cancel_flag.load(Ordering::Acquire) {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
    }
}

async fn kill_cancelled_turn(
    driver: &mut CliProcessDriver,
    registry: &ActiveProcessRegistry,
    session_id: &str,
    turn: usize,
) {
    tracing::info!(
        session_id = %session_id,
        turn = turn + 1,
        "Build session cancelled mid-turn; killing CLI child"
    );
    driver.kill().await;
    registry.clear_run_pid("build_session", session_id);
}

async fn wait_for_driver_or_cancel(
    driver: &mut CliProcessDriver,
    cancel_flag: &Arc<AtomicBool>,
) -> std::io::Result<bool> {
    loop {
        if cancel_flag.load(Ordering::Acquire) {
            return Ok(false);
        }
        match tokio::time::timeout(CANCEL_POLL_INTERVAL, driver.wait()).await {
            Ok(result) => return result.map(|_| true),
            Err(_) => {}
        }
    }
}

// =============================================================================
// run_session -- the long-lived tokio task body
// =============================================================================

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_session(
    session_id: String,
    persona_id: String,
    intent: String,
    // The raw, user-typed intent (not the full system prompt). We need this
    // separately so gate heuristics scan the user's words, not the prompt
    // scaffolding which mentions every keyword we match for. The `intent`
    // parameter above is misnamed — it's actually the full LLM prompt.
    raw_user_intent: String,
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
    // OneShot autonomous build: skips Rust-side gate suppression so the
    // LLM's autonomous-mode rules (see session_prompt.rs) drive every
    // resolution without an `awaiting_input` round-trip. Test failures
    // and promote happen automatically; user is notified on terminal phase
    // via the BuildWatcher job + tauri-plugin-notification.
    one_shot: bool,
) {
    // Register run in ActiveProcessRegistry
    let _reg_flag = registry.register_run("build_session", &session_id);

    // Note: process activity for agent builds is tracked frontend-side via 'agent_build' domain
    // (see UnifiedMatrixEntry/MatrixAdoptionView). No backend emission needed here.

    // Update phase to Analyzing
    let _ = update_phase(&pool, &session_id, BuildPhase::Analyzing);
    emit_session_status(
        &pool,
        &channel,
        &app_handle,
        &session_id,
        BuildPhase::Analyzing,
        0,
        0,
    );

    // Build initial prompt with optional workflow context
    let initial_prompt: Arc<str> =
        if let (Some(ref wf_json), Some(ref parser_json)) = (&workflow_json, &parser_result_json) {
            let wf_preview = if wf_json.len() > 8000 {
                &wf_json[..8000]
            } else {
                wf_json.as_str()
            };
            format!(
                "{intent}\n\n## Workflow Import Context\n\
             Use the parsed analysis below as a structural baseline.\n\n\
             ### Parsed Workflow Analysis\n{parser_json}\n\n\
             ### Original Workflow JSON (preview)\n{wf_preview}\n"
            )
            .into()
        } else {
            intent.into()
        };

    // Multi-turn conversation history: (role, content) pairs
    let mut conversation: ConversationHistory = Vec::new();
    conversation.push(("user", Arc::clone(&initial_prompt)));

    let mut resolved_cells = serde_json::Map::new();
    let mut resolved_count: usize = 0;
    let mut last_answered_cells: Vec<String> = Vec::new();

    // Per-capability gate ledger + currently-pending gate. See CapabilityGates
    // docs above — these enforce Rule 16/17 on the Rust side and synthesize
    // clarifying_question events when the LLM skips them.
    let mut coverage: HashMap<String, CapabilityGates> = HashMap::new();
    let mut capability_titles: HashMap<String, String> = HashMap::new();
    let mut pending_gate: Option<PendingGate> = None;

    // 2026-05-05 — context for the gate-seed heuristics. Captured once per
    // session because vault state doesn't change mid-build:
    //   • registry_keywords: connector_definitions snapshot (services the
    //     persona can name in the intent and have them auto-resolve).
    //   • ambiguous_services: service_types where the vault has 2+
    //     credentials. Forces the connectors gate Closed for these so the
    //     credential picker fires — without this an intent like "GitHub"
    //     against a vault with 4 GitHub PATs would silently pick the
    //     newest one with no user input.
    let registry_keywords: Vec<String> = crate::engine::api_proxy::connector_keyword_snapshot();
    let ambiguous_services =
        crate::db::repos::resources::credentials::get_ambiguous_service_types(&pool);
    if !ambiguous_services.is_empty() {
        tracing::info!(
            session_id = %session_id,
            ambiguous = ?ambiguous_services,
            "Vault has multiple credentials per service_type; forcing connectors gate Closed for these"
        );
    }

    const MAX_TURNS: usize = 12;

    // Create a persistent temp dir shared across all turns so `--continue`
    // can find the previous session's conversation state.
    //
    // If this fails we MUST abort — passing a non-existent --cwd to the
    // Claude CLI later turns into an opaque CreateProcessW failure on
    // Windows (see runner.rs:148 history). Surface a concrete, actionable
    // message naming the path so users with disk-full, antivirus locks, or
    // OneDrive-synced %TEMP% can fix it instead of filing a support ticket.
    //
    // The path is wrapped in SessionExecDir AFTER successful create so its
    // Drop guarantees cleanup on every exit path — normal return, early
    // return on error, cancellation, or panic. See SessionExecDir docs.
    let session_exec_path =
        std::env::temp_dir().join(format!("build-session-{}", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::create_dir_all(&session_exec_path) {
        let path_display = session_exec_path.display().to_string();
        tracing::error!(
            session_id = %session_id,
            path = %path_display,
            error = %e,
            "Failed to create session workspace dir"
        );
        let user_msg = format!(
            "Workspace unavailable: could not create build directory at {path_display} ({e}). \
             Likely causes: disk full, antivirus or OneDrive sync lock on %TEMP%, \
             or insufficient permissions. Free up space, exclude the folder from sync, or retry."
        );
        let _ = update_phase_with_error(&pool, &session_id, &user_msg);
        emit_error(&pool, &channel, &app_handle, &session_id, &user_msg, false);
        cleanup_session(&sessions_map, &registry, &session_id);
        return;
    }
    let session_exec_dir = SessionExecDir::new(session_exec_path);

    for turn in 0..MAX_TURNS {
        // Check cancellation
        if cancel_flag.load(Ordering::Acquire) {
            tracing::info!(session_id = %session_id, "Build session cancelled");
            cleanup_session(&sessions_map, &registry, &session_id);
            return;
        }

        // Build the prompt for this turn.
        // Turn 0: send the full system prompt.
        // Turn 1+: send only a concise follow-up — session context is preserved via --continue.
        let turn_prompt: Arc<str> = if turn == 0 {
            Arc::clone(&initial_prompt)
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
            follow_up.into()
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
                format!(
                    "Processing answer for {}...",
                    last_answered_cells
                        .first()
                        .map(|s| s.as_str())
                        .unwrap_or("dimension")
                )
            }),
        };
        dual_emit(&pool, &channel, &app_handle, &progress);

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
        let mut driver = match CliProcessDriver::spawn(
            &turn_args,
            session_exec_dir.path().to_path_buf(),
        ) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(session_id = %session_id, error = %e, "CLI spawn failed on turn {}", turn);
                let _ =
                    update_phase_with_error(&pool, &session_id, &format!("CLI spawn failed: {e}"));
                emit_error(
                    &pool,
                    &channel,
                    &app_handle,
                    &session_id,
                    &format!("Failed to start build: {e}"),
                    false,
                );
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
            registry.clear_run_pid("build_session", &session_id);
            let _ =
                update_phase_with_error(&pool, &session_id, &format!("Failed to send prompt: {e}"));
            emit_error(
                &pool,
                &channel,
                &app_handle,
                &session_id,
                &format!("Build failed: could not send prompt (turn {})", turn + 1),
                false,
            );
            break;
        }
        driver.close_stdin().await;

        // Read all output from this turn
        let mut turn_events: Vec<BuildEvent> = Vec::new();
        let mut turn_raw = String::new();

        if let Some(mut reader) = driver.take_stdout_reader() {
            let cancel_wait = wait_for_cancel_flag(cancel_flag.clone());
            tokio::pin!(cancel_wait);
            loop {
                tokio::select! {
                    _ = &mut cancel_wait => {
                        kill_cancelled_turn(&mut driver, &registry, &session_id, turn).await;
                        cleanup_session(&sessions_map, &registry, &session_id);
                        return;
                    }
                    line_result = read_line_limited(&mut reader) => {
                        match line_result {
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
            }
        }

        // Wait for the CLI process to exit (don't use finish() which would
        // attempt dir cleanup — we reuse session_exec_dir across turns).
        match wait_for_driver_or_cancel(&mut driver, &cancel_flag).await {
            Ok(true) => registry.clear_run_pid("build_session", &session_id),
            Ok(false) => {
                kill_cancelled_turn(&mut driver, &registry, &session_id, turn).await;
                cleanup_session(&sessions_map, &registry, &session_id);
                return;
            }
            Err(e) => {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "Failed while waiting for CLI process to exit"
                );
                registry.clear_run_pid("build_session", &session_id);
            }
        }

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

        // -----------------------------------------------------------------
        // Capability-gate pass — suppress out-of-order resolutions and
        // synthesize missing clarifying_question events locally. See the
        // CapabilityGates doc block above for the state-machine rules.
        //
        // IMPORTANT: every CapabilityResolutionUpdate parsed from the LLM is
        // paired with a legacy CellUpdate mirror (see parse_json_object).
        // When we suppress the v3 event, we MUST also suppress the paired
        // legacy mirror — otherwise `resolved_cells` accumulates a partial
        // resolution and the outer state machine trips the `resolved_count
        // >= 8` shortcut into draft_ready. The parser emits v3 FIRST then
        // legacy, so a single forward pass with a suppress-legacy set is
        // sufficient.
        // -----------------------------------------------------------------
        turn_events = {
            let event_type_names: Vec<&'static str> = turn_events
                .iter()
                .map(|e| match e {
                    BuildEvent::CellUpdate { cell_key, .. } => {
                        if cell_key == "agent_ir" {
                            "cell:agent_ir"
                        } else if cell_key == "behavior_core" {
                            "cell:behavior_core"
                        } else if cell_key == "use-cases" {
                            "cell:use-cases"
                        } else if cell_key == "connectors" {
                            "cell:connectors"
                        } else if cell_key == "triggers" {
                            "cell:triggers"
                        } else if cell_key == "events" {
                            "cell:events"
                        } else if cell_key == "messages" {
                            "cell:messages"
                        } else if cell_key == "human-review" {
                            "cell:human-review"
                        } else if cell_key == "memory" {
                            "cell:memory"
                        } else if cell_key == "error-handling" {
                            "cell:error-handling"
                        } else {
                            "cell:other"
                        }
                    }
                    BuildEvent::Question { .. } => "Question",
                    BuildEvent::ClarifyingQuestionV3 { .. } => "ClarifyingV3",
                    BuildEvent::CapabilityResolutionUpdate { .. } => "CapRes",
                    BuildEvent::CapabilityEnumerationUpdate { .. } => "CapEnum",
                    BuildEvent::BehaviorCoreUpdate { .. } => "BehaviorCore",
                    BuildEvent::PersonaResolutionUpdate { .. } => "PersonaRes",
                    BuildEvent::Progress { .. } => "Progress",
                    BuildEvent::Error { .. } => "Error",
                    BuildEvent::SessionStatus { .. } => "Status",
                })
                .collect();
            tracing::info!(
                session_id = %session_id,
                turn = turn + 1,
                event_count = turn_events.len(),
                coverage_caps = coverage.len(),
                events = ?event_type_names,
                "Gate-pass entry"
            );

            let mut kept: Vec<BuildEvent> = Vec::with_capacity(turn_events.len());
            let mut synthesized: Vec<BuildEvent> = Vec::new();
            let mut suppress_legacy: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            // 2026-05-04 — questionnaire batching fix. Pre-fix the
            // synthesizer fired one gate per turn (a `synthesized_this_turn`
            // bool), so a build with 3 closed gates surfaced as 3 separate
            // round-trips — each separated by an LLM round (~30-60s). The
            // user's intent matched build prompt rule 25 ("BATCH clarifying
            // _questions per turn — MANDATORY") but the LLM treated it as
            // advisory and the synthesizer didn't compensate.
            // Now we track which capabilities have already had their
            // batched fan-out fired this turn (so a second
            // `capability_resolution` event for the same cap doesn't
            // double-emit), but every closed gate on a cap fires together.
            let mut batched_caps_this_turn: std::collections::HashSet<String> =
                std::collections::HashSet::new();

            for event in turn_events {
                let keep = match &event {
                    BuildEvent::CapabilityEnumerationUpdate { data, .. } => {
                        init_gates_from_enumeration_with_context(
                            &mut coverage,
                            &mut capability_titles,
                            data,
                            &raw_user_intent,
                            &registry_keywords,
                            &ambiguous_services,
                        );
                        let gate_summary: Vec<String> = coverage
                            .iter()
                            .map(|(k, v)| {
                                format!(
                                    "{}:[t={:?},c={:?},r={:?},m={:?}]",
                                    k, v.trigger, v.connectors, v.review_policy, v.memory_policy
                                )
                            })
                            .collect();
                        tracing::info!(
                            session_id = %session_id,
                            raw_intent = %raw_user_intent,
                            caps = ?gate_summary,
                            "CapEnum init — gates seeded"
                        );
                        true
                    }
                    BuildEvent::ClarifyingQuestionV3 {
                        capability_id,
                        field,
                        ..
                    } => {
                        // The LLM *did* ask — flip the gate to Pending so a
                        // subsequent user answer opens it. Only act on
                        // capability-scoped questions (mission/capability
                        // scopes don't map to a gated field).
                        if let (Some(cap_id), Some(field_name)) =
                            (capability_id.as_deref(), field.as_deref())
                        {
                            if is_gated_field(field_name) {
                                ensure_capability_in_coverage_with_context(
                                    &mut coverage,
                                    cap_id,
                                    &raw_user_intent,
                                    &registry_keywords,
                                    &ambiguous_services,
                                );
                                if let Some(cg) = coverage.get_mut(cap_id) {
                                    cg.mark_pending(field_name);
                                }
                                pending_gate = Some(PendingGate {
                                    cap_id: cap_id.to_string(),
                                    field: field_name.to_string(),
                                });
                            }
                        }
                        true
                    }
                    BuildEvent::CapabilityResolutionUpdate {
                        capability_id,
                        field,
                        value,
                        ..
                    } => {
                        ensure_capability_in_coverage_with_context(
                            &mut coverage,
                            capability_id,
                            &raw_user_intent,
                            &registry_keywords,
                            &ambiguous_services,
                        );
                        // Opportunistically harvest a title from the
                        // resolution payload. Some LLMs include `title`
                        // alongside the resolved field even though only the
                        // CapEnum event is supposed to carry it. Without
                        // this, a build that skips enumeration and goes
                        // straight to per-field resolutions leaves
                        // `capability_titles` empty — the synthesizer's
                        // humanise_capability_id fallback handles the
                        // raw-id case but a real title is always better.
                        if !capability_titles.contains_key(capability_id) {
                            if let Some(t) = value.get("title").and_then(|v| v.as_str()) {
                                if !t.is_empty() {
                                    capability_titles.insert(capability_id.clone(), t.to_string());
                                }
                            }
                        }
                        // Defensive open: when the user already answered the
                        // legacy cell that maps to this field in a prior turn
                        // (still pending in `last_answered_cells` until the
                        // post-loop clear), trust their answer and mark the
                        // gate Open before the gate-state check. Without this,
                        // an LLM that re-emits a CapRes for an already-answered
                        // field gets suppressed + re-asked, looping the user
                        // through the same question. This was the root cause
                        // of the build pipeline stalling on non-translation
                        // intents.
                        if let Some(legacy) = map_capability_field_to_legacy_dimension(field) {
                            if last_answered_cells.iter().any(|c| c == legacy) {
                                if let Some(cg) = coverage.get_mut(capability_id) {
                                    if !cg.is_gate_open(field) {
                                        cg.mark_open(field);
                                        tracing::info!(
                                            session_id = %session_id,
                                            cap_id = %capability_id,
                                            field = %field,
                                            answered_cell = %legacy,
                                            "Gate auto-opened: user already answered the legacy cell this turn"
                                        );
                                    }
                                }
                            }
                        }
                        let gate_open = coverage
                            .get(capability_id)
                            .map(|g| g.is_gate_open(field))
                            .unwrap_or(true);
                        let is_gated = is_gated_field(field);
                        tracing::info!(
                            session_id = %session_id,
                            cap_id = %capability_id,
                            field = %field,
                            gate_open = gate_open,
                            is_gated = is_gated,
                            "CapRes gate check"
                        );
                        if !gate_open && is_gated {
                            // Always suppress out-of-order resolutions +
                            // their legacy mirror so resolved_cells doesn't
                            // accumulate a partial value. Only synthesize a
                            // NEW question if we haven't already this turn.
                            if let Some(legacy) = map_capability_field_to_legacy_dimension(field) {
                                suppress_legacy.insert(legacy.to_string());
                            }
                            // Batch ALL unopen gates for this capability in
                            // one fan-out instead of asking one-per-turn.
                            // The bool guard makes a second
                            // `capability_resolution` event for the same
                            // cap a no-op (the first hit already emitted
                            // every closed gate's question and marked
                            // them Pending).
                            if batched_caps_this_turn.insert(capability_id.clone()) {
                                let synth = super::gates::synthesize_all_unopen_gates(
                                    capability_id,
                                    &mut coverage,
                                    &capability_titles,
                                    value,
                                    &pool,
                                    &session_id,
                                );
                                if !synth.is_empty() {
                                    pending_gate = Some(PendingGate {
                                        cap_id: capability_id.clone(),
                                        field: field.clone(),
                                    });
                                    tracing::warn!(
                                        session_id = %session_id,
                                        capability_id = %capability_id,
                                        triggering_field = %field,
                                        synthesized_count = synth.len(),
                                        "Gate closed — suppressing capability_resolution, synthesizing batched clarifying_questions"
                                    );
                                    synthesized.extend(synth);
                                }
                            } else {
                                tracing::info!(
                                    session_id = %session_id,
                                    capability_id = %capability_id,
                                    field = %field,
                                    "Gate closed — suppressing (batch for this cap already fired this turn)"
                                );
                            }
                            false
                        } else {
                            true
                        }
                    }
                    BuildEvent::CellUpdate { cell_key, data, .. } if cell_key == "agent_ir" => {
                        // If the LLM skipped enumeration entirely, bootstrap
                        // coverage from agent_ir's capabilities/use_cases so
                        // we have gates to check.
                        if coverage.is_empty() {
                            if let Some(caps) = data
                                .get("persona")
                                .and_then(|p| p.get("capabilities"))
                                .and_then(|v| v.as_array())
                                .or_else(|| data.get("capabilities").and_then(|v| v.as_array()))
                                .or_else(|| data.get("use_cases").and_then(|v| v.as_array()))
                            {
                                let seed = gate_seed_for_intent_with_context(
                                    &raw_user_intent,
                                    &registry_keywords,
                                    &ambiguous_services,
                                );
                                for cap in caps {
                                    let id = cap.get("id").and_then(|v| v.as_str()).or_else(|| {
                                        cap.get("use_case_id").and_then(|v| v.as_str())
                                    });
                                    let title = cap.get("title").and_then(|v| v.as_str());
                                    if let Some(id) = id {
                                        coverage
                                            .entry(id.to_string())
                                            .or_insert_with(|| seed.clone());
                                        if let Some(t) = title {
                                            capability_titles
                                                .entry(id.to_string())
                                                .or_insert_with(|| t.to_string());
                                        }
                                    }
                                }
                            }
                            // Fallback: if still empty, create a synthetic
                            // single-cap coverage so at least one gate round
                            // fires for the user.
                            if coverage.is_empty() {
                                coverage.insert(
                                    "uc_default".to_string(),
                                    gate_seed_for_intent_with_context(
                                        &raw_user_intent,
                                        &registry_keywords,
                                        &ambiguous_services,
                                    ),
                                );
                                capability_titles
                                    .entry("uc_default".to_string())
                                    .or_insert_with(|| "this agent".to_string());
                            }
                        }
                        if let Some((cap_id, field_name)) = find_first_unopen_gate(&coverage) {
                            if one_shot {
                                // Autonomous build — the prompt's autonomous-mode
                                // override told the LLM to never ask. If a gate is
                                // still closed when agent_ir lands, the LLM either
                                // already filled it via a default or genuinely
                                // missed something. Either way, do NOT synthesize a
                                // clarifying_question (the user can't answer it) —
                                // let the agent_ir through and let test_build_draft
                                // surface any actual breakage.
                                tracing::warn!(
                                    session_id = %session_id,
                                    missing_cap = %cap_id,
                                    missing_field = %field_name,
                                    "OneShot: gate still closed at agent_ir but bypassing suppression (test phase will surface real failures)"
                                );
                                true
                            } else if batched_caps_this_turn.insert(cap_id.clone()) {
                                let synth = super::gates::synthesize_all_unopen_gates(
                                    &cap_id,
                                    &mut coverage,
                                    &capability_titles,
                                    &serde_json::Value::Null,
                                    &pool,
                                    &session_id,
                                );
                                if !synth.is_empty() {
                                    pending_gate = Some(PendingGate {
                                        cap_id: cap_id.clone(),
                                        field: field_name.to_string(),
                                    });
                                    tracing::warn!(
                                        session_id = %session_id,
                                        missing_cap = %cap_id,
                                        missing_field = %field_name,
                                        synthesized_count = synth.len(),
                                        "Gate closed — suppressing agent_ir, synthesizing batched clarifying_questions"
                                    );
                                    synthesized.extend(synth);
                                }
                                false
                            } else {
                                tracing::info!(
                                    session_id = %session_id,
                                    missing_cap = %cap_id,
                                    missing_field = %field_name,
                                    "Gate closed — suppressing agent_ir (batch for this cap already fired this turn)"
                                );
                                false
                            }
                        } else {
                            true
                        }
                    }
                    BuildEvent::CellUpdate { cell_key, .. } => !suppress_legacy.contains(cell_key),
                    BuildEvent::PersonaResolutionUpdate { field, .. } => {
                        // Persona-wide resolutions for gated v3 fields can
                        // bypass per-capability gates. If ANY capability
                        // still has the matching gate closed, suppress the
                        // persona-wide resolution + its legacy mirror.
                        let gated = match field.as_str() {
                            "connectors" => Some("connectors"),
                            "core_memories" => Some("memory_policy"),
                            _ => None,
                        };
                        if let Some(field_name) = gated {
                            let any_closed = coverage.values().any(|g| !g.is_gate_open(field_name));
                            if any_closed {
                                if let Some(legacy) = map_persona_field_to_legacy_dimension(field) {
                                    suppress_legacy.insert(legacy.to_string());
                                }
                                tracing::warn!(
                                    session_id = %session_id,
                                    field = %field,
                                    "Gate closed — suppressing persona_resolution (bypass attempt)"
                                );
                                false
                            } else {
                                true
                            }
                        } else {
                            true
                        }
                    }
                    _ => true,
                };
                if keep {
                    kept.push(event);
                }
            }

            kept.extend(synthesized);
            kept
        };

        // Build assistant text for conversation history
        let assistant_text: String = turn_events
            .iter()
            .filter_map(|e| match e {
                BuildEvent::Question {
                    question,
                    cell_key,
                    options,
                    ..
                } => {
                    let opts = options.as_ref().map(|o| o.join(", ")).unwrap_or_default();
                    Some(format!(
                        "{{\"question\": \"{}\", \"dimension\": \"{}\", \"options\": [{}]}}",
                        question, cell_key, opts
                    ))
                }
                BuildEvent::CellUpdate {
                    cell_key,
                    data,
                    status,
                    ..
                } => Some(format!(
                    "{{\"dimension\": \"{}\", \"status\": \"{}\", \"data\": {}}}",
                    cell_key, status, data
                )),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !assistant_text.is_empty() {
            conversation.push(("assistant", assistant_text.into()));
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
                        let _ = build_session_repo::update(
                            &pool,
                            &session_id,
                            &UpdateBuildSession {
                                agent_ir: Some(ir_str),
                                ..Default::default()
                            },
                        );
                        // Update persona name from agent_ir
                        if let Some(name) = data.get("name").and_then(|n| n.as_str()) {
                            if !name.is_empty() {
                                let _ = crate::db::repos::core::personas::update_name(
                                    &pool,
                                    &persona_id,
                                    name,
                                );
                            }
                        }
                    } else if cell_key != "_test_report" {
                        resolved_cells.insert(cell_key.clone(), data.clone());
                        turn_resolved_keys.push(cell_key.clone());
                        let resolved_json = serde_json::to_string(&serde_json::Value::Object(
                            resolved_cells.clone(),
                        ))
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
                        // Emit rich activity for dimension resolution
                        let activity_event = BuildEvent::Progress {
                            session_id: session_id.clone(),
                            dimension: Some(cell_key.clone()),
                            message: format!("Resolved: {}", cell_key),
                            percent: Some((resolved_cells.len() as f32 / 9.0) * 100.0),
                            activity: Some(format!(
                                "Resolved {} — moving to next dimension",
                                cell_key
                            )),
                        };
                        dual_emit(&pool, &channel, &app_handle, &activity_event);
                    }
                    dual_emit(&pool, &channel, &app_handle, &event);
                }
                BuildEvent::Question {
                    question,
                    cell_key,
                    options,
                    ..
                } => {
                    got_question = true;
                    let question_json = serde_json::json!({ "cell_key": cell_key, "question": question, "options": options });
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
                    // Emit rich activity for awaiting input
                    let activity_event = BuildEvent::Progress {
                        session_id: session_id.clone(),
                        dimension: Some(cell_key.clone()),
                        message: format!("Awaiting input: {}", cell_key),
                        percent: None,
                        activity: Some(format!("Needs your input on: {}", cell_key)),
                    };
                    dual_emit(&pool, &channel, &app_handle, &activity_event);
                    dual_emit(&pool, &channel, &app_handle, &event);
                }
                _ => {
                    dual_emit(&pool, &channel, &app_handle, &event);
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
                    dual_emit(&pool, &channel, &app_handle, &confirm_event);
                    tracing::info!(session_id = %session_id, cell_key = %answered_key, "Re-emitted resolved for answered cell");
                }
            }
        }
        last_answered_cells.clear();

        // If question asked: wait for user answer, then continue to next turn
        if got_question {
            emit_session_status(
                &pool,
                &channel,
                &app_handle,
                &session_id,
                BuildPhase::AwaitingInput,
                resolved_count,
                9,
            );
            notifications::send(
                &app_handle,
                "Input Required",
                "Your agent build needs your input to continue.",
            );
            tracing::info!(session_id = %session_id, turn = turn + 1, "Waiting for user answer");

            match input_rx.recv().await {
                Some(answer) => {
                    tracing::info!(session_id = %session_id, cell_key = %answer.cell_key, "Received user answer");
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
                        &pool,
                        &channel,
                        &app_handle,
                        &session_id,
                        BuildPhase::Resolving,
                        resolved_count,
                        9,
                    );

                    // Flip any pending gate to Open. The UI only permits one
                    // pending question at a time, so a reply is unambiguous.
                    // When the legacy cell_key matches the pending field we
                    // trust it; otherwise we still clear pending_gate but
                    // don't assume which gate the answer belongs to.
                    if let Some(pg) = pending_gate.take() {
                        let legacy_matches = legacy_cell_to_v3_field(&answer.cell_key)
                            .map(|f| f == pg.field.as_str())
                            .unwrap_or(false);
                        if legacy_matches || answer.cell_key == "_batch" {
                            if let Some(cg) = coverage.get_mut(&pg.cap_id) {
                                cg.mark_open(&pg.field);
                                tracing::info!(
                                    session_id = %session_id,
                                    cap_id = %pg.cap_id,
                                    field = %pg.field,
                                    "Gate opened after user answer"
                                );
                            }
                        } else {
                            // Re-stash — the user answered some other question
                            // (shouldn't happen today, but be safe).
                            pending_gate = Some(pg);
                        }
                    }

                    // Handle batch answers: cell_key="_batch" means multiple dimension answers
                    if answer.cell_key == "_batch" {
                        // Parse dimension keys from the answer text: lines like "[use-cases]: ..."
                        let mut keys = Vec::new();
                        for line in answer.answer.lines() {
                            if let Some(start) = line.find('[') {
                                if let Some(end) = line.find("]:") {
                                    if let Some(key) =
                                        line.get(start + 1..end).map(|s| s.trim().to_string())
                                    {
                                        if !key.is_empty() {
                                            keys.push(key);
                                        }
                                    }
                                }
                            }
                        }
                        conversation.push((
                            "user",
                            format!(
                                "User confirmed/answered multiple dimensions:\n{}",
                                answer.answer
                            )
                            .into(),
                        ));
                        last_answered_cells = keys;
                    } else {
                        conversation.push((
                            "user",
                            format!("My answer for {}: {}", answer.cell_key, answer.answer).into(),
                        ));
                        last_answered_cells = vec![answer.cell_key.clone()];
                    }

                    // 2026-05-04 — flip every Pending gate whose legacy
                    // dimension key appears in `last_answered_cells`. The
                    // singleton `pending_gate` block above only handles
                    // ONE gate; with batched synthesis (which emits all
                    // unopen gates for a cap in a single turn) multiple
                    // gates land in Pending simultaneously. Without this
                    // sweep, a user who answers review_policy + memory_policy
                    // in one round would have only review_policy flipped to
                    // Open — memory_policy stays Pending, the synthesizer
                    // sees it on the next turn, and the user gets the same
                    // memory question re-asked. This was directly observed
                    // in the rapid-validation R02 trace post-batched-fix.
                    let answered_v3_fields: std::collections::HashSet<&'static str> =
                        last_answered_cells
                            .iter()
                            .filter_map(|cell| legacy_cell_to_v3_field(cell))
                            .collect();
                    for cap_gates in coverage.values_mut() {
                        for field in &answered_v3_fields {
                            if !cap_gates.is_gate_open(field) {
                                cap_gates.mark_open(field);
                                tracing::info!(
                                    session_id = %session_id,
                                    field = %field,
                                    "Gate opened via last_answered_cells fan-out (batched answer)"
                                );
                            }
                        }
                    }
                }
                None => {
                    tracing::info!(session_id = %session_id, "Input channel closed");
                    cleanup_session(&sessions_map, &registry, &session_id);
                    return;
                }
            }
        } else if resolved_count >= 8 && !got_agent_ir {
            // All 8 dimensions resolved but no agent_ir — request it explicitly
            tracing::warn!(session_id = %session_id, turn = turn + 1, "All 8 resolved but no agent_ir — sending recovery prompt");

            let ir_recovery = "All 8 dimensions are now resolved. Emit the agent_ir JSON object NOW. Output ONLY the {\"agent_ir\": {...}} line — no dimensions, no questions, no commentary.";
            conversation.push(("user", ir_recovery.into()));
            // The next iteration of the turn loop will spawn a CLI with this prompt
            // and hopefully get agent_ir back. If it still fails after MAX_TURNS,
            // the final checkpoint will persist whatever we have.
        } else if (got_agent_ir || resolved_count >= 8)
            && {
                // Final gate guard: if any capability gate is still closed, don't
                // enter DraftReady — force another turn so the LLM is prompted
                // again. This catches the case where the LLM smuggles enough
                // resolutions through to trip resolved_count>=8 but our filter
                // suppressed its agent_ir. Without this guard the outer auto-test
                // path (UI useEffect on draft_ready) fires and masks the gap.
                //
                // OneShot bypass: in autonomous mode the user is not present
                // to answer, and the LLM was instructed never to ask. Allow
                // DraftReady through and let test_build_draft surface real
                // failures. The retry loop will re-prompt the LLM if needed.
                let any_closed = coverage.values().any(|g| g.first_unopen_field().is_some());
                if any_closed && !one_shot {
                    let (gap_cap, gap_field) =
                        find_first_unopen_gate(&coverage).unwrap_or_else(|| ("?".to_string(), "?"));
                    tracing::warn!(
                        session_id = %session_id,
                        turn = turn + 1,
                        gap_cap = %gap_cap,
                        gap_field = %gap_field,
                        resolved_count = resolved_count,
                        got_agent_ir = got_agent_ir,
                        "Skipping DraftReady — gate still closed; continuing to next turn"
                    );
                    // Inject a direct continue-prompt into the conversation so
                    // the next turn gets a clear correction (alongside our own
                    // synthesized question which the user answered).
                    conversation.push((
                        "user",
                        format!(
                            "You emitted agent_ir / enough resolutions but capability {gap_cap} still has an unanswered {gap_field}. Emit a clarifying_question for that field now (do not re-emit agent_ir until it is answered)."
                        )
                        .into(),
                    ));
                    last_answered_cells.clear();
                    false
                } else {
                    if any_closed && one_shot {
                        let (gap_cap, gap_field) = find_first_unopen_gate(&coverage)
                            .unwrap_or_else(|| ("?".to_string(), "?"));
                        tracing::warn!(
                            session_id = %session_id,
                            turn = turn + 1,
                            gap_cap = %gap_cap,
                            gap_field = %gap_field,
                            "OneShot: gate still closed at DraftReady but allowing through (autonomous mode)"
                        );
                    }
                    true
                }
            }
        {
            // All done — enter draft_ready and wait for test/refine
            let _ = build_session_repo::update(
                &pool,
                &session_id,
                &UpdateBuildSession {
                    phase: Some(BuildPhase::DraftReady.as_str().to_string()),
                    pending_question: Some(None),
                    ..Default::default()
                },
            );
            let draft_activity = BuildEvent::Progress {
                session_id: session_id.clone(),
                dimension: None,
                message: "Draft ready for review".to_string(),
                percent: Some(100.0),
                activity: Some("Draft ready for review".to_string()),
            };
            dual_emit(&pool, &channel, &app_handle, &draft_activity);
            emit_session_status(
                &pool,
                &channel,
                &app_handle,
                &session_id,
                BuildPhase::DraftReady,
                resolved_count,
                9,
            );
            // OS notification + Glyph banner only for interactive mode —
            // OneShot fires its own terminal notification post-promote so we
            // don't double-ping the user mid-flight.
            if !one_shot {
                notifications::send(
                    &app_handle,
                    "Agent Draft Ready",
                    "Your agent configuration is complete. Review and test it.",
                );
            }

            // OneShot: spawn the post-draft orchestrator and exit the runner.
            // The orchestrator owns Testing → TestComplete → Promoted (or
            // Failed) and fires the terminal notification when done.
            if one_shot {
                tracing::info!(
                    session_id = %session_id,
                    "OneShot DraftReady — handing off to post-draft orchestrator"
                );
                let oneshot_app = app_handle.clone();
                let oneshot_sid = session_id.clone();
                // Use the persona_id already passed into run_session — never
                // re-fetch from the DB here. A row lookup at this seam used
                // to silently abort the post-draft orchestrator if the row
                // was missing for any reason (DB busy, transient I/O, late
                // cancel), leaving the session stuck in DraftReady forever
                // with no terminal notification.
                let oneshot_persona_id = persona_id.clone();
                tokio::spawn(async move {
                    super::oneshot::run_post_draft(oneshot_app, oneshot_sid, oneshot_persona_id)
                        .await;
                });
                cleanup_session(&sessions_map, &registry, &session_id);
                return;
            }

            // Wait for _test or _refine input
            tracing::info!(session_id = %session_id, "Draft ready, waiting for test/refine");
            match input_rx.recv().await {
                Some(answer) => {
                    if answer.cell_key == "_test" {
                        let _ = build_session_repo::update(
                            &pool,
                            &session_id,
                            &UpdateBuildSession {
                                phase: Some(BuildPhase::Testing.as_str().to_string()),
                                ..Default::default()
                            },
                        );
                        emit_session_status(
                            &pool,
                            &channel,
                            &app_handle,
                            &session_id,
                            BuildPhase::Testing,
                            resolved_count,
                            9,
                        );
                        conversation.push((
                            "user",
                            "Test this agent. Report any issues via test_report JSON.".into(),
                        ));
                    } else if answer.cell_key == "_refine" {
                        let _ = build_session_repo::update(
                            &pool,
                            &session_id,
                            &UpdateBuildSession {
                                phase: Some(BuildPhase::Resolving.as_str().to_string()),
                                ..Default::default()
                            },
                        );
                        emit_session_status(
                            &pool,
                            &channel,
                            &app_handle,
                            &session_id,
                            BuildPhase::Resolving,
                            resolved_count,
                            9,
                        );
                        conversation.push((
                            "user",
                            format!("Refinement: {}. Update affected dimensions.", answer.answer)
                                .into(),
                        ));
                    } else {
                        conversation.push((
                            "user",
                            format!("Answer for {}: {}", answer.cell_key, answer.answer).into(),
                        ));
                    }
                    // Continue to next turn
                }
                None => {
                    cleanup_session(&sessions_map, &registry, &session_id);
                    return;
                }
            }
        } else {
            // No question and no agent_ir — CLI gave partial results. Continue to next turn.
            tracing::info!(session_id = %session_id, turn = turn + 1, resolved = resolved_count, "Turn complete, continuing");
        }
    }

    // session_exec_dir's Drop removes the shared temp directory when this
    // function returns (or panics) — see SessionExecDir at the top of the
    // file. No explicit cleanup needed here.

    // Final checkpoint
    let agent_ir_str = resolved_cells
        .get("agent_ir")
        .and_then(|v| serde_json::to_string(v).ok());

    let final_phase = if resolved_count == 0 && agent_ir_str.is_none() {
        BuildPhase::Failed
    } else {
        BuildPhase::DraftReady
    };
    let resolved_json = serde_json::to_string(&serde_json::Value::Object(resolved_cells))
        .unwrap_or_else(|_| "{}".to_string());
    let _ = build_session_repo::update(
        &pool,
        &session_id,
        &UpdateBuildSession {
            phase: Some(final_phase.as_str().to_string()),
            resolved_cells: Some(resolved_json),
            cli_pid: Some(None),
            pending_question: Some(None),
            agent_ir: if agent_ir_str.is_some() {
                Some(agent_ir_str)
            } else {
                None
            },
            ..Default::default()
        },
    );

    emit_session_status(
        &pool,
        &channel,
        &app_handle,
        &session_id,
        final_phase,
        resolved_count,
        9,
    );
    cleanup_session(&sessions_map, &registry, &session_id);
}
